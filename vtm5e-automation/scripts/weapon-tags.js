import { findWeaponForRoll, splitAdvancedDice } from './roll-utils.js'
import { applyStatusCondition } from './condition-application.js'
import { isBroken, isWorn, isUnrepairable, repairAttemptsFor, MAX_REPAIR_ATTEMPTS, repairWeapon } from './repair.js'
import { equippedSlotFor, slotLabel, slotIcon, openEquipMenu } from './equip.js'

const MODULE_ID = 'vtm5e-automation'
const EQUIPMENT_PACK_ID = 'vtm5e-equipment.equipment'

// The V5 Homebrew Wiki's weapon tag vocabulary (Sharei Faedrawolf's
// "More Versatile Weapons and Armor Stats"), extending the corebook's bare
// damage-tier table. Every tag gets a checkbox on the weapon's own sheet and
// its blurb auto-appended to the description, so the table always has a
// readable reference regardless of whether the tag drives any code -
// Silent, for instance, never will (no dice attached to it anywhere in the
// source material). Tags this file's roll-time logic actually acts on:
// fullAuto, twoHanded, unwieldy, balanced (+throwable) - see
// rollWeaponAttack. Reach is NOT in this checkbox list - unlike the others,
// the homebrew doc gives it a NUMBER on nearly every melee weapon (a dagger
// is Reach 0, a spear is Reach 4), not an on/off flag, so it gets its own
// numeric field (see buildWeaponTagsSection) and an automatic comparison
// against the target's equipped weapon instead of a toggle - see
// computeReachBonus. Cover/Defensive/Sharp/Fragile/Quick Draw/Concealed are
// documented follow-ups (opposing-roll-trigger.js, damage-application.js,
// and standalone macros respectively) - present here as flags/description
// text now so items can be fully tagged today even before each mechanic
// lands. Electrical and Blunt used to be here too - both removed
// (2026-07-22). Electrical's flat "-2 dice Impairment" was replaced by
// Taser (below), a real save-vs-damage-dealt stun mechanic (Second
// Inquisition p.71) rather than a flat dice penalty - see
// opposing-roll-trigger.js's applyOnHitTagEffects for the implementation.
// Blunt's "ignores armor entirely" was homebrew-original and meaningfully
// more powerful than anything RAW gives a melee weapon - Armor-Piercing
// ammo, an entire dedicated ammo type, only gets -2 Armor Value (see
// AMMO_TYPES below) - and its other clause ("+1 die to knockdown") never
// had anywhere to attach to begin with (no knockdown/shove action exists
// anywhere in wod5e). Jake's call: strip it rather than nerf it and leave a
// vestigial half-tag around.
const WEAPON_TAGS = {
  fullAuto: { label: 'Full Auto', blurb: '+2 dice to attack; empties the magazine in one turn; must reload.' },
  balanced: { label: 'Balanced', blurb: '+1 die to throwing actions.' },
  throwable: { label: 'Throwable', blurb: 'Dexterity + Athletics roll enables a ranged attack by throwing this weapon.' },
  twoHanded: { label: 'Two-Handed', blurb: 'Requires two hands; -2 dice pool if used one-handed.' },
  unwieldy: { label: 'Unwieldy', blurb: '-1 die from the melee attack pool.' },
  cover: { label: 'Cover', blurb: '+2 dice defending against ranged attacks.' },
  defensive: { label: 'Defensive', blurb: '+1 die defending in close combat.' },
  sharp: { label: 'Sharp', blurb: 'Deals Aggravated damage to mortals.' },
  fragile: { label: 'Fragile', blurb: 'On a fumble (the wielder rolls zero successes with it), the weapon goes Broken: -2 dice until repaired (Dexterity + Craft). Repairable up to 3 times total (successes and failures both count) - the 2nd repair leaves it permanently Worn (-1 dice); a 3rd attempt makes it Unrepairable for good.' },
  quickDraw: { label: 'Quick Draw', blurb: 'Reduces the readying penalty by one die.' },
  concealed: { label: 'Concealed', blurb: '+1 die hiding this weapon during a search.' },
  silent: { label: 'Silent', blurb: 'Produces minimal sound.' },
  brawl: { label: 'Brawl', blurb: 'Uses the Brawl skill.' },
  firearm: { label: 'Firearm', blurb: 'Uses the Firearms skill; loud unless Silent.' },
  protection: { label: 'Protection', blurb: "Negates the disadvantage from this weapon's Reach when defending." },
  taser: { label: 'Taser', blurb: "On a hit, target must roll Composure+Resolve and meet/beat the damage taken (halved, rounding up, for vampires) or be unable to act next turn. Second Inquisition p.71." },
  incendiary: { label: 'Incendiary', blurb: 'Deals Aggravated damage to every target, including vampires (fire), overriding Sharp\'s mortals-only rule. Second Inquisition p.70.' },
  flashbang: { label: 'Flash-bang', blurb: 'On a hit, target is Blinded (-3 dice, all pools) until a GM/player clears it. Simplification of Second Inquisition p.150 - no eye-protection resistance or self-blind-on-miss modeled.' },
  thermite: { label: 'Thermite', blurb: "On a hit, target is set ablaze (GM: 3 Aggravated damage/round for 3 rounds, very hard to extinguish - not automated, this module has no round tracker). Second Inquisition p.73." }
}

// Exact source strings used both when creating the temporary bonus AND when
// reading back which ones the player actually toggled on (see
// FULL_AUTO_LABEL's use in the createChatMessage hook below) - kept as
// constants specifically so the two places can never drift out of sync.
const FULL_AUTO_LABEL = 'Full Auto (+2, empties magazine)'
const ONE_HANDED_LABEL = 'Wielding One-Handed (-2)'
const UNWIELDY_LABEL = 'Unwieldy (-1)'
const REACH_ADVANTAGE_LABEL = 'Reach Advantage (+1)'
const BROKEN_LABEL = 'Broken (-2, needs repair)'
const WORN_LABEL = 'Worn (-1, patched too many times)'

// A condition-item bonus that's INCLUDED in wod5e's roll dialog (shown as a
// checkbox) but OFF by default, using the same mechanism wod5e's own
// "Add Modifier" item UI exposes (item-modifiers.js/modifier-display.hbs) -
// activeWhen.check: 'isPath' only sets isActive=true if `path` is literally
// present in the roll's selectors list, which this deliberately never is;
// displayWhenInactive: true is what still surfaces it as a togglable
// checkbox in situational-modifiers.hbs despite isActive staying false.
// Confirmed by reading situational-modifiers.js's filterModifiers - the
// exact logic every wod5e roll dialog already runs on _rollItem's own
// getSituationalModifiers call, so this needs no dialog of our own.
const OFF_BY_DEFAULT = { check: 'isPath', path: '__vtm5e-automation-never-matches__', value: '' }
const ALWAYS_ON = { check: 'always', path: '', value: '' }

// Full Auto empties the magazine regardless of how many rounds were left -
// without a floor, the optimal (degenerate) play is always waiting until
// the mag is nearly dry before going full auto, since it "wastes" almost
// nothing while still banking the +2 dice. Requiring at least half the
// weapon's own max (rounded up) keeps the cost proportional to the
// weapon's actual capacity instead of a flat number, so a 6-round revolver-
// style mag and a 30-round rifle mag both require a real commitment
// relative to their own size. Adjustable here if this threshold feels
// wrong at the table - it's a balance call, not a rule pulled from either
// the corebook or the homebrew doc, neither of which track ammo at all.
const FULL_AUTO_MIN_FRACTION = 0.5

// Fixed name so repeated rolls reuse (not duplicate) the same condition -
// applyStatusCondition's existing update-if-present behavior handles that.
// Cleaned up opportunistically on the NEXT weapon roll that completes for
// this actor (see the createChatMessage hook below) rather than tracked via
// an in-memory pending map - simpler, and self-healing even across a page
// reload or a cancelled wod5e roll dialog (which would otherwise leave a
// stray copy sitting around applying its bonus to unrelated future rolls
// sharing the same skill).
const TEMP_MODIFIER_CONDITION_NAME = 'Weapon Modifier (temporary)'

