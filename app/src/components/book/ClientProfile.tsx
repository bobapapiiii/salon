import { useMemo, useState } from 'react'
import {
  CreditCard, Crown, Mail, MapPin, Pencil, Phone, Plus, Printer, Star, Trash2, X,
} from 'lucide-react'
import type { Appointment, ClientRecord } from '@/lib/booking-types'
import { fmtTime } from '@/lib/booking-types'
import { SERVICES } from '@/lib/mock-data'
import { getStaff, useStaffStore } from '@/lib/staff-store'
import { useSettingsStore } from '@/lib/settings-store'
import { svcById } from '@/lib/services-store'
import { ConfirmDialog } from './ConfirmDialog'

const techById = (id: string) => getStaff().techs.find((t) => t.id === id)

export interface ClientNote {
  id: string
  text: string
  when: string
  by: string
}

interface Props {
  client: ClientRecord
  appts: Appointment[] // today's appointments (for "upcoming")
  guestVisits?: { dateKey: string; appt: Appointment }[] // visits by this client's name-only guests
  /** completed checkouts, shown as CLOSED with a clickable invoice */
  realVisits?: RealVisit[]
  onViewInvoice?: (paymentId: string) => void
  pointsBalance?: number
  loyaltyHistory?: { id: string; dateKey: string; total: number; points: number; redeemed?: { name: string; points: number; value: number } }[]
  notes: ClientNote[]
  onAddNote: (text: string) => void
  onDeleteNote: (id: string) => void
  onSaveProfile: (patch: Partial<ClientRecord>) => void
  onClose: () => void
}

type Tab = 'overview' | 'profile' | 'notes' | 'appointments' | 'guests' | 'loyalty'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'profile', label: 'Profile' },
  { id: 'notes', label: 'Notes' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'guests', label: 'Guests' },
  { id: 'loyalty', label: 'Loyalty Points' },
]

// deterministic demo history/loyalty from client id
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface PastVisit {
  invoice: string; date: string; services: string[]; status: 'CLOSED' | 'NO SHOW' | 'OPEN'
  price: number; techName: string
  /** real checkout, opens the invoice */
  paymentId?: string
}

/** a completed sale shown in the client's history */
export interface RealVisit {
  paymentId: string
  invoice: string
  date: string
  services: string[]
  price: number
  techName: string
}

function mockHistory(c: ClientRecord): PastVisit[] {
  const r = rng(hash(c.id))
  const n = Math.min(10, Math.max(2, c.visits))
  const out: PastVisit[] = []
  for (let i = 0; i < n; i++) {
    const svcCount = r() > 0.6 ? 2 : 1
    const svcs = Array.from({ length: svcCount }, () => SERVICES[Math.floor(r() * SERVICES.length)])
    const roll = r()
    out.push({
      invoice: `INV${50000 + Math.floor(r() * 4000)}`,
      date: `${1 + Math.floor(r() * 6)}/${1 + Math.floor(r() * 28)}/2026`,
      services: svcs.map((s) => s.name),
      status: roll > 0.92 ? 'NO SHOW' : roll > 0.85 ? 'OPEN' : 'CLOSED',
      price: svcs.reduce((s, x) => s + x.price, 0),
      techName: getStaff().techs[Math.floor(r() * getStaff().techs.length)]?.name ?? 'Unknown',
    })
  }
  return out
}


const STATUS_STYLE: Record<string, string> = {
  CLOSED: 'bg-slate-500/15 text-slate-500',
  OPEN: 'bg-emerald-500/15 text-emerald-600',
  'NO SHOW': 'bg-red-500/15 text-red-500',
}

