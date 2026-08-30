import { findWeaponForRoll } from './roll-utils.js'
import { getStepSetting } from './settings.js'
import { getLoadedAmmoType, getAmmoDamageBonus, getFlatDamageBonus } from './weapon-tags.js'
import { performPrivilegedDamage } from './privileged-write-relay.js'
import { isBroken, isUnrepairable, isWorn, absorbArmorDamage, effectiveArmorValue, armorDamageAbsorbedFor, armorThresholdFor, repairAttemptsFor, MAX_REPAIR_ATTEMPTS } from './repair.js'
import { equippedSlotFor, slotLabel } from './equip.js'

const MODULE_ID = 'vtm5e-automation'

/**
 * armorvalue (armor-item-model.js) is a pure display field in wod5e itself -
 * this is the first thing in this module that actually reads it. Real
 * layering (2026-07-24, Jake's call): Underarmor and Body Armor are
 * DIFFERENT slots (equip.js) that can both be worn at once and both
 * contribute - a concealable vest under a rigid plate carrier is exactly
 * how real soft+hard armor combos work. Within a single slot it's still
 * MAX not SUM (equip.js's own one-item-per-slot rule already prevents two
 * body-armor pieces being worn simultaneously, so there's only ever one
 * candidate per slot in practice - reduce() here is just how "the one
 * candidate, if any" gets picked out cleanly). Broken armor (repair.js's
 * durability mechanic - a piece that's absorbed more damage than its own
 * threshold) is excluded from the pool entirely, which is what makes it
 * "no longer providing protection" for that slot until repaired.
 */
function bestArmorInSlot(actor, slot) {
  const candidates = actor?.items.filter((i) => i.type === 'armor' && equippedSlotFor(i) === slot && !isBroken(i)) ?? []
  if (candidates.length === 0) return null
  return candidates.reduce((best, item) => effectiveArmorValue(item) > effectiveArmorValue(best) ? item : best)
}

// Outer-to-inner order (Body Armor takes a hit before whatever's worn
// underneath it) - only matters for applyDamageToTarget's per-layer wear
// split below; the total reduction itself is order-independent, just a sum.
function equippedArmorLayers(actor) {
  return ['bodyArmor', 'underarmor'].map((slot) => bestArmorInSlot(actor, slot)).filter(Boolean)
}

function getEquippedArmorReduction(actor) {
  return equippedArmorLayers(actor).reduce((sum, item) => sum + effectiveArmorValue(item), 0)
}

// Fortitude's Toughness power (power-effects.js) - "Subtracts the user's
// Fortitude rating from incoming Superficial damage" for the rest of the
// scene it was activated in. Stored as a flag on the Toughness condition
// item rather than read live off the Fortitude discipline, since the rating
// is meant to be locked in at activation time, same as the real power.
// Superficial only, matching the power's own text - Aggravated damage is
// unaffected.
function getToughnessReduction(actor, damageType) {
  if (damageType !== 'superficial') return 0
  const condition = actor?.items.find((i) => i.type === 'condition' && i.name === 'Toughness')
  return condition?.getFlag('vtm5e-automation', 'toughnessReduction') ?? 0
}

// Fortitude's Defy Bane power (power-effects.js) - a shared per-scene
// budget of Aggravated damage that converts to Superficial instead when
// sustained (corebook p.259: "not per wound or per attack"). Consumed (not
// just read) by applyDamageToTarget below, since using it up is a real
// write back onto the condition item, not a passive multiplier like
// Toughness.
function getDefyBaneBudget(actor) {
  const condition = actor?.items.find((i) => i.type === 'condition' && i.name === 'Defy Bane')
  return condition?.getFlag('vtm5e-automation', 'defyBaneBudget') ?? 0
}

async function consumeDefyBaneBudget(actor, amount) {
  const condition = actor.items.find((i) => i.type === 'condition' && i.name === 'Defy Bane')
  if (!condition) return
  const remaining = Math.max((condition.getFlag('vtm5e-automation', 'defyBaneBudget') ?? 0) - amount, 0)
  await condition.setFlag('vtm5e-automation', 'defyBaneBudget', remaining)
}

