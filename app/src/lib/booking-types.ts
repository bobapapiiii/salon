// ── Salon appointment book, domain types ──────────────────────────────────

export type ApptStatus =
  | 'booked' // front-desk booking, on the schedule, not yet confirmed
  | 'requested' // online booking awaiting salon approval
  | 'confirmed'
  | 'checked_in'
  | 'in_service'
  | 'completed' // service done, not yet paid -- "Mark completed" sets this
  | 'checked_out' // service done AND paid -- checkout (or reopen) sets this
  | 'no_show'

export interface Team {
  id: string
  name: string
  stationType: string
}

/** temporary time off, specific dates, never touches the weekly schedule */
export interface TechTimeOff {
  id: string
  /** ISO day keys (YYYY-MM-DD), inclusive range */
  from: string
  to: string
  status: 'vacation' | 'off' | 'emergency' | 'late' | 'early'
  /** minutes from OPEN_MIN, arrival time for "late", departure for "early" */
  timeMin?: number
  notes?: string
}

/** an uploaded employment document (W-9, license, ID) */
export interface TechDocument {
  id: string
  label: string
  fileName: string
  dataUrl: string
  uploadedAt: string // ISO
}

/** one weekday in a tech's permanent weekly schedule (minutes from OPEN_MIN) */
export interface WeeklyDay {
  off?: boolean
  startMin?: number
  endMin?: number
}

export interface Tech {
  id: string
  name: string
  initials: string
  teamId: string
  skills: string[] // service ids the tech is qualified for
  firstName?: string
  lastName?: string
  nickname?: string
  gender?: 'female' | 'male' | 'other'
  /** ISO date (YYYY-MM-DD) */
  birthday?: string
  /** employment start, ISO date */
  hireDate?: string
  /** employment end, ISO date */
  endDate?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  /** uploaded employment documents */
  documents?: TechDocument[]
  /** temporary days off (vacation, emergency, etc.) by exact date */
  timeOff?: TechTimeOff[]
  /** services they can do beyond their job role (per-tech exceptions) */
  extraSkills?: string[]
  /** per-service overrides, timing, rate, and online bookability */
  serviceOverrides?: Record<string, { durationMin?: number; price?: number; online?: boolean }>
  /** commission percentage on services, e.g. 60 */
  commissionPct?: number
  /** default true, inactive techs stay on the roster but off the board */
  active?: boolean
  /** archived staff, kept for history, hidden everywhere else */
  archived?: boolean
  /** clients can book this tech online */
  bookableOnline?: boolean
  /** data-URL photo, shown in online booking; on the calendar when enabled */
  photoUrl?: string
  /** show the photo in the calendar column header */
  showPhotoOnCalendar?: boolean
  /** bio shown on the online booking page */
  description?: string
  /** permanent weekly schedule, keyed 0=Sun to 6=Sat */
  weeklySchedule?: Record<number, WeeklyDay>
  /** can sign in to the tech portal (appointments, reports, tips) */
  loginEnabled?: boolean
  /** demo portal sign-in PIN */
  pin?: string
  /** client ids this tech no longer wants to take -- their own call, set on
   *  their profile in Settings → Techs. Booking them still shows a warning
   *  the salon can choose to book through anyway; it's never silently
   *  bypassed and never overridable from a client-facing flow */
  bannedClientIds?: string[]
  /** salon-defined labels (e.g. "senior tech", "new hire") -- small,
   *  additive tagging so discounts can target a group of technicians
   *  without inventing a second roles system */
  tags?: string[]
}

export interface ServiceCategory {
  id: string
  name: string
  /** tailwind-compatible hsl triple, e.g. "210 90% 56%", dark-mode tint */
  hue: string
  /** Lumina light-mode trio */
  fill: string
  line: string
  text: string
  /** set when this is a subcategory nested under another category */
  parentId?: string
  /** archived (soft-deleted): hidden from booking and from the services
   *  list, but never removed, so any appointment that already references
   *  it -- past or upcoming -- still resolves its name, color, etc. */
  archived?: boolean
  /** job roles hidden from online booking for every service in this
   *  category (and, for a top-level category, its subcategories too) --
   *  same idea as Service.onlineExcludedRoleIds, just applied to the whole
   *  category at once. In-salon booking is unaffected either way. */
  onlineExcludedRoleIds?: string[]
}

/** an add-on a service can offer, adds time and money */
export interface ServiceAddon {
  id: string
  name: string
  mins: number
  price: number
}

export interface Service {
  id: string
  name: string
  short: string
  durationMin: number
  price: number
  categoryId: string
  /** station/team affinity, pedi services prefer pedi-chair teams */
  teamAffinity?: string
  /** inactive services hide from booking menus */
  active?: boolean
  /** optional add-ons offered with this service */
  addons?: ServiceAddon[]
  /** job roles who can perform this service but shouldn't be offered it on
   *  the online booking page -- the front desk can still book any of them
   *  for it in-salon, this only hides it from clients booking online */
  onlineExcludedRoleIds?: string[]
  /** salon-defined labels (e.g. "add-on friendly", "premium") -- small,
   *  additive tagging so discounts (and, later, reporting/search) can
   *  target a group of services without a dedicated category */
  tags?: string[]
}

