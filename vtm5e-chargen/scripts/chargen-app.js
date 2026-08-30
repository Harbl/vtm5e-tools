import { applyTrackedGrants, clearTrackedGrants, checkRestrictions, checkConflicts, getRatingCap } from './grant-engine.js'

const MODULE_ID = 'vtm5e-chargen'

const STEPS = [
  { id: 'concept', label: 'Concept' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'skills', label: 'Skills' },
  { id: 'clan', label: 'Clan' },
  { id: 'predator', label: 'Predator Type' },
  { id: 'meritsflaws', label: 'Merits & Flaws' },
  { id: 'touchstones', label: 'Touchstones' },
  { id: 'final', label: 'Final Touches' }
]

const ATTRIBUTE_GROUPS = {
  physical: ['strength', 'dexterity', 'stamina'],
  social: ['charisma', 'manipulation', 'composure'],
  mental: ['intelligence', 'wits', 'resolve']
}

const SKILL_GROUPS = {
  physical: ['athletics', 'brawl', 'craft', 'drive', 'firearms', 'larceny', 'melee', 'stealth', 'survival'],
  social: ['animalken', 'etiquette', 'insight', 'intimidation', 'leadership', 'performance', 'persuasion', 'streetwise', 'subterfuge'],
  mental: ['academics', 'awareness', 'finance', 'investigation', 'medicine', 'occult', 'politics', 'science', 'technology']
}

// Same short hover-tooltip blurbs as the character sheet
// (vtm5e-charactersheet/scripts/shared-context.js) - duplicated here rather
// than imported, same "small standalone lookup per module" convention used
// elsewhere in this project (e.g. Compulsion text, Thin-Blood folder
// detection), so chargen doesn't pick up a real dependency on the character
// sheet module just for tooltip strings.
const ATTRIBUTE_TOOLTIPS = {
  strength: 'Raw physical power - lifting, striking, and forcing your way through.',
  dexterity: 'Agility, reflexes, and hand-eye coordination.',
  stamina: 'Physical resilience and the ability to endure damage or hardship.',
  charisma: 'Natural charm, presence, and raw social magnetism.',
  manipulation: 'Skill at deceiving, seducing, or influencing others.',
  composure: 'Grace under pressure - staying calm and hiding your true feelings.',
  intelligence: 'Raw mental acuity, memory, and reasoning.',
  wits: 'Quick thinking, alertness, and improvising under pressure.',
  resolve: 'Focus, willpower, and the drive to see a task through.'
}

const SKILL_TOOLTIPS = {
  athletics: 'Running, jumping, climbing, and other feats of physical exertion.',
  brawl: 'Unarmed combat - fists, teeth, and improvised holds.',
  craft: 'Building, repairing, or creating physical works by hand.',
  drive: 'Operating cars and other ground vehicles, including under pressure.',
  firearms: 'Aiming and firing guns of all kinds.',
  larceny: 'Lockpicking, security bypass, and theft.',
  melee: 'Fighting with hand-to-hand weapons - blades, clubs, and the like.',
  stealth: 'Moving unseen and unheard.',
  survival: 'Living off the land and enduring the wilderness.',
  animalken: 'Understanding, calming, and controlling animals.',
  etiquette: 'Knowing and using the right social customs and manners.',
  insight: "Reading people's true feelings and motivations.",
  intimidation: 'Coercing others through threats, menace, or force of will.',
  leadership: 'Inspiring, organizing, and directing others.',
  performance: 'Acting, music, oratory, and other performing arts.',
  persuasion: 'Convincing others through honest argument and charm.',
  streetwise: 'Navigating the criminal underworld and street culture.',
  subterfuge: "Lying convincingly and reading through others' lies.",
  academics: 'Formal education, history, and research.',
  awareness: 'Noticing details and sensing danger or trouble.',
  finance: 'Understanding money, markets, and economics.',
  investigation: 'Piecing together clues and finding hidden information.',
  medicine: 'Diagnosing and treating injuries and illness.',
  occult: 'Knowledge of the supernatural and esoteric lore.',
  politics: 'Understanding bureaucracies, factions, and power structures.',
  science: 'Formal scientific knowledge and method.',
  technology: 'Computers, hacking, and modern electronics.'
}

// Corebook Character Summary (p.135-137): "Take one Attribute at 4; three
// Attributes at 3; four Attributes at 2; one Attribute at 1." All 9
// Attributes get assigned - the counts sum to exactly 9, so nothing is
// left at 0 and nothing goes above 4 during chargen.
const ATTRIBUTE_RATING_QUOTA = { 4: 1, 3: 3, 2: 4, 1: 1 }

// Same source: "Pick one Skill distribution." Each option is an exact
// count of Skills at each rating - not a freeform point pool. Whatever
// Skills aren't covered by the chosen distribution's counts stay at 0.
const SKILL_DISTRIBUTIONS = {
  jackOfAllTrades: {
    label: 'Jack of All Trades',
    description: 'One Skill at •••, eight Skills at ••, ten Skills at •.',
    quota: { 3: 1, 2: 8, 1: 10 }
  },
  balanced: {
    label: 'Balanced',
    description: 'Three Skills at •••, five Skills at ••, seven Skills at •.',
    quota: { 3: 3, 2: 5, 1: 7 }
  },
  specialist: {
    label: 'Specialist',
    description: 'One Skill at ••••, three Skills at •••, three Skills at ••, three Skills at •.',
    quota: { 4: 1, 3: 3, 2: 3, 1: 3 }
  }
}

// Corebook Advantages section (p.148-150): Merits/Backgrounds are "up to
// seven dots" (a cap, not a requirement to spend it all), but "you must
// take at least two points of Flaws by the end of character creation" -
// that second half is the one hard requirement the Merits & Flaws step
// gates on.
const MIN_REQUIRED_FLAW_DOTS = 2

// Corebook p.213 "generation" table - minimum Blood Potency per
// generation (the value a freshly-made character starts at; it can only
// go up from there through play, per the same table's max column and the
// "Blood Potency increases with age" rule on the same page).
const GENERATION_INFO = {
  '4th': { bp: 5, era: 'Methuselah - Embraced over 1,000 years ago' },
  '5th': { bp: 4, era: 'Methuselah - Embraced over 1,000 years ago' },
  '6th': { bp: 3, era: 'Elder - Embraced roughly 200-1,000 years ago' },
  '7th': { bp: 3, era: 'Elder - Embraced roughly 200-1,000 years ago' },
  '8th': { bp: 2, era: 'Elder - Embraced roughly 200-1,000 years ago' },
  '9th': { bp: 2, era: 'Elder - Embraced roughly 200-1,000 years ago' },
  '10th': { bp: 1, era: 'Ancilla - Embraced circa 1780-1940' },
  '11th': { bp: 1, era: 'Ancilla - Embraced circa 1780-1940' },
  '12th': { bp: 1, era: 'Neonate or Childer - Embraced 1940 to as recently as the last 15 years' },
  '13th': { bp: 1, era: 'Neonate or Childer - Embraced 1940 to as recently as the last 15 years' },
  '14th': { bp: 0, era: 'Childer (thin-blood) - Embraced within the last 15 years' },
  '15th': { bp: 0, era: 'Childer (thin-blood) - Embraced within the last 15 years' },
  '16th': { bp: 0, era: 'Childer (thin-blood) - Embraced within the last 15 years' }
}

