// "Feed" button (header quick-rolls, next to Rouse/Frenzy): rolls the
// character's Predator Type dicepool (same dice-computation as wod5e's
// own _rollItem in system/actor/scripts/item-roll.js - duplicated rather
// than reused because _rollItem's own callback is hardcoded to the Rouse-
// check flow for cost>0 items and doesn't accept an external one), then
// on a successful roll asks what kind of vessel it was (Human/Animal/
// Kindred, 2026-07-28) and branches into the matching Feeding rules
// (corebook p.212-213) before rolling the V5 corebook's own Random
// Temperament / Random Resonance tables (p.229) and applying the result -
// embedding a matching Resonance Item from vtm5e-disciplines.disciplines
// (see configure-resonances-compendium.js) on Intense/Acute, or just
// narrating Fleeting/none in chat.
//
// Deliberately does NOT try to automate which specific feeding method was
// used (sip/full drink/kill/animal size/etc.) beyond letting the player
// pick the resulting Hunger loss from the corebook's Feeding Table - the
// "Harmful drink" tier (Aggravated damage to the victim, corebook p.212)
// is left out entirely since it targets a vessel this module has no
// tracking for; narrating HOW the feed happened, and any Masquerade/
// witness complications on a failed roll, stays a table/Storyteller call,
// not something this button decides. Likewise Dyscrasia effects on an
// Acute result are flagged, not assigned - the corebook is explicit that
// these should be curated per-vessel by the Storyteller (p.229), not
// randomly generated.

import { getActiveModifiers } from '/systems/wod5e/system/scripts/rolls/situational-modifiers.js'

const RESONANCE_PACK_ID = 'vtm5e-disciplines.disciplines'

const RESONANCE_TABLE = [
  { min: 1, max: 3, name: 'Phlegmatic' },
  { min: 4, max: 6, name: 'Melancholic' },
  { min: 7, max: 8, name: 'Choleric' },
  { min: 9, max: 10, name: 'Sanguine' }
]

function d10Result (roll) {
  return roll.total === 10 ? 10 : roll.total
}

function pickFromTable (table, rollValue) {
  return table.find((row) => rollValue >= row.min && rollValue <= row.max)
}

async function rollTemperament () {
  const roll = await new Roll('1d10').evaluate()
  const value = d10Result(roll)

  if (value <= 5) return { temperament: 'none', roll }
  if (value <= 8) return { temperament: 'fleeting', roll }

  // 9-10: Intense, potentially Acute - roll again
  const secondRoll = await new Roll('1d10').evaluate()
  const secondValue = d10Result(secondRoll)
  const temperament = secondValue >= 9 ? 'acute' : 'intense'

  return { temperament, roll, secondRoll }
}

async function rollResonanceType () {
  const roll = await new Roll('1d10').evaluate()
  const value = d10Result(roll)
  const row = pickFromTable(RESONANCE_TABLE, value)

  return { name: row.name, roll }
}

async function clearExistingResonance (actor) {
  const existing = actor.items.filter((i) => i.type === 'resonance')
  if (existing.length > 0) {
    await actor.deleteEmbeddedDocuments('Item', existing.map((i) => i.id))
  }
}

async function applyResonance (actor, resonanceName, isAcute) {
  const pack = game.packs.get(RESONANCE_PACK_ID)
  if (!pack) {
    ui.notifications.error(`vtm5e-charactersheet | Resonance pack "${RESONANCE_PACK_ID}" not found - is vtm5e-disciplines active?`)
    return null
  }

  const docs = await pack.getDocuments()
  const source = docs.find((d) => d.type === 'resonance' && d.name === resonanceName)
  if (!source) {
    ui.notifications.error(`vtm5e-charactersheet | No "${resonanceName}" Resonance found in the compendium - try re-running configure-resonances-compendium.js`)
    return null
  }

  await clearExistingResonance(actor)

  const strengthLabel = isAcute ? 'Acute' : 'Intense'
  const itemData = source.toObject()
  delete itemData._id
  itemData.name = `${source.name} (${strengthLabel})`
  if (isAcute) {
    itemData.system.description += '<p><b>Dyscrasia:</b> this vessel carried a Dyscrasia on top of the Acute Resonance bonus - ask your Storyteller what it does.</p>'
  }

  const [created] = await actor.createEmbeddedDocuments('Item', [itemData])
  return created
}