/**
 * Pure calculation of how much damage would actually land on actor, after
 * armor reduction (if applicable) and the max-health-track clamp - no
 * writes. Shared by applyDamageToTarget (which then writes this number) and
 * opposing-roll-trigger.js's recap card, which needs to DISPLAY the real
 * number rather than the raw pre-reduction margin (see that file's
 * postWeaponResolutionCard - this used to be the source of a real bug where
 * the chat card always showed the raw margin even when armor silently
 * reduced what actually hit the health track).
 */
export function computeAppliedDamage(actor, amount, damageType, { reduceByArmor = false, armorPiercingAmmo = false } = {}) {
  if (!actor) return 0

  let armorReduction = 0
  if (reduceByArmor) {
    armorReduction = getEquippedArmorReduction(actor)
    // Armor-Piercing ammo, per Second Inquisition RAW (p.72) - "Reduces
    // target's Armor Value by 2." (There used to be a second, homebrew-only
    // "ignores armor entirely" path via the Blunt weapon tag - removed
    // 2026-07-22, it was meaningfully more powerful than anything RAW gives
    // a melee weapon, including this ammo type itself.)
    if (armorPiercingAmmo) armorReduction = Math.max(armorReduction - 2, 0)
  }
  // Toughness (unlike armor) always applies when active - it's not gated
  // behind reduceByArmor, since it's a Discipline effect on the character,
  // not equipment tied to a weapon-attack context. Applied AFTER armor
  // (which can reduce a hit to 0) and, per RAW (corebook p.259), "cannot
  // reduce the damage below one" - its own floor is 1, not 0, so it never
  // un-blocks a hit armor already fully stopped.
  const afterArmor = Math.max(amount - armorReduction, 0)
  if (afterArmor <= 0) return 0
  const toughnessReduction = getToughnessReduction(actor, damageType)
  const reducedAmount = toughnessReduction > 0 ? Math.max(afterArmor - toughnessReduction, 1) : afterArmor

  const current = actor.system.health?.[damageType] ?? 0
  const max = actor.system.health?.max ?? 0
  const otherType = damageType === 'superficial' ? 'aggravated' : 'superficial'
  const otherCurrent = actor.system.health?.[otherType] ?? 0

  // Clamp so the two damage types together don't exceed max boxes
  const room = Math.max(max - otherCurrent - current, 0)
  return Math.min(reducedAmount, room)
}

/**
 * Apply a number of damage boxes to a token's actor health track.
 * Clamps at max - does not yet implement VtM5e's superficial-overflow-to-
 * aggravated rule (documented follow-up, not done in v0.1). Returns the
 * amount actually written (post-armor-reduction, post-max-clamp) - callers
 * that display a number to the player should use the return value, not the
 * raw `amount` they passed in, once armor is involved.
 *
 * options.reduceByArmor/options.armorPiercingAmmo default to false, so every
 * EXISTING caller (discipline-resistance.js, ward-tracking.js - supernatural/
 * poison/warding damage, none of which armor should block) is completely
 * unaffected by armor without any change on their end. Only weapon-attack
 * call sites opt in. armorPiercingAmmo (Armor-Piercing ammo - RAW "-2 Armor
 * Value", see computeAppliedDamage) only matters when reduceByArmor is also
 * true - it has no effect on callers that never asked for armor reduction
 * in the first place.
 */
