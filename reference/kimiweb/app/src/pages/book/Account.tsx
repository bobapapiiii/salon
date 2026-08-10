import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import {
  Bell,
  CalendarPlus,
  Check,
  Copy,
  Flag,
  Mail,
  Pencil,
  Phone,
  Receipt,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { trpc } from '@/providers/trpc'
import { useDemoIdentity } from '@/components/booking/identity'
import { type ClientAppt } from '@/components/booking/useCatalog'
import { useBookingStore } from '@/components/booking/store'
import { itemsFromAppointment } from '@/components/booking/prefill'
import ClientToaster from '@/components/booking/ClientToaster'
import StatusChip from '@/components/booking/StatusChip'
import Avatar from '@/components/booking/Avatar'
import PhoneSheet from '@/components/booking/PhoneSheet'
import {
  CAT_CLASSES,
  EASE_OUT_EXPO,
  catKeyOf,
  fmtMin,
  fmtMoney,
  initialsOf,
  parseDate,
  shortName,
} from '@/components/booking/utils'

const PREFS_KEY = 'lumina.prefs'
const PREFERRED_KEY = 'lumina.preferredStaffId'

type Prefs = { textReminders: boolean; emailReceipts: boolean; promotions: boolean }

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return { textReminders: true, emailReceipts: true, promotions: false, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { textReminders: true, emailReceipts: true, promotions: false }
}

/** 36×20 toggle (design.md §7.2). */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        'flex h-5 w-9 shrink-0 items-center rounded-r-pill p-0.5 transition-colors duration-150',
        on ? 'bg-clay' : 'bg-line-strong',
      )}
    >
      <span
        className={cn(
          'h-4 w-4 rounded-r-pill bg-surface shadow-sh-1 transition-transform duration-150',
          on && 'translate-x-4',
        )}
      />
    </button>
  )
}

/** Numeral that counts up once when scrolled into view (900ms). */
function CountUp({ value, format: fmt }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (!inView) return
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(value * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, value])
  return (
    <span ref={ref} className="tnum font-extrabold text-clay">
      {fmt(display)}
    </span>
  )
}

