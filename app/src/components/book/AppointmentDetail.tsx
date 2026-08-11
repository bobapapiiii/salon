import { useState } from 'react'
import {
  CalendarX, ClipboardCopy, Clock, CreditCard, Heart, Link2, Mail, MessageSquare, Phone, RefreshCw, ScrollText, X,
} from 'lucide-react'
import type { Appointment, ClientRecord } from '@/lib/booking-types'
import { CLOSE_MIN, OPEN_MIN, fmtTime } from '@/lib/booking-types'
import { useSettingsStore } from '@/lib/settings-store'
import { SERVICES } from '@/lib/mock-data'
import { boardTechs, useStaffStore } from '@/lib/staff-store'
import { svcById } from '@/lib/services-store'

const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180]

export type DetailAction = 'rebook' | 'cancel' | 'copy' | 'sendtext' | 'checkout' | 'log'

interface Props {
  appt: Appointment
  group: Appointment[]
  clients: ClientRecord[]
  error: string | null
  onSave: (updated: Appointment[], removedIds: string[]) => void
  onAction: (a: DetailAction) => void
  onCopyService?: (appt: Appointment) => void
  onViewProfile: () => void
  onClose: () => void
}

const STATUS_LABELS: Record<Appointment['status'], string> = {
  booked: 'Booked',
  requested: 'New (requested)',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_service: 'In service',
  completed: 'Completed',
  no_show: 'No-show',
}

/** small subset of AppointmentBook's STATUS_STYLE, duplicated locally to avoid a circular import */
const STATUS_DOT: Record<Appointment['status'], string> = {
  booked: '#D97706',
  requested: '#D97706',
  confirmed: '#3E9B4F',
  checked_in: '#D9A50B',
  in_service: '#D9A50B',
  completed: '#DC4444',
  no_show: '#B3402F',
}

/** matches the heart colors used on the calendar card, so the edit panel reads the same way */
const REQUEST_HEART_COLOR: Record<string, string | undefined> = {
  requested: '#16A34A',
  'pref-female': '#EC4899',
  'pref-male': '#2563EB',
  issue: '#F59E0B',
  any: undefined,
}

