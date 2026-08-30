import { getRoutingTargets } from './socket-routing.js'

const MODULE_ID = 'vtm5e-automation'
const RELAY_FLAG = 'privilegedActorWrite'

// Actions are plain, JSON-serializable data (never a closure - the whole
// point is these can travel through a chat message's flags to a different
// client) executed by executeRelayedAction below, on whichever client
// actually receives the relay.
const HANDLERS = {
  async deleteConditionByName(actor, { name }) {
    const item = actor.items.find((i) => i.type === 'condition' && i.name === name)
    if (item) await actor.deleteEmbeddedDocuments('Item', [item.id]).catch(() => {})
  },
  async applyStatusCondition(actor, { spec }) {
    const { applyStatusCondition } = await import('./condition-application.js')
    await applyStatusCondition(actor, spec)
  }
  // 'applyDamage' is NOT in this table - it needs a Token (for
  // applyDamageToTarget), not just an Actor, so it's handled as a special
  // case directly in registerPrivilegedWriteRelay below, via
  // performPrivilegedDamage's own relay path instead of performPrivilegedWrite.
}

/**
 * Performs a privileged write against `actor` - directly, if the current
 * client already has permission (the common case: GM controls the NPC, or
 * the actor being written to is the player's own character), or relayed to
 * whichever client(s) actually control it otherwise.
 *
 * The opposed-roll flow (opposing-roll-trigger.js) runs entirely on the
 * ATTACKER's client, but several of its effects - stale defense-condition
 * cleanup, on-hit status conditions (Burning/Blinded/Staked/etc), damage,
 * Taser - land on the DEFENDER's actor. When the attacker is a player and
 * the defender is a GM-only NPC, that write has always silently failed
 * with a Foundry permission error, aborting the whole resolution chain
 * (including the recap card, which never got a chance to post - the two
 * looked like separate bugs but share this one root cause).
 *
 * Relayed via a whispered chat message - the SAME reliable cross-client
 * delivery this module already uses for defense prompts (see
 * getRoutingTargets/promptWeaponDefense in opposing-roll-trigger.js, and
 * the header comment in social-conflict.js explaining why a raw
 * game.socket.emit push was tried and abandoned in favor of this). Not a
 * request/response round-trip - callers that need to DISPLAY a resulting
 * number (e.g. the recap card's post-armor damage amount) must compute it
 * separately via a read-only calculation first (damage-application.js's
 * computeAppliedDamage already exists for exactly this), since nothing
 * here waits for the relay target to finish.
 */
export async function performPrivilegedWrite(actor, type, payload) {
  if (!actor) return

  if (actor.isOwner) {
    await HANDLERS[type](actor, payload)
    return
  }

  const routingTargets = getRoutingTargets(actor)
  if (routingTargets.length === 0) {
    console.warn(`${MODULE_ID} | No one online can apply a privileged write to ${actor.name} (${type}) - skipped.`)
    return
  }

  await ChatMessage.create({
    content: '',
    whisper: routingTargets.map((u) => u.id),
    flags: { [MODULE_ID]: { [RELAY_FLAG]: { actorId: actor.id, type, payload } } }
  })
}

// Token-carrying actions (applyDamage) can't serialize a Token placeable
// through chat-message flags - re-resolved by actorId + tokenId on the
// receiving side instead. Wraps performPrivilegedWrite for that one case.
export async function performPrivilegedDamage(token, amount, damageType, options) {
  const actor = token?.actor
  if (!actor) return

  if (actor.isOwner) {
    const { applyDamageToTarget } = await import('./damage-application.js')
    await applyDamageToTarget(token, amount, damageType, options)
    return
  }

  const routingTargets = getRoutingTargets(actor)
  if (routingTargets.length === 0) {
    console.warn(`${MODULE_ID} | No one online can apply damage to ${actor.name} - skipped.`)
    return
  }

  await ChatMessage.create({
    content: '',
    whisper: routingTargets.map((u) => u.id),
    flags: {
      [MODULE_ID]: {
        [RELAY_FLAG]: {
          actorId: actor.id,
          type: 'applyDamage',
          payload: { tokenId: token.id, sceneId: token.scene?.id, amount, damageType, options }
        }
      }
    }
  })
}

export function registerPrivilegedWriteRelay() {
  Hooks.on('createChatMessage', async (message) => {
    const relay = message.getFlag(MODULE_ID, RELAY_FLAG)
    if (!relay || !message.whisper?.includes(game.user.id)) return

    const actor = game.actors.get(relay.actorId)
    if (!actor?.isOwner) return

    if (relay.type === 'applyDamage') {
      const scene = relay.payload.sceneId ? game.scenes.get(relay.payload.sceneId) : canvas.scene
      const token = scene?.tokens.get(relay.payload.tokenId)
      if (!token?.object) return
      const { applyDamageToTarget } = await import('./damage-application.js')
      await applyDamageToTarget(token.object, relay.payload.amount, relay.payload.damageType, relay.payload.options)
      return
    }

    const handler = HANDLERS[relay.type]
    if (handler) await handler(actor, relay.payload)
  })
}