function PrefRow({
  icon: Icon,
  label,
  helper,
  control,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  helper?: string
  control: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
      className="flex items-center gap-3 py-3"
    >
      <Icon className="h-4 w-4 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-ink">{label}</p>
        {helper && <p className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-faint">{helper}</p>}
      </div>
      {control}
    </motion.div>
  )
}

export default function Account() {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const { salonId, clientId, client, isLoading, signOut } = useDemoIdentity()
  const prefill = useBookingStore((s) => s.prefill)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '' })
  const [flash, setFlash] = useState(false)
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [preferred, setPreferred] = useState<number>(() => Number(localStorage.getItem(PREFERRED_KEY) ?? 0))
  const [phoneSheet, setPhoneSheet] = useState(false)
  const [visibleCount, setVisibleCount] = useState(10)

  const updateClient = trpc.clients.update.useMutation()
  const apptsQ = trpc.appointments.forClient.useQuery(
    { clientId: clientId ?? 0 },
    { enabled: clientId != null },
  )

  const history = useMemo(
    () =>
      [...(apptsQ.data ?? [])].sort(
        (a, b) => b.date.localeCompare(a.date) || b.startMin - a.startMin,
        ),
    [apptsQ.data],
  )

  const stats = useMemo(() => {
    const done = history.filter((a) => a.status === 'completed')
    const visits = done.length
    const cents = done.reduce((s, a) => s + a.items.reduce((x, i) => x + i.priceCents, 0), 0)
    const counts = new Map<number, { name: string; n: number }>()
    for (const a of done) {
      for (const i of a.items) {
        if (i.staffId != null && i.staff?.name) {
          const cur = counts.get(i.staffId) ?? { name: i.staff.name, n: 0 }
          cur.n += 1
          counts.set(i.staffId, cur)
        }
      }
    }
    const fav = [...counts.values()].sort((a, b) => b.n - a.n)[0] ?? null
    return { visits, cents, fav }
  }, [history])

  const historyTechs = useMemo(() => {
    const seen = new Map<number, string>()
    for (const a of history) {
      for (const i of a.items) {
        if (i.staffId != null && i.staff?.name) seen.set(i.staffId, i.staff.name)
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }))
  }, [history])

  const timelineGroups = useMemo(() => {
    const shown = history.slice(0, visibleCount)
    const groups: { month: string; rows: ClientAppt[] }[] = []
    for (const a of shown) {
      const key = format(parseDate(a.date), 'MMMM yyyy')
      const g = groups.find((x) => x.month === key)
      if (g) g.rows.push(a)
      else groups.push({ month: key, rows: [a] })
    }
    return groups
  }, [history, visibleCount])

  const startEdit = () => {
    if (!client) return
    setForm({
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone ?? '',
      email: client.email ?? '',
    })
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!client) return
    await updateClient.mutateAsync({
      id: client.id,
      data: {
        firstName: form.firstName.trim() || client.firstName,
        lastName: form.lastName.trim() || client.lastName,
        phone: form.phone,
        email: form.email,
      },
    })
    await Promise.all([utils.clients.get.invalidate({ id: client.id }), utils.clients.list.invalidate()])
    setEditing(false)
    setFlash(true)
    setTimeout(() => setFlash(false), 1000)
    toast('Saved')
  }

  const setPref = (key: keyof Prefs, v: boolean) => {
    const next = { ...prefs, [key]: v }
    setPrefs(next)
    localStorage.setItem(PREFS_KEY, JSON.stringify(next))
    toast('Preference saved')
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(`${what} copied`)
    } catch {
      toast.error('Copy failed')
    }
  }

  const bookAgain = (a: ClientAppt) => {
    prefill({ items: itemsFromAppointment(a), step: 3 })
    navigate('/book')
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 px-4 pb-8 pt-5">
        <div className="h-[180px] animate-pulse rounded-r-xl bg-cream" />
        <div className="h-[220px] animate-pulse rounded-r-lg bg-cream" />
        <div className="h-[300px] animate-pulse rounded-r-lg bg-cream" />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="px-4 pb-8 pt-5">
        <ClientToaster />
        <h1 className="font-display text-[32px] font-semibold leading-[38px] tracking-[-0.01em] text-ink">
          Account
        </h1>
        <div className="mt-6 flex flex-col items-center rounded-r-xl border border-line bg-surface p-8 text-center">
          <img src="/empty-calendar.svg" alt="" className="h-[120px] w-[160px] opacity-80" />
          <h3 className="mt-3 text-[15px] font-bold text-ink">No profile loaded</h3>
          <p className="mt-1 text-small text-ink-soft">Find your bookings with your phone number.</p>
          <button
            type="button"
            onClick={() => setPhoneSheet(true)}
            className="mt-4 flex h-11 items-center rounded-r-md bg-clay px-5 text-[14px] font-semibold text-white hover:bg-clay-deep"
          >
            Find my bookings
          </button>
        </div>
        <PhoneSheet open={phoneSheet} onClose={() => setPhoneSheet(false)} salonId={salonId} />
      </div>
    )
  }

  const inputCls =
    'h-10 w-full rounded-r-sm border border-line bg-surface px-3 text-[14px] text-ink focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/30'

  return (
    <div className="px-4 pb-8 pt-5">
      <ClientToaster />
      <h1 className="font-display text-[32px] font-semibold leading-[38px] tracking-[-0.01em] text-ink">
        Account
      </h1>

      {/* ---------- Profile card ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
        className={cn(
          'mt-4 rounded-r-xl border border-line p-5 transition-colors duration-500',
          flash ? 'bg-clay-tint' : 'bg-surface',
        )}
      >
        <div className="flex items-start gap-4">
          <Avatar initials={initialsOf(client.firstName, client.lastName)} tint="clay" size={64} />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[22px] font-semibold leading-[28px] text-ink">
              {client.firstName} {client.lastName}
            </h2>
            <p className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
              Client since {format(new Date(client.createdAt), 'MMMM yyyy')}
            </p>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              className="flex h-9 items-center gap-1 rounded-r-md px-2.5 text-[13px] font-bold text-ink-soft transition-colors hover:bg-cream hover:text-clay"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
        </div>

        <div className="relative mt-4">
          <motion.div
            animate={{ opacity: editing ? 0 : 1 }}
            transition={{ duration: 0.24 }}
            className={cn(editing && 'pointer-events-none absolute inset-0')}
          >
            <div className="flex flex-col gap-2">
              {client.phone && (
                <div className="flex items-center gap-2 text-[14px] text-ink-soft">
                  <Phone className="h-4 w-4 text-ink-faint" />
                  <span className="tnum flex-1">{client.phone}</span>
                  <button
                    type="button"
                    onClick={() => void copy(client.phone!, 'Phone')}
                    className="flex h-8 w-8 items-center justify-center rounded-r-md text-ink-faint hover:bg-cream hover:text-clay"
                    title="Copy phone"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {client.email && (
                <div className="flex items-center gap-2 text-[14px] text-ink-soft">
                  <Mail className="h-4 w-4 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate">{client.email}</span>
                  <button
                    type="button"
                    onClick={() => void copy(client.email!, 'Email')}
                    className="flex h-8 w-8 items-center justify-center rounded-r-md text-ink-faint hover:bg-cream hover:text-clay"
                    title="Copy email"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </motion.div>

          {editing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.24 }}
              className="flex flex-col gap-2.5"
            >
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  placeholder="First name"
                />
                <input
                  className={inputCls}
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  placeholder="Last name"
                />
              </div>
              <input
                className={inputCls}
                value={form.phone}
                inputMode="tel"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Phone"
              />
              <input
                className={inputCls}
                value={form.email}
                inputMode="email"
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Email"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={updateClient.isPending}
                  onClick={() => void saveEdit()}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-r-md bg-clay text-[13.5px] font-bold text-white hover:bg-clay-deep disabled:opacity-60"
                >
                  <Check className="h-4 w-4" />
                  {updateClient.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-r-md text-[13.5px] font-bold text-ink-soft hover:bg-cream"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </div>

        {/* Loyalty micro-band */}
        <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4 text-center">
          <div className="flex-1">
            <p className="text-[16px]">
              <CountUp value={stats.visits} format={(n) => `${n}`} />
            </p>
            <p className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">visits</p>
          </div>
          <div className="h-8 w-px bg-line" />
          <div className="flex-1">
            <p className="text-[16px]">
              <CountUp value={stats.cents} format={(n) => fmtMoney(n)} />
            </p>
            <p className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">lifetime</p>
          </div>
          <div className="h-8 w-px bg-line" />
          <div className="flex-1">
            <p className="truncate text-[13px] font-extrabold text-clay">
              {stats.fav ? shortName(stats.fav.name) : '—'}
            </p>
            <p className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">favorite tech</p>
          </div>
        </div>
      </motion.section>

      {/* ---------- Preferences ---------- */}
      <section className="mt-5 rounded-r-lg border border-line bg-surface px-4 py-1">
        <PrefRow
          icon={Bell}
          label="Text reminders"
          helper="24h and 2h before your appointment"
          control={<Toggle on={prefs.textReminders} onChange={(v) => setPref('textReminders', v)} label="Text reminders" />}
        />
        <div className="h-px bg-line" />
        <PrefRow
          icon={Mail}
          label="Email receipts"
          control={<Toggle on={prefs.emailReceipts} onChange={(v) => setPref('emailReceipts', v)} label="Email receipts" />}
        />
        <div className="h-px bg-line" />
        <PrefRow
          icon={Sparkles}
          label="Promotions"
          control={<Toggle on={prefs.promotions} onChange={(v) => setPref('promotions', v)} label="Promotions" />}
        />
        <div className="h-px bg-line" />
        <PrefRow
          icon={UserRound}
          label="Preferred technician"
          helper="Pre-selected on your next booking"
          control={
            <select
              value={preferred}
              onChange={(e) => {
                const v = Number(e.target.value)
                setPreferred(v)
                localStorage.setItem(PREFERRED_KEY, String(v))
                toast('Preference saved')
              }}
              className="h-10 max-w-[150px] rounded-r-sm border border-line bg-surface px-2 text-[13px] font-semibold text-ink focus:border-clay focus:outline-none"
            >
              <option value={0}>No preference</option>
              {historyTechs.map((t) => (
                <option key={t.id} value={t.id}>
                  {shortName(t.name)}
                </option>
              ))}
            </select>
          }
        />
        {client.notes.length > 0 && (
          <>
            <div className="h-px bg-line" />
            <div className="py-3">
              <p className="text-[14px] font-semibold text-ink">Notes for the salon</p>
              <p className="mb-2 text-micro font-semibold uppercase tracking-[0.08em] text-ink-faint">
                The salon keeps these on file — call to change
              </p>
              <div className="flex flex-col gap-1.5">
                {client.notes.map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      'flex items-start gap-2 rounded-r-md px-2.5 py-2 text-small font-semibold',
                      n.kind === 'allergy'
                        ? 'bg-rust-tint text-rust'
                        : n.kind === 'alert'
                          ? 'bg-amber-tint text-amber'
                          : 'bg-cream text-ink-soft',
                    )}
                  >
                    <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {n.text}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* ---------- History timeline ---------- */}
      <section className="mt-7">
        <h3 className="mb-3 text-[15px] font-bold leading-[22px] text-ink">History</h3>
        {history.length === 0 ? (
          <div className="flex flex-col items-center rounded-r-xl border border-line bg-surface p-8 text-center">
            <img src="/empty-calendar.svg" alt="" className="h-[120px] w-[160px] opacity-80" />
            <p className="mt-3 text-[14px] font-semibold text-ink">
              Your history starts with your first visit.
            </p>
            <button
              type="button"
              onClick={() => navigate('/book')}
              className="mt-4 flex h-11 items-center gap-2 rounded-r-md bg-clay px-5 text-[14px] font-semibold text-white hover:bg-clay-deep"
            >
              <CalendarPlus className="h-4 w-4" />
              Book now
            </button>
          </div>
        ) : (
          <>
            <div className="relative ml-1.5 border-l-2 border-line-strong pl-5">
              {timelineGroups.map((g) => (
                <div key={g.month} className="mb-5">
                  <p className="sticky top-0 z-10 -ml-5 mb-2 bg-surface py-1 pl-5 text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
                    {g.month}
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {g.rows.map((a) => {
                      const cat = CAT_CLASSES[catKeyOf(a.items[0]?.service?.name ?? '')]
                      const tech = a.items.find((i) => i.staff?.name)?.staff?.name
                      const hasProcessing = a.items.some((i) => i.processingMin > 0)
                      return (
                        <motion.div
                          key={a.id}
                          initial={{ opacity: 0, scale: 0.9 }}
                          whileInView={{ opacity: 1, scale: 1 }}
                          viewport={{ once: true, amount: 0.15 }}
                          transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                          className="relative"
                        >
                          <span
                            className={cn(
                              'absolute -left-[27.5px] top-3.5 h-3 w-3 rounded-r-pill border-2 border-surface',
                              cat.dot,
                            )}
                          />
                          <div className="rounded-r-md border border-line bg-surface p-3">
                            <div className="flex items-baseline gap-2">
                              <span className="tnum w-12 shrink-0 text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
                                {format(parseDate(a.date), 'MMM d')}
                              </span>
                              <div className="min-w-0 flex-1">
                                {a.items.map((i) => (
                                  <p key={i.id} className="truncate text-[14px] font-semibold leading-[20px] text-ink">
                                    {i.service?.name ?? 'Service'}
                                  </p>
                                ))}
                                <p className="mt-0.5 text-small text-ink-faint">
                                  {tech ? `with ${shortName(tech)}` : 'Any available'} · {fmtMin(a.startMin)}
                                  {hasProcessing && (
                                    <span className="ml-1.5 inline-flex rounded-r-pill bg-cream px-1.5 py-0.5 align-middle text-micro font-bold uppercase tracking-[0.08em] text-ink-soft [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(42,33,26,.06)_3px,rgba(42,33,26,.06)_5px)]">
                                      processing
                                    </span>
                                  )}
                                </p>
                              </div>
                              <StatusChip
                                status={a.status === 'no-show' ? 'no-show' : a.status === 'cancelled' ? 'cancelled' : 'completed'}
                              />
                              <span className="tnum shrink-0 text-[13.5px] font-extrabold text-ink">
                                {fmtMoney(a.items.reduce((s, i) => s + i.priceCents, 0))}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-end gap-1 border-t border-line pt-2">
                              <button
                                type="button"
                                onClick={() => bookAgain(a)}
                                className="group flex h-9 items-center gap-0.5 rounded-r-md px-2 text-[12.5px] font-bold text-clay hover:bg-clay-tint"
                              >
                                Book again
                                <span className="transition-transform duration-150 group-hover:translate-x-1">→</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => toast('Receipt sent to email')}
                                title="Email receipt"
                                className="flex h-9 w-9 items-center justify-center rounded-r-md text-ink-faint hover:bg-cream hover:text-clay"
                              >
                                <Receipt className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {visibleCount < history.length && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + 5)}
                className="mt-1 h-11 w-full rounded-r-md border border-line bg-surface text-[13.5px] font-bold text-ink-soft hover:bg-cream"
              >
                Load more
              </button>
            )}
            <p className="tnum mt-4 text-center text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
              {history.length} visits · {fmtMoney(history.reduce((s, a) => s + a.items.reduce((x, i) => x + i.priceCents, 0), 0))}{' '}
              · since {format(new Date(client.createdAt), 'yyyy')}
            </p>
          </>
        )}
      </section>

      {/* ---------- Data & session ---------- */}
      <section className="mt-7 rounded-r-lg border border-line bg-surface p-4">
        <p className="text-small font-semibold text-ink-soft">
          Signed in as <span className="tnum">{client.phone ?? '—'}</span>
          <button
            type="button"
            onClick={() => setPhoneSheet(true)}
            className="ml-2 font-bold text-clay hover:underline"
          >
            Switch
          </button>
        </p>
        <p className="mt-1.5 text-micro font-semibold uppercase tracking-[0.08em] text-ink-faint">
          This is a demo — data resets nightly.
        </p>
        <button
          type="button"
          onClick={() => {
            signOut()
            toast('Signed out — book anytime with your phone number')
          }}
          className="mt-2.5 h-10 rounded-r-md px-2 text-[13px] font-bold text-rust hover:bg-rust-tint"
        >
          Sign out
        </button>
      </section>

      <PhoneSheet open={phoneSheet} onClose={() => setPhoneSheet(false)} salonId={salonId} />
    </div>
  )
}
