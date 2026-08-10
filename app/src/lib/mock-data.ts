import type {
  Appointment,
  ClientRecord,
  Service,
  ServiceCategory,
  Team,
  Tech,
} from './booking-types'
import { SLOT_MIN } from './booking-types'

// ── seeded rng so the book looks identical on every load ───────────────────
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20260724)
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

// ── teams ───────────────────────────────────────────────────────────────────
export const TEAMS: Team[] = [
  { id: 'nail', name: 'Nail Artists', stationType: 'Nail desk' },
  { id: 'pedi', name: 'Pedi Specialists', stationType: 'Pedi chair' },
  { id: 'gelx', name: 'Gel-X & Acrylic', stationType: 'Nail desk' },
  { id: 'art', name: 'Nail Art Studio', stationType: 'Private station' },
]

// ── service catalog ─────────────────────────────────────────────────────────
export const CATEGORIES: ServiceCategory[] = [
  { id: 'mani', name: 'Manicure', hue: '205 90% 60%', fill: '#F9DBE3', line: '#E0517E', text: '#9C2B54' },
  { id: 'pedi', name: 'Pedicure', hue: '160 70% 50%', fill: '#D8EEE4', line: '#2FA883', text: '#1C6B52' },
  { id: 'enh', name: 'Gel / Acrylic', hue: '270 75% 66%', fill: '#F9EBCB', line: '#D99B26', text: '#7A5510' },
  { id: 'art', name: 'Nail Art', hue: '36 95% 58%', fill: '#E8E0FA', line: '#8A6AE0', text: '#553AA8' },
  { id: 'rem', name: 'Removal & Repair', hue: '348 80% 62%', fill: '#DFE7F5', line: '#5E83CE', text: '#334E85' },
]

export const SERVICES: Service[] = [
  { id: 'm-classic', name: 'Classic Manicure', short: 'Manicure', durationMin: 45, price: 28, categoryId: 'mani' },
  { id: 'm-gel', name: 'Gel Manicure', short: 'Gel Mani', durationMin: 60, price: 42, categoryId: 'mani' },
  { id: 'p-classic', name: 'Classic Pedicure', short: 'Pedicure', durationMin: 45, price: 38, categoryId: 'pedi', teamAffinity: 'pedi' },
  { id: 'p-gel', name: 'Gel Pedicure', short: 'Gel Pedi', durationMin: 60, price: 52, categoryId: 'pedi', teamAffinity: 'pedi' },
  { id: 'p-spa', name: 'Spa Pedicure', short: 'Spa Pedi', durationMin: 75, price: 62, categoryId: 'pedi', teamAffinity: 'pedi' },
  { id: 'e-acrylic', name: 'Acrylic Full Set', short: 'Acrylic Set', durationMin: 90, price: 65, categoryId: 'enh', teamAffinity: 'gelx' },
  { id: 'e-gelx', name: 'Gel-X Extensions', short: 'Gel-X', durationMin: 90, price: 72, categoryId: 'enh', teamAffinity: 'gelx' },
  { id: 'e-dip', name: 'Dip Powder', short: 'Dip', durationMin: 75, price: 55, categoryId: 'enh' },
  { id: 'e-fill', name: 'Acrylic Fill', short: 'Fill', durationMin: 60, price: 45, categoryId: 'enh', teamAffinity: 'gelx' },
  { id: 'a-custom', name: 'Custom Nail Art', short: 'Nail Art', durationMin: 45, price: 25, categoryId: 'art', teamAffinity: 'art' },
  { id: 'a-french', name: 'French Design', short: 'French', durationMin: 30, price: 15, categoryId: 'art' },
  { id: 'r-soak', name: 'Soak-Off Removal', short: 'Removal', durationMin: 30, price: 15, categoryId: 'rem' },
  { id: 'r-fix', name: 'Nail Repair', short: 'Repair', durationMin: 15, price: 8, categoryId: 'rem' },
]

/** pseudo service offered in quick-book: expands into a parallel mani+pedi pair */
export const COMBO_ID = 'combo-mani-pedi'

// ── technicians (70) ────────────────────────────────────────────────────────
const FIRST = [
  'Linh', 'Mia', 'Amy', 'Jenny', 'Sophia', 'Thao', 'Hana', 'Lily', 'Chloe', 'Vy',
  'Kim', 'Anna', 'Bella', 'Tina', 'Nancy', 'Huong', 'Ruby', 'Sara', 'Emma', 'Lan',
  'Cindy', 'Grace', 'Hannah', 'Julie', 'Katie', 'Mai', 'Nina', 'Olivia', 'Phuong', 'Quinn',
  'Rosa', 'Selena', 'Trang', 'Vivian', 'Wendy', 'Xuan', 'Yen', 'Zoe', 'Amber', 'Bao',
  'Cam', 'Diep', 'Elle', 'Fiona', 'Gia', 'Haley', 'Ivy', 'Jade', 'Krystal', 'Lena',
  'Mandy', 'Ngoc', 'Oanh', 'Pearl', 'Queenie', 'Rose', 'Stella', 'Tammy', 'Uyen', 'Van',
  'Willow', 'Xenia', 'Yara', 'Zelda', 'Ariel', 'Bianca', 'Cecilia', 'Daphne', 'Elena', 'Farrah',
]
const LAST_INIT = 'NPTVLHDQB'.split('')

const TEAM_SIZES: Record<string, number> = { nail: 8, pedi: 6, gelx: 4, art: 2 }

