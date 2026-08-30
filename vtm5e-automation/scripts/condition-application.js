/**
 * Applies (or refreshes, if already present) a marker status condition on
 * an actor - a plain wod5e "condition" item, visible on the sheet exactly
 * like a real one (its own name, its own description field), created via
 * the actor's normal embedded-item API rather than anything wod5e-internal.
 * Checked the actual schema (ConditionItemModel + the shared WoDItemModel
 * base) before writing this - description/bonuses/effects/suppressed all
 * have safe defaults, so a condition can be created with nothing but a name
 * and still be perfectly valid.
 *
 * Most callers (Discipline statuses, Ward blocks) deliberately carry no
 * mechanical bonuses - they describe a BEHAVIORAL restriction, not a clean
 * fixed dice-pool number wod5e's condition system could actually enforce.
 * The optional `bonuses` param exists for callers that DO have a real,
 * numeric effect (weapon-tags.js's temporary Full Auto/Two-Handed/Unwieldy
 * modifiers) - shape matches ConditionItemModel's own bonuses schema
 * exactly (confirmed via impairment-conditions.js's existing Humanity
 * Impairment condition, the first place this module ever populated it):
 * `[{ source, value, paths, displayWhenInactive, activeWhen: { check,
 * path, value } }]`. situational-modifiers.js's getActiveModifiers reads
 * this automatically on every roll wod5e's own _rollItem makes - no custom
 * roll-math needed on our end once the condition exists.
 */
const MODULE_ID = 'vtm5e-automation'

// Conditions that also get a real Foundry token status-effect icon (token
// overlay, side-of-screen icon row, native hover tooltip, right-click-to-
// remove) - opt-in per condition NAME since most existing callers of
// applyStatusCondition are purely behavioral/dice-pool markers with no need
// for a token icon. Add an entry here for any future condition that should
// show on the token too (Frenzy, the power sweep, etc).
// Every path here was verified to actually exist in Foundry's bundled
// icons/ set (2026-07-28 - the original four guessed filenames below
// 404'd: mind-fear-orange, silhouette-emerge-shadow-blue,
// mouth-teeth-sharp-red, eye-ringed-red - none of those ever existed).
const TOKEN_ICON_CONDITIONS = {
  Resilience: 'icons/magic/life/heart-cross-strong-blue.webp',
  Toughness: 'icons/magic/defensive/shield-barrier-blue.webp',
  Frenzy: 'icons/creatures/abilities/mouth-teeth-sharp.webp',
  'Unswayable Mind': 'icons/magic/control/fear-fright-mask-orange.webp',
  'Defy Bane': 'icons/magic/fire/flame-burning-creature-skeleton.webp',
  Prowess: 'icons/skills/melee/strike-hammer-destructive-orange.webp',
  Daunt: 'icons/magic/control/fear-fright-shadow-monster-red.webp',
  'Eyes of the Beast': 'icons/magic/perception/eye-ringed-glow-angry-red.webp'
}

function statusIdFor(name) {
  return `vtm5e-${name.toLowerCase().replace(/\s+/g, '-')}`
}

// Single-authority guard for hooks that fire identically on every connected
// client for the same document event (deleteItem, deleteActiveEffect,
// updateActor) - without it, a GM and the actor's own owning player both
// being online at once would race to react to the same event (duplicate
// condition items, or double-delete errors). Same reasoning/pattern as
// impairment-conditions.js's reconcileImpairments. Exported for
// power-effects.js's own reactive hooks (Resilience/Fortitude sync) to
// share, since they have the identical race shape.
export function hasReconcileAuthority(actor) {
  if (game.user.isGM) return true
  const gmActive = game.users.some((u) => u.active && u.isGM)
  return !gmActive && actor.isOwner
}

// Registers this module's token-icon-bearing conditions as real Foundry
// status effects (CONFIG.statusEffects) - native mechanism, so the token
// overlay/hover/right-click-remove UI is entirely built-in, no custom code.
export function registerConditionStatusEffects() {
  for (const [name, img] of Object.entries(TOKEN_ICON_CONDITIONS)) {
    const id = statusIdFor(name)
    if (CONFIG.statusEffects.some((e) => e.id === id)) continue
    CONFIG.statusEffects.push({ id, name, img })
  }
}

