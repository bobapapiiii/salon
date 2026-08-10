import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, ChevronUp, Flag, Minus, Plus, Search, TriangleAlert, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import { FieldLabel, Modal, inputCls } from './shared'
import {
  fmtMoney,
  minToTime,
  prettyDate,
  techConflict,
  workWindow,
  type Appointment,
  type CategoryList,
  type ClientRow,
  type ServiceItem,
  type StaffMember,
} from './schedule-utils'

/* ═══════════════════════════════════════════════════════════════════
   QuickCreateModal — salon-schedule.md §6
   ═══════════════════════════════════════════════════════════════════ */

export interface CreatePrefill {
  staffId: number | null
  startMin: number | null
}

type Flag = 'none' | 'alert' | 'allergy'

export function QuickCreateModal({
  open,
  onClose,
  salonId,
  date,
  prefill,
  staff,
  categories,
  appointments,
}: {
  open: boolean
  onClose: () => void
  salonId: number
  date: string
  prefill: CreatePrefill
  staff: StaffMember[]
  categories: CategoryList
  appointments: Appointment[]
}) {
  const utils = trpc.useUtils()

  /* ── form state ── */
  const [clientSearch, setClientSearch] = useState('')
  const [client, setClient] = useState<ClientRow | null>(null)
  const [showNewClient, setShowNewClient] = useState(false)
  const [ncFirst, setNcFirst] = useState('')
  const [ncLast, setNcLast] = useState('')
  const [ncPhone, setNcPhone] = useState('')
  const [serviceId, setServiceId] = useState<number | null>(null)
  const [staffId, setStaffId] = useState<number | null>(null)
  const [startMin, setStartMin] = useState(600)
  const [secondOn, setSecondOn] = useState(false)
  const [service2Id, setService2Id] = useState<number | null>(null)
  const [staff2Id, setStaff2Id] = useState<number | null>(null)
  const [mode2, setMode2] = useState<'same' | 'chain'>('same')
  const [note, setNote] = useState('')
  const [flag, setFlag] = useState<Flag>('none')
  const [success, setSuccess] = useState(false)

  // Reset whenever the modal opens with new prefill
  useEffect(() => {
    if (!open) return
    setClientSearch('')
    setClient(null)
    setShowNewClient(false)
    setNcFirst(''); setNcLast(''); setNcPhone('')
    setServiceId(null)
    setStaffId(prefill.staffId)
    setStartMin(prefill.startMin ?? 600)
    setSecondOn(false)
    setService2Id(null)
    setStaff2Id(null)
    setMode2('same')
    setNote('')
    setFlag('none')
    setSuccess(false)
  }, [open, prefill])

  const clientsQ = trpc.clients.list.useQuery(
    { salonId, search: clientSearch || undefined },
    { enabled: open },
  )

  const createClient = trpc.clients.create.useMutation()
  const addNote = trpc.clients.addNote.useMutation()
  const createAppt = trpc.appointments.create.useMutation()
  const setStatus = trpc.appointments.updateStatus.useMutation()

  const allServices = useMemo(
    () =>
      categories.flatMap((c) =>
        c.services.map((s) => ({ ...s, catName: c.name as string })),
      ),
    [categories],
  )
  const svc = allServices.find((s) => s.id === serviceId) ?? null
  const svc2 = allServices.find((s) => s.id === service2Id) ?? null

  const qualified = (s: ServiceItem | null) =>
    s ? staff.filter((t) => t.active && t.serviceIds.includes(s.id)) : []

  // default tech for second service: first qualified *other* tech free at start
  useEffect(() => {
    if (!secondOn || !svc2 || staff2Id) return
    const first = qualified(svc2).find(
      (t) =>
        t.id !== staffId &&
        !techConflict(
          appointments,
          t.id,
          { startMin, endMin: startMin + svc2.durationMin, processingMin: svc2.processingMin, bufferMin: svc2.bufferMin },
        ),
    )
    if (first) setStaff2Id(first.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondOn, service2Id])

  const start2 = mode2 === 'same' ? startMin : startMin + (svc?.durationMin ?? 0)
  const endMin = Math.max(
    startMin + (svc?.durationMin ?? 0),
    secondOn && svc2 ? start2 + svc2.durationMin : 0,
  )

  /* ── live conflict preview ── */
  const preview = useMemo(() => {
    if (!svc) return null
    if (staffId != null) {
      const tech = staff.find((t) => t.id === staffId)
      if (!tech) return null
      const win = workWindow(tech, date)
      if (!win) return { ok: false, text: `${tech.name} is off on ${prettyDate(date)}` }
      if (startMin < win.start || startMin + svc.durationMin > win.end)
        return { ok: false, text: `Outside ${tech.name}'s hours (${minToTime(win.start)}–${minToTime(win.end)})` }
      if (
        techConflict(appointments, staffId, {
          startMin,
          endMin: startMin + svc.durationMin,
          processingMin: svc.processingMin,
          bufferMin: svc.bufferMin,
        })
      )
        return { ok: false, text: `Overlaps an existing appointment for ${tech.name}` }
      return { ok: true, text: `${tech.name} is free ${minToTime(startMin)}–${minToTime(startMin + svc.durationMin)}` }
    }
    return { ok: true, text: 'Goes to the Unassigned column' }
  }, [svc, staffId, staff, date, startMin, appointments])

  const newClientValid = ncFirst.trim().length > 0 && ncLast.trim().length > 0
  const valid =
    (client != null || (showNewClient && newClientValid)) &&
    svc != null &&
    (!client?.blocked) &&
    (!secondOn || svc2 != null) &&
    preview?.ok !== false

  const submit = async () => {
    if (!valid || !svc) return
    try {
      let clientId = client?.id
      if (clientId == null) {
        const created = await createClient.mutateAsync({
          salonId,
          firstName: ncFirst.trim(),
          lastName: ncLast.trim(),
          phone: ncPhone.trim() || undefined,
        })
        clientId = created.id
        await utils.clients.list.invalidate()
      }
      if (flag !== 'none') {
        await addNote.mutateAsync({
          clientId,
          kind: flag,
          text: flag === 'allergy' ? 'Allergy flagged at booking' : 'Alert flagged at booking',
          pinned: flag === 'allergy',
        })
      }
      const items: {
        serviceId: number
        staffId?: number | null
        startMin: number
      }[] = [{ serviceId: svc.id, staffId, startMin }]
      if (secondOn && svc2) {
        items.push({ serviceId: svc2.id, staffId: staff2Id, startMin: start2 })
      }
      const res = await createAppt.mutateAsync({
        salonId,
        clientId,
        date,
        items,
        source: 'front-desk',
        status: 'confirmed',
        noteToSalon: note.trim() || undefined,
        sameTimeGroupId: secondOn && mode2 === 'same' ? `st-${Date.now()}` : undefined,
      })
      setSuccess(true)
      await utils.appointments.byDate.invalidate({ salonId, date })
      toast.success('Appointment created', {
        action: {
          label: 'Undo',
          onClick: async () => {
            await setStatus.mutateAsync({ id: res.id, status: 'cancelled' })
            await utils.appointments.byDate.invalidate({ salonId, date })
            toast('Appointment cancelled')
          },
        },
      })
      setTimeout(onClose, 300)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not create'
      toast.error(msg.includes('conflict') ? 'Overlaps an existing appointment' : msg)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New appointment" subtitle={prettyDate(date)} width={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="flex flex-col gap-4"
      >
        {/* Row 1 — client combobox */}
        <div>
          <FieldLabel>Client</FieldLabel>
          {client ? (
            <div className="flex items-center gap-2 rounded-r-sm border border-line bg-cream/50 px-3 py-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-r-pill bg-clay-tint text-[10px] font-extrabold text-clay-deep">
                {client.firstName.charAt(0)}
                {client.lastName.charAt(0)}
              </span>
              <span className="text-[14px] font-bold">
                {client.firstName} {client.lastName}
              </span>
              {client.phone && <span className="text-small font-medium text-ink-soft tnum">{client.phone}</span>}
              {client.notes.filter((n) => n.kind === 'allergy' || n.kind === 'alert').map((n) => (
                <span
                  key={n.id}
                  className={cn(
                    'flex items-center gap-1 rounded-r-pill px-1.5 py-0.5 text-[10px] font-bold',
                    n.kind === 'allergy' ? 'bg-rust-tint text-rust' : 'bg-amber-tint text-amber',
                  )}
                >
                  {n.kind === 'allergy' ? <Flag className="h-2.5 w-2.5" fill="currentColor" /> : <TriangleAlert className="h-2.5 w-2.5" />}
                  {n.text}
                </span>
              ))}
              <button
                type="button"
                onClick={() => setClient(null)}
                className="ml-auto text-small font-bold text-clay hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                autoFocus
                className={cn(inputCls, 'pl-9')}
                placeholder="Search clients by name or phone…"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
              />
              {!showNewClient && (
                <div className="mt-1 max-h-44 overflow-y-auto rounded-r-sm border border-line bg-surface shadow-sh-1 schedule-scroll">
                  {(clientsQ.data ?? []).slice(0, 8).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setClient(c)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-cream"
                    >
                      <span className="text-[13.5px] font-bold">
                        {c.firstName} {c.lastName}
                      </span>
                      {c.phone && <span className="text-small font-medium text-ink-faint tnum">{c.phone}</span>}
                      {c.notes.some((n) => n.kind === 'allergy') && (
                        <Flag className="h-3 w-3 text-rust" fill="#B3402F" />
                      )}
                      {c.blocked && <span className="ml-auto rounded-r-pill bg-rust-tint px-1.5 text-[10px] font-bold text-rust">Blocked</span>}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowNewClient(true)}
                    className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-[13px] font-bold text-clay transition-colors hover:bg-clay-tint"
                  >
                    <UserPlus className="h-4 w-4" /> New client
                  </button>
                </div>
              )}
            </div>
          )}
          {showNewClient && !client && (
            <div className="mt-2 grid grid-cols-3 gap-2 rounded-r-sm border border-line bg-cream/40 p-2.5">
              <input className={inputCls} placeholder="First name *" value={ncFirst} onChange={(e) => setNcFirst(e.target.value)} />
              <input className={inputCls} placeholder="Last name *" value={ncLast} onChange={(e) => setNcLast(e.target.value)} />
              <input className={inputCls} placeholder="Phone" value={ncPhone} onChange={(e) => setNcPhone(e.target.value)} />
            </div>
          )}
          {client?.blocked && (
            <div className="mt-2 rounded-r-sm border border-rust/40 bg-rust-tint p-2.5 text-[13px] font-semibold text-rust">
              This client is blocked from booking.{' '}
              <Link to="/salon/clients" className="underline" onClick={onClose}>
                View client →
              </Link>
            </div>
          )}
        </div>

        {/* Row 2 — service + tech */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Service</FieldLabel>
            <select
              className={inputCls}
              value={serviceId ?? ''}
              onChange={(e) => {
                const id = Number(e.target.value) || null
                setServiceId(id)
                const s = allServices.find((x) => x.id === id)
                if (s && staffId != null && !s.staffIds.includes(staffId)) setStaffId(null)
              }}
            >
              <option value="" disabled>
                Choose a service…
              </option>
              {categories.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.durationMin}m · {fmtMoney(s.priceCents)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Technician</FieldLabel>
            <select
              className={inputCls}
              value={staffId ?? ''}
              onChange={(e) => setStaffId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Unassigned</option>
              {staff.map((t) => {
                const ok = svc ? t.serviceIds.includes(svc.id) : true
                return (
                  <option key={t.id} value={t.id} disabled={!ok}>
                    {t.name}
                    {!ok ? ' (not qualified)' : ''}
                  </option>
                )
              })}
            </select>
          </div>
        </div>

        {/* Row 3 — date + start + end */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Date</FieldLabel>
            <input className={cn(inputCls, 'tnum')} type="date" value={date} readOnly disabled title="Date follows the viewed day" />
          </div>
          <div>
            <FieldLabel>Start time</FieldLabel>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="15 minutes earlier"
                onClick={() => setStartMin((m) => Math.max(0, m - 15))}
                className="flex h-10 w-9 shrink-0 items-center justify-center rounded-r-sm border border-line text-ink-soft transition-colors hover:bg-cream"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                className={cn(inputCls, 'text-center tnum')}
                value={minToTime(startMin)}
                onChange={(e) => {
                  const m = /^(\d{1,2}):(\d{2})$/.exec(e.target.value)
                  if (m) setStartMin(Math.min(1439, Number(m[1]) * 60 + Number(m[2])))
                }}
              />
              <button
                type="button"
                aria-label="15 minutes later"
                onClick={() => setStartMin((m) => Math.min(1439, m + 15))}
                className="flex h-10 w-9 shrink-0 items-center justify-center rounded-r-sm border border-line text-ink-soft transition-colors hover:bg-cream"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {svc && (
              <p className="mt-1 text-small font-semibold text-ink-faint tnum">→ ends {minToTime(endMin)}</p>
            )}
          </div>
        </div>

        {/* Row 4 — same-time second service */}
        <div className="rounded-r-md border border-line">
          <button
            type="button"
            onClick={() => setSecondOn((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-[13.5px] font-bold text-ink transition-colors hover:bg-cream"
          >
            {secondOn ? <ChevronUp className="h-4 w-4 text-clay" /> : <ChevronDown className="h-4 w-4 text-clay" />}
            Add a same-time service
            <span className="ml-auto text-small font-medium text-ink-faint">mani + pedi, color + cut…</span>
          </button>
          <AnimatePresence initial={false}>
            {secondOn && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-3 border-t border-line p-3">
                  <div>
                    <FieldLabel>Second service</FieldLabel>
                    <select className={inputCls} value={service2Id ?? ''} onChange={(e) => setService2Id(Number(e.target.value) || null)}>
                      <option value="" disabled>
                        Choose…
                      </option>
                      {categories.map((c) => (
                        <optgroup key={c.id} label={c.name}>
                          {c.services.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} · {s.durationMin}m
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div>
                    <FieldLabel>Technician</FieldLabel>
                    <select className={inputCls} value={staff2Id ?? ''} onChange={(e) => setStaff2Id(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Unassigned</option>
                      {staff.map((t) => {
                        const ok = svc2 ? t.serviceIds.includes(svc2.id) : true
                        return (
                          <option key={t.id} value={t.id} disabled={!ok}>
                            {t.name}
                            {!ok ? ' (not qualified)' : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div className="col-span-2 flex gap-1.5">
                    {(
                      [
                        ['same', `At the same time · ${minToTime(startMin)}`],
                        ['chain', `Back-to-back · starts ${minToTime(startMin + (svc?.durationMin ?? 0))}`],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setMode2(v)}
                        className={cn(
                          'rounded-r-pill border px-3 py-1.5 text-[12px] font-bold transition-colors tnum',
                          mode2 === v
                            ? 'border-clay bg-clay-tint text-clay'
                            : 'border-line bg-surface text-ink-soft hover:border-line-strong',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Row 5 — note + flag */}
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <div>
            <FieldLabel>Note to salon</FieldLabel>
            <textarea
              className="w-full resize-none rounded-r-sm border border-line bg-surface px-3 py-2 text-[13.5px] font-medium transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/30"
              rows={2}
              placeholder="Anything the team should know…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Flag as</FieldLabel>
            <div className="flex gap-1">
              {(['none', 'alert', 'allergy'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFlag(f)}
                  className={cn(
                    'rounded-r-pill border px-2.5 py-1.5 text-[11.5px] font-bold capitalize transition-colors',
                    flag === f
                      ? f === 'allergy'
                        ? 'border-rust bg-rust-tint text-rust'
                        : f === 'alert'
                          ? 'border-amber bg-amber-tint text-amber'
                          : 'border-ink-soft bg-cream text-ink'
                      : 'border-line bg-surface text-ink-soft hover:border-line-strong',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer — conflict preview + actions */}
        <div className="mt-1 flex items-center gap-3 border-t border-line pt-3">
          {preview && (
            <p
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-bold',
                preview.ok ? 'text-olive' : 'text-rust',
              )}
            >
              {preview.ok ? <Check className="h-3.5 w-3.5 shrink-0" /> : <TriangleAlert className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{preview.text}</span>
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-r-md px-4 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-cream"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || createAppt.isPending}
            className={cn(
              'flex h-10 items-center gap-2 rounded-r-md px-4 text-[14px] font-semibold text-white shadow-sh-1 transition-all duration-150',
              success
                ? 'bg-olive'
                : 'bg-clay hover:-translate-y-px hover:bg-clay-deep active:translate-y-0',
              (!valid || createAppt.isPending) && 'cursor-not-allowed opacity-45 hover:translate-y-0 hover:bg-clay',
            )}
          >
            {success ? (
              <>
                <Check className="h-4 w-4" /> Created
              </>
            ) : createAppt.isPending ? (
              'Creating…'
            ) : (
              'Create appointment'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
