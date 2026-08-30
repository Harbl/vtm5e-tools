/**
 * Passive/free/Rouse-gated Discipline powers whose real effect isn't "roll
 * dice" - wod5e's own _rollItem is unconditional though (system/actor/
 * scripts/item-roll.js), so any power with an empty dicepool still forces a
 * 0-dice roll dialog that always reads as a fail. rollPower is the single
 * entry point BOTH the actor sheet (via bindPowerRollInterception below)
 * and the Argon HUD's powers-panel.js call instead of wod5e's native click
 * handler - known powers get their real effect applied here with no roll;
 * everything else falls through to the normal _rollItem roll, untouched.
 *
 * Powers covered (corebook page refs from the actual text, not guessed):
 * - Resilience (p.258, Fortitude 1), Unswayable Mind (p.258, Fortitude 1):
 *   passive, kept in sync with current Fortitude automatically.
 * - Toughness (p.259, Fortitude 2), Defy Bane (p.259, Fortitude 3), Prowess
 *   (p.264, Potence 2): Rouse-gated, click fires a real Rouse Check then
 *   grants a scene-long condition once it resolves.
 * - Daunt (p.267, Presence 1), Eyes of the Beast (p.269, Protean 1): Free,
 *   simple on/off toggles - click again (or remove the token icon) to end.
 *
 * Deliberately NOT automated (documented here rather than silently
 * skipped): Enduring Beasts (grants Health to an ANIMAL companion - this
 * project has no animal-companion actor tracking), Lethal Body/the unarmed-
 * damage half of Prowess (both modify unarmed attacks, which don't exist
 * as a rollable concept yet - revisit once the HUD gets unarmed combat
 * buttons), Unfettered Heart (modifies the Difficulty of a "roll to stake"
 * that doesn't exist as an automated roll anywhere in this codebase - wood/
 * stake ammo already applies its own narrative Torpor-risk condition via
 * opposing-roll-trigger.js, GM adjudicates staking Difficulty by hand).
 */
import { applyStatusCondition, removeStatusCondition, hasReconcileAuthority } from './condition-application.js'
import { WEAPON_ROLL_ACTOR_SHEET_HOOKS } from './weapon-tags.js'

const MODULE_ID = 'vtm5e-automation'
const ROUSE_TITLE_PREFIX = 'WOD5E.VTM.RousingBlood'
const ALWAYS_ON = { check: 'always', path: '', value: '' }

function fortitudeRating(actor) {
  return actor?.system?.disciplines?.fortitude?.value ?? 0
}

function potenceRating(actor) {
  return actor?.system?.disciplines?.potence?.value ?? 0
}

function presenceRating(actor) {
  return actor?.system?.disciplines?.presence?.value ?? 0
}

// --- Passive powers: always-on, scale with a Discipline rating, no click-
// time roll or cost. Synced whenever that Discipline changes or the power
// is granted/removed (see registerPowerEffects), so they never go stale.
const PASSIVE_POWERS = {
  resilience: {
    conditionName: 'Resilience',
    rating: fortitudeRating,
    note: (rating) => `<p><em>Auto-managed by vtm5e-automation - adds your current Fortitude rating (${rating}) to your maximum Health. Recalculates automatically if Fortitude changes.</em></p>`,
    build: (rating) => ({ effects: [{ keys: ['system.health.max'], intValue: rating }] })
  },
  'unswayable mind': {
    conditionName: 'Unswayable Mind',
    rating: fortitudeRating,
    note: (rating) => `<p><em>Auto-managed by vtm5e-automation - adds your current Fortitude rating (${rating}) as bonus dice to resist coercion, intimidation, seduction, or supernatural mind-influence (Dominate, Presence). Approximated as a bonus to Composure/Resolve rolls specifically, the corebook's own most common resistance pool - Discipline resistance pools vary by power, so this won't catch every possible combo. Recalculates automatically if Fortitude changes.</em></p>`,
    build: (rating) => ({
      bonuses: [{ source: 'Unswayable Mind', value: String(rating), paths: ['attributes.composure', 'attributes.resolve'], displayWhenInactive: false, activeWhen: ALWAYS_ON }]
    })
  }
}

async function syncPassivePower(actor, key) {
  const def = PASSIVE_POWERS[key]
  const powerItem = actor.items.find((i) => i.type === 'power' && i.name.toLowerCase() === key)
  const rating = powerItem ? def.rating(actor) : 0

  if (!powerItem || rating <= 0) {
    await removeStatusCondition(actor, def.conditionName)
    return
  }

  await applyStatusCondition(actor, {
    name: def.conditionName,
    img: powerItem.img,
    note: def.note(rating),
    ...def.build(rating)
  })
}

async function handlePassivePower(actor, item) {
  await syncPassivePower(actor, item.name.toLowerCase())
  ui.notifications.info(`${item.name} is passive - already reflected automatically.`)
}

