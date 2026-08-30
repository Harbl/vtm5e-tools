import { splitAdvancedDice, isCriticalWin } from './roll-utils.js'
import { getStepSetting } from './settings.js'
import { getRoutingTargets } from './socket-routing.js'
import { applyDamageToTarget, applyWillpowerDamageToTarget } from './damage-application.js'
import { applyStatusCondition } from './condition-application.js'

const MODULE_ID = 'vtm5e-automation'

// Tracks Discipline-power resistance rolls in flight, keyed by resistor
// actor ID. Only populated on the caster's own client, same pattern (and
// reasoning) as pendingWeaponOpposedRolls in opposing-roll-trigger.js.
const pendingResistanceRolls = new Map()

// Tracks a "chained contest" the caster has been set up for (Baal's Caress:
// a vampire who takes damage triggers a second, separate roll of the SAME
// power for Torpor instead of more damage) - keyed by
// `${casterActorId}:${resistorActorId}:${powerName}`. When the caster's next
// roll of that exact power against that exact target comes in, it resolves
// using the chain's override config (a different consequence) instead of
// the power's normal one. Same "caster's own client only" scoping as
// pendingResistanceRolls - see its comment.
const pendingChainedContests = new Map()

const DEFAULT_RESISTANCE_CONFIG = {
  enabled: false,
  attribute: 'resolve',
  secondKey: 'composure',
  secondType: 'attribute',
  resistWithWillpower: false,
  mode: 'opposed',
  fixedDifficulty: 3,
  useCasterRating: false,
  narrativeText: '',
  consequence: 'none',
  damageTrack: 'health',
  damageSeverity: 'superficial',
  // 'margin' (the historical, still-default behavior) or a fixed number -
  // added for the Warding Circles, whose damage is a flat 3 regardless of
  // margin (RAW: "the trespasser takes three points of Superficial Health
  // damage"), unlike every damage-consequence power before it. Not exposed
  // in the sheet UI yet - script/flag-only, same treatment as vampireBonus.
  damageAmount: 'margin',
  // Severity override for a caster's critical win specifically - blank
  // means "use damageSeverity for every win, critical or not." Also added
  // for the Warding Circles (Superficial on a plain win, Aggravated on a
  // critical win) - no power before it needed severity to depend on the
  // tier, only the amount (margin) did.
  damageSeverityCritWin: '',
  actionLabel: 'Roll Frenzy Test',
  resistorWinConsequence: 'none',
  resistorWinActionLabel: 'Roll Follow-Up Test',
  multiTier: false,
  narrativeTextFail: '',
  narrativeTextCritWin: '',
  critWinConsequence: 'none',
  critWinActionLabel: 'Roll Follow-Up Test',
  statusName: '',
  statusNote: '',
  resistorWinStatusName: '',
  resistorWinStatusNote: '',
  hungerAmount: 1,
  hungerAmountCritWin: '',
  // Fires ALONGSIDE whatever the main consequence is (not instead of it) -
  // only when the caster wins AND the resistor is specifically a vampire.
  // Covers powers whose text has a second, vampire-only effect layered on
  // top of a primary one that applies to everyone (Cauldron of Blood: deals
  // damage to anyone, but ALSO adds Hunger if the target's a vampire; Baal's
  // Caress: deals damage to anyone, but a vampire who takes it triggers a
  // second, separate contest this module doesn't auto-roll - so that one's
  // just a visible reminder rather than an automatic effect). Not exposed in
  // the sheet UI yet - script/flag-only for now, only two powers use it.
  vampireBonus: null // { type: 'hunger', amount: number|'margin' } | { type: 'reminder', label: string }
}

