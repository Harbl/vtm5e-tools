/**
 * Find the weapon item on the speaking actor that a roll came from, by
 * matching the roll's title (set from item.name when the roll was made)
 * against the actor's owned weapon items. Shared between damage-application
 * and opposing-roll-trigger since both need to answer "was this a weapon
 * roll, and which weapon."
 */
export function findWeaponForRoll(message, roll) {
  const actor = message.speakerActor
  if (!actor) return null

  const title = roll.options?.title
  if (!title) return null

  return actor.items.find((i) => i.type === 'weapon' && i.name === title) ?? null
}

/**
 * Mirrors wod5e's own _onConfirmRoll/_rollItem logic: vampire hunger dice
 * and werewolf rage dice come OUT of the basic dice pool rather than being
 * added on top of it, capped at the basic pool size. Shared by
 * opposing-roll-trigger and the social-conflict roll dialog, both of which
 * call WOD5E.api.Roll directly rather than going through wod5e's own click
 * handlers, so they need to replicate this split themselves.
 */
export function splitAdvancedDice(basicDiceRaw, advancedDiceRaw, actor) {
  const system = actor.system.gamesystem
  const needsSplit = (system === 'vampire' && actor.type !== 'ghoul') || system === 'werewolf'

  if (!needsSplit) return { basicDice: basicDiceRaw, advancedDice: advancedDiceRaw }

  const advancedDice = Math.min(basicDiceRaw, advancedDiceRaw)
  const basicDice = Math.max(basicDiceRaw - advancedDice, 0)

  return { basicDice, advancedDice }
}

/**
 * Get the actual dice-icon-grid HTML wod5e shows for a roll message - not
 * available from message.content (a mostly-empty placeholder) or from
 * roll.render() (Foundry's generic formula+total tooltip, not wod5e's own
 * look). wod5e builds the real card on demand inside WoDChatMessage's
 * renderHTML() override (system/ui/wod-chat-message.js), which sets
 * this.template to chat-message-roll.hbs and populates this.messageData via
 * generateRollMessageData() - none of that runs until renderHTML() is
 * called, so we call it ourselves and pull the .dice-roll element back out.
 *
 * wod5e also stuffs the rolled item's full description into this block as
 * "flavor" text (chat-message-roll.hbs's enrichedFlavor .collapsible-content)
 * - fine on the original standalone roll card, but a long weapon description
 * (an AR-15's, say) then gets dragged wholesale into our recap card twice
 * over (once per side) since the recap already names the weapon in its own
 * title. Stripped here rather than in the recap builder so every caller of
 * this helper gets the trimmed version.
 */
export async function renderRollCardHTML(message) {
  const rendered = await message.renderHTML({ canDelete: false, canClose: false })
  const diceRoll = rendered.querySelector('.dice-roll')
  if (!diceRoll) return ''

  diceRoll.querySelectorAll('.collapsible-content').forEach((el) => el.remove())
  return diceRoll.outerHTML
}

/**
 * Whether a roll is a genuine Bestial Failure (corebook p. 207): a FAILED
 * roll (not enough successes to reach the Difficulty, or - for our opposed
 * rolls - losing the contest) in which at least one Hunger die came up a 1.
 * Both conditions are required; a winning roll can never be a Bestial
 * Failure no matter how many 1s show up on Hunger dice. `failed` must be
 * worked out by the caller from context (wod5e itself can't know this for
 * difficulty-less/opposed rolls - see adjustBestialFailureLabel below for
 * why that matters).
 */
export function isBestialFailure(roll, actor, failed) {
  if (!failed || !roll) return false
  if (actor?.system?.gamesystem !== 'vampire' || actor?.type === 'ghoul') return false

  const advancedTerm = roll.terms?.find((term) => term.dieType === 'advanced')
  return advancedTerm?.results?.some((result) => result.result === 1 && !result.discarded) ?? false
}

/**
 * Whether a roll contains at least one pair of raw 10s (a "critical" in V5
 * terms - each pair adds 4 successes instead of 2). Mirrors wod5e's own
 * criticals counting in roll-message.js's generateBasicDiceDisplay/
 * generateAdvancedDiceDisplay (a die is "critical" when its raw result is
 * exactly 10, summed across BOTH basic and advanced/Hunger dice before
 * halving into pairs) - that logic only runs when the chat card renders, not
 * on the Roll object itself, so it's not readable off message.rolls[0]
 * directly and has to be recomputed here the same way.
 */
