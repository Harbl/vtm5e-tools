/**
 * Compulsions (VtM5e corebook, "Compulsions" p. 208): when a vampire
 * suffers a Bestial Failure, the Storyteller picks or randomly rolls one
 * from a 1d10 table. Text below is transcribed from the corebook.
 */
const GENERIC_COMPULSIONS = {
  hunger: {
    name: 'Hunger',
    text: 'The vampire will do anything to slake their Hunger, whether that means violence, subterfuge, or outright begging. Any action not immediately conducive to feeding takes a two-dice penalty. Ends when the vampire slakes at least 1 Hunger.'
  },
  dominance: {
    name: 'Dominance',
    text: 'The vampire makes their next interaction a competition, using all means at their disposal to end up victorious - they cannot use teamwork. Any action that avoids establishing dominance or challenging authority takes a two-dice penalty. Ends once the vampire has "won" and gloated over it.'
  },
  harm: {
    name: 'Harm',
    text: 'The Hunger compels the vampire to hurt and destroy - not to feed or to win, but for the sole sake of causing harm. Any action not immediately resulting in someone or something getting harmed takes a two-dice penalty. Ends when the vampire incapacitates, destroys, or drives away a target.'
  },
  paranoia: {
    name: 'Paranoia',
    text: 'The vampire tries to disengage from any perceived threat, suspecting anyone and anything. Any action not taken toward that end takes a two-dice penalty. Ends after roughly an hour spent in a safe, secure spot.'
  }
}

// Clan Compulsions (p. 208-210 of the corebook, plus the 7 clans the
// corebook doesn't cover - see below). Anything still missing (Caitiff,
// thin-blood, any clan not listed here at all) falls back to a generic
// improvise-it prompt.
const CLAN_COMPULSIONS = {
  brujah: {
    name: 'Rebellion',
    text: 'The vampire takes a stand against whatever or whomever they see as the status quo in the situation, whether that\'s their leader, a viewpoint expressed by a potential vessel, or just the task they were supposed to do at the moment. Until they\'ve gone against their orders or expectations, perceived or real, the vampire receives a two-dice penalty to all rolls. This Compulsion ends once they\'ve managed to either make someone change their minds (by force if necessary) or done the opposite of what was expected of them.'
  },
  gangrel: {
    name: 'Feral Impulses',
    text: 'Returning to an animalistic state, the vampire regresses to a point where speech is hard, clothes are uncomfortable, and arguments are best settled with teeth and claws. For one scene, the vampire gains a three-dice penalty to all rolls involving Manipulation and Intelligence. They can only speak in one-word sentences during this time.'
  },
  malkavian: {
    name: 'Delusion',
    text: 'Their extrasensory gifts running wild, the vampire experiences what might be truths or portents, but what others call figments of imagination, dredged up by Hunger. While still functional, the vampire\'s mind and perceptions are skewed. They receive a two-dice penalty to rolls involving Dexterity, Manipulation, Composure, and Wits as well as on rolls to resist terror frenzy, for one scene.'
  },
  nosferatu: {
    name: 'Cryptophilia',
    text: 'The need to know permeates the vampire. They become consumed with a hunger for secrets, to know that which few or no one knows, almost as strong as that for blood. They also refuse to share secrets with others, except in strict trade for greater ones. All actions not spent working toward learning a secret, no matter how big or small, receive a two-dice penalty. The Compulsion ends when the vampire learns a secret big enough to be considered useful. Sharing this secret is optional.'
  },
  toreador: {
    name: 'Obsession',
    text: 'Enraptured by beauty, the vampire becomes temporarily obsessed with a singular gorgeous thing, able to think of nothing else. Pick one feature, such as a person, a song, an artwork, blood spatter, or even a sunrise. Enraptured, the vampire can hardly take their attention from it, and if spoken to, they only talk about that subject. Any other actions receive a two-dice penalty. This Compulsion lasts until they can no longer perceive the beloved object, or the scene ends.'
  },
  tremere: {
    name: 'Perfectionism',
    text: 'Nothing but the best satisfies the vampire. Anything less than exceptional performance instills a profound sense of failure, and they often repeat tasks obsessively to get them "just right." Until the vampire scores a critical win on a Skill roll or the scene ends, the vampire labors under a two-dice penalty to all dice pools. Reduce the penalty to one die for a repeated action, and remove it entirely on a second repeat.'
  },
  ventrue: {
    name: 'Arrogance',
    text: 'The need to rule rears its head in the vampire. They stop at nothing to assume command of a situation. Someone must obey an order from the vampire. Any action not directly associated with leadership receives a two-dice penalty. This Compulsion lasts until an order has been obeyed, though the order must not be supernaturally enforced, such as through Dominate.'
  },

  // Added 2026-07-22 from the Player's Guide (p.12-60) - the 7 clans the
  // corebook's own Clan Compulsions section skips entirely. Keyed by
  // clanName.toLowerCase() exactly as looked up below, so "Banu Haqim"
  // (the only multi-word one) needs its literal space here too - every
  // other key above is safe as a single word purely by coincidence.
  'banu haqim': {
    name: 'Judgment',
    text: 'Compelled to punish anyone (friend or foe) who transgresses against a personal Conviction, by taking their Blood as vengeance. For one scene, must slake at least 1 Hunger from that person. Failing this carries a three-dice penalty to all rolls until satisfied or the scene ends. Feeding on a vampire this way still triggers the Blood Addiction Bane\'s hunger-frenzy test.'
  },
  hecata: {
    name: 'Morbidity',
    text: 'Immediate need to move something from life to death or vice versa - can be a person, object, idea, or conversation. Any action not dedicated to this takes a two-dice penalty. Persists until the vampire kills or revives something, literally or figuratively.'
  },
  lasombra: {
    name: 'Ruthlessness',
    text: 'After failing any action, the vampire is driven to any means necessary to succeed. Two-dice penalty to ALL rolls until a future attempt at the same action succeeds, or the scene ends - the penalty applies to the retry too.'
  },
  ministry: {
    name: 'Transgression',
    text: 'Two-dice penalty to all pools not related to enticing someone (including themselves) to break a Chronicle Tenet or personal Conviction. Causes at least one Stain when achieved, which ends the Compulsion.'
  },
  ravnos: {
    name: 'Tempting Fate',
    text: 'Next time facing a problem, any solution short of the most daring/dangerous gets a two-dice penalty (flashy/risky attempts can get bonus dice instead, Storyteller\'s call). Persists until the problem is solved or further attempts are impossible.'
  },
  salubri: {
    name: 'Affective Empathy',
    text: 'Overwhelmed with empathy for someone\'s personal problem in the scene; two-dice penalty to any action not taken toward mitigating that problem. Persists until the burden is eased, a bigger crisis supersedes it, or the scene ends.'
  },
  tzimisce: {
    name: 'Covetousness',
    text: 'Obsessed with possessing something in the scene - object, property, or person. Two-dice penalty to actions not taken toward acquiring it. Persists until ownership is established (Storyteller\'s call for non-objects) or the object becomes unattainable.'
  }
}