export function registerDisciplineResistance() {
  // Config UI on each Discipline power's own item sheet - "power" and
  // "discipline" (the container) items share the same sheet class
  // (DisciplineItemSheet), so this only actually does anything for powers.
  Hooks.on('renderDisciplineItemSheet', (app, html) => {
    if (app.item?.type !== 'power') return
    if (html.querySelector('.vtm5e-automation-resistance-config')) return

    html.appendChild(buildResistanceConfigSection(app.item))
  })

  Hooks.on('createChatMessage', async (message) => {
    const prompt = message.getFlag(MODULE_ID, 'resistancePromptActorId')
    if (prompt && message.whisper?.includes(game.user.id)) {
      const actor = game.actors.get(prompt)
      const auto = message.getFlag(MODULE_ID, 'resistanceAutoResolve')
      const rollData = message.getFlag(MODULE_ID, 'resistanceRollData')
      if (actor && rollData) {
        if (auto) await autoRollResistance(actor, rollData)
        else await promptRollResistance(actor, rollData)
      }
    }

    const roll = message.rolls?.[0]
    if (!roll || !roll.systemRoll) return

    const resistorId = message.speakerActor?.id
    if (resistorId && pendingResistanceRolls.has(resistorId)) {
      const pending = pendingResistanceRolls.get(resistorId)
      pendingResistanceRolls.delete(resistorId)
      await resolveResistance(pending, message.speakerActor, roll, message.id, message.author?.id)
      return
    }

    const power = findPowerForRoll(message, roll)
    if (!power) return
    const config = power.getFlag(MODULE_ID, 'resistance')
    if (!config?.enabled) return

    // Same attacker-only gate as opposing-roll-trigger.js's weapon-attack
    // detection - createChatMessage fires on every client, so without this
    // any other client with its own target selected would independently
    // re-detect the same power roll and self-trigger a redundant prompt.
    if (message.author?.id !== game.user.id) return

    const targets = Array.from(game.user.targets)
    if (targets.length === 0) {
      // Same silent early-return weapon attacks use when nothing's
      // targeted - but weapon attacks are habitual enough that players
      // always target first. Resistance is a newer flow that's easy to
      // trigger without remembering to target, and there was previously no
      // signal at all when that happened - just nothing, indistinguishable
      // from the config not being enabled in the first place.
      ui.notifications.warn(`${MODULE_ID} | ${power.name} has automated resistance configured, but no target is selected - target the recipient before rolling for the opposed check to trigger.`)
      return
    }
    const targetActor = targets[0].actor
    if (!targetActor) return

    const mode = getStepSetting('opposingRoll', targetActor)
    if (mode === 'off') return

    // Is this actually the follow-up half of a chained contest (Baal's
    // Caress's Torpor roll) rather than a fresh cast? If the caster was
    // just set up for one against this exact target with this exact power,
    // resolve it with the chain's override config instead of the power's
    // normal one - see the pendingAction.chainSetup button handler below,
    // which is what populates this map.
    const chainKey = `${message.speakerActor.id}:${targetActor.id}:${power.name}`
    const chainedConfig = pendingChainedContests.get(chainKey)
    if (chainedConfig) pendingChainedContests.delete(chainKey)

    await promptResistance(message, roll, power, targetActor, mode, chainedConfig)
  })

  // Follow-up "roll a specific test" button for consequence: 'action' -
  // deliberately does NOT call into wod5e's internal per-actor-sheet roll
  // handlers (e.g. its frenzy roll) directly, since those aren't part of
  // the documented WOD5E.api surface this module otherwise sticks to and
  // could break silently on a wod5e update. Opens the actor's own sheet
  // instead so they can click the real control themselves - actorId here
  // may be either the resistor OR the caster (see resistorWinConsequence in
  // postResistanceCard), so this hook stays generic about who it's for.
  Hooks.on('renderChatMessageHTML', (message, html) => {
    const pending = message.getFlag(MODULE_ID, 'pendingAction')
    if (!pending) return
    if (html.querySelector('.vtm5e-automation-action-button')) return

    const actor = game.actors.get(pending.actorId)
    if (!actor) return
    if (!game.user.isGM && game.user.id !== pending.controllingUserId) return

    const button = document.createElement('button')
    button.type = 'button'
    button.classList.add('vtm5e-automation-action-button')
    button.style.marginTop = '4px'
    button.textContent = pending.label
    button.addEventListener('click', async () => {
      // chainSetup (Baal's Caress's Torpor follow-up, see
      // pendingChainedContests up top) - register that the caster's NEXT
      // roll of this exact power against this exact target should resolve
      // as the chained contest, target the same resistor for them, then
      // roll the power directly rather than just opening the sheet and
      // hoping they find and click it themselves - same _rollItem reach the
      // HUD's own weapon/power buttons already use, so wod5e's real confirm
      // dialog still shows (this doesn't skip their review, just skips the
      // "go find the button" step). Foundry targeting is pure client-side
      // UI state (no ownership needed), safe to set regardless of who
      // controls the token.
      if (pending.chainSetup) {
        await triggerChainedRoll(actor, pending.chainSetup)
        return
      }

      // A bare .render(true) is Application V1's calling convention - it
      // still mostly works under V2's compatibility shim, but doesn't
      // reliably bring an ALREADY-open sheet to the front, which reads as
      // "nothing happened" if the sheet is open but buried behind other
      // windows. {force: true} is V2's actual signature; explicitly
      // bringing it to front covers the already-open case Application V1's
      // convention doesn't. render() is async - bringToFront needs to wait
      // for it, or its own element.style access throws on a sheet that
      // isn't open yet.
      const sheet = actor.sheet
      await sheet.render({ force: true })
      try {
        sheet.bringToFront?.()
      } catch (err) {
        console.warn(`${MODULE_ID} | bringToFront failed (non-fatal)`, err)
      }
      ui.notifications.info(`Opening ${actor.name}'s sheet - resolve "${pending.label}" there.`)
    })
    html.appendChild(button)
  })
}

// Registers the chain, retargets the resistor, and rolls the power
// directly via the same _rollItem reach the HUD's own weapon/power buttons
// use (still shows wod5e's real confirm dialog - this doesn't skip the
// caster's review, just the "go find the button" step). Shared by the
// chainSetup click handler above (Follow-Up Roll: Prompt) and Auto mode's
// immediate roll in postResistanceCard below (Follow-Up Roll: Auto).
// Returns false (and warns) if the power item can't be found, so callers
// can fall back to a manual pendingAction button instead.
async function triggerChainedRoll(actor, chainSetup) {
  pendingChainedContests.set(chainSetup.chainKey, chainSetup.overrideConfig)

  const targetToken = chainSetup.resistorTokenId ? canvas.tokens?.get(chainSetup.resistorTokenId) : null
  targetToken?.setTarget(true, { releaseOthers: true })

  const powerItem = actor.items.find((i) => i.type === 'power' && i.name === chainSetup.powerName)
  if (!powerItem) {
    ui.notifications.warn(`${MODULE_ID} | Couldn't find "${chainSetup.powerName}" on ${actor.name} to roll automatically - open their sheet and roll it manually.`)
    return false
  }

  const { _rollItem } = await import('/systems/wod5e/system/actor/scripts/item-roll.js')
  await _rollItem(actor, powerItem)
  return true
}

function findPowerForRoll(message, roll) {
  const actor = message.speakerActor
  if (!actor) return null

  const title = roll.options?.title
  if (!title) return null

  return actor.items.find((i) => i.type === 'power' && i.name === title) ?? null
}

async function promptResistance(originalMessage, casterRoll, power, targetActor, mode, overrideConfig) {
  const config = overrideConfig ?? power.getFlag(MODULE_ID, 'resistance')
  const casterActor = originalMessage.speakerActor

  const difficulty = config.mode === 'difficulty'
    ? (config.useCasterRating
        ? (casterActor.system.disciplines?.[power.system.discipline]?.value ?? 0)
        : (config.fixedDifficulty ?? 0))
    : null

  const rollData = {
    config,
    title: `Resist: ${power.name}`,
    difficulty
  }

  pendingResistanceRolls.set(targetActor.id, {
    casterActorId: casterActor.id,
    casterName: casterActor?.name ?? 'Caster',
    casterUserId: originalMessage.author?.id,
    casterTotal: casterRoll.total,
    // Kept (not just the total) so a caster win can be checked for a
    // critical - see isCriticalWin/multiTier handling in resolveResistance.
    casterRoll,
    casterMessageId: originalMessage.id,
    powerName: power.name,
    resistanceConfig: config,
    difficulty,
    promptMessageId: null
  })

  const routingTargets = getRoutingTargets(targetActor)

  if (routingTargets.length === 0) {
    pendingResistanceRolls.delete(targetActor.id)
    ui.notifications.warn(`${MODULE_ID} | No one is online to control ${targetActor.name} - leaving ${power.name} for manual resolution`)
    return
  }

  if (routingTargets.some((u) => u.id === game.user.id)) {
    if (mode === 'auto') await autoRollResistance(targetActor, rollData)
    else await promptRollResistance(targetActor, rollData)
  } else {
    const promptMessage = await ChatMessage.create({
      content: mode === 'auto'
        ? `<b>${power.name}:</b> ${targetActor.name} is affected - auto-resolving resistance.`
        : `<b>${power.name}:</b> ${targetActor.name} is affected and can resist.`,
      whisper: routingTargets.map((u) => u.id),
      flags: {
        [MODULE_ID]: {
          resistancePromptActorId: targetActor.id,
          resistanceAutoResolve: mode === 'auto',
          resistanceRollData: rollData
        }
      }
    })
    const pending = pendingResistanceRolls.get(targetActor.id)
    if (pending) pending.promptMessageId = promptMessage.id
  }
}

