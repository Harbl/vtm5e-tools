// Extends wod5e's real VampireActorSheet rather than replacing it, so all
// existing data-binding/roll wiring (dot counters, damage tracking,
// disciplines, item actions) keeps working untouched. This module only
// swaps specific PARTS for its own templates and narrows/reorders the
// visible tab list to match the reference design.
import { VampireActorSheet } from '/systems/wod5e/system/actor/vtm/vampire-actor-sheet.js'
import {
  prepareDisciplinesFlatContext,
  prepareMeritsFlawsContext,
  prepareCurrencyContext,
  decorateStatsTooltips,
  onToggleExpandRow,
  onSpendOrAddExperience
} from './shared-context.js'

const MODULE_ID = 'vtm5e-charactersheet'

// Compulsion NAMES only (not the full corebook/Player's Guide flavor text) -
// enough to populate a picker. Kept in sync by hand with the authoritative
// copy (names + full text) in vtm5e-automation/scripts/compulsion.js's
// GENERIC_COMPULSIONS/CLAN_COMPULSIONS; duplicated here rather than
// cross-imported so this sheet still works if vtm5e-automation is ever
// disabled.
const GENERIC_COMPULSION_NAMES = ['Hunger', 'Dominance', 'Harm', 'Paranoia']
const CLAN_COMPULSION_NAMES = {
  brujah: 'Rebellion',
  gangrel: 'Feral Impulses',
  malkavian: 'Delusion',
  nosferatu: 'Cryptophilia',
  toreador: 'Obsession',
  tremere: 'Perfectionism',
  ventrue: 'Arrogance',
  'banu haqim': 'Judgment',
  hecata: 'Morbidity',
  lasombra: 'Ruthlessness',
  ministry: 'Transgression',
  ravnos: 'Tempting Fate',
  salubri: 'Affective Empathy',
  tzimisce: 'Covetousness'
}