export interface Appointment {
  id: string
  techId: string
  clientName: string
  serviceId: string
  /** minutes from OPEN_MIN */
  startMin: number
  durationMin: number
  status: ApptStatus
  notes?: string
  /** set on every appointment belonging to one same-time parallel booking */
  parallelGroup?: string
  /** name-only guest, links this visit to the booking client's profile */
  guestOf?: string
  /** add-ons chosen at booking (snapshot, already priced into checkout) */
  addons?: ServiceAddon[]
  /** set when the tech's personal rate differs from the service list price */
  priceOverride?: number
  /** flagged problem (tech called off, unconfirmed, etc.) — salon must resolve */
  issue?: boolean
  /** the booking was made with a preference, not a specific tech */
  requestedTechChoice?: 'first' | 'pref-female' | 'pref-male'
  /** the client asked for THIS tech by name, do not casually move it */
  techRequested?: boolean
  /** the salon already confirmed moving this specific appointment to a tech
   *  of the other gender than requestedTechChoice — don't ask again for it
   *  until the request preference itself is changed */
  genderMismatchOk?: boolean
  /** when the client checked in, minutes from OPEN_MIN */
  checkedInMin?: number
  /** when the service started, minutes from OPEN_MIN */
  startedMin?: number
  /** when the service completed, minutes from OPEN_MIN */
  completedMin?: number
  /** salon-defined per-service notation (polish color, design, etc.), keyed by field id */
  customFields?: Record<string, string>
  /** audit trail, everything that happened to this appointment */
  log?: { at: number; text: string }[]
  /** how the booking came in; undefined on older records predating this field */
  bookingSource?: 'front_desk' | 'walk_in' | 'online'
  /** internal bookkeeping only, not shown in the UI — `${walkInGroupId}:${guestName}`,
   *  set when this appointment was dragged in from the walk-in queue, so a second
   *  service dragged in later for the same walk-in guest can be linked to the first
   *  via a shared parallelGroup instead of landing as a separate, unlinked booking */
  walkinOrigin?: string
  /** links this appointment to a request created via the public online-booking
   *  API (server/) -- lets the sync in AppointmentBook.tsx avoid inserting the
   *  same backend booking twice, and lets approving/declining it here push the
   *  decision back. undefined for every appointment that originated locally
   *  (front desk, walk-in, demo data). See HANDOFF.md #10. */
  onlineRequestId?: string
}

export const logEntry = (text: string) => ({ at: Date.now(), text })

/** a client's standing preference: this tech does this type of service for
 *  them. Tracked at the category/subcategory level, not a specific service,
 *  front desk only needs to know "this client wants JJ for pedicures," not
 *  which exact pedicure. A client can have several — one tech for nails,
 *  another for pedicures, etc. Surfaced when booking for them (and, once it
 *  exists, on online booking). */
export interface ClientTechPreference {
  id: string
  techId: string
  categoryIds: string[]
}

export interface ClientRecord {
  id: string
  name: string
  phone: string
  visits: number
  /** standing tech + service preferences, set by staff on the client's profile */
  preferredTechs?: ClientTechPreference[]
  /** name-only guests this client has brought, no profile of their own */
  guests?: { id: string; name: string }[]
  /** salon-defined labels (e.g. "VIP", "birthday club") -- small, additive
   *  tagging so discounts can target a group of clients by eligibility */
  tags?: string[]
}

export interface TimeBlock {
  id: string
  techId: string
  /** minutes from OPEN_MIN */
  startMin: number
  durationMin: number
  reason: string
}

// ── Calendar constants ─────────────────────────────────────────────────────

export const OPEN_MIN = 8 * 60 // 8:00 AM
export const CLOSE_MIN = 20 * 60 // 8:00 PM
export const SLOT_MIN = 15
export const DAY_SLOTS = (CLOSE_MIN - OPEN_MIN) / SLOT_MIN // 48

// ── Independent width / height zoom ────────────────────────────────────────
// Not every monitor is the same, column width and time height scale freely,
// presets are just shortcuts.

export interface Scale {
  /** column width, px */
  colW: number
  /** time height, px per minute */
  ppm: number
}

export const MIN_COL_W = 22
export const MAX_COL_W = 260
export const MIN_PPM = 0.35
export const MAX_PPM = 2.6

export const SCALE_PRESETS: { id: string; label: string; scale: Scale }[] = [
  { id: 'overview', label: 'Overview', scale: { colW: 30, ppm: 0.55 } },
  { id: 'compact', label: 'Compact', scale: { colW: 104, ppm: 1.15 } },
  { id: 'comfortable', label: 'Comfortable', scale: { colW: 168, ppm: 1.7 } },
]

/** below this width the book behaves as a density overview (no drag) */
export const OVERVIEW_COL_W = 48
/** below this width cards stop rendering text */
export const TEXT_COL_W = 64

let clockFormat: '12h' | '24h' = '12h'
/** Settings → General drives this */
export function setClockFormat(f: '12h' | '24h') {
  clockFormat = f
}

export function fmtTime(minFromOpen: number): string {
  const total = OPEN_MIN + minFromOpen
  const h24 = Math.floor(total / 60)
  const mm = String(total % 60).padStart(2, '0')
  if (clockFormat === '24h') return `${String(h24).padStart(2, '0')}:${mm}`
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** do two [start,end) intervals overlap? */
export function overlaps(aS: number, aE: number, bS: number, bE: number) {
  return aS < bE && bS < aE
}