export class ChargenApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    tag: 'div',
    window: {
      title: 'Character Creation',
      icon: 'fas fa-dice-d10',
      resizable: true
    },
    position: {
      width: 900,
      height: 720
    },
    actions: {
      goToStep: ChargenApp.#onGoToStep,
      prevStep: ChargenApp.#onPrevStep,
      nextStep: ChargenApp.#onNextStep,
      finishWizard: ChargenApp.#onFinishWizard,
      adjustAttribute: ChargenApp.#onAdjustAttribute,
      adjustSkill: ChargenApp.#onAdjustSkill,
      pickSkillDistribution: ChargenApp.#onPickSkillDistribution,
      adjustMeritFlaw: ChargenApp.#onAdjustMeritFlaw,
      toggleMfFolder: ChargenApp.#onToggleMfFolder,
      toggleMfItem: ChargenApp.#onToggleMfItem,
      removeOwnedFeature: ChargenApp.#onRemoveOwnedFeature,
      toggleThinBloodItem: ChargenApp.#onToggleThinBloodItem
    }
  }

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/chargen.hbs` }
  }

  // Set by #preserveScroll() right before any render() that should stay on
  // the same spot in the page (a dot click, a folder toggle, a card
  // preview) - _onRender restores it once and clears it. Left null for
  // step-navigation renders (goToStep/nextStep/prevStep), where jumping to
  // the top of the new step's content is the correct behavior.
  #pendingScrollTop = null

  // Set instead of (on top of) #pendingScrollTop when the render is
  // triggered by toggling a specific element open/closed. A plain
  // scrollTop restore assumes the pixel distance from the top of the
  // container to everything above the toggle point never changes, which
  // breaks down for a large folder (10+ rows) - a full innerHTML replace
  // invalidates the browser's own scroll-anchoring heuristic, and it can
  // end up "helpfully" adjusting scroll on top of our restore, moving the
  // clicked row instead of leaving it put. Anchoring on the toggled
  // element's own on-screen position (found again by selector after
  // render) sidesteps that entirely - it doesn't matter how much content
  // above or below it changed height, only where the anchor itself ends
  // up relative to where it was.
  #pendingScrollAnchor = null

  // `id` was a hardcoded static string before this - Foundry's ApplicationV2
  // registry keys open windows by id, so a chargen window left open for one
  // actor (e.g. from testing) got silently reused/refocused instead of a
  // fresh one being made when the wizard was opened for a different actor,
  // making it look like data had "leaked" between actors when it was
  // actually just still the same window, still showing the first actor's
  // real data. Same class of bug already fixed this way in vtm5e-xpshop.
  constructor (actor, options = {}) {
    super({ ...options, id: `vtm5e-chargen-wizard-${actor.id}` })
    this.actor = actor
    this.stepIndex = 0
    // Furthest step reached via a *validated* Next click - the top nav
    // lets the player click freely backward, but forward only up to this
    // frontier, so it can't be used to skip a step's completion gate the
    // way the buttons were (nextDisabled only blocked the Next button
    // itself, not the nav). Not persisted across a close/reopen, same as
    // stepIndex itself.
    this.maxStepIndex = 0
    this.log = []
    this.clanItems = null
    this.predatorItems = null
    this.meritsFlawsItems = null
    // Merits & Flaws picker UI state - lives on the instance (not the
    // template context) so it survives the this.render() that follows
    // every dot click/search keystroke instead of resetting.
    this.mfSearch = ''
    this.mfSearchFocused = false
    this.openFolders = new Set()
    this.expandedMfIds = new Set()
  }

  // `findAnchor` (optional): a function re-run both now and after render to
  // locate the SAME logical element in each DOM - e.g. "the 3rd
  // toggleMfFolder button" by index, since a raw CSS selector can't
  // express "this specific one" when several elements could share the
  // same identifying attribute (Merits and Flaws can each have their own
  // "Other" folder).
  #preserveScroll (findAnchor = null) {
    const body = this.element?.querySelector('.vtm5e-chargen-body')
    if (body) this.#pendingScrollTop = body.scrollTop

    if (findAnchor) {
      const anchorEl = findAnchor()
      if (anchorEl) this.#pendingScrollAnchor = { findAnchor, top: anchorEl.getBoundingClientRect().top }
    }

    // The DOM gets rebuilt on render, and ApplicationV2 tries to restore
    // focus to the new element matching whatever had it before - which
    // makes the browser auto-scroll that element into view, fighting our
    // manual scrollTop restore below and dragging the clicked row down to
    // the bottom edge of the viewport instead of leaving it in place.
    // Blurring first means there's nothing for it to restore focus to.
    if (document.activeElement instanceof HTMLElement && this.element?.contains(document.activeElement)) {
      document.activeElement.blur()
    }
  }

  async #ensureCompendiumData () {
    if (!this.clanItems) {
      const pack = game.packs.get('vtm5e-clans.clans')
      this.clanItems = pack ? await pack.getDocuments() : []
    }
    if (!this.predatorItems) {
      const pack = game.packs.get('vtm5e-predatortypes.predatortypes')
      this.predatorItems = pack ? await pack.getDocuments() : []
    }
    if (!this.meritsFlawsItems) {
      const pack = game.packs.get('vtm5e-meritsflaws.meritsflaws')
      this.meritsFlawsItems = pack ? await pack.getDocuments() : []
    }
    await this.#ensureAttributeBaseline()
  }

  // wod5e's Attribute schema defaults every Attribute's value to 1 (a
  // generic Foundry-template fallback, not a V5 rule - Skills correctly
  // default to 0). Left alone, that means all 9 Attributes on a brand
  // new actor already read as "1 dot filled" before the player has done
  // anything, which would blow the corebook's 1-Attribute-at-dot-1 quota
  // immediately. Zero them out exactly once (tracked by a flag so it can
  // never re-fire and wipe a player's progress) so every dot the quota
  // counts - including the first - is one the player actually chose.
  async #ensureAttributeBaseline () {
    if (this.actor.flags?.['vtm5e-chargen']?.attributesInitialized) return
    const ids = Object.values(ATTRIBUTE_GROUPS).flat()
    const updates = {}
    for (const id of ids) updates[`system.attributes.${id}.value`] = 0
    await this.actor.update(updates)
    await this.actor.setFlag('vtm5e-chargen', 'attributesInitialized', true)
  }

  async _prepareContext (_options) {
    await this.#ensureCompendiumData()

    const actor = this.actor
    const currentClan = actor.items.find(i => i.type === 'clan')
    const currentPredator = actor.items.find(i => i.type === 'predatorType')

    const steps = STEPS.map((s, i) => ({
      ...s,
      num: i + 1,
      active: i === this.stepIndex,
      done: i < this.stepIndex,
      locked: i > Math.max(this.stepIndex, this.maxStepIndex)
    }))

    const attributes = {}
    for (const [group, ids] of Object.entries(ATTRIBUTE_GROUPS)) {
      attributes[group] = ids.map(id => this.#dotRow('attributes', id))
    }

    const skills = {}
    for (const [group, ids] of Object.entries(SKILL_GROUPS)) {
      skills[group] = ids.map(id => this.#dotRow('skills', id))
    }

    const attributeBudget = this.#buildBudgetRow(ATTRIBUTE_RATING_QUOTA, this.#ratingCounts('attributes', Object.values(ATTRIBUTE_GROUPS).flat()))
    const skillBudget = this.#buildSkillBudget()
    const stepCompletion = this.#currentStepCompletion()

    const currentGeneration = actor.system.headers?.generation ?? ''
    const generationOptions = Object.entries(GENERATION_INFO).map(([gen, info]) => ({
      value: gen,
      label: `${gen} Generation (starts at Blood Potency ${info.bp})`,
      selected: currentGeneration === gen
    }))
    const embraceDate = actor.system.bio?.dateof?.death ?? ''

    const health = (actor.system.attributes?.stamina?.value ?? 0) + 3
    const willpower = (actor.system.attributes?.resolve?.value ?? 0) + (actor.system.attributes?.composure?.value ?? 0)

    return {
      actor,
      steps,
      currentStepId: STEPS[this.stepIndex].id,
      stepFlags: Object.fromEntries(STEPS.map(s => [`is${s.id.charAt(0).toUpperCase()}${s.id.slice(1)}`, s.id === STEPS[this.stepIndex].id])),
      isFirstStep: this.stepIndex === 0,
      isLastStep: this.stepIndex === STEPS.length - 1,
      nextDisabled: !stepCompletion.complete,
      incompleteMessage: stepCompletion.message ?? '',
      concept: actor.system.headers?.concept ?? '',
      ambition: actor.system.headers?.ambition ?? '',
      desire: actor.system.headers?.desire ?? '',
      attributes,
      attributeBudget,
      skills,
      skillBudget,
      clans: this.clanItems
        .map(c => ({ id: c.id, name: c.name, img: c.img, description: c.system.description, bane: c.system.bane, selected: currentClan?.name === c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      currentClan,
      predators: this.predatorItems
        .map(p => {
          const restrictions = p.flags?.['vtm5e-chargen']?.restrictions ?? []
          const reasons = checkRestrictions(actor, restrictions)
          return {
            id: p.id,
            name: p.name,
            img: p.img,
            description: p.system.description,
            selected: currentPredator?.name === p.name,
            unavailable: reasons.length > 0,
            unavailableReason: reasons.join(' ')
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      currentPredator,
      meritsFlaws: this.#buildMeritsFlawsView(),
      thinBlood: this.#buildThinBloodView(currentClan),
      touchstones: actor.system.headers?.touchstones ?? '',
      tenets: actor.system.headers?.tenets ?? '',
      sire: actor.system.headers?.sire ?? '',
      generation: currentGeneration,
      generationOptions,
      embraceDate,
      health,
      willpower,
      humanity: actor.system.humanity?.value ?? 7,
      bloodPotency: actor.system.blood?.potency ?? 0,
      hunger: actor.system.hunger?.value ?? 1,
      log: this.log
    }
  }

  #dotRow (category, id) {
    const value = this.actor.system[category]?.[id]?.value ?? 0
    const tooltips = category === 'attributes' ? ATTRIBUTE_TOOLTIPS : SKILL_TOOLTIPS
    return {
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      tooltip: tooltips[id] || '',
      value,
      dots: [1, 2, 3, 4, 5].map(n => ({ n, filled: n <= value }))
    }
  }

  // Counts how many of the given trait ids currently sit at each nonzero
  // rating. `excludeId` (used by the click handlers) leaves one trait out
  // of its own count so "does raising THIS trait to N still fit the
  // quota" can be checked without the trait's own current value skewing
  // the answer.
  #ratingCounts (category, ids, excludeId = null) {
    const counts = {}
    for (const id of ids) {
      if (id === excludeId) continue
      const value = this.actor.system[category]?.[id]?.value ?? 0
      if (value > 0) counts[value] = (counts[value] || 0) + 1
    }
    return counts
  }

  #buildBudgetRow (quota, counts) {
    return Object.entries(quota)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([rating, allowed]) => {
        const used = counts[rating] || 0
        return { rating: Number(rating), dots: '•'.repeat(Number(rating)), used, allowed, over: used > allowed }
      })
  }

  #buildSkillBudget () {
    const selectedKey = this.actor.flags?.['vtm5e-chargen']?.skillDistribution ?? null
    const selected = selectedKey ? SKILL_DISTRIBUTIONS[selectedKey] : null
    const counts = this.#ratingCounts('skills', Object.values(SKILL_GROUPS).flat())
    return {
      selectedKey,
      distributions: Object.entries(SKILL_DISTRIBUTIONS).map(([key, def]) => ({
        key,
        label: def.label,
        description: def.description,
        selected: key === selectedKey
      })),
      rows: selected ? this.#buildBudgetRow(selected.quota, counts) : []
    }
  }

  // Corebook budget: 7 dots of Merits/Backgrounds, plus up to 2 bonus dots
  // refunded 1:1 for dots of Flaws taken (extra Flaw dots beyond 2 are
  // still allowed, they just stop granting bonus points). Dots that came
  // free from a grant (flags.vtm5e-chargen.grantedPoints) never count
  // against either side of the pool.
  #meritPoolStatus () {
    let meritsSpent = 0
    let flawsSpent = 0
    for (const item of this.actor.items) {
      if (item.type !== 'feature') continue
      const compendiumDoc = this.meritsFlawsItems?.find(d => d.name === item.name)
      const featuretype = compendiumDoc?.system.featuretype ?? item.system.featuretype
      const grantedPoints = item.flags?.['vtm5e-chargen']?.grantedPoints ?? 0
      const purchased = Math.max((item.system.points ?? 0) - grantedPoints, 0)
      if (featuretype === 'flaw') flawsSpent += purchased
      else meritsSpent += purchased
    }
    const flawBonus = Math.min(flawsSpent, 2)
    const poolMax = 7 + flawBonus
    return { meritsSpent, flawsSpent, flawBonus, poolMax, remaining: poolMax - meritsSpent }
  }

  // Gates the Next/Finish button on the step actually being finished per
  // the corebook, rather than letting a player skip ahead having only
  // picked, say, one Attribute. Only checks the step currently being LEFT
  // - it's not a full end-to-end audit of the whole wizard.
  #currentStepCompletion () {
    const stepId = STEPS[this.stepIndex].id

    switch (stepId) {
      case 'concept': {
        const headers = this.actor.system.headers ?? {}
        const missing = ['concept', 'ambition', 'desire'].filter(key => !(headers[key] ?? '').trim())
        if (missing.length > 0) {
          return { complete: false, message: `Fill in ${missing.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')} before moving on - no skipping the lore.` }
        }
        if (!headers.generation) {
          return { complete: false, message: 'Pick a Generation before moving on - it sets your starting Blood Potency.' }
        }
        return { complete: true }
      }

      case 'attributes': {
        const counts = this.#ratingCounts('attributes', Object.values(ATTRIBUTE_GROUPS).flat())
        const missing = Object.entries(ATTRIBUTE_RATING_QUOTA)
          .filter(([rating, allowed]) => (counts[rating] || 0) !== Number(allowed))
          .map(([rating, allowed]) => `${allowed - (counts[rating] || 0)} more at ${'•'.repeat(Number(rating))}`)
        return missing.length === 0
          ? { complete: true }
          : { complete: false, message: `Attributes aren't finished yet - still need: ${missing.join(', ')}.` }
      }

      case 'skills': {
        const distKey = this.actor.flags?.['vtm5e-chargen']?.skillDistribution
        const dist = distKey ? SKILL_DISTRIBUTIONS[distKey] : null
        if (!dist) return { complete: false, message: 'Pick a Skill distribution before moving on.' }
        const counts = this.#ratingCounts('skills', Object.values(SKILL_GROUPS).flat())
        const missing = Object.entries(dist.quota)
          .filter(([rating, allowed]) => (counts[rating] || 0) !== Number(allowed))
          .map(([rating, allowed]) => {
            const diff = Number(allowed) - (counts[rating] || 0)
            return diff > 0 ? `${diff} more at ${'•'.repeat(Number(rating))}` : `${-diff} too many at ${'•'.repeat(Number(rating))}`
          })
        return missing.length === 0
          ? { complete: true }
          : { complete: false, message: `${dist.label} isn't finished yet - still need: ${missing.join(', ')}.` }
      }

      case 'clan':
        return this.actor.items.some(i => i.type === 'clan')
          ? { complete: true }
          : { complete: false, message: 'Pick a Clan before moving on.' }

      case 'predator':
        return this.actor.items.some(i => i.type === 'predatorType')
          ? { complete: true }
          : { complete: false, message: 'Pick a Predator Type before moving on.' }

      case 'meritsflaws': {
        // "take 2 points of Flaws in addition to the ones gained from your
        // Predator type" (p.136) - the corebook is explicit that this is
        // separate from, not inclusive of, whatever a grant already forced
        // on the character. #meritPoolStatus().flawsSpent already excludes
        // granted dots for exactly this reason (it's the same number that
        // drives the merit-pool bonus), so reuse it here instead of
        // counting all Flaw dots on the sheet.
        const flawsSpent = this.#meritPoolStatus().flawsSpent
        if (flawsSpent < MIN_REQUIRED_FLAW_DOTS) {
          return { complete: false, message: `Corebook chargen requires at least ${MIN_REQUIRED_FLAW_DOTS} dots of voluntary Flaws, in addition to any your Predator Type already gave you (currently ${flawsSpent} voluntary).` }
        }

        // Thin-blood characters have a second, separate requirement on top
        // of the normal Flaw minimum above.
        const currentClan = this.actor.items.find(i => i.type === 'clan')
        const thinBlood = this.#buildThinBloodView(currentClan)
        if (thinBlood && !thinBlood.valid) {
          return { complete: false, message: `Thin-blood characters need 1-3 Thin-Blood Merits and an equal number of Thin-Blood Flaws (currently ${thinBlood.meritsTaken} Merit${thinBlood.meritsTaken === 1 ? '' : 's'}, ${thinBlood.flawsTaken} Flaw${thinBlood.flawsTaken === 1 ? '' : 's'}).` }
        }

        return { complete: true }
      }

      case 'touchstones': {
        const headers = this.actor.system.headers ?? {}
        const missing = ['tenets', 'touchstones'].filter(key => !(headers[key] ?? '').trim())
        return missing.length === 0
          ? { complete: true }
          : { complete: false, message: `Fill in ${missing.includes('tenets') ? 'Convictions' : ''}${missing.length === 2 ? ' and ' : ''}${missing.includes('touchstones') ? 'Touchstones' : ''} before moving on.` }
      }

      case 'final':
        return (this.actor.system.headers?.sire ?? '').trim()
          ? { complete: true }
          : { complete: false, message: 'Fill in Sire before finishing - even "unknown" or "none" is fine, but it needs an answer.' }

      default:
        return { complete: true }
    }
  }

  #buildMeritsFlawsView () {
    const pool = this.#meritPoolStatus()
    const search = (this.mfSearch || '').trim().toLowerCase()
    const TYPE_LABELS = { merit: 'Merits', background: 'Backgrounds', flaw: 'Flaws' }

    const byType = { merit: new Map(), background: new Map(), flaw: new Map() }

    for (const doc of this.meritsFlawsItems || []) {
      const featuretype = doc.system.featuretype
      if (!byType[featuretype]) continue
      if (search && !doc.name.toLowerCase().includes(search)) continue

      // Thin-Blood Merits/Flaws only ever show through the dedicated
      // Thin-Blood section above (gated to Thin-Blooded clan by
      // #buildThinBloodView) - excluded here unconditionally rather than
      // relying on each compendium item carrying its own requireClan
      // restriction flag, which depends on a manually-run macro
      // (configure-meritsflaws-clan-only-restrictions.js) staying in sync
      // with whatever's currently in the pack. Folder-name detection can't
      // drift out of date the way a hardcoded name list can.
      const rawFolderName = doc.folder?.name ?? ''
      if (/^Thin-Blood (Merits|Flaws)/.test(rawFolderName)) continue

      const existing = this.actor.items.find(i => i.type === 'feature' && i.name === doc.name)
      const grantedPoints = existing?.flags?.['vtm5e-chargen']?.grantedPoints ?? 0
      const value = existing?.system.points ?? 0
      const plainDesc = doc.system.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

      // Most compendium entries have a fixed canonical rating baked into
      // system.points (e.g. Iron Will is always 2 dots, never 1 or 3) -
      // those render as a single priced toggle, not a free 1-5 slider.
      // A handful (mostly Backgrounds, whose description spells out what
      // each dot level means) are stored with points:0 to mean "player
      // picks the level" - those keep the slider.
      const fixedCost = doc.system.points || null

      // Only items the player doesn't already hold can be "unavailable" -
      // an already-owned item (even partially, from a grant) is never
      // greyed out, just possibly capped from going higher (handled by
      // the same check in #setMeritFlawRating when they try to increase).
      let unavailableReasons = []
      if (!existing) {
        unavailableReasons = checkRestrictions(this.actor, doc.flags?.['vtm5e-chargen']?.restrictions ?? [])
        const conflicts = checkConflicts(this.actor, doc.name, doc.flags?.['vtm5e-chargen']?.conflictsWith ?? [])
        if (conflicts.length > 0) unavailableReasons = [...unavailableReasons, `Conflicts with ${conflicts.join(', ')}, which you already have.`]
      }

      // Distinct from unavailable (all-or-nothing): a rating cap still lets
      // the item be taken, it just can't go past a certain dot until some
      // other condition is met (e.g. Library capped at 1 without Base Haven
      // 2+) - the capped dots render locked with their own explanation
      // rather than as a normal open pick.
      const ratingCap = fixedCost ? null : getRatingCap(this.actor, doc)
      const ratingCapReason = ratingCap != null ? checkRestrictions(this.actor, [doc.flags['vtm5e-chargen'].ratingCap.unless]).join(' ') : null

      const folderName = doc.folder?.name ?? 'Other'
      if (!byType[featuretype].has(folderName)) byType[featuretype].set(folderName, [])
      byType[featuretype].get(folderName).push({
        id: doc.id,
        name: doc.name,
        // Full text, not truncated - the row is collapsed by default (see
        // .vtm5e-chargen-mf-item-desc's display:none, toggled by
        // toggleMfItem) so there's no clutter cost to showing the whole
        // thing once a player actually expands one.
        description: plainDesc,
        expanded: this.expandedMfIds.has(doc.id),
        value,
        grantedPoints,
        fixedCost,
        fixedCostDots: fixedCost ? '•'.repeat(fixedCost) : null,
        owned: value > 0,
        lockedFixed: !!fixedCost && grantedPoints >= fixedCost,
        unavailable: unavailableReasons.length > 0,
        unavailableReason: unavailableReasons.join(' '),
        dots: fixedCost
          ? null
          : [1, 2, 3, 4, 5].map(n => ({
              n,
              filled: n <= value,
              locked: n <= grantedPoints,
              capped: ratingCap != null && n > ratingCap && n > grantedPoints,
              capReason: ratingCapReason
            }))
      })
    }

    const owned = this.actor.items
      .filter(i => i.type === 'feature')
      .map(i => {
        const compendiumDoc = this.meritsFlawsItems?.find(d => d.name === i.name)
        const featuretype = compendiumDoc?.system.featuretype ?? i.system.featuretype
        const grantedPoints = i.flags?.['vtm5e-chargen']?.grantedPoints ?? 0
        const value = i.system.points ?? 0
        const rawDesc = compendiumDoc?.system.description ?? i.system.description ?? ''
        const plainDesc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        return {
          name: i.name,
          value,
          dotsDisplay: '•'.repeat(Math.max(value, 0)),
          isGranted: grantedPoints > 0,
          isFlaw: featuretype === 'flaw',
          description: plainDesc.length > 220 ? plainDesc.slice(0, 217) + '…' : plainDesc,
          // Only a purely player-chosen item can be one-click removed here -
          // one that's (even partially) free from a grant needs the player
          // to go find it in the list below, where the locked/purchased
          // split is visible, rather than silently deleting a free dot.
          removable: grantedPoints === 0,
          compendiumId: compendiumDoc?.id ?? null,
          actorItemId: i.id
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const groups = ['merit', 'background', 'flaw'].map(featuretype => ({
      featuretype,
      label: TYPE_LABELS[featuretype],
      folders: [...byType[featuretype].entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, items]) => ({
          name,
          // Folders auto-expand while searching so matches aren't hidden
          // behind a collapsed header the player never asked to open.
          open: this.openFolders.has(name) || !!search,
          items: items.sort((a, b) => a.name.localeCompare(b.name))
        }))
    }))

    return { ...pool, overBudget: pool.remaining < 0, search: this.mfSearch || '', owned, groups }
  }

  // Thin-blood characters get a second, separate pool on top of the
  // normal Merits & Flaws budget above: "between one and three Thin-Blood
  // Merits and the same number of Thin-Blood Flaws" (p.148-150), free of
  // dot cost and not counted against the 7-point pool. Returns null for
  // any non-Thin-Blooded clan so the template can skip the section
  // entirely.
  #buildThinBloodView (currentClan) {
    if (currentClan?.name !== 'Thin-Blooded') return null

    const merits = []
    const flaws = []
    for (const doc of this.meritsFlawsItems || []) {
      const folderName = doc.folder?.name ?? ''
      const isFlaw = /^Thin-Blood Flaws/.test(folderName)
      const isMerit = /^Thin-Blood Merits/.test(folderName)
      if (!isFlaw && !isMerit) continue

      const existing = this.actor.items.find(i => i.type === 'feature' && i.name === doc.name)
      const plainDesc = doc.system.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const entry = {
        id: doc.id,
        name: doc.name,
        description: plainDesc.length > 160 ? plainDesc.slice(0, 157) + '…' : plainDesc,
        taken: !!existing
      }
      if (isFlaw) flaws.push(entry)
      else merits.push(entry)
    }
    merits.sort((a, b) => a.name.localeCompare(b.name))
    flaws.sort((a, b) => a.name.localeCompare(b.name))

    const meritsTaken = merits.filter(m => m.taken).length
    const flawsTaken = flaws.filter(f => f.taken).length

    return {
      merits,
      flaws,
      meritsTaken,
      flawsTaken,
      valid: meritsTaken >= 1 && meritsTaken <= 3 && meritsTaken === flawsTaken
    }
  }

  async _onRender (context, options) {
    super._onRender(context, options)

    if (this.#pendingScrollTop !== null || this.#pendingScrollAnchor !== null) {
      const targetScrollTop = this.#pendingScrollTop
      const anchor = this.#pendingScrollAnchor
      this.#pendingScrollTop = null
      this.#pendingScrollAnchor = null

      const restore = () => {
        const body = this.element?.querySelector('.vtm5e-chargen-body')
        if (!body) return
        if (anchor) {
          const anchorEl = anchor.findAnchor()
          if (anchorEl) {
            body.scrollTop += anchorEl.getBoundingClientRect().top - anchor.top
            return
          }
        }
        if (targetScrollTop !== null) body.scrollTop = targetScrollTop
      }
      // Set it now, then again after paint - belt and suspenders against
      // any late focus/layout adjustment (Foundry's own or the browser's)
      // still trying to scroll something into view after this point.
      restore()
      requestAnimationFrame(restore)
    }

    this.element.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('change', async (event) => {
        const field = event.currentTarget.dataset.field
        await this.actor.update({ [field]: event.currentTarget.value })
        // Re-render so the Next button's gate (e.g. Concept/Ambition/Desire
        // on the concept step) picks up the new value immediately - 'change'
        // only fires on blur/enter, so focus is already gone and there's
        // nothing to preserve.
        this.render()
      })
    })

    // Bound directly per-element (each listener closes over ITS OWN id)
    // rather than going through Foundry's shared data-action delegation -
    // ruling out any possibility of a click resolving against the wrong
    // element after a re-render reshuffles the grid.
    this.element.querySelectorAll('[data-clan-id]').forEach(el => {
      const clanId = el.dataset.clanId
      el.addEventListener('click', () => this.#pickClan(clanId))
    })

    this.element.querySelectorAll('[data-predator-id]').forEach(el => {
      const predatorId = el.dataset.predatorId
      el.addEventListener('click', () => this.#pickPredator(predatorId))
    })

    // Every keystroke triggers a render() (so results/pool totals update
    // live), which rebuilds the DOM out from under the input - so focus
    // and caret position have to be explicitly restored afterward or
    // typing loses focus after the first character.
    const mfSearchEl = this.element.querySelector('#vtm5e-chargen-mf-search')
    if (mfSearchEl) {
      mfSearchEl.addEventListener('input', (event) => {
        this.mfSearch = event.currentTarget.value
        this.#preserveScroll()
        this.render()
      })
      mfSearchEl.addEventListener('focus', () => { this.mfSearchFocused = true })
      mfSearchEl.addEventListener('blur', () => { this.mfSearchFocused = false })
      if (this.mfSearchFocused) {
        mfSearchEl.focus()
        const pos = mfSearchEl.value.length
        mfSearchEl.setSelectionRange(pos, pos)
      }
    }

    const genSelect = this.element.querySelector('#vtm5e-chargen-generation-select')
    if (genSelect) {
      genSelect.addEventListener('change', async (event) => {
        const gen = event.currentTarget.value
        const info = GENERATION_INFO[gen]
        this.#preserveScroll()
        await this.actor.update({
          'system.headers.generation': gen,
          'system.blood.generation': gen,
          'system.blood.potency': info?.bp ?? 0,
          // Abstracts an Embrace date from generation per the corebook's
          // Sea of Time / generation tables (p.136-137, p.213) - a
          // suggestion, not a fixed value, so it's a plain editable text
          // field afterward (Final Touches), not re-derived on every
          // render.
          'system.bio.dateof.death': info?.era ?? ''
        })
        this.render()
      })
    }
  }

  async #applyPendingClanGrants () {
    const clanItem = this.actor.items.find(i => i.type === 'clan')
    if (!clanItem) return
    await applyTrackedGrants(this.actor, {
      slot: 'clan',
      pickLabel: 'Clan',
      name: clanItem.name,
      sourceLabel: `Clan: ${clanItem.name}`,
      grants: clanItem.flags?.['vtm5e-chargen']?.grants ?? []
    }, this.log)
  }

  async #applyPendingPredatorGrants () {
    const predItem = this.actor.items.find(i => i.type === 'predatorType')
    if (!predItem) return
    await applyTrackedGrants(this.actor, {
      slot: 'predator',
      pickLabel: 'Predator Type',
      name: predItem.name,
      sourceLabel: `Predator Type: ${predItem.name}`,
      grants: predItem.flags?.['vtm5e-chargen']?.grants ?? []
    }, this.log)
  }

  static #onGoToStep (event, target) {
    const id = target.dataset.step
    const idx = STEPS.findIndex(s => s.id === id)
    if (idx < 0) return

    // Free to jump backward (or to the current step) - only forward jumps
    // past the frontier reached via a validated Next click are gated, same
    // rule the Next button already enforces.
    if (idx > Math.max(this.stepIndex, this.maxStepIndex)) {
      ui.notifications.warn('Finish the current step before skipping ahead.')
      return
    }

    this.stepIndex = idx
    this.render()
  }

  static #onPrevStep () {
    this.stepIndex = Math.max(0, this.stepIndex - 1)
    this.render()
  }

  static async #onNextStep () {
    // Defense in depth - the button is already disabled when incomplete,
    // but don't rely on that alone.
    const completion = this.#currentStepCompletion()
    if (!completion.complete) {
      ui.notifications.warn(completion.message)
      return
    }

    const leavingStepId = STEPS[this.stepIndex].id

    // Grants apply on leaving the step, not on the click that made the
    // pick - gives the player a chance to read the description first.
    if (leavingStepId === 'clan') await this.#applyPendingClanGrants()
    if (leavingStepId === 'predator') await this.#applyPendingPredatorGrants()

    this.stepIndex = Math.min(STEPS.length - 1, this.stepIndex + 1)
    this.maxStepIndex = Math.max(this.maxStepIndex, this.stepIndex)
    this.render()
  }

  static async #onFinishWizard () {
    const completion = this.#currentStepCompletion()
    if (!completion.complete) {
      ui.notifications.warn(completion.message)
      return
    }

    // Captured before the flag is set below - only a genuinely first-ever
    // Finish should grant starting wealth. A GM reopening an already-
    // completed wizard and clicking Finish again must never re-run this and
    // clobber cash the player has since spent in the Gear Shop.
    const alreadyCompleted = !!this.actor.getFlag('vtm5e-chargen', 'wizardCompleted')

    await this.actor.setFlag('vtm5e-chargen', 'wizardCompleted', true)
    ui.notifications.info(`${this.actor.name}'s character creation is complete.`)

    if (!alreadyCompleted) await ChargenApp.#ensurePhoneForActor(this.actor)

    // Soft integration, same spirit as vtm5e-charactersheet's soft xpshop
    // check - chargen works standalone if vtm5e-gearshop isn't installed.
    const gearshop = game.modules.get('vtm5e-gearshop')
    if (!alreadyCompleted && gearshop?.active) {
      const cents = await gearshop.api.grantStartingWealth(this.actor)
      const dollars = (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      ui.notifications.info(`${this.actor.name} starts with ${dollars} - check the Shop app on your phone to outfit up.`)
    }

    this.close()
  }

  // Best-effort phone provisioning so the Gear Shop (and the rest of
  // smartphone-widget) is actually reachable right after chargen without a
  // manual GM step. A phone in that module lives in a GM-only world Setting
  // - even the "create one" call has to run on the GM's own client, so this
  // goes through the same socket-relay pattern smartphone-widget's own
  // BankingApp/FirstTimeSetupWizard use (SmartphoneWidget.SOCKET.
  // executeAsGM('createNewPhone', {ownerId})) rather than writing the
  // setting directly, which a player-context client can't do. Requires the
  // GM to be online to actually resolve - fails soft with a clear warning
  // if not, same as this project's other best-effort integrations.
  static async #ensurePhoneForActor (actor) {
    const smartphone = game.modules.get('smartphone-widget')
    if (!smartphone?.active) return

    try {
      const { SmartphoneWidget } = await import('/modules/smartphone-widget/scripts/core/SmartphoneWidget.js')
      const existing = await SmartphoneWidget.getPhoneForActor(actor.id)
      if (existing) return

      const result = await SmartphoneWidget.SOCKET.executeAsGM('createNewPhone', { ownerId: actor.id })
      if (result?.success) {
        ui.notifications.info(`${actor.name} was issued a phone - the Shop app is ready on it.`)
      } else {
        console.warn('vtm5e-chargen | createNewPhone did not succeed:', result)
        ui.notifications.warn(`Couldn't automatically create a phone for ${actor.name} - a GM will need to add one from Smartphone Widget settings.`)
      }
    } catch (err) {
      console.warn('vtm5e-chargen | Phone auto-provisioning failed (GM likely offline):', err)
      ui.notifications.warn(`Couldn't automatically create a phone for ${actor.name} - a GM will need to add one from Smartphone Widget settings.`)
    }
  }

  static async #onAdjustAttribute (event, target) {
    const id = target.dataset.attribute
    const n = Number(target.dataset.n)
    const current = this.actor.system.attributes?.[id]?.value ?? 0
    const next = current === n ? n - 1 : n

    if (next > current) {
      const allowed = ATTRIBUTE_RATING_QUOTA[next]
      const counts = this.#ratingCounts('attributes', Object.values(ATTRIBUTE_GROUPS).flat(), id)
      if (!allowed || (counts[next] || 0) >= allowed) {
        ui.notifications.warn(`Corebook chargen only allows ${allowed ?? 0} Attribute${allowed === 1 ? '' : 's'} at ${'•'.repeat(next)} - that's already used up. Lower another Attribute first if you want to move a dot here.`)
        return
      }
    }

    await this.actor.update({ [`system.attributes.${id}.value`]: next })
    this.#preserveScroll()
    this.render()
  }

  static async #onAdjustSkill (event, target) {
    const id = target.dataset.skill
    const n = Number(target.dataset.n)
    const current = this.actor.system.skills?.[id]?.value ?? 0
    const next = current === n ? n - 1 : n

    if (next > current) {
      const distKey = this.actor.flags?.['vtm5e-chargen']?.skillDistribution
      const dist = distKey ? SKILL_DISTRIBUTIONS[distKey] : null
      if (!dist) {
        ui.notifications.warn('Pick a Skill distribution above before assigning dots.')
        return
      }
      const allowed = dist.quota[next]
      const counts = this.#ratingCounts('skills', Object.values(SKILL_GROUPS).flat(), id)
      if (!allowed || (counts[next] || 0) >= allowed) {
        ui.notifications.warn(`${dist.label} only allows ${allowed ?? 0} Skill${allowed === 1 ? '' : 's'} at ${'•'.repeat(next)} - that's already used up.`)
        return
      }
    }

    await this.actor.update({ [`system.skills.${id}.value`]: next })
    this.#preserveScroll()
    this.render()
  }

  static async #onPickSkillDistribution (event, target) {
    const key = target.dataset.distribution
    await this.actor.setFlag('vtm5e-chargen', 'skillDistribution', key)
    this.#preserveScroll()
    this.render()
  }

  static #onToggleMfFolder (event, target) {
    const name = target.dataset.folder
    if (this.openFolders.has(name)) this.openFolders.delete(name)
    else this.openFolders.add(name)

    // Anchor on this exact button, not just "a button named X" - Merits
    // and Flaws can each have their own "Other" folder, so the name alone
    // isn't guaranteed unique. Position among all folder-toggle buttons
    // is stable across the re-render since the list itself doesn't
    // reorder from a single toggle.
    const index = Array.from(this.element.querySelectorAll('[data-action="toggleMfFolder"]')).indexOf(target)
    const findAnchor = index >= 0
      ? () => this.element.querySelectorAll('[data-action="toggleMfFolder"]')[index] ?? null
      : null
    this.#preserveScroll(findAnchor)
    this.render()
  }

  static #onToggleMfItem (event, target) {
    const id = target.dataset.mfItemId
    if (this.expandedMfIds.has(id)) this.expandedMfIds.delete(id)
    else this.expandedMfIds.add(id)

    const index = Array.from(this.element.querySelectorAll('[data-action="toggleMfItem"]')).indexOf(target)
    const findAnchor = index >= 0
      ? () => this.element.querySelectorAll('[data-action="toggleMfItem"]')[index] ?? null
      : null
    this.#preserveScroll(findAnchor)
    this.render()
  }

  // Fallback for the Currently Acquired list's remove button when an item
  // has no matching compendium doc to look up (a placeholder auto-created
  // for a grant that named something not yet in vtm5e-meritsflaws) -
  // #onAdjustMeritFlaw can't handle that case since it keys off a
  // compendium id, so this just deletes the actor's own item directly.
  static async #onRemoveOwnedFeature (event, target) {
    const itemId = target.dataset.itemId
    const item = this.actor.items.get(itemId)
    if (!item) return
    this.log.push(`<b>Merits &amp; Flaws</b>: removed <b>${item.name}</b>`)
    this.#preserveScroll()
    await this.actor.deleteEmbeddedDocuments('Item', [itemId])
    this.render()
  }

  static async #onToggleThinBloodItem (event, target) {
    await this.#toggleThinBloodItem(target.dataset.tbId)
  }

  async #toggleThinBloodItem (compendiumId) {
    const doc = this.meritsFlawsItems.find(d => d.id === compendiumId)
    if (!doc) {
      console.warn('vtm5e-chargen | #toggleThinBloodItem: no item found for id', compendiumId)
      return
    }

    const folderName = doc.folder?.name ?? ''
    const isFlaw = /^Thin-Blood Flaws/.test(folderName)
    const kindLabel = isFlaw ? 'Flaw' : 'Merit'
    const existing = this.actor.items.find(i => i.type === 'feature' && i.name === doc.name)

    if (!existing) {
      const sameCategoryNames = new Set(
        (this.meritsFlawsItems || [])
          .filter(d => new RegExp(`^Thin-Blood ${isFlaw ? 'Flaws' : 'Merits'}`).test(d.folder?.name ?? ''))
          .map(d => d.name)
      )
      const currentCount = this.actor.items.filter(i => i.type === 'feature' && sameCategoryNames.has(i.name)).length
      if (currentCount >= 3) {
        ui.notifications.warn(`Thin-blood characters can take at most 3 Thin-Blood ${kindLabel}s.`)
        return
      }
    }

    try {
      if (existing) {
        await this.actor.deleteEmbeddedDocuments('Item', [existing.id])
        this.log.push(`<b>Thin-Blood ${kindLabel}</b>: removed <b>${doc.name}</b>`)
      } else {
        const data = doc.toObject()
        delete data._id
        delete data.ownership
        // Thin-Blood Merits/Flaws "have no dot value" (p.182-183) - taking
        // one is a presence/absence toggle, not a rated purchase.
        data.system.points = 0
        await this.actor.createEmbeddedDocuments('Item', [data])
        this.log.push(`<b>Thin-Blood ${kindLabel}</b>: took <b>${doc.name}</b>`)
      }
      this.#preserveScroll()
      this.render()
    } catch (err) {
      console.error('vtm5e-chargen | Failed to toggle Thin-Blood item:', err)
      ui.notifications.error(`vtm5e-chargen: failed to toggle ${doc.name} (${err.message}) - see console.`)
    }
  }

  static async #onAdjustMeritFlaw (event, target) {
    const mfId = target.dataset.mfId
    const n = Number(target.dataset.n)
    await this.#setMeritFlawRating(mfId, n)
  }

  async #setMeritFlawRating (compendiumId, clickedN) {
    const doc = this.meritsFlawsItems.find(d => d.id === compendiumId)
    if (!doc) {
      console.warn('vtm5e-chargen | #setMeritFlawRating: no item found for id', compendiumId)
      return
    }

    const existing = this.actor.items.find(i => i.type === 'feature' && i.name === doc.name)
    const grantedPoints = existing?.flags?.['vtm5e-chargen']?.grantedPoints ?? 0
    // Strictly less-than, not <=: a click AT the granted floor (including
    // the remove button, which always sends 0) must be allowed through when
    // grantedPoints is 0 - there's nothing free to protect. The old <=
    // silently no-op'd every "remove" click on a purely player-purchased
    // item, since 0 <= 0 is true. Only a click that would dip BELOW the
    // free portion (e.g. grantedPoints:2, clickedN:1) should be blocked.
    if (clickedN < grantedPoints) return

    const currentValue = existing?.system.points ?? 0
    const fixedCost = doc.system.points || null
    let nextValue
    if (fixedCost) {
      // Fixed-rating item (single canonical level, e.g. Iron Will is
      // always 2) - the template renders one priced button, not a 1-5
      // slider, so a click is a plain on/off toggle at that exact cost.
      nextValue = currentValue >= fixedCost ? 0 : fixedCost
    } else {
      // Same click convention as adjustAttribute/adjustSkill: clicking the
      // current top dot reduces by one, clicking any other dot sets to it.
      nextValue = currentValue === clickedN ? clickedN - 1 : clickedN
    }
    nextValue = Math.max(nextValue, grantedPoints)

    const currentPurchased = Math.max(currentValue - grantedPoints, 0)
    const nextPurchased = Math.max(nextValue - grantedPoints, 0)
    const delta = nextPurchased - currentPurchased

    // Only check restrictions/conflicts when actually taking/increasing -
    // never trap a player who already has something into being unable to
    // lower or remove it.
    if (delta > 0) {
      const restrictions = doc.flags?.['vtm5e-chargen']?.restrictions ?? []
      const restrictionFailures = checkRestrictions(this.actor, restrictions)
      if (restrictionFailures.length > 0) {
        ui.notifications.error(`Can't take ${doc.name}: ${restrictionFailures.join(' ')}`)
        return
      }
      const ratingCap = getRatingCap(this.actor, doc)
      if (ratingCap != null && nextValue > ratingCap) {
        ui.notifications.error(`${doc.name} is capped at ${ratingCap} dot(s) until you meet its requirement.`)
        return
      }
      if (!existing) {
        const conflictsWith = doc.flags?.['vtm5e-chargen']?.conflictsWith ?? []
        const conflicts = checkConflicts(this.actor, doc.name, conflictsWith)
        if (conflicts.length > 0) {
          ui.notifications.error(`Can't take ${doc.name}: conflicts with ${conflicts.join(', ')}, which you already have.`)
          return
        }
      }
    }

    if (delta > 0 && doc.system.featuretype !== 'flaw') {
      const pool = this.#meritPoolStatus()
      if (delta > pool.remaining) {
        ui.notifications.warn(`Not enough Merit/Background points: ${pool.remaining} remaining, ${doc.name} needs ${delta} more.`)
        return
      }
    }

    try {
      if (!existing) {
        const data = doc.toObject()
        delete data._id
        delete data.ownership
        data.system.points = nextValue
        foundry.utils.setProperty(data, 'flags.vtm5e-chargen.grantedPoints', 0)
        await this.actor.createEmbeddedDocuments('Item', [data])
        this.log.push(`<b>Merits &amp; Flaws</b>: took <b>${doc.name}</b> (${'•'.repeat(nextValue)})`)
      } else if (nextValue <= 0 && grantedPoints <= 0) {
        await this.actor.deleteEmbeddedDocuments('Item', [existing.id])
        this.log.push(`<b>Merits &amp; Flaws</b>: removed <b>${doc.name}</b>`)
      } else {
        await existing.update({ 'system.points': nextValue })
        this.log.push(`<b>Merits &amp; Flaws</b>: set <b>${doc.name}</b> to ${'•'.repeat(nextValue)}`)
      }
      this.#preserveScroll()
      this.render()
    } catch (err) {
      console.error('vtm5e-chargen | Failed to adjust Merit/Flaw:', err)
      ui.notifications.error(`vtm5e-chargen: failed to adjust ${doc.name} (${err.message}) - see console.`)
    }
  }

  // #pickPredator already blocks picking a Predator Type that the CURRENT
  // Clan excludes - but the wizard lets a player revisit an earlier step,
  // so the reverse order (Predator Type picked first, Clan changed to one
  // that excludes it afterward) was never re-checked, silently leaving an
  // invalid combination on the sheet. Called after every Clan change.
  async #revalidatePredatorAgainstClan () {
    const predItem = this.actor.items.find(i => i.type === 'predatorType')
    if (!predItem) return
    const restrictions = predItem.flags?.['vtm5e-chargen']?.restrictions ?? []
    const failures = checkRestrictions(this.actor, restrictions)
    if (failures.length === 0) return

    ui.notifications.warn(`Your Predator Type (${predItem.name}) no longer fits your Clan - ${failures.join(' ')} It's been cleared; pick a new one.`)
    await clearTrackedGrants(this.actor, 'predator', this.log)
    await this.actor.deleteEmbeddedDocuments('Item', [predItem.id])
  }

  async #pickClan (clanId) {
    const clanDoc = this.clanItems.find(c => c.id === clanId)
    if (!clanDoc) {
      console.warn('vtm5e-chargen | #pickClan: no clan found in this.clanItems for id', clanId, this.clanItems)
      return
    }

    const existingClanItems = this.actor.items.filter(i => i.type === 'clan')
    if (existingClanItems.length === 1 && existingClanItems[0].name === clanDoc.name) return

    try {
      // Delete EVERY existing clan item, not just the first one found.
      // wod5e's "limitOnePerActor" is only enforced by the sheet's own
      // drag-drop handler, not by Actor#createEmbeddedDocuments, so
      // calling that API directly (as this wizard does) never replaces an
      // existing clan on its own - and if more than one ever accumulated
      // (e.g. from an earlier version of this handler that only deleted
      // one), .find() picking "the current clan" becomes effectively
      // unpredictable depending on collection ordering after each
      // delete+create. Always clearing the full set keeps exactly one.
      if (existingClanItems.length > 0) {
        await this.actor.deleteEmbeddedDocuments('Item', existingClanItems.map(i => i.id))
      }

      // Only sets the pick and shows its description - grants are applied
      // when the player clicks Next, not immediately on click.
      const data = clanDoc.toObject()
      delete data._id
      delete data.ownership
      await this.actor.createEmbeddedDocuments('Item', [data])
      await this.#revalidatePredatorAgainstClan()
      this.#preserveScroll()
      this.render()
    } catch (err) {
      console.error('vtm5e-chargen | Failed to set Clan:', err)
      ui.notifications.error(`vtm5e-chargen: failed to set Clan (${err.message}) - see console.`)
    }
  }

  async #pickPredator (predatorId) {
    const predDoc = this.predatorItems.find(p => p.id === predatorId)
    if (!predDoc) {
      console.warn('vtm5e-chargen | #pickPredator: no predator type found in this.predatorItems for id', predatorId, this.predatorItems)
      return
    }

    const existingPredatorItems = this.actor.items.filter(i => i.type === 'predatorType')
    if (existingPredatorItems.length === 1 && existingPredatorItems[0].name === predDoc.name) return

    const restrictions = predDoc.flags?.['vtm5e-chargen']?.restrictions ?? []
    const failures = checkRestrictions(this.actor, restrictions)
    if (failures.length > 0) {
      ui.notifications.error(`Can't take ${predDoc.name}: ${failures.join(' ')}`)
      return
    }

    try {
      // Delete EVERY existing predatorType item, not just the first one
      // found - see the matching comment in #pickClan for why.
      if (existingPredatorItems.length > 0) {
        await this.actor.deleteEmbeddedDocuments('Item', existingPredatorItems.map(i => i.id))
      }

      const data = predDoc.toObject()
      delete data._id
      delete data.ownership
      await this.actor.createEmbeddedDocuments('Item', [data])
      this.#preserveScroll()
      this.render()
    } catch (err) {
      console.error('vtm5e-chargen | Failed to set Predator Type:', err)
      ui.notifications.error(`vtm5e-chargen: failed to set Predator Type (${err.message}) - see console.`)
    }
  }
}

export function openChargenWizard (actor) {
  if (!actor) {
    ui.notifications.error('vtm5e-chargen: pick or pass an actor first (e.g. select a token, or pass game.actors.get(id)).')
    return
  }
  new ChargenApp(actor).render(true)
}