export function ClientProfile({ client, appts, guestVisits = [], realVisits = [], onViewInvoice, pointsBalance = 0, loyaltyHistory = [], notes, onAddNote, onDeleteNote, onSaveProfile, onClose }: Props) {
  const { techs } = useStaffStore()
  const [tab, setTab] = useState<Tab>('overview')
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null)
  const [selGuest, setSelGuest] = useState<string | null>(null)

  // every guest name linked to this client, from the profile registry + actual visits
  const guestNames = useMemo(() => {
    const names = [...(client.guests ?? []).map((g) => g.name), ...guestVisits.map((v) => v.appt.clientName)]
    return [...new Set(names)]
  }, [client.guests, guestVisits])
  const activeGuest = selGuest ?? guestNames[0] ?? null
  const activeVisits = useMemo(
    () => guestVisits.filter((v) => v.appt.clientName === activeGuest),
    [guestVisits, activeGuest],
  )
  const [noteText, setNoteText] = useState('')
  const history = useMemo(() => {
    const real: PastVisit[] = realVisits.map((v) => ({
      invoice: v.invoice, date: v.date, services: v.services,
      status: 'CLOSED', price: v.price, techName: v.techName, paymentId: v.paymentId,
    }))
    return [...real, ...mockHistory(client)]
  }, [client, realVisits])
  const settings = useSettingsStore()
  const balance = pointsBalance
  const upcoming = appts.filter((a) => a.clientName === client.name)
  const [draft, setDraft] = useState({ name: client.name, phone: client.phone, tags: 'Regular Guest' })
  const [saved, setSaved] = useState(false)

  const initials = client.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const field =
    'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring'
  const label = 'mb-1 block text-[11px] font-medium text-muted-foreground'

  const saveProfile = () => {
    onSaveProfile({ name: draft.name.trim() || client.name, phone: draft.phone.trim() || client.phone })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-[92] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="flex h-[88vh] w-[62rem] max-w-[96vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-border bg-secondary/40 px-5 py-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-background text-sm font-bold">{initials}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-bold">{client.name}</span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600">Regular Guest</span>
              {client.visits > 15 && (
                <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                  <Crown className="h-3 w-3" /> High Spender
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{client.phone}</span>
              <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{client.name.split(' ')[0].toLowerCase()}@email.com</span>
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />Gloss Nail Bar</span>
            </div>
          </div>
          <button className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
          <button onClick={onClose} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* tabs */}
        <div className="flex gap-5 border-b border-border px-5 text-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 py-2.5 ${tab === t.id ? 'border-sky-500 font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
              {t.id === 'notes' && notes.length > 0 && (
                <span className="ml-1.5 rounded-full bg-sky-500/15 px-1.5 text-[10px] text-sky-600">{notes.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'overview' && (
            <div className="grid grid-cols-3 gap-4">
              {/* left column */}
              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Personal info</div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{client.phone}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Preferred tech</span>
                      <span>{client.usualTechId ? techById(client.usualTechId)?.name ?? 'Unknown' : 'Any'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Preferred center</span><span>Gloss Nail Bar</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Member since</span><span>Mar 2024</span></div>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <CreditCard className="h-3.5 w-3.5" /> Saved cards
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>VISA ···· 3758</span>
                    <span className="text-[11px] text-muted-foreground">exp 2/2029</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">Deposits & card-on-file arrive with payments in Phase 3.</div>
                </div>
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-600">
                    <Star className="h-3.5 w-3.5" /> Loyalty
                  </div>
                  <div className="mt-1 text-lg font-bold">{balance.toLocaleString()} pts</div>
                </div>
              </div>

              {/* right column */}
              <div className="col-span-2 space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  {[
                    ['Total visits', client.visits],
                    ['Upcoming', upcoming.length],
                    ['Amount due', '$0.00'],
                    ['Loyalty pts', balance.toLocaleString()],
                  ].map(([k, v]) => (
                    <div key={k as string} className="rounded-lg border border-border p-3 text-center">
                      <div className="text-lg font-bold">{v}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-border">
                  <div className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recent appointments
                  </div>
                  {upcoming.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5 text-sm last:border-0">
                      <span className="w-24 text-muted-foreground">Today</span>
                      <span className="min-w-0 flex-1 truncate">{svcById[a.serviceId].name} · {fmtTime(a.startMin)}</span>
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">UPCOMING</span>
                      <span className="w-16 text-right">${svcById[a.serviceId].price}</span>
                      <span className="w-24 truncate text-right text-muted-foreground">{techById(a.techId)?.name ?? 'Unknown'}</span>
                    </div>
                  ))}
                  {history.slice(0, 4).map((h) => (
                    <div key={h.invoice} className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5 text-sm last:border-0">
                      <span className="w-24 text-muted-foreground">{h.date}</span>
                      <span className="min-w-0 flex-1 truncate">{h.services.join(' + ')}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[h.status]}`}>{h.status}</span>
                      <span className="w-16 text-right">${h.price.toFixed(2)}</span>
                      <span className="w-24 truncate text-right text-muted-foreground">{h.techName}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'profile' && (
            <div className="max-w-3xl space-y-5">
              <div className="grid grid-cols-3 gap-4">
                <div><label className={label}>First name *</label><input className={field} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></div>
                <div><label className={label}>Phone *</label><input className={field} value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} /></div>
                <div><label className={label}>Email</label><input className={field} placeholder="guest@email.com" /></div>
                <div>
                  <label className={label}>Gender</label>
                  <select className={field}><option>Prefer not to say</option><option>Female</option><option>Male</option><option>Other</option></select>
                </div>
                <div>
                  <label className={label}>Birthday (optional)</label>
                  <div className="flex gap-2">
                    <select className={field}><option>Month</option>{Array.from({ length: 12 }, (_, i) => <option key={i}>{i + 1}</option>)}</select>
                    <select className={field}><option>Day</option>{Array.from({ length: 31 }, (_, i) => <option key={i}>{i + 1}</option>)}</select>
                  </div>
                </div>
                <div>
                  <label className={label}>Preferred technician</label>
                  <select className={field} defaultValue={client.usualTechId ?? ''}>
                    <option value="">Any</option>
                    {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2"><label className={label}>Street address</label><input className={field} placeholder="Street address" /></div>
                <div><label className={label}>City</label><input className={field} placeholder="Houston" /></div>
                <div>
                  <label className={label}>State</label>
                  <select className={field}><option>Texas</option><option>Other</option></select>
                </div>
                <div><label className={label}>Zip code</label><input className={field} placeholder="77000" /></div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notification preferences</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" defaultChecked className="accent-sky-500" /> Transactional, SMS</label>
                  <label className="flex items-center gap-2"><input type="checkbox" defaultChecked className="accent-sky-500" /> Marketing, SMS</label>
                  <label className="flex items-center gap-2"><input type="checkbox" defaultChecked className="accent-sky-500" /> Transactional, Email</label>
                  <label className="flex items-center gap-2"><input type="checkbox" className="accent-sky-500" /> Marketing, Email</label>
                </div>
                <label className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-sm text-red-500">
                  <input type="checkbox" className="accent-red-500" /> Block guest from online appointment booking
                </label>
              </div>

              <div className="flex items-center gap-3">
                <button onClick={saveProfile} className="rounded-md bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                  Save
                </button>
                {saved && <span className="text-sm text-emerald-500">✓ Profile saved</span>}
              </div>
            </div>
          )}

          {tab === 'notes' && (
            <div className="max-w-2xl space-y-3">
              <div className="flex gap-2">
                <input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && noteText.trim()) { onAddNote(noteText.trim()); setNoteText('') }
                  }}
                  placeholder="Add a note, allergies, preferences, design refs"
                  className={field}
                />
                <button
                  onClick={() => { if (noteText.trim()) { onAddNote(noteText.trim()); setNoteText('') } }}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                >
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>
              {notes.length === 0 && (
                <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                  No notes available for this guest yet.
                </div>
              )}
              {notes.map((n) => (
                <div key={n.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{n.text}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{n.when} · by {n.by}</div>
                  </div>
                  <button onClick={() => setPendingNoteId(n.id)} className="text-muted-foreground hover:text-red-400" title="Delete note">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === 'appointments' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border">
                <div className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Upcoming appointments
                </div>
                {upcoming.length === 0 && (
                  <div className="px-4 py-3 text-sm text-sky-600">ⓘ There are no upcoming appointments for this guest</div>
                )}
                {upcoming.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5 text-sm last:border-0">
                    <span className="w-24 text-muted-foreground">Today</span>
                    <span className="min-w-0 flex-1 truncate">{svcById[a.serviceId].name} · {fmtTime(a.startMin)}</span>
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">OPEN</span>
                    <span className="w-16 text-right">${svcById[a.serviceId].price.toFixed(2)}</span>
                    <span className="w-28 truncate text-right text-muted-foreground">{techById(a.techId)?.name ?? 'Unknown'}</span>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                <div className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Past appointments
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Invoice no</th>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Services</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">Price</th>
                      <th className="px-4 py-2 text-right font-medium">Technician</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.invoice} className="border-b border-border/50 last:border-0 hover:bg-accent/50">
                        <td className="px-4 py-2.5 text-sky-600">
                          {h.paymentId && onViewInvoice ? (
                            <button
                              type="button"
                              onClick={() => onViewInvoice(h.paymentId!)}
                              className="font-semibold underline decoration-sky-300 underline-offset-2 hover:text-sky-800"
                              title="View invoice"
                            >
                              {h.invoice}
                            </button>
                          ) : h.invoice}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{h.date}</td>
                        <td className="max-w-56 truncate px-4 py-2.5">{h.services.join(' + ')}</td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[h.status]}`}>{h.status}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">${h.price.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{h.techName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'guests' && (
            <div>
              {guestNames.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                  <p className="font-semibold text-foreground">No guests yet</p>
                  <p className="max-w-sm">
                    When {client.name.split(' ')[0]} brings someone along, add them as a name-only guest while booking,
                    their visits will be tracked right here.
                  </p>
                </div>
              ) : (
                <div className="flex gap-4">
                  {/* guest list, click a name to see their history */}
                  <div className="w-48 shrink-0 space-y-1">
                    {guestNames.map((name) => {
                      const count = guestVisits.filter((v) => v.appt.clientName === name).length
                      return (
                        <button
                          key={name}
                          onClick={() => setSelGuest(name)}
                          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                            activeGuest === name ? 'border-sky-500/50 bg-sky-500/10 font-semibold' : 'border-border hover:bg-accent'
                          }`}
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-bold">
                            {name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{name}</span>
                          <span className="tnum text-[10px] text-muted-foreground">{count}</span>
                        </button>
                      )
                    })}
                  </div>
                  {/* visit history for the selected guest */}
                  <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border">
                    <div className="border-b border-border bg-secondary/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {activeGuest}, guest history
                    </div>
                    {activeVisits.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">No visits yet</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                            <th className="px-4 py-2 font-medium">Date</th>
                            <th className="px-4 py-2 font-medium">Time</th>
                            <th className="px-4 py-2 font-medium">Service</th>
                            <th className="px-4 py-2 text-right font-medium">Amount</th>
                            <th className="px-4 py-2 text-right font-medium">Technician</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeVisits.map(({ dateKey, appt }) => {
                            const svc = svcById[appt.serviceId]
                            return (
                              <tr key={appt.id} className="border-b border-border/60 last:border-0">
                                <td className="px-4 py-2.5">{new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                                <td className="tnum px-4 py-2.5">{fmtTime(appt.startMin)}</td>
                                <td className="max-w-56 truncate px-4 py-2.5">{svc?.name ?? appt.serviceId}</td>
                                <td className="tnum px-4 py-2.5 text-right">${svc?.price ?? 0}</td>
                                <td className="px-4 py-2.5 text-right text-muted-foreground">{techById(appt.techId)?.name ?? 'Unknown'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'loyalty' && (
            <div className="space-y-4">
              {/* balance */}
              <div className="flex items-center gap-4 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
                <Star className="h-8 w-8 text-violet-500" />
                <div className="flex-1">
                  <div className="text-lg font-bold">{balance.toLocaleString()} pts</div>
                  <div className="text-[11px] text-muted-foreground">
                    {settings.loyalty.pointsPerDollar} pt per $1 · {settings.loyalty.redemptions.filter((r) => r.active && balance >= r.pointsCost).length} reward{settings.loyalty.redemptions.filter((r) => r.active && balance >= r.pointsCost).length === 1 ? '' : 's'} within reach
                  </div>
                </div>
              </div>

              {/* what they can redeem */}
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Available rewards</div>
                {settings.loyalty.redemptions.filter((r) => r.active).length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">No rewards configured yet</p>
                )}
                {settings.loyalty.redemptions.filter((r) => r.active).map((r) => {
                  const reach = balance >= r.pointsCost
                  return (
                    <div key={r.id} className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5 last:border-0">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${reach ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className="min-w-0 flex-1 text-sm font-medium">{r.name || 'Reward'}</span>
                      <span className={`tnum text-[11px] font-bold ${reach ? 'text-violet-500' : 'text-muted-foreground'}`}>
                        {r.pointsCost.toLocaleString()} pts
                      </span>
                      <span className="text-[10.5px] text-muted-foreground">
                        {reach ? 'ready at checkout' : `${(r.pointsCost - balance).toLocaleString()} to go`}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* history */}
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</div>
                {loyaltyHistory.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">Points appear here after their first checkout</p>
                )}
                {[...loyaltyHistory].reverse().map((p) => (
                  <div key={p.id} className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5 last:border-0">
                    <span className="text-[12px] text-muted-foreground">
                      {new Date(p.dateKey + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <span className="tnum min-w-0 flex-1 truncate text-sm text-muted-foreground">${p.total.toFixed(2)} ticket</span>
                    {p.redeemed && (
                      <span className="tnum shrink-0 text-[12px] font-semibold text-violet-500">−{p.redeemed.points.toLocaleString()} pts · {p.redeemed.name}</span>
                    )}
                    <span className="tnum shrink-0 text-[12px] font-semibold text-emerald-600">+{p.points.toLocaleString()} pts</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* delete-note confirmation */}
      {pendingNoteId && (
        <ConfirmDialog
          title="Delete this note?"
          body={notes.find((n) => n.id === pendingNoteId)?.text}
          confirmLabel="Delete note"
          onConfirm={() => onDeleteNote(pendingNoteId)}
          onClose={() => setPendingNoteId(null)}
        />
      )}
    </div>
  )
}
