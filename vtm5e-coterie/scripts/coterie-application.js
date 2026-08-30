// Desktop party-sheet window. Members/Merits & Flaws/Equipment are pure
// reads off each linked actor, no new storage needed. Domain and
// Backgrounds are real coterie-level RAW data (Core Rulebook p.195-196),
// stored on the coterie world-setting itself. Coterie Fund and Wishlist
// need real new storage (a hidden stash Actor, per-player ownership-gated
// JournalEntries) and are deliberately deferred to a follow-up pass - this
// is the "functional, all fields present" pass, visual polish comes after.
//
// Tabs are a plain DOM class/hidden toggle, not ApplicationV2's native tab
// group config - simplest thing that works for a handful of static panels,
// no reason to reach for more machinery.
//
// Mirrors vtm5e-domainmap/scripts/relationship-map-app.js's ApplicationV2 +
// static #onAction + DialogV2.input shape throughout.

const MODULE_ID = 'vtm5e-coterie'
const FALLBACK_IMG = 'icons/svg/mystery-man.svg'

// Mirrors vtm5e-charactersheet/scripts/shared-context.js's FEATURE_COLUMNS -
// stable wod5e domain data (item.system.featuretype values), not logic that
// could drift, so a local copy is simpler than reaching into that module.
const FEATURE_COLUMNS = [
  { key: 'merit', label: 'Merits' },
  { key: 'flaw', label: 'Flaws' },
  { key: 'background', label: 'Backgrounds' },
  { key: 'boon', label: 'Boons' }
]

const ACTOR_TYPE_LABELS = { vampire: 'Vampire', ghoul: 'Ghoul', mortal: 'Mortal', hunter: 'Hunter', werewolf: 'Werewolf', spc: 'SPC' }

// Real RAW mechanics, Core Rulebook p.195-196 ("Domain") - Chasse/Lien/
// Portillon are the Domain Background's 3 sub-Traits, each a standard 0-5
// dot rating (not the 6-dot scale this first pass mistakenly used).
const TRACKER_DEFS = [
  { key: 'chasse', label: 'Chasse', tooltip: 'How rich the domain is as a hunting ground. Sets Hunting Difficulty: 1 dot = Difficulty 6, each further dot -1 (floor 1).' },
  { key: 'lien', label: 'Lien', tooltip: "How well-integrated the coterie is into the domain. +1 die per dot to a member's pool when dealing peacefully with locals, finding something/someone within the domain, or getting the word on the street. Never modifies hunting rolls." },
  { key: 'portillon', label: 'Portillon', tooltip: "How secure the domain is against intrusion. -1 die per dot from an intruder's pool when they try to enter, investigate, or surveil the domain without the coterie's knowledge. Doesn't apply to Havens." }
]

// Core p.195: 1 dot in Chasse = default Hunting Difficulty 6, each further
// dot -1. Core p.311: minimum hunting Difficulty is always 1. 0 dots means
// no Domain to hunt in at all (poach elsewhere or arrange a letter of
// passage - a GM call, not a fixed number).
function huntingDifficultyFor (chasse) {
  if (!chasse) return null
  return Math.max(1, 7 - chasse)
}

// Coterie Backgrounds, Core Rulebook p.196 - shared Backgrounds the coterie
// holds in common; any member can use them as their own per RAW. Just a
// rating + free-text note each (e.g. "Haven: clubhouse") - no per-Background
// mechanical automation, matching how individual character Backgrounds
// already work on the regular actor sheets (a rated dot + flavor text).
const BACKGROUND_DEFS = [
  { key: 'adversary', label: 'Adversary' },
  { key: 'ally', label: 'Ally' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'enemy', label: 'Enemy' },
  { key: 'haven', label: 'Haven' },
  { key: 'herd', label: 'Herd' },
  { key: 'influence', label: 'Influence' },
  { key: 'mask', label: 'Mask' },
  { key: 'mawla', label: 'Mawla' },
  { key: 'resources', label: 'Resources' },
  { key: 'retainers', label: 'Retainers' },
  { key: 'status', label: 'Status' }
]