// Fixed vocabulary for the Caliber dropdown (weapon sheet AND magazine gear
// sheet) - a free-text field meant reloadWeapon's exact-string match was
// only ever one typo away from silently breaking (a weapon set to "9mm" and
// a magazine set to "9 mm" would just never match, with no error either
// side). Includes every caliber actually used in the vtm5e-equipment
// compendium plus a handful of common real-world calibers with no gun built
// for them yet, so new custom weapons/magazines have somewhere to go
// without inventing a new string. Values are the exact strings stored in
// the caliber flag - keep these in sync with configure-equipment-compendium.js
// if either list changes.
const CALIBER_OPTIONS = [
  { value: '', label: '(none / not ammo-tracked)' },
  { value: '.22LR', label: '.22LR' },
  { value: '.32ACP', label: '.32 ACP' },
  { value: '.380ACP', label: '.380 ACP' },
  { value: '9mm', label: '9mm' },
  { value: '.357Mag', label: '.357 Magnum' },
  { value: '12ga', label: '12 Gauge' },
  { value: '5.56mm', label: '5.56mm NATO' },
  { value: '7.62x39mm', label: '7.62x39mm' },
  // Not used by any compendium weapon yet - reserved for custom builds.
  { value: '.45ACP', label: '.45 ACP' },
  { value: '.40SW', label: '.40 S&W' },
  { value: '.44Mag', label: '.44 Magnum' },
  { value: '.308Win', label: '.308 Winchester' },
  // Single-purpose "caliber" for the Stake Launcher - not a real firearm
  // cartridge, but reusing the exact same caliber-match reload mechanism
  // (see reloadWeapon) is simpler than inventing a parallel system just for
  // one weapon.
  { value: 'stake', label: 'Wooden Stake' },
  // Same pattern, for the Second Inquisition gear pull (2026-07-22): Taser
  // darts and crossbow bolts aren't real ammo either, but need their own
  // caliber string so reloadWeapon can match them to their one weapon.
  { value: 'taserDart', label: 'Taser Dart' },
  { value: 'crossbowBolt', label: 'Crossbow Bolt' },
  { value: 'flareGun', label: 'Flare Gun Cartridge' }
]

// Shared by buildWeaponTagsSection and buildAmmoGearSection. If the item's
// current caliber value isn't in CALIBER_OPTIONS (an old typo'd value from
// before this became a dropdown, or a hand-set flag), it's added as its own
// selected option rather than silently discarded - re-saving the sheet
// without touching this field shouldn't change the item's data.
function buildCaliberSelect(currentValue) {
  const select = document.createElement('select')
  select.name = 'caliber'

  const knownValues = new Set(CALIBER_OPTIONS.map((o) => o.value))
  const options = knownValues.has(currentValue)
    ? CALIBER_OPTIONS
    : [...CALIBER_OPTIONS, { value: currentValue, label: `${currentValue} (unlisted)` }]

  for (const { value, label } of options) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    if (value === currentValue) option.selected = true
    select.appendChild(option)
  }

  return select
}

// Special ammo - a property of a specific Magazine item (see
// buildAmmoGearSection), unlike every other weapon-tags toggle, which is
// per-roll. Its mechanical effect has to persist across every shot fired
// from that magazine until the next reload, so it's read/applied by
// weapon-tags.js's own reload/salvage logic below AND by damage-application.js/
// opposing-roll-trigger.js at hit-resolution time (via getLoadedAmmoType/
// getAmmoDamageBonus, exported at the bottom of this section) - not by any
// roll-time dialog or situational modifier. Armor-Piercing and the
// Dragon's Breath/Wood on-hit conditions are read directly by key rather
// than through a generic "bonuses" list, since neither is a dice modifier.
const AMMO_TYPES = {
  '': { label: 'Standard', blurb: 'No special effect.' },
  hollowPoint: { label: 'Hollow-Point', blurb: '+1 damage on a hit.' },
  armorPiercing: { label: 'Armor-Piercing', blurb: "Reduces the target's equipped Armor Value by 2 (RAW, Second Inquisition p.72)." },
  dragonsBreath: { label: "Dragon's Breath", blurb: 'Incendiary shotgun shell - on a hit, sets the target Burning (-2 dice) until their next turn ends.' },
  wood: { label: 'Wood/Stake', blurb: 'On a hit against a vampire, risks Torpor (-3 dice) until the stake is removed. No effect on non-vampires.' },
  whitePhosphorus: { label: 'White Phosphorus', blurb: 'On a hit, -3 dice to all pools (simplified from vision-reliant pools only), until a GM/player clears it. Second Inquisition p.73 - Dominate eye-contact nullification/Presence resistance not modeled.' }
}

// Same pattern as buildCaliberSelect - fixed vocabulary, with an "unlisted"
// escape hatch for any pre-existing value that predates this dropdown.
function buildAmmoTypeSelect(currentValue) {
  const select = document.createElement('select')
  select.name = 'ammoType'

  const options = Object.entries(AMMO_TYPES).map(([value, def]) => ({ value, label: `${def.label} - ${def.blurb}` }))
  const knownValues = new Set(options.map((o) => o.value))
  const finalOptions = knownValues.has(currentValue ?? '')
    ? options
    : [...options, { value: currentValue, label: `${currentValue} (unlisted)` }]

  for (const { value, label } of finalOptions) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    if (value === (currentValue ?? '')) option.selected = true
    select.appendChild(option)
  }

  return select
}

// Read by damage-application.js and opposing-roll-trigger.js at hit-
// resolution time - one-directional import (weapon-tags.js never imports
// from either of those), so no circular-dependency risk.
export function getLoadedAmmoType(weapon) {
  return weapon?.getFlag(MODULE_ID, 'loadedAmmoType') || ''
}

export function getAmmoDamageBonus(ammoType) {
  return ammoType === 'hollowPoint' ? 1 : 0
}

// A flat per-hit damage bonus on the WEAPON itself, not its ammo - added for
// the Second Inquisition Vehicles/Drones pull (2026-07-22): crew-served/
// mounted weapons (CROWS .50 cal, helicopter guns, Predator Drone
// munitions) carry a fixed "Damage +X" the corebook's opposed-roll-margin
// model has nowhere else to put (Reach is the only other numeric-not-
// toggle weapon flag, same UI treatment below). Reads/adds exactly like
// getAmmoDamageBonus above, just from a different flag - see
// damage-application.js/opposing-roll-trigger.js for both call sites.
export function getFlatDamageBonus(weapon) {
  return weapon?.getFlag(MODULE_ID, 'flatDamageBonus') ?? 0
}

// Every wod5e actor sheet class that can own weapon items and uses the
// shared equipment.hbs partial (confirmed by reading wod5e-reference/system/
// actor/**) - Foundry's render hook name is derived from each concrete
// sheet's own class name, not a shared base, so every one needs its own
// registration rather than a single hook on a common ancestor.
export const WEAPON_ROLL_ACTOR_SHEET_HOOKS = [
  'renderVampireActorSheet',
  'renderGhoulActorSheet',
  'renderMortalActorSheet',
  'renderSPCActorSheet',
  'renderHunterActorSheet',
  'renderWerewolfActorSheet'
]

// Takes the whole item (not just its weaponTags flag) since Reach lives in
// its own separate numeric flag, not the tag checkbox list - see
// buildWeaponTagsSection.
function hasFunctionalTags(item) {
  const tags = item.getFlag(MODULE_ID, 'weaponTags') ?? {}
  const reachValue = item.getFlag(MODULE_ID, 'reachValue') ?? 0
  return !!(tags.fullAuto || tags.twoHanded || tags.unwieldy || (tags.balanced && tags.throwable) || reachValue > 0)
}

// Intercepts the native "roll this weapon" click (equipment.hbs's
// .rollable-item, data-action="rollItem", wired to wod5e's own _onRollItem
// in wod-actor-base.js) ONLY for weapons carrying a roll-time-functional
// tag - every other item's click is left completely untouched, native
// behavior all the way through. Items are resolved from actor.items (a
// synchronous, already-loaded collection) at RENDER time, not inside the
// click handler - deciding whether to intercept has to happen
// synchronously, before any await, or stopPropagation() fires too late to
// actually stop wod5e's own delegated handler from also running (an event
// listener's stopPropagation() call after an internal await has no effect,
// since the event has already finished dispatching by the time that await resolves).
function bindWeaponRollInterception(app, html) {
  const actor = app.actor
  if (!actor) return

  const rollableItems = html.querySelectorAll?.('.rollable-item[data-action="rollItem"]') ?? []
  rollableItems.forEach((element) => {
    const itemId = element.closest('[data-item-id]')?.dataset.itemId
    const item = itemId ? actor.items.get(itemId) : null
    if (!item || item.type !== 'weapon') return
    if (!hasFunctionalTags(item)) return

    if (element.dataset.vtm5eAutomationBound) return
    element.dataset.vtm5eAutomationBound = 'true'

    // Capture phase (the `true` third argument) so this runs BEFORE
    // Foundry's own delegated action-handling, which listens in the
    // default bubble phase.
    element.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      rollWeaponAttack(actor, item)
    }, true)
  })
}

