/**
 * Automates VtM5e's Impairment rule (corebook p. 126 for Health, p. 158 for
 * Willpower, p. 209 "Degeneration" for Humanity): once a tracker fills, the
 * character is Impaired and loses two dice from the relevant pools until it
 * un-fills. wod5e already has the actual dice-pool-penalty mechanism built
 * in - a "condition" item type whose "bonuses" array is read by every roll
 * automatically (system/scripts/rolls/situational-modifiers.js) - and even
 * ships two of the three conditions needed (Health/Willpower Impairment) in
 * its own "Conditions" compendium. Nothing in wod5e ever adds or removes
 * those condition items automatically, though - that's the actual gap this
 * file fills, by watching Health/Willpower/Humanity and reconciling which
 * Impairment condition items an actor should currently have.
 *
 * This is the same pattern the D&D5e module "Dynamic Active Effects" (DAE)
 * fills for that system - except DAE layers custom logic on top of
 * Foundry's generic core ActiveEffect documents, because dnd5e doesn't have
 * anything more specific. wod5e already has a purpose-built equivalent for
 * exactly this ("condition" items + the bonuses/effects system), so this
 * file leans on that native mechanism instead of introducing a second,
 * parallel one.
 */
const MODULE_ID = 'vtm5e-automation'
const CONDITIONS_PACK = 'wod5e.conditions'

const IMPAIRMENT_DEFS = {
  health: {
    label: 'Health Impairment',
    compendiumDataItemId: 'condition-health-impairment',
    isActive: (system) => {
      const max = system.health?.max ?? 0
      const filled = (system.health?.superficial ?? 0) + (system.health?.aggravated ?? 0)
      return max > 0 && filled >= max
    }
  },
  willpower: {
    label: 'Willpower Impairment',
    compendiumDataItemId: 'condition-willpower-impairment',
    isActive: (system) => {
      const max = system.willpower?.max ?? 0
      const filled = (system.willpower?.superficial ?? 0) + (system.willpower?.aggravated ?? 0)
      return max > 0 && filled >= max
    }
  },
  // Not shipped in wod5e's own Conditions compendium - built inline below.
  // Humanity has no explicit "max" field in wod5e's data model (it's a
  // fixed 0-10 scale, matching the Remorse roll's own hardcoded "10 -
  // humanity - stains" formula in roll-remorse.js), so "empty boxes" is
  // just 10 - value.
  //
  // >= not > : wod5e's own automatic Stain-granting (_applyOblivionStains,
  // fired on failed Rouse Checks) explicitly caps new stains at
  // `10 - humanity.value` - it can reach that number but never exceed it
  // (Math.min(stains + amount, 10 - value)). A strict > check could
  // therefore never trigger from that automatic path at all, which is what
  // was actually happening - not a missing feature, a real off-by-one. >=
  // mirrors the same "tracker is completely full" pattern health/willpower
  // already use (filled >= max) and correctly fires the moment an
  // automatic Stain grant hits wod5e's own cap. Manually-awarded Stains
  // (Storyteller discretion, typed directly into the sheet) aren't capped
  // by that helper and can still exceed the threshold outright.
  humanity: {
    label: 'Humanity Impairment',
    isActive: (system) => {
      const value = system.humanity?.value ?? 0
      const stains = system.humanity?.stains ?? 0
      return stains >= (10 - value)
    }
  }
}

let cachedConditionDocs = null

export function registerImpairmentConditions() {
  Hooks.on('updateActor', async (actor, changes) => {
    const touchesTrackedData = ['health', 'willpower', 'humanity'].some(
      (key) => foundry.utils.hasProperty(changes, `system.${key}`)
    )
    if (!touchesTrackedData) return

    await reconcileImpairments(actor)
  })

  // Catches actors that already meet an Impairment threshold when this
  // feature is first added to an existing campaign (or on every world
  // load, cheap enough not to matter) - without this, a character already
  // sitting at a full Health track wouldn't get Impaired until their next
  // Health change.
  Hooks.once('ready', async () => {
    if (!game.user.isGM) return
    for (const actor of game.actors) {
      await reconcileImpairments(actor)
    }
  })
}

// Per-actor queue of reconciliation passes. Hooks.on's async handlers are
// NOT serialized by Foundry - if two health/willpower updates land close
// together for the SAME actor (two damage applications in quick
// succession, a superficial+aggravated combo, etc), the resulting
// updateActor events can each start their own async reconcileImpairments
// call before the previous one has actually finished its
// createEmbeddedDocuments/deleteEmbeddedDocuments await - both read the
// same stale item list and both act on it. Queuing per actor makes the
// second call wait for the first to fully complete before it even reads
// actor.items, closing the race at its real source (same-client, not
// cross-client as originally assumed) instead of just cleaning up after it.
const reconcileQueues = new Map()

