import { isPlayerControlled } from './socket-routing.js'
import { AutomationSettingsApp } from './automation-settings-app.js'

const MODULE_ID = 'vtm5e-automation'
const SETTING_KEY = 'automationConfig'

// Each step here maps to an actual enforcement point in the code - kept in
// sync manually. attackRollAutomation existed in the old flat-setting design
// but was never wired to anything, so it was dropped rather than carried
// into a nicer UI implying it does something it doesn't.
export const STEPS = {
  opposingRoll: {
    label: 'Opposing Roll',
    hint: 'Weapon defense (Dodge/custom pool). Auto resolves with no dialog (Dexterity + Athletics). Prompt shows the interactive picker. Off skips the opposed step entirely (weapon hits land raw). Social Conflict is not automated - the GM runs opposed social rolls manually using wod5e\'s own Roll Prompt feature.',
    choices: { auto: 'Auto', prompt: 'Prompt', off: 'Off' }
  },
  damageApplication: {
    label: 'Damage Application',
    hint: 'Auto applies Health/Willpower damage the instant a roll resolves. Prompt shows Superficial/Aggravated buttons and waits for a click.',
    choices: { auto: 'Auto', prompt: 'Prompt' }
  },
  followUpRoll: {
    label: 'Follow-Up Roll',
    hint: 'The second roll some Discipline effects and Wards prompt for after the first result comes in - a forced frenzy test, Baal\'s Caress\'s second Torpor contest, a Ward\'s "Roll to Defend" prompt, and similar. Auto skips straight to rolling when a real power/item backs the roll (a known dice pool, e.g. Baal\'s Caress or a Ward) - otherwise (a generic test like a frenzy roll, which has no externally triggerable dialog) it falls back to Prompt automatically, same as if Prompt were selected. Prompt shows a button to click. Off skips offering the follow-up roll entirely - any narrative text still shows, but nothing further happens automatically.',
    choices: { auto: 'Auto', prompt: 'Prompt', off: 'Off' }
  }
}

export const DEFAULT_CONFIG = {
  npc: { opposingRoll: 'prompt', damageApplication: 'prompt', followUpRoll: 'prompt' },
  player: { opposingRoll: 'prompt', damageApplication: 'prompt', followUpRoll: 'prompt' }
}

export const PRESETS = {
  promptEverything: {
    label: 'Prompt Everything',
    hint: 'Every step waits for a click, for both NPCs and players - today\'s fully manual behavior.',
    config: {
      npc: { opposingRoll: 'prompt', damageApplication: 'prompt', followUpRoll: 'prompt' },
      player: { opposingRoll: 'prompt', damageApplication: 'prompt', followUpRoll: 'prompt' }
    }
  },
  fullAutomation: {
    label: 'Full Automation',
    hint: 'Every step resolves automatically, for both NPCs and players - no clicks at all (Follow-Up Roll still prompts wherever there\'s no definitive dice pool to roll on its own).',
    config: {
      npc: { opposingRoll: 'auto', damageApplication: 'auto', followUpRoll: 'auto' },
      player: { opposingRoll: 'auto', damageApplication: 'auto', followUpRoll: 'auto' }
    }
  },
  automatedDamageOnly: {
    label: 'Automated Damage Only',
    hint: 'Rolls stay manual/prompted, but damage applies automatically once a roll resolves.',
    config: {
      npc: { opposingRoll: 'prompt', damageApplication: 'auto', followUpRoll: 'prompt' },
      player: { opposingRoll: 'prompt', damageApplication: 'auto', followUpRoll: 'prompt' }
    }
  }
}

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_KEY, {
    scope: 'world',
    config: false,
    type: Object,
    default: DEFAULT_CONFIG
  })

  game.settings.registerMenu(MODULE_ID, 'automationConfigMenu', {
    name: 'Automation Settings',
    label: 'Configure Automation',
    hint: 'Per-step automation levels, separately for NPCs and Players, plus quick presets.',
    icon: 'fas fa-sliders-h',
    type: AutomationSettingsApp,
    restricted: true
  })
}

/**
 * Full config object, defensively merged with defaults so a partial/stale
 * stored value (e.g. from before a step was added) doesn't produce
 * undefined lookups.
 */
export function getAutomationConfig() {
  const stored = game.settings.get(MODULE_ID, SETTING_KEY) ?? {}
  return {
    npc: { ...DEFAULT_CONFIG.npc, ...stored.npc },
    player: { ...DEFAULT_CONFIG.player, ...stored.player }
  }
}

export async function setAutomationConfig(config) {
  await game.settings.set(MODULE_ID, SETTING_KEY, config)
}

/**
 * The actual lookup used throughout the module: given a step name and the
 * actor whose side of the roll this step governs (the defender for
 * opposingRoll, the actor taking damage for damageApplication), returns
 * that step's configured level for whichever bucket (npc/player) actually
 * applies to that actor right now.
 */
export function getStepSetting(step, actor) {
  const config = getAutomationConfig()
  const bucket = actor && isPlayerControlled(actor) ? config.player : config.npc
  return bucket[step]
}
