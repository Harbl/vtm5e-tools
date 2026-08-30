import { findWeaponForRoll, isBestialFailure, isMessyCritical } from './roll-utils.js'
import { rollCompulsion, buildCompulsionHTML } from './compulsion.js'

const MODULE_ID = 'vtm5e-automation'

// Same literal marker opposing-roll-trigger.js already uses on its own
// Dodge rolls - redefined locally here (not imported, matching this
// project's convention elsewhere of small local copies over cross-file
// internals) purely to recognize and STAY OUT of those rolls, which already
// get full Bestial Failure/Messy Critical handling through their own
// opposed-roll resolution once both sides are known.
const DODGE_TITLE_MARKER = 'DODGE::'

function isHandledByOpposedFlow(message, roll) {
  const title = roll.options?.title ?? ''
  if (title.startsWith(DODGE_TITLE_MARKER)) return true
  if (findWeaponForRoll(message, roll)) return true // covers thrown-weapon rolls too (same title as a fired one)
  return false
}

function isVampireRoller(actor) {
  return actor?.system?.gamesystem === 'vampire' && actor.type !== 'ghoul'
}

async function postBestialFailureCompulsion(actor) {
  const compulsion = await rollCompulsion(actor)
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <p class="vtm5e-automation-recap-title">${actor.name} - Bestial Failure</p>
      ${buildCompulsionHTML(compulsion)}
    `
  })
}

/**
 * Bestial Failure/Messy Critical for every vampire roll opposing-roll-
 * trigger.js and social-conflict.js DON'T already own (weapon attacks/
 * defenses, Social Conflict both sides) - ordinary skill/attribute checks,
 * Discipline resistance rolls (discipline-resistance.js), repair rolls
 * (repair.js), anything made straight through wod5e's own dialog. Before
 * this, NOTHING triggered the actual Compulsion roll for these - wod5e's
 * own chat card just shows a text label (definite, or "Possible..." when
 * no Difficulty was entered - see vampire-labels.js) and stops there.
 *
 * Difficulty SET on the roll: fully knowable from the roll alone (no
 * opponent's future roll to wait on, unlike weapon/social), so this is
 * resolved and Compulsion is auto-triggered immediately, same as the
 * opposed-roll flows do once THEY know the outcome.
 *
 * Difficulty NOT set (0): wod5e hedges ("Possible Bestial Failure")
 * whenever a Hunger 1 shows up at all, regardless of total successes -
 * genuinely ambiguous, since nobody told the system what Difficulty was
 * actually intended, EXCEPT the zero-successes case: 0 successes fails
 * against any Difficulty >=1 a table could plausibly have meant, so that
 * sub-case is auto-resolved too. What's left genuinely ambiguous gets a
 * manual "Confirm Bestial Failure" button on the card instead of silently
 * doing nothing - Jake's own ask ("stuff should still happen on those").
 *
 * Messy Critical has no such ambiguity, difficulty or not: a qualifying
 * Hunger-crit-pair mathematically guarantees at least 4 raw successes on
 * its own (each pair of raw 10s is worth 4, not 2), so "the roll actually
 * succeeded" is never really in question no matter what Difficulty (if
 * any) was intended - always safe to promote straight to a definite label,
 * no button needed. No separate dice mechanic exists for it either way
 * (corebook-RAW: it's a narrative cue for the Storyteller, not a
 * subsystem) - matches how the opposed-roll flows already treat it,
 * label-only, no roll.
 */
export function registerGenericBestialFailure() {
  Hooks.on('createChatMessage', async (message) => {
    // Single-client guard - createChatMessage fires on every connected
    // client when the roll syncs, same reasoning as every other
    // roll-reactive hook in this module family.
    if (message.author?.id !== game.user.id) return

    const roll = message.rolls?.[0]
    if (!roll || !roll.systemRoll) return

    const actor = message.speakerActor
    if (!isVampireRoller(actor)) return
    if (isHandledByOpposedFlow(message, roll)) return

    const difficulty = roll.options?.difficulty ?? 0
    const difficultySet = difficulty > 0
    const total = roll.total

    const definiteFail = difficultySet ? total < difficulty : total === 0
    if (isBestialFailure(roll, actor, definiteFail)) {
      await message.setFlag(MODULE_ID, 'bestialFailureConfirmed', true)
      await postBestialFailureCompulsion(actor)
      return
    }

    // Genuinely ambiguous: no Difficulty entered, a Hunger 1 landed, but
    // there ARE successes on the board so we can't rule out an unstated
    // Difficulty having still been met. Flag it on the message itself
    // (not just computed at render time) so the confirm offer survives a
    // page reload.
    if (!difficultySet && total > 0) {
      const advancedTerm = roll.terms?.find((term) => term.dieType === 'advanced')
      const hungerOne = advancedTerm?.results?.some((r) => r.result === 1 && !r.discarded) ?? false
      if (hungerOne) await message.setFlag(MODULE_ID, 'bestialFailureAmbiguous', true)
    }
  })

  Hooks.on('renderChatMessageHTML', (message, html) => {
    const roll = message.rolls?.[0]
    if (!roll || !roll.systemRoll) return

    const actor = message.speakerActor
    if (!isVampireRoller(actor)) return
    if (isHandledByOpposedFlow(message, roll)) return

    if (message.getFlag(MODULE_ID, 'bestialFailureConfirmed')) {
      const label = html.querySelector('.roll-result-label.bestial-failure')
      if (label) label.textContent = game.i18n.localize('WOD5E.VTM.BestialFailure')
    } else if (message.getFlag(MODULE_ID, 'bestialFailureAmbiguous') && !html.querySelector('.vtm5e-automation-confirm-bestial-failure')) {
      // Only the roll's own controller (or a GM) gets to decide whether
      // this was really a failure against whatever Difficulty they had in
      // mind.
      if (game.user.isGM || actor.isOwner) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = 'Confirm Bestial Failure (roll Compulsion)'
        button.classList.add('vtm5e-automation-confirm-bestial-failure')
        button.style.display = 'block'
        button.style.marginTop = '4px'
        button.addEventListener('click', async () => {
          button.disabled = true
          await message.setFlag(MODULE_ID, 'bestialFailureAmbiguous', false)
          await message.setFlag(MODULE_ID, 'bestialFailureConfirmed', true)
          const label = html.querySelector('.roll-result-label.bestial-failure')
          if (label) label.textContent = game.i18n.localize('WOD5E.VTM.BestialFailure')
          await postBestialFailureCompulsion(actor)
        })
        html.appendChild(button)
      }
    }

    if (isMessyCritical(roll, actor, roll.total > 0)) {
      const label = html.querySelector('.roll-result-label.messy-critical')
      if (label) label.textContent = game.i18n.localize('WOD5E.VTM.MessyCritical')
    }
  })
}
