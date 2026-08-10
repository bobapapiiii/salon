import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, Link2 } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import Avatar, { normalizeTint } from '@/components/ops/Avatar'
import ClientDrawer from '@/components/ops/ClientDrawer'
import RequestDetail from '@/components/ops/RequestDetail'
import { EmptyState, Modal, NoteFlag, OpsToaster } from '@/components/ops/primitives'
import { CAT, ageMinutes, catKey, fmtAge, fmtMin, parseDay, todayStr } from '@/components/ops/format'
import { useMediaQuery } from '@/components/ops/hooks'
import type { RequestRow } from '@/components/ops/types'

type Tab = 'pending' | 'countered' | 'decided'
type Range = 'today' | 'week' | 'all'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'countered', label: 'Countered' },
  { id: 'decided', label: 'Decided' },
]

const RANGES: { id: Range; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'all', label: 'All' },
]

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

export default function Requests() {
  const utils = trpc.useUtils()
  const salonQ = trpc.salon.get.useQuery()
  const salonId = salonQ.data?.id ?? 0
  const enabled = salonId > 0

  const requestsQ = trpc.requests.list.useQuery({ salonId }, { enabled, refetchInterval: 15000 })
  const clientsQ = trpc.clients.list.useQuery({ salonId }, { enabled })
  const servicesQ = trpc.services.list.useQuery({ salonId }, { enabled })
  const staffQ = trpc.staff.list.useQuery({ salonId }, { enabled })

  const [tab, setTab] = useState<Tab>('pending')
  const [range, setRange] = useState<Range>('week')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [drawerClientId, setDrawerClientId] = useState<number | null>(null)
  const isWide = useMediaQuery('(min-width: 1100px)')
  const listRef = useRef<HTMLDivElement>(null)

  const catNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of servicesQ.data ?? []) for (const s of c.services) m.set(s.id, c.name)
    return m
  }, [servicesQ.data])

  const clientFlags = useMemo(() => {
    const m = new Map<number, { kind: string; text: string }[]>()
    for (const c of clientsQ.data ?? []) {
      m.set(
        c.id,
        c.notes
          .filter((n) => n.kind !== 'general')
          .sort((a, b) => Number(b.pinned) - Number(a.pinned))
          .map((n) => ({ kind: n.kind, text: n.text })),
      )
    }
    return m
  }, [clientsQ.data])

  const all = useMemo(() => requestsQ.data ?? [], [requestsQ.data])

  const inRange = (r: RequestRow) => {
    if (range === 'all') return true
    const today = todayStr()
    if (range === 'today') return r.date === today
    // This week: requested date within today .. today+7
    const t = parseDay(today).getTime()
    const d = parseDay(r.date).getTime()
    return d >= t - 86400000 && d <= t + 7 * 86400000
  }

  const pending = useMemo(
    () =>
      all
        .filter((r) => r.status === 'pending' && inRange(r))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, range],
  )
  const countered = useMemo(
    () =>
      all
        .filter((r) => r.status === 'countered')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [all],
  )
  const decided = useMemo(
    () =>
      all
        .filter((r) => r.status === 'accepted' || r.status === 'declined')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [all],
  )

  const visibleList = tab === 'pending' ? pending : tab === 'countered' ? countered : decided

  // Keep selection valid as the list changes
  useEffect(() => {
    if (tab === 'decided') return
    if (selectedId == null || !visibleList.some((r) => r.id === selectedId)) {
      setSelectedId(visibleList[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleList, tab])

  const selected = useMemo(
    () => all.find((r) => r.id === selectedId) ?? null,
    [all, selectedId],
  )

  /* ── Stats (salon-requests.md §2) ─────────────────────────────────────── */
  const weekAgo = Date.now() - 7 * 86400000
  const stats = {
    pending: all.filter((r) => r.status === 'pending').length,
    countered: all.filter((r) => r.status === 'countered').length,
    accepted: all.filter((r) => r.status === 'accepted' && new Date(r.createdAt).getTime() >= weekAgo).length,
    declined: all.filter((r) => r.status === 'declined' && new Date(r.createdAt).getTime() >= weekAgo).length,
  }
  const oldest = pending[0] ? fmtAge(pending[0].createdAt) : null

  /* ── Quick actions ────────────────────────────────────────────────────── */
  const quickAccept = trpc.requests.accept.useMutation({
    onSuccess: (_d, v) => {
      utils.requests.list.invalidate()
      utils.appointments.byDate.invalidate()
      toast.success('Request accepted — added to the schedule')
      if (v.id === selectedId) advanceSelection()
    },
    onError: (e) => toast.error(e.message),
  })
  const quickDecline = trpc.requests.decline.useMutation({
    onSuccess: (_d, v) => {
      utils.requests.list.invalidate()
      toast.success('Request declined')
      if (v.id === selectedId) advanceSelection()
    },
    onError: (e) => toast.error(e.message),
  })

  function advanceSelection() {
    const idx = visibleList.findIndex((r) => r.id === selectedId)
    const next = visibleList[idx + 1] ?? visibleList[idx - 1] ?? visibleList[0]
    setSelectedId(next && next.id !== selectedId ? next.id : null)
    setModalOpen(false)
  }

  function openRequest(r: RequestRow) {
    setSelectedId(r.id)
    if (!isWide) setModalOpen(true)
  }

  function onListKeyDown(e: React.KeyboardEvent) {
    if (tab === 'decided') return
    const idx = visibleList.findIndex((r) => r.id === selectedId)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next =
        e.key === 'ArrowDown'
          ? visibleList[Math.min(visibleList.length - 1, idx + 1)]
          : visibleList[Math.max(0, idx - 1)]
      if (next) setSelectedId(next.id)
    } else if ((e.key === 'a' || e.key === 'A') && selected && selected.status === 'pending') {
      quickAccept.mutate({
        id: selected.id,
        assignments: selected.items.map((i) => ({ staffId: i.requestedStaffId ?? null })),
      })
    } else if ((e.key === 'd' || e.key === 'D') && selected && selected.status === 'pending') {
      quickDecline.mutate({ id: selected.id })
    }
  }

  const loading = requestsQ.isLoading || salonQ.isLoading

  return (
    <div className="mx-auto max-w-[1240px] p-8">
      <OpsToaster />

      {/* ── Section 1: filters row ─────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE }}
        className="mb-4 flex flex-wrap items-center gap-3"
      >
        <p className="text-small font-medium text-ink-faint tnum">
          {stats.pending} pending{oldest ? ` · oldest ${oldest}` : ''}
        </p>
        <div className="ml-auto flex items-center gap-3">
          {/* Segmented control */}
          <div className="flex rounded-r-pill bg-cream p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative h-8 cursor-pointer rounded-r-pill px-3.5 text-[12.5px] font-bold transition-colors',
                  tab === t.id ? 'text-ink' : 'text-ink-soft hover:text-ink',
                )}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="req-tab-pill"
                    className="absolute inset-0 rounded-r-pill bg-surface shadow-sh-1"
                    transition={{ duration: 0.2, ease: EASE }}
                  />
                )}
                <span className="relative">{t.label}</span>
              </button>
            ))}
          </div>
          {/* Date-range mini select */}
          <div className="flex rounded-r-pill bg-cream p-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                className={cn(
                  'relative h-8 cursor-pointer rounded-r-pill px-3 text-[12.5px] font-bold transition-colors',
                  range === r.id ? 'text-ink' : 'text-ink-soft hover:text-ink',
                )}
              >
                {range === r.id && (
                  <motion.span
                    layoutId="req-range-pill"
                    className="absolute inset-0 rounded-r-pill bg-surface shadow-sh-1"
                    transition={{ duration: 0.2, ease: EASE }}
                  />
                )}
                <span className="relative">{r.label}</span>
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Section 2: summary strip ───────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Pending', value: stats.pending, cls: 'text-clay', tab: 'pending' as Tab },
          { label: 'Countered — awaiting client', value: stats.countered, cls: 'text-amber', tab: 'countered' as Tab },
          { label: 'Accepted this week', value: stats.accepted, cls: 'text-olive', tab: 'decided' as Tab },
          { label: 'Declined this week', value: stats.declined, cls: 'text-rust', tab: 'decided' as Tab },
        ].map((s, i) => (
          <motion.button
            key={s.label}
            type="button"
            onClick={() => setTab(s.tab)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.06, ease: EASE }}
            className="cursor-pointer rounded-r-md border border-line bg-surface p-4 text-left shadow-sh-1 transition-colors hover:bg-cream"
          >
            <motion.span
              key={s.value}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE }}
              className={cn('block text-[26px] font-extrabold leading-8 tnum', s.cls)}
            >
              {s.value}
            </motion.span>
            <span className="text-micro font-bold uppercase text-ink-faint">{s.label}</span>
          </motion.button>
        ))}
      </div>

      {/* ── Sections 3–5 ───────────────────────────────────────────────── */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab + range}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[104px] w-full max-w-[420px] animate-pulse rounded-r-lg bg-cream" />
              ))}
            </div>
          ) : tab === 'decided' ? (
            <DecidedTable
              rows={decided}
              catNameById={catNameById}
              selectedId={selectedId}
              onOpen={openRequest}
            />
          ) : visibleList.length === 0 ? (
            <div className="max-w-[420px] rounded-r-lg border border-line bg-surface">
              <EmptyState
                title={tab === 'countered' ? 'No counter offers out.' : 'All caught up.'}
                body="Online booking requests appear here the moment clients send them."
                action={
                  <a
                    href="/salon/schedule"
                    className="inline-flex h-10 items-center rounded-r-md px-4 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
                  >
                    View schedule
                  </a>
                }
              />
            </div>
          ) : (
            <div className="flex items-start gap-4">
              {/* Master list (420px) */}
              <div
                ref={listRef}
                tabIndex={0}
                onKeyDown={onListKeyDown}
                aria-label="Booking request queue"
                className="w-full max-w-[420px] shrink-0 space-y-2 outline-none min-[1100px]:w-[420px]"
              >
                <AnimatePresence initial={false}>
                  {visibleList.map((r, i) => (
                    <RequestCard
                      key={r.id}
                      req={r}
                      index={i}
                      selected={r.id === selectedId}
                      flags={clientFlags.get(r.clientId) ?? []}
                      catNameById={catNameById}
                      onOpen={() => openRequest(r)}
                      onAccept={() =>
                        quickAccept.mutate({
                          id: r.id,
                          assignments: r.items.map((it) => ({ staffId: it.requestedStaffId ?? null })),
                        })
                      }
                      onDecline={() => quickDecline.mutate({ id: r.id })}
                    />
                  ))}
                </AnimatePresence>
                <p className="pt-1 text-center text-[11px] font-medium text-ink-faint">
                  ↑ ↓ select · A accept · D decline
                </p>
              </div>

              {/* Detail pane (fluid, sticky) — desktop only */}
              {isWide && (
                <div className="sticky top-6 min-w-0 flex-1">
                  <div className="flex max-h-[calc(100dvh-96px)] flex-col overflow-hidden rounded-r-xl border border-line bg-surface shadow-sh-1">
                    {selected ? (
                      <RequestDetail
                        request={selected}
                        salonId={salonId}
                        staff={staffQ.data ?? []}
                        catNameById={catNameById}
                        readOnly={selected.status === 'accepted' || selected.status === 'declined'}
                        onOpenClient={setDrawerClientId}
                        onDecision={advanceSelection}
                      />
                    ) : (
                      <EmptyState title="Select a request" body="Pick a booking request from the queue to review it." />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Decided tab gets the read-only pane alongside on wide screens */}
          {tab === 'decided' &&
            isWide &&
            selected &&
            (selected.status === 'accepted' || selected.status === 'declined') && (
            <div className="mt-4">
              <div className="flex max-h-[calc(100dvh-96px)] flex-col overflow-hidden rounded-r-xl border border-line bg-surface shadow-sh-1">
                <RequestDetail
                  request={selected}
                  salonId={salonId}
                  staff={staffQ.data ?? []}
                  catNameById={catNameById}
                  readOnly
                  onOpenClient={setDrawerClientId}
                  onDecision={() => setSelectedId(null)}
                />
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Detail as modal below 1100px (§3) */}
      <Modal open={modalOpen && !isWide && !!selected} onClose={() => setModalOpen(false)} maxWidth={640}>
        {selected && (
          <div className="flex max-h-[calc(100dvh-96px)] flex-col">
            <RequestDetail
              request={selected}
              salonId={salonId}
              staff={staffQ.data ?? []}
              catNameById={catNameById}
              readOnly={tab === 'decided' || selected.status === 'accepted' || selected.status === 'declined'}
              onOpenClient={(id) => {
                setModalOpen(false)
                setDrawerClientId(id)
              }}
              onDecision={advanceSelection}
            />
          </div>
        )}
      </Modal>

      <ClientDrawer clientId={drawerClientId} onClose={() => setDrawerClientId(null)} />
    </div>
  )
}

/* ── Request list card (§3) ─────────────────────────────────────────────── */
function RequestCard({
  req,
  index,
  selected,
  flags,
  catNameById,
  onOpen,
  onAccept,
  onDecline,
}: {
  req: RequestRow
  index: number
  selected: boolean
  flags: { kind: string; text: string }[]
  catNameById: Map<number, string>
  onOpen: () => void
  onAccept: () => void
  onDecline: () => void
}) {
  const age = ageMinutes(req.createdAt)
  const ageCls = age > 360 ? 'text-rust' : age > 120 ? 'text-amber' : 'text-ink-faint'
  const sameTime = req.items.some((i) => i.sameTime)
  const wants = req.items
    .map((i) => (i.anyStaff || !i.requestedStaff ? 'Any available' : i.requestedStaff.name.split(' ')[0] + ' ' + (i.requestedStaff.name.split(' ')[1]?.[0] ?? '') + '.'))
    .map((w) => `wants: ${w}`)
    .join(' · ')

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, transition: { duration: 0.18 } }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.045, ease: EASE }}
      onClick={onOpen}
      className={cn(
        'group cursor-pointer rounded-r-lg border bg-surface p-4 shadow-sh-1 transition-colors',
        selected ? 'border-clay border-[1.5px] bg-clay-tint/40' : 'border-line hover:border-line-strong',
      )}
    >
      {/* Row 1 */}
      <div className="flex items-center gap-2.5">
        <Avatar
          initials={`${req.client.firstName[0] ?? ''}${req.client.lastName[0] ?? ''}`.toUpperCase()}
          tint={normalizeTint(null, `${req.client.firstName} ${req.client.lastName}`)}
          size={32}
        />
        <p className="truncate text-[14px] font-bold">
          {req.client.firstName} {req.client.lastName}
        </p>
        <span className="flex min-w-0 flex-1 gap-1 overflow-hidden">
          {flags.slice(0, 2).map((f, i) => (
            <NoteFlag key={i} kind={f.kind} text={f.text} />
          ))}
        </span>
        <span className={cn('shrink-0 text-micro font-bold uppercase tnum', ageCls)}>{fmtAge(req.createdAt)}</span>
      </div>

      {/* Row 2 */}
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[13px] font-semibold text-ink">
        {req.items.map((item, i) => {
          const key = catKey(catNameById.get(item.serviceId))
          return (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-ink-faint">+</span>}
              <span className={cn('h-2 w-2 rounded-r-pill', CAT[key].dot)} />
              {item.service.name}
            </span>
          )
        })}
      </p>
      <p className="mt-0.5 text-small font-medium text-ink-faint">{wants}</p>

      {/* Row 3 */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-r-pill bg-clay-tint px-2.5 text-[12px] font-bold text-clay tnum">
          <CalendarDays className="h-3.5 w-3.5" />
          {format(parseDay(req.date), 'EEE d MMM')} · {fmtMin(req.startMin)}
        </span>
        {sameTime && (
          <span
            className="inline-flex h-7 items-center gap-1 rounded-r-pill bg-cream px-2 text-[11px] font-bold text-ink-soft"
            title="Services requested at the same time"
          >
            <Link2 className="h-3.5 w-3.5" /> same time
          </span>
        )}
        {req.status === 'countered' && req.counterDate && req.counterStartMin != null && (
          <span className="inline-flex h-7 items-center rounded-r-pill bg-amber-tint px-2.5 text-[11px] font-bold text-amber tnum">
            awaiting client · {format(parseDay(req.counterDate), 'EEE d MMM')} {fmtMin(req.counterStartMin)}
          </span>
        )}
      </div>

      {/* Row 4 — quick actions (hover/focus reveal) */}
      {req.status === 'pending' && (
        <div className="mt-2 flex items-center gap-1.5 opacity-100 transition-opacity duration-150 min-[1100px]:opacity-0 min-[1100px]:group-hover:opacity-100 min-[1100px]:group-focus-within:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAccept()
            }}
            className="h-8 cursor-pointer rounded-r-md bg-clay px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-clay-deep"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
            className="h-8 cursor-pointer rounded-r-md border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-cream"
          >
            Propose
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDecline()
            }}
            className="h-8 cursor-pointer rounded-r-md px-3 text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-cream hover:text-rust"
          >
            Decline
          </button>
        </div>
      )}
    </motion.article>
  )
}

