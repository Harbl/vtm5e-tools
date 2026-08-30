/**
 * Whether an actor can currently attempt a Rouse Check at all. wod5e's own
 * _rollItem auto-fires a Rouse Check for any vampire-gamesystem power with
 * system.cost > 0 (system/actor/scripts/item-roll.js's callback), with no
 * gate of its own - a Final Death vampire (Health track entirely
 * Aggravated) obviously shouldn't still be able to activate Disciplines, so
 * this exists to catch that specific case before the roll ever starts.
 * Non-vampire actor types (ghouls, mortals) don't roll Rouse Checks at all
 * (ghouls take Aggravated damage instead per _onRouseCheck), so this only
 * ever blocks for vampires.
 *
 * Known gap: Torpor (Health track entirely Superficial) should also block
 * this, but Torpor isn't tracked anywhere in this module yet - it was
 * explicitly deprioritized early on. Only Final Death is checked for now.
 */
export function canActorRouse(actor) {
  if (actor?.system?.gamesystem !== 'vampire' || actor?.type === 'ghoul') return true

  const health = actor.system.health
  if (!health) return true

  return health.aggravated < health.max
}