// Auto skips straight to rolling the power's configured pool, no dialog.
// Prompt now opens the same pick-a-pool dialog Social Conflict uses (see
// openResistanceDialog below), pre-filled from the power's config but
// changeable - the resistor isn't locked into whatever the GM configured if
// the scene calls for something different.
async function autoRollResistance(actor, rollData) {
  const config = rollData.config
  if (config.resistWithWillpower) {
    await rollResistance(actor, { willpowerPool: currentWillpowerPoints(actor), title: rollData.title, difficulty: rollData.difficulty })
    return
  }
  const valuePaths = buildValuePaths(config)
  await rollResistance(actor, { valuePaths, title: rollData.title, difficulty: rollData.difficulty })
}

async function promptRollResistance(actor, rollData) {
  const rolled = await openResistanceDialog(actor, rollData)
  if (!rolled) pendingResistanceRolls.delete(actor.id)
}

// Same two-select (Attribute + Attribute-or-Skill) pool picker as Social
// Conflict's openSocialConflictDialog, pre-filled from the power's
// configured resistance pool rather than starting blank - Discipline
// resistance pools are just as often Attribute+Attribute (e.g. Composure +
// Intelligence) as Attribute+Skill, so this can't reuse Social Conflict's
// fixed Attribute-select/Skill-select layout, which can only ever represent
// the latter. Attribute and Skill key namespaces don't overlap in wod5e, so
// the picked value can be typed as one or the other with a plain lookup.
//
// resistWithWillpower powers (raw Willpower points as the pool, e.g. a
// Warding Circle's trespasser check) skip the pool pickers entirely - there's
// nothing to choose, the number comes straight off the sheet.
async function openResistanceDialog(actor, { config, title, difficulty }) {
  const attributeOptions = WOD5E.Attributes.getList({})
  const skillOptions = WOD5E.Skills.getList({})

  const content = config.resistWithWillpower
    ? `
    <form class="vtm5e-automation-resistance-dialog">
      <p>Resisting with current Willpower points (<b>${currentWillpowerPoints(actor)}</b>).</p>
      <div class="form-group">
        <label>Difficulty</label>
        <input type="number" name="difficulty" value="${difficulty ?? 0}" min="0" />
      </div>
    </form>
  `
    : `
    <form class="vtm5e-automation-resistance-dialog">
      <div class="form-group">
        <label>First Component</label>
        <select name="attributeSelect">${buildOptionTags(attributeOptions, config.attribute)}</select>
      </div>
      <div class="form-group">
        <label>Second Component</label>
        <select name="secondSelect">
          <optgroup label="Attributes">${buildOptionTags(attributeOptions, config.secondType === 'attribute' ? config.secondKey : null)}</optgroup>
          <optgroup label="Skills">${buildOptionTags(skillOptions, config.secondType === 'skill' ? config.secondKey : null)}</optgroup>
        </select>
      </div>
      <div class="form-group">
        <label>Difficulty</label>
        <input type="number" name="difficulty" value="${difficulty ?? 0}" min="0" />
      </div>
    </form>
  `

  const result = await foundry.applications.api.DialogV2.input({
    window: { title },
    content,
    ok: { icon: 'fas fa-dice', label: 'Roll' },
    buttons: [{ action: 'cancel', icon: 'fas fa-times', label: 'Cancel' }],
    classes: ['wod5e']
  })

  if (!result || result === 'cancel') return false

  if (config.resistWithWillpower) {
    await rollResistance(actor, { willpowerPool: currentWillpowerPoints(actor), title, difficulty: parseInt(result.difficulty) || 0 })
    return true
  }

  const { attributeSelect, secondSelect, difficulty: enteredDifficulty } = result
  const secondType = attributeOptions[secondSelect] ? 'attribute' : 'skill'
  const valuePaths = buildValuePaths({ attribute: attributeSelect, secondKey: secondSelect, secondType })

  await rollResistance(actor, { valuePaths, title, difficulty: parseInt(enteredDifficulty) || 0 })
  return true
}

// willpowerPool is mutually exclusive with valuePaths - when set, it's used
// directly as the basic dice count instead of computing one from an
// attribute+skill/attribute pool (see resistWithWillpower on the config).
// Willpower contests never include Hunger dice at all (confirmed) - unlike
// every other roll here, this does NOT go through splitAdvancedDice; it's
// just the raw Willpower points rolled on their own, advancedDice forced to
// 0 rather than pulled from getAdvancedDice.
async function rollResistance(actor, { valuePaths, willpowerPool, title, difficulty }) {
  let basicDice, advancedDice
  if (willpowerPool != null) {
    basicDice = willpowerPool
    advancedDice = 0
  } else {
    const basicDiceRaw = await WOD5E.api.getBasicDice({ valuePaths, flatMod: 0, actor })
    const advancedDiceRaw = await WOD5E.api.getAdvancedDice({ actor })
    ;({ basicDice, advancedDice } = splitAdvancedDice(basicDiceRaw, advancedDiceRaw, actor))
  }

  await WOD5E.api.Roll({
    basicDice,
    advancedDice,
    actor,
    data: actor.system,
    title,
    difficulty: difficulty ?? 0,
    quickRoll: true
  })
}

