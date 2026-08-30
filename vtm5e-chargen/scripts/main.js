import { openChargenWizard } from './chargen-app.js'
import { registerAutoProvisioning } from './auto-provision.js'

const MODULE_ID = 'vtm5e-chargen'

Hooks.once('init', () => {
  const mod = game.modules.get(MODULE_ID)
  mod.api = {
    openChargenWizard,
    // Convenience: open for the first controlled token's actor, or the
    // user's assigned character, if no actor is passed explicitly.
    openForSelectedOrAssigned () {
      const actor = canvas.tokens?.controlled?.[0]?.actor ?? game.user.character
      openChargenWizard(actor)
    }
  }
})

registerAutoProvisioning()