// Full Compulsion text, keyed by display name (matches the values in
// GENERIC_COMPULSION_NAMES/CLAN_COMPULSION_NAMES above) - powers the
// hover tooltip on the Compulsion picker. Verbatim copy of the same
// authoritative text in vtm5e-automation/scripts/compulsion.js's
// GENERIC_COMPULSIONS/CLAN_COMPULSIONS (duplicated for the same
// stand-alone-if-vtm5e-automation-is-disabled reason as the names above).
// Flat by name rather than nested by clan since every name across both
// tables is unique - no collisions to worry about.
const COMPULSION_TEXT_BY_NAME = {
  Hunger: 'The vampire will do anything to slake their Hunger, whether that means violence, subterfuge, or outright begging. Any action not immediately conducive to feeding takes a two-dice penalty. Ends when the vampire slakes at least 1 Hunger.',
  Dominance: 'The vampire makes their next interaction a competition, using all means at their disposal to end up victorious - they cannot use teamwork. Any action that avoids establishing dominance or challenging authority takes a two-dice penalty. Ends once the vampire has "won" and gloated over it.',
  Harm: 'The Hunger compels the vampire to hurt and destroy - not to feed or to win, but for the sole sake of causing harm. Any action not immediately resulting in someone or something getting harmed takes a two-dice penalty. Ends when the vampire incapacitates, destroys, or drives away a target.',
  Paranoia: 'The vampire tries to disengage from any perceived threat, suspecting anyone and anything. Any action not taken toward that end takes a two-dice penalty. Ends after roughly an hour spent in a safe, secure spot.',
  Rebellion: 'The vampire takes a stand against whatever or whomever they see as the status quo in the situation, whether that\'s their leader, a viewpoint expressed by a potential vessel, or just the task they were supposed to do at the moment. Until they\'ve gone against their orders or expectations, perceived or real, the vampire receives a two-dice penalty to all rolls. This Compulsion ends once they\'ve managed to either make someone change their minds (by force if necessary) or done the opposite of what was expected of them.',
  'Feral Impulses': 'Returning to an animalistic state, the vampire regresses to a point where speech is hard, clothes are uncomfortable, and arguments are best settled with teeth and claws. For one scene, the vampire gains a three-dice penalty to all rolls involving Manipulation and Intelligence. They can only speak in one-word sentences during this time.',
  Delusion: 'Their extrasensory gifts running wild, the vampire experiences what might be truths or portents, but what others call figments of imagination, dredged up by Hunger. While still functional, the vampire\'s mind and perceptions are skewed. They receive a two-dice penalty to rolls involving Dexterity, Manipulation, Composure, and Wits as well as on rolls to resist terror frenzy, for one scene.',
  Cryptophilia: 'The need to know permeates the vampire. They become consumed with a hunger for secrets, to know that which few or no one knows, almost as strong as that for blood. They also refuse to share secrets with others, except in strict trade for greater ones. All actions not spent working toward learning a secret, no matter how big or small, receive a two-dice penalty. The Compulsion ends when the vampire learns a secret big enough to be considered useful. Sharing this secret is optional.',
  Obsession: 'Enraptured by beauty, the vampire becomes temporarily obsessed with a singular gorgeous thing, able to think of nothing else. Pick one feature, such as a person, a song, an artwork, blood spatter, or even a sunrise. Enraptured, the vampire can hardly take their attention from it, and if spoken to, they only talk about that subject. Any other actions receive a two-dice penalty. This Compulsion lasts until they can no longer perceive the beloved object, or the scene ends.',
  Perfectionism: 'Nothing but the best satisfies the vampire. Anything less than exceptional performance instills a profound sense of failure, and they often repeat tasks obsessively to get them "just right." Until the vampire scores a critical win on a Skill roll or the scene ends, the vampire labors under a two-dice penalty to all dice pools. Reduce the penalty to one die for a repeated action, and remove it entirely on a second repeat.',
  Arrogance: 'The need to rule rears its head in the vampire. They stop at nothing to assume command of a situation. Someone must obey an order from the vampire. Any action not directly associated with leadership receives a two-dice penalty. This Compulsion lasts until an order has been obeyed, though the order must not be supernaturally enforced, such as through Dominate.',
  Judgment: 'Compelled to punish anyone (friend or foe) who transgresses against a personal Conviction, by taking their Blood as vengeance. For one scene, must slake at least 1 Hunger from that person. Failing this carries a three-dice penalty to all rolls until satisfied or the scene ends. Feeding on a vampire this way still triggers the Blood Addiction Bane\'s hunger-frenzy test.',
  Morbidity: 'Immediate need to move something from life to death or vice versa - can be a person, object, idea, or conversation. Any action not dedicated to this takes a two-dice penalty. Persists until the vampire kills or revives something, literally or figuratively.',
  Ruthlessness: 'After failing any action, the vampire is driven to any means necessary to succeed. Two-dice penalty to ALL rolls until a future attempt at the same action succeeds, or the scene ends - the penalty applies to the retry too.',
  Transgression: 'Two-dice penalty to all pools not related to enticing someone (including themselves) to break a Chronicle Tenet or personal Conviction. Causes at least one Stain when achieved, which ends the Compulsion.',
  'Tempting Fate': 'Next time facing a problem, any solution short of the most daring/dangerous gets a two-dice penalty (flashy/risky attempts can get bonus dice instead, Storyteller\'s call). Persists until the problem is solved or further attempts are impossible.',
  'Affective Empathy': 'Overwhelmed with empathy for someone\'s personal problem in the scene; two-dice penalty to any action not taken toward mitigating that problem. Persists until the burden is eased, a bigger crisis supersedes it, or the scene ends.',
  Covetousness: 'Obsessed with possessing something in the scene - object, property, or person. Two-dice penalty to actions not taken toward acquiring it. Persists until ownership is established (Storyteller\'s call for non-objects) or the object becomes unattainable.'
}