export function isCriticalWin(roll) {
  if (!roll?.terms) return false

  let tens = 0
  for (const term of roll.terms) {
    if (term.dieType !== 'basic' && term.dieType !== 'advanced') continue
    for (const result of term.results ?? []) {
      if (result.result === 10 && !result.discarded) tens++
    }
  }

  return tens >= 2
}

/**
 * wod5e's own chat card can only ever say "Possible Bestial Failure" for
 * our rolls, never a definitive one - its label logic (getVampireLabel in
 * vampire-labels.js) needs a Difficulty to know whether a roll actually
 * failed, and none of our opposed rolls have one (nobody knows what number
 * to beat until both sides have rolled). Once we DO know the outcome (once
 * the opposed roll resolves), we know definitively either way, so this
 * patches the already-rendered card HTML: promotes the hedge to a real
 * "Bestial Failure" label, or removes it entirely if a Hunger 1 showed up
 * on a roll that actually won (not a failure at all, so the hedge was
 * never applicable).
 */
export function adjustBestialFailureLabel(html, bestialFailure) {
  if (!html) return html

  const wrapper = document.createElement('div')
  wrapper.innerHTML = html

  const label = wrapper.querySelector('.roll-result-label.bestial-failure')
  if (label) {
    if (bestialFailure) {
      label.textContent = game.i18n.localize('WOD5E.VTM.BestialFailure')
    } else {
      label.remove()
    }
  }

  return wrapper.innerHTML
}

/**
 * Whether a roll qualifies as a Messy Critical (corebook): a WINNING roll
 * whose critical pair(s) of raw 10s involve a Hunger die - either two or
 * more Hunger-die 10s on their own, or at least one Hunger-die 10 alongside
 * at least one regular-die 10. Mirrors wod5e's own trigger condition
 * exactly (getVampireLabel in vampire-labels.js: `advancedDice.criticals > 1
 * || (basicDice.criticals > 0 && advancedDice.criticals > 0)`), just
 * recomputed from the Roll object the same way isCriticalWin is, since that
 * per-term-type criticals count only exists inside the render-time
 * generateRollMessageData() path, not on message.rolls[0] itself.
 *
 * Unlike Bestial Failure, `won` isn't optional here - a roll that doesn't
 * actually win was never a Messy Critical no matter how the dice landed
 * (same reasoning wod5e's own hedge relies on, see adjustMessyCriticalLabel
 * below for why our opposed rolls need this patched after the fact too).
 */
export function isMessyCritical(roll, actor, won) {
  if (!won || !roll) return false
  if (actor?.system?.gamesystem !== 'vampire' || actor?.type === 'ghoul') return false

  let basicTens = 0
  let advancedTens = 0
  for (const term of roll.terms ?? []) {
    if (term.dieType !== 'basic' && term.dieType !== 'advanced') continue
    const tens = (term.results ?? []).filter((result) => result.result === 10 && !result.discarded).length
    if (term.dieType === 'basic') basicTens += tens
    else advancedTens += tens
  }

  return advancedTens > 1 || (basicTens > 0 && advancedTens > 0)
}

/**
 * Same hedge-promotion/removal pattern as adjustBestialFailureLabel, for the
 * "Possible Messy Critical" label wod5e's own card already renders for our
 * opposed rolls (it can compute the dice shape without a Difficulty, but
 * still can't know if the roll actually WON without one, so it hedges the
 * same way). Once our own opposed-roll resolution knows the real outcome,
 * this promotes the hedge to a definitive "Messy Critical" or removes it.
 */
export function adjustMessyCriticalLabel(html, messyCritical) {
  if (!html) return html

  const wrapper = document.createElement('div')
  wrapper.innerHTML = html

  const label = wrapper.querySelector('.roll-result-label.messy-critical')
  if (label) {
    if (messyCritical) {
      label.textContent = game.i18n.localize('WOD5E.VTM.MessyCritical')
    } else {
      label.remove()
    }
  }

  return wrapper.innerHTML
}

/**
 * Delete the original roll/prompt messages a recap card superseded (listed
 * in its sourceMessageIds flag). Register this ONCE (see
 * registerSourceMessageCleanup below) rather than calling it from each
 * feature file's own createChatMessage hook - every registered hook fires
 * for every created message, so calling it from two files meant the same
 * client tried to delete the same 3 messages twice in the same tick and
 * raced itself, surfacing as "ChatMessage does not exist" errors.
 *
 * Deletion is also single-authority across clients for the same reason: a
 * GM can delete any message, so when one is active it alone does the
 * cleanup; only fall back to each client deleting its own messages when no
 * GM is connected to do it centrally.
 *
 * The delete is deferred a tick past message creation - deleting a message
 * immediately as part of handling its own createChatMessage hook can race
 * Foundry's own new-message notification/badge handling for that message,
 * which trips a "Cannot set properties of null (setting 'hidden')" error
 * in Foundry's core code when it tries to update a DOM node for a message
 * that's already gone. The tiny delay lets that finish first.
 */
