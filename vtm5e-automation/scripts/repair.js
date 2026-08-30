import { splitAdvancedDice } from './roll-utils.js'

const MODULE_ID = 'vtm5e-automation'
const REPAIR_TITLE_MARKER = 'REPAIR::'

// No RAW repair subsystem exists for mundane gear (V5/Second Inquisition
// have nothing to homebrew off of), so Difficulty is scaled off the item's
// own shop price instead - Jake's call, roughly "$250 of value per
// Difficulty step" after a cheap first bracket, capped at 10. Reads
// vtm5e-gearshop's own price flag (cents) so it stays in sync with
// whatever configure-equipment-prices.js currently says without a second
// copy of the price table to maintain. Falls back to a flat middle
// Difficulty for anything with no price flag (hand-created/legacy/GM-only
// weapons never run through the shop).
const DEFAULT_REPAIR_DIFFICULTY = 3

function repairDifficultyForItem (item) {
  const priceCents = item.getFlag('vtm5e-gearshop', 'price')
  if (!Number.isFinite(priceCents)) return DEFAULT_REPAIR_DIFFICULTY

  const dollars = priceCents / 100
  if (dollars <= 50) return 1
  if (dollars <= 250) return 2
  if (dollars <= 500) return 3
  if (dollars <= 750) return 4
  if (dollars <= 1000) return 5
  if (dollars <= 1250) return 6
  if (dollars <= 1500) return 7
  if (dollars <= 1750) return 8
  if (dollars <= 2000) return 9
  return 10
}

// Repair isn't free forever (2026-07-24, Jake's call): every ATTEMPT counts
// toward a lifetime total regardless of outcome ("a mix of failures and
// successes" both push the item toward junk) - reaching MAX_REPAIR_ATTEMPTS
// makes it permanently Unrepairable (if it breaks again after that, it's
// stuck Broken for good). The tier right before that cap (WORN_AT_ATTEMPTS)
// leaves the item permanently Worn - a standing -1 dice penalty (see
// weapon-tags.js's rollWeaponAttack) that applies from then on regardless of
// whether it's currently Broken (the two stack), representing one-too-many
// patch jobs.
export const MAX_REPAIR_ATTEMPTS = 3
export const WORN_AT_ATTEMPTS = 2

export function isBroken (item) {
  return !!item?.getFlag(MODULE_ID, 'broken')
}

export function repairAttemptsFor (item) {
  return item?.getFlag(MODULE_ID, 'repairAttempts') ?? 0
}

export function isUnrepairable (item) {
  return !!item?.getFlag(MODULE_ID, 'unrepairable')
}

export function isWorn (item) {
  return repairAttemptsFor(item) >= WORN_AT_ATTEMPTS
}

// Worn's permanent penalty is "-1 dice" for weapons (see weapon-tags.js's
// rollWeaponAttack) - armor isn't rolled, so the equivalent for a twice-
// patched vest is -1 to its own Armor Value instead, used by
// damage-application.js's bestEquippedArmor/getEquippedArmorReduction for
// BOTH picking which equipped item is "best" and how much it actually
// reduces, so the number that reduces a hit and the number recorded as
// absorbed for wear-tracking purposes always agree.
export function effectiveArmorValue (item) {
  const raw = item?.system?.armorvalue ?? 0
  return Math.max(raw - (isWorn(item) ? 1 : 0), 0)
}

// Fragile's new on-fumble effect (see opposing-roll-trigger.js) - marks the
// weapon Broken (-2 dice on every roll with it, see weapon-tags.js's
// rollWeaponAttack) rather than destroying/decrementing it outright, so it
// stays a real, repairable setback instead of a one-and-done loss.
export async function markBroken (item) {
  await item.setFlag(MODULE_ID, 'broken', true)
}

// Armor wears down with cumulative absorbed damage instead of a single
// fumble roll (durability, not luck - a real vest doesn't "roll to break",
// it just stops the same number of hits eventually) - 2026-07-24, Jake's
// call, parallel mechanic to Fragile weapons reusing the exact same Broken/
// repair/wear-cap plumbing (damage-application.js's bestEquippedArmor
// already excludes anything isBroken, so a Broken vest simply stops
// contributing reduction with no extra branching needed there). Threshold
// scales off the item's own Armor Value - its real protective rating - not
// price, since tougher armor has more material to wear through, not just a
// higher price tag.
const ARMOR_THRESHOLD_PER_ARMOR_VALUE = 5

export function armorThresholdFor (item) {
  return Math.max(item?.system?.armorvalue ?? 0, 1) * ARMOR_THRESHOLD_PER_ARMOR_VALUE
}

export function armorDamageAbsorbedFor (item) {
  return item?.getFlag(MODULE_ID, 'armorDamageAbsorbed') ?? 0
}

/**
 * Records `amount` of damage actually absorbed by this armor item (the
 * lesser of its Armor Value and the raw incoming hit, computed by the
 * caller - see damage-application.js's applyDamageToTarget) against its
 * running lifetime total. Crossing armorThresholdFor's cap marks it Broken,
 * the same flag/state Fragile weapons use - repairable through the same
 * wrench button and wear/unrepairable cap as any other Broken item.
 */