// Official V5 Bane titles per clan, transcribed from the "Clan Sheet"
// quick-reference spreads in the Player's Guide (pp. 11-13: each clan's
// BANE/COMPULSION line), same short-title convention as Compulsion names
// above. Each clan has exactly one canonical Bane, so unlike Compulsion
// this isn't a picker - it's just looked up from the actor's clan.
const CLAN_BANE_NAMES = {
  caitiff: 'No Common Bane',
  brujah: 'Violent Temper',
  gangrel: 'Bestial Features',
  malkavian: 'Fractured Perspective',
  nosferatu: 'Repulsiveness',
  toreador: 'Aesthetic Fixation',
  tremere: 'Deficient Blood',
  ventrue: 'Rarefied Tastes',
  'banu haqim': 'Blood Addiction',
  hecata: 'Painful Kiss',
  lasombra: 'Distorted Image',
  ministry: 'Abhors the Light',
  ravnos: 'Doomed',
  salubri: 'Hunted',
  tzimisce: 'Grounded'
}

// Full Bane text, keyed the same way as CLAN_BANE_NAMES above. Bane is
// 1:1 with Clan (every vampire of a given clan has the exact same Bane -
// there's no picker, no per-character variation), so this is looked up
// directly from the actor's Clan name rather than read off the Clan
// Item's own `system.bane` field. That field turned out to be unreliable
// on some third-party compendium Items (e.g. the corebook clans shipped
// by vampire-the-masquerade-5e-compendium never populated it, so the
// hover tooltip stayed empty for those clans no matter what the Item
// itself said) - looking it up the same way Compulsion text already is
// (COMPULSION_TEXT_BY_NAME above) sidesteps that entirely and auto-
// updates the instant a different Clan item is dropped onto the sheet,
// with no dependency on any particular compendium's data quality.
// Verbatim from "Vampire the Masquerade.pdf" (corebook) and the V5
// Player's Guide via pdftotext -raw - same transcriptions already used in
// configure-corebook-clan-banes-compendium.js and
// configure-new-clans-compendium.js.
const CLAN_BANE_TEXT = {
  caitiff: 'Untouched by the Antediluvians, the Caitiff share no common bane. Caitiff characters begin with the Suspect (•) Flaw and you may not purchase positive Status for them.',
  brujah: 'The Blood of the Brujah simmers with barely contained rage, exploding at the slightest provocation. Subtract dice equal to the Bane Severity of the Brujah from any roll to resist fury frenzy. This cannot take the pool below one die.',
  gangrel: 'Gangrel relate to their Beast much as other Kindred relate to the Gangrel: suspicious partnership. In frenzy, Gangrel gain one or more animal features: a physical trait, a smell, or a behavioral tic. These features last for one more night afterward, lingering like a hangover following debauchery. Each feature reduces one Attribute by 1 point - the Storyteller may decide that a forked tongue or bearlike musk reduces Charisma, while batlike ears reduce Resolve ("all those distracting sounds"). If nothing immediately occurs to you, the feature reduces Intelligence or Manipulation. The number of features a Gangrel manifests equals their Bane Severity. If your character Rides the Wave of their frenzy (see p.219) you can choose only one feature to manifest, thus taking only one penalty to their Attributes.',
  malkavian: 'Afflicted by their lineage, all Malkavians are cursed with at least one type of mental derangement. Depending on their history and the state of their mind at death, they may experience delusions, visions of terrible clarity, or something entirely different. When the Malkavian suffers a Bestial Failure or a Compulsion, their curse comes to the fore: suffer a penalty equal to your character\'s Bane Severity to one category of dice pools (Physical, Social, or Mental) for the entire scene, in addition to any penalties incurred by the Compulsion itself. You and the Storyteller decide the type of penalty and the exact nature of the character\'s affliction during character creation.',
  nosferatu: 'Hideous and vile, all Nosferatu count as having the Repulsive Flaw (-2) and can never increase their rating in the Looks Merit. In addition, any attempt to disguise themselves as human incurs a penalty to your dice pool equal to your character\'s Bane Severity (this includes the Obfuscate powers Mask of a Thousand Faces and Impostor\'s Guise).',
  toreador: 'Toreador exemplify the old saying that art in the blood takes strange forms. They desire beauty so intensely that they suffer in its absence. While your character finds itself in less than beautiful surroundings, lose the equivalent of their Bane Severity in dice from dice pools to use Disciplines. The Storyteller decides specifically how the beauty or ugliness of the Toreador\'s environment (including clothing, blood dolls, etc.) penalizes them, based on the character\'s aesthetics. That said, even devotees of the Ashcan School never find normal streets perfectly beautiful. This obsession with aesthetics also causes divas to lose themselves in moments of beauty, and a bestial failure often results in a rapt trance, as detailed in the Compulsion rules (p.208).',
  tremere: 'Once the clan was defined by a rigid hierarchy of Blood Bonds reaching from the top to the bottom of the Pyramid. But after the fall of Vienna, their Blood has recoiled and aborted all such connections. Tremere vitae can no longer Blood Bond other Kindred, though they themselves can be Bound by Kindred from other clans. A Tremere can still bind mortals and ghouls, though the corrupted vitae must be drunk an additional number of times equal to the vampire\'s Bane Severity for the bond to form.',
  ventrue: 'The Ventrue are in possession of rarefied palates. When a Ventrue drinks blood from any mortal outside their preference, a profound exertion of will is required or the blood taken surges back up as scarlet vomit. Preferences range greatly, from Ventrue who can only feed from genuine brunettes, individuals of Swiss descent, or homosexuals, to others who can only feed from soldiers, mortals who suffer from PTSD, or methamphetamine users. With a Resolve + Awareness test (Difficulty 4 or more) your character can sense if a mortal possesses the blood they require. If you want your character to feed from anything but their preferred victim, you must spend Willpower points equal to the character\'s Bane Severity.',
  'banu haqim': 'Drawn to feed from those deserving punishment, especially vampire Blood. Slaking at least 1 Hunger with vampiric vitae provokes a hunger frenzy test (Difficulty 2 + Bane Severity). On a fail, they attempt to gorge on the vampire\'s Blood, sometimes to the point of diablerie.',
  hecata: 'The Kiss is agonizing, not blissful. Direct drinking can only be a harmful drink (blood loss rules). Unrestrained unwilling victims try to escape. Coerced/willing mortal victims must pass Stamina + Resolve vs. Difficulty 2 + Bane Severity to avoid straining/resisting. Coerced/willing vampire victims of the bite must pass a Frenzy test (Difficulty 3) or fall into terror Frenzy.',
  lasombra: 'Anyone seeing a Lasombra\'s reflection or a recording (live or otherwise) recognizes them as a vampire, if they know what to look for; unaware onlookers just sense "something is wrong." Doesn\'t hide their identity from surveillance otherwise. Using modern comms tech (including a simple phone call) requires a Technology test (Difficulty 2 + Bane Severity) - microphones glitch like cameras. Avoiding electronic vampire-detection systems is done at a penalty = Bane Severity.',
  ministry: 'Direct bright light (natural or artificial) inflicts a dice-pool penalty = Bane Severity. Add Bane Severity to Aggravated damage taken from sunlight.',
  ravnos: 'If a Ravnos sleeps in the same place more than once in 7 nights, roll dice = Bane Severity; take Aggravated damage = the number of 10s (crits) rolled, erupting from within. Applies to torpor too. Two resting spots must be at least 1 mile apart to count as different locations. Ravnos cannot take the No Haven Flaw at character creation.',
  salubri: 'Non-Salubri vampires drinking Salubri vitae find it very hard to stop. To abate at least 1 Hunger requires a hunger frenzy test (Difficulty 2 + Bane Severity, or Difficulty 3 + Bane Severity if the drinker is Banu Haqim). Failure = they keep drinking, possibly requiring being physically fought off. Every Salubri also has a visible third eye that weeps vitae when a Discipline power is activated, intensity scaling with the power\'s level - the blood flow triggers a hunger frenzy test for nearby vampires with Hunger 4+.',
  tzimisce: 'Each Tzimisce chooses a specific charge (a physical domain, group, organization, or something more esoteric - clearly defined and limited). Must spend daysleep surrounded by that charge, or take Aggravated Willpower damage = Bane Severity upon waking.'
}