export async function applyDamageToTarget(token, amount, damageType, options = {}) {
  const actor = token.actor
  if (!actor) return 0

  // Defy Bane conversion happens BEFORE armor/room math, and splits this
  // call into up to two independent sub-calls (each running the full logic
  // below on its own, including its own room-clamp) - simplest correct way
  // to hand off part of a hit to a different damage type without teaching
  // computeAppliedDamage's "how much lands" math about type-conversion at
  // all. consumeDefyBaneBudget writes the reduced budget BEFORE recursing,
  // so the second sub-call (still 'aggravated') sees the already-reduced
  // budget and won't convert again - safe from infinite recursion, and
  // correctly handles a hit bigger than the remaining budget. Known minor
  // imprecision when reduceByArmor is also true: the wear-tracking loop
  // below runs once per sub-call, so a split hit can wear armor slightly
  // more than one combined hit of the same total would - accepted rather
  // than restructuring wear-tracking for this narrow, rare combination
  // (Defy Bane + armored Aggravated damage).
  if (damageType === 'aggravated') {
    const budget = getDefyBaneBudget(actor)
    if (budget > 0) {
      const converted = Math.min(amount, budget)
      await consumeDefyBaneBudget(actor, converted)
      const remainingAggravated = amount - converted
      let total = 0
      if (converted > 0) total += await applyDamageToTarget(token, converted, 'superficial', options)
      if (remainingAggravated > 0) total += await applyDamageToTarget(token, remainingAggravated, 'aggravated', options)
      return total
    }
  }

  const { reduceByArmor = false, armorPiercingAmmo = false } = options
  const applied = computeAppliedDamage(actor, amount, damageType, options)

  // Wear tracking (repair.js's absorbArmorDamage) - each equipped layer
  // (Body Armor first, then whatever Underarmor is worn beneath it) takes
  // wear equal to the lesser of its OWN Armor Value and whatever's left of
  // the raw incoming hit once the layer(s) in front of it have taken their
  // share - regardless of whether the character's health track had room
  // left for the remainder (a hit fully stopped by armor still wears it
  // down exactly like a partially-stopped one would). Deliberately computed
  // off each layer's raw value, not the Armor-Piercing-reduced total below -
  // AP ammo defeats armor, it doesn't spare it, so a layer still takes full
  // wear trying (and partially failing) to stop an AP round.
  const armorLayers = reduceByArmor ? equippedArmorLayers(actor) : []
  let remainingForWear = amount
  for (const layer of armorLayers) {
    if (remainingForWear <= 0) break
    const layerAbsorbed = Math.min(effectiveArmorValue(layer), remainingForWear)
    if (layerAbsorbed > 0) await absorbArmorDamage(layer, layerAbsorbed)
    remainingForWear -= layerAbsorbed
  }

  let armorReduction = 0
  if (reduceByArmor) {
    armorReduction = armorLayers.reduce((sum, item) => sum + effectiveArmorValue(item), 0)
    if (armorPiercingAmmo) armorReduction = Math.max(armorReduction - 2, 0)
  }

  // Toughness can no longer be the sole cause of applied === 0 (its floor is
  // 1, per RAW - see computeAppliedDamage), so a full block here always
  // means armor (or the health track having no room left).
  if (applied <= 0) {
    if (armorReduction > 0 && amount - armorReduction <= 0) {
      ui.notifications.info(`${MODULE_ID} | ${actor.name}'s armor fully absorbs the hit.`)
    }
    return 0
  }

  const current = actor.system.health?.[damageType] ?? 0
  await actor.update({
    [`system.health.${damageType}`]: current + applied
  })

  ui.notifications.info(`${MODULE_ID} | Applied ${applied} ${damageType} damage to ${actor.name}`)
  return applied
}

// Willpower counterpart to applyDamageToTarget above - simpler (no armor/
// Toughness reduction, Willpower has no equivalent), moved here from the
// now-removed social-conflict.js since discipline-resistance.js also needs
// it independently of that feature.
export async function applyWillpowerDamageToTarget(token, amount, damageType) {
  const actor = token.actor
  if (!actor) return

  const current = actor.system.willpower?.[damageType] ?? 0
  const max = actor.system.willpower?.max ?? 0
  const otherType = damageType === 'superficial' ? 'aggravated' : 'superficial'
  const otherCurrent = actor.system.willpower?.[otherType] ?? 0

  const room = Math.max(max - otherCurrent - current, 0)
  const applied = Math.min(amount, room)

  if (applied <= 0) return

  await actor.update({
    [`system.willpower.${damageType}`]: current + applied
  })

  ui.notifications.info(`${MODULE_ID} | Applied ${applied} ${damageType} Willpower damage to ${actor.name}`)
}

