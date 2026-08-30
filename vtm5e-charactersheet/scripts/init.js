import { CharacterSheetVampireActorSheet } from './vampire-actor-sheet.js'
import { CharacterSheetGhoulActorSheet } from './ghoul-actor-sheet.js'
import { CharacterSheetMortalActorSheet } from './mortal-actor-sheet.js'
import { CharacterSheetHunterActorSheet } from './hunter-actor-sheet.js'
import { CharacterSheetWerewolfActorSheet } from './werewolf-actor-sheet.js'
import { onFeed } from './feed.js'

const MODULE_ID = 'vtm5e-charactersheet'

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing`)

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, 'wod5e', CharacterSheetVampireActorSheet, {
    types: ['vampire'],
    makeDefault: true,
    label: 'VtM5e Character Sheet Reskin'
  })

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, 'wod5e', CharacterSheetGhoulActorSheet, {
    types: ['ghoul'],
    makeDefault: true,
    label: 'VtM5e Character Sheet Reskin'
  })

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, 'wod5e', CharacterSheetMortalActorSheet, {
    types: ['mortal'],
    makeDefault: true,
    label: 'VtM5e Character Sheet Reskin'
  })

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, 'wod5e', CharacterSheetHunterActorSheet, {
    types: ['hunter'],
    makeDefault: true,
    label: 'VtM5e Character Sheet Reskin'
  })

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, 'wod5e', CharacterSheetWerewolfActorSheet, {
    types: ['werewolf'],
    makeDefault: true,
    label: 'VtM5e Character Sheet Reskin'
  })

  // renown.hbs is only ever pulled in via a {{> "modules/..."}} inline
  // partial include from gifts-rites.hbs, never used as a PARTS.template
  // value directly - Foundry only auto-registers PARTS templates as
  // partials, so anything included ONLY this way has to be preloaded by
  // hand or the include silently fails to resolve. Same reason wod5e's own
  // system preloads every one of its sub-partials in scripts/templates.js.
  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/renown.hbs`
  ])

  // Public API, same pattern vtm5e-automation uses to expose its own
  // functions (e.g. rollWeaponAttack, rollPower) to the Argon HUD companion
  // (enhancedcombathud-wod5e) - set at init time so it's guaranteed ready
  // before that module's argonInit-time panel registration needs it. Feed
  // lives here (not on the sheet) since Jake wants it reachable from the
  // Argon HUD instead of a sheet button.
  game.modules.get(MODULE_ID).api = { onFeed }
})