// Clan hover-tooltip text: Sobriquet + in-clan Disciplines + one line of
// flavor, keyed the same way as CLAN_BANE_TEXT/CLAN_BANE_NAMES above.
// Looked up by name rather than read off the Clan Item's own
// `system.description` field for the same reason as Bane - the field on
// the actual Items (particularly the third-party community compendium's
// corebook clans) turned out to hold boilerplate/placeholder content
// rather than real per-clan text, so the tooltip showed the same generic
// filler no matter which clan was selected. This is intentionally short
// (a quick-reference tooltip, not the full compendium entry) - Bane
// detail already has its own separate tooltip, so it isn't repeated
// here. Verbatim/paraphrased-minimally from "Vampire the Masquerade.pdf"
// (corebook) and the V5 Player's Guide via pdftotext -raw.
const CLAN_DESCRIPTION_TEXT = {
  caitiff: 'Sobriquet: The Clanless, Orphans, Panders. No fixed in-clan Disciplines - any three of choice at the Embrace. Not all Kindred inherit the curse of one of the named clans; the Caitiff make up for what they lose in respect and pedigree with flexible Blood and the absence of a crippling bane.',
  brujah: 'Sobriquet: Rabble, Iconoclasts, Zealots. In-Clan Disciplines: Celerity, Potence, Presence. Fiery idealists and agitators who have always strived for progress in Kindred society, whether that means tearing down the establishment or defending it to the last.',
  gangrel: 'Sobriquet: Outcasts, Wolves, The Clan of the Beast. In-Clan Disciplines: Animalism, Fortitude, Protean. Outcasts, wanderers, rogues, and hunters who make havens in the poorest parts of the city and feel no shame for doing so, claiming few domains as their own but deferring to no prince.',
  malkavian: 'Sobriquet: Lunatics, The Mad, Children of Malkav. In-Clan Disciplines: Auspex, Dominate, Obfuscate. Their extrasensory gifts run wild alongside a cursed mental derangement - seeing too much of the world at once, understanding too deeply, feeling too strongly to bear.',
  nosferatu: 'Sobriquet: Sewer Rats, The Clan of the Hidden, Horrors. In-Clan Disciplines: Animalism, Obfuscate, Potence. The Embrace deforms them into grotesque abominations over weeks of pain - wearing their curse on the outside rather than the inside, they consider themselves, only half-jokingly, the most humane of the Kindred.',
  toreador: 'Sobriquet: Divas, The Clan of the Rose, Artists. In-Clan Disciplines: Auspex, Celerity, Presence. Obsessed with aesthetic perfection in all its forms, beautiful and terrible alike - beauty is power, and love can make even the dead feel something real.',
  tremere: 'Sobriquet: Warlocks, Usurpers, The Broken Clan. In-Clan Disciplines: Auspex, Dominate, Blood Sorcery. Former Hermetic magicians who sought the elixir of life and found the curse of Caine instead - now they cast their thaumaturgic magic with fresh blood in place of ritual.',
  ventrue: 'Sobriquet: Blue Bloods, Clan of Kings, Patricians. In-Clan Disciplines: Dominate, Fortitude, Presence. Obsessed with the impulse to rule, the Ventrue have long held more positions of power within the Camarilla than any other clan, and are loath to give that up.',
  'banu haqim': 'Sobriquet: The Judges, Children of Haqim, Mediators. In-Clan Disciplines: Blood Sorcery, Celerity, Obfuscate. Outsiders stereotype the Banu Haqim as driven, somber, and severe; clan culture rewards those who are goal-oriented, prizing deeds over lineage or tradition for its own sake.',
  hecata: 'Sobriquet: The Necromancers, Devil-Kindred, Clan of Death. In-Clan Disciplines: Auspex, Fortitude, Oblivion. An umbrella clan of death-focused bloodlines who have carved out a place in innumerable domains while remaining an unwelcome presence - one can always count on a Hecata for an unvarnished opinion, if not an honest one.',
  lasombra: 'Sobriquet: Clan of Night, Magisters, Keepers of Shadow. In-Clan Disciplines: Dominate, Oblivion, Potence. Few clans are as ruthlessly efficient as the Lasombra when it comes to achieving goals - crushing rivals or consolidating influence, they take no half-measures.',
  ministry: 'Sobriquet: Serpents, Clan of Faith, Setites. In-Clan Disciplines: Obfuscate, Presence, Protean. Viewing the world as a marketplace, Ministry Kindred want to be everybody\'s confidante, striving to offer everything their fellows can and more.',
  ravnos: 'Sobriquet: Rogues, Ravens, The Haunted. In-Clan Disciplines: Animalism, Obfuscate, Presence. Wilder-blooded wanderers found almost everywhere and thriving in any environment, though the more conservative Kindred social structures often regard them as weeds to be plucked from carefully curated gardens.',
  salubri: 'Sobriquet: Cyclops, Soul-Thieves, Saulot\'s Progeny. In-Clan Disciplines: Auspex, Dominate, Fortitude. A clan hunted by the pillars of Kindred society - their reputation is unjust, and in nearly every case a Salubri needs a coterie for protection in the nights following their Embrace.',
  tzimisce: 'Sobriquet: Dragons, The Old Clan, Voivodes. In-Clan Disciplines: Animalism, Dominate, Protean. An intimidating force for any social group, in no small part due to their demeanor - a Tzimisce regards a coterie, or six city blocks, or an entire estate, as simply theirs.'
}

