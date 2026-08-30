// Extends wod5e's real WerewolfActorSheet. Werewolf is the most mechanically
// dense splat here - Forms/Frenzy/Harano-Hauglosk balance is a genuinely
// complex, self-contained widget wod5e already handles well, and Jake never
// asked for that redesigned, so the 'wolf' PART is deliberately left
// completely untouched (same "leave it stock" call already made for
// Notepad/Settings/Banner/Limited on every other sheet) - it still picks up
// this module's generic input/resource-value/button theming for free via
// the broad .actor.sheet.vampire cascade, just not a bespoke layout.
// Gifts get the same flat-list treatment Disciplines/Edges already got;
// Merits & Flaws/Concept & Lore follow the same split-tab pattern as every
// other splat.
import { WerewolfActorSheet } from '/systems/wod5e/system/actor/wta/werewolf-actor-sheet.js'
import {
  prepareMeritsFlawsContext,
  prepareCurrencyContext,
  decorateStatsTooltips,
  onToggleExpandRow
} from './shared-context.js'

const MODULE_ID = 'vtm5e-charactersheet'

export class CharacterSheetWerewolfActorSheet extends WerewolfActorSheet {
  static DEFAULT_OPTIONS = {
    // All of this module's reskin CSS is scoped under .actor.sheet.vampire
    // (added there first, before any non-vampire-family sheet existed) -
    // 'vampire' has to be added explicitly here too, same as Mortal/Hunter,
    // or none of it applies. wod5e's own 'werewolf' class is kept alongside
    // it so the werewolf-specific stock CSS (rage-button colors, etc.) and
    // this module's own .sheet-banner color rule both still match.
    classes: ['wod5e', 'actor', 'sheet', 'werewolf', 'vampire'],
    position: { width: 1400, height: 900 },
    actions: {
      toggleExpandRow: onToggleExpandRow
    }
  }

  static PARTS = (() => {
    const { settings, ...parts } = WerewolfActorSheet.PARTS

    return {
      ...parts,
      header: {
        template: `modules/${MODULE_ID}/templates/werewolf-sheet-header.hbs`
      },
      tabs: {
        template: `modules/${MODULE_ID}/templates/tab-navigation.hbs`
      },
      stats: {
        template: `modules/${MODULE_ID}/templates/attributes-skills.hbs`
      },
      gifts: {
        template: `modules/${MODULE_ID}/templates/gifts-rites.hbs`
      },
      // 'wolf' intentionally omitted - falls through to wod5e's own stock
      // template via the ...parts spread above (see file header note).
      features: {
        template: `modules/${MODULE_ID}/templates/merits-flaws.hbs`
      },
      biography: {
        template: `modules/${MODULE_ID}/templates/werewolf-concept-lore.hbs`
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
    gifts: {
      id: 'gifts',
      group: 'primary',
      title: 'Gifts & Renown',
      icon: '<span class="wod5e-symbol">h</span>'
    },
    wolf: {
      id: 'wolf',
      group: 'primary',
      title: 'WOD5E.WTA.Wolf',
      icon: '<i class="fa-brands fa-wolf-pack-battalion"></i>'
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
    const tribe = context.tribe

    context.concept = actorHeaders.concept
    context.chronicle = actorHeaders.chronicle
    context.tenets = actorHeaders.tenets
    context.enrichedTenets = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      actorHeaders.tenets
    )
    context.touchstones = actorHeaders.touchstones
    context.enrichedTouchstones = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      actorHeaders.touchstones
    )

    // Patron Spirit/Favor/Ban are read-only, derived from whichever Tribe
    // item is equipped - same derivation as wod5e's own stock
    // prepareFeaturesContext (shared/prepare-partials.js), just run here
    // instead since this module splits Concept & Lore out from Merits &
    // Flaws into its own tab.
    context.patronSpirit = tribe?.system?.patronSpirit?.name || ''
    context.favor = tribe?.system?.patronSpirit?.favor || ''
    context.enrichedFavor = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      context.favor
    )
    context.ban = tribe?.system?.patronSpirit?.ban || ''
    context.enrichedBan = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      context.ban
    )

    return context
  }
}
