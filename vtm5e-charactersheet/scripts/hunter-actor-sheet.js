// Extends wod5e's real HunterActorSheet (same "layer on top, don't replace"
// approach as the other splats). Hunter is structurally its own thing -
// Edges/Despair/Drive/Creed instead of Disciplines/Hunger/Clan/Predator - so
// unlike Ghoul/Mortal this needed real new templates (header, Edges flat
// list, Concept & Lore variant with Redemption/Creed Fields), not pure reuse.
// Merits & Flaws/Equipment/Experience/Attributes & Skills still reuse the
// exact same templates as every other sheet - wod5e's underlying context
// shape for those tabs isn't gamesystem-specific.
import { HunterActorSheet } from '/systems/wod5e/system/actor/htr/hunter-actor-sheet.js'
import {
  prepareMeritsFlawsContext,
  prepareCurrencyContext,
  decorateStatsTooltips,
  onToggleExpandRow
} from './shared-context.js'

const MODULE_ID = 'vtm5e-charactersheet'

export class CharacterSheetHunterActorSheet extends HunterActorSheet {
  static DEFAULT_OPTIONS = {
    // wod5e already tags Hunter's own class 'hunter' (not 'vampire') - added
    // here explicitly anyway since this class's classes array replaces
    // rather than merges with the inherited one, same reasoning as Mortal.
    classes: ['wod5e', 'actor', 'sheet', 'hunter', 'vampire'],
    position: { width: 1400, height: 900 },
    actions: {
      toggleExpandRow: onToggleExpandRow
    }
  }

  static PARTS = (() => {
    const { settings, ...parts } = HunterActorSheet.PARTS

    return {
      ...parts,
      header: {
        template: `modules/${MODULE_ID}/templates/hunter-sheet-header.hbs`
      },
      tabs: {
        template: `modules/${MODULE_ID}/templates/tab-navigation.hbs`
      },
      stats: {
        template: `modules/${MODULE_ID}/templates/attributes-skills.hbs`
      },
      edges: {
        template: `modules/${MODULE_ID}/templates/edges.hbs`
      },
      features: {
        template: `modules/${MODULE_ID}/templates/merits-flaws.hbs`
      },
      biography: {
        template: `modules/${MODULE_ID}/templates/hunter-concept-lore.hbs`
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
    edges: {
      id: 'edges',
      group: 'primary',
      title: 'Edges',
      icon: '<span class="wod5e-symbol hunter">e</span>'
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
    const actorData = actor.system

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

    // Redemption/Creed Fields are read-only lookups off whichever Drive/Creed
    // item is currently equipped - wod5e's own _prepareContext (run by
    // super._preparePartContext above) already resolves those onto
    // context.drive/context.creed for the header, so no need to re-filter
    // actor.items here.
    context.redemption = context.drive?.system?.redemption || ''
    context.creedFields = context.creed?.system?.desperationFields || ''

    return context
  }
}
