// One private World JournalEntry per player, not a world setting - a
// scope:'world' setting is readable by any client even though only the GM
// can write it, so a shared wishlist setting would leak every player's
// "private" list to everyone. Real per-document ownership (default NONE,
// owner-only OWNER) is what actually keeps this private at the Foundry
// server level, not just hidden in the DOM - same idea as vtm5e-domainmap's
// ensureContactJournal, but privacy-gated instead of shared-open.
//
// Created directly from the OWNING player's own client (no GM-relay) - core
// Foundry grants the Player role JOURNAL_CREATE by default, and the
// document a player creates is automatically theirs. If Jake ever locks
// that permission down world-wide, this would need the same GM-whisper
// relay shape as vtm5e-automation's privileged-write-relay.js - not built
// preemptively for a permission restriction that isn't actually in place.

const MODULE_ID = 'vtm5e-coterie'
const JOURNAL_PREFIX = 'Coterie Wishlist: '

function journalNameFor (user) {
  return `${JOURNAL_PREFIX}${user.name}`
}

export async function ensureWishlistJournal (user) {
  const name = journalNameFor(user)
  let journal = game.journal.find((j) => j.name === name)
  if (!journal) {
    journal = await JournalEntry.create({
      name,
      pages: [{ name, type: 'text', text: { content: '', format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } }],
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      flags: { [MODULE_ID]: { items: [], ownerUserId: user.id } }
    })
  }
  return journal
}

// GM-only in practice: a non-GM user's game.journal collection never
// contains other players' NONE-permission journals in the first place, so
// this naturally returns just their own (if it exists) on a player client.
export function getAllWishlistJournals () {
  return game.journal.filter((j) => j.name.startsWith(JOURNAL_PREFIX) && j.getFlag(MODULE_ID, 'ownerUserId'))
}

export function getWishlistItems (journal) {
  return journal?.getFlag(MODULE_ID, 'items') ?? []
}

export async function addWishlistItem (journal, text) {
  const items = getWishlistItems(journal)
  items.push({ id: foundry.utils.randomID(), text })
  await journal.setFlag(MODULE_ID, 'items', items)
}

export async function removeWishlistItem (journal, itemId) {
  const items = getWishlistItems(journal).filter((i) => i.id !== itemId)
  await journal.setFlag(MODULE_ID, 'items', items)
}