function buildFeedResultHTML ({ title = 'Feeding Result', hungerLabel, hungerAmount, hungerBefore, hungerAfter, temperamentResult, resonanceResult, extraRows = [], skipResonance = false }) {
  const rows = [
    `<p class="vtm5e-cs-feed-title"><b>${title}</b></p>`,
    `<p>${hungerLabel}: Hunger ${hungerBefore} → ${hungerAfter} (-${hungerAmount})</p>`,
    ...extraRows
  ]

  if (skipResonance) {
    // no-op - vitae (Kindred vessel) doesn't carry a Resonance roll
  } else if (!temperamentResult || temperamentResult.temperament === 'none') {
    rows.push('<p>Resonance: well-balanced vessel, no meaningful Resonance.</p>')
  } else if (temperamentResult.temperament === 'fleeting') {
    rows.push(`<p>Resonance: Fleeting ${resonanceResult.name} - flavor only, no mechanical bonus.</p>`)
  } else {
    const strength = temperamentResult.temperament === 'acute' ? 'Acute (Dyscrasia)' : 'Intense'
    rows.push(`<p>Resonance: <b>${strength} ${resonanceResult.name}</b> - +1 die applied to its linked Disciplines until your next feed or Hunger 5.</p>`)
    if (temperamentResult.temperament === 'acute') {
      rows.push('<p><em>This vessel carried a Dyscrasia - check with your Storyteller for its specific effect.</em></p>')
    }
  }

  return `<div class="vtm5e-cs-feed-result">${rows.join('')}</div>`
}

async function handleHumanFeed (actor) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: 'How much did you slake?' },
    content: '<p>Per the Feeding Table (corebook p.212) - pick the closest match to how the scene played out.</p>',
    buttons: [
      { action: 'sip', label: 'Sip (1 Hunger)' },
      { action: 'drink', label: 'Full Drink (2 Hunger)' },
      { action: 'kill', label: 'Drain & Kill (5 Hunger)' },
      { action: 'none', label: 'No Slake' }
    ]
  })

  if (!choice || choice === 'none') return

  const HUNGER_BY_CHOICE = { sip: 1, drink: 2, kill: 5 }
  const LABEL_BY_CHOICE = { sip: 'Sip', drink: 'Full Drink', kill: 'Drain & Kill' }
  const hungerAmount = HUNGER_BY_CHOICE[choice]

  const hungerBefore = actor.system.hunger.value
  const hungerAfter = Math.max(hungerBefore - hungerAmount, 0)
  await actor.update({ 'system.hunger.value': hungerAfter })

  const temperamentResult = await rollTemperament()
  let resonanceResult = null

  if (temperamentResult.temperament === 'none') {
    await clearExistingResonance(actor)
  } else if (temperamentResult.temperament === 'fleeting') {
    await clearExistingResonance(actor)
    resonanceResult = await rollResonanceType()
  } else {
    resonanceResult = await rollResonanceType()
    await applyResonance(actor, resonanceResult.name, temperamentResult.temperament === 'acute')
  }

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: buildFeedResultHTML({
      title: 'Feeding Result - Human Vessel',
      hungerLabel: LABEL_BY_CHOICE[choice],
      hungerAmount,
      hungerBefore,
      hungerAfter,
      temperamentResult,
      resonanceResult
    })
  })
}