// Keeps the condition Item and its matching token status effect in sync in
// both directions, since they're two separate documents (an Item and a real
// Foundry ActiveEffect) describing the same condition:
// - Native token-HUD removal (GM right-clicks the icon off) deletes the
//   ActiveEffect only - mirror that onto the condition Item.
// - The condition Item being removed some other way (e.g. hand-deleted from
//   the sheet) mirrors back onto the status effect.
export function registerConditionSync() {
  Hooks.on('deleteActiveEffect', async (effect) => {
    const actor = effect.parent
    if (!(actor instanceof Actor) || !hasReconcileAuthority(actor)) return
    for (const [name] of Object.entries(TOKEN_ICON_CONDITIONS)) {
      if (effect.statuses?.has(statusIdFor(name))) await removeStatusCondition(actor, name)
    }
  })

  Hooks.on('deleteItem', async (item) => {
    const actor = item.parent
    if (!(actor instanceof Actor) || !hasReconcileAuthority(actor) || item.type !== 'condition') return
    if (!TOKEN_ICON_CONDITIONS[item.name]) return
    const id = statusIdFor(item.name)
    if (actor.statuses?.has(id)) await actor.toggleStatusEffect(id, { active: false })
  })
}

function buildEffectsObject(effects) {
  const obj = {}
  effects.forEach((e, i) => {
    obj[`vtm5e${i}`] = {
      keys: e.keys,
      intValue: e.intValue,
      strValue: '',
      mode: e.mode ?? CONST.ACTIVE_EFFECT_CHANGE_TYPES.add,
      flatSource: 'static',
      type: 'value'
    }
  })
  return obj
}

/**
 * `effects` (optional): array of `{ keys: [...], intValue, mode }`, matching
 * wod5e's own condition-item "Effects" tab schema exactly (see
 * system/item/core/scripts/effects.js) - applied to derived actor data every
 * data-prep pass (e.g. `keys: ['system.health.max'], intValue: 3` adds 3 to
 * max Health). Unlike `bonuses` (dice-pool-only, read at roll time),
 * `effects` can touch max Health/Willpower/etc.
 *
 * `flags` (optional): merged into the condition item's own
 * `flags.vtm5e-automation` namespace, for callers that need to stash extra
 * data on the condition itself (e.g. Toughness's stored damage-reduction
 * rating - see damage-application.js).
 */
export async function applyStatusCondition(actor, { name, note, img, bonuses, effects, flags }) {
  if (!actor) return null

  const existing = actor.items.find((i) => i.type === 'condition' && i.name === name)
  if (existing) {
    const updates = {}
    if (note) updates['system.description'] = note
    if (bonuses) updates['system.bonuses'] = bonuses
    if (effects) updates['system.effects'] = buildEffectsObject(effects)
    if (flags) updates[`flags.${MODULE_ID}`] = { ...existing.flags?.[MODULE_ID], ...flags }
    if (Object.keys(updates).length > 0) await existing.update(updates)
    if (TOKEN_ICON_CONDITIONS[name]) await actor.toggleStatusEffect(statusIdFor(name), { active: true })
    return existing
  }

  const [created] = await actor.createEmbeddedDocuments('Item', [{
    name,
    type: 'condition',
    img: img ?? 'icons/svg/paralysis.svg',
    system: { description: note ?? '', bonuses: bonuses ?? [], effects: effects ? buildEffectsObject(effects) : {} },
    flags: flags ? { [MODULE_ID]: flags } : {}
  }])
  if (TOKEN_ICON_CONDITIONS[name]) await actor.toggleStatusEffect(statusIdFor(name), { active: true })
  return created
}

// Deletes a named condition item (if present) and, for token-icon
// conditions, clears the matching status effect first - see
// registerConditionSync above for why removal order matters (toggling the
// status off before the Item is gone means the deleteItem sync hook finds
// nothing left to do, instead of both paths racing to remove the same
// ActiveEffect).
export async function removeStatusCondition(actor, name) {
  if (!actor) return

  if (TOKEN_ICON_CONDITIONS[name]) {
    const id = statusIdFor(name)
    if (actor.statuses?.has(id)) await actor.toggleStatusEffect(id, { active: false })
  }

  const matches = actor.items.filter((i) => i.type === 'condition' && i.name === name)
  if (matches.length === 0) return
  try {
    await actor.deleteEmbeddedDocuments('Item', matches.map((i) => i.id))
  } catch (err) {
    console.warn(`${MODULE_ID} | Condition "${name}" was already removed (likely a concurrent update)`, err)
  }
}