export async function absorbArmorDamage (item, amount) {
  if (!item || amount <= 0 || isBroken(item)) return

  const total = armorDamageAbsorbedFor(item) + amount
  await item.setFlag(MODULE_ID, 'armorDamageAbsorbed', total)

  if (total >= armorThresholdFor(item)) {
    await markBroken(item)
    ui.notifications.warn(`${item.name} has taken all the damage it can absorb - Broken, no longer providing protection until repaired.`)
  }
}

// actorId -> item UUID, consumed by registerRepairResolution's chat hook
// once the fire-and-forget WOD5E.api.Roll below actually produces a
// message - same "stash it, read it back off the resulting roll" shape as
// opposing-roll-trigger.js's pendingWeaponOpposedRolls, scaled down to a
// single in-flight repair per actor (rolling a second repair before the
// first resolves would just overwrite this, which is an acceptable edge
// case for a single-player-driven action button).
const pendingRepairs = new Map()

/**
 * Dexterity + Craft roll to clear a weapon's Broken flag - Difficulty from
 * repairDifficultyForItem above. Bypasses _rollItem the same way
 * rollThrown/rollResistance do (this isn't a roll the item itself knows how
 * to make), tagging the roll's title with REPAIR_TITLE_MARKER so
 * registerRepairResolution's chat hook can identify it and read back
 * pass/fail once it resolves.
 */
export async function repairWeapon (actor, item) {
  if (!actor || !item || !isBroken(item) || isUnrepairable(item)) return

  const difficulty = repairDifficultyForItem(item)
  const valuePaths = ['attributes.dexterity.value', 'skills.craft.value']
  const basicDiceRaw = await WOD5E.api.getBasicDice({ valuePaths, flatMod: 0, actor })
  const advancedDiceRaw = await WOD5E.api.getAdvancedDice({ actor })
  const { basicDice, advancedDice } = splitAdvancedDice(basicDiceRaw, advancedDiceRaw, actor)

  pendingRepairs.set(actor.id, item.uuid)

  await WOD5E.api.Roll({
    basicDice,
    advancedDice,
    actor,
    data: actor.system,
    title: `${REPAIR_TITLE_MARKER}${item.name}`,
    difficulty,
    quickRoll: true
  })
}

// Mirrors wod5e's own pass/fail rule (system-rolls.js's rollSuccessful:
// roll.total > 0 && (roll.total >= difficulty || difficulty === 0)) -
// recomputed here rather than trusted off roll.options since that field is
// this system's own internal bookkeeping, not a documented public contract.
export function registerRepairResolution () {
  Hooks.on('createChatMessage', async (message) => {
    // Same single-client guard as every other roll-reactive hook in this
    // module family - createChatMessage fires on every connected client
    // when the roll syncs.
    if (message.author?.id !== game.user.id) return

    const roll = message.rolls?.[0]
    if (!roll || !roll.systemRoll) return
    if (!(roll.options?.title ?? '').startsWith(REPAIR_TITLE_MARKER)) return

    const actor = message.speakerActor
    const itemUuid = actor ? pendingRepairs.get(actor.id) : null
    if (!itemUuid) return
    pendingRepairs.delete(actor.id)

    const item = await fromUuid(itemUuid)
    if (!item) return

    const difficulty = roll.options?.difficulty ?? 0
    const succeeded = roll.total > 0 && (roll.total >= difficulty || difficulty === 0)

    // Counts toward the lifetime cap regardless of outcome - a failed
    // attempt still put wear on the item, per Jake's call.
    const attempts = repairAttemptsFor(item) + 1
    await item.setFlag(MODULE_ID, 'repairAttempts', attempts)
    const justBecameUnrepairable = attempts >= MAX_REPAIR_ATTEMPTS
    if (justBecameUnrepairable) await item.setFlag(MODULE_ID, 'unrepairable', true)

    if (succeeded) {
      await item.unsetFlag(MODULE_ID, 'broken')
      // Armor-only in practice (weapons never set this flag) - a repaired
      // vest goes back to a clean slate, not straight back to sitting at
      // its own break threshold and popping again on the next hit.
      if (armorDamageAbsorbedFor(item) > 0) await item.unsetFlag(MODULE_ID, 'armorDamageAbsorbed')
    }

    const remaining = Math.max(MAX_REPAIR_ATTEMPTS - attempts, 0)
    const justBecameWorn = attempts === WORN_AT_ATTEMPTS
    const wornSuffix = justBecameWorn ? ' The patch job shows: permanently Worn (-1 dice) from now on.' : ''

    if (succeeded && justBecameUnrepairable) {
      ui.notifications.info(`${item.name} repaired - held together one last time. It can never be repaired again.`)
    } else if (!succeeded && justBecameUnrepairable) {
      ui.notifications.warn(`Repair attempt on ${item.name} failed - and that was its last chance. Permanently Broken.`)
    } else if (succeeded) {
      ui.notifications.info(`${item.name} repaired - Broken cleared.${wornSuffix} ${remaining} repair${remaining === 1 ? '' : 's'} left in it.`)
    } else {
      ui.notifications.warn(`Repair attempt on ${item.name} failed - still Broken.${wornSuffix} ${remaining} repair${remaining === 1 ? '' : 's'} left in it.`)
    }
  })
}
