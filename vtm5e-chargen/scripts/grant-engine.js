// Applies flags.vtm5e-chargen.grants entries (see vtm5e-predatortypes /
// vtm5e-clans / vtm5e-meritsflaws for where that data lives) onto an
// actor. Anything with a `choices` array pauses on a DialogV2 prompt;
// anything without one applies immediately. Every application - automatic
// or chosen - gets pushed onto `log` (an array the caller renders/persists)
// AND posted as a chat message, so the player always has a durable record
// of what happened, not just a toast that can be missed.

const MERITSFLAWS_PACK_ID = 'vtm5e-meritsflaws.meritsflaws'
const DISCIPLINES_PACK_ID = 'vtm5e-disciplines.disciplines'

// Short, hover-tooltip-only blurbs - not rules text, just enough for a
// player to recognize what they're picking between without leaving the
// dialog. Full text always lives on the compendium item itself.
const DISCIPLINE_BLURBS = {
  animalism: 'Command and commune with animals and the Beast within.',
  auspex: 'Heightened senses, telepathy, and supernatural awareness.',
  bloodsorcery: 'Ritual magic worked through vitae (Tremere, Banu Haqim).',
  celerity: 'Supernatural speed and reflexes.',
  dominate: "Bend a victim's mind and will to yours.",
  fortitude: 'Supernatural toughness and resistance to harm.',
  obfuscate: 'Become unseen, unnoticed, or disguised.',
  oblivion: 'Command shadow and the touch of death.',
  potence: 'Supernatural strength.',
  presence: 'Supernatural charisma and emotional command.',
  protean: 'Shapeshifting and communion with earth and beasts.'
}

// The clan-grant data above spells Blood Sorcery "bloodsorcery" as one word,
// but wod5e's own canonical discipline id (system/api/def/disciplines.js)
// is "sorcery" - Power items' system.discipline field uses the real id.
// Same alias map as vtm5e-xpshop/scripts/xp-shop-app.js.
const DISCIPLINE_ID_ALIASES = { bloodsorcery: 'sorcery' }

let _disciplinePowersCache = null
async function getDisciplinePowers () {
  if (!_disciplinePowersCache) {
    const pack = game.packs.get(DISCIPLINES_PACK_ID)
    _disciplinePowersCache = pack ? await pack.getDocuments() : []
  }
  return _disciplinePowersCache
}

