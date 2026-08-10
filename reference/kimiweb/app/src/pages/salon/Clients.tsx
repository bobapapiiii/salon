import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUpDown,
  Ban,
  ChevronRight,
  Copy,
  Mail,
  Phone,
  Plus,
  Search,
} from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import Avatar, { tintForName } from '@/components/ops/Avatar'
import ClientDrawer from '@/components/ops/ClientDrawer'
import { EmptyState, Modal, ModalHeader, NoteFlag, OpsToaster } from '@/components/ops/primitives'
import { formatPhoneInput, todayStr } from '@/components/ops/format'
import type { AppointmentRow, ClientRow } from '@/components/ops/types'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

type Filter = 'all' | 'flagged' | 'no-shows' | 'blocked'
type SortKey = 'name' | 'lastVisit' | 'visits'

interface RowStats {
  visits: number
  lastTs: number
  lastLabel: string
  lastRel: string
  monthly: number[]
}

function computeStats(appts: AppointmentRow[]): RowStats {
  const today = todayStr()
  const completed = appts.filter((a) => a.status === 'completed')
  const past = appts
    .filter((a) => a.date <= today && a.status !== 'cancelled')
    .sort((a, b) => b.date.localeCompare(a.date) || b.startMin - a.startMin)
  const last = past[0]
  const monthly = [0, 0, 0, 0, 0, 0]
  const now = new Date()
  for (const a of completed) {
    const d = new Date(a.date + 'T12:00:00')
    const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
    if (diff >= 0 && diff < 6) monthly[5 - diff] += 1
  }
  const lastTs = last ? new Date(last.date + 'T12:00:00').getTime() : 0
  const days = last ? Math.round((Date.now() - lastTs) / 86400000) : 0
  return {
    visits: completed.length,
    lastTs,
    lastLabel: last ? `${last.items[0]?.service.name ?? 'Visit'} · ${format(new Date(last.date + 'T12:00:00'), 'MMM d')}` : '—',
    lastRel: last ? (days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`) : '',
    monthly,
  }
}

/** Highlight the matched substring in clay. */
function Hi({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] bg-clay-tint px-0.5 text-clay">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

export default function Clients() {
  const utils = trpc.useUtils()
  const salonQ = trpc.salon.get.useQuery()
  const salonId = salonQ.data?.id ?? 0
  const clientsQ = trpc.clients.list.useQuery({ salonId }, { enabled: salonId > 0 })

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [drawerId, setDrawerId] = useState<number | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [statsMap, setStatsMap] = useState<Map<number, RowStats>>(new Map())

  const registerStats = useCallback((id: number, st: RowStats) => {
    setStatsMap((prev) => {
      const cur = prev.get(id)
      if (cur && cur.visits === st.visits && cur.lastTs === st.lastTs) return prev
      const next = new Map(prev)
      next.set(id, st)
      return next
    })
  }, [])

  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data])

  const counts = useMemo(
    () => ({
      all: clients.length,
      flagged: clients.filter((c) => c.notes.some((n) => n.kind !== 'general')).length,
      'no-shows': clients.filter((c) => c.noShowCount > 0).length,
      blocked: clients.filter((c) => c.blocked).length,
    }),
    [clients],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = clients.filter((c) => {
      if (filter === 'flagged' && !c.notes.some((n) => n.kind !== 'general')) return false
      if (filter === 'no-shows' && c.noShowCount === 0) return false
      if (filter === 'blocked' && !c.blocked) return false
      if (!q) return true
      const hay = `${c.firstName} ${c.lastName} ${c.phone ?? ''} ${c.email ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
    list = [...list].sort((a, b) => {
      let cmp = 0
      if (sort.key === 'name') {
        cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
      } else if (sort.key === 'visits') {
        cmp = (statsMap.get(a.id)?.visits ?? -1) - (statsMap.get(b.id)?.visits ?? -1)
      } else {
        cmp = (statsMap.get(a.id)?.lastTs ?? 0) - (statsMap.get(b.id)?.lastTs ?? 0)
      }
      return cmp * sort.dir
    })
    return list
  }, [clients, search, filter, sort, statsMap])

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }))

  const loading = clientsQ.isLoading || salonQ.isLoading

  return (
    <div className="mx-auto max-w-[1240px] p-8">
      <OpsToaster />

      {/* ── Section 1: header row ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE }}
        className="mb-5 flex flex-wrap items-center gap-3"
      >
        <p className="text-small font-medium text-ink-faint tnum">
          {counts.all} clients · {counts.flagged} with flags · {counts['no-shows']} with no-shows
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="flex h-10 w-[240px] items-center gap-2 rounded-r-sm border border-line bg-surface px-3 transition-colors focus-within:border-clay focus-within:ring-2 focus-within:ring-clay/30">
            <Search className="h-4 w-4 shrink-0 text-ink-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, email…"
              className="w-full bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
          {/* Filter chips */}
          {(
            [
              ['all', 'All'],
              ['flagged', 'Flagged'],
              ['no-shows', 'No-shows'],
              ['blocked', 'Blocked'],
            ] as [Filter, string][]
          ).map(([id, label], i) => (
            <motion.button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05, ease: EASE }}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-1.5 rounded-r-pill border px-3 text-[12.5px] font-bold transition-colors',
                filter === id
                  ? 'border-clay bg-clay-tint text-clay'
                  : 'border-line bg-surface text-ink-soft hover:bg-cream hover:text-ink',
              )}
            >
              {label}
              <span className={cn('tnum', filter === id ? 'text-clay' : 'text-ink-faint')}>{counts[id]}</span>
            </motion.button>
          ))}
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-r-md bg-clay px-4 text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-clay-deep hover:shadow-sh-1 active:translate-y-0"
          >
            <Plus className="h-4 w-4" /> New client
          </button>
        </div>
      </motion.div>

      {/* ── Section 2: client table ────────────────────────────────────── */}
      <div className="overflow-hidden rounded-r-lg border border-line bg-surface shadow-sh-1">
        <div className="max-h-[calc(100dvh-220px)] overflow-y-auto">
          <table className="w-full min-w-[960px] text-left">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line">
                {(
                  [
                    ['name', 'Client'],
                    [null, 'Contact'],
                    [null, 'Flags'],
                    ['lastVisit', 'Last visit'],
                    ['visits', 'Visits'],
                    [null, 'No-shows'],
                    [null, 'Status'],
                  ] as [SortKey | null, string][]
                ).map(([key, label]) => (
                  <th key={label} className="px-4 py-3 text-micro font-bold uppercase text-ink-faint">
                    {key ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className="inline-flex cursor-pointer items-center gap-1 uppercase hover:text-ink"
                      >
                        {label}
                        <ArrowUpDown
                          className={cn(
                            'h-3 w-3 transition-transform duration-200',
                            sort.key === key ? 'text-clay' : 'text-line-strong',
                            sort.key === key && sort.dir === -1 && 'rotate-180',
                          )}
                        />
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3].map((i) => (
                  <tr key={i} className="border-b border-line">
                    <td colSpan={8} className="px-4 py-3">
                      <div className="h-10 animate-pulse rounded-r-md bg-cream" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No clients match"
                      body="Try a different search or clear the filters."
                      action={
                        <button
                          type="button"
                          onClick={() => {
                            setSearch('')
                            setFilter('all')
                          }}
                          className="h-10 cursor-pointer rounded-r-md px-4 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
                        >
                          Clear filters
                        </button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.map((c, i) => (
                  <ClientTableRow
                    key={c.id}
                    client={c}
                    index={i}
                    search={search.trim()}
                    onOpen={() => setDrawerId(c.id)}
                    registerStats={registerStats}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ClientDrawer clientId={drawerId} onClose={() => setDrawerId(null)} />

      <NewClientModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        salonId={salonId}
        clients={clients}
        onOpenClient={(id) => {
          setNewOpen(false)
          setDrawerId(id)
        }}
        onCreated={() => utils.clients.list.invalidate()}
      />
    </div>
  )
}

/* ── Table row (§2) ─────────────────────────────────────────────────────── */
function ClientTableRow({
  client: c,
  index,
  search,
  onOpen,
  registerStats,
}: {
  client: ClientRow
  index: number
  search: string
  onOpen: () => void
  registerStats: (id: number, st: RowStats) => void
}) {
  const apptsQ = trpc.appointments.forClient.useQuery({ clientId: c.id })

  useEffect(() => {
    if (apptsQ.data) registerStats(c.id, computeStats(apptsQ.data))
  }, [apptsQ.data, c.id, registerStats])

  const stats = apptsQ.data ? computeStats(apptsQ.data) : null
  const flags = c.notes
    .filter((n) => n.kind !== 'general')
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const fullName = `${c.firstName} ${c.lastName}`

  const copy = (e: React.MouseEvent, label: string, value: string) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(value).catch(() => {})
    toast.success(`${label} copied`)
  }

  return (
    <motion.tr
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 20) * 0.025, ease: EASE }}
      onClick={onOpen}
      className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-cream"
    >
      {/* Client */}
      <td className="px-4 py-3">
        <span className="flex items-center gap-3">
          <Avatar initials={`${c.firstName[0] ?? ''}${c.lastName[0] ?? ''}`.toUpperCase()} tint={tintForName(fullName)} size={36} />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-ink">
              <Hi text={fullName} q={search} />
            </span>
            <span className="block text-[11px] font-medium text-ink-faint tnum">
              since {format(new Date(c.createdAt), 'yyyy')}
            </span>
          </span>
        </span>
      </td>

      {/* Contact */}
      <td className="px-4 py-3">
        {c.phone && (
          <button
            type="button"
            onClick={(e) => copy(e, 'Phone', c.phone!)}
            title="Copy phone"
            className="flex cursor-pointer items-center gap-1.5 text-[12.5px] font-semibold text-ink tnum hover:text-clay"
          >
            <Phone className="h-3 w-3 text-ink-faint" />
            <Hi text={c.phone} q={search} />
            <Copy className="h-3 w-3 text-ink-faint" />
          </button>
        )}
        {c.email && (
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] font-medium text-ink-faint">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">
              <Hi text={c.email} q={search} />
            </span>
          </span>
        )}
      </td>

      {/* Flags */}
      <td className="max-w-[220px] px-4 py-3">
        {flags.length === 0 ? (
          <span className="text-ink-faint">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {flags.slice(0, 3).map((n) => (
              <NoteFlag key={n.id} kind={n.kind} text={n.text} />
            ))}
            {flags.length > 3 && (
              <span className="inline-flex h-5 items-center rounded-r-pill bg-cream px-2 text-[10.5px] font-bold text-ink-soft">
                +{flags.length - 3}
              </span>
            )}
          </span>
        )}
      </td>

      {/* Last visit */}
      <td className="px-4 py-3">
        {stats ? (
          <>
            <span className="block text-[12.5px] font-medium text-ink">{stats.lastLabel}</span>
            {stats.lastRel && (
              <span className="block text-[11px] font-medium text-ink-faint tnum">{stats.lastRel}</span>
            )}
          </>
        ) : (
          <span className="inline-block h-4 w-20 animate-pulse rounded-r-sm bg-cream" />
        )}
      </td>

      {/* Visits + sparkline */}
      <td className="px-4 py-3">
        {stats ? (
          <span className="flex items-center gap-2">
            <span className="text-[13.5px] font-bold text-ink tnum">{stats.visits}</span>
            <Sparkline data={stats.monthly} />
          </span>
        ) : (
          <span className="inline-block h-4 w-16 animate-pulse rounded-r-sm bg-cream" />
        )}
      </td>

      {/* No-shows */}
      <td className="px-4 py-3">
        {c.noShowCount === 0 ? (
          <span className="text-ink-faint">—</span>
        ) : (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[13.5px] font-extrabold tnum',
              c.noShowCount >= 3 ? 'text-rust' : 'text-amber',
            )}
          >
            {c.noShowCount}
            {c.noShowCount >= 3 && <span className="h-1.5 w-1.5 rounded-r-pill bg-rust" />}
          </span>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        {c.blocked ? (
          <span className="inline-flex items-center gap-1 rounded-r-pill bg-rust-tint px-2 py-0.5 text-micro font-bold uppercase text-rust">
            <Ban className="h-3 w-3" /> Blocked
          </span>
        ) : (
          <span className="text-micro font-bold uppercase text-olive">Active</span>
        )}
      </td>

      <td className="pr-3 text-right">
        <ChevronRight className="ml-auto h-4 w-4 text-ink-faint" />
      </td>
    </motion.tr>
  )
}

/* ── Sparkline (SVG 48×16, clay stroke, monthly visits 6 months) ────────── */
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data)
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 46 + 1},${15 - (v / max) * 13}`)
    .join(' ')
  return (
    <svg width="48" height="16" viewBox="0 0 48 16" aria-hidden>
      <motion.polyline
        points={pts}
        fill="none"
        stroke="#B4552B"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: EASE }}
      />
    </svg>
  )
}

/* ── New client modal (§4) ──────────────────────────────────────────────── */
function NewClientModal({
  open,
  onClose,
  salonId,
  clients,
  onOpenClient,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  salonId: number
  clients: ClientRow[]
  onOpenClient: (id: number) => void
  onCreated: () => void
}) {
  const utils = trpc.useUtils()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [kind, setKind] = useState<'allergy' | 'alert' | 'preference' | 'general'>('general')

  useEffect(() => {
    if (open) {
      setFirstName('')
      setLastName('')
      setPhone('')
      setEmail('')
      setNote('')
      setKind('general')
    }
  }, [open])

  const digits = phone.replace(/\D/g, '')
  const duplicate = digits.length >= 7 ? clients.find((c) => (c.phone ?? '').replace(/\D/g, '') === digits) : undefined

  const create = trpc.clients.create.useMutation()
  const addNote = trpc.clients.addNote.useMutation()
  const busy = create.isPending || addNote.isPending
  const valid = firstName.trim() && lastName.trim()

  async function handleSave() {
    if (!valid) return
    try {
      const res = await create.mutateAsync({
        salonId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      })
      if (note.trim()) {
        await addNote.mutateAsync({ clientId: res.id, kind, text: note.trim(), pinned: true })
      }
      utils.clients.list.invalidate()
      onCreated()
      toast.success(`${firstName.trim()} ${lastName.trim()} added`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add client')
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={480} labelledBy="new-client-title">
      <ModalHeader title="New client" onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        <div className="flex gap-3">
          <div className="flex-1">
            <p className="mb-1 text-micro font-bold uppercase text-ink-faint">First name</p>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="h-10 w-full rounded-r-sm border border-line bg-surface px-3 text-[14px] font-semibold outline-none focus:border-clay focus:ring-2 focus:ring-clay/30"
            />
          </div>
          <div className="flex-1">
            <p className="mb-1 text-micro font-bold uppercase text-ink-faint">Last name</p>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="h-10 w-full rounded-r-sm border border-line bg-surface px-3 text-[14px] font-semibold outline-none focus:border-clay focus:ring-2 focus:ring-clay/30"
            />
          </div>
        </div>

        <div>
          <p className="mb-1 text-micro font-bold uppercase text-ink-faint">Phone</p>
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            placeholder="(555) 123-4567"
            inputMode="tel"
            className="h-10 w-full rounded-r-sm border border-line bg-surface px-3 text-[14px] font-semibold outline-none tnum placeholder:font-medium placeholder:text-ink-faint focus:border-clay focus:ring-2 focus:ring-clay/30"
          />
          <AnimatePresence>
            {duplicate && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden pt-1 text-[12px] font-semibold text-amber"
              >
                A client with this phone exists ({duplicate.firstName} {duplicate.lastName}) —{' '}
                <button
                  type="button"
                  onClick={() => onOpenClient(duplicate.id)}
                  className="cursor-pointer font-bold underline"
                >
                  open
                </button>
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div>
          <p className="mb-1 text-micro font-bold uppercase text-ink-faint">Email</p>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            className="h-10 w-full rounded-r-sm border border-line bg-surface px-3 text-[14px] font-semibold outline-none focus:border-clay focus:ring-2 focus:ring-clay/30"
          />
        </div>

        <div>
          <p className="mb-1 text-micro font-bold uppercase text-ink-faint">Initial note</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional — allergy, alert or preference…"
            className="w-full resize-none rounded-r-sm border border-line bg-surface px-3 py-2 text-[13.5px] outline-none placeholder:text-ink-faint focus:border-clay focus:ring-2 focus:ring-clay/30"
          />
          <div className="mt-1.5 flex gap-1.5">
            {(['allergy', 'alert', 'preference', 'general'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  'h-7 cursor-pointer rounded-r-pill border px-2.5 text-[11px] font-bold capitalize transition-colors',
                  kind === k
                    ? 'border-clay bg-clay-tint text-clay'
                    : 'border-line bg-surface text-ink-soft hover:bg-cream',
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="h-10 cursor-pointer rounded-r-md px-4 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-cream"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid || busy || !!duplicate}
          onClick={handleSave}
          className="h-10 cursor-pointer rounded-r-md bg-clay px-5 text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-clay-deep hover:shadow-sh-1 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add client'}
        </button>
      </div>
    </Modal>
  )
}