// Intercepts the native "restore uses to max" button (data-action=
// "restoreItemUses") for ANY ammo-tracked ranged weapon, regardless of
// which (if any) weaponTags it carries - a free instant refill doesn't make
// sense once ammo is a tracked resource, so this reroutes to reloadWeapon
// (below), which requires a compatible Magazine item to actually be on
// hand. Manually typing a new number into the item sheet's own "Uses
// Remaining" field is deliberately left alone - this is personal
// automation for a trusted home table, not anti-cheat.
//
// Matched on data-action alone, NOT also requiring wod5e's stock
// .item-restore class (a real bug found 2026-07-24 - this project's own
// equipment.hbs renders the exact same button as class "cs-row-icon"
// instead, so the old .item-restore-qualified selector silently never
// matched on any player-facing Vampire/Ghoul/Mortal/Hunter/Werewolf sheet,
// only on SPC/NPC sheets that fall back to wod5e's stock template - the
// native handler ran unintercepted and refilled ammo for free on every
// real character sheet). bindEquipInterception/bindRepairInterception never
// had this problem since they anchor on the itemChat icon by data-action
// alone already, same fix applied here for consistency.
function bindReloadInterception(app, html) {
  const actor = app.actor
  if (!actor) return

  const restoreButtons = html.querySelectorAll?.('[data-action="restoreItemUses"]') ?? []
  restoreButtons.forEach((element) => {
    const itemId = element.closest('[data-item-id]')?.dataset.itemId
    const item = itemId ? actor.items.get(itemId) : null
    if (!item || item.type !== 'weapon') return
    if (item.system.weaponType !== 'ranged' || !item.system.uses?.enabled) return

    if (element.dataset.vtm5eAutomationBound) return
    element.dataset.vtm5eAutomationBound = 'true'

    element.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      reloadWeapon(actor, item)
    }, true)
  })
}

// Injects a "Worn" equip button on every weapon/armor row (see equip.js) -
// same itemChat anchor/remove-then-reinsert approach as bindRepairInterception
// below (registered right before it, so DOM order ends up Equip, then
// Repair-if-any, then itemChat). Icon reflects the CURRENT slot if worn
// (a hand-fist for a weapon in Hands, a shirt for Underarmor, a vest for
// Body Armor) at full opacity, or a dim default for that item type when
// not worn at all. Clicking opens equip.js's slot picker rather than a bare
// toggle - armor genuinely has two different slots to choose between.
function bindEquipInterception(app, html) {
  const actor = app.actor
  if (!actor) return

  const chatButtons = html.querySelectorAll?.('[data-action="itemChat"]') ?? []
  chatButtons.forEach((chatButton) => {
    const itemId = chatButton.closest('[data-item-id]')?.dataset.itemId
    const item = itemId ? actor.items.get(itemId) : null

    const existing = chatButton.previousElementSibling
    if (existing?.dataset?.action === 'vtm5eAutomationEquip') existing.remove()

    if (!item || (item.type !== 'weapon' && item.type !== 'armor')) return

    const currentSlot = equippedSlotFor(item)
    const icon = currentSlot ? slotIcon(item.type, currentSlot) : (item.type === 'weapon' ? 'fa-hand-fist' : 'fa-shirt')

    const button = document.createElement('a')
    button.className = chatButton.className || 'cs-row-icon'
    button.dataset.action = 'vtm5eAutomationEquip'
    button.style.opacity = currentSlot ? '1' : '0.4'
    button.title = currentSlot
      ? `${item.name} - Worn (${slotLabel(item.type, currentSlot)}). Click to change.`
      : `${item.name} - Not worn. Click to equip.`
    button.innerHTML = `<i class="fa-solid ${icon}"></i>`
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      openEquipMenu(actor, item)
    })
    chatButton.insertAdjacentElement('beforebegin', button)
  })
}

// Injects a Repair wrench button next to the standard row-action icons on
// any Broken weapon OR armor item (see repair.js - Fragile weapons and
// worn-down armor both use the same Broken/repair/wear-cap plumbing) -
// anchored on the always-present itemChat icon rather than the ammo-only
// restore/expend pair above it, since Fragile mostly lands on melee gear (a
// Vitae Basics bat/knife) with no uses.enabled at all. Rebuilds the button
// from scratch on every render (remove-then-reinsert) rather than tracking
// a bound/idempotency flag like the other row binders here - simpler, and
// correctly makes the button disappear the render after a successful
// repair with no extra bookkeeping. Actual class detection covers both this
// project's own equipment.hbs (.cs-row-icon) and wod5e's stock template
// (.item-control.item-restore) - SPC/NPC sheets that fall back to the stock
// template get the button too.
function bindRepairInterception(app, html) {
  const actor = app.actor
  if (!actor) return

  const chatButtons = html.querySelectorAll?.('[data-action="itemChat"]') ?? []
  chatButtons.forEach((chatButton) => {
    const itemId = chatButton.closest('[data-item-id]')?.dataset.itemId
    const item = itemId ? actor.items.get(itemId) : null

    const existing = chatButton.previousElementSibling
    if (existing?.dataset?.action === 'vtm5eAutomationRepair' || existing?.dataset?.vtm5eAutomationUnrepairable) existing.remove()

    if (!item || (item.type !== 'weapon' && item.type !== 'armor') || !isBroken(item)) return

    const penaltyNote = item.type === 'armor' ? 'no longer providing protection' : '-2 dice'

    // Out of repairs entirely - a static marker instead of the wrench, since
    // there's nothing left to click (repairWeapon itself also refuses once
    // isUnrepairable, this just keeps the row honest about why).
    if (isUnrepairable(item)) {
      const marker = document.createElement('span')
      marker.className = chatButton.className || 'cs-row-icon'
      marker.style.opacity = '0.5'
      marker.title = `${item.name} is Broken beyond repair (${penaltyNote}, permanent)`
      marker.innerHTML = '<i class="fa-solid fa-skull-crossbones"></i>'
      marker.dataset.vtm5eAutomationUnrepairable = 'true'
      chatButton.insertAdjacentElement('beforebegin', marker)
      return
    }

    const remaining = Math.max(MAX_REPAIR_ATTEMPTS - repairAttemptsFor(item), 0)
    const button = document.createElement('a')
    button.className = chatButton.className || 'cs-row-icon'
    button.dataset.action = 'vtm5eAutomationRepair'
    button.title = `Repair ${item.name} (${penaltyNote} - Dexterity + Craft, ${remaining} attempt${remaining === 1 ? '' : 's'} left)`
    button.innerHTML = '<i class="fa-solid fa-wrench"></i>'
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      repairWeapon(actor, item)
    })
    chatButton.insertAdjacentElement('beforebegin', button)
  })
}

// Same native "restore uses to max" interception as bindReloadInterception
// above, for gear items marked isMagazine (see buildAmmoGearSection) -
// since those now carry real Uses tracking too, they get the exact same
// native "(current/max)" display and restore/expend icons on their sheet
// row as a weapon does, for free. Left unrepurposed for isAmmoBox items
// deliberately - resetting a box to full for free is a minor, easily-caught
// abuse at a trusted home table, same "not anti-cheat" call already made
// for the item sheet's own manual Uses Remaining field.
function bindMagazineReloadInterception(app, html) {
  const actor = app.actor
  if (!actor) return

  const restoreButtons = html.querySelectorAll?.('[data-action="restoreItemUses"]') ?? []
  restoreButtons.forEach((element) => {
    const itemId = element.closest('[data-item-id]')?.dataset.itemId
    const item = itemId ? actor.items.get(itemId) : null
    if (!item || item.type !== 'gear' || !item.getFlag(MODULE_ID, 'isMagazine')) return

    if (element.dataset.vtm5eAutomationMagazineBound) return
    element.dataset.vtm5eAutomationMagazineBound = 'true'

    element.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      reloadMagazineFromAmmoBox(actor, item)
    }, true)
  })
}