export class CharacterSheetVampireActorSheet extends VampireActorSheet {
  // wod5e's base sheet defaults to a cramped 1000x800 window (WoDActorBase.
  // DEFAULT_OPTIONS) - the reference screenshots were clearly captured from
  // a much wider window (~1500px+), which is a big part of why every dot
  // row/label read as "clunky" at the default size: the same space-between
  // spacing that looks airy at 1500px looks stretched/cramped at 1000px.
  // Foundry deep-merges static DEFAULT_OPTIONS up the prototype chain, so
  // only the changed keys need to be declared here.
  static DEFAULT_OPTIONS = {
    position: { width: 1400, height: 900 },
    actions: {
      toggleExpandRow: onToggleExpandRow,
      addExperience: onSpendOrAddExperience
    }
  }

  static PARTS = (() => {
    // Settings is dropped entirely per Jake's call - not just hidden from
    // nav, never rendered at all. Blood stays rendered (just unreachable
    // via nav) purely as a safety net - its remaining unique fields
    // (Sire/Generation/Predator Type/detail grid) have now been migrated
    // into Concept & Lore below, so nothing currently depends on it, but
    // there's no reason to force a render error if something still does.
    const { settings, ...parts } = VampireActorSheet.PARTS

    return {
      ...parts,
      header: {
        template: `modules/${MODULE_ID}/templates/vampire-sheet-header.hbs`
      },
      tabs: {
        template: `modules/${MODULE_ID}/templates/tab-navigation.hbs`
      },
      stats: {
        template: `modules/${MODULE_ID}/templates/attributes-skills.hbs`
      },
      disciplines: {
        template: `modules/${MODULE_ID}/templates/disciplines.hbs`
      },
      features: {
        template: `modules/${MODULE_ID}/templates/merits-flaws.hbs`
      },
      biography: {
        template: `modules/${MODULE_ID}/templates/concept-lore.hbs`
      },
      equipment: {
        template: `modules/${MODULE_ID}/templates/equipment.hbs`
      },
      experience: {
        template: `modules/${MODULE_ID}/templates/experience.hbs`
      }
    }
  })()

