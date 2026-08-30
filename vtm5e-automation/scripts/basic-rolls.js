import { splitAdvancedDice } from './roll-utils.js'

/**
 * Plain Attribute+Skill pool roll with no Item behind it - for the Argon
 * HUD's Actions panel (Investigate/Lock Picking/Force Door/Unarmed Strike),
 * pools wod5e has no rollable Item for. Same WOD5E.api.Roll shape
 * repair.js's Dexterity+Craft roll uses, but quickRoll is left unset so the
 * player sees wod5e's own roll dialog (difficulty, Hunger, situational
 * mods) exactly like clicking a skill on the sheet would - no custom
 * GM-prompt plumbing needed.
 */
export async function rollBasicPool(actor, { valuePaths, title }) {
  const basicDiceRaw = await WOD5E.api.getBasicDice({ valuePaths, flatMod: 0, actor })
  const advancedDiceRaw = await WOD5E.api.getAdvancedDice({ actor })
  const { basicDice, advancedDice } = splitAdvancedDice(basicDiceRaw, advancedDiceRaw, actor)

  await WOD5E.api.Roll({ basicDice, advancedDice, actor, data: actor.system, title })
}