export function registerWeaponTags() {
  Hooks.on('renderWeaponItemSheet', (app, html) => {
    const item = app.item
    if (!item) return
    if (html.querySelector('.vtm5e-automation-weapon-tags')) return

    html.appendChild(buildWeaponTagsSection(item))
  })

  // Magazine/Boxed Ammo gear items - see buildAmmoGearSection and reloadWeapon.
  Hooks.on('renderGearItemSheet', (app, html) => {
    const item = app.item
    if (!item) return
    if (html.querySelector('.vtm5e-automation-magazine')) return

    html.appendChild(buildAmmoGearSection(item))
  })

  for (const hookName of WEAPON_ROLL_ACTOR_SHEET_HOOKS) {
    Hooks.on(hookName, bindWeaponRollInterception)
    Hooks.on(hookName, bindReloadInterception)
    Hooks.on(hookName, bindEquipInterception)
    Hooks.on(hookName, bindRepairInterception)
    Hooks.on(hookName, bindMagazineReloadInterception)
  }

  // Ammo consumption + temp-condition cleanup, reacting to the roll
  // rollWeaponAttack (below) actually produced - reuses findWeaponForRoll,
  // the same weapon-roll detector opposing-roll-trigger.js and
  // damage-application.js already rely on. Whether Full Auto actually got
  // toggled on is read back off the completed roll itself
  // (roll.options.activeModifiers, populated by wod5e's own dialog from
  // whichever .mod-checkbox elements were checked - see system-rolls.js)
  // rather than anything we tracked ourselves, so this works identically
  // regardless of which client's dialog produced the roll.
  Hooks.on('createChatMessage', async (message) => {
    const roll = message.rolls?.[0]
    if (!roll || !roll.systemRoll) return

    const weapon = findWeaponForRoll(message, roll)
    if (!weapon) return

    const actor = message.speakerActor
    if (!actor) return

    // createChatMessage fires on every connected client when the roll syncs
    // - without this, both the attacking player's client (who owns their own
    // weapon item) AND the GM's client (who has permission on everything)
    // independently ran this same decrement, consuming 2 rounds per shot.
    // Same guard opposing-roll-trigger.js already uses for the identical
    // reason (opposing-roll-trigger.js:67) - this hook was just missing it.
    if (message.author?.id !== game.user.id) return

    const staleCondition = actor.items.find((i) => i.type === 'condition' && i.name === TEMP_MODIFIER_CONDITION_NAME)
    if (staleCondition) await actor.deleteEmbeddedDocuments('Item', [staleCondition.id]).catch(() => {})

    const activeModifierLabels = (roll.options?.activeModifiers ?? []).map((m) => m.label)
    const usedFullAuto = activeModifierLabels.includes(FULL_AUTO_LABEL)

    if (usedFullAuto) {
      if (weapon.system.uses?.enabled) await weapon.update({ 'system.uses.current': 0 })
      return
    }

    // Generic ammo consumption - any ranged weapon with tracking enabled
    // loses 1 use per attack roll, unless the block above already drained
    // it to 0 via Full Auto.
    if (weapon.system.weaponType === 'ranged' && weapon.system.uses?.enabled) {
      const current = weapon.system.uses.current ?? 0
      if (current > 0) await weapon.update({ 'system.uses.current': current - 1 })
    }
  })
}

/**
 * Shared entry point for rolling a weapon - both the native character sheet
 * interception and the Argon HUD's weapon button call this instead of
 * reaching into wod5e's _rollItem directly, so both behave identically.
 * Weapons with none of the roll-time-functional tags pass straight through
 * to _rollItem completely unmodified.
 *
 * Full Auto/Two-Handed/Unwieldy need no dialog of our own at all - they
 * become temporary, togglable situational-modifier entries wod5e's own
 * roll dialog already knows how to surface as checkboxes ("Selectable
 * Modifiers"), so the player picks them right there alongside Hunger dice
 * and Difficulty, exactly like a native bonus. Only Balanced+Throwable
 * needs an upfront question, since throwing rolls an entirely different
 * pool (Dexterity + Athletics) that a situational modifier can't express -
 * a modifier can only adjust dice on whatever pool's already being rolled,
 * not swap which Attribute/Skill get queried.
 */
export async function rollWeaponAttack(actor, item) {
  if (!actor || !item) return

  // Out of ammo blocks the attack entirely rather than silently doing
  // nothing - Throwable is exempt (thrown attacks don't touch the
  // magazine at all), checked further down once we know the attack mode.
  const isRangedTracked = item.system.weaponType === 'ranged' && item.system.uses?.enabled
  const isEmpty = isRangedTracked && (item.system.uses.current ?? 0) <= 0

  const tags = item.getFlag(MODULE_ID, 'weaponTags') ?? {}
  const isThrowable = !!tags.balanced && !!tags.throwable

  if (isThrowable) {
    const mode = await confirmAttackMode(item)
    if (!mode) return
    if (mode === 'thrown') {
      await rollThrown(actor, item, 1)
      return
    }
  }

  if (isEmpty) {
    ui.notifications.warn(`${MODULE_ID} | ${item.name} is out of ammo - reload before firing.`)
    return
  }

  const selector = getWeaponSkillSelector(item)
  const bonusEntries = []
  // Full Auto is only offered as an option at all once there's a
  // meaningful amount of ammo to burn - see FULL_AUTO_MIN_FRACTION above.
  // Untracked weapons (uses.enabled false, e.g. a GM not bothering with an
  // NPC mook's ammo) skip this gate entirely since there's nothing to check.
  const meetsFullAutoMinimum = !isRangedTracked ||
    item.system.uses.current >= Math.max(1, Math.ceil((item.system.uses.max ?? 0) * FULL_AUTO_MIN_FRACTION))
  if (tags.fullAuto && meetsFullAutoMinimum) bonusEntries.push({ source: FULL_AUTO_LABEL, value: '2', displayWhenInactive: true, activeWhen: OFF_BY_DEFAULT })
  // Auto-derived from equip state (2026-07-28) rather than a manually-toggled
  // checkbox - a Two-Handed weapon only avoids the penalty when it's
  // actually equipped in Both Hands (equip.js's slotOptionsFor only ever
  // offers handBoth for a Two-Handed item in the first place, so any other
  // state - one hand, or not equipped at all - means it's being used wrong).
  if (tags.twoHanded && equippedSlotFor(item) !== 'handBoth') bonusEntries.push({ source: ONE_HANDED_LABEL, value: '-2', displayWhenInactive: true, activeWhen: ALWAYS_ON })
  if (tags.unwieldy) bonusEntries.push({ source: UNWIELDY_LABEL, value: '-1', displayWhenInactive: true, activeWhen: ALWAYS_ON })
  if (isBroken(item)) bonusEntries.push({ source: BROKEN_LABEL, value: '-2', displayWhenInactive: true, activeWhen: ALWAYS_ON })
  if (isWorn(item)) bonusEntries.push({ source: WORN_LABEL, value: '-1', displayWhenInactive: true, activeWhen: ALWAYS_ON })

  const reachBonus = await computeReachBonus(item)
  if (reachBonus) bonusEntries.push(reachBonus)

  // Merged with (not replacing) any bonuses already on the temp condition -
  // readyWeapon (below) can leave a readying penalty sitting there from
  // earlier this turn, and applyStatusCondition's update path overwrites
  // system.bonuses wholesale. Without this merge, rolling Full Auto after
  // readying the same weapon would silently wipe the readying penalty
  // instead of stacking with it.
  const existingCondition = actor.items.find((i) => i.type === 'condition' && i.name === TEMP_MODIFIER_CONDITION_NAME)
  const existingBonuses = existingCondition?.system?.bonuses ?? []
  const newBonuses = bonusEntries.map((entry) => ({ ...entry, paths: selector ? [selector] : ['all'] }))

  if (existingBonuses.length > 0 || newBonuses.length > 0) {
    await applyStatusCondition(actor, {
      name: TEMP_MODIFIER_CONDITION_NAME,
      note: '<p><em>Auto-managed by vtm5e-automation - clears itself the moment your next weapon roll completes. Safe to delete by hand if it ever lingers.</em></p>',
      bonuses: [...existingBonuses, ...newBonuses]
    })
  }

  const { _rollItem } = await import('/systems/wod5e/system/actor/scripts/item-roll.js')
  await _rollItem(actor, item)
}

/**
 * "Ready Weapon" minor action (corebook: minor actions subtract dice from
 * your main action this turn - no fixed number given, since it's left to
 * Storyteller judgment). -2 dice baseline, reduced to -1 if the weapon has
 * the Quick Draw tag ("reduces the readying penalty by one die"), scoped to
 * the weapon's own Skill selector - in practice, the next thing you roll
 * after readying a weapon is almost always attacking with that exact
 * weapon, so this doesn't try to generically penalize "whatever your next
 * roll turns out to be." Reuses weapon-tags.js's own temp-condition
 * mechanism (merges with rollWeaponAttack via the same TEMP_MODIFIER_CONDITION_NAME
 * condition, cleaned up by the same reactive hook) rather than a separate
 * system - exported for reload-weapon-macro.js's sibling,
 * ready-weapon-macro.js, to call as a real hotbar action.
 */