  tabs = {
    stats: {
      id: 'stats',
      group: 'primary',
      title: 'Attributes & Skills',
      icon: '<i class="fa-regular fa-chart-line"></i>'
    },
    disciplines: {
      id: 'disciplines',
      group: 'primary',
      title: 'Disciplines',
      icon: '<span class="wod5e-symbol">b</span>'
    },
    features: {
      id: 'features',
      group: 'primary',
      title: 'Merits & Flaws',
      icon: '<i class="fas fa-gem"></i>'
    },
    biography: {
      id: 'biography',
      group: 'primary',
      title: 'Concept & Lore',
      icon: '<i class="fas fa-id-card"></i>'
    },
    equipment: {
      id: 'equipment',
      group: 'primary',
      title: 'Equipment',
      icon: '<i class="fa-solid fa-toolbox"></i>'
    },
    experience: {
      id: 'experience',
      group: 'primary',
      title: 'Experience',
      icon: '<i class="fa-solid fa-file-contract"></i>'
    },
    notepad: {
      id: 'notepad',
      group: 'primary',
      title: 'Notes',
      icon: '<i class="fas fa-sticky-note"></i>'
    },
    blood: {
      id: 'blood',
      group: 'primary',
      title: 'WOD5E.VTM.Blood',
      icon: '<i class="fa-solid fa-droplet"></i>',
      hidden: true
    }
  }

