// Extends wod5e's real MortalActorSheet (same "layer on top, don't replace"
// approach as vampire-actor-sheet.js/ghoul-actor-sheet.js). Mortal's own
// DEFAULT_OPTIONS tags itself with a 'mortal' CSS class only, not 'vampire' -
// unlike Ghoul, which wod5e itself already tags 'vampire' for shared theming.
// Added here explicitly so vtm5e-charactersheet.css's existing
// .actor.sheet.vampire rules (the whole dark-gothic reskin) apply to Mortal
// too - that class only affects CSS scoping on the sheet's own element, not
// any of wod5e's actual vampire-splat game logic (Hunger/Blood/Disciplines),
// which is all gated by actor type/data model elsewhere, not by this class.
import { MortalActorSheet } from '/systems/wod5e/system/actor/mortal-actor-sheet.js'
import {
  prepareMeritsFlawsContext,
  prepareCurrencyContext,
  decorateStatsTooltips,
  onToggleExpandRow
} from './shared-context.js'

const MODULE_ID = 'vtm5e-charactersheet'

export class CharacterSheetMortalActorSheet extends MortalActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ['wod5e', 'actor', 'sheet', 'mortal', 'vampire'],
    position: { width: 1400, height: 900 },
    actions: {
      toggleExpandRow: onToggleExpandRow
    }
  }

  static PARTS = (() => {
    // Settings dropped entirely, matching the Vampire/Ghoul sheets.
    const { settings, ...parts } = MortalActorSheet.PARTS

    return {
      ...parts,
      header: {
        template: `modules/${MODULE_ID}/templates/mortal-sheet-header.hbs`
      },
      tabs: {
        template: `modules/${MODULE_ID}/templates/tab-navigation.hbs`
      },
      stats: {
        template: `modules/${MODULE_ID}/templates/attributes-skills.hbs`
      },
      features: {
        template: `modules/${MODULE_ID}/templates/merits-flaws.hbs`
      },
      biography: {
        template: `modules/${MODULE_ID}/templates/concept-lore-simple.hbs`
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
    }
  }

  async _preparePartContext (partId, context, options) {
    context = { ...(await super._preparePartContext(partId, context, options)) }

    switch (partId) {
      case 'stats':
        return decorateStatsTooltips(context)
      case 'features':
        return prepareMeritsFlawsContext(context)
      case 'biography':
        return this.prepareConceptLoreContext(context, this.actor)
      case 'equipment':
        return prepareCurrencyContext(context, this.actor)
    }

    return context
  }

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

    return context
  }
}
