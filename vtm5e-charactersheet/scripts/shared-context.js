// Prep helpers identical across every vampire-family sheet this module
// reskins (Vampire, Ghoul - both extend wod5e's own vampire-side actor
// classes and share the exact same Disciplines/Features/Equipment context
// shape). Split out once a second concrete sheet needed the same logic
// verbatim, rather than duplicated per-class.
import { _onAddExperience } from '/systems/wod5e/system/actor/scripts/experience.js'

const MODULE_ID = 'vtm5e-charactersheet'

// Intercepts only the Experience tab's "Spend" button (data-operation=
// "spend") to open the vtm5e-xpshop module's cart/checkout app instead of
// wod5e's stock dumb dialog (which just logs a +/- number, never touches
// any trait). "Add" (gaining XP) and every other splat without a shop yet
// fall through to wod5e's own _onAddExperience unchanged. Soft dependency -
// degrades to stock behavior if vtm5e-xpshop isn't installed/active, same
// pattern as this project's other optional cross-module integrations (e.g.
// the smartphone-widget hook in vtm5e-domainmap).
export async function onSpendOrAddExperience (event, target) {
  const isSpend = target.getAttribute('data-operation') === 'spend'
  const shop = game.modules.get('vtm5e-xpshop')
  if (isSpend && shop?.active) {
    return shop.api.open(this.actor)
  }
  return _onAddExperience.call(this, event, target)
}

export const FEATURE_COLUMNS = [
  { key: 'merit', label: 'Merits' },
  { key: 'flaw', label: 'Flaws' },
  { key: 'background', label: 'Backgrounds' },
  { key: 'boon', label: 'Boons' }
]

// Short hover-tooltip blurbs for Attributes/Skills - universal across every
// splat this module reskins, since they all share attributes-skills.hbs and
// wod5e's own Attributes/Skills definitions (system/api/def/attributes.js,
// def/skills.js) unchanged. Keyed by the same id wod5e itself uses
// (attribute.id/skill.id, e.g. "animalken" not "animal ken").
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

// Discipline category tooltips - vampire/ghoul only (both share the exact
// same Discipline data). Rituals/Ceremonies are Blood Sorcery/Oblivion's
// own non-dot-rated power subgroups, not separate Disciplines, but they get
// their own group header in the flat list so they need a blurb too.
const DISCIPLINE_TOOLTIPS = {
  animalism: 'Command and communicate with animals, and sense or soothe the Beast in others.',
  auspex: 'Heightened senses, telepathy, and supernatural perception.',
  celerity: 'Supernatural speed and reflexes.',
  dominate: "Bend a mortal or vampire's mind and will to your own.",
  fortitude: 'Supernatural toughness and resistance to harm.',
  obfuscate: 'Become unseen, unnoticed, or disguised.',
  oblivion: 'Command death, shadow, and the spirits of the dead.',
  potence: 'Supernatural physical strength.',
  presence: 'Supernaturally compel attraction, awe, or fear in others.',
  protean: 'Shapeshift your body - claws, mist, bat form, and beyond.',
  sorcery: 'Ritual magic worked through vitae.',
  alchemy: 'Craft supernatural formulas from vitae and mundane ingredients.',
  rituals: 'Blood Sorcery rituals - complex magical workings performed over time, not rolled in the moment.',
  ceremonies: 'Oblivion ceremonies - ritual workings involving death and the restless dead.'
}

// Decorates sortedAttributes/sortedSkills (nested {group: {id: {...}}}
// objects already built by wod5e's own prepareStatsContext) with a
// .tooltip field per leaf attribute/skill, for the Attributes & Skills tab
// shared by every splat.
export function decorateStatsTooltips (context) {
  for (const group of Object.values(context.sortedAttributes ?? {})) {
    for (const attribute of Object.values(group)) {
      attribute.tooltip = ATTRIBUTE_TOOLTIPS[attribute.id] || ''
    }
  }

  for (const group of Object.values(context.sortedSkills ?? {})) {
    for (const skill of Object.values(group)) {
      skill.tooltip = SKILL_TOOLTIPS[skill.id] || ''
    }
  }

  return context
}

const ROUSE_COST_WORDS = [
  'Free',
  'One Rouse Check',
  'Two Rouse Checks',
  'Three Rouse Checks',
  'Four Rouse Checks',
  'Five Rouse Checks'
]

// wod5e's own prepareDisciplinesContext (run by super._preparePartContext)
// already builds context.disciplines with each discipline's owned powers
// grouped/sorted and every item's system.enrichedDescription already
// populated - this just decorates each power with display-ready cost text
// for the flat list template.
export function prepareDisciplinesFlatContext (context) {
  for (const [discKey, discipline] of Object.entries(context.disciplines ?? {})) {
    discipline.tooltip = DISCIPLINE_TOOLTIPS[discKey] || ''

    for (const power of discipline.powers ?? []) {
      const cost = power.system?.cost ?? 0
      power.costText = ROUSE_COST_WORDS[cost] ?? `${cost} Rouse Checks`
    }
  }

  return context
}

export function prepareMeritsFlawsContext (context) {
  context.mfColumns = FEATURE_COLUMNS.map((col) => ({
    key: col.key,
    label: col.label,
    items: Object.values(context.features?.[col.key] ?? {})
  }))

  return context
}

export function prepareCurrencyContext (context, actor) {
  context.currency = actor.getFlag(MODULE_ID, 'currency') ?? 0

  return context
}

// wod5e's own toggleCollapse action sizes .collapsible-content by reading
// scrollHeight and writing it back as an inline max-height - which breaks
// down here: with display:none it always reads scrollHeight as 0 (so it can
// never open), and with the max-height/overflow version it was visually
// leaking content past the clip regardless of !important. A plain class
// toggle sidesteps both failure modes entirely. Shared by every expandable-
// row list on these sheets (Disciplines powers, Merits & Flaws, Equipment).
export async function onToggleExpandRow (event, target) {
  event.preventDefault()
  target.closest('.cs-expand-row')?.classList.toggle('cs-expanded')
}
