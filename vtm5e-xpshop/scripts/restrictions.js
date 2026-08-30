// Re-implements (not imports) the small restriction/conflict/rating-cap
// checks from vtm5e-chargen/scripts/grant-engine.js. The DATA these read
// (flags['vtm5e-chargen'].restrictions/conflictsWith/ratingCap) lives on the
// vtm5e-meritsflaws compendium items themselves, not on the chargen module -
// re-implementing here keeps this module standalone (works with vtm5e-chargen
// disabled), same reasoning already used elsewhere in this project for
// duplicating small lookups (e.g. Compulsion text in vtm5e-charactersheet vs
// vtm5e-automation).
//
// One deliberate behavior change from the chargen original: chargen's
// `ghoulOnly` branch is hardcoded to always fail ("this wizard only ever
// builds vampire characters"). This shop DOES serve Ghoul actors, so that
// branch is a real check here, not a copy-pasted always-fail.

function capitalize (id) {
  return id.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

export function checkRestrictions (actor, restrictions) {
  const failures = []
  for (const r of restrictions || []) {
    if (r.type === 'excludeClan') {
      const clanItem = actor.items.find(i => i.type === 'clan')
      if (clanItem && r.clans.includes(clanItem.name.toLowerCase())) {
        failures.push(`Not available to Clan ${clanItem.name}.`)
      }
    } else if (r.type === 'requireClan') {
      const clanItem = actor.items.find(i => i.type === 'clan')
      if (!clanItem || !r.clans.includes(clanItem.name.toLowerCase())) {
        failures.push(`Only available to Clan ${r.clans.map(capitalize).join(' or ')}.`)
      }
    } else if (r.type === 'ghoulOnly') {
      if (actor.type !== 'ghoul') {
        failures.push('Only available to Ghoul characters.')
      }
    } else if (r.type === 'maxBloodPotency') {
      if ((actor.system.blood?.potency ?? 0) > r.value) {
        failures.push(`Requires Blood Potency ${r.value} or lower (currently ${actor.system.blood?.potency ?? 0}).`)
      }
    } else if (r.type === 'minHaven') {
      const rating = getHavenRating(actor)
      if (rating < r.value) {
        failures.push(`Requires Base Haven ${r.value}+ (currently ${rating}).`)
      }
    }
  }
  return failures
}

function getHavenRating (actor) {
  return actor.items.find(i => i.type === 'feature' && i.name === 'Base Haven')?.system.points ?? 0
}

// doc.flags['vtm5e-chargen'].ratingCap = { unless: <a single restriction>, cap: n }.
// Returns the cap to enforce, or null if the "unless" condition is met.
export function getRatingCap (actor, doc) {
  const rule = doc.flags?.['vtm5e-chargen']?.ratingCap
  if (!rule) return null
  const failures = checkRestrictions(actor, [rule.unless])
  return failures.length > 0 ? rule.cap : null
}

export function checkConflicts (actor, itemName, conflictsWith) {
  if (!conflictsWith || conflictsWith.length === 0) return []
  const heldNames = new Set(actor.items.filter(i => i.type === 'feature').map(i => i.name))
  return conflictsWith.filter(name => heldNames.has(name))
}