async function reconcileImpairments(actor) {
  // gamesystem is derived from actor.type (vampire, ghoul) or, for SPCs,
  // from system.spcType - checking it alone (rather than actor.type)
  // correctly covers vampire NPCs built as SPCs too.
  if (actor.system?.gamesystem !== 'vampire') return

  // Single-authority, same reasoning as cleanupSourceMessages in
  // roll-utils.js: every connected client sees the same updateActor event,
  // so without this every eligible client would race to create/delete the
  // same condition item. A GM can always edit any actor, so GM alone
  // reconciles when one's active; fall back to the actor's own owner only
  // when no GM is connected.
  const gmActive = game.users.some((u) => u.active && u.isGM)
  if (!game.user.isGM && (gmActive || !actor.isOwner)) return

  const previous = reconcileQueues.get(actor.id) ?? Promise.resolve()
  const next = previous
    .then(() => runReconcile(actor))
    .catch((err) => console.error(`${MODULE_ID} | Impairment reconciliation failed`, err))
  reconcileQueues.set(actor.id, next)
  await next
}

async function runReconcile(actor) {
  for (const [key, def] of Object.entries(IMPAIRMENT_DEFS)) {
    const shouldBeActive = def.isActive(actor.system)
    const matches = actor.items.filter(
      (i) => i.type === 'condition' && i.getFlag(MODULE_ID, 'impairmentKey') === key
    )

    if (shouldBeActive && matches.length === 0) {
      const itemData = await getConditionItemData(key, def)
      if (itemData) await actor.createEmbeddedDocuments('Item', [itemData])
    } else if (!shouldBeActive && matches.length > 0) {
      await deleteItemsSafely(actor, matches)
    } else if (shouldBeActive && matches.length > 1) {
      // Self-healing cleanup for a genuine cross-client race the queue
      // above can't close (it only protects against THIS client racing
      // itself) - two GM-privileged clients (a co-GM, or the same GM
      // account open in two tabs) can still both decide they're "the"
      // authority at the same moment. Keep the oldest copy, remove extras.
      const [, ...extras] = matches
      await deleteItemsSafely(actor, extras)
    }
  }
}

// A cross-client race can still slip through (see above) where two clients
// both try to delete the same duplicate - whichever loses that race hits a
// "does not exist" error from the server since the item's already gone by
// the time its request lands. That's not actually a problem (the end state
// is correct either way), so swallow it here instead of letting it surface
// as an uncaught error.
async function deleteItemsSafely(actor, items) {
  try {
    await actor.deleteEmbeddedDocuments('Item', items.map((i) => i.id))
  } catch (err) {
    console.warn(`${MODULE_ID} | Some condition items were already removed (likely a concurrent update from another client)`, err)
  }
}

async function getConditionItemData(key, def) {
  if (key === 'humanity') {
    return {
      name: def.label,
      type: 'condition',
      img: 'systems/wod5e/assets/icons/items/item-default.svg',
      system: {
        description: 'Stains exceed empty Humanity boxes (corebook p. 209, "Degeneration") - a two-dice penalty to ALL pools until Remorse is tested at the end of the session, or a point of Humanity is voluntarily lost to clear the Stains early.',
        bonuses: [{
          source: def.label,
          value: '-2',
          paths: ['all'],
          displayWhenInactive: false,
          activeWhen: { check: 'always', path: '', value: '' }
        }],
        source: { book: 'Corebook', page: '209' },
        effects: {},
        suppressed: false
      },
      flags: { [MODULE_ID]: { impairmentKey: key } }
    }
  }

  // Health/Willpower Impairment ship in wod5e's own Conditions compendium -
  // sourcing from there instead of hardcoding a duplicate copy means this
  // stays correct if wod5e ever changes the wording or exact values.
  const sourceDoc = await findCompendiumCondition(def.compendiumDataItemId, def.label)
  if (!sourceDoc) {
    ui.notifications.warn(`${MODULE_ID} | Couldn't find "${def.label}" in the wod5e Conditions compendium - is the wod5e system up to date?`)
    return null
  }

  const data = sourceDoc.toObject()
  delete data._id
  data.flags = { ...data.flags, [MODULE_ID]: { impairmentKey: key } }
  return data
}

async function findCompendiumCondition(dataItemId, label) {
  if (!cachedConditionDocs) {
    const pack = game.packs.get(CONDITIONS_PACK)
    if (!pack) return null
    cachedConditionDocs = await pack.getDocuments()
  }

  return cachedConditionDocs.find(
    (doc) => doc.getFlag('wod5e', 'dataItemId') === dataItemId || doc.name === label
  ) ?? null
}
