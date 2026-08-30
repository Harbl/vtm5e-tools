// World-setting CRUD, mirroring vtm5e-domainmap's relationship-data.js
// pattern exactly. Simplified from the original plan's multi-coterie keyed
// registry down to a single global coterie - Jake runs one campaign with
// one active party, so a `{ [coterieId]: {...} }` registry would just be
// unused indirection. Easy to widen back to multiple coteries later if that
// ever stops being true.

const MODULE_ID = 'vtm5e-coterie'
const SETTING_KEY = 'coterie'

// Domain's 3 sub-Traits (Core Rulebook p.195-196) - each a standard 0-5 dot
// Background rating.
const TRACKER_KEYS = ['chasse', 'lien', 'portillon']

// Coterie Backgrounds (Core Rulebook p.196): shared Backgrounds the whole
// coterie can hold and any member can use as their own, per RAW.
export const BACKGROUND_KEYS = [
  'adversary', 'ally', 'contacts', 'enemy', 'haven', 'herd',
  'influence', 'mask', 'mawla', 'resources', 'retainers', 'status'
]

function defaultBackgrounds () {
  return Object.fromEntries(BACKGROUND_KEYS.map((key) => [key, { rating: 0, note: '' }]))
}

export function registerCoterieData () {
  game.settings.register(MODULE_ID, SETTING_KEY, {
    scope: 'world',
    config: false,
    type: Object,
    default: {
      name: 'The Coterie',
      memberActorUuids: [],
      trackers: { chasse: 0, lien: 0, portillon: 0 },
      coterieType: '',
      domainNotes: '',
      notes: '',
      backgrounds: defaultBackgrounds()
    }
  })
}

export function getCoterie () {
  const data = game.settings.get(MODULE_ID, SETTING_KEY)
  const backgrounds = defaultBackgrounds()
  for (const key of BACKGROUND_KEYS) {
    backgrounds[key] = { ...backgrounds[key], ...(data?.backgrounds?.[key] ?? {}) }
  }
  return {
    name: data?.name ?? 'The Coterie',
    memberActorUuids: data?.memberActorUuids ?? [],
    trackers: { chasse: 0, lien: 0, portillon: 0, ...(data?.trackers ?? {}) },
    coterieType: data?.coterieType ?? '',
    domainNotes: data?.domainNotes ?? '',
    notes: data?.notes ?? '',
    backgrounds
  }
}

async function saveCoterie (data) {
  await game.settings.set(MODULE_ID, SETTING_KEY, data)
}

export async function setCoterieName (name) {
  const data = getCoterie()
  data.name = name || 'The Coterie'
  await saveCoterie(data)
}

export async function setCoterieType (value) {
  const data = getCoterie()
  data.coterieType = value ?? ''
  await saveCoterie(data)
}

export async function setDomainNotes (value) {
  const data = getCoterie()
  data.domainNotes = value ?? ''
  await saveCoterie(data)
}

export async function setNotes (value) {
  const data = getCoterie()
  data.notes = value ?? ''
  await saveCoterie(data)
}

export async function addMember (actorUuid) {
  const data = getCoterie()
  if (!data.memberActorUuids.includes(actorUuid)) data.memberActorUuids.push(actorUuid)
  await saveCoterie(data)
}

export async function removeMember (actorUuid) {
  const data = getCoterie()
  data.memberActorUuids = data.memberActorUuids.filter((uuid) => uuid !== actorUuid)
  await saveCoterie(data)
}

export async function setTracker (key, value) {
  if (!TRACKER_KEYS.includes(key)) return
  const data = getCoterie()
  data.trackers[key] = Math.max(0, Math.min(5, value))
  await saveCoterie(data)
}

export async function setBackgroundRating (key, value) {
  if (!BACKGROUND_KEYS.includes(key)) return
  const data = getCoterie()
  data.backgrounds[key].rating = Math.max(0, Math.min(5, value))
  await saveCoterie(data)
}

export async function setBackgroundNote (key, note) {
  if (!BACKGROUND_KEYS.includes(key)) return
  const data = getCoterie()
  data.backgrounds[key].note = note ?? ''
  await saveCoterie(data)
}

export async function getMemberActors () {
  const { memberActorUuids } = getCoterie()
  const actors = []
  for (const uuid of memberActorUuids) {
    const actor = await fromUuid(uuid)
    if (actor) actors.push(actor)
  }
  return actors
}