function buildDamageButtons(successes) {
  const wrapper = document.createElement('div')
  wrapper.classList.add('vtm5e-automation-damage-row')
  wrapper.style.display = 'flex'
  wrapper.style.gap = '4px'
  wrapper.style.marginTop = '4px'

  const label = document.createElement('span')
  label.textContent = `Apply ${successes} damage:`
  label.style.alignSelf = 'center'
  label.style.fontSize = '0.85em'
  wrapper.appendChild(label)

  for (const type of ['superficial', 'aggravated']) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = type === 'superficial' ? 'Superficial' : 'Aggravated'
    button.dataset.damageType = type
    button.classList.add('vtm5e-automation-apply-damage')
    wrapper.appendChild(button)
  }

  return wrapper
}

function buildArmorEquippedSection(item) {
  const section = document.createElement('fieldset')
  section.classList.add('vtm5e-automation-magazine')

  const legend = document.createElement('legend')
  legend.textContent = 'Armor Reduction (vtm5e-automation)'
  section.appendChild(legend)

  const hint = document.createElement('p')
  hint.classList.add('hint')
  hint.textContent = 'Worn status is managed from the "Worn" button on the character sheet, not here (see equip.js) - Underarmor and Body Armor are separate slots that both contribute at once when worn together; two items in the same slot can\'t both be equipped.'
  section.appendChild(hint)

  const slotStatus = document.createElement('p')
  slotStatus.classList.add('hint')
  const currentSlot = equippedSlotFor(item)
  slotStatus.textContent = currentSlot ? `Currently worn: ${slotLabel('armor', currentSlot)}.` : 'Not currently worn.'
  section.appendChild(slotStatus)

  // Durability status (repair.js) - read-only here, same info the wrench
  // button's tooltip shows on the actor sheet, surfaced on the item sheet
  // too since that's where a GM/player is most likely already looking to
  // check on a specific piece of armor.
  const absorbed = armorDamageAbsorbedFor(item)
  const threshold = armorThresholdFor(item)
  const status = document.createElement('p')
  status.classList.add('hint')
  if (isUnrepairable(item) && isBroken(item)) {
    status.textContent = 'Broken beyond repair - no longer providing protection.'
  } else if (isBroken(item)) {
    status.textContent = `Broken - no longer providing protection until repaired (${repairAttemptsFor(item)}/${MAX_REPAIR_ATTEMPTS} repair attempts used).`
  } else {
    status.textContent = `Durability: ${absorbed}/${threshold} damage absorbed before it breaks.${isWorn(item) ? ' Worn (-1 effective Armor Value, patched too many times).' : ''}`
  }
  section.appendChild(status)

  return section
}

