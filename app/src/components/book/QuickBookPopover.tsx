import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { Tech } from '@/lib/booking-types'
import { fmtTime } from '@/lib/booking-types'
import { CLIENTS, SERVICES } from '@/lib/mock-data'
import { COMBO_ID } from '@/lib/mock-data'

export interface QuickBookRequest {
  techId: string
  startMin: number
  x: number
  y: number
}

export interface QuickBookResult {
  clientName: string
  serviceId: string // may be COMBO_ID
  notes?: string
}

interface Props {
  req: QuickBookRequest
  tech: Tech
  onConfirm: (r: QuickBookResult) => void
  onClose: () => void
  error?: string | null
}

export function QuickBookPopover({ req, tech, onConfirm, onClose, error }: Props) {
  const [client, setClient] = useState('')
  const [serviceId, setServiceId] = useState(SERVICES[0].id)
  const [notes, setNotes] = useState('')
  const [showClients, setShowClients] = useState(false)

  const clientMatches = useMemo(() => {
    if (!client.trim()) return CLIENTS.slice(0, 5)
    const s = client.toLowerCase()
    return CLIENTS.filter((c) => c.name.toLowerCase().includes(s)).slice(0, 5)
  }, [client])

  const svc = SERVICES.find((s) => s.id === serviceId)
  const lacksSkill = svc && !tech.skills.includes(svc.id)

  // keep popover on screen
  const left = Math.min(req.x, window.innerWidth - 340)
  const top = Math.min(req.y, window.innerHeight - 380)

  return (
    <div className="fixed inset-0 z-[80]" onClick={onClose}>
      <div
        className="absolute w-80 rounded-lg border border-border bg-popover shadow-2xl"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-sm font-semibold">Quick book</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-3">
          <div className="flex gap-2 text-[11px] text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">{tech.name}</span>
            <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">{fmtTime(req.startMin)}</span>
          </div>

          <div className="relative">
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Client</label>
            <input
              autoFocus
              value={client}
              onChange={(e) => { setClient(e.target.value); setShowClients(true) }}
              onFocus={() => setShowClients(true)}
              onBlur={() => setTimeout(() => setShowClients(false), 150)}
              placeholder="Search or type new name"
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {showClients && clientMatches.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-xl">
                {clientMatches.map((c) => (
                  <button
                    key={c.id}
                    onMouseDown={() => { setClient(c.name); setShowClients(false) }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span>{c.name}</span>
                    <span className="text-[10px] text-muted-foreground">{c.visits} visits</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Service</label>
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              <option value={COMBO_ID}>✨ Mani + Pedi (same time, 2 techs)</option>
              <optgroup label="Services">
                {SERVICES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.durationMin}m · ${s.price}
                  </option>
                ))}
              </optgroup>
            </select>
            {serviceId === COMBO_ID && (
              <p className="mt-1 text-[11px] text-emerald-400">
                Books {tech.name} for hands + auto-assigns a free pedi specialist.
              </p>
            )}
            {lacksSkill && serviceId !== COMBO_ID && (
              <p className="mt-1 text-[11px] text-amber-400">
                ⚠ {tech.name} isn't tagged for this service, front desk override allowed.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Notes</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional, allergies, design refs"
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          <button
            onClick={() => client.trim() && onConfirm({ clientName: client.trim(), serviceId, notes: notes || undefined })}
            disabled={!client.trim()}
            className="w-full rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Book appointment
          </button>
        </div>
      </div>
    </div>
  )
}