function currentWillpowerPoints(actor) {
  const wp = actor.system?.willpower
  if (!wp) return 0
  return Math.max(wp.max - (wp.superficial ?? 0) - (wp.aggravated ?? 0), 0)
}

function buildValuePaths(config) {
  const valuePaths = [`attributes.${config.attribute}.value`]
  valuePaths.push(config.secondType === 'skill' ? `skills.${config.secondKey}.value` : `attributes.${config.secondKey}.value`)
  return valuePaths
}

async function resolveResistance(pending, resistorActor, resistorRoll, resistorMessageId, resistorUserId) {
  const resistorTotal = resistorRoll.total
  const config = pending.resistanceConfig
  const casterActor = game.actors.get(pending.casterActorId)

  let resultLine
  let resistorWon
  let marginAgainstResistor

  if (config.mode === 'opposed') {
    const margin = pending.casterTotal - resistorTotal
    resistorWon = margin <= 0
    marginAgainstResistor = margin
    resultLine = resistorWon
      ? `${resistorActor?.name} resists (${resistorTotal} vs ${pending.casterTotal}).`
      : `${pending.casterName}'s ${pending.powerName} succeeds against ${resistorActor?.name} (margin ${margin}).`
  } else {
    const difficulty = pending.difficulty ?? 0
    resistorWon = resistorTotal >= difficulty
    marginAgainstResistor = difficulty - resistorTotal
    resultLine = resistorWon
      ? `${resistorActor?.name} resists (${resistorTotal} vs Difficulty ${difficulty}).`
      : `${pending.casterName}'s ${pending.powerName} succeeds against ${resistorActor?.name} (needed ${difficulty}, got ${resistorTotal}).`
  }

  // Originally only checked for multiTier powers (Dread Gaze's Failure/Win/
  // Critical Win split), but the 'hunger' consequence also wants to know
  // this for crit-scaled amounts (Extinguish Vitae: +1 Hunger on a plain
  // win, +2 on a critical) without needing the full three-way narrative
  // split multiTier implies - so this is now computed for every caster win,
  // not gated behind config.multiTier.
  const casterCritWin = !resistorWon && isCriticalWin(pending.casterRoll)

  const sourceMessageIds = [pending.casterMessageId, resistorMessageId, pending.promptMessageId].filter(Boolean)

  await postResistanceCard({
    powerName: pending.powerName,
    casterActor,
    casterName: pending.casterName,
    casterUserId: pending.casterUserId,
    casterTotal: pending.casterTotal,
    resistorName: resistorActor?.name,
    resistorTotal,
    resultLine,
    resistorWon,
    casterCritWin,
    config,
    marginAgainstResistor,
    resistorActor,
    resistorUserId,
    sourceMessageIds
  })
}

function resolveDamageSeverity(severity, resistorActor) {
  if (severity === 'aggravated') return 'aggravated'
  if (severity === 'aggravated-mortal-only') {
    return resistorActor?.system?.gamesystem === 'vampire' ? 'superficial' : 'aggravated'
  }
  return 'superficial'
}

// Shared by the 'hunger' consequence and vampireBonus - amountConfig is
// either a fixed number (Extinguish Vitae: flat 1, or 2 on a crit) or the
// literal string 'margin' (Cauldron of Blood: exactly however much damage
// the primary contest just dealt).
function resolveScaledAmount(amountConfig, marginAgainstResistor) {
  if (amountConfig === 'margin') return Math.max(marginAgainstResistor, 0)
  return Number(amountConfig) || 0
}

// Mirrors wod5e's own Hunger cap (5) - no-ops and returns null if there's
// nothing to add or the actor's already capped, so callers can skip
// rendering a "+0" line.
async function applyHungerChange(actor, amount) {
  if (!actor || amount <= 0) return null
  const current = actor.system?.hunger?.value ?? 0
  const next = Math.min(current + amount, 5)
  if (next === current) return null
  await actor.update({ 'system.hunger.value': next })
  return next - current
}

// {margin} is the only placeholder supported right now - kept simple since
// margin is the one number every power's narrative text already leans on
// ("a number of questions equal to the margin," "one turn plus the
// margin," etc). Easy to extend with more placeholders later if a power
// needs to reference something else.
function interpolateNarrative(text, marginAgainstResistor) {
  if (!text) return text
  return text.replace(/\{margin\}/g, String(Math.max(marginAgainstResistor, 0)))
}