export const TECHS: Tech[] = (() => {
  const techs: Tech[] = []
  let n = 0
  for (const team of TEAMS) {
    for (let i = 0; i < TEAM_SIZES[team.id]; i++) {
      const name = `${FIRST[n % FIRST.length]} ${pick(LAST_INIT)}.`
      const allServices = SERVICES.map((s) => s.id)
      // every tech does mani/pedi basics; team affinity adds the rest
      const skills = new Set<string>(['m-classic', 'm-gel', 'p-classic', 'p-gel', 'r-soak', 'r-fix', 'a-french'])
      if (team.id === 'gelx') ['e-acrylic', 'e-gelx', 'e-dip', 'e-fill'].forEach((s) => skills.add(s))
      if (team.id === 'art') { skills.add('a-custom'); skills.add('e-dip') }
      if (team.id === 'nail') { skills.add('e-dip'); if (rand() > 0.6) skills.add('e-fill') }
      if (team.id === 'pedi') { skills.add('p-spa'); if (rand() > 0.7) skills.add('a-custom') }
      techs.push({
        id: `t${techs.length + 1}`,
        name,
        initials: name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
        teamId: team.id,
        skills: allServices.filter((s) => skills.has(s)),
      })
      n++
    }
  }
  return techs
})()

// ── clients (searchable in quick-book) ──────────────────────────────────────
export const CLIENTS: ClientRecord[] = FIRST.slice(0, 46).map((f, i) => ({
  id: `c${i + 1}`,
  name: `${f} ${pick(LAST_INIT)}.`,
  phone: `(555) ${String(100 + i)}-${String(1000 + i * 37).slice(0, 4)}`,
  visits: int(1, 38),
  usualTechId: rand() > 0.4 ? pick(TECHS).id : undefined,
}))

// ── appointments ────────────────────────────────────────────────────────────
const STATUSES: Appointment['status'][] = [
  'confirmed', 'confirmed', 'confirmed', 'checked_in', 'in_service', 'completed',
]
const NOTES = [
  'Allergic to acetone, use non-acetone remover',
  'Wants chrome finish like last visit',
  'Prefers square shape, medium length',
  'Running 10 min late, confirmed by text',
  'Birthday set, add small gem accent',
  'Sensitive cuticles, be gentle',
  'Regular: same nude dip as usual',
  'Bring inspo pic, tortoise shell design',
]

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** deterministic schedule for any date key (e.g. "2026-07-24") */
export function generateDay(seedKey = '2026-07-24'): Appointment[] {
  const rand = mulberry32(hashSeed(seedKey))
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
  const appts: Appointment[] = []
  let id = 1
  let pg = 1
  const newClient = () => pick(CLIENTS).name

  for (const tech of TECHS) {
    // ~20% of the day booked (demo mode: lots of open spots), 1-2 small blocks
    const blocks = int(1, 2)
    let cursor = int(0, 90)
    for (let b = 0; b < blocks; b++) {
      const blockLen = int(1, 2)
      for (let k = 0; k < blockLen; k++) {
        const svcId = pick(tech.skills)
        const svc = SERVICES.find((s) => s.id === svcId)!
        const startMin = Math.min(cursor, 720 - svc.durationMin - 15)
        if (startMin < 0 || rand() < 0.12) { cursor += 30; continue } // gaps
        const snapped = Math.round(startMin / SLOT_MIN) * SLOT_MIN
        const isRequested = rand() < 0.05
        appts.push({
          id: `a${id++}`,
          techId: tech.id,
          clientName: newClient(),
          serviceId: svc.id,
          startMin: snapped,
          durationMin: svc.durationMin,
          status: isRequested ? 'requested' : pick(STATUSES),
          notes: rand() < 0.18 ? pick(NOTES) : undefined,
        })
        cursor = snapped + svc.durationMin + pick([0, 30, 60])
      }
      cursor += int(180, 360)
    }
  }

  // ── same-time parallel pairs: mani with one tech + pedi with another ──────
  const pediTechs = TECHS.filter((t) => t.teamId === 'pedi')
  const maniTechs = TECHS.filter((t) => t.teamId === 'nail')
  const hasConflict = (techId: string, s: number, e: number) =>
    appts.some((a) => a.techId === techId && s < a.startMin + a.durationMin && a.startMin < e)

  let pairs = 0
  let attempts = 0
  while (pairs < 6 && attempts < 400) {
    attempts++
    const pt = pick(pediTechs)
    const mt = pick(maniTechs)
    const startMin = int(0, 9) * 60 + pick([0, 15, 30, 45])
    const dur = 60
    if (hasConflict(pt.id, startMin, startMin + dur) || hasConflict(mt.id, startMin, startMin + dur)) continue
    const client = newClient()
    const group = `pg${pg++}`
    appts.push(
      { id: `a${id++}`, techId: mt.id, clientName: client, serviceId: 'm-gel', startMin, durationMin: dur, status: pick(['confirmed', 'checked_in', 'in_service']), parallelGroup: group, notes: rand() < 0.4 ? 'Doing hands while pedi runs' : undefined },
      { id: `a${id++}`, techId: pt.id, clientName: client, serviceId: 'p-gel', startMin, durationMin: dur, status: pick(['confirmed', 'checked_in', 'in_service']), parallelGroup: group },
    )
    pairs++
  }

  // a few pending online requests to show the approval queue styling
  for (let i = 0; i < 3; i++) {
    const tech = pick(TECHS)
    const svcId = pick(tech.skills)
    const svc = SERVICES.find((s) => s.id === svcId)!
    const startMin = Math.min(int(4, 17) * 60 + pick([0, 30]), 720 - svc.durationMin - 15)
    if (startMin < 0 || hasConflict(tech.id, startMin, startMin + svc.durationMin)) continue
    appts.push({
      id: `a${id++}`, techId: tech.id, clientName: newClient(), serviceId: svc.id,
      startMin, durationMin: svc.durationMin, status: 'requested',
      notes: 'Online request, awaiting approval',
    })
  }

  return appts
}