// --- Rouse-gated powers: click fires a real Rouse Check (via wod5e's own
// _onRouseCheck, called directly rather than through _rollItem - rouse.js
// falls back to "cost 1" for any item.system.cost <= 0, correct no matter
// what these items' own stored cost is, and skips the buggy empty-dicepool
// roll _rollItem would otherwise force first). The resulting condition is
// granted once the Rouse roll's chat message actually appears (see
// registerPowerEffects' createChatMessage hook) - Rouse rolls are fire-and-
// forget from the caller's side, there's no promise to await completion on.
const ROUSE_GATED_POWERS = {
  toughness: {
    conditionName: 'Toughness',
    rating: fortitudeRating,
    zeroRatingWarning: 'no Fortitude rating - Toughness would reduce damage by 0',
    grant: (actor, img, rating) => applyStatusCondition(actor, {
      name: 'Toughness',
      img,
      note: `<p><em>Auto-managed by vtm5e-automation - reduces incoming Superficial Health damage by your Fortitude rating (${rating}) for the rest of this scene (cannot reduce a hit below 1, per RAW). Right-click the token icon (or delete the Item) to end it early.</em></p>`,
      flags: { toughnessReduction: rating }
    }),
    successNote: (rating) => `incoming Superficial damage reduced by ${rating} this scene`
  },
  'defy bane': {
    conditionName: 'Defy Bane',
    rating: fortitudeRating,
    zeroRatingWarning: 'no Fortitude rating - Defy Bane would convert 0 damage',
    grant: (actor, img, rating) => applyStatusCondition(actor, {
      name: 'Defy Bane',
      img,
      note: `<p><em>Auto-managed by vtm5e-automation - up to ${rating} points of incoming Aggravated Health damage convert to Superficial instead, for the rest of this scene (a shared per-scene budget, not per-hit - see damage-application.js). RAW also forbids healing that converted Superficial damage until the scene ends - not tracked automatically, honor it by hand. Right-click the token icon (or delete the Item) to end it early.</em></p>`,
      flags: { defyBaneBudget: rating }
    }),
    successNote: (rating) => `up to ${rating} points of Aggravated damage will convert to Superficial this scene`
  },
  prowess: {
    conditionName: 'Prowess',
    rating: potenceRating,
    zeroRatingWarning: 'no Potence rating - Prowess would add 0 dice',
    grant: (actor, img, rating) => applyStatusCondition(actor, {
      name: 'Prowess',
      img,
      note: `<p><em>Auto-managed by vtm5e-automation - adds your Potence rating (${rating}) to Strength-based rolls for the rest of this scene. The unarmed-damage half of this power isn't automated yet (no unarmed-attack roll exists in this codebase). Right-click the token icon (or delete the Item) to end it early.</em></p>`,
      bonuses: [{ source: 'Prowess', value: String(rating), paths: ['attributes.strength'], displayWhenInactive: false, activeWhen: ALWAYS_ON }]
    }),
    successNote: (rating) => `+${rating} dice to Strength-based rolls this scene`
  }
}

const pendingRousedPower = new Map()

async function handleRouseGatedPower(actor, item) {
  const key = item.name.toLowerCase()
  const def = ROUSE_GATED_POWERS[key]
  const rating = def.rating(actor)
  if (rating <= 0) ui.notifications.warn(`${MODULE_ID} | ${actor.name} has ${def.zeroRatingWarning}.`)
  pendingRousedPower.set(actor.id, { key, name: item.name, img: item.img, rating })

  const { _onRouseCheck } = await import('/systems/wod5e/system/actor/vtm/scripts/rouse.js')
  await _onRouseCheck(actor, item)
}

async function grantRousedPower(actor, pending) {
  const def = ROUSE_GATED_POWERS[pending.key]
  if (pending.rating <= 0) return
  await def.grant(actor, pending.img, pending.rating)
  ui.notifications.info(`${MODULE_ID} | ${pending.name} active on ${actor.name} - ${def.successNote(pending.rating)}.`)
}

// --- Free, simple toggle powers: click again (or remove the token icon) to
// end early. No roll, no cost - just flips a condition on/off.
const TOGGLE_POWERS = {
  daunt: {
    conditionName: 'Daunt',
    rating: presenceRating,
    note: (rating) => `<p><em>Auto-managed by vtm5e-automation - adds your Presence rating (${rating}) to Intimidation rolls while active (a fixed die value from when you activated it - reactivate if Presence changes). RAW also requires anyone attacking you to first pass a Resolve+Composure roll (Difficulty 2), and forbids using Awe and Daunt at once - neither is automated, adjudicate by hand. Click Daunt again (or right-click the token icon) to end it.</em></p>`,
    build: (rating) => [{ source: 'Daunt', value: String(rating), paths: ['skills.intimidation'], displayWhenInactive: false, activeWhen: ALWAYS_ON }]
  },
  'eyes of the beast': {
    conditionName: 'Eyes of the Beast',
    rating: () => 2,
    note: () => '<p><em>Auto-managed by vtm5e-automation - +2 dice to Intimidation rolls while active (simplified from "against mortals only" - use judgment against non-mortal targets). RAW also grants darkvision/ignores darkness sight penalties while active - not automated, adjudicate narratively. Click again (or right-click the token icon) to end it.</em></p>',
    build: () => [{ source: 'Eyes of the Beast', value: '2', paths: ['skills.intimidation'], displayWhenInactive: false, activeWhen: ALWAYS_ON }]
  }
}

