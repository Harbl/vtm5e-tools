import { openChargenWizard } from './chargen-app.js'

const MODULE_ID = 'vtm5e-chargen'

// A chargen-provisioned actor is tagged with the user it was made for at
// creation time, rather than relying on game.user.character (which a
// player may not have permission to self-assign) or on Foundry ownership
// dicts (which can also be true for actors nothing to do with this flow).
function actorForUser (user) {
  return game.actors.find(a => a.type === 'vampire' && a.getFlag(MODULE_ID, 'ownerUserId') === user.id)
}

// GM-side: a player needs the ACTOR_CREATE permission to make their own
// actor. Granting it here (rather than a standing world-permission change)
// keeps it scoped to exactly the window where it's needed - revoked again
// in revokeCreateIfDone once their wizard is done. Idempotent: only touches
// users who don't already have a provisioned actor and don't already have
// the permission some other way (e.g. Trusted Player role).
async function grantCreateIfNeeded (user) {
  if (user.isGM || actorForUser(user)) return
  if (user.hasPermission('ACTOR_CREATE')) return
  await user.update({ 'permissions.ACTOR_CREATE': true })
  console.log(`vtm5e-chargen | granted temporary Actor-create permission to ${user.name}`)
}

// GM-side: once that user's provisioned actor is flagged wizard-complete,
// drop the override back to their role default instead of leaving a
// standing "can create actors" grant on their account.
async function revokeCreateIfDone (user) {
  const actor = actorForUser(user)
  if (!actor?.getFlag(MODULE_ID, 'wizardCompleted')) return
  if (!('ACTOR_CREATE' in (user.permissions ?? {}))) return
  await user.update({ 'permissions.-=ACTOR_CREATE': null })
  console.log(`vtm5e-chargen | revoked temporary Actor-create permission from ${user.name}`)
}

// Player-side: the first time this user connects with no provisioned actor
// yet (and the GM has granted the temporary permission), create one, then
// offer to launch the wizard. A player who dismisses the prompt gets asked
// again next login - wizardCompleted is what actually stops it.
//
// The actor gets created (and flagged with ownerUserId) BEFORE the dialog
// choice is known, so actorForUser() finding one is not by itself proof the
// wizard was ever finished - that used to short-circuit this whole function
// on every later login once the actor existed, silently turning "Remind Me
// Later" into "never remind me again" (found by Jake asking what actually
// triggers that button - it didn't). Only wizardCompleted should stop the
// re-prompt; an existing-but-unfinished actor should still be re-offered.
async function provisionOwnActorIfNeeded () {
  if (game.user.isGM) return

  const existing = actorForUser(game.user)
  if (existing) {
    if (!existing.getFlag(MODULE_ID, 'wizardCompleted')) await offerChargenStart(existing)
    return
  }

  if (!game.user.hasPermission('ACTOR_CREATE')) return

  const actor = await Actor.create({
    name: `${game.user.name}'s Character`,
    type: 'vampire',
    flags: { [MODULE_ID]: { ownerUserId: game.user.id } }
  })

  // Best-effort - some world configs don't let a player self-assign the
  // "character" slot. Detection above never depends on this, so a failure
  // here is harmless and not worth bothering the player about.
  try {
    await game.user.update({ character: actor.id })
  } catch (err) {
    console.warn('vtm5e-chargen | could not self-assign character slot (non-fatal):', err)
  }

  await offerChargenStart(actor)
}

// Split out from provisionOwnActorIfNeeded so it can be deferred: on a
// genuinely fresh session, Foundry's own native UserConfig sheet (Player
// Name/Avatar/Color/Pronouns) can already be open by the time 'ready' fires,
// and our own welcome dialog was stacking visually on top of it - confirmed
// via screenshots, not assumed. Document#sheet returns the currently
// instantiated sheet app for a Document (creating one lazily if none exists
// yet, but NOT rendering it), so checking .rendered is a safe, version-
// stable way to detect "is that native dialog on screen right now" without
// caring whether it's an ApplicationV1 or V2 sheet under the hood.
async function offerChargenStart (actor) {
  const userConfigSheet = game.user.sheet
  if (userConfigSheet?.rendered) {
    Hooks.once('closeUserConfig', (app) => {
      // UserConfig is an ApplicationV2 DocumentSheetV2 in this Foundry
      // version - the associated Document lives at .document, not the old
      // ApplicationV1 FormApplication's .object (confirmed by reading the
      // actual installed core file, user-config.mjs - that mismatch is why
      // this never fired the first time).
      if (app.document?.id === game.user.id) offerChargenStart(actor)
    })
    return
  }

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: 'Welcome to the Chronicle' },
    content: '<p>A character sheet has been created for you. Ready to build your character?</p>',
    buttons: [
      { action: 'start', label: 'Start Character Creation', default: true },
      { action: 'later', label: 'Remind Me Later' }
    ]
  })

  if (choice === 'start') openChargenWizard(actor)
}

export function registerAutoProvisioning () {
  Hooks.on('ready', async () => {
    if (game.user.isGM) {
      for (const user of game.users) {
        await grantCreateIfNeeded(user)
        await revokeCreateIfDone(user)
      }
    } else {
      await provisionOwnActorIfNeeded()
    }
  })

  // A GM logging in after a player already connected this session grants
  // the permission here rather than waiting for their own next 'ready'.
  Hooks.on('userConnected', async (user, connected) => {
    if (!game.user.isGM || !connected) return
    await grantCreateIfNeeded(user)
  })

  // The reverse case: the permission gets granted while the player's client
  // is already sitting on 'ready' having found nothing to do yet - retry
  // provisioning the moment their own User document picks up the grant.
  Hooks.on('updateUser', (user, changes) => {
    if (game.user.isGM || user.id !== game.user.id) return
    if (!foundry.utils.hasProperty(changes, 'permissions.ACTOR_CREATE')) return
    provisionOwnActorIfNeeded()
  })

  // Revoke promptly (while both clients are online) the moment a player
  // finishes, rather than waiting for the GM's next login to notice.
  Hooks.on('updateActor', (actor, changes) => {
    if (!game.user.isGM) return
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.wizardCompleted`)) return
    const ownerId = actor.getFlag(MODULE_ID, 'ownerUserId')
    const user = ownerId && game.users.get(ownerId)
    if (user) revokeCreateIfDone(user)
  })
}
