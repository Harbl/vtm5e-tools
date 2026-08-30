// Extends wod5e's real GhoulActorSheet (same "layer on top, don't replace"
// approach as vampire-actor-sheet.js). Ghoul's own PARTS/tabs are already
// near-identical to Vampire's (Stats/Experience/Disciplines/Features/
// Equipment/Biography/Notepad/Settings vs. Vampire's same set plus Blood-
// specific fields) - GhoulActorSheet.DEFAULT_OPTIONS even ships the
// 'vampire' CSS class already, so vtm5e-charactersheet.css's existing
// .actor.sheet.vampire rules apply here with zero changes.
import { GhoulActorSheet } from '/systems/wod5e/system/actor/vtm/ghoul-actor-sheet.js'
import {
  prepareDisciplinesFlatContext,
  prepareMeritsFlawsContext,
  prepareCurrencyContext,
  decorateStatsTooltips,
  onToggleExpandRow,
  onSpendOrAddExperience
} from './shared-context.js'

const MODULE_ID = 'vtm5e-charactersheet'

export class CharacterSheetGhoulActorSheet extends GhoulActorSheet {
  static DEFAULT_OPTIONS = {
    // wod5e's own GhoulActorSheet only tags itself 'vampire' (no separate
    // 'ghoul' class) - it never needed to distinguish itself from a true
    // Vampire sheet visually. Adding 'ghoul' here gives the CSS something to
    // hook the type-banner's distinct color to (see .actor.sheet.vampire.ghoul
    // .sheet-banner in vtm5e-charactersheet.css).
    classes: ['wod5e', 'actor', 'sheet', 'vampire', 'ghoul'],
    position: { width: 1400, height: 900 },
    actions: {
      toggleExpandRow: onToggleExpandRow,
      addExperience: onSpendOrAddExperience
    }
  }

  static PARTS = (() => {
    // Settings dropped entirely, matching the Vampire sheet's call.
    const { settings, ...parts } = GhoulActorSheet.PARTS

    return {
      ...parts,
      header: {
        template: `modules/${MODULE_ID}/templates/ghoul-sheet-header.hbs`
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

  prepareHeaderContext (context, actor) {
    context.domitor = actor.system.headers.domitor

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