export async function readyWeapon(actor, weaponItem) {
  if (!actor || !weaponItem) return

  const tags = weaponItem.getFlag(MODULE_ID, 'weaponTags') ?? {}
  const penalty = tags.quickDraw ? -1 : -2
  const selector = getWeaponSkillSelector(weaponItem)

  const existingCondition = actor.items.find((i) => i.type === 'condition' && i.name === TEMP_MODIFIER_CONDITION_NAME)
  const existingBonuses = existingCondition?.system?.bonuses ?? []

  await applyStatusCondition(actor, {
    name: TEMP_MODIFIER_CONDITION_NAME,
    note: '<p><em>Auto-managed by vtm5e-automation - clears itself the moment your next weapon roll completes. Safe to delete by hand if it ever lingers.</em></p>',
    bonuses: [
      ...existingBonuses,
      {
        source: `Readying ${weaponItem.name} (${penalty})`,
        value: String(penalty),
        paths: selector ? [selector] : ['all'],
        displayWhenInactive: false,
        activeWhen: { check: 'always', path: '', value: '' }
      }
    ]
  })

  ui.notifications.info(`${MODULE_ID} | ${actor.name} readies ${weaponItem.name} - ${Math.abs(penalty)} dice penalty on their next roll with it.`)
}

/**
 * Salvages whatever's currently chambered in weaponItem into a brand-new
 * Magazine gear item instead of letting reloadWeapon/unloadWeapon silently
 * discard it - this is what makes "reload early" and "switch ammo type"
 * safe to do at all. Shared by reloadWeapon (called automatically, before
 * loading the new magazine) and unloadWeapon (the whole of its job) - the
 * latter already refuses to run at all when the weapon reads 0 rounds (its
 * own "already empty" guard, before this is ever reached), so this
 * function itself only needs to worry about reloadWeapon's case.
 *
 * Runs even when the weapon is already empty (Uses.current 0) - Jake's
 * call, 2026-07-25: reloading a dry gun should still drop the spent
 * magazine into inventory at 0/max, not make it vanish, so there's
 * something sitting there ready to hand to reloadMagazineFromAmmoBox
 * (which happily tops a 0/max magazine up to full exactly like any other
 * partial one - no special-casing needed on that end).
 *
 * The created item's Uses.max is the weapon's CURRENT uses.max (its rated
 * capacity, which itself now tracks whichever magazine was last loaded -
 * see reloadWeapon) rather than the leftover count itself - this is what
 * was actually broken before 2026-07-25: a leftover magazine used to lose
 * track of its own true rated capacity entirely (it only remembered how
 * many rounds were left, not how many it could hold), so topping it back up
 * via reloadMagazineFromAmmoBox had nothing correct to top up TO. Now
 * Uses.current is the leftover count and Uses.max is preserved correctly,
 * so "restore uses on this leftover magazine" means exactly what it says.
 */
async function salvageLoadedAmmo(actor, weaponItem) {
  const ratedMax = weaponItem.system.uses?.max ?? 0
  if (ratedMax <= 0) return

  const leftover = weaponItem.system.uses?.current ?? 0
  const caliber = weaponItem.getFlag(MODULE_ID, 'caliber') ?? ''
  const ammoType = getLoadedAmmoType(weaponItem)
  const ammoLabel = ammoType ? `, ${AMMO_TYPES[ammoType]?.label ?? ammoType}` : ''
  const roundsLabel = leftover <= 0 ? 'empty' : `${leftover}/${ratedMax} rounds`

  await Item.createDocuments([{
    name: `${caliber || weaponItem.name} Magazine (leftover, ${roundsLabel}${ammoLabel})`,
    type: 'gear',
    img: 'icons/svg/chest.svg',
    system: {
      description: `<p>Salvaged from ${weaponItem.name} before it was reloaded/unloaded - ${leftover} of ${ratedMax} round(s) remaining.</p>`,
      quantity: 1,
      uses: { current: leftover, max: ratedMax, enabled: true }
    },
    flags: {
      [MODULE_ID]: { caliber, ammoType, isMagazine: true }
    }
  }], { parent: actor })
}

/**
 * Reloads a weapon by consuming one compatible Magazine gear item (see
 * buildAmmoGearSection) - matched to the weapon by its Caliber flag,
 * exactly (empty caliber on both sides still counts as a match, so this
 * works even for a table that never bothers setting it, as long as
 * there's only ever one magazine type in play). Sets BOTH the weapon's
 * uses.current AND uses.max to the loaded magazine's own capacity - so a
 * weapon's effective capacity now follows whichever magazine is actually
 * loaded rather than a fixed factory number (Jake's call, 2026-07-25: real
 * 9mm mags interchange across guns of the same caliber, and this is what
 * makes a black-market extended magazine actually do something - loading a
 * 33rd extended mag into a Glock 19 now really gives it 33 rounds until the
 * next reload swaps in something else). No cap against the weapon's
 * "factory" max is tracked anywhere - there's no gameplay need to remember
 * it, since the next reload with a standard mag naturally reverts uses.max
 * right back down. This also feeds Full Auto's FULL_AUTO_MIN_FRACTION gate
 * for free, since that reads uses.max live at roll time - a bigger loaded
 * mag correctly raises the "commit at least half your rounds" threshold
 * along with it, no separate interaction to build.
 *
 * Called both by the intercepted native "restore uses" button
 * (bindReloadInterception above) and the standalone reload-weapon-macro.js
 * script for a true hotbar button - exported via the module API for exactly
 * that macro to call without needing its own copy of this logic.
 *
 * Always salvages whatever's currently chambered FIRST (see
 * salvageLoadedAmmo) - this is deliberate, not just a safety net: it means
 * "reload early" and "swap to a different ammo type" are the same action
 * as an ordinary reload, no separate UI needed. Also sets the weapon's
 * loadedAmmoType flag from whichever magazine gets chosen, which is what
 * damage-application.js/opposing-roll-trigger.js read at hit-resolution
 * time - see getLoadedAmmoType above.
 */
export async function reloadWeapon(actor, weaponItem) {
  if (!actor || !weaponItem) return

  if (!weaponItem.system.uses?.enabled) {
    ui.notifications.warn(`${MODULE_ID} | ${weaponItem.name} doesn't track ammo - nothing to reload.`)
    return
  }

  const caliber = weaponItem.getFlag(MODULE_ID, 'caliber') ?? ''
  const compatibleMagazines = actor.items.filter((i) => {
    if (i.type !== 'gear' || !i.getFlag(MODULE_ID, 'isMagazine')) return false
    if (!i.system.uses?.enabled || (i.system.uses.current ?? 0) <= 0) return false
    const magazineCaliber = i.getFlag(MODULE_ID, 'caliber') ?? ''
    return magazineCaliber === caliber && (i.system.quantity ?? 0) > 0
  })

  if (compatibleMagazines.length === 0) {
    ui.notifications.warn(`${MODULE_ID} | No spare ${caliber || 'compatible'} magazines with rounds in them for ${weaponItem.name} - out of ammo.`)
    return
  }

  let chosenMagazine = compatibleMagazines[0]
  if (compatibleMagazines.length > 1) {
    const options = compatibleMagazines
      .map((m) => {
        const ammoType = m.getFlag(MODULE_ID, 'ammoType')
        const ammoLabel = ammoType ? `, ${AMMO_TYPES[ammoType]?.label ?? ammoType}` : ''
        return `<option value="${m.id}">${m.name} (${m.system.uses.current}/${m.system.uses.max}, x${m.system.quantity}${ammoLabel})</option>`
      })
      .join('')
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: `Reload ${weaponItem.name}` },
      content: `
        <form class="vtm5e-automation-reload-dialog">
          <div class="form-group">
            <label>Which magazine?</label>
            <select name="magazineId">${options}</select>
          </div>
        </form>
      `,
      ok: { icon: 'fas fa-check', label: 'Reload' },
      buttons: [{ action: 'cancel', icon: 'fas fa-times', label: 'Cancel' }],
      classes: ['wod5e']
    })
    if (!result || result === 'cancel') return
    chosenMagazine = actor.items.get(result.magazineId)
    if (!chosenMagazine) return
  }

  const previousMax = weaponItem.system.uses.max ?? 0
  const loadedRounds = chosenMagazine.system.uses.current
  const ratedMax = chosenMagazine.system.uses.max
  const ammoType = chosenMagazine.getFlag(MODULE_ID, 'ammoType') ?? ''

  await salvageLoadedAmmo(actor, weaponItem)

  await weaponItem.update({
    'system.uses.current': loadedRounds,
    'system.uses.max': ratedMax,
    [`flags.${MODULE_ID}.loadedAmmoType`]: ammoType
  })

  // Consuming the chosen magazine: a stack of more than one is always
  // identical, full spares (a partial/leftover one is always its own
  // singleton - see salvageLoadedAmmo), so just peel one off the stack.
  // Deletes outright once the stack hits zero rather than leaving a
  // lingering "x0" row behind, which also keeps the sheet's inventory
  // honest for the "how many of this do I have" display.
  const remainingQuantity = (chosenMagazine.system.quantity ?? 1) - 1
  if (remainingQuantity > 0) {
    await chosenMagazine.update({ 'system.quantity': remainingQuantity })
  } else {
    await actor.deleteEmbeddedDocuments('Item', [chosenMagazine.id]).catch(() => {})
  }

  const ammoNote = ammoType ? ` (${AMMO_TYPES[ammoType]?.label ?? ammoType})` : ''
  const capacityNote = ratedMax > previousMax
    ? ' - extended capacity!'
    : ratedMax < previousMax ? ' - reduced capacity' : ''
  ui.notifications.info(`${MODULE_ID} | Reloaded ${weaponItem.name} with ${chosenMagazine.name} (${loadedRounds}/${ratedMax})${ammoNote}${capacityNote}.`)
}