// Text-field blur handlers - keyed by the element's data-field attribute
// (see #wireTextFields). Simple debounce-on-blur, not per-keystroke saves.
const TEXT_FIELD_SETTERS = {
  coterieType: 'setCoterieType',
  domainNotes: 'setDomainNotes',
  notes: 'setNotes'
}

// Read-only visual replica of wod5e's own square health/willpower boxes
// (see systems/wod5e/display/shared/actors/parts/health.hbs and its
// group-members.hbs party-row equivalent) - aggravated (most severe) fills
// from index 0, superficial fills the next boxes, remainder stay empty. The
// exact fill order is cosmetic (wod5e tracks counts, not per-box identity),
// this just needs to visually read as "damaged" at a glance.
function buildDamageBoxes (resource) {
  if (!resource || resource.max == null) return null
  const boxes = []
  for (let i = 0; i < resource.max; i++) {
    if (i < (resource.aggravated ?? 0)) boxes.push({ state: 'aggravated' })
    else if (i < (resource.aggravated ?? 0) + (resource.superficial ?? 0)) boxes.push({ state: 'superficial' })
    else boxes.push({ state: 'empty' })
  }
  return boxes
}

async function gatherActorCandidates (excludeUuids) {
  return game.actors.contents
    .filter((a) => !excludeUuids.includes(a.uuid) && a.type !== 'spc')
    .map((a) => ({ uuid: a.uuid, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export class CoterieApplication extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'vtm5e-coterie-app',
    tag: 'div',
    classes: ['vtm5e-coterie-app'],
    window: { title: 'Coterie', icon: 'fas fa-people-group', resizable: true },
    position: { width: 900, height: 700 },
    actions: {
      switchTab: CoterieApplication.#onSwitchTab,
      addMember: CoterieApplication.#onAddMember,
      removeMember: CoterieApplication.#onRemoveMember,
      editName: CoterieApplication.#onEditName,
      toggleExpandRow: CoterieApplication.#onToggleExpandRow,
      setTracker: CoterieApplication.#onSetTracker,
      setBackgroundRating: CoterieApplication.#onSetBackgroundRating,
      openActorSheet: CoterieApplication.#onOpenActorSheet,
      addWishlistItem: CoterieApplication.#onAddWishlistItem,
      removeWishlistItem: CoterieApplication.#onRemoveWishlistItem
    }
  }

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/coterie.hbs` }
  }

  #activeTab = 'members'

  async _prepareContext (_options) {
    const { getCoterie, getMemberActors } = await import('./coterie-data.js')
    const coterie = getCoterie()
    const actors = await getMemberActors()

    let equippedSlotFor = () => null
    let slotLabel = () => ''
    try {
      ({ equippedSlotFor, slotLabel } = await import('/modules/vtm5e-automation/scripts/equip.js'))
    } catch (err) { /* vtm5e-automation not active - Equipment tab just stays empty */ }

    const members = actors.map((a) => ({
      uuid: a.uuid,
      name: a.name,
      img: a.img || FALLBACK_IMG,
      type: ACTOR_TYPE_LABELS[a.type] ?? a.type,
      healthBoxes: buildDamageBoxes(a.system?.health),
      willpowerBoxes: buildDamageBoxes(a.system?.willpower)
    }))

    const trackers = TRACKER_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      tooltip: def.tooltip,
      dots: Array.from({ length: 5 }, (_, i) => ({ index: i, active: i < coterie.trackers[def.key] })),
      huntingDifficulty: def.key === 'chasse' ? huntingDifficultyFor(coterie.trackers.chasse) : null
    }))

    const meritsFlawsByMember = []
    for (const actor of actors) {
      const columns = FEATURE_COLUMNS.map((col) => ({
        key: col.key,
        label: col.label,
        items: actor.items
          .filter((i) => i.type === 'feature' && i.system?.featuretype === col.key)
          .map((i) => ({ id: i.id, name: i.name, points: i.system?.points ?? 0, description: i.system?.description ?? '' }))
      }))
      if (columns.some((c) => c.items.length)) meritsFlawsByMember.push({ memberName: actor.name, columns })
    }

    const equipmentByMember = []
    for (const actor of actors) {
      const items = actor.items
        .filter((i) => equippedSlotFor(i) !== null)
        .map((i) => ({
          id: i.id,
          name: i.name,
          description: i.system?.description ?? '',
          slotLabel: slotLabel(i.type, equippedSlotFor(i))
        }))
      if (items.length) equipmentByMember.push({ memberName: actor.name, items })
    }

    const backgrounds = BACKGROUND_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      note: coterie.backgrounds[def.key]?.note ?? '',
      dots: Array.from({ length: 5 }, (_, i) => ({ index: i, active: i < (coterie.backgrounds[def.key]?.rating ?? 0) }))
    }))

    const wishlist = await this.#prepareWishlistContext()

    return {
      isGM: game.user.isGM,
      coterieName: coterie.name,
      coterieType: coterie.coterieType,
      domainNotes: coterie.domainNotes,
      notes: coterie.notes,
      trackers,
      backgrounds,
      members,
      meritsFlawsByMember,
      equipmentByMember,
      ...wishlist
    }
  }

  // GM sees every player's wishlist (read-only - these are player-authored)
  // grouped by owner; a player sees and edits only their own. GM users never
  // get an ensureWishlistJournal call of their own here on purpose - a GM
  // doesn't need a personal wishlist journal, this tab is a review view for
  // them.
  async #prepareWishlistContext () {
    const { ensureWishlistJournal, getAllWishlistJournals, getWishlistItems } = await import('./wishlist-journals.js')

    if (game.user.isGM) {
      const wishlists = getAllWishlistJournals().map((journal) => ({
        ownerName: game.users.get(journal.getFlag(MODULE_ID, 'ownerUserId'))?.name ?? 'Unknown',
        items: getWishlistItems(journal)
      }))
      return { isPlayerWishlist: false, wishlists }
    }

    const journal = await ensureWishlistJournal(game.user)
    return { isPlayerWishlist: true, wishlistItems: getWishlistItems(journal) }
  }

  async _onRender (context, options) {
    super._onRender(context, options)
    this.#syncActiveTab()
    this.#wireTextFields()
  }

  // Plain <input>/<textarea> fields tagged data-field="coterieType" etc -
  // saved on blur, no live re-render needed since the field already shows
  // what the user typed. Background notes are keyed per-Background instead
  // (data-background-note="haven" etc), handled separately since there are
  // 12 of them rather than one fixed setter.
  #wireTextFields () {
    this.element.querySelectorAll('[data-field]').forEach((el) => {
      el.addEventListener('blur', async () => {
        const setterName = TEXT_FIELD_SETTERS[el.dataset.field]
        if (!setterName) return
        const dataModule = await import('./coterie-data.js')
        await dataModule[setterName](el.value)
      })
    })
    this.element.querySelectorAll('[data-background-note]').forEach((el) => {
      el.addEventListener('blur', async () => {
        const { setBackgroundNote } = await import('./coterie-data.js')
        await setBackgroundNote(el.dataset.backgroundNote, el.value)
      })
    })
  }

  #syncActiveTab () {
    this.element.querySelectorAll('[data-tab-content]').forEach((el) => {
      el.hidden = el.dataset.tabContent !== this.#activeTab
    })
    this.element.querySelectorAll('[data-tab-button]').forEach((el) => {
      el.classList.toggle('active', el.dataset.tabButton === this.#activeTab)
    })
  }

  static #onSwitchTab (_event, target) {
    this.#activeTab = target.dataset.tabButton
    this.#syncActiveTab()
  }

  static #onToggleExpandRow (_event, target) {
    target.closest('.cs-expand-row')?.classList.toggle('cs-expanded')
  }

  static async #onEditName () {
    const { getCoterie, setCoterieName } = await import('./coterie-data.js')
    const current = getCoterie().name

    const result = await foundry.applications.api.DialogV2.input({
      window: { title: 'Rename Coterie' },
      content: `<div class="form-group"><label>Name</label><input type="text" name="name" value="${foundry.utils.escapeHTML(current)}"></div>`,
      ok: { icon: 'fas fa-check', label: 'Save' },
      classes: ['wod5e']
    })
    if (!result) return

    await setCoterieName((result.name || '').trim())
    this.render()
  }

  static async #onAddMember () {
    const { getCoterie, addMember } = await import('./coterie-data.js')
    const coterie = getCoterie()
    const candidates = await gatherActorCandidates(coterie.memberActorUuids)
    if (!candidates.length) { ui.notifications.warn('No other actors available to add.'); return }

    const options = candidates.map((c) => `<option value="${c.uuid}">${c.name}</option>`).join('')
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: 'Add Coterie Member' },
      content: `<div class="form-group"><label>Actor</label><select name="actorUuid">${options}</select></div>`,
      ok: { icon: 'fas fa-plus', label: 'Add' },
      classes: ['wod5e']
    })
    if (!result) return

    await addMember(result.actorUuid)
    this.render()
  }

  static async #onRemoveMember (_event, target) {
    const { removeMember } = await import('./coterie-data.js')
    const uuid = target.dataset.actorUuid
    if (!uuid) return
    await removeMember(uuid)
    this.render()
  }

  // Standard WoD dot-tracker click behavior: click a filled dot at your
  // current rating to knock it back by one, otherwise set the rating to
  // the clicked dot's position.
  static async #onSetTracker (_event, target) {
    if (!game.user.isGM) return
    const { getCoterie, setTracker } = await import('./coterie-data.js')
    const key = target.dataset.trackerKey
    const index = Number(target.dataset.index)
    if (!key || Number.isNaN(index)) return

    const current = getCoterie().trackers[key] ?? 0
    await setTracker(key, current === index + 1 ? index : index + 1)
    this.render()
  }

  static async #onSetBackgroundRating (_event, target) {
    if (!game.user.isGM) return
    const { getCoterie, setBackgroundRating } = await import('./coterie-data.js')
    const key = target.dataset.backgroundKey
    const index = Number(target.dataset.index)
    if (!key || Number.isNaN(index)) return

    const current = getCoterie().backgrounds[key]?.rating ?? 0
    await setBackgroundRating(key, current === index + 1 ? index : index + 1)
    this.render()
  }

  static #onOpenActorSheet (_event, target) {
    const uuid = target.dataset.actorUuid
    fromUuid(uuid).then((actor) => actor?.sheet?.render(true))
  }

  static async #onAddWishlistItem () {
    if (game.user.isGM) return // review-only for GM, nothing of their own to add to

    const result = await foundry.applications.api.DialogV2.input({
      window: { title: 'Add to Wishlist' },
      content: '<div class="form-group"><label>Item</label><input type="text" name="text" placeholder="What do you want?"></div>',
      ok: { icon: 'fas fa-plus', label: 'Add' },
      classes: ['wod5e']
    })
    const text = (result?.text || '').trim()
    if (!text) return

    const { ensureWishlistJournal, addWishlistItem } = await import('./wishlist-journals.js')
    const journal = await ensureWishlistJournal(game.user)
    await addWishlistItem(journal, text)
    this.render()
  }

  static async #onRemoveWishlistItem (_event, target) {
    if (game.user.isGM) return
    const itemId = target.dataset.wishlistItemId
    if (!itemId) return

    const { ensureWishlistJournal, removeWishlistItem } = await import('./wishlist-journals.js')
    const journal = await ensureWishlistJournal(game.user)
    await removeWishlistItem(journal, itemId)
    this.render()
  }
}
