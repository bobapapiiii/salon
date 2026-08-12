// ─── Job Card, the day's printable tickets ──────────────────────────────────
// Full-screen section. Every booking on the day becomes one card per person,
// bucketed into the salon's booking interval (Settings → Online booking) so the
// front desk can print a whole time slot at once, print a single card, or print
// the entire day. Printing goes to a receipt printer via the browser dialog.
import { useMemo, useState } from 'react'
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, Heart, Printer, X,
} from 'lucide-react'
import type { Appointment, ClientRecord } from '@/lib/booking-types'
import { fmtTime } from '@/lib/booking-types'
import { useSettingsStore } from '@/lib/settings-store'
import { svcById } from '@/lib/services-store'
import { useStaffStore } from '@/lib/staff-store'
import { buildJobCard, cardGroupsFor, printJobCards, type JobCardCtx } from '@/lib/job-card'
import { DatePickerPopover } from './LegendPopover'

function dayKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayLabelOf(key: string) {
  return new Date(key + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}
function shiftDay(key: string, delta: number) {
  const d = new Date(key + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return dayKeyOf(d)
}

interface Props {
  open: boolean
  /** the day being shown — starts on whatever the calendar is showing */
  dateKey: string
  onDate: (key: string) => void
  /** appointments for any day */
  dayAppts: (key: string) => Appointment[]
  clients: ClientRecord[]
  /** days that have any bookings, for dots in the date picker */
  apptDates: Set<string>
  onClose: () => void
}

export function JobCardPage({ open, dateKey, onDate, dayAppts, clients, apptDates, onClose }: Props) {
  const settings = useSettingsStore()
  const increment = settings.booking.increment
  const width = settings.jobCard.width
  const salonName = settings.general.name
  const { techs } = useStaffStore()

  const [dateAnchor, setDateAnchor] = useState<DOMRect | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<string | null>(null)

  const appts = useMemo(
    () => (open ? dayAppts(dateKey).filter((a) => a.status !== 'no_show') : []),
    [open, dateKey, dayAppts],
  )

  const ctx: JobCardCtx = useMemo(
    () => ({
      svc: (id) => svcById[id],
      techs,
      clients,
      dateLabel: dayLabelOf(dateKey),
      dayAppts: appts,
    }),
    [techs, clients, dateKey, appts],
  )

  /** every card on the day, each tagged with the interval bucket it falls in */
  const cards = useMemo(
    () =>
      cardGroupsFor(appts).map((g) => {
        const startMin = Math.min(...g.map((a) => a.startMin))
        return {
          key: `${g[0].parallelGroup ?? g[0].id}::${g[0].clientName}`,
          bucket: Math.floor(startMin / increment) * increment,
          startMin,
          appts: g,
          data: buildJobCard(g, ctx),
        }
      }),
    [appts, increment, ctx],
  )

  const buckets = useMemo(() => {
    const m = new Map<number, typeof cards>()
    for (const c of cards) {
      const list = m.get(c.bucket)
      if (list) list.push(c)
      else m.set(c.bucket, [c])
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [cards])

  if (!open) return null

  const doPrint = (list: typeof cards, label: string) => {
    if (list.length === 0) return
    const ok = printJobCards(list.map((c) => c.data), width, salonName)
    setFlash(
      ok
        ? `Printing ${list.length} ${list.length === 1 ? 'card' : 'cards'}${label ? ` · ${label}` : ''}`
        : 'Your browser blocked the print window — allow pop-ups for this site',
    )
    window.setTimeout(() => setFlash(null), 3200)
  }

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const selectedCards = cards.filter((c) => selected.has(c.key))

  const btn = 'flex h-9 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-cream'

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-[#FAF8FA]">
      {/* ══ header ══ */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <div className="min-w-0">
          <h1 className="text-[17px] font-extrabold leading-tight text-ink">Job Card</h1>
          <p className="truncate text-[12px] font-medium text-ink-soft">
            {cards.length} {cards.length === 1 ? 'card' : 'cards'} · grouped every {increment} minutes · {width}mm roll
          </p>
        </div>

        <div className="ml-4 flex items-center gap-1">
          <button type="button" title="Previous day" onClick={() => onDate(shiftDay(dateKey, -1))}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface text-ink-soft transition-colors hover:bg-cream">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onDate(dayKeyOf(new Date()))}
            className="h-9 rounded-[10px] border border-line px-3 text-[13px] font-bold text-ink-soft transition-colors hover:bg-cream">
            {dayLabelOf(dateKey)}
          </button>
          <button type="button" title="Next day" onClick={() => onDate(shiftDay(dateKey, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface text-ink-soft transition-colors hover:bg-cream">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" title="Pick a date"
            onClick={(e) => setDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface text-ink-soft transition-colors hover:bg-cream">
            <CalendarDays className="h-4 w-4" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <button type="button" className={btn} onClick={() => doPrint(selectedCards, 'selected')}>
              <Printer className="h-4 w-4" />
              Print selected ({selected.size})
            </button>
          )}
          <button
            type="button"
            onClick={() => doPrint(cards, 'whole day')}
            disabled={cards.length === 0}
            className="flex h-10 items-center gap-1.5 rounded-[10px] bg-clay px-4 text-[14px] font-semibold text-white shadow-sh-1 transition-all duration-150 hover:-translate-y-px hover:bg-clay-deep active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <Printer className="h-4 w-4" />
            Print all
          </button>
          <button type="button" title="Close" onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface text-ink-soft transition-colors hover:bg-cream">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {flash && (
        <div className="shrink-0 border-b border-line bg-clay-tint px-4 py-2 text-[13px] font-semibold text-clay">
          {flash}
        </div>
      )}

      {/* ══ buckets ══ */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {buckets.length === 0 && (
          <div className="mx-auto mt-24 max-w-sm text-center">
            <p className="text-[15px] font-bold text-ink">Nothing booked</p>
            <p className="mt-1 text-[13px] text-ink-soft">
              There are no appointments on {dayLabelOf(dateKey)} to print job cards for.
            </p>
          </div>
        )}

        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          {buckets.map(([bucket, list]) => (
            <section key={bucket} className="overflow-hidden rounded-[12px] border border-line bg-surface">
              <header className="flex items-center gap-3 border-b border-line bg-cream px-3.5 py-2.5">
                <span className="tnum text-[14px] font-extrabold text-ink">{fmtTime(bucket)}</span>
                <span className="text-[12px] font-semibold text-ink-soft">
                  {list.length} {list.length === 1 ? 'card' : 'cards'}
                </span>
                <button type="button" className={`${btn} ml-auto h-8`} onClick={() => doPrint(list, fmtTime(bucket))}>
                  <Printer className="h-3.5 w-3.5" />
                  Print this slot
                </button>
              </header>

              <ul className="divide-y divide-line">
                {list.map((c) => {
                  const isSel = selected.has(c.key)
                  return (
                    <li key={c.key} className="flex items-start gap-3 px-3.5 py-3">
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        title={isSel ? 'Deselect' : 'Select for batch print'}
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
                          isSel ? 'border-clay bg-clay text-white' : 'border-line bg-surface hover:bg-cream'
                        }`}
                      >
                        {isSel && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-bold text-ink">{c.data.clientName}</span>
                          {c.data.phone && <span className="text-[12px] font-medium text-ink-soft">{c.data.phone}</span>}
                          {c.data.group && (
                            <span className="rounded-full border border-clay/40 bg-clay-tint px-2 py-0.5 text-[11px] font-bold text-clay">
                              Group #{c.data.group.size} · host {c.data.group.host}
                            </span>
                          )}
                        </div>

                        <ul className="mt-1 flex flex-col gap-0.5">
                          {c.data.services.map((s, i) => (
                            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-ink-soft">
                              <span className="tnum font-bold text-ink">{s.time}</span>
                              <span className="font-semibold text-ink">{s.name}</span>
                              <span className="font-medium">{s.durationMin}m</span>
                              {s.requestedTechName && (
                                <span className="inline-flex items-center gap-1 font-bold text-ink">
                                  <Heart className="h-3 w-3" style={{ color: '#16A34A', fill: '#16A34A' }} />
                                  {s.requestedTechName}
                                </span>
                              )}
                              {s.preferLabel && (
                                <span
                                  className="inline-flex items-center gap-1 font-bold"
                                  style={{ color: s.preferLabel === 'F PREFER' ? '#EC4899' : '#2563EB' }}
                                >
                                  <Heart
                                    className="h-3 w-3"
                                    style={{
                                      color: s.preferLabel === 'F PREFER' ? '#EC4899' : '#2563EB',
                                      fill: s.preferLabel === 'F PREFER' ? '#EC4899' : '#2563EB',
                                    }}
                                  />
                                  {s.preferLabel}
                                </span>
                              )}
                              {s.addons.length > 0 && (
                                <span className="font-medium">
                                  {s.addons.map((a) => `+ ${a.name}`).join(', ')}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>

                        {c.data.notes.length > 0 && (
                          <p className="mt-1 text-[12px] font-medium italic text-ink-soft">
                            {c.data.notes.join(' · ')}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        title="Print this job card"
                        onClick={() => doPrint([c], c.data.clientName)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface text-ink-soft transition-colors hover:bg-cream"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>

      {dateAnchor && (
        <DatePickerPopover
          anchor={dateAnchor}
          selected={dateKey}
          today={dayKeyOf(new Date())}
          appointmentDates={apptDates}
          onSelect={(d) => { onDate(d); setDateAnchor(null) }}
          onClose={() => setDateAnchor(null)}
        />
      )}
    </div>
  )
}