/**
 * Takes the current magazine out without loading a new one - the narrower
 * counterpart to reloadWeapon's automatic salvage, for storing a weapon
 * safely or banking ammo without immediately re-arming. Shares
 * salvageLoadedAmmo with reloadWeapon rather than duplicating it.
 */
export async function unloadWeapon(actor, weaponItem) {
  if (!actor || !weaponItem) return

  if (!weaponItem.system.uses?.enabled) {
    ui.notifications.warn(`${MODULE_ID} | ${weaponItem.name} doesn't track ammo - nothing to unload.`)
    return
  }

  if ((weaponItem.system.uses.current ?? 0) <= 0) {
    ui.notifications.warn(`${MODULE_ID} | ${weaponItem.name} is already empty.`)
    return
  }

  await salvageLoadedAmmo(actor, weaponItem)
  await weaponItem.update({
    'system.uses.current': 0,
    [`flags.${MODULE_ID}.loadedAmmoType`]: ''
  })

  ui.notifications.info(`${MODULE_ID} | Unloaded ${weaponItem.name}.`)
}

/**
 * Restocks a spare Magazine gear item from a matching-caliber boxed-ammo
 * item (see configure-equipment-compendium.js's boxedAmmo() and
 * buildAmmoGearSection) - the bulk-ammo counterpart to reloadWeapon, and
 * what actually backs the native "restore uses" icon on a magazine's own
 * row now (see bindMagazineReloadInterception). Matched by caliber exactly,
 * same as reloadWeapon. Two different things can happen depending on the
 * target magazine's own current fill state - this is the fix for the real
 * bug found 2026-07-25 where a partial/leftover magazine had no correct way
 * to be topped back up at all (see salvageLoadedAmmo's rewrite note):
 *
 *  - NOT already full (a leftover/partial magazine, Uses.current < Uses.max):
 *    tops IT UP to its own rated max, consuming only the shortfall in
 *    rounds from the box - e.g. a 7/15 leftover only costs 8 rounds to
 *    refill, not a full 15.
 *  - Already full (an ordinary spare, possibly one of several identical
 *    ones stacked via Quantity): manufactures one MORE full spare onto the
 *    stack (Quantity+1), consuming a full Uses.max rounds from the box -
 *    this is the original "buy loose ammo, gain a loaded spare" use case.
 *
 * Boxed ammo items never stack via Quantity (each purchase/find is its own
 * item, always Quantity 1 - see boxedAmmo() in configure-equipment-
 * compendium.js) so consuming from one is just a straight Uses.current
 * decrement, deleting the item outright once it hits zero.
 */
/**
 * Called after a leftover/partial magazine gets topped back up to full via
 * reloadMagazineFromAmmoBox - a full magazine with no distinguishing state
 * left (Uses.current === Uses.max) shouldn't linger as its own oddly-named
 * "(leftover, X/Y rounds)" row forever once it's indistinguishable from any
 * other spare of the same product (Jake's call, 2026-07-25). Matches by
 * caliber + rated capacity + ammo type, NOT by name - two ways this resolves:
 *
 *  - Another full magazine matching those three already sits on the actor
 *    (an ordinary shop-bought spare, or an earlier leftover that already
 *    went through this same process): merge straight into it (add this
 *    item's Quantity onto that one's) and delete this one - genuine
 *    stacking, not just a shared label.
 *  - No local match: look up the vtm5e-equipment compendium for a real
 *    catalog item with the same caliber/capacity/ammo type and rename this
 *    item to match it exactly, so a FUTURE shop purchase of the same
 *    product (or another leftover reaching full later) stacks with it too.
 *  - Neither: falls back to a generic "<Caliber> Magazine (<max>rd)" name -
 *    still readable and still catches future matches against itself, just
 *    not guaranteed to match the shop's exact wording for a homebrew/one-off
 *    caliber with no catalog entry.
 *
 * Returns a short description of what happened, purely for the caller's
 * notification text - reloadMagazineFromAmmoBox calls this AFTER setting
 * Uses.current to max, so by the time this runs the item genuinely is full.
 */
async function consolidateFullMagazine(actor, magazineItem) {
  const ratedMax = magazineItem.system.uses?.max ?? 0
  const caliber = magazineItem.getFlag(MODULE_ID, 'caliber') ?? ''
  const ammoType = magazineItem.getFlag(MODULE_ID, 'ammoType') ?? ''

  const isSameProduct = (i) => {
    if (i.type !== 'gear' || i.id === magazineItem.id) return false
    if (!i.getFlag(MODULE_ID, 'isMagazine')) return false
    if ((i.getFlag(MODULE_ID, 'caliber') ?? '') !== caliber) return false
    if ((i.getFlag(MODULE_ID, 'ammoType') ?? '') !== ammoType) return false
    return i.system.uses?.max === ratedMax
  }

  const existingStack = actor.items.find((i) => isSameProduct(i) && i.system.uses?.current === i.system.uses?.max)
  if (existingStack) {
    const mergedQuantity = (existingStack.system.quantity ?? 1) + (magazineItem.system.quantity ?? 1)
    await existingStack.update({ 'system.quantity': mergedQuantity })
    await actor.deleteEmbeddedDocuments('Item', [magazineItem.id]).catch(() => {})
    return `merged into the existing ${existingStack.name} stack (now x${mergedQuantity})`
  }

  const pack = game.packs.get(EQUIPMENT_PACK_ID)
  const catalogDocs = pack ? await pack.getDocuments() : []
  const catalogMatch = catalogDocs.find((d) => {
    if (d.type !== 'gear' || !d.getFlag(MODULE_ID, 'isMagazine')) return false
    if ((d.getFlag(MODULE_ID, 'caliber') ?? '') !== caliber) return false
    if ((d.getFlag(MODULE_ID, 'ammoType') ?? '') !== ammoType) return false
    return d.system.uses?.max === ratedMax
  })

  const fallbackName = ammoType
    ? `${caliber || 'Unknown'} ${AMMO_TYPES[ammoType]?.label ?? ammoType} Magazine (${ratedMax}rd)`
    : `${caliber || 'Unknown'} Magazine (${ratedMax}rd)`
  const finalName = catalogMatch?.name ?? fallbackName

  await magazineItem.update({ name: finalName })
  return `renamed to ${finalName}`
}