export function AppointmentDetail({ appt, group, clients, error, onSave, onAction, onCopyService, onViewProfile, onClose }: Props) {
  const increment = useSettingsStore().booking.increment
  const TIME_OPTIONS = Array.from({ length: (CLOSE_MIN - OPEN_MIN) / increment }, (_, i) => i * increment)
  const { roles, techs: allTechs } = useStaffStore()
  const techs = boardTechs(allTechs)
  const [draft, setDraft] = useState<Appointment[]>(group.map((g) => ({ ...g })))
  const [removed, setRemoved] = useState<string[]>([])
  const [status, setStatus] = useState(appt.status)
  const [notes, setNotes] = useState(appt.notes ?? '')

  const client = clients.find((c) => c.name === appt.clientName)
  const setSvc = (id: string, patch: Partial<Appointment>) =>
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  const total = draft.filter((d) => !removed.includes(d.id)).reduce((s, d) => s + svcById[d.serviceId].price, 0)

  return (
    <div className="fixed inset-y-0 right-0 z-[85] flex w-[440px] max-w-[95vw] flex-col border-l border-line bg-popover shadow-2xl">
      {/* guest header */}
      <div className="border-b border-line bg-cream px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-clay-tint text-sm font-bold text-clay">
            {appt.clientName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button onClick={onViewProfile} className="truncate text-[14px] font-bold text-ink hover:text-clay" title="Open guest profile">
                {appt.clientName}
              </button>
              <span
                className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                style={{ background: `${STATUS_DOT[status]}1a`, color: STATUS_DOT[status] }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_DOT[status] }} />
                {STATUS_LABELS[status]}
              </span>
            </div>
            <div className="mt-1 space-y-0.5 text-[11px] text-ink-faint">
              <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {client?.phone ?? '(555) 842-1177'}</div>
              <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {appt.clientName.split(' ')[0].toLowerCase()}@email.com</div>
              <div className="flex items-center gap-1.5">Host: Front desk{group.length > 1 && (
                <span className="flex items-center gap-0.5 text-clay"><Link2 className="h-3 w-3" /> group of {group.length}</span>
              )}</div>
              <button onClick={onViewProfile} className="font-semibold text-clay hover:underline">View full profile →</button>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* status */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Appointment['status'])}
            className="w-full rounded-[8px] border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {/* services */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Service details{group.length > 1 ? ` (${draft.length - removed.length})` : ''}
          </label>
          <div className="space-y-2">
            {draft.filter((d) => !removed.includes(d.id)).map((d) => {
              const isRequested = !!d.techRequested
              const requestKind =
                d.techId === 'pref-female' || d.techId === 'pref-male' || d.techId === 'issue' ? d.techId
                : d.techRequested ? 'requested'
                : d.requestedTechChoice === 'pref-female' || d.requestedTechChoice === 'pref-male' ? d.requestedTechChoice
                : 'any'
              const heartColor = REQUEST_HEART_COLOR[requestKind]
              return (
                <div key={d.id} className={`rounded-xl border p-2.5 ${isRequested ? 'border-clay/30 bg-clay-tint/30' : 'border-line'}`}>
                  <div className="flex items-center gap-2">
                    <select
                      value={d.serviceId}
                      onChange={(e) => {
                        const svc = svcById[e.target.value]
                        setSvc(d.id, { serviceId: svc.id, durationMin: svc.durationMin })
                      }}
                      className="min-w-0 flex-1 rounded-[8px] border border-input bg-background px-2 py-1 text-sm outline-none"
                    >
                      {SERVICES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <span className="tnum shrink-0 text-sm font-bold text-ink">${svcById[d.serviceId].price}</span>
                    {onCopyService && (
                      <button
                        onClick={() => onCopyService(d)}
                        title={`Copy ${svcById[d.serviceId].short} to the clipboard`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface hover:text-ink"
                      >
                        <ClipboardCopy className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {draft.length - removed.length > 1 && (
                      <button onClick={() => setRemoved((r) => [...r, d.id])} className="shrink-0 text-ink-faint hover:text-rust">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <select value={d.startMin} onChange={(e) => setSvc(d.id, { startMin: Number(e.target.value) })}
                      className="rounded-[8px] border border-input bg-background px-1.5 py-1 text-xs outline-none">
                      {TIME_OPTIONS.map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
                    </select>
                    <select value={d.durationMin} onChange={(e) => setSvc(d.id, { durationMin: Number(e.target.value) })}
                      className="rounded-[8px] border border-input bg-background px-1.5 py-1 text-xs outline-none">
                      {DURATIONS.map((x) => <option key={x} value={x}>{x}m</option>)}
                    </select>
                    <select value={d.techId} onChange={(e) => setSvc(d.id, { techId: e.target.value })}
                      className="rounded-[8px] border border-input bg-background px-1.5 py-1 text-xs outline-none">
                      <option value="first">First available</option>
                      {roles.map((role) => (
                        <optgroup key={role.id} label={role.name}>
                          {techs.filter((t) => t.teamId === role.id).sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="flex shrink-0 items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">
                      {heartColor && <Heart className="h-3 w-3 shrink-0" style={{ color: heartColor, fill: heartColor }} />}
                      Request
                    </span>
                    <select
                      value={requestKind}
                      onChange={(e) => {
                        const v = e.target.value
                        // a fresh request decision re-arms the gender-mismatch confirmation
                        if (v === 'pref-female' || v === 'pref-male' || v === 'issue') {
                          setSvc(d.id, { techId: v, techRequested: undefined, requestedTechChoice: undefined, genderMismatchOk: undefined })
                        } else if (v === 'requested') {
                          const concrete = d.techId === 'first' || d.techId === 'pref-female' || d.techId === 'pref-male' || d.techId === 'issue'
                            ? techs.find((t) => t.skills.includes(d.serviceId))?.id ?? 'first'
                            : d.techId
                          setSvc(d.id, { techId: concrete, techRequested: true, requestedTechChoice: undefined, genderMismatchOk: undefined })
                        } else {
                          setSvc(d.id, { techRequested: undefined, requestedTechChoice: undefined, genderMismatchOk: undefined })
                        }
                      }}
                      className="min-w-0 flex-1 rounded-[8px] border border-input bg-background px-1.5 py-1 text-xs outline-none"
                    >
                      <option value="any">Any tech</option>
                      <option value="requested">Requested</option>
                      <option value="pref-female">Female preferred</option>
                      <option value="pref-male">Male preferred</option>
                      <option value="issue">Issue</option>
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-1 text-right text-[11px] font-semibold text-ink-faint">Total <span className="tnum text-ink">${total.toFixed(2)}</span></div>
        </div>

        {/* notes */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Allergies, design references, preferences"
            className="w-full rounded-[8px] border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* payment (Phase 3) */}
        <div className="flex gap-2">
          <button disabled className="flex-1 rounded-[8px] border border-line py-2 text-xs text-ink-faint opacity-50" title="Coming in Phase 3">
            Send payment link
          </button>
          <button disabled className="flex-1 rounded-[8px] border border-line py-2 text-xs text-ink-faint opacity-50" title="Coming in Phase 3">
            Take payment (Phase 3)
          </button>
        </div>

        {error && <p className="text-[12px] font-medium text-rust">{error}</p>}
      </div>

      {/* footer actions */}
      <div className="space-y-2 border-t border-line p-3">
        {/* secondary actions, small row on top */}
        <div className="flex gap-1.5">
          <button onClick={() => onAction('rebook')} title="Rebook same time next week" className="flex flex-1 items-center justify-center gap-1 rounded-[8px] border border-line py-1.5 text-[11px] font-semibold text-ink-faint transition-colors hover:bg-cream hover:text-ink">
            <RefreshCw className="h-3 w-3" /> Rebook
          </button>
          <button onClick={() => onAction('copy')} title="Copy each service to the clipboard as its own entry" className="flex flex-1 items-center justify-center gap-1 rounded-[8px] border border-line py-1.5 text-[11px] font-semibold text-ink-faint transition-colors hover:bg-cream hover:text-ink">
            <ClipboardCopy className="h-3 w-3" /> Clipboard
          </button>
          <button onClick={() => onAction('sendtext')} title="Text the client" className="flex flex-1 items-center justify-center gap-1 rounded-[8px] border border-line py-1.5 text-[11px] font-semibold text-ink-faint transition-colors hover:bg-cream hover:text-ink">
            <MessageSquare className="h-3 w-3" /> Text
          </button>
          <button onClick={() => onAction('log')} title="Show appointment log" className="flex items-center justify-center gap-1 rounded-[8px] border border-line px-2.5 py-1.5 text-[11px] font-semibold text-ink-faint transition-colors hover:bg-cream hover:text-ink">
            <ScrollText className="h-3 w-3" />
          </button>
          <button onClick={() => onAction('cancel')} title="Cancel this appointment" className="flex items-center justify-center gap-1 rounded-[8px] border border-rust/40 px-2.5 py-1.5 text-[11px] font-semibold text-rust transition-colors hover:bg-rust-tint">
            <CalendarX className="h-3 w-3" /> Cancel
          </button>
        </div>
        {(appt.status === 'confirmed' || appt.status === 'checked_in' || appt.status === 'in_service') && (
          <button
            onClick={() => onAction('checkout')}
            className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-clay py-2 text-sm font-semibold text-white shadow-sh-1 transition-colors hover:bg-clay-deep"
          >
            <CreditCard className="h-4 w-4" /> Check out {appt.clientName.split(' ')[0]}
          </button>
        )}
        <button
          onClick={() => onSave(draft.map((d) => ({ ...d, status: d.id === appt.id ? status : d.status, notes: d.id === appt.id ? notes || undefined : d.notes })), removed)}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-clay py-2 text-sm font-semibold text-white shadow-sh-1 transition-colors hover:bg-clay-deep"
        >
          <Clock className="h-4 w-4" /> Save changes
        </button>
      </div>
    </div>
  )
}