// Feeding from Animals (corebook p.212) - Hunger slaked is capped by the
// animal's size rather than a sip/drink/kill choice, and above Blood
// Potency 2 animal blood can't slake any Hunger at all. Animal blood is
// always its own single Resonance category (never one of the 4 human
// humors, and per p.227 never carries a Dyscrasia) - so the humor-table
// roll (rollResonanceType) is skipped entirely in favor of a fixed
// 'Animal Blood' name, and an Acute result downgrades to Intense.
async function handleAnimalFeed (actor) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: 'Animal Feeding (corebook p.212)' },
    content: '<p>Feeding from an animal usually kills it. Pick the closest match to the scene.</p>',
    buttons: [
      { action: 'small', label: 'Multiple Small Animals (1 Hunger)' },
      { action: 'medium', label: 'Medium Animal (1 Hunger)' },
      { action: 'large', label: 'Large Animal, e.g. Horse (2 Hunger)' },
      { action: 'none', label: 'No Slake' }
    ]
  })

  if (!choice || choice === 'none') return

  const HUNGER_BY_CHOICE = { small: 1, medium: 1, large: 2 }
  const LABEL_BY_CHOICE = { small: 'Multiple Small Animals', medium: 'Medium Animal', large: 'Large Animal' }

  const bloodPotency = actor.system.blood?.potency ?? 0
  const cappedByPotency = bloodPotency > 2
  const hungerAmount = cappedByPotency ? 0 : HUNGER_BY_CHOICE[choice]

  const hungerBefore = actor.system.hunger.value
  const hungerAfter = Math.max(hungerBefore - hungerAmount, 0)
  if (hungerAmount > 0) await actor.update({ 'system.hunger.value': hungerAfter })

  let temperamentResult = null
  const resonanceResult = { name: 'Animal Blood' }

  if (hungerAmount > 0) {
    temperamentResult = await rollTemperament()
    if (temperamentResult.temperament === 'acute') temperamentResult.temperament = 'intense'

    if (temperamentResult.temperament === 'none') {
      await clearExistingResonance(actor)
    } else if (temperamentResult.temperament === 'fleeting') {
      await clearExistingResonance(actor)
    } else {
      await applyResonance(actor, 'Animal Blood', false)
    }
  } else {
    await clearExistingResonance(actor)
  }

  const extraRows = cappedByPotency
    ? ['<p><em>Blood Potency above 2 - animal blood can\'t slake any Hunger (corebook p.212).</em></p>']
    : []

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: buildFeedResultHTML({
      title: 'Feeding Result - Animal Vessel',
      hungerLabel: LABEL_BY_CHOICE[choice],
      hungerAmount,
      hungerBefore,
      hungerAfter,
      temperamentResult,
      resonanceResult,
      extraRows
    })
  })
}

// Feeding from Other Vampires (corebook p.213) - a wholly different
// mechanic from human/animal vessels: Hunger slaked depends on the gap
// between the two vampires' Blood Potency, not a fixed table. No
// Temperament/Resonance roll (vitae doesn't carry a vessel's Resonance the
// way blood-with-a-heartbeat does). The donor isn't necessarily a
// controlled actor in this scene, so this only tracks the feeding
// vampire's own Hunger - the Hunger inflicted on the donor, and any Blood
// Bond risk (p.233), are flagged in the chat card for the Storyteller to
// apply by hand rather than guessed at by targeting an arbitrary actor.
async function handleKindredFeed (actor) {
  const myPotency = actor.system.blood?.potency ?? 0

  const result = await foundry.applications.api.DialogV2.input({
    window: { title: 'Feeding from Another Kindred (corebook p.213)' },
    content: `
      <form class="vtm5e-cs-kindred-feed-dialog">
        <div class="form-group">
          <label>Hunger points inflicted on the donor</label>
          <input type="number" name="inflicted" value="1" min="1" max="5" step="1" />
        </div>
        <div class="form-group">
          <label>Donor's Blood Potency</label>
          <input type="number" name="donorPotency" value="${myPotency}" min="0" max="10" step="1" />
        </div>
      </form>
    `,
    ok: { icon: 'fas fa-check', label: 'Feed' },
    buttons: [{ action: 'cancel', icon: 'fas fa-times', label: 'Cancel' }],
    classes: ['wod5e']
  })

  if (!result || result === 'cancel') return

  const inflicted = Number(result.inflicted) || 0
  const donorPotency = Number(result.donorPotency) || 0
  if (inflicted <= 0) return

  const gap = donorPotency - myPotency
  let hungerAmount
  if (gap >= 2) hungerAmount = inflicted * 2
  else if (gap <= -2) hungerAmount = Math.floor(inflicted / 2)
  else hungerAmount = inflicted

  const hungerBefore = actor.system.hunger.value
  const hungerAfter = Math.max(hungerBefore - hungerAmount, 0)
  await actor.update({ 'system.hunger.value': hungerAfter })
  await clearExistingResonance(actor)

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: buildFeedResultHTML({
      title: 'Feeding Result - Kindred Vessel',
      hungerLabel: `Inflicted ${inflicted} Hunger on the donor (Blood Potency ${donorPotency})`,
      hungerAmount,
      hungerBefore,
      hungerAfter,
      extraRows: ['<p><em>Apply the inflicted Hunger to the donor\'s sheet by hand if they\'re a controlled actor. Feeding directly from another vampire risks a Blood Bond (corebook p.233) - not tracked by this module.</em></p>'],
      skipResonance: true
    })
  })
}