async function handleTogglePower(actor, item) {
  const key = item.name.toLowerCase()
  const def = TOGGLE_POWERS[key]
  const active = actor.items.some((i) => i.type === 'condition' && i.name === def.conditionName)

  if (active) {
    await removeStatusCondition(actor, def.conditionName)
    ui.notifications.info(`${MODULE_ID} | ${item.name} deactivated on ${actor.name}.`)
    return
  }

  const rating = def.rating(actor)
  await applyStatusCondition(actor, {
    name: def.conditionName,
    img: item.img,
    note: def.note(rating),
    bonuses: def.build(rating)
  })
  ui.notifications.info(`${MODULE_ID} | ${item.name} active on ${actor.name}.`)
}

const INTERCEPTED_POWERS = {
  resilience: handlePassivePower,
  'unswayable mind': handlePassivePower,
  toughness: handleRouseGatedPower,
  'defy bane': handleRouseGatedPower,
  prowess: handleRouseGatedPower,
  daunt: handleTogglePower,
  'eyes of the beast': handleTogglePower
}

/**
 * Public entry point - see file header. Falls through to wod5e's real
 * _rollItem for every power this file doesn't specifically know about, so
 * normal Discipline rolls are completely unaffected.
 */
export async function rollPower(actor, item) {
  if (!actor || !item) return

  const handler = item.type === 'power' ? INTERCEPTED_POWERS[item.name.toLowerCase()] : null
  if (handler) {
    await handler(actor, item)
    return
  }

  const { _rollItem } = await import('/systems/wod5e/system/actor/scripts/item-roll.js')
  await _rollItem(actor, item)
}

function bindPowerRollInterception(app, html) {
  const actor = app.actor
  if (!actor) return

  const rollableItems = html.querySelectorAll?.('.rollable-item[data-action="rollItem"]') ?? []
  rollableItems.forEach((element) => {
    const itemId = element.closest('[data-item-id]')?.dataset.itemId
    const item = itemId ? actor.items.get(itemId) : null
    if (!item || item.type !== 'power') return
    if (!INTERCEPTED_POWERS[item.name.toLowerCase()]) return

    if (element.dataset.vtm5eAutomationPowerBound) return
    element.dataset.vtm5eAutomationPowerBound = 'true'

    // Capture phase - must run before wod5e's own delegated rollItem
    // handler, same reasoning as weapon-tags.js's bindWeaponRollInterception.
    element.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      rollPower(actor, item)
    }, true)
  })
}

export function registerPowerEffects() {
  for (const hookName of WEAPON_ROLL_ACTOR_SHEET_HOOKS) {
    Hooks.on(hookName, bindPowerRollInterception)
  }

  // Keeps every PASSIVE_POWERS condition correct as its Discipline changes
  // (buy-up, Discipline granted/removed) - catches both the rating changing
  // and the power item being added/removed.
  Hooks.on('updateActor', async (actor, changes) => {
    if (actor.system?.gamesystem !== 'vampire' || !hasReconcileAuthority(actor)) return
    if (!foundry.utils.hasProperty(changes, 'system.disciplines')) return
    for (const key of Object.keys(PASSIVE_POWERS)) await syncPassivePower(actor, key)
  })
  Hooks.on('createItem', async (item) => {
    const actor = item.parent
    if (!(actor instanceof Actor) || !hasReconcileAuthority(actor) || item.type !== 'power') return
    const key = item.name.toLowerCase()
    if (PASSIVE_POWERS[key]) await syncPassivePower(actor, key)
  })
  Hooks.on('deleteItem', async (item) => {
    const actor = item.parent
    if (!(actor instanceof Actor) || !hasReconcileAuthority(actor) || item.type !== 'power') return
    const key = item.name.toLowerCase()
    if (PASSIVE_POWERS[key]) await syncPassivePower(actor, key)
  })

  // Resolves handleRouseGatedPower's pending Rouse Check - see the comment
  // above pendingRousedPower. Matched on wod5e's own Rouse Check title
  // format ("Rousing the Blood - <item name>"), same title-matching
  // convention bestial-failure.js already uses for DODGE/weapon markers.
  Hooks.on('createChatMessage', async (message) => {
    if (message.author?.id !== game.user.id) return
    const roll = message.rolls?.[0]
    if (!roll) return
    const actor = message.speakerActor
    const pending = actor ? pendingRousedPower.get(actor.id) : null
    if (!pending) return
    const expectedTitle = `${game.i18n.localize(ROUSE_TITLE_PREFIX)} - ${pending.name}`
    if (roll.options?.title !== expectedTitle) return
    pendingRousedPower.delete(actor.id)
    await grantRousedPower(actor, pending)
  })
}
