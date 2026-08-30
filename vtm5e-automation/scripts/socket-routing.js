/**
 * Determine which connected user(s) should handle a prompt on behalf of an
 * actor: the actual player owner(s) if any are currently online, otherwise
 * any currently active GM - matches the standard "GM plays the NPCs" model.
 * Returns an empty array if nobody eligible is currently connected.
 *
 * Delivery of prompts to those users is handled via whispered chat messages
 * (document sync, proven reliable), not a custom socket channel - see the
 * comment at the top of social-conflict.js for why a raw game.socket.emit
 * approach was tried first and didn't work.
 */
export function getRoutingTargets(actor) {
  const playerOwners = game.users.filter(
    (u) => u.active && !u.isGM && actor.testUserPermission(u, 'OWNER')
  )
  if (playerOwners.length > 0) return playerOwners

  return game.users.filter((u) => u.active && u.isGM)
}

/**
 * Whether an actor is actually being played by a connected non-GM user right
 * now, as opposed to only the GM controlling it (an NPC, for automation
 * purposes) - deliberately ownership-based rather than actor.type, since a
 * GM can and does reuse PC-type actors as ad hoc NPCs. This is the same
 * "who's really driving this actor" question getRoutingTargets answers,
 * factored out so the per-step NPC/Player automation settings can use the
 * identical rule for deciding which bucket of settings applies.
 */
export function isPlayerControlled(actor) {
  return game.users.some((u) => u.active && !u.isGM && actor.testUserPermission(u, 'OWNER'))
}
