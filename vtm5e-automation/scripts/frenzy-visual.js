/**
 * Frenzy token icon - purely visual. system.frenzyActive (wod5e's own VtM
 * boolean, set by frenzy-roll.js/end-frenzy.js and this project's own
 * forced-frenzy writes in discipline-resistance.js) is already fully wired
 * mechanically - this just mirrors it onto a token status icon via the
 * Conditions system's token-icon layer (condition-application.js), giving
 * Jake's original ask (visible on the token, hover/right-click-remove) for
 * free. No new mechanical effect - Frenzy's real consequences are handled
 * elsewhere already.
 */
import { applyStatusCondition, removeStatusCondition, hasReconcileAuthority } from './condition-application.js'

const FRENZY_CONDITION_NAME = 'Frenzy'

async function syncFrenzyVisual(actor) {
  if (actor.system.frenzyActive) {
    await applyStatusCondition(actor, {
      name: FRENZY_CONDITION_NAME,
      img: 'icons/creatures/abilities/mouth-teeth-sharp-red.webp',
      note: '<p><em>Auto-managed by vtm5e-automation - purely visual, mirrors system.frenzyActive (wod5e\'s own Frenzy mechanic, already fully handled by the sheet\'s Frenzy/End Frenzy buttons). No dice effect of its own - right-click the token icon to clear it manually if it ever drifts out of sync.</em></p>'
    })
  } else {
    await removeStatusCondition(actor, FRENZY_CONDITION_NAME)
  }
}

export function registerFrenzyVisual() {
  Hooks.on('updateActor', async (actor, changes) => {
    if (actor.system?.gamesystem !== 'vampire' || !hasReconcileAuthority(actor)) return
    if (!foundry.utils.hasProperty(changes, 'system.frenzyActive')) return
    await syncFrenzyVisual(actor)
  })

  // Catches actors already mid-Frenzy when this ships on an existing
  // campaign - without this, the icon wouldn't appear until the next
  // Frenzy roll/end, not the current state.
  Hooks.once('ready', async () => {
    if (!game.user.isGM) return
    for (const actor of game.actors) {
      if (actor.system?.gamesystem === 'vampire' && actor.system?.frenzyActive) await syncFrenzyVisual(actor)
    }
  })
}