export async function reloadMagazineFromAmmoBox(actor, magazineItem) {
  if (!actor || !magazineItem) return

  const ratedMax = magazineItem.system.uses?.max ?? 0
  if (!magazineItem.system.uses?.enabled || !ratedMax) {
    ui.notifications.warn(`${MODULE_ID} | ${magazineItem.name} isn't set up as a magazine (no Max Rounds set) - nothing to restock.`)
    return
  }

  const currentFill = magazineItem.system.uses?.current ?? 0
  const roundsNeeded = currentFill < ratedMax ? ratedMax - currentFill : ratedMax
  const topsUpExisting = currentFill < ratedMax

  const caliber = magazineItem.getFlag(MODULE_ID, 'caliber') ?? ''
  const compatibleBoxes = actor.items.filter((i) => {
    if (i.type !== 'gear' || !i.getFlag(MODULE_ID, 'isAmmoBox')) return false
    const boxCaliber = i.getFlag(MODULE_ID, 'caliber') ?? ''
    if (boxCaliber !== caliber) return false
    return (i.system.uses?.current ?? 0) >= roundsNeeded
  })

  if (compatibleBoxes.length === 0) {
    ui.notifications.warn(`${MODULE_ID} | No boxed ${caliber || 'compatible'} ammo on hand with enough rounds to restock ${magazineItem.name} (${roundsNeeded} needed).`)
    return
  }

  let chosenBox = compatibleBoxes[0]
  if (compatibleBoxes.length > 1) {
    const options = compatibleBoxes
      .map((b) => `<option value="${b.id}">${b.name} (${b.system.uses.current}/${b.system.uses.max} rounds)</option>`)
      .join('')
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: `Restock ${magazineItem.name}` },
      content: `
        <form class="vtm5e-automation-ammo-box-dialog">
          <div class="form-group">
            <label>Which boxed ammo?</label>
            <select name="boxId">${options}</select>
          </div>
        </form>
      `,
      ok: { icon: 'fas fa-check', label: 'Open Box' },
      buttons: [{ action: 'cancel', icon: 'fas fa-times', label: 'Cancel' }],
      classes: ['wod5e']
    })
    if (!result || result === 'cancel') return
    chosenBox = actor.items.get(result.boxId)
    if (!chosenBox) return
  }

  const remainingBoxRounds = (chosenBox.system.uses.current ?? 0) - roundsNeeded
  if (remainingBoxRounds > 0) {
    await chosenBox.update({ 'system.uses.current': remainingBoxRounds })
  } else {
    await actor.deleteEmbeddedDocuments('Item', [chosenBox.id]).catch(() => {})
  }

  if (topsUpExisting) {
    const toppedOffName = magazineItem.name
    const boxName = chosenBox.name
    await magazineItem.update({ 'system.uses.current': ratedMax })
    const consolidation = await consolidateFullMagazine(actor, magazineItem)
    ui.notifications.info(`${MODULE_ID} | Topped off ${toppedOffName} from ${boxName} (now ${ratedMax}/${ratedMax}) - ${consolidation}.`)
  } else {
    const newQuantity = (magazineItem.system.quantity ?? 1) + 1
    await magazineItem.update({ 'system.quantity': newQuantity })
    ui.notifications.info(`${MODULE_ID} | Loaded a new spare ${magazineItem.name} from ${chosenBox.name} (now x${newQuantity}).`)
  }
}

async function confirmAttackMode(item) {
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `${item.name}: Attack Mode` },
    content: `<p>Attack with <b>${item.name}</b> normally, or throw it (+1 die, Dexterity + Athletics)?</p>`,
    buttons: [
      { action: 'normal', icon: 'fas fa-hand-fist', label: 'Attack Normally', default: true, callback: () => 'normal' },
      { action: 'thrown', icon: 'fas fa-person-throwing', label: 'Throw It', callback: () => 'thrown' },
      { action: 'cancel', icon: 'fas fa-times', label: 'Cancel', callback: () => null }
    ],
    classes: ['wod5e']
  })

  return result === 'cancel' ? null : result
}

/**
 * Automatic Reach comparison - no dialog, no toggle, per Jake's own call
 * (unlike every other functional tag, Reach is a number to compare, not a
 * yes/no choice). Requires a target selected; falls back to no bonus if
 * there isn't one, or if the target's active weapon can't be resolved
 * (no HUD weapon-set data, nothing equipped, etc). Reuses the exact same
 * enhancedcombathud.weaponSets/activeWeaponSet flags weapons-panel.js's
 * getActiveSetWeapons already reads (enhancedcombathud-wod5e module) -
 * that's the only place "what is this actor currently wielding" is tracked
 * at all in this setup, so Reach can't be computed for a target who's never
 * touched the HUD's weapon-set UI.
 */
async function computeReachBonus(item) {
  const attackerReach = item.getFlag(MODULE_ID, 'reachValue') ?? 0
  if (attackerReach <= 0) return null

  const targetActor = Array.from(game.user.targets)[0]?.actor
  if (!targetActor) return null

  const defenderWeapons = await resolveActiveWeapons(targetActor)
  if (defenderWeapons.length === 0) return null

  const defenderBestReach = Math.max(
    ...defenderWeapons.map((w) => w.getFlag(MODULE_ID, 'reachValue') ?? 0)
  )
  if (attackerReach <= defenderBestReach) return null

  return { source: REACH_ADVANTAGE_LABEL, value: '1', displayWhenInactive: true, activeWhen: ALWAYS_ON }
}

// Same weapon-set flag resolution as getActiveSetWeapons in
// enhancedcombathud-wod5e/scripts/weapons-panel.js, trimmed to just
// resolving the documents (not filtering an owned-items list against
// them) - kept as a separate small copy here rather than importing across
// modules, matching how every other cross-cutting helper in this codebase
// stays within its own module (the HUD calls INTO vtm5e-automation via its
// public API, never the other way around).
async function resolveActiveWeapons(actor) {
  const sets = actor.getFlag('enhancedcombathud', 'weaponSets')
  if (!sets) return []

  const active = actor.getFlag('enhancedcombathud', 'activeWeaponSet') || '1'
  const slot = sets[active] ?? {}
  const uuids = [slot.primary, slot.secondary].filter(Boolean)

  const resolved = []
  for (const uuid of uuids) {
    const resolvedItem = await fromUuid(uuid)
    if (resolvedItem) resolved.push(resolvedItem)
  }
  return resolved
}

// wod5e's own item-roll.js pulls its valuePaths straight from the item's
// dicepool paths - reading the same paths here to find whichever Skill this
// weapon actually uses, so the temporary condition's `paths` selector
// matches exactly what getActiveModifiers will filter on for this weapon's
// real roll. Falls back to 'all' (same fallback Humanity Impairment uses)
// for the rare weapon with no Skill component at all.
function getWeaponSkillSelector(item) {
  const dicepool = item.system?.dicepool ?? {}
  for (const key in dicepool) {
    const path = dicepool[key]?.path
    if (path?.startsWith('skills.')) return path.split('.')[1]
  }
  return null
}

// Bypasses _rollItem entirely - same raw WOD5E.api.Roll approach
// rollWeaponDefense (opposing-roll-trigger.js) and rollResistance
// (discipline-resistance.js) already use. quickRoll: true since our own
// dialog above already served as the confirmation step.
async function rollThrown(actor, item, balancedBonus) {
  const valuePaths = ['attributes.dexterity.value', 'skills.athletics.value']
  const basicDiceRaw = await WOD5E.api.getBasicDice({ valuePaths, flatMod: balancedBonus, actor })
  const advancedDiceRaw = await WOD5E.api.getAdvancedDice({ actor })
  const { basicDice, advancedDice } = splitAdvancedDice(basicDiceRaw, advancedDiceRaw, actor)

  await WOD5E.api.Roll({
    basicDice,
    advancedDice,
    actor,
    data: actor.system,
    title: item.name,
    quickRoll: true
  })
}

function buildWeaponTagsSection(item) {
  const activeTags = item.getFlag(MODULE_ID, 'weaponTags') ?? {}
  const caliber = item.getFlag(MODULE_ID, 'caliber') ?? ''
  const reachValue = item.getFlag(MODULE_ID, 'reachValue') ?? 0
  const flatDamageBonus = item.getFlag(MODULE_ID, 'flatDamageBonus') ?? 0

  const section = document.createElement('fieldset')
  section.classList.add('vtm5e-automation-weapon-tags')

  const legend = document.createElement('legend')
  legend.textContent = 'Weapon Tags (vtm5e-automation)'
  section.appendChild(legend)

  // Dropdown match against a Magazine gear item's own caliber flag (see
  // buildAmmoGearSection below) - a fixed vocabulary (CALIBER_OPTIONS)
  // instead of free text, so reloadWeapon's exact-string match can't be
  // broken by a typo or inconsistent naming between a weapon and its ammo.
  const caliberLabel = document.createElement('label')
  caliberLabel.style.display = 'block'
  caliberLabel.textContent = 'Caliber/Ammo Type (for reloading - must match a Magazine item)'
  const caliberInput = buildCaliberSelect(caliber)
  caliberLabel.appendChild(document.createElement('br'))
  caliberLabel.appendChild(caliberInput)
  section.appendChild(caliberLabel)

  caliberInput.addEventListener('change', async () => {
    await item.setFlag(MODULE_ID, 'caliber', caliberInput.value)
  })

  // Unlike the checkbox tags below, Reach is a number on nearly every
  // homebrew melee weapon (0-4) rather than an on/off flag - see
  // computeReachBonus for how this gets compared against a target's
  // equipped weapon automatically, no toggle needed.
  const reachLabel = document.createElement('label')
  reachLabel.style.display = 'block'
  reachLabel.textContent = 'Reach (0-4 - +1 die vs a target wielding a lower-Reach weapon, applied automatically)'
  const reachInput = document.createElement('input')
  reachInput.type = 'number'
  reachInput.name = 'reachValue'
  reachInput.min = '0'
  reachInput.value = reachValue
  reachLabel.appendChild(document.createElement('br'))
  reachLabel.appendChild(reachInput)
  section.appendChild(reachLabel)

  reachInput.addEventListener('change', async () => {
    await item.setFlag(MODULE_ID, 'reachValue', parseInt(reachInput.value) || 0)
  })

  // Same numeric-not-toggle treatment as Reach above - see getFlatDamageBonus.
  const flatDamageLabel = document.createElement('label')
  flatDamageLabel.style.display = 'block'
  flatDamageLabel.textContent = 'Flat Damage Bonus (added to every hit, e.g. a mounted/crew-served weapon\'s "Damage +X")'
  const flatDamageInput = document.createElement('input')
  flatDamageInput.type = 'number'
  flatDamageInput.name = 'flatDamageBonus'
  flatDamageInput.min = '0'
  flatDamageInput.value = flatDamageBonus
  flatDamageLabel.appendChild(document.createElement('br'))
  flatDamageLabel.appendChild(flatDamageInput)
  section.appendChild(flatDamageLabel)

  flatDamageInput.addEventListener('change', async () => {
    await item.setFlag(MODULE_ID, 'flatDamageBonus', parseInt(flatDamageInput.value) || 0)
  })

  for (const [key, def] of Object.entries(WEAPON_TAGS)) {
    const label = document.createElement('label')
    label.style.display = 'block'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.name = key
    checkbox.checked = !!activeTags[key]

    label.appendChild(checkbox)
    label.append(` ${def.label} - ${def.blurb}`)
    section.appendChild(label)
  }

  section.addEventListener('change', async () => {
    const newTags = {}
    section.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      if (checkbox.checked) newTags[checkbox.name] = true
    })

    const newDescription = upsertTagSummaryInDescription(item.system.description, Object.keys(newTags))

    await item.update({
      [`flags.${MODULE_ID}.weaponTags`]: newTags,
      'system.description': newDescription
    })
  })

  return section
}

