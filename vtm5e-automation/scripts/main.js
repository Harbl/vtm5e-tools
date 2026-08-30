import { registerSettings } from './settings.js'
import { registerDamageApplication, applyDamageToTarget, applyWillpowerDamageToTarget } from './damage-application.js'
import { registerOpposedRollResolution } from './opposed-roll-resolution.js'
import { registerOpposingRollTrigger } from './opposing-roll-trigger.js'
import { registerDisciplineResistance } from './discipline-resistance.js'
import { registerImpairmentConditions } from './impairment-conditions.js'
import { registerWardTracking } from './ward-tracking.js'
import { registerWeaponTags, rollWeaponAttack, reloadWeapon, readyWeapon, unloadWeapon } from './weapon-tags.js'
import { registerSourceMessageCleanup, registerPendingDamageButtons } from './roll-utils.js'
import { canActorRouse } from './rouse-guard.js'
import { registerPrivilegedWriteRelay } from './privileged-write-relay.js'
import { registerRepairResolution } from './repair.js'
import { registerGenericBestialFailure } from './bestial-failure.js'
import { registerConditionStatusEffects, registerConditionSync } from './condition-application.js'
import { registerPowerEffects, rollPower } from './power-effects.js'
import { registerFrenzyVisual } from './frenzy-visual.js'
import { rollBasicPool } from './basic-rolls.js'

const MODULE_ID = 'vtm5e-automation'

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing`)

  registerSettings()
  registerDamageApplication()
  registerOpposedRollResolution()
  registerOpposingRollTrigger()
  registerDisciplineResistance()
  registerImpairmentConditions()
  registerWardTracking()
  registerWeaponTags()
  registerPrivilegedWriteRelay()
  registerRepairResolution()
  registerGenericBestialFailure()
  registerConditionStatusEffects()
  registerConditionSync()
  registerPowerEffects()
  registerFrenzyVisual()
  registerSourceMessageCleanup(MODULE_ID)
  registerPendingDamageButtons(MODULE_ID, {
    health: applyDamageToTarget,
    willpower: applyWillpowerDamageToTarget
  })

  // Public API for other modules (specifically enhancedcombathud-wod5e) to
  // trigger this module's own actions without reaching into internals -
  // the same discipline this module tries to hold wod5e to when calling
  // wod5e's own code. Set at init so it's guaranteed ready before any
  // other module's 'ready'-time setup (like Argon's HUD binding) needs it.
  game.modules.get(MODULE_ID).api = {
    canActorRouse,
    rollWeaponAttack,
    reloadWeapon,
    readyWeapon,
    unloadWeapon,
    rollPower,
    rollBasicPool
  }
})