/* ── Decided tab — decision history table (§5) ──────────────────────────── */
function DecidedTable({
  rows,
  catNameById,
  selectedId,
  onOpen,
}: {
  rows: RequestRow[]
  catNameById: Map<number, string>
  selectedId: number | null
  onOpen: (r: RequestRow) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="max-w-[560px] rounded-r-lg border border-line bg-surface">
        <EmptyState title="No decisions yet this week." body="Accepted and declined requests land here." />
      </div>
    )
  }
  return (
    <div className="max-w-[860px] overflow-hidden rounded-r-lg border border-line bg-surface shadow-sh-1">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line">
            {['Client', 'Services', 'Requested time', 'Decision', 'Decided by', 'When'].map((h) => (
              <th key={h} className="px-4 py-3 text-micro font-bold uppercase text-ink-faint">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const wasCountered = !!r.counterDate
            return (
              <motion.tr
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i, 10) * 0.03, ease: EASE }}
                onClick={() => onOpen(r)}
                className={cn(
                  'cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-cream',
                  r.id === selectedId && 'bg-clay-tint/40',
                )}
              >
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2.5">
                    <Avatar
                      initials={`${r.client.firstName[0] ?? ''}${r.client.lastName[0] ?? ''}`.toUpperCase()}
                      tint={normalizeTint(null, `${r.client.firstName} ${r.client.lastName}`)}
                      size={32}
                    />
                    <span className="text-[13.5px] font-bold">
                      {r.client.firstName} {r.client.lastName}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] font-medium text-ink-soft">
                    {r.items.map((item, j) => (
                      <span key={j} className="inline-flex items-center gap-1">
                        <span className={cn('h-2 w-2 rounded-r-pill', CAT[catKey(catNameById.get(item.serviceId))].dot)} />
                        {item.service.name}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-3 text-[12.5px] font-semibold text-ink tnum">
                  {format(parseDay(r.date), 'EEE d MMM')} · {fmtMin(r.startMin)}
                </td>
                <td className="px-4 py-3">
                  <motion.span
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      'inline-flex items-center rounded-r-pill px-2.5 py-1 text-micro font-bold uppercase',
                      r.status === 'accepted'
                        ? wasCountered
                          ? 'bg-gradient-to-r from-amber-tint to-olive-tint text-olive'
                          : 'bg-olive-tint text-olive'
                        : 'bg-rust-tint text-rust',
                    )}
                  >
                    {r.status === 'accepted' ? (wasCountered ? 'countered → accepted' : 'accepted') : 'declined'}
                  </motion.span>
                </td>
                <td className="px-4 py-3 text-[12.5px] font-medium text-ink-soft">Dana</td>
                <td className="px-4 py-3 text-[12.5px] font-medium text-ink-faint tnum">
                  {format(new Date(r.createdAt), 'MMM d, h:mm a')}
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