// Auto-managed block wrapped in its own marker div so any hand-written
// flavor text elsewhere in the description survives every save - only the
// block between these exact tags gets replaced, never the rest.
function upsertTagSummaryInDescription(existingDescription, activeTagKeys) {
  const withoutOldSummary = (existingDescription ?? '')
    .replace(/<div class="vtm5e-automation-weapon-tags-summary">[\s\S]*?<\/div>/, '')
    .trim()

  if (activeTagKeys.length === 0) return withoutOldSummary

  const blurbs = activeTagKeys
    .map((key) => `<b>${WEAPON_TAGS[key].label}:</b> ${WEAPON_TAGS[key].blurb}`)
    .join('<br>')
  const summaryBlock = `<div class="vtm5e-automation-weapon-tags-summary"><p>${blurbs}</p></div>`

  return withoutOldSummary ? `${withoutOldSummary}${summaryBlock}` : summaryBlock
}

// Turns any "gear" item into a Magazine or a box of Bulk Ammo reloadWeapon/
// reloadMagazineFromAmmoBox can find, by giving it a Caliber (must match a
// weapon's own Caliber field exactly - see buildWeaponTagsSection) and
// riding on the item's own NATIVE Uses tracking (system.uses.current/max -
// the exact same field wod5e already renders as "(current/max)" next to
// the item's name on the sheet row, with its own native expend/restore
// icons) rather than a bespoke capacity flag - see the 2026-07-25 rewrite
// note on reloadWeapon for why. Max Rounds here is a convenience mirror of
// the same system.uses.max field the item's native Settings tab already
// exposes; editing either one keeps the other in sync since they're the
// same underlying value.
//
// isMagazine and isAmmoBox are mutually exclusive marker flags (enforced
// below) - a spare Magazine's Current Rounds is how many rounds are loaded
// in THIS particular magazine (a fresh one from the shop starts full; a
// salvaged partial one starts under max - see salvageLoadedAmmo), while an
// Ammo Box's Current Rounds is how much of that box is left to draw on.
// Leaving both unchecked (and Max Rounds at 0) just means ordinary,
// non-ammo gear - safe to show this fieldset on every gear item
// unconditionally rather than needing a separate item type.
function buildAmmoGearSection(item) {
  const caliber = item.getFlag(MODULE_ID, 'caliber') ?? ''
  const ammoType = item.getFlag(MODULE_ID, 'ammoType') ?? ''
  const isMagazine = !!item.getFlag(MODULE_ID, 'isMagazine')
  const isAmmoBox = !!item.getFlag(MODULE_ID, 'isAmmoBox')
  const maxRounds = item.system.uses?.max ?? ''
  const currentRounds = item.system.uses?.current ?? ''

  const section = document.createElement('fieldset')
  section.classList.add('vtm5e-automation-magazine')

  const legend = document.createElement('legend')
  legend.textContent = 'Magazine / Boxed Ammo (vtm5e-automation)'
  section.appendChild(legend)

  const hint = document.createElement('p')
  hint.classList.add('hint')
  hint.textContent = "Check Spare Magazine if this item IS a loaded magazine (reloadWeapon loads a weapon from its Current Rounds, then consumes it - or one copy of its Quantity, above, if several identical full ones are stacked). Check Boxed Ammo instead for bulk loose ammo used to restock/top off a magazine via that magazine's own Reload button. Leave both unchecked for ordinary non-ammo gear."
  section.appendChild(hint)

  const isMagazineLabel = document.createElement('label')
  isMagazineLabel.style.display = 'block'
  const isMagazineInput = document.createElement('input')
  isMagazineInput.type = 'checkbox'
  isMagazineInput.name = 'isMagazine'
  isMagazineInput.checked = isMagazine
  isMagazineLabel.appendChild(isMagazineInput)
  isMagazineLabel.append(' Spare Magazine')
  section.appendChild(isMagazineLabel)

  const isAmmoBoxLabel = document.createElement('label')
  isAmmoBoxLabel.style.display = 'block'
  const isAmmoBoxInput = document.createElement('input')
  isAmmoBoxInput.type = 'checkbox'
  isAmmoBoxInput.name = 'isAmmoBox'
  isAmmoBoxInput.checked = isAmmoBox
  isAmmoBoxLabel.appendChild(isAmmoBoxInput)
  isAmmoBoxLabel.append(' Boxed Ammo')
  section.appendChild(isAmmoBoxLabel)

  isMagazineInput.addEventListener('change', () => { if (isMagazineInput.checked) isAmmoBoxInput.checked = false })
  isAmmoBoxInput.addEventListener('change', () => { if (isAmmoBoxInput.checked) isMagazineInput.checked = false })

  const caliberLabel = document.createElement('label')
  caliberLabel.style.display = 'block'
  caliberLabel.textContent = 'Caliber/Ammo Type (must match the weapon)'
  const caliberInput = buildCaliberSelect(caliber)
  caliberLabel.appendChild(document.createElement('br'))
  caliberLabel.appendChild(caliberInput)
  section.appendChild(caliberLabel)

  const maxLabel = document.createElement('label')
  maxLabel.style.display = 'block'
  maxLabel.textContent = 'Max Rounds (rated capacity - same value as this item\'s Uses.Max)'
  const maxInput = document.createElement('input')
  maxInput.type = 'number'
  maxInput.name = 'maxRounds'
  maxInput.min = '0'
  maxInput.value = maxRounds
  maxLabel.appendChild(document.createElement('br'))
  maxLabel.appendChild(maxInput)
  section.appendChild(maxLabel)

  const currentLabel = document.createElement('label')
  currentLabel.style.display = 'block'
  currentLabel.textContent = 'Current Rounds (how many are actually loaded/left right now)'
  const currentInput = document.createElement('input')
  currentInput.type = 'number'
  currentInput.name = 'currentRounds'
  currentInput.min = '0'
  currentInput.value = currentRounds
  currentLabel.appendChild(document.createElement('br'))
  currentLabel.appendChild(currentInput)
  section.appendChild(currentLabel)

  const ammoTypeLabel = document.createElement('label')
  ammoTypeLabel.style.display = 'block'
  ammoTypeLabel.textContent = 'Ammo Type (Magazine only)'
  const ammoTypeInput = buildAmmoTypeSelect(ammoType)
  ammoTypeLabel.appendChild(document.createElement('br'))
  ammoTypeLabel.appendChild(ammoTypeInput)
  section.appendChild(ammoTypeLabel)

  section.addEventListener('change', async () => {
    const max = parseInt(maxInput.value) || 0
    const current = Math.min(parseInt(currentInput.value) || 0, max)
    await item.update({
      [`flags.${MODULE_ID}.caliber`]: caliberInput.value,
      [`flags.${MODULE_ID}.ammoType`]: ammoTypeInput.value,
      [`flags.${MODULE_ID}.isMagazine`]: isMagazineInput.checked,
      [`flags.${MODULE_ID}.isAmmoBox`]: isAmmoBoxInput.checked,
      'system.uses.enabled': max > 0,
      'system.uses.max': max,
      'system.uses.current': current
    })
  })

  return section
}