  async _preparePartContext (partId, context, options) {
    context = { ...(await super._preparePartContext(partId, context, options)) }

    switch (partId) {
      case 'header':
        return this.prepareHeaderContext(context, this.actor)
      case 'stats':
        return decorateStatsTooltips(context)
      case 'disciplines':
        return prepareDisciplinesFlatContext(context)
      case 'features':
        return prepareMeritsFlawsContext(context)
      case 'biography':
        return this.prepareConceptLoreContext(context, this.actor)
      case 'equipment':
        return prepareCurrencyContext(context, this.actor)
    }

    return context
  }

  async prepareHeaderContext (context, actor) {
    const actorData = actor.system

    const resonanceFilter = actor.items.filter((item) => item.type === 'resonance')
    const predatorFilter = actor.items.filter((item) => item.type === 'predatorType')

    context.blood = actorData.blood
    context.resonance = resonanceFilter[0]
    context.resonanceDescription = context.resonance?.system?.description || ''
    context.predator = predatorFilter[0]
    context.baneName = this.getBaneName(context.clan)
    context.bane = this.getBaneText(context.clan)
    context.clanDescription = this.getClanDescription(context.clan)
    context.predatorDescription = context.predator?.system?.description || ''
    context.compulsion = actor.getFlag(MODULE_ID, 'compulsion') || ''
    context.compulsionOptions = this.getCompulsionOptions(context.clan)
    context.compulsionText = COMPULSION_TEXT_BY_NAME[context.compulsion] || ''

    return context
  }

  getCompulsionOptions (clan) {
    const clanName = clan?.name
    const clanCompulsion = clanName ? CLAN_COMPULSION_NAMES[clanName.toLowerCase()] : null
    return [...GENERIC_COMPULSION_NAMES, ...(clanCompulsion ? [clanCompulsion] : [])]
  }

  // Bane has exactly one canonical name per clan (unlike Compulsion, which
  // offers a choice) - looked up rather than stored as a flag, so it can
  // never drift out of sync with the actor's actual clan.
  getBaneName (clan) {
    const clanName = clan?.name
    return (clanName ? CLAN_BANE_NAMES[clanName.toLowerCase()] : null) || ''
  }

  getBaneText (clan) {
    const clanName = clan?.name
    const text = clanName ? CLAN_BANE_TEXT[clanName.toLowerCase()] : null
    return text ? `<p>${text}</p>` : ''
  }

  getClanDescription (clan) {
    const clanName = clan?.name
    const text = clanName ? CLAN_DESCRIPTION_TEXT[clanName.toLowerCase()] : null
    return text ? `<p>${text}</p>` : ''
  }

  // wod5e's own prepareDisciplinesContext (run by super._preparePartContext
  // above) already builds context.disciplines with each discipline's owned
  // powers grouped/sorted and every item's system.enrichedDescription
  async prepareConceptLoreContext (context, actor) {
    const actorHeaders = actor.system.headers

    context.concept = actorHeaders.concept
    context.chronicle = actorHeaders.chronicle
    context.ambition = actorHeaders.ambition
    context.desire = actorHeaders.desire
    context.tenets = actorHeaders.tenets
    context.enrichedTenets = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      actorHeaders.tenets
    )
    context.touchstones = actorHeaders.touchstones
    context.enrichedTouchstones = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      actorHeaders.touchstones
    )
    context.sire = actorHeaders.sire
    context.generation = actorHeaders.generation

    return context
  }
}