// Always shows what happened in plain text, regardless of whether there's
// anything to click - purely narrative powers (mind control, illusions) just
// get the text, nothing more. Buttons only appear when there's something
// concrete to resolve. The big Resisted/Failed Resist heading exists on top
// of resultLine's fuller sentence so players can tell the outcome at a
// glance without reading the successes math.
//
// Non-multiTier powers keep the original simple shape: narrativeText always
// shown, consequence only fires on a caster win. multiTier powers instead
// pick one of three tiers (resistor wins / caster wins / caster wins with a
// critical) each with their own text and consequence - see config.multiTier.
//
// resistorWinConsequence is independent of all of that - it's what happens
// to the CASTER specifically when the resistor wins (Drawing Out the Beast:
// a resisted attempt redirects the frenzy back onto the user), so it can
// coexist with either the simple or multiTier shape above.
async function postResistanceCard({ powerName, casterActor, casterName, casterUserId, casterTotal, resistorName, resistorTotal, resultLine, resistorWon, casterCritWin, config, marginAgainstResistor, resistorActor, resistorUserId, sourceMessageIds }) {
  const resistorToken = resistorActor?.getActiveTokens()[0]

  let narrativeText = config.narrativeText
  let consequence = resistorWon ? 'none' : config.consequence
  let actionLabel = config.actionLabel

  if (config.multiTier) {
    if (resistorWon) {
      narrativeText = config.narrativeTextFail || config.narrativeText
      consequence = 'none'
    } else if (casterCritWin) {
      narrativeText = config.narrativeTextCritWin || config.narrativeText
      consequence = config.critWinConsequence
      actionLabel = config.critWinActionLabel
    } else {
      narrativeText = config.narrativeText
      consequence = config.consequence
      actionLabel = config.actionLabel
    }
  }

  let bottomSection = ''
  let pendingDamage = null
  let pendingAction = null

  const damageAmount = resolveScaledAmount(config.damageAmount ?? 'margin', marginAgainstResistor)

  if (consequence === 'damage' && resistorToken && damageAmount > 0) {
    const mode = getStepSetting('damageApplication', resistorActor)
    const willAutoApply = mode === 'auto'
    const severityConfig = (casterCritWin && config.damageSeverityCritWin) ? config.damageSeverityCritWin : config.damageSeverity
    const severity = resolveDamageSeverity(severityConfig, resistorActor)

    if (willAutoApply) {
      const applyFn = config.damageTrack === 'willpower' ? applyWillpowerDamageToTarget : applyDamageToTarget
      await applyFn(resistorToken, damageAmount, severity)
    } else {
      pendingDamage = { actorId: resistorActor.id, amount: damageAmount, controllingUserId: resistorUserId, track: config.damageTrack, severity }
    }

    bottomSection = `
      <div class="vtm5e-automation-recap-damage">
        <div class="vtm5e-automation-recap-damage-amount">${damageAmount}</div>
        <div class="vtm5e-automation-recap-damage-label">${severity === 'aggravated' ? 'Aggravated' : 'Superficial'} Damage - ${config.damageTrack === 'willpower' ? 'Willpower' : 'Health'}</div>
      </div>
    `
  } else if (consequence === 'action' && resistorActor) {
    // Always a generic test (a frenzy roll, or whatever else a GM types into
    // actionLabel) with no real item behind it - wod5e's own frenzy dialog
    // isn't part of the documented API, so there's no way to auto-roll this
    // regardless of the Follow-Up Roll setting. Auto therefore behaves
    // exactly like Prompt here (show the button); only Off suppresses it.
    if (getStepSetting('followUpRoll', resistorActor) !== 'off') {
      pendingAction = { actorId: resistorActor.id, controllingUserId: resistorUserId, label: actionLabel }
    }
  } else if (consequence === 'frenzy' && resistorActor) {
    // Distinct from 'action' - this is for powers whose text says the
    // target enters frenzy AS THE OUTCOME of THIS roll (no further roll to
    // send them to their sheet for), e.g. Drawing Out the Beast explicitly
    // substitutes for the Willpower roll to resist frenzy rather than
    // triggering a separate one. wod5e's own frenzy-roll.js does nothing
    // more exotic than actor.update({'system.frenzyActive': true}) on a
    // failed resistance/give-in, so replicating that one field directly is
    // safe - it's not reaching into a dialog-driven internal, just setting
    // the same actor property wod5e's own code sets.
    await resistorActor.update({ 'system.frenzyActive': true })
    bottomSection = `<p class="vtm5e-automation-recap-frenzy">${resistorActor.name} Enters Frenzy</p>`
  } else if (consequence === 'status' && resistorActor) {
    // See condition-application.js - a real, visible, GM-editable condition
    // item, not just a text note. statusNote is the config's default; if
    // left blank a generic "GM: describe this" placeholder goes in instead,
    // since the actual specifics (what memory got erased, what exactly
    // happened) are something only the GM knows in the moment, not
    // something this module can generate - the note is meant to be edited
    // afterward via the condition item's own sheet, same as any other item.
    const name = config.statusName || powerName
    const note = config.statusNote || '<p><em>GM: describe what this did.</em></p>'
    await applyStatusCondition(resistorActor, { name, note })
    bottomSection = `<p class="vtm5e-automation-recap-frenzy">${resistorActor.name}: ${name} Applied</p>`
  } else if (consequence === 'hunger' && resistorActor) {
    const amountConfig = (casterCritWin && config.hungerAmountCritWin !== '' && config.hungerAmountCritWin != null)
      ? config.hungerAmountCritWin
      : config.hungerAmount
    const applied = await applyHungerChange(resistorActor, resolveScaledAmount(amountConfig, marginAgainstResistor))
    if (applied) bottomSection = `<p class="vtm5e-automation-recap-hunger">${resistorActor.name} Hunger +${applied}</p>`
  }

  // Fires ALONGSIDE the primary consequence above (not instead of it) - see
  // the comment on DEFAULT_RESISTANCE_CONFIG.vampireBonus for why this is
  // separate from the main consequence field.
  if (!resistorWon && config.vampireBonus?.type && resistorActor?.system?.gamesystem === 'vampire') {
    if (config.vampireBonus.type === 'hunger') {
      const applied = await applyHungerChange(resistorActor, resolveScaledAmount(config.vampireBonus.amount, marginAgainstResistor))
      if (applied) bottomSection += `<p class="vtm5e-automation-recap-hunger">${resistorActor.name} Hunger +${applied} (vampire)</p>`
    } else if (config.vampireBonus.type === 'reminder') {
      bottomSection += `<p class="vtm5e-automation-recap-narrative"><b>Reminder:</b> ${config.vampireBonus.label}</p>`
    } else if (config.vampireBonus.type === 'chainedContest' && casterActor) {
      // Real roll-chaining (Baal's Caress's second, Torpor-forcing contest)
      // rather than just a text reminder - registers the chain (see
      // pendingChainedContests up top) and re-targets the same resistor,
      // then either rolls it immediately (Follow-Up Roll: Auto - a
      // DEFINITIVE pool, since this is a real power item the caster already
      // owns) or shows a button for the caster to click themselves
      // (Prompt). Either way the caster's own roll still goes through
      // wod5e's real confirm dialog - Auto only skips OUR "go find the
      // button" step, never their review of the roll itself.
      const resistorTokenId = resistorActor.getActiveTokens()[0]?.id
      const label = config.vampireBonus.label ?? `Roll ${powerName} again (follow-up contest)`
      const chainSetup = {
        chainKey: `${casterActor.id}:${resistorActor.id}:${powerName}`,
        resistorTokenId,
        powerName,
        overrideConfig: {
          ...config,
          consequence: config.vampireBonus.consequence,
          statusName: config.vampireBonus.statusName,
          statusNote: config.vampireBonus.statusNote,
          damageTrack: config.vampireBonus.damageTrack,
          damageSeverity: config.vampireBonus.damageSeverity,
          // No further chaining or vampire-only secondary effects off of
          // the chained roll itself - it resolves once, on its own.
          vampireBonus: null,
          resistorWinConsequence: 'none',
          multiTier: false
        }
      }

      const followUpMode = getStepSetting('followUpRoll', casterActor)
      if (followUpMode === 'off') {
        // No button, no auto-roll - the reminder line below is all that
        // shows; fully manual from here.
      } else if (followUpMode === 'auto') {
        // Safe to trigger inline here (not from a click) because
        // postResistanceCard only ever runs on the CASTER's own client -
        // see pendingResistanceRolls' comment up top - which is the same
        // client the roll dialog needs to open on.
        const rolled = await triggerChainedRoll(casterActor, chainSetup)
        if (!rolled) pendingAction = { actorId: casterActor.id, controllingUserId: casterUserId, label, chainSetup }
      } else {
        pendingAction = { actorId: casterActor.id, controllingUserId: casterUserId, label, chainSetup }
      }

      bottomSection += `<p class="vtm5e-automation-recap-narrative"><b>Follow-up available:</b> ${label}</p>`
    }
  }

  // Resistor WINNING can also carry a consequence for the CASTER - separate
  // from every tier above, which only ever describe a caster win.
  if (resistorWon && config.resistorWinConsequence === 'action' && casterActor) {
    // Same as the resistor-side 'action' branch above - always a generic,
    // itemless test, so Auto falls back to showing the button same as
    // Prompt; only Off suppresses it.
    if (getStepSetting('followUpRoll', casterActor) !== 'off') {
      pendingAction = { actorId: casterActor.id, controllingUserId: casterUserId, label: config.resistorWinActionLabel }
    }
  } else if (resistorWon && config.resistorWinConsequence === 'frenzy' && casterActor) {
    await casterActor.update({ 'system.frenzyActive': true })
    bottomSection = `<p class="vtm5e-automation-recap-frenzy">${casterActor.name} Enters Frenzy</p>`
  } else if (resistorWon && config.resistorWinConsequence === 'status' && casterActor) {
    const name = config.resistorWinStatusName || powerName
    const note = config.resistorWinStatusNote || '<p><em>GM: describe what this did.</em></p>'
    await applyStatusCondition(casterActor, { name, note })
    bottomSection = `<p class="vtm5e-automation-recap-frenzy">${casterActor.name}: ${name} Applied</p>`
  }

  // Only ever "Resisted" or "Failed Resist" - there's no such thing as a
  // critical FAIL in this system (criticals only ever apply to a win), so a
  // caster's critical win against a losing resistor gets its own separate
  // badge below rather than being folded into the outcome heading itself
  // (which previously read "Failed Resist - Critical" - misleadingly
  // implying the resist roll itself critically failed, rather than what
  // actually happened: the CASTER critically won against it).
  const outcomeLabel = resistorWon ? 'Resisted' : 'Failed Resist'

  // {margin} in any narrative field gets replaced with the actual computed
  // number - e.g. Scry the Soul's text can say "answer up to {margin}
  // questions" and players see the real count immediately instead of having
  // to do the subtraction themselves. Applied after the multiTier tier
  // selection above, so it works on whichever text actually got picked.
  narrativeText = interpolateNarrative(narrativeText, marginAgainstResistor)

  const content = `
    <div class="vtm5e-automation-recap">
      <p class="vtm5e-automation-recap-title">${powerName}</p>
      <p class="vtm5e-automation-recap-name">${casterName}: ${casterTotal} successes</p>
      <p class="vtm5e-automation-recap-name">${resistorName}: ${resistorTotal} successes</p>
      <p class="vtm5e-automation-recap-outcome ${resistorWon ? 'resisted' : 'failed'}">${outcomeLabel}</p>
      ${casterCritWin ? `<p class="vtm5e-automation-recap-critical">${casterName} - Critical Win</p>` : ''}
      <p class="vtm5e-automation-recap-result">${resultLine}</p>
      ${narrativeText ? `<p class="vtm5e-automation-recap-narrative">${narrativeText}</p>` : ''}
      ${bottomSection}
    </div>
  `

  await ChatMessage.create({
    content,
    flags: { [MODULE_ID]: { sourceMessageIds, pendingDamage, pendingAction } }
  })
}

