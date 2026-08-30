// V5 corebook "TRAIT COSTS: EXPERIENCE" (p.137), transcribed directly from
// the sourcebook PDF, not from memory:
//   Attribute            new level x 5
//   Skill                 new level x 3
//   Specialty              3 (flat)
//   Clan Discipline       new level x 5
//   Other Discipline      new level x 7
//   Caitiff Discipline    new level x 6
//   Blood Potency         new level x 10
//   Advantage             3 per dot
// No Humanity purchase exists in this table - deliberately not modeled.

export const SPECIALTY_COST = 3
export const ADVANTAGE_COST_PER_DOT = 3

export const ATTRIBUTE_MULTIPLIER = 5
export const SKILL_MULTIPLIER = 3
export const BLOOD_POTENCY_MULTIPLIER = 10

export const DISCIPLINE_MULTIPLIER = {
  clan: 5,
  other: 7,
  caitiff: 6
}

// Sums the cost of every intermediate level, not just (target-current) x
// multiplier - V5 charges for each dot you pass through. E.g. raising
// Strength 2->4 costs (3x5) + (4x5) = 35, not (4-2)x5 = 10.
export function costForRaise (currentLevel, targetLevel, perLevelMultiplier) {
  let total = 0
  for (let level = currentLevel + 1; level <= targetLevel; level++) {
    total += level * perLevelMultiplier
  }
  return total
}
