// Applies a finalized cart to the actor in as few calls as possible - unlike
// vtm5e-chargen's grant-engine.js (which applies grants incrementally over
// time with a reversible ledger), a shop commit is atomic: nothing is
// reversible, so there's no need for per-line actor.update() calls or entry
// tracking. Three calls total regardless of cart size:
//   1. one actor.update() for every scalar delta (attributes/skills/
//      disciplines/blood potency/specialty bonuses/experience history)
//   2. one createEmbeddedDocuments('Item') for genuinely new items
//      (Discipline Powers are always new; new Advantages)
//   3. one updateEmbeddedDocuments('Item') for dot raises on Advantages the
//      actor already owns

export async function commitCart (actor, cart) {
  const scalarUpdates = {}
  const newItems = []
  const itemUpdates = []
  const experienceEntries = []

  // ---- Attributes / Skills / Blood Potency (one cart entry each, already
  // deduplicated per-trait by the app before it ever reaches the cart) ----
  for (const entry of cart) {
    if (entry.category === 'attributes') {
      scalarUpdates[`system.attributes.${entry.traitId}.value`] = entry.targetLevel
    } else if (entry.category === 'skills') {
      scalarUpdates[`system.skills.${entry.traitId}.value`] = entry.targetLevel
    } else if (entry.category === 'bloodpotency') {
      scalarUpdates['system.blood.potency'] = entry.targetLevel
    }
  }

  // ---- Specialties: accumulate onto each skill's existing bonuses array ----
  const specialtyEntries = cart.filter(e => e.category === 'specialties')
  const bonusesBySkill = {}
  for (const entry of specialtyEntries) {
    if (!bonusesBySkill[entry.skillId]) {
      bonusesBySkill[entry.skillId] = foundry.utils.deepClone(actor.system.skills?.[entry.skillId]?.bonuses || [])
    }
    bonusesBySkill[entry.skillId].push({
      source: entry.text,
      value: 1,
      paths: [`skills.${entry.skillId}`],
      displayWhenInactive: true
    })
  }
  for (const [skillId, bonuses] of Object.entries(bonusesBySkill)) {
    scalarUpdates[`system.skills.${skillId}.bonuses`] = bonuses
  }

  // ---- Disciplines: final value = highest level reached across all cart
  // entries for that discipline; every entry also creates its own Power item ----
  const disciplineEntries = cart.filter(e => e.category === 'disciplines')
  const finalDisciplineLevel = {}
  for (const entry of disciplineEntries) {
    const current = finalDisciplineLevel[entry.traitId] ?? (actor.system.disciplines?.[entry.traitId]?.value ?? 0)
    finalDisciplineLevel[entry.traitId] = Math.max(current, entry.targetLevel)

    const compendiumDoc = await fromUuid(`Compendium.vtm5e-disciplines.disciplines.Item.${entry.powerId}`)
    if (compendiumDoc) {
      const data = compendiumDoc.toObject()
      delete data._id
      delete data.ownership
      newItems.push(data)
    } else {
      console.warn(`vtm5e-xpshop | Discipline Power "${entry.powerName}" (${entry.powerId}) not found in compendium at commit time - skipped.`)
    }
  }
  for (const [disciplineId, level] of Object.entries(finalDisciplineLevel)) {
    scalarUpdates[`system.disciplines.${disciplineId}.value`] = level
    scalarUpdates[`system.disciplines.${disciplineId}.visible`] = true
  }

  // ---- Advantages: raise existing item, or create a new one ----
  const advantageEntries = cart.filter(e => e.category === 'advantages')
  for (const entry of advantageEntries) {
    const existing = actor.items.find(i => i.type === 'feature' && i.name === entry.name)
    if (existing) {
      itemUpdates.push({ _id: existing.id, 'system.points': entry.targetLevel })
    } else {
      const compendiumDoc = await fromUuid(`Compendium.vtm5e-meritsflaws.meritsflaws.Item.${entry.compendiumId}`)
      if (compendiumDoc) {
        const data = compendiumDoc.toObject()
        delete data._id
        delete data.ownership
        data.system.points = entry.targetLevel
        newItems.push(data)
      } else {
        console.warn(`vtm5e-xpshop | Advantage "${entry.name}" (${entry.compendiumId}) not found in compendium at commit time - skipped.`)
      }
    }
  }

  // ---- Experience history: one negative entry per cart line, same shape
  // as wod5e's own stock Spend dialog already writes ----
  for (const entry of cart) {
    experienceEntries.push({
      id: foundry.utils.randomID(8),
      name: entry.label,
      value: -Math.abs(entry.cost),
      timestamp: Date.now()
    })
  }
  const existingExperiences = actor.system.experiences || []
  scalarUpdates['system.experiences'] = [...existingExperiences, ...experienceEntries]

  await actor.update(scalarUpdates)
  if (newItems.length > 0) await actor.createEmbeddedDocuments('Item', newItems)
  if (itemUpdates.length > 0) await actor.updateEmbeddedDocuments('Item', itemUpdates)
}