export function cleanupSourceMessages(message, moduleId) {
  const cleanupIds = message.getFlag(moduleId, 'sourceMessageIds')
  if (!cleanupIds?.length) return

  const gmActive = game.users.some((u) => u.active && u.isGM)

  setTimeout(() => {
    for (const id of cleanupIds) {
      const sourceMessage = game.messages.get(id)
      if (!sourceMessage) continue

      const shouldDelete = game.user.isGM ? true : (!gmActive && sourceMessage.isOwner)
      if (shouldDelete) sourceMessage.delete().catch(() => {})
    }
  }, 250)
}

/**
 * Register the sourceMessageIds cleanup exactly once for the whole module.
 * See the note on cleanupSourceMessages above for why this must not be
 * called from more than one place.
 */
export function registerSourceMessageCleanup(moduleId) {
  Hooks.on('createChatMessage', (message) => cleanupSourceMessages(message, moduleId))
}

/**
 * Superficial/Aggravated button row shared by every damage-application call
 * site (weapon defense, Social Conflict, Discipline resistance) - applyFn
 * is whichever track's apply function the caller needs (Health or
 * Willpower), so this doesn't need to know about either.
 *
 * applyOptions is forwarded as a 4th argument to applyFn - additive, so
 * Social Conflict's applyWillpowerDamageToTarget and Discipline resistance's
 * callers (which never pass it, always defaulting to {}) are unaffected.
 * Only applyDamageToTarget's weapon-attack callers actually read a 4th
 * argument (armor reduction options - see damage-application.js).
 */
export function buildDamageButtonRow(amount, token, applyFn, applyOptions = {}) {
  const wrapper = document.createElement('div')
  wrapper.classList.add('vtm5e-automation-damage-buttons')
  wrapper.style.display = 'flex'
  wrapper.style.gap = '4px'
  wrapper.style.marginTop = '4px'

  for (const type of ['superficial', 'aggravated']) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = type === 'superficial' ? 'Superficial' : 'Aggravated'
    button.addEventListener('click', async () => {
      await applyFn(token, amount, type, applyOptions)
    })
    wrapper.appendChild(button)
  }

  return wrapper
}

/**
 * Permanent, module-wide button-rendering hook for the pendingDamage flag
 * (actorId, amount, controllingUserId, track: 'health'|'willpower') that
 * every damage-dealing recap card writes onto its ChatMessage. Registered
 * ONCE from main.js with both apply functions, replacing what used to be
 * two near-identical per-file flag+hook pairs (pendingHealthDamage in
 * opposing-roll-trigger.js, pendingWillpowerDamage in social-conflict.js) -
 * consolidated here now that a third consumer (Discipline resistance) needs
 * the exact same mechanism. See cleanupSourceMessages above for why this
 * MUST be a single registration rather than one per file: every registered
 * hook fires for every created message, so duplicating it would mean two
 * clients (or two hooks on the same client) racing to build the same button
 * row.
 *
 * Only the user who actually rolled for the actor taking the damage
 * (controllingUserId, tracked via message.author rather than actor
 * ownership - see the note where callers set this) or a GM sees the
 * buttons. When controllingUserId is absent (the unopposed Social Conflict
 * fallback, where there's no second roll to derive it from) this falls
 * back to actor.isOwner instead.
 */
export function registerPendingDamageButtons(moduleId, applyFns) {
  Hooks.on('renderChatMessageHTML', (message, html) => {
    const pending = message.getFlag(moduleId, 'pendingDamage')
    if (!pending) return
    if (html.querySelector('.vtm5e-automation-damage-buttons')) return

    const actor = game.actors.get(pending.actorId)
    if (!actor) return

    const isEligible = pending.controllingUserId
      ? game.user.id === pending.controllingUserId
      : actor.isOwner
    if (!game.user.isGM && !isEligible) return

    const token = actor.getActiveTokens()[0]
    if (!token) return

    const applyFn = applyFns[pending.track]
    if (!applyFn) return

    html.appendChild(buildDamageButtonRow(pending.amount, token, applyFn, pending.applyOptions ?? {}))
  })
}