// Drinking an owned Blood Bag (see configure-shops-clinic.js - The Night
// Ward sells them, $349.99+ per Jake's real-world-cost floor) is
// guaranteed, no roll, no Masquerade risk, no Resonance (not a live
// vessel) - but per Jake's call it only restores a sip (1 Hunger), same
// floor as the weakest human-feeding option.
async function handleBloodBagFeed (actor, bloodBag) {
  const hungerBefore = actor.system.hunger.value
  const hungerAfter = Math.max(hungerBefore - 1, 0)
  await actor.update({ 'system.hunger.value': hungerAfter })

  const remaining = (bloodBag.system.quantity ?? 1) - 1
  if (remaining > 0) await bloodBag.update({ 'system.quantity': remaining })
  else await bloodBag.delete()

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: buildFeedResultHTML({
      title: 'Feeding Result - Blood Bag',
      hungerLabel: 'Sip',
      hungerAmount: hungerBefore - hungerAfter,
      hungerBefore,
      hungerAfter,
      extraRows: ['<p><em>Ethically sourced - no hunting roll, no Resonance, no Masquerade risk.</em></p>'],
      skipResonance: true
    })
  })
}

export async function onFeed (actor) {
  const bloodBag = actor.items.find((i) => i.name === 'Blood Bags' && i.type === 'gear' && (i.system.quantity ?? 1) > 0)

  if (bloodBag) {
    const mode = await foundry.applications.api.DialogV2.wait({
      window: { title: 'How are you feeding?' },
      content: `<p>You have ${bloodBag.system.quantity ?? 1} Blood Bag(s) on hand - drinking one is guaranteed but only restores a sip.</p>`,
      buttons: [
        { action: 'bloodbag', label: 'Drink a Blood Bag (Sip, 1 Hunger)' },
        { action: 'hunt', label: 'Hunt for a Vessel' }
      ]
    })
    if (!mode) return
    if (mode === 'bloodbag') {
      await handleBloodBagFeed(actor, bloodBag)
      return
    }
  }

  const predator = actor.items.find((i) => i.type === 'predatorType')
  if (!predator) {
    ui.notifications.warn('Pick a Predator Type before feeding - click "Select Predator" in the header.')
    return
  }

  const dicepool = predator.system.dicepool || {}
  const valuePaths = []
  let selectors = ['feeding']
  for (const key in dicepool) {
    const path = dicepool[key]?.path
    if (!path) continue
    selectors = selectors.concat(path.split('.'))
    selectors.push(path)
    valuePaths.push(`${path}.value`)
  }

  if (valuePaths.length === 0) {
    ui.notifications.warn(`${predator.name} doesn't have a Predator Pool set - roll feeding manually this time.`)
    return
  }

  const activeModifiers = await getActiveModifiers({ actor, selectors })

  let basicDice = await WOD5E.api.getBasicDice({
    valuePaths,
    flatMod: activeModifiers.totalValue,
    actor
  })
  let advancedDice = await WOD5E.api.getAdvancedDice({ actor })

  // Mix Hunger dice into the pool the same way every other vampire roll
  // does (mirrors _rollItem in wod5e's own item-roll.js)
  advancedDice = Math.min(basicDice, advancedDice)
  basicDice = Math.max(basicDice - advancedDice, 0)

  WOD5E.api.Roll({
    basicDice,
    advancedDice,
    actor,
    data: actor.system,
    title: `Feed - ${predator.name}`,
    difficulty: 2,
    flavor: predator.system.description || '',
    selectors,
    callback: async (err, roll) => {
      if (err) {
        console.error('vtm5e-charactersheet | Feed roll error:', err)
        return
      }
      if (!roll.rollSuccessful) {
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: '<p class="vtm5e-cs-feed-title"><b>Feeding Result</b></p><p>The hunt didn\'t pan out this time - no Hunger slaked, no Resonance. Your Storyteller may have a complication in mind.</p>'
        })
        return
      }

      const vesselType = await foundry.applications.api.DialogV2.wait({
        window: { title: 'What kind of vessel?' },
        content: '<p>Per the Feeding rules (corebook p.212-213) - what did you feed on?</p>',
        buttons: [
          { action: 'human', label: 'Human' },
          { action: 'animal', label: 'Animal' },
          { action: 'kindred', label: 'Another Kindred' }
        ]
      })

      if (vesselType === 'animal') await handleAnimalFeed(actor)
      else if (vesselType === 'kindred') await handleKindredFeed(actor)
      else if (vesselType === 'human') await handleHumanFeed(actor)
    }
  })
}