export function registerDamageApplication() {
  Hooks.on('renderArmorItemSheet', (app, html) => {
    const item = app.item
    if (!item) return
    if (html.querySelector('.vtm5e-automation-magazine')) return

    html.appendChild(buildArmorEquippedSection(item))
  })

  // Auto-apply damage on genuinely NEW messages only. createChatMessage
  // fires exactly once, at real creation time - unlike renderChatMessageHTML,
  // which also fires when Foundry replays historical messages on page load,
  // which would otherwise silently re-apply old damage on every reload.
  Hooks.on('createChatMessage', async (message) => {
    const roll = message.rolls?.[0]
    if (!roll || !roll.systemRoll) return

    const weapon = findWeaponForRoll(message, roll)
    if (!weapon) return

    const successes = roll.total
    if (successes <= 0) return

    // createChatMessage fires on every connected client when the roll syncs.
    // message.isOwner is true for BOTH the roll's author AND every GM (GMs
    // own everything), so with a player attacking and a GM also connected
    // this used to run on both clients - same double-fire class of bug
    // fixed in weapon-tags.js's ammo-consumption hook. Author-only, matching
    // that fix and opposing-roll-trigger.js's existing guard.
    if (message.author?.id !== game.user.id) return

    // Hollow-Point adds a flat +1 to whatever the roll already did - a
    // property of whatever's currently chambered (weapon-tags.js's
    // loadedAmmoType flag), not the roll itself, so it's read here rather
    // than baked into the attack roll. Armor-Piercing (-2 Armor Value, RAW,
    // Second Inquisition p.72) is checked the same way further down, when
    // armor reduction is applied.
    const ammoType = getLoadedAmmoType(weapon)
    const amount = successes + getAmmoDamageBonus(ammoType) + getFlatDamageBonus(weapon)
    const isArmorPiercingAmmo = ammoType === 'armorPiercing'

    const targets = Array.from(game.user.targets)

    for (const [index, token] of targets.entries()) {
      // opposing-roll-trigger.js only ever acts on the FIRST target (it can
      // only run one weapon-defense flow per attack) and owns damage
      // application entirely for it - applying damage directly here too
      // would double up (once now off raw successes, again once the
      // contest resolves off the actual margin). Any additional
      // simultaneous targets beyond the first were never covered by the
      // opposed flow, so they're handled directly here regardless.
      if (index === 0 && token.actor && getStepSetting('opposingRoll', token.actor) !== 'off') continue

      // Looked up per-target - a mix of NPC and player targets can land on
      // different actual behavior.
      const mode = token.actor ? getStepSetting('damageApplication', token.actor) : 'prompt'
      if (mode !== 'auto') continue

      // Auto mode defaults to superficial, EXCEPT a weapon tagged Sharp
      // (weapon-tags.js) forces Aggravated against a mortal target - the
      // one place wod5e's weapon schema does carry a damage-type signal
      // now that the tag exists. Vampire targets are unaffected either way
      // (Sharp's whole text is "deals Aggravated damage to mortals").
      const severity = (weapon.getFlag(MODULE_ID, 'weaponTags')?.sharp && token.actor?.system?.gamesystem !== 'vampire')
        ? 'aggravated'
        : 'superficial'
      // Relayed (performPrivilegedDamage) rather than a direct
      // applyDamageToTarget call - a player attacking a GM-only NPC target
      // directly (opposingRoll set to 'off' for it) has never had
      // permission to write to that actor's health track, same root cause
      // as the opposed-roll flow's equivalent fix in opposing-roll-trigger.js.
      await performPrivilegedDamage(token, amount, severity, { reduceByArmor: true, armorPiercingAmmo: isArmorPiercingAmmo })
    }
  })

  // Button UI for prompt mode - safe to re-run on every render/replay since
  // it only displays inert buttons, doesn't take any action on its own.
  Hooks.on('renderChatMessageHTML', (message, html) => {
    const roll = message.rolls?.[0]
    if (!roll || !roll.systemRoll) return

    const weapon = findWeaponForRoll(message, roll)
    if (!weapon) return

    const successes = roll.total
    if (successes <= 0) return

    const ammoType = getLoadedAmmoType(weapon)
    const amount = successes + getAmmoDamageBonus(ammoType) + getFlatDamageBonus(weapon)
    const isArmorPiercingAmmo = ammoType === 'armorPiercing'

    // Same per-target deferral/mode logic as the createChatMessage handler
    // above - only show buttons if at least one target actually needs one
    // (not deferred to opposing-roll-trigger.js, not already auto-applied).
    // With nothing targeted at all there's no per-target info to go on, so
    // fall back to showing the buttons (matches the old unconditional
    // behavior for that case).
    const targets = Array.from(game.user.targets)
    const needsPrompt = targets.length === 0 || targets.some((token, index) => {
      if (index === 0 && token.actor && getStepSetting('opposingRoll', token.actor) !== 'off') return false
      const mode = token.actor ? getStepSetting('damageApplication', token.actor) : 'prompt'
      return mode !== 'auto'
    })
    if (!needsPrompt) return

    const buttonRow = buildDamageButtons(amount)
    html.appendChild(buttonRow)

    buttonRow.querySelectorAll('.vtm5e-automation-apply-damage').forEach((button) => {
      button.addEventListener('click', async (event) => {
        const damageType = event.currentTarget.dataset.damageType
        const clickTargets = Array.from(game.user.targets)

        if (clickTargets.length === 0) {
          ui.notifications.warn(`${MODULE_ID} | No targets selected - target a token first`)
          return
        }

        for (const token of clickTargets) {
          // Same relay as the auto-apply hook above - whoever clicks this
          // button (a player) may not have permission over the target
          // (an NPC).
          await performPrivilegedDamage(token, amount, damageType, { reduceByArmor: true, armorPiercingAmmo: isArmorPiercingAmmo })
        }
      })
    })
  })
}