function getClanName(actor) {
  return actor?.items?.find((i) => i.type === 'clan')?.name ?? null
}

/**
 * Roll on the Compulsion table for an actor suffering a Bestial Failure.
 * Clan Compulsion (a roll of 0) looks up the actor's Clan item; Caitiff/
 * clanless actors re-roll automatically, matching the corebook's own
 * "re-roll for Caitiff or thin-blood" note (approximated here as "no Clan
 * item" - true thin-blood detection isn't wired up, a known simplification).
 */
export async function rollCompulsion(actor) {
  const clanName = getClanName(actor)

  let result
  do {
    const roll = await new Roll('1d10').evaluate()
    result = roll.total === 10 ? 0 : roll.total
  } while (result === 0 && !clanName)

  let generic = null
  if (result >= 1 && result <= 3) generic = GENERIC_COMPULSIONS.hunger
  else if (result >= 4 && result <= 5) generic = GENERIC_COMPULSIONS.dominance
  else if (result >= 6 && result <= 7) generic = GENERIC_COMPULSIONS.harm
  else if (result >= 8 && result <= 9) generic = GENERIC_COMPULSIONS.paranoia

  if (generic) {
    await setSheetCompulsion(actor, generic.name)
    return generic
  }

  // result === 0: Clan Compulsion
  const clanCompulsion = CLAN_COMPULSIONS[clanName.toLowerCase()]
  if (clanCompulsion) {
    await setSheetCompulsion(actor, clanCompulsion.name)
    return { name: `${clanName} Clan Compulsion: ${clanCompulsion.name}`, text: clanCompulsion.text }
  }

  // No write-up for this clan (e.g. Caitiff/thin-blood) - nothing matches a
  // sheet picker option, so leave the sheet's Compulsion field alone and
  // let the chat message's improvise prompt stand on its own.
  return {
    name: `${clanName} Clan Compulsion`,
    text: 'This clan doesn\'t have a Compulsion write-up in the corebook - check a sourcebook that covers them, or have the Storyteller improvise one in the spirit of the clan.'
  }
}

// Writes to vtm5e-charactersheet's own flag namespace (the sheet's
// Compulsion picker reads flags.vtm5e-charactersheet.compulsion) - a plain
// cross-module setFlag call needs no import/coupling. Uses just the short
// display name (e.g. "Hunger", "Rebellion"), matching the picker's option
// values exactly (see GENERIC_COMPULSION_NAMES/CLAN_COMPULSION_NAMES in
// vtm5e-charactersheet/scripts/vampire-actor-sheet.js).
async function setSheetCompulsion(actor, name) {
  await actor.setFlag('vtm5e-charactersheet', 'compulsion', name)
}

export function buildCompulsionHTML(compulsion) {
  return `
    <div class="vtm5e-automation-compulsion">
      <p class="vtm5e-automation-compulsion-title">Compulsion: ${compulsion.name}</p>
      <p class="vtm5e-automation-compulsion-text">${compulsion.text}</p>
    </div>
  `
}