function buildResistanceConfigSection(item) {
  const config = { ...DEFAULT_RESISTANCE_CONFIG, ...(item.getFlag(MODULE_ID, 'resistance') ?? {}) }
  const attributeOptions = WOD5E.Attributes.getList({})
  const skillOptions = WOD5E.Skills.getList({})

  const section = document.createElement('fieldset')
  section.classList.add('vtm5e-automation-resistance-config')

  const legend = document.createElement('legend')
  legend.textContent = 'Automated Resistance (vtm5e-automation)'
  section.appendChild(legend)

  section.innerHTML += `
    <div class="form-group">
      <label><input type="checkbox" name="enabled" ${config.enabled ? 'checked' : ''} /> Enable automated resistance for this power</label>
    </div>
    <div class="form-group">
      <label><input type="checkbox" name="resistWithWillpower" ${config.resistWithWillpower ? 'checked' : ''} /> Resist with raw Willpower points instead of a dice pool</label>
    </div>
    <div class="form-group vtm5e-automation-pool-fields" ${config.resistWithWillpower ? 'style="display:none"' : ''}>
      <label>Resistance Pool</label>
      <select name="attribute">${buildOptionTags(attributeOptions, config.attribute)}</select>
      +
      <select name="secondComponent">
        <optgroup label="Attributes">${buildOptionTags(attributeOptions, config.secondType === 'attribute' ? config.secondKey : null)}</optgroup>
        <optgroup label="Skills">${buildOptionTags(skillOptions, config.secondType === 'skill' ? config.secondKey : null)}</optgroup>
      </select>
    </div>
    <div class="form-group">
      <label>Resolution</label>
      <select name="mode">
        <option value="opposed" ${config.mode === 'opposed' ? 'selected' : ''}>Opposed (vs caster's roll)</option>
        <option value="difficulty" ${config.mode === 'difficulty' ? 'selected' : ''}>Static Difficulty</option>
      </select>
    </div>
    <div class="form-group vtm5e-automation-difficulty-fields" ${config.mode === 'difficulty' ? '' : 'style="display:none"'}>
      <label><input type="checkbox" name="useCasterRating" ${config.useCasterRating ? 'checked' : ''} /> Use caster's dots in this Discipline as the Difficulty</label>
      <label>Fixed Difficulty <input type="number" name="fixedDifficulty" value="${config.fixedDifficulty}" min="0" ${config.useCasterRating ? 'disabled' : ''} /></label>
    </div>
    <div class="form-group">
      <label><input type="checkbox" name="multiTier" ${config.multiTier ? 'checked' : ''} /> Three-way outcome (Failure / Win / Critical Win), not just win-or-lose</label>
    </div>
    <div class="form-group vtm5e-automation-nontier-fields" ${config.multiTier ? 'style="display:none"' : ''}>
      <label>What happens (shown in chat, always)</label>
      <textarea name="narrativeText" rows="2">${config.narrativeText}</textarea>
    </div>
    <div class="form-group vtm5e-automation-nontier-fields" ${config.multiTier ? 'style="display:none"' : ''}>
      <label>On a caster win</label>
      <select name="consequence">
        <option value="none" ${config.consequence === 'none' ? 'selected' : ''}>Nothing further (narrative only)</option>
        <option value="damage" ${config.consequence === 'damage' ? 'selected' : ''}>Deal damage (margin/shortfall)</option>
        <option value="action" ${config.consequence === 'action' ? 'selected' : ''}>Prompt a follow-up test (a real separate roll)</option>
        <option value="frenzy" ${config.consequence === 'frenzy' ? 'selected' : ''}>Force into frenzy immediately (no further roll)</option>
        <option value="status" ${config.consequence === 'status' ? 'selected' : ''}>Apply a status condition to the target</option>
        <option value="hunger" ${config.consequence === 'hunger' ? 'selected' : ''}>Raise the target's Hunger</option>
      </select>
    </div>
    <div class="form-group vtm5e-automation-tier-fields" ${config.multiTier ? '' : 'style="display:none"'}>
      <label>Failure text (resistor wins)</label>
      <textarea name="narrativeTextFail" rows="2">${config.narrativeTextFail}</textarea>
      <label>Win text (caster wins, no critical)</label>
      <textarea name="narrativeText" rows="2">${config.narrativeText}</textarea>
      <label>On a plain win</label>
      <select name="tierConsequence">
        <option value="none" ${config.consequence === 'none' ? 'selected' : ''}>Nothing further (narrative only)</option>
        <option value="action" ${config.consequence === 'action' ? 'selected' : ''}>Prompt a follow-up test</option>
      </select>
      <p class="hint">Multi-tier powers don't currently support a "deal damage" outcome - none of the ones this covers need it. Switch off multi-tier if a power needs both.</p>
      <label>Critical Win text (caster wins with a pair of 10s)</label>
      <textarea name="narrativeTextCritWin" rows="2">${config.narrativeTextCritWin}</textarea>
      <label>On a critical win</label>
      <select name="critWinConsequence">
        <option value="none" ${config.critWinConsequence === 'none' ? 'selected' : ''}>Nothing further (narrative only)</option>
        <option value="action" ${config.critWinConsequence === 'action' ? 'selected' : ''}>Prompt a follow-up test</option>
      </select>
      <div class="vtm5e-automation-critaction-fields" ${config.critWinConsequence === 'action' ? '' : 'style="display:none"'}>
        <label>Critical Win Follow-up Button Label</label>
        <input type="text" name="critWinActionLabel" value="${config.critWinActionLabel}" />
      </div>
    </div>
    <div class="form-group vtm5e-automation-damage-fields" ${config.consequence === 'damage' && !config.multiTier ? '' : 'style="display:none"'}>
      <label>Damage Track</label>
      <select name="damageTrack">
        <option value="health" ${config.damageTrack === 'health' ? 'selected' : ''}>Health</option>
        <option value="willpower" ${config.damageTrack === 'willpower' ? 'selected' : ''}>Willpower</option>
      </select>
      <label>Damage Severity</label>
      <select name="damageSeverity">
        <option value="superficial" ${config.damageSeverity === 'superficial' ? 'selected' : ''}>Superficial</option>
        <option value="aggravated" ${config.damageSeverity === 'aggravated' ? 'selected' : ''}>Aggravated</option>
        <option value="aggravated-mortal-only" ${config.damageSeverity === 'aggravated-mortal-only' ? 'selected' : ''}>Aggravated to mortals, Superficial to vampires</option>
      </select>
    </div>
    <div class="form-group vtm5e-automation-action-fields" ${config.consequence === 'action' ? '' : 'style="display:none"'}>
      <label>Follow-up Button Label (used for both the plain non-tier case and multi-tier's "plain win" tier)</label>
      <input type="text" name="actionLabel" value="${config.actionLabel}" />
    </div>
    <div class="form-group vtm5e-automation-status-fields" ${config.consequence === 'status' ? '' : 'style="display:none"'}>
      <label>Status Name (shown as the condition's name on the sheet)</label>
      <input type="text" name="statusName" value="${config.statusName}" placeholder="${item.name}" />
      <label>Default Note (the GM can edit this later on the condition item itself)</label>
      <textarea name="statusNote" rows="2" placeholder="GM: describe what this did.">${config.statusNote}</textarea>
    </div>
    <div class="form-group vtm5e-automation-hunger-fields" ${config.consequence === 'hunger' ? '' : 'style="display:none"'}>
      <label>Hunger to add on a plain win</label>
      <input type="text" name="hungerAmount" value="${config.hungerAmount}" placeholder="a number, or 'margin'" />
      <label>Hunger to add on a Critical Win (blank = same as above)</label>
      <input type="text" name="hungerAmountCritWin" value="${config.hungerAmountCritWin}" placeholder="a number, or 'margin'" />
    </div>
    <div class="form-group">
      <label>If the resistor WINS, what happens to the caster?</label>
      <select name="resistorWinConsequence">
        <option value="none" ${config.resistorWinConsequence === 'none' ? 'selected' : ''}>Nothing (the attempt just fails)</option>
        <option value="action" ${config.resistorWinConsequence === 'action' ? 'selected' : ''}>Prompt the caster with a follow-up test (a real separate roll)</option>
        <option value="frenzy" ${config.resistorWinConsequence === 'frenzy' ? 'selected' : ''}>Force the caster into frenzy immediately (no further roll)</option>
        <option value="status" ${config.resistorWinConsequence === 'status' ? 'selected' : ''}>Apply a status condition to the caster</option>
      </select>
    </div>
    <div class="form-group vtm5e-automation-resistorwin-fields" ${config.resistorWinConsequence === 'action' ? '' : 'style="display:none"'}>
      <label>Caster's Follow-up Button Label</label>
      <input type="text" name="resistorWinActionLabel" value="${config.resistorWinActionLabel}" />
    </div>
    <div class="form-group vtm5e-automation-resistorwin-status-fields" ${config.resistorWinConsequence === 'status' ? '' : 'style="display:none"'}>
      <label>Caster's Status Name</label>
      <input type="text" name="resistorWinStatusName" value="${config.resistorWinStatusName}" placeholder="${item.name}" />
      <label>Caster's Default Note</label>
      <textarea name="resistorWinStatusNote" rows="2" placeholder="GM: describe what this did.">${config.resistorWinStatusNote}</textarea>
    </div>
  `

  section.addEventListener('change', async (event) => {
    const form = section
    const secondSelect = form.querySelector('[name="secondComponent"]')
    const secondType = secondSelect.selectedOptions[0]?.closest('optgroup')?.label === 'Skills' ? 'skill' : 'attribute'

    const mode = form.querySelector('[name="mode"]').value
    const useCasterRating = form.querySelector('[name="useCasterRating"]').checked
    const resistWithWillpower = form.querySelector('[name="resistWithWillpower"]').checked
    const multiTier = form.querySelector('[name="multiTier"]').checked
    // Two independent selects share the same underlying "consequence"
    // meaning (plain-shape vs multiTier's "on a plain win") but must have
    // different name attributes - reusing "consequence" for both meant
    // querySelectorAll returned two elements with no reliable way to tell
    // which one the user actually meant to change.
    const consequence = multiTier
      ? form.querySelector('[name="tierConsequence"]').value
      : form.querySelector('[name="consequence"]').value
    const critWinConsequence = form.querySelector('[name="critWinConsequence"]').value
    const resistorWinConsequence = form.querySelector('[name="resistorWinConsequence"]').value

    form.querySelector('.vtm5e-automation-pool-fields').style.display = resistWithWillpower ? 'none' : ''
    form.querySelector('.vtm5e-automation-difficulty-fields').style.display = mode === 'difficulty' ? '' : 'none'
    form.querySelectorAll('.vtm5e-automation-nontier-fields').forEach((el) => { el.style.display = multiTier ? 'none' : '' })
    form.querySelector('.vtm5e-automation-tier-fields').style.display = multiTier ? '' : 'none'
    form.querySelector('.vtm5e-automation-damage-fields').style.display = (consequence === 'damage' && !multiTier) ? '' : 'none'
    form.querySelector('.vtm5e-automation-action-fields').style.display = consequence === 'action' ? '' : 'none'
    form.querySelector('.vtm5e-automation-status-fields').style.display = consequence === 'status' ? '' : 'none'
    form.querySelector('.vtm5e-automation-hunger-fields').style.display = consequence === 'hunger' ? '' : 'none'
    form.querySelector('.vtm5e-automation-critaction-fields').style.display = critWinConsequence === 'action' ? '' : 'none'
    form.querySelector('.vtm5e-automation-resistorwin-fields').style.display = resistorWinConsequence === 'action' ? '' : 'none'
    form.querySelector('.vtm5e-automation-resistorwin-status-fields').style.display = resistorWinConsequence === 'status' ? '' : 'none'
    form.querySelector('[name="fixedDifficulty"]').disabled = useCasterRating

    const newConfig = {
      enabled: form.querySelector('[name="enabled"]').checked,
      attribute: form.querySelector('[name="attribute"]').value,
      secondKey: secondSelect.value,
      secondType,
      resistWithWillpower,
      mode,
      fixedDifficulty: parseInt(form.querySelector('[name="fixedDifficulty"]').value) || 0,
      useCasterRating,
      multiTier,
      narrativeText: form.querySelector('[name="narrativeText"]').value,
      narrativeTextFail: form.querySelector('[name="narrativeTextFail"]').value,
      narrativeTextCritWin: form.querySelector('[name="narrativeTextCritWin"]').value,
      consequence,
      critWinConsequence,
      damageTrack: form.querySelector('[name="damageTrack"]').value,
      damageSeverity: form.querySelector('[name="damageSeverity"]').value,
      actionLabel: form.querySelector('[name="actionLabel"]').value || 'Roll Follow-Up Test',
      critWinActionLabel: form.querySelector('[name="critWinActionLabel"]').value || 'Roll Follow-Up Test',
      statusName: form.querySelector('[name="statusName"]').value,
      statusNote: form.querySelector('[name="statusNote"]').value,
      hungerAmount: form.querySelector('[name="hungerAmount"]').value || 1,
      hungerAmountCritWin: form.querySelector('[name="hungerAmountCritWin"]').value,
      resistorWinConsequence,
      resistorWinActionLabel: form.querySelector('[name="resistorWinActionLabel"]').value || 'Roll Follow-Up Test',
      resistorWinStatusName: form.querySelector('[name="resistorWinStatusName"]').value,
      resistorWinStatusNote: form.querySelector('[name="resistorWinStatusNote"]').value,
      // vampireBonus, damageAmount, and damageSeverityCritWin aren't exposed
      // in this UI yet (script/flag-only) - preserve whatever's already on
      // the item rather than silently wiping it out the next time someone
      // touches this form.
      vampireBonus: config.vampireBonus ?? null,
      damageAmount: config.damageAmount ?? 'margin',
      damageSeverityCritWin: config.damageSeverityCritWin ?? ''
    }

    await item.setFlag(MODULE_ID, 'resistance', newConfig)
    event.stopPropagation()
  })

  return section
}

function buildOptionTags(options, selectedKey) {
  return Object.entries(options)
    .map(([key, value]) => `<option value="${key}" ${key === selectedKey ? 'selected' : ''}>${game.i18n.localize(value.label ?? key)}</option>`)
    .join('')
}
