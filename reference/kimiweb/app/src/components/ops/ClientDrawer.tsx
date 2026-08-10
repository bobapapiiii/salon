import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Ban,
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  Flag,
  Mail,
  Phone,
  Pin,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import Avatar, { tintForName } from '@/components/ops/Avatar'
import { Toggle } from '@/components/ops/primitives'
import { CAT, catKey, fmtMin, fmtPrice, parseDay, todayStr } from '@/components/ops/format'

type NoteKind = 'allergy' | 'alert' | 'preference' | 'general'

const NOTE_CARD: Record<NoteKind, string> = {
  allergy: 'bg-rust-tint text-rust',
  alert: 'bg-amber-tint text-amber',
  preference: 'bg-cream text-ink-soft',
  general: 'bg-cream text-ink-soft',
}

const KIND_ORDER: NoteKind[] = ['allergy', 'alert', 'preference', 'general']

function statusChip(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-cream text-ink-soft'
    case 'no-show':
      return 'bg-rust-tint text-rust'
    case 'cancelled':
      return 'bg-cream text-ink-faint line-through'
    case 'confirmed':
    case 'checked-in':
      return 'bg-olive-tint text-olive'
    case 'in-progress':
      return 'bg-clay-tint text-clay'
    default:
      return 'bg-amber-tint text-amber'
  }
}

/**
 * Client Detail Drawer — salon-clients.md §3. Right-anchored 440px, spring
 * entrance, pinned notes + composer, upcoming + history, footer stats,
 * block toggle. Shared by the Clients page and the Requests detail pane.
 */
