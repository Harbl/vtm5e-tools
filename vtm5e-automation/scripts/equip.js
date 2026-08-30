// "Worn" equip picker (2026-07-24, Jake's call, Pathfinder-module-inspired) -
// a button on the actor sheet (see weapon-tags.js's bindEquipInterception)
// that opens a small menu of valid slots for that item's type and remembers
// which one it's in. Weapons get three slots (2026-07-28: split from one
// undifferentiated "Hands" slot into Left/Right/Both, so a two-handed
// weapon's -2 one-handed penalty in weapon-tags.js's rollWeaponAttack can be
// derived from real equip state instead of a manually-toggled checkbox, and
// dual-wielding two one-handed weapons is actually representable). Armor
// keeps its two distinct slots, both worn at once for real tactical
// layering (see damage-application.js's equippedArmorLayers, which is the
// whole reason this exists rather than the old flat boolean `equipped` flag
// armor items used before this).
//
// One item per slot per actor - equipping a NEW item into an already-
// occupied slot silently un-equips whatever was there, matching the
// interaction Jake asked for ("will unselect whatever was in that slot
// already"). Both Hands and either single hand slot are mutually exclusive
// (see openEquipMenu below) - claiming Both clears Left and Right, claiming
// either hand clears Both.

const MODULE_ID = 'vtm5e-automation'

export const SLOT_OPTIONS_BY_TYPE = {
  weapon: [
    { key: 'handLeft', label: 'Left Hand', icon: 'fa-hand-fist' },
    { key: 'handRight', label: 'Right Hand', icon: 'fa-hand-fist' },
    { key: 'handBoth', label: 'Both Hands', icon: 'fa-hands' }
  ],
  armor: [
    { key: 'underarmor', label: 'Underarmor', icon: 'fa-shirt' },
    { key: 'bodyArmor', label: 'Body Armor', icon: 'fa-vest' }
  ]
}

// A Two-Handed-tagged weapon (weapon-tags.js's `twoHanded` tag) can only
// ever go in handBoth - offering Left/Right for it would just recreate the
// exact "claims one hand, doesn't tell anyone it needs the other" gap this
// rewrite exists to close.
function slotOptionsFor (item) {
  const options = SLOT_OPTIONS_BY_TYPE[item?.type]
  if (!options) return null
  if (item.type !== 'weapon') return options

  const isTwoHanded = !!item.getFlag(MODULE_ID, 'weaponTags')?.twoHanded
  return isTwoHanded ? options.filter((o) => o.key === 'handBoth') : options.filter((o) => o.key !== 'handBoth')
}

const HAND_SLOTS = new Set(['handLeft', 'handRight', 'handBoth'])

export function equippedSlotFor (item) {
  return item?.getFlag(MODULE_ID, 'equippedSlot') ?? null
}

export function slotLabel (itemType, key) {
  return SLOT_OPTIONS_BY_TYPE[itemType]?.find((o) => o.key === key)?.label ?? key
}

export function slotIcon (itemType, key) {
  return SLOT_OPTIONS_BY_TYPE[itemType]?.find((o) => o.key === key)?.icon
}

/**
 * Opens the slot picker for a weapon or armor item and applies the choice -
 * no-op for any other item type (nothing to equip). Auto-unequips whatever
 * else on this actor currently holds the chosen slot before claiming it, so
 * "one item per slot" is always true without the player having to manually
 * unequip the old occupant first.
 */
export async function openEquipMenu (actor, item) {
  const options = slotOptionsFor(item)
  if (!actor || !item || !options) return

  const currentSlot = equippedSlotFor(item)

  const buttons = options.map((opt) => ({
    action: opt.key,
    icon: `fas ${opt.icon}`,
    label: currentSlot === opt.key ? `${opt.label} (current)` : opt.label,
    default: currentSlot === opt.key,
    callback: () => opt.key
  }))

  if (currentSlot) {
    buttons.push({ action: 'unequip', icon: 'fas fa-xmark', label: 'Unequip', callback: () => 'UNEQUIP' })
  }
  buttons.push({ action: 'cancel', icon: 'fas fa-ban', label: 'Cancel', callback: () => 'CANCEL' })

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Equip ${item.name}` },
    content: `<p>${currentSlot ? `Currently worn: <b>${slotLabel(item.type, currentSlot)}</b>.` : 'Not currently worn.'}</p>`,
    buttons,
    classes: ['wod5e']
  })

  if (!result || result === 'CANCEL') return

  if (result === 'UNEQUIP') {
    await item.unsetFlag(MODULE_ID, 'equippedSlot')
    return
  }

  // Same-slot swap (existing rule) PLUS the Both/single-hand exclusivity:
  // claiming Both bumps whatever's in either single hand, claiming either
  // hand bumps whatever's occupying Both.
  const conflicting = actor.items.filter((i) => {
    if (i.id === item.id) return false
    const slot = equippedSlotFor(i)
    if (!slot) return false
    if (slot === result) return true
    return HAND_SLOTS.has(result) && HAND_SLOTS.has(slot) && (result === 'handBoth' || slot === 'handBoth')
  })
  for (const other of conflicting) await other.unsetFlag(MODULE_ID, 'equippedSlot')
  await item.setFlag(MODULE_ID, 'equippedSlot', result)
}