// Prompts for a specific Power at the newly-gained level, styled as a
// clickable card list (matching vtm5e-xpshop's power picker, which is where
// this pattern originated - reused here after Jake liked the look during
// XP-shop testing and asked for the same experience during chargen's own
// Discipline-dot grants, not just level-ups). Returns the chosen compendium
// Item document, or null if skipped/nothing available - callers must
// tolerate null and just grant the bare dot in that case, never block
// grant application on a pick existing.
async function promptDisciplinePowerPick (actor, disciplineId, level, sourceLabel) {
  const allPowers = await getDisciplinePowers()
  const ownedPowerNames = new Set(actor.items.filter(i => i.type === 'power').map(i => i.name))
  const candidates = allPowers
    .filter(doc => {
      const docDisciplineId = DISCIPLINE_ID_ALIASES[doc.system.discipline] ?? doc.system.discipline
      return docDisciplineId === disciplineId && Number(doc.system.level) === level
    })
    .filter(doc => !ownedPowerNames.has(doc.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (candidates.length === 0) return null

  const itemsHtml = candidates.map(doc => {
    const plainDesc = (doc.system.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const shortDesc = plainDesc.length > 200 ? plainDesc.slice(0, 197) + '…' : plainDesc
    // Both the short and full text ship in the DOM up front (not fetched
    // on expand) - this dialog is raw static HTML with no re-render loop
    // like the ApplicationV2 apps, so toggling visibility client-side is
    // simpler than trying to swap textContent in place.
    return `<div class="vtm5e-chargen-power-item" data-power-id="${doc.id}">
      <div class="vtm5e-chargen-power-item-header" data-expand-toggle>
        <span class="vtm5e-chargen-power-name">${doc.name}</span>
        <i class="fas fa-chevron-down vtm5e-chargen-power-expand-icon"></i>
      </div>
      <p class="vtm5e-chargen-power-desc vtm5e-chargen-power-desc-short">${shortDesc}</p>
      <p class="vtm5e-chargen-power-desc vtm5e-chargen-power-desc-full">${plainDesc}</p>
      <button type="button" class="vtm5e-chargen-power-choose" data-choose-power>Choose this Power</button>
    </div>`
  }).join('')

  const content = `<p>${sourceLabel} grants a dot in <b>${capitalize(disciplineId)}</b> - pick the Power you learn at level ${level}:</p>
    <div class="vtm5e-chargen-power-list">${itemsHtml}</div>`

  let picked = null
  await foundry.applications.api.DialogV2.wait({
    window: { title: `${capitalize(disciplineId)} ${level} - Choose a Power` },
    content,
    buttons: [{ action: 'skip', label: 'Skip (pick later on the Disciplines tab)' }],
    rejectClose: false,
    render: (_event, dialog) => {
      dialog.element.querySelectorAll('.vtm5e-chargen-power-item').forEach(el => {
        el.querySelector('[data-expand-toggle]').addEventListener('click', () => {
          el.classList.toggle('expanded')
        })
        el.querySelector('[data-choose-power]').addEventListener('click', () => {
          picked = candidates.find(c => c.id === el.dataset.powerId)
          dialog.close()
        })
      })
    }
  })

  return picked
}

let _meritsFlawsIndexCache = null
async function getMeritsFlawsDescription (name) {
  if (!_meritsFlawsIndexCache) {
    const pack = game.packs.get(MERITSFLAWS_PACK_ID)
    _meritsFlawsIndexCache = pack ? await pack.getDocuments() : []
  }
  const doc = _meritsFlawsIndexCache.find(d => d.name === name)
  if (!doc) return ''
  const plain = doc.system.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return plain.length > 140 ? plain.slice(0, 137) + '…' : plain
}

function capitalize (id) {
  return id.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

function dots (n) {
  return '•'.repeat(Math.max(n, 0))
}

async function logAndAnnounce (actor, log, text) {
  log.push(text)
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p class="vtm5e-chargen-log-entry"><i class="fas fa-dice-d10"></i> ${text}</p>`
  })
}

function choiceLabel (grant, choice) {
  if (grant.type === 'specialty') return choice.label
  if (grant.type === 'disciplineDot') {
    return typeof choice === 'string' ? capitalize(choice) : capitalize(choice.discipline)
  }
  if (grant.type === 'backgroundDot') return capitalize(choice)
  if (grant.type === 'merit' || grant.type === 'flaw') return `${choice.name} (${dots(choice.rating)})`
  return String(choice)
}

async function choiceTooltip (grant, choice) {
  if (grant.type === 'disciplineDot') {
    const id = typeof choice === 'string' ? choice : choice.discipline
    return DISCIPLINE_BLURBS[id] ?? ''
  }
  if (grant.type === 'backgroundDot') return getMeritsFlawsDescription(capitalize(choice))
  if (grant.type === 'merit' || grant.type === 'flaw') return getMeritsFlawsDescription(choice.name)
  if (grant.type === 'specialty') return `Adds a specialty to ${capitalize(choice.skill)}.`
  return ''
}

async function resolveChoice (grant, sourceLabel, actor) {
  if (!grant.choices || grant.choices.length === 0) return null

  // disciplineDot choices can carry a requiresClan (e.g. Blood Sorcery is
  // "Tremere only") - filter those out up front instead of showing every
  // player every option and only rejecting the pick afterward. Falls back
  // to the unfiltered list if filtering would leave nothing (no Clan
  // picked yet, or a grant this doesn't apply to), so this never produces
  // a dead-end dialog with zero buttons.
  let choices = grant.choices
  if (grant.type === 'disciplineDot' && actor) {
    const clanItem = actor.items.find(i => i.type === 'clan')
    const clanName = clanItem?.name.toLowerCase()
    const filtered = choices.filter(c => typeof c !== 'object' || !c.requiresClan || c.requiresClan === clanName)
    if (filtered.length > 0) choices = filtered
  }

  if (choices.length === 1) return choices[0]

  const buttons = choices.map((c, i) => ({
    action: String(i),
    label: choiceLabel(grant, c)
  }))

  const tooltips = await Promise.all(choices.map(c => choiceTooltip(grant, c)))

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `${sourceLabel} - Choose One` },
    content: '<p>This grant lets you pick one of the following (hover an option for a quick description):</p>',
    buttons,
    rejectClose: false,
    render: (_event, dialog) => {
      const buttonEls = dialog.element.querySelectorAll('button[data-action]')
      buttonEls.forEach(el => {
        const idx = Number(el.dataset.action)
        if (!Number.isNaN(idx) && tooltips[idx]) el.title = tooltips[idx]
      })
    }
  })

  if (result === null || result === undefined) return null
  return choices[Number(result)]
}

async function promptSplitDots (grant, sourceLabel) {
  const fields = grant.among.map(key =>
    `<div class="form-group"><label>${capitalize(key)}</label><input type="number" name="${key}" value="0" min="0" max="${grant.amount}" /></div>`
  ).join('')

  const content = `<p>Split <b>${grant.amount}</b> dots among the following (must total exactly ${grant.amount}):</p>${fields}`

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `${sourceLabel} - Split ${grant.amount} Dots` },
    content,
    ok: {
      label: 'Confirm',
      callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
    },
    rejectClose: false
  })

  if (!result) return null

  const total = Object.values(result).reduce((sum, v) => sum + Number(v || 0), 0)
  if (total !== grant.amount) {
    ui.notifications.warn(`${sourceLabel}: split-dot total was ${total}, expected ${grant.amount} - nothing applied. Try again.`)
    return null
  }

  return result
}

async function findCompendiumMeritFlaw (name) {
  const pack = game.packs.get(MERITSFLAWS_PACK_ID)
  if (!pack) return null
  const docs = await pack.getDocuments()
  return docs.find(d => d.name === name) ?? null
}

// `flags['vtm5e-chargen'].grantedPoints` tracks how many of an item's dots
// came free from a grant (Clan/Predator Type/etc) rather than being spent
// from the player's own Merits & Flaws pool - the chargen picker uses it to
// lock those dots and exclude them from the pool total, so free grants and
// player purchases can stack on the same item without double-counting.
// `entries` (optional) collects one record per effect actually applied, in
// a shape revokeLedgerEntries() below knows how to reverse - see
// applyTrackedGrants() for why that matters (switching a Clan/Predator Type
// pick, or just reopening the wizard, must never re-stack the same grant).
async function grantMeritOrFlaw (actor, name, rating, log, sourceLabel, entries) {
  const source = await findCompendiumMeritFlaw(name)

  const existing = actor.items.find(i => i.type === 'feature' && i.name === name)
  if (existing) {
    const newRating = (existing.system.points || 0) + rating
    const newGranted = (existing.flags?.['vtm5e-chargen']?.grantedPoints ?? 0) + rating
    await existing.update({ 'system.points': newRating, 'flags.vtm5e-chargen.grantedPoints': newGranted })
    await logAndAnnounce(actor, log, `<b>${sourceLabel}</b>: increased <b>${name}</b> to ${dots(newRating)}`)
    entries?.push({ type: 'meritFlaw', name, amount: rating })
    return
  }

  const itemData = source
    ? {
        name: source.name,
        type: source.type,
        img: source.img,
        system: { ...source.system, points: rating },
        flags: { 'vtm5e-chargen': { grantedPoints: rating } }
      }
    : {
        name,
        type: 'feature',
        img: 'systems/wod5e/assets/icons/items/feature.svg',
        system: {
          description: '<p><i>Auto-created by the chargen wizard - full text not yet in the vtm5e-meritsflaws compendium. Fill in manually.</i></p>',
          bonuses: [],
          uses: { max: 0, current: 0, enabled: false },
          featuretype: 'merit',
          points: rating,
          macroid: ''
        },
        flags: { 'vtm5e-chargen': { grantedPoints: rating } }
      }

  await actor.createEmbeddedDocuments('Item', [itemData])

  if (!source) {
    ui.notifications.warn(`"${name}" wasn't found in vtm5e-meritsflaws - added as a placeholder. Add the real item to the compendium when you have its text.`)
  }

  await logAndAnnounce(actor, log, `<b>${sourceLabel}</b>: gained <b>${name}</b> ${dots(rating)}`)
  entries?.push({ type: 'meritFlaw', name, amount: rating })
}

async function grantBackgroundDots (actor, backgroundKey, amount, note, log, sourceLabel, entries) {
  const BACKGROUND_NAME_MAP = {
    contact: 'Contact',
    resources: 'Resources',
    herd: 'Herd',
    fame: 'Fame',
    haven: 'Base Haven',
    influence: 'Influence',
    allies: 'Allies (Reliability)',
    retainer: 'Retainer',
    status: 'Status',
    mask: 'Mask'
  }
  const name = BACKGROUND_NAME_MAP[backgroundKey] ?? capitalize(backgroundKey)
  await grantMeritOrFlaw(actor, name, amount, log, sourceLabel + (note ? ` (${note})` : ''), entries)
}

export async function applyGrant (actor, grant, sourceLabel, log, entries) {
  switch (grant.type) {
    case 'specialty': {
      const choice = await resolveChoice(grant, sourceLabel, actor)
      if (!choice) return
      const bonuses = foundry.utils.deepClone(actor.system.skills?.[choice.skill]?.bonuses || [])
      bonuses.push({ source: choice.label, value: 1, paths: [`skills.${choice.skill}`], displayWhenInactive: true })
      await actor.update({ [`system.skills.${choice.skill}.bonuses`]: bonuses })
      await logAndAnnounce(actor, log, `<b>${sourceLabel}</b>: gained specialty <b>${choice.label}</b>`)
      entries?.push({ type: 'specialty', skill: choice.skill, label: choice.label })
      break
    }

    case 'disciplineDot': {
      // "Thin-blood characters have no intrinsic Disciplines" (corebook
      // p.136) - every Predator Type grants a Discipline dot, but none of
      // them apply to a Thin-Blooded character. Skip before even prompting
      // for a choice, rather than granting then rejecting.
      const clanForDiscipline = actor.items.find(i => i.type === 'clan')
      if (clanForDiscipline?.name === 'Thin-Blooded') {
        await logAndAnnounce(actor, log, `<b>${sourceLabel}</b>: no Discipline dot - Thin-Blooded characters have no intrinsic Disciplines.`)
        break
      }
      const choice = await resolveChoice(grant, sourceLabel, actor)
      if (!choice) return
      const disciplineId = typeof choice === 'string' ? choice : choice.discipline
      if (typeof choice === 'object' && choice.requiresClan) {
        const clanItem = actor.items.find(i => i.type === 'clan')
        if (!clanItem || clanItem.name.toLowerCase() !== choice.requiresClan) {
          ui.notifications.warn(`${sourceLabel}: ${capitalize(disciplineId)} requires Clan ${capitalize(choice.requiresClan)} - skipped.`)
          return
        }
      }
      const current = actor.system.disciplines?.[disciplineId]?.value || 0
      const amount = grant.amount || 1

      // One power-pick prompt per new level gained (almost always just one
      // level - chargen grants are always amount:1 today, but this loop
      // handles a larger grant correctly if one is ever added). Each pick
      // creates its Power item immediately so the NEXT prompt's "already
      // owned" filter sees it and won't offer the same power twice.
      const pickedPowerNames = []
      for (let level = current + 1; level <= current + amount; level++) {
        const powerDoc = await promptDisciplinePowerPick(actor, disciplineId, level, sourceLabel)
        if (!powerDoc) continue
        const data = powerDoc.toObject()
        delete data._id
        delete data.ownership
        await actor.createEmbeddedDocuments('Item', [data])
        pickedPowerNames.push(powerDoc.name)
      }

      await actor.update({
        [`system.disciplines.${disciplineId}.value`]: current + amount,
        [`system.disciplines.${disciplineId}.visible`]: true
      })

      const powerNote = pickedPowerNames.length > 0 ? ` - learned <b>${pickedPowerNames.join(', ')}</b>` : ''
      await logAndAnnounce(actor, log, `<b>${sourceLabel}</b>: +${amount} dot in <b>${capitalize(disciplineId)}</b> (now ${dots(current + amount)})${powerNote}`)
      entries?.push({ type: 'disciplineDot', discipline: disciplineId, amount, powerNames: pickedPowerNames })
      break
    }

    case 'backgroundDot': {
      let backgroundKey = grant.background
      if (grant.choices) {
        const choice = await resolveChoice(grant, sourceLabel, actor)
        if (!choice) return
        backgroundKey = choice
      }
      await grantBackgroundDots(actor, backgroundKey, grant.amount, grant.note, log, sourceLabel, entries)
      break
    }

    case 'splitDots': {
      const allocation = await promptSplitDots(grant, sourceLabel)
      if (!allocation) return
      for (const [key, amt] of Object.entries(allocation)) {
        const amount = Number(amt)
        if (amount <= 0) continue
        if (grant.pool === 'background') await grantBackgroundDots(actor, key, amount, null, log, sourceLabel, entries)
        else if (grant.pool === 'flaw') await grantMeritOrFlaw(actor, capitalize(key), amount, log, sourceLabel, entries)
      }
      break
    }

    case 'humanity': {
      const current = actor.system.humanity.value
      const next = Math.clamp(current + grant.amount, 0, 10)
      await actor.update({ 'system.humanity.value': next })
      await logAndAnnounce(actor, log, `<b>${sourceLabel}</b>: Humanity ${grant.amount > 0 ? '+' : ''}${grant.amount} (now ${next})`)
      entries?.push({ type: 'humanity', amount: grant.amount })
      break
    }

    case 'bloodPotency': {
      const current = actor.system.blood.potency
      const next = current + grant.amount
      await actor.update({ 'system.blood.potency': next })
      await logAndAnnounce(actor, log, `<b>${sourceLabel}</b>: Blood Potency +${grant.amount} (now ${next})`)
      entries?.push({ type: 'bloodPotency', amount: grant.amount })
      break
    }

    case 'merit':
    case 'flaw': {
      let target = grant
      if (grant.choices) {
        const choice = await resolveChoice(grant, sourceLabel, actor)
        if (!choice) return
        target = choice
      }
      // `note` lets a grant point at a generic compendium item (e.g. the
      // single "Prey Exclusion" Flaw) while still telling the player which
      // specific flavor of it they got (e.g. "non-consenting prey") - the
      // note only decorates the log/chat line, the actual Item stays
      // named after the real compendium entry so lookups keep working.
      const label = target.note ? `${sourceLabel} (${target.note})` : sourceLabel
      await grantMeritOrFlaw(actor, target.name, target.rating, log, label, entries)
      break
    }

    default:
      console.warn('vtm5e-chargen | Unknown grant type:', grant.type, grant)
  }
}

export async function applyGrants (actor, grants, sourceLabel, log, entries) {
  for (const grant of grants || []) {
    await applyGrant(actor, grant, sourceLabel, log, entries)
  }
}

function getLedgerSlot (actor, slot) {
  return actor.flags?.['vtm5e-chargen']?.grantLedger?.[slot] ?? null
}

async function revokeLedgerEntries (actor, entries, log, oldSourceLabel) {
  for (const entry of entries || []) {
    switch (entry.type) {
      case 'disciplineDot': {
        const current = actor.system.disciplines?.[entry.discipline]?.value || 0
        const next = Math.max(current - entry.amount, 0)
        await actor.update({ [`system.disciplines.${entry.discipline}.value`]: next })

        // Remove any Power items this same grant picked, or a re-pick
        // (switching Clan/Predator Type) leaves an orphaned power behind
        // whose level no longer matches the (now-lower or zero) dot rating.
        if (entry.powerNames?.length) {
          const toDelete = actor.items.filter(i => i.type === 'power' && entry.powerNames.includes(i.name))
          if (toDelete.length > 0) {
            await actor.deleteEmbeddedDocuments('Item', toDelete.map(i => i.id))
          }
        }
        break
      }
      case 'meritFlaw': {
        const item = actor.items.find(i => i.type === 'feature' && i.name === entry.name)
        if (!item) break
        const grantedPoints = item.flags?.['vtm5e-chargen']?.grantedPoints ?? 0
        const newGranted = Math.max(grantedPoints - entry.amount, 0)
        const newPoints = Math.max((item.system.points ?? 0) - entry.amount, 0)
        if (newPoints <= 0) {
          await actor.deleteEmbeddedDocuments('Item', [item.id])
        } else {
          await item.update({ 'system.points': newPoints, 'flags.vtm5e-chargen.grantedPoints': newGranted })
        }
        break
      }
      case 'specialty': {
        const bonuses = foundry.utils.deepClone(actor.system.skills?.[entry.skill]?.bonuses || [])
        const filtered = bonuses.filter(b => b.source !== entry.label)
        await actor.update({ [`system.skills.${entry.skill}.bonuses`]: filtered })
        break
      }
      case 'humanity': {
        const next = Math.clamp(actor.system.humanity.value - entry.amount, 0, 10)
        await actor.update({ 'system.humanity.value': next })
        break
      }
      case 'bloodPotency': {
        const next = actor.system.blood.potency - entry.amount
        await actor.update({ 'system.blood.potency': next })
        break
      }
      default:
        console.warn('vtm5e-chargen | revokeLedgerEntries: unknown entry type', entry)
    }
  }
  if (log) log.push(`<b>${oldSourceLabel}</b>: previous grants removed (pick changed)`)
}

// The single-pick chargen steps (Clan, Predator Type) each get one
// persisted ledger slot on the actor (flags['vtm5e-chargen'].grantLedger.
// <slot>), recording exactly which grants the current pick applied. This
// makes grant application idempotent AND reversible:
//  - same pick again (re-clicking Next, or just reopening the wizard on an
//    actor that already has this pick) is a no-op instead of re-stacking
//    dots/items a second time.
//  - a different pick first reverses everything the old ledger entry
//    recorded, so switching Clan/Predator mid-wizard (or after closing and
//    reopening) can never leave orphaned free dots/items behind.
export async function applyTrackedGrants (actor, { slot, pickLabel, name, sourceLabel, grants }, log) {
  const existingSlot = getLedgerSlot(actor, slot)
  if (existingSlot && existingSlot.sourceLabel === sourceLabel) return false

  if (existingSlot) {
    await revokeLedgerEntries(actor, existingSlot.entries, log, existingSlot.sourceLabel)
  }

  log.push(`<b>${pickLabel}</b>: chose <b>${name}</b>`)
  const entries = []
  for (const grant of grants || []) {
    await applyGrant(actor, grant, sourceLabel, log, entries)
  }
  await actor.setFlag('vtm5e-chargen', `grantLedger.${slot}`, { sourceLabel, entries })
  return true
}

// Reverses whatever's currently recorded in a ledger slot without
// applying a replacement - used when a pick becomes invalid after the
// fact (e.g. the player already had a Predator Type selected and its
// grants applied, then went back and changed Clan to one that Predator
// Type excludes). Leaves the slot empty so the player has to pick again.
export async function clearTrackedGrants (actor, slot, log) {
  const existingSlot = getLedgerSlot(actor, slot)
  if (!existingSlot) return
  await revokeLedgerEntries(actor, existingSlot.entries, log, existingSlot.sourceLabel)
  await actor.unsetFlag('vtm5e-chargen', `grantLedger.${slot}`)
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
      // This wizard only ever builds vampire characters, so a Ghoul-only
      // item can never actually apply here - unconditional, no actor
      // state to check.
      failures.push('Only available to Ghoul characters, not vampires.')
    } else if (r.type === 'maxBloodPotency') {
      if ((actor.system.blood?.potency ?? 0) > r.value) {
        failures.push(`Requires Blood Potency ${r.value} or lower (currently ${actor.system.blood.potency}).`)
      }
    } else if (r.type === 'minHaven') {
      const rating = getHavenRating(actor)
      if (rating < r.value) {
        failures.push(`Requires Base Haven ${r.value}+ (currently ${rating}).`)
      }
    } else if (r.type === 'minBackground') {
      // Generic version of minHaven - covers any Background-gated Merit
      // (e.g. "Requires Mask ••") without needing a one-off case per
      // Background name.
      const rating = actor.items.find(i => i.type === 'feature' && i.name === r.background)?.system.points ?? 0
      if (rating < r.value) {
        failures.push(`Requires ${r.background} ${dots(r.value)}+ (currently ${dots(rating)}).`)
      }
    }
  }
  return failures
}

function getHavenRating (actor) {
  return actor.items.find(i => i.type === 'feature' && i.name === 'Base Haven')?.system.points ?? 0
}

// Some Backgrounds don't fail outright below a threshold - they're just
// capped lower (e.g. Library tops out at 1 dot without a Base Haven of 2+,
// per the corebook, rather than being unavailable entirely). doc.flags
// ['vtm5e-chargen'].ratingCap = { unless: <a single restriction object>, cap: n }.
// Returns the cap to enforce, or null if the "unless" condition is met and no
// cap applies.
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