export default function ClientDrawer({
  clientId,
  onClose,
}: {
  clientId: number | null
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {clientId != null && (
        <motion.div key="drawer-root" className="fixed inset-0 z-[60]">
          <motion.button
            aria-label="Close client panel"
            className="absolute inset-0 cursor-default bg-[rgba(42,33,26,.28)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label="Client details"
            className="absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col bg-surface shadow-sh-3"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 34 }}
          >
            <DrawerBody clientId={clientId} onClose={onClose} />
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function DrawerBody({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const utils = trpc.useUtils()
  const clientQ = trpc.clients.get.useQuery({ id: clientId })
  const salonQ = trpc.salon.get.useQuery()
  const servicesQ = trpc.services.list.useQuery(
    { salonId: salonQ.data?.id ?? 0 },
    { enabled: !!salonQ.data },
  )

  const [confirmBlock, setConfirmBlock] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [noteKind, setNoteKind] = useState<NoteKind>('general')
  const [noteText, setNoteText] = useState('')
  const [notePinned, setNotePinned] = useState(true)

  const update = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.clients.get.invalidate({ id: clientId })
      utils.clients.list.invalidate()
    },
  })
  const addNote = trpc.clients.addNote.useMutation({
    onSuccess: () => {
      utils.clients.get.invalidate({ id: clientId })
      utils.clients.list.invalidate()
      setNoteText('')
      setComposerOpen(false)
      toast.success('Note added')
    },
    onError: () => toast.error('Could not add note'),
  })

  const catNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of servicesQ.data ?? []) for (const s of c.services) m.set(s.id, c.name)
    return m
  }, [servicesQ.data])

  if (clientQ.isLoading || !clientQ.data) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-line bg-cream p-6">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 animate-pulse rounded-r-pill bg-line" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-40 animate-pulse rounded-r-sm bg-line" />
              <div className="h-3 w-56 animate-pulse rounded-r-sm bg-line" />
            </div>
          </div>
        </div>
        <div className="space-y-3 p-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-r-md bg-cream" />
          ))}
        </div>
      </div>
    )
  }

  const client = clientQ.data
  const fullName = `${client.firstName} ${client.lastName}`
  const notes = [...client.notes].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const today = todayStr()

  const upcoming = client.appointments
    .filter((a) => a.date >= today && !['cancelled', 'no-show', 'completed'].includes(a.status))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)
    .slice(0, 2)

  const history = client.appointments
    .filter((a) => a.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startMin - a.startMin)

  const completed = client.appointments.filter((a) => a.status === 'completed')
  const totalSpent = completed.reduce(
    (sum, a) => sum + a.items.reduce((s, i) => s + i.priceCents, 0),
    0,
  )

  const historyByMonth = new Map<string, typeof history>()
  for (const a of history) {
    const key = format(parseDay(a.date), 'MMMM yyyy')
    const arr = historyByMonth.get(key) ?? []
    arr.push(a)
    historyByMonth.set(key, arr)
  }

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {})
    toast.success(`${label} copied`)
  }

  const toggleBlocked = () => {
    if (!client.blocked && !confirmBlock) {
      setConfirmBlock(true)
      window.setTimeout(() => setConfirmBlock(false), 3000)
      return
    }
    setConfirmBlock(false)
    update.mutate(
      { id: client.id, data: { blocked: !client.blocked } },
      {
        onSuccess: () =>
          toast.success(client.blocked ? `${client.firstName} unblocked` : `${client.firstName} blocked from booking`),
        onError: () => toast.error('Could not update client'),
      },
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 1 — Header band */}
      <div className="relative shrink-0 border-b border-line bg-cream p-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-9 w-9 cursor-pointer items-center justify-center rounded-r-md text-ink-soft transition-colors hover:bg-surface hover:text-ink"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
        <div className="flex items-center gap-4">
          <Avatar initials={`${client.firstName[0] ?? ''}${client.lastName[0] ?? ''}`.toUpperCase()} tint={tintForName(fullName)} size={56} />
          <div className="min-w-0">
            <h2 className="truncate font-display text-[22px] font-semibold leading-7">{fullName}</h2>
            <p className="text-small font-medium text-ink-soft tnum">
              Client since {format(new Date(client.createdAt), 'MMM yyyy')} · {completed.length} visits
            </p>
            {client.blocked && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-r-pill bg-rust px-2 py-0.5 text-micro font-bold uppercase text-white">
                <Ban className="h-3 w-3" /> Blocked
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          {client.phone && (
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Phone className="h-3.5 w-3.5 text-ink-faint" />
              <span className="tnum">{client.phone}</span>
              <button
                type="button"
                aria-label="Copy phone"
                onClick={() => copy('Phone', client.phone!)}
                className="cursor-pointer text-ink-faint transition-colors hover:text-clay"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {client.email && (
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink-soft">
              <Mail className="h-3.5 w-3.5 text-ink-faint" />
              <span className="truncate">{client.email}</span>
              <button
                type="button"
                aria-label="Copy email"
                onClick={() => copy('Email', client.email!)}
                className="shrink-0 cursor-pointer text-ink-faint transition-colors hover:text-clay"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={toggleBlocked}
          className={cn(
            'mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-r-md border px-3 text-[13px] font-semibold transition-colors',
            client.blocked
              ? 'border-line bg-surface text-ink hover:bg-cream'
              : confirmBlock
                ? 'border-rust bg-rust text-white'
                : 'border-line bg-transparent text-rust hover:bg-rust-tint',
          )}
        >
          {client.blocked ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
          {client.blocked ? 'Unblock client' : confirmBlock ? 'Tap again to confirm block' : 'Block client'}
        </button>
      </div>

      {/* Scrollable sections */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 2 — Pinned notes */}
        <section className="border-b border-line p-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-bold leading-[22px]">Notes</h3>
            <button
              type="button"
              onClick={() => setComposerOpen((v) => !v)}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-r-md px-2.5 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
            >
              <Plus className="h-4 w-4" /> Add note
            </button>
          </div>

          <AnimatePresence initial={false}>
            {composerOpen && (
              <motion.div
                key="composer"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="mb-3 rounded-r-md border border-line bg-paper p-3">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={2}
                    placeholder="Note for the front desk…"
                    className="w-full resize-none rounded-r-sm border border-line bg-surface px-3 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-clay focus:ring-2 focus:ring-clay/30"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {KIND_ORDER.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setNoteKind(k)}
                        className={cn(
                          'h-7 cursor-pointer rounded-r-pill border px-2.5 text-[11px] font-bold capitalize transition-colors',
                          noteKind === k
                            ? 'border-clay bg-clay-tint text-clay'
                            : 'border-line bg-surface text-ink-soft hover:bg-cream',
                        )}
                      >
                        {k}
                      </button>
                    ))}
                    <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft">
                      <Pin className="h-3 w-3" /> Pinned
                      <Toggle small checked={notePinned} onChange={setNotePinned} label="Pin note" />
                    </span>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      disabled={!noteText.trim() || addNote.isPending}
                      onClick={() =>
                        addNote.mutate({ clientId: client.id, kind: noteKind, text: noteText.trim(), pinned: notePinned })
                      }
                      className="h-9 cursor-pointer rounded-r-md bg-clay px-4 text-[13px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-clay-deep disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {addNote.isPending ? 'Saving…' : 'Save note'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {notes.length === 0 && !composerOpen ? (
            <p className="text-small font-medium text-ink-faint">No notes yet — add allergies, alerts or preferences.</p>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {notes.map((n) => {
                  const kind = (NOTE_CARD[n.kind as NoteKind] ? n.kind : 'general') as NoteKind
                  return (
                    <motion.div
                      key={n.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className={cn('rounded-r-md p-3', NOTE_CARD[kind])}
                    >
                      <div className="flex items-center gap-1.5 text-micro font-bold uppercase">
                        {kind !== 'general' && <Flag className="h-3 w-3" />}
                        {n.pinned && <Pin className="h-3 w-3" />}
                        {kind}
                      </div>
                      <p className="mt-1 text-[13px] font-medium leading-[18px] text-ink">{n.text}</p>
                      <p className="mt-1 text-[11px] font-medium opacity-70 tnum">
                        {format(new Date(n.createdAt), 'MMM d, yyyy')}
                      </p>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* 3 — Upcoming */}
        <section className="border-b border-line p-6">
          <h3 className="mb-3 text-[15px] font-bold leading-[22px]">Upcoming</h3>
          {upcoming.length === 0 ? (
            <p className="text-small font-medium text-ink-faint">No upcoming appointments.</p>
          ) : (
            <div className="space-y-2">
              {upcoming.map((a) => {
                const first = a.items[0]
                const key = catKey(first ? catNameById.get(first.serviceId) : undefined)
                const c = CAT[key]
                const techs = [...new Set(a.items.map((i) => i.staff?.name).filter(Boolean))].join(', ')
                return (
                  <div key={a.id} className={cn('rounded-r-md border p-3', c.fill, c.line)}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-bold text-ink tnum">
                        {format(parseDay(a.date), 'EEE, MMM d')} · {fmtMin(a.startMin)}
                      </p>
                      <span className={cn('rounded-r-pill px-2 py-0.5 text-micro font-bold uppercase', statusChip(a.status))}>
                        {a.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12.5px] font-medium text-ink-soft">
                      {a.items.map((i) => i.service.name).join(' + ')}
                      {techs && ` · with ${techs}`}
                    </p>
                    <Link
                      to={`/salon/schedule?date=${a.date}&focus=${a.id}`}
                      className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-bold text-clay hover:text-clay-deep"
                    >
                      <CalendarDays className="h-3.5 w-3.5" /> View on schedule
                    </Link>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* 4 — Visit history */}
        <section className="p-6 pb-4">
          <h3 className="mb-3 text-[15px] font-bold leading-[22px]">Visit history</h3>
          {history.length === 0 ? (
            <p className="text-small font-medium text-ink-faint">No past visits yet.</p>
          ) : (
            [...historyByMonth.entries()].map(([month, appts]) => (
              <div key={month} className="mb-4">
                <p className="mb-2 text-micro font-bold uppercase text-ink-faint">{month}</p>
                <div className="relative ml-1.5 border-l border-line-strong pl-4">
                  {appts.map((a) => {
                    const first = a.items[0]
                    const key = catKey(first ? catNameById.get(first.serviceId) : undefined)
                    const price = a.items.reduce((s, i) => s + i.priceCents, 0)
                    const techs = [...new Set(a.items.map((i) => i.staff?.name).filter(Boolean))].join(', ')
                    return (
                      <div key={a.id} className="relative pb-3">
                        <span className={cn('absolute -left-[21.5px] top-1.5 h-2.5 w-2.5 rounded-r-pill ring-2 ring-surface', CAT[key].dot)} />
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-[13px] font-bold text-ink tnum">
                            {format(parseDay(a.date), 'MMM d')} · {fmtMin(a.startMin)}
                          </p>
                          <span className={cn('shrink-0 rounded-r-pill px-2 py-0.5 text-micro font-bold uppercase', statusChip(a.status))}>
                            {a.status}
                          </span>
                        </div>
                        <p className="text-[12.5px] font-medium text-ink-soft">
                          {a.items.map((i) => i.service.name).join(' + ')}
                          {techs && ` · ${techs}`} · <span className="tnum">{fmtPrice(price)}</span>
                        </p>
                        <a
                          href="/book"
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-bold text-ink-faint transition-colors hover:text-clay"
                        >
                          <ExternalLink className="h-3 w-3" /> Book again
                        </a>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      {/* 5 — Footer stats band */}
      <div className="grid shrink-0 grid-cols-3 divide-x divide-line border-t border-line bg-cream">
        {[
          { label: 'Total spent', value: fmtPrice(totalSpent), cls: 'text-ink' },
          { label: 'Visits', value: String(completed.length), cls: 'text-ink' },
          { label: 'No-shows', value: String(client.noShowCount), cls: client.noShowCount > 0 ? 'text-amber' : 'text-ink-faint' },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3 text-center">
            <p className={cn('text-[18px] font-extrabold leading-6 tnum', s.cls)}>{s.value}</p>
            <p className="text-micro font-bold uppercase text-ink-faint">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Small status chip re-export for consistent reuse. */
export function ApptStatusChip({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-r-pill px-2 py-0.5 text-micro font-bold uppercase', statusChip(status))}>
      {status === 'completed' && <Check className="h-3 w-3" />}
      {status}
    </span>
  )
}
