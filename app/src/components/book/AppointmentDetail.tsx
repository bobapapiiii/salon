import { useState } from 'react'
import {
  CalendarX, ClipboardCopy, Clock, CreditCard, Link2, Mail, MessageSquare, Phone, RefreshCw, X,
} from 'lucide-react'
import type { Appointment, ClientRecord } from '@/lib/booking-types'
import { CLOSE_MIN, OPEN_MIN, fmtTime } from '@/lib/booking-types'
import { useSettingsStore } from '@/lib/settings-store'
import { SERVICES } from '@/lib/mock-data'
import { boardTechs, useStaffStore } from '@/lib/staff-store'
import { svcById } from '@/lib/services-store'

const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180]

export type DetailAction = 'rebook' | 'cancel' | 'copy' | 'sendtext' | 'checkout'

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
    <div className="fixed inset-y-0 right-0 z-[85] flex w-[440px] max-w-[95vw] flex-col border-l border-border bg-popover shadow-2xl">
      {/* guest header */}
      <div className="border-b border-border bg-secondary/50 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-background text-sm font-bold">
            {appt.clientName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <button onClick={onViewProfile} className="truncate text-sm font-bold text-sky-600 hover:underline" title="Open guest profile">
              {appt.clientName}
            </button>
            <div className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {client?.phone ?? '(555) 842-1177'}</div>
              <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {appt.clientName.split(' ')[0].toLowerCase()}@email.com</div>
              <div className="flex items-center gap-1.5">Host: Front desk{group.length > 1 && (
                <span className="flex items-center gap-0.5 text-sky-500"><Link2 className="h-3 w-3" /> group of {group.length}</span>
              )}</div>
              <button onClick={onViewProfile} className="text-sky-600 hover:underline">View full profile →</button>
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* status */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Appointment['status'])}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {/* services */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Service details{group.length > 1 ? ` (${draft.length - removed.length})` : ''}
          </label>
          <div className="space-y-2">
            {draft.filter((d) => !removed.includes(d.id)).map((d) => (
              <div key={d.id} className="rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-2">
                  <select
                    value={d.serviceId}
                    onChange={(e) => {
                      const svc = svcById[e.target.value]
                      setSvc(d.id, { serviceId: svc.id, durationMin: svc.durationMin })
                    }}
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none"
                  >
                    {SERVICES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <span className="shrink-0 text-sm font-medium">${svcById[d.serviceId].price}</span>
                  {onCopyService && (
                    <button
                      onClick={() => onCopyService(d)}
                      title={`Copy ${svcById[d.serviceId].short} to the clipboard`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {draft.length - removed.length > 1 && (
                    <button onClick={() => setRemoved((r) => [...r, d.id])} className="shrink-0 text-muted-foreground hover:text-red-400">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <select value={d.startMin} onChange={(e) => setSvc(d.id, { startMin: Number(e.target.value) })}
                    className="rounded-md border border-input bg-background px-1.5 py-1 text-xs outline-none">
                    {TIME_OPTIONS.map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
                  </select>
                  <select value={d.durationMin} onChange={(e) => setSvc(d.id, { durationMin: Number(e.target.value) })}
                    className="rounded-md border border-input bg-background px-1.5 py-1 text-xs outline-none">
                    {DURATIONS.map((x) => <option key={x} value={x}>{x}m</option>)}
                  </select>
                  <select value={d.techId} onChange={(e) => setSvc(d.id, { techId: e.target.value })}
                    className="rounded-md border border-input bg-background px-1.5 py-1 text-xs outline-none">
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
                  <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Request</span>
                  <select
                    value={
                      d.techId === 'pref-female' || d.techId === 'pref-male' || d.techId === 'issue' ? d.techId
                      : d.techRequested ? 'requested'
                      : d.requestedTechChoice === 'pref-female' || d.requestedTechChoice === 'pref-male' ? d.requestedTechChoice
                      : 'any'
                    }
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === 'pref-female' || v === 'pref-male' || v === 'issue') {
                        setSvc(d.id, { techId: v, techRequested: undefined, requestedTechChoice: undefined })
                      } else if (v === 'requested') {
                        const concrete = d.techId === 'first' || d.techId === 'pref-female' || d.techId === 'pref-male' || d.techId === 'issue'
                          ? techs.find((t) => t.skills.includes(d.serviceId))?.id ?? 'first'
                          : d.techId
                        setSvc(d.id, { techId: concrete, techRequested: true, requestedTechChoice: undefined })
                      } else {
                        setSvc(d.id, { techRequested: undefined, requestedTechChoice: undefined })
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 py-1 text-xs outline-none"
                  >
                    <option value="any">Any tech</option>
                    <option value="requested">Requested</option>
                    <option value="pref-female">Female preferred</option>
                    <option value="pref-male">Male preferred</option>
                    <option value="issue">Issue</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-right text-[11px] text-muted-foreground">Total ${total.toFixed(2)}</div>
        </div>

        {/* notes */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Allergies, design references, preferences"
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* payment (Phase 3) */}
        <div className="flex gap-2">
          <button disabled className="flex-1 rounded-md border border-border py-2 text-xs text-muted-foreground opacity-50" title="Coming in Phase 3">
            Send payment link
          </button>
          <button disabled className="flex-1 rounded-md border border-border py-2 text-xs text-muted-foreground opacity-50" title="Coming in Phase 3">
            Take payment (Phase 3)
          </button>
        </div>

        {error && <p className="text-[12px] text-red-400">{error}</p>}
      </div>

      {/* footer actions */}
      <div className="space-y-2 border-t border-border p-3">
        {/* secondary actions, small row on top */}
        <div className="flex gap-1.5">
          <button onClick={() => onAction('rebook')} title="Rebook same time next week" className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
            <RefreshCw className="h-3 w-3" /> Rebook
          </button>
          <button onClick={() => onAction('copy')} title="Copy each service to the clipboard as its own entry" className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
            <ClipboardCopy className="h-3 w-3" /> Clipboard
          </button>
          <button onClick={() => onAction('sendtext')} title="Text the client" className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
            <MessageSquare className="h-3 w-3" /> Text
          </button>
          <button onClick={() => onAction('cancel')} title="Cancel this appointment" className="flex items-center justify-center gap-1 rounded-md border border-red-500/40 px-2.5 py-1.5 text-[11px] font-medium text-red-400 hover:bg-red-500/10">
            <CalendarX className="h-3 w-3" /> Cancel
          </button>
        </div>
        {(appt.status === 'confirmed' || appt.status === 'checked_in' || appt.status === 'in_service') && (
          <button
            onClick={() => onAction('checkout')}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-clay py-2 text-sm font-semibold text-white transition-colors hover:bg-clay-deep"
          >
            <CreditCard className="h-4 w-4" /> Check out {appt.clientName.split(' ')[0]}
          </button>
        )}
        <button
          onClick={() => onSave(draft.map((d) => ({ ...d, status: d.id === appt.id ? status : d.status, notes: d.id === appt.id ? notes || undefined : d.notes })), removed)}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <Clock className="h-4 w-4" /> Save changes
        </button>
      </div>
    </div>
  )
}
