import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragMoveEvent, DragStartEvent } from '@dnd-kit/core'
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Eye,
  Inbox,
  Info,
  ListFilter,
  PanelRight,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { toast, Toaster } from 'sonner'

import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import { AppointmentBlock, BlockVisual } from '@/components/schedule/AppointmentBlock'
import type { BlockData } from '@/components/schedule/AppointmentBlock'
import {
  GroupBand,
  NowLine,
  OffDayState,
  ScheduleSkeleton,
  TechColumnHeader,
  TimeGutter,
  UnassignedHeader,
} from '@/components/schedule/GridChrome'
import { ScheduleStyles, SegmentedControl, IconBtn } from '@/components/schedule/shared'
import { AppointmentPopover } from '@/components/schedule/AppointmentPopover'
import type { PopoverAnchor } from '@/components/schedule/AppointmentPopover'
import { QuickCreateModal } from '@/components/schedule/QuickCreateModal'
import type { CreatePrefill } from '@/components/schedule/QuickCreateModal'
import { EditAppointmentModal } from '@/components/schedule/EditAppointmentModal'
import { RequestsRail } from '@/components/schedule/RequestsRail'
import { DatePickerPopover, LegendPopover } from '@/components/schedule/HeaderPopovers'
import {
  CATEGORY_COLORS,
  COL_MIN_W,
  GROUP_LABEL,
  GUTTER_W,
  UNASSIGNED_W,
  addDaysStr,
  categoryKeyFromName,
  fmtRange,
  minToTime,
  nextWorkingLabel,
  nowMinutes,
  prettyDate,
  pxPerMin,
  snap,
  techConflict,
  workWindow,
  type Appointment,
  type ApptItem,
  type ApptStatus,
  type CatKey,
  type ColorMode,
  type Density,
  type StaffMember,
} from '@/components/schedule/schedule-utils'

/* ── URL state helpers ─────────────────────────────────────────────── */
const GROUP_ORDER: CatKey[] = ['nails', 'hair', 'lashes', 'spa']

function parseDensity(v: string | null): Density {
  return v === '15' ? 15 : v === '60' ? 60 : 30
}

/* ── Column body (droppable) ───────────────────────────────────────── */
function ColumnBody({
  colKey,
  staffId,
  width,
  gridH,
  openMin,
  closeMin,
  density,
  offDuty,
  unassigned,
  wash,
  ghost,
  onSlotClick,
  children,
}: {
  colKey: string
  staffId: number | null
  width: number
  gridH: number
  openMin: number
  closeMin: number
  density: Density
  offDuty?: boolean
  unassigned?: boolean
  wash: 'valid' | 'invalid' | null
  ghost: { topMin: number; durationMin: number } | null
  onSlotClick: (staffId: number | null, min: number) => void
  children?: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: colKey, data: { staffId } })
  const ppm = pxPerMin(density)
  const hours: number[] = []
  for (let h = Math.ceil(openMin / 60) * 60; h <= closeMin; h += 60) hours.push(h)

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative h-full shrink-0 border-r border-line transition-colors duration-150',
        offDuty && 'bg-cream/50',
        unassigned && 'sched-stripe-bg bg-cream/60',
        isOver && wash === 'valid' && 'bg-clay-tint/60',
        isOver && wash === 'invalid' && 'bg-rust-tint/60',
      )}
      style={{ width, height: gridH }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const min = openMin + snap((e.clientY - rect.top) / ppm, density)
        onSlotClick(staffId, Math.max(openMin, Math.min(closeMin - density, min)))
      }}
    >
      {/* hour lines */}
      {hours.map((h) => (
        <span
          key={h}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-line/70"
          style={{ top: (h - openMin) * ppm }}
        />
      ))}
      {density === 15 &&
        hours.map((h) =>
          h + 30 < closeMin ? (
            <span
              key={`h${h}`}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 border-t border-line/35"
              style={{ top: (h + 30 - openMin) * ppm }}
            />
          ) : null,
        )}
      {offDuty && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rotate-180 text-micro font-bold uppercase tracking-[0.2em] text-ink-faint [writing-mode:vertical-rl]">
            Off today
          </span>
        </span>
      )}
      {ghost && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-1 rounded-r-sm border-2 border-dashed z-10',
            wash === 'invalid' ? 'border-rust/60 bg-rust-tint/40' : 'border-clay/60 bg-clay-tint/40',
          )}
          style={{
            top: (ghost.topMin - openMin) * ppm,
            height: Math.max(20, ghost.durationMin * ppm),
          }}
        />
      )}
      {children}
    </div>
  )
}

/* ── Main page ─────────────────────────────────────────────────────── */
export default function Schedule() {
  const [searchParams, setSearchParams] = useSearchParams()

  /* ── data ── */
  const salonQ = trpc.salon.get.useQuery()
  const todayQ = trpc.salon.today.useQuery()
  const salonId = salonQ.data?.id ?? 0
  const todayStr = todayQ.data?.today ?? ''

  const date = searchParams.get('date') ?? todayStr
  const density = parseDensity(searchParams.get('density'))
  const colorMode: ColorMode = searchParams.get('color') === 'status' ? 'status' : 'category'
  const railOpen = searchParams.get('rail') !== 'closed'

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams)
      for (const [k, v] of Object.entries(patch)) {
        if (v == null) next.delete(k)
        else next.set(k, v)
      }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const staffQ = trpc.staff.list.useQuery({ salonId }, { enabled: salonId > 0 })
  const servicesQ = trpc.services.list.useQuery({ salonId }, { enabled: salonId > 0 })
  const apptsQ = trpc.appointments.byDate.useQuery(
    { salonId, date },
    { enabled: salonId > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) },
  )
  const requestsQ = trpc.requests.list.useQuery(
    { salonId, status: 'pending' },
    { enabled: salonId > 0, refetchInterval: 30_000 },
  )

  const salon = salonQ.data
  const openMin = salon?.openMin ?? 480
  const closeMin = salon?.closeMin ?? 1200
  const staff = useMemo(() => staffQ.data ?? [], [staffQ.data])
  const categories = useMemo(() => servicesQ.data ?? [], [servicesQ.data])
  const appointments = useMemo(() => apptsQ.data ?? [], [apptsQ.data])
  const requests = useMemo(() => requestsQ.data ?? [], [requestsQ.data])

  const loading =
    salonQ.isLoading || staffQ.isLoading || servicesQ.isLoading || (apptsQ.isLoading && salonId > 0)

  /* ── filters ── */
  const [workingOnly, setWorkingOnly] = useState(true)
  const [techSearch, setTechSearch] = useState('')
  const [hiddenGroups, setHiddenGroups] = useState<Set<CatKey>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<CatKey>>(new Set())
  const [offPopover, setOffPopover] = useState(false)

  const workingTechs = useMemo(
    () => staff.filter((t) => t.active && workWindow(t, date) != null),
    [staff, date],
  )
  const offDutyTechs = useMemo(
    () => staff.filter((t) => t.active && workWindow(t, date) == null),
    [staff, date],
  )
  const visibleTechs = useMemo(() => {
    const q = techSearch.trim().toLowerCase()
    return staff.filter((t) => {
      if (!t.active) return false
      if (workingOnly && workWindow(t, date) == null) return false
      if (hiddenGroups.has(t.roleGroup as CatKey)) return false
      if (q && !t.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [staff, workingOnly, date, hiddenGroups, techSearch])

  const groups = useMemo(() => {
    const out: { key: CatKey; techs: StaffMember[] }[] = []
    for (const g of GROUP_ORDER) {
      const techs = visibleTechs
        .filter((t) => t.roleGroup === g)
        .sort((a, b) => a.name.localeCompare(b.name))
      if (techs.length) out.push({ key: g, techs })
    }
    return out
  }, [visibleTechs])

  /* ── geometry ── */
  const scrollRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(1200)
  const [scrollState, setScrollState] = useState({ left: false, right: false, x: 0 })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setContainerW(el.clientWidth)
      setScrollState({
        left: el.scrollLeft > 4,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
        x: el.scrollLeft,
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ppm = pxPerMin(density)
  const gridH = (closeMin - openMin) * ppm
  const expandedCount = groups.reduce(
    (n, g) => n + (collapsedGroups.has(g.key) ? 0 : g.techs.length),
    0,
  )
  const collapsedCount = groups.filter((g) => collapsedGroups.has(g.key)).length
  const availW = Math.max(0, containerW - GUTTER_W - UNASSIGNED_W - collapsedCount * 48)
  const colW = Math.max(COL_MIN_W, Math.floor(availW / Math.max(1, expandedCount)))

  /* ── categorization helpers ── */
  const catNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])
  const catKeyOf = useCallback(
    (item: ApptItem): CatKey => categoryKeyFromName(catNameById.get(item.service.categoryId)),
    [catNameById],
  )
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff])

  const countByStaff = useMemo(() => {
    const m = new Map<number, number>()
    for (const a of appointments) {
      if (a.status === 'cancelled') continue
      for (const it of a.items) {
        if (it.staffId != null) m.set(it.staffId, (m.get(it.staffId) ?? 0) + 1)
      }
    }
    return m
  }, [appointments])

  const unassignedItems = useMemo(() => {
    const out: { appt: Appointment; item: ApptItem }[] = []
    for (const a of appointments)
      for (const it of a.items) if (it.staffId == null) out.push({ appt: a, item: it })
    // simple lane packing for overlaps
    out.sort((x, y) => x.item.startMin - y.item.startMin)
    const lanes: number[] = []
    return out.map((x) => {
      let lane = lanes.findIndex((end) => end <= x.item.startMin)
      if (lane === -1) {
        lane = lanes.length
        lanes.push(0)
      }
      lanes[lane] = x.item.endMin
      return { ...x, lane }
    })
  }, [appointments])
  const unassignedLaneCount = Math.max(1, ...unassignedItems.map((x) => x.lane + 1))

  const apptCountByGroup = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of appointments) {
      if (a.status === 'cancelled') continue
      for (const it of a.items) {
        const key = catKeyOf(it)
        m.set(key, (m.get(key) ?? 0) + 1)
      }
    }
    return m
  }, [appointments, catKeyOf])

  const isToday = date === todayStr && todayStr !== ''
  const [nowMin, setNowMin] = useState(nowMinutes())
  const [nowPulse, setNowPulse] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setNowMin(nowMinutes()), 30_000)
    return () => clearInterval(t)
  }, [])

  const activeApptCount = appointments.filter((a) => a.status !== 'cancelled').length

  /* ── overlay / modal state ── */
  const [popover, setPopover] = useState<PopoverAnchor | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createPrefill, setCreatePrefill] = useState<CreatePrefill>({ staffId: null, startMin: null })
  const [editAppt, setEditAppt] = useState<Appointment | null>(null)
  const [legendAnchor, setLegendAnchor] = useState<DOMRect | null>(null)
  const [dateAnchor, setDateAnchor] = useState<DOMRect | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [shaking, setShaking] = useState<Set<number>>(new Set())
  const [partnerHover, setPartnerHover] = useState<string | null>(null)
  const [cancelTimes, setCancelTimes] = useState<Map<number, number>>(new Map())
  const flashStaff = useMemo(() => {
    const s = new Set<number>()
    if (partnerHover) {
      for (const a of appointments)
        if (a.sameTimeGroupId === partnerHover)
          for (const it of a.items) if (it.staffId != null) s.add(it.staffId)
    }
    return s
  }, [partnerHover, appointments])
  const undoStack = useRef<(() => void)[]>([])
  const suppressClick = useRef(false)

  const shake = useCallback((apptId: number) => {
    setShaking((s) => new Set(s).add(apptId))
    setTimeout(() => {
      setShaking((s) => {
        const n = new Set(s)
        n.delete(apptId)
        return n
      })
    }, 450)
  }, [])

  const blockRefs = useRef(new Map<number, HTMLElement>())
  const registerRef = useCallback((itemId: number, el: HTMLElement | null) => {
    if (el) blockRefs.current.set(itemId, el)
    else blockRefs.current.delete(itemId)
  }, [])

  /* ── mutations with optimistic updates + undo toasts ────────────── */
  const utils = trpc.useUtils()
  const dayKey = { salonId, date }
  const rescheduleMut = trpc.appointments.reschedule.useMutation()
  const statusMut = trpc.appointments.updateStatus.useMutation()

  const invalidateDay = useCallback(() => {
    void utils.appointments.byDate.invalidate(dayKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utils, salonId, date])

  const friendlyError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : ''
    if (msg.toLowerCase().includes('conflict')) return 'Overlaps an existing appointment'
    return msg || "Couldn't save — restored"
  }

  const doReschedule = useCallback(
    (
      appt: Appointment,
      patch: { startMin?: number; staffId?: number | null },
      opts?: { silent?: boolean; undoTo?: { startMin: number; staffId: number | null } },
    ) => {
      const prev = utils.appointments.byDate.getData(dayKey)
      // optimistic
      utils.appointments.byDate.setData(dayKey, (old) =>
        old?.map((a) => {
          if (a.id !== appt.id) return a
          const delta = patch.startMin !== undefined ? patch.startMin - a.startMin : 0
          const items = a.items.map((it) => ({
            ...it,
            startMin: it.startMin + delta,
            endMin: it.endMin + delta,
            staffId: patch.staffId !== undefined ? patch.staffId : it.staffId,
          }))
          return {
            ...a,
            startMin: a.startMin + delta,
            endMin: a.endMin + delta,
            items,
          }
        }),
      )
      rescheduleMut.mutate(
        { id: appt.id, startMin: patch.startMin, staffId: patch.staffId },
        {
          onSuccess: () => {
            invalidateDay()
            if (!opts?.silent) {
              const techName =
                patch.staffId === null
                  ? 'Unassigned'
                  : patch.staffId != null
                    ? (staffById.get(patch.staffId)?.name ?? 'tech')
                    : (appt.items[0]?.staff?.name ?? 'tech')
              const time = minToTime(patch.startMin ?? appt.startMin)
              const undoTo = opts?.undoTo ?? {
                startMin: appt.startMin,
                staffId: appt.items[0]?.staffId ?? null,
              }
              const undo = () =>
                doReschedule(appt, { startMin: undoTo.startMin, staffId: undoTo.staffId }, { silent: true })
              undoStack.current.push(undo)
              toast.success(
                patch.staffId === null ? `Unassigned ${appt.client.firstName}` : `Moved to ${time} with ${techName}`,
                { action: { label: 'Undo', onClick: undo } },
              )
            }
          },
          onError: (e) => {
            utils.appointments.byDate.setData(dayKey, prev)
            shake(appt.id)
            toast.error(friendlyError(e))
          },
        },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [utils, salonId, date, staffById, shake],
  )

  const doStatus = useCallback(
    (appt: Appointment, status: ApptStatus, opts?: { silent?: boolean }) => {
      const prevStatus = appt.status
      const prev = utils.appointments.byDate.getData(dayKey)
      utils.appointments.byDate.setData(dayKey, (old) =>
        old?.map((a) => (a.id === appt.id ? { ...a, status } : a)),
      )
      statusMut.mutate(
        { id: appt.id, status },
        {
          onSuccess: () => {
            invalidateDay()
            if (status === 'cancelled') {
              setCancelTimes((m) => new Map(m).set(appt.id, Date.now()))
              setTimeout(
                () =>
                  setCancelTimes((m) => {
                    const n = new Map(m)
                    n.delete(appt.id)
                    return n
                  }),
                5 * 60_000,
              )
            }
            if (!opts?.silent) {
              const label: Partial<Record<ApptStatus, string>> = {
                confirmed: 'Appointment confirmed',
                'checked-in': `${appt.client.firstName} checked in`,
                'in-progress': 'Service started',
                completed: '✓ Completed',
                'no-show': 'Marked as no-show',
                cancelled: 'Appointment cancelled',
              }
              const undo = () => doStatus(appt, prevStatus, { silent: true })
              undoStack.current.push(undo)
              toast.success(label[status] ?? 'Status updated', {
                action: { label: 'Undo', onClick: undo },
              })
            }
          },
          onError: (e) => {
            utils.appointments.byDate.setData(dayKey, prev)
            shake(appt.id)
            toast.error(friendlyError(e))
          },
        },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [utils, salonId, date, shake],
  )

  /* ── keyboard: ⌘Z undo, ← → day nav ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        const undo = undoStack.current.pop()
        if (undo) {
          e.preventDefault()
          undo()
          toast('Undone')
        }
        return
      }
      if (typing) return
      if (e.key === 'ArrowLeft' && target.closest('[data-schedule-grid]')) {
        setParams({ date: addDaysStr(date, -1) })
      }
      if (e.key === 'ArrowRight' && target.closest('[data-schedule-grid]')) {
        setParams({ date: addDaysStr(date, 1) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [date, setParams])

  /* ── drag & drop ── */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [dragData, setDragData] = useState<{
    kind: 'move' | 'resize-top' | 'resize-bottom'
    appt: Appointment
    item: ApptItem
  } | null>(null)
  const [dropHint, setDropHint] = useState<{
    staffId: number | null
    min: number
    valid: boolean
    reason: string | null
  } | null>(null)

  const findApptItem = useCallback(
    (apptId: number, itemId: number) => {
      const appt = appointments.find((a) => a.id === apptId)
      const item = appt?.items.find((i) => i.id === itemId)
      return appt && item ? { appt, item } : null
    },
    [appointments],
  )

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as
      | { kind: 'move' | 'resize-top' | 'resize-bottom'; apptId: number; itemId: number }
      | undefined
    if (!data) return
    const found = findApptItem(data.apptId, data.itemId)
    if (!found) return
    setDragData({ kind: data.kind, ...found })
    setPopover(null)
  }

  const onDragMove = (e: DragMoveEvent) => {
    if (!dragData) return
    const over = e.over
    if (!over) {
      setDropHint(null)
      return
    }
    const targetStaff = (over.data.current?.staffId ?? null) as number | null
    const rect = over.rect
    const translated = e.active.rect.current.translated
    if (!translated) return
    const { appt, item, kind } = dragData

    let min: number
    if (kind === 'move') min = openMin + snap((translated.top - rect.top) / ppm, density)
    else if (kind === 'resize-top')
      min = openMin + snap((translated.top + 3 - rect.top) / ppm, density)
    else min = openMin + snap((translated.bottom - 3 - rect.top) / ppm, density)
    min = Math.max(openMin, Math.min(closeMin - 15, min))

    // validity
    let valid = true
    let reason: string | null = null
    if (kind === 'resize-bottom') {
      valid = min - item.startMin >= 15
      if (!valid) reason = 'Too short'
    } else {
      const newStart = kind === 'resize-top' ? Math.min(min, item.endMin - 15) : min
      const delta = newStart - appt.startMin
      const span = appt.endMin - appt.startMin
      if (newStart < openMin || newStart + span > closeMin) {
        valid = false
        reason = 'Outside salon hours'
      } else if (targetStaff != null) {
        const tech = staffById.get(targetStaff)
        if (tech) {
          const win = workWindow(tech, date)
          if (!win) {
            valid = false
            reason = `${tech.name} is off that day`
          } else if (newStart < win.start || newStart + span > win.end) {
            valid = false
            reason = `Outside ${tech.name}'s working hours`
          } else {
            for (const it of appt.items) {
              if (!tech.serviceIds.includes(it.serviceId)) {
                valid = false
                reason = `${tech.name} isn't qualified for ${it.service.name}`
                break
              }
              if (
                techConflict(
                  appointments,
                  targetStaff,
                  {
                    startMin: it.startMin + delta,
                    endMin: it.endMin + delta,
                    processingMin: it.processingMin,
                    bufferMin: it.bufferMin,
                  },
                  appt.id,
                )
              ) {
                valid = false
                reason = 'Overlaps an existing appointment'
                break
              }
            }
          }
        }
      }
      min = newStart
    }
    setDropHint({ staffId: targetStaff, min, valid, reason })
  }

  const onDragEnd = () => {
    const data = dragData
    const hint = dropHint
    setDragData(null)
    setDropHint(null)
    suppressClick.current = true
    setTimeout(() => (suppressClick.current = false), 120)
    if (!data || !hint) return
    const { appt, item, kind } = data

    if (!hint.valid) {
      shake(appt.id)
      toast.error(hint.reason ?? "Can't drop there")
      return
    }
    if (kind === 'resize-bottom') {
      // Backend exposes no duration mutation — duration comes from the service.
      toast('Duration comes from the service — adjust it in Services', {
        icon: <Info className="h-4 w-4" />,
      })
      return
    }
    const newStart = hint.min
    const moved = newStart !== appt.startMin
    const staffChanged = hint.staffId !== item.staffId
    if (!moved && !staffChanged) return
    if (!staffChanged) {
      doReschedule(appt, { startMin: newStart })
    } else {
      if (appt.sameTimeGroupId && hint.staffId != null) {
        toast('Linked pair — both services move together', { icon: <Info className="h-4 w-4" /> })
      }
      doReschedule(appt, { startMin: newStart, staffId: hint.staffId })
    }
  }

  /* ── slot click → quick create ── */
  const onSlotClick = useCallback(
    (staffId: number | null, min: number) => {
      if (suppressClick.current) return
      setCreatePrefill({ staffId, startMin: min })
      setCreateOpen(true)
    },
    [],
  )

  const onBlockOpen = useCallback((apptId: number, _itemId: number, rect: DOMRect) => {
    if (suppressClick.current) return
    setPopover({ apptId, rect })
  }, [])

  const onSelectToggle = useCallback((apptId: number) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(apptId)) n.delete(apptId)
      else if (n.size < 10) n.add(apptId)
      return n
    })
  }, [])

  /* ── day navigation ── */
  const goToday = () => {
    setParams({ date: todayStr })
    setNowPulse(true)
    setTimeout(() => setNowPulse(false), 2000)
  }

  const popoverAppt = popover ? appointments.find((a) => a.id === popover.apptId) : undefined

  /* ── mobile fallback (<768px) ── */
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [bannerDismissed, setBannerDismissed] = useState(false)

  /* ── render ── */
  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <ScheduleStyles />
        <ScheduleSkeleton />
      </div>
    )
  }

  const offDay = staff.length > 0 && workingTechs.length === 0

  const headerSubtitle = `${prettyDate(date)} · ${workingTechs.length} of ${staff.filter((t) => t.active).length} techs working · ${activeApptCount} appointments`

  const sharedBlockData = (appt: Appointment, item: ApptItem, lane = 0, laneCount = 1): BlockData => ({
    appt,
    item,
    catKey: catKeyOf(item),
    colorMode,
    nowMin,
    isToday,
    lane,
    laneCount,
    freshCancelled: cancelTimes.has(appt.id),
  })

  const blockProps = (appt: Appointment) => ({
    selected: selected.has(appt.id),
    shaking: shaking.has(appt.id),
    linkedHighlight: partnerHover != null && appt.sameTimeGroupId === partnerHover,
    dragDisabled: false,
    onOpen: onBlockOpen,
    onSelectToggle,
    onPartnerHover: setPartnerHover,
    registerRef,
  })

  return (
    <div className="flex h-full flex-col bg-paper">
      <ScheduleStyles />
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: { background: '#241C15', color: '#FFFEFB', border: 'none', borderRadius: 10 },
          actionButtonStyle: { background: 'transparent', color: '#E8855A', fontWeight: 700 },
        }}
      />

      {/* ══ Section 1 — page header ══ */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <motion.p
          key={date}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="min-w-0 flex-1 truncate text-small font-medium text-ink-soft"
        >
          {headerSubtitle}
        </motion.p>

        {/* date pager */}
        <div className="flex items-center gap-1">
          <IconBtn title="Previous day" onClick={() => setParams({ date: addDaysStr(date, -1) })}>
            <ChevronLeft className="h-4 w-4" />
          </IconBtn>
          <button
            type="button"
            onClick={goToday}
            className={cn(
              'h-9 rounded-r-md border px-3 text-[13px] font-bold transition-colors',
              isToday
                ? 'border-clay/40 bg-clay-tint text-clay'
                : 'border-line text-ink-soft hover:bg-cream',
            )}
          >
            Today
          </button>
          <IconBtn title="Next day" onClick={() => setParams({ date: addDaysStr(date, 1) })}>
            <ChevronRight className="h-4 w-4" />
          </IconBtn>
          <IconBtn
            title="Pick a date"
            onClick={(e) =>
              setDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())
            }
          >
            <CalendarIcon className="h-4 w-4" />
          </IconBtn>
        </div>

        <span className="h-6 w-px bg-line" />

        <SegmentedControl
          ariaLabel="density"
          options={[
            { value: 15 as const, label: '15m' },
            { value: 30 as const, label: '30m' },
            { value: 60 as const, label: '60m' },
          ]}
          value={density}
          onChange={(d) => setParams({ density: String(d) })}
        />

        <span className="h-6 w-px bg-line" />

        <SegmentedControl
          ariaLabel="color-by"
          options={[
            { value: 'category' as const, label: 'Category' },
            { value: 'status' as const, label: 'Status' },
          ]}
          value={colorMode}
          onChange={(m) => setParams({ color: m })}
        />

        <IconBtn
          title="Legend"
          onClick={(e) => setLegendAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())}
        >
          <ListFilter className="h-4 w-4" />
        </IconBtn>

        <span className="h-6 w-px bg-line" />

        <button
          type="button"
          onClick={() => {
            setCreatePrefill({ staffId: null, startMin: null })
            setCreateOpen(true)
          }}
          className="flex h-10 items-center gap-1.5 rounded-r-md bg-clay px-4 text-[14px] font-semibold text-white shadow-sh-1 transition-all duration-150 hover:-translate-y-px hover:bg-clay-deep active:translate-y-0"
        >
          <Plus className="h-4 w-4" />
          Appointment
        </button>

        <IconBtn
          title={railOpen ? 'Hide requests' : 'Show requests'}
          badge={requests.length}
          onClick={() => setParams({ rail: railOpen ? 'closed' : 'open' })}
        >
          <PanelRight className="h-4 w-4" />
        </IconBtn>
      </div>

      {/* ══ Section 2 — filter bar ══ */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-cream px-4">
        <button
          type="button"
          role="switch"
          aria-checked={workingOnly}
          onClick={() => setWorkingOnly((v) => !v)}
          className="flex items-center gap-2"
        >
          <span
            className={cn(
              'relative h-5 w-9 rounded-r-pill transition-colors duration-150',
              workingOnly ? 'bg-clay' : 'bg-line-strong',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-4 w-4 rounded-r-pill bg-white shadow transition-all duration-150',
                workingOnly ? 'left-[18px]' : 'left-0.5',
              )}
            />
          </span>
          <span className="text-[13px] font-semibold text-ink">Working today only</span>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-r-pill bg-surface px-1.5 text-[11px] font-extrabold text-ink-soft tnum">
            {workingTechs.length}
          </span>
        </button>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={techSearch}
            onChange={(e) => setTechSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setTechSearch('')}
            placeholder="Filter techs…"
            className="h-9 w-[200px] rounded-r-sm border border-line bg-surface pl-8 pr-3 text-[13px] font-medium transition-colors placeholder:text-ink-faint focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/30"
          />
        </div>

        {/* group visibility chips */}
        <div className="flex items-center gap-1.5">
          {GROUP_ORDER.filter((g) => g !== 'spa' || staff.some((t) => t.roleGroup === 'spa')).map(
            (g) => {
              const count = staff.filter((t) => t.active && t.roleGroup === g).length
              if (!count) return null
              const hidden = hiddenGroups.has(g)
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() =>
                    setHiddenGroups((s) => {
                      const n = new Set(s)
                      if (n.has(g)) n.delete(g)
                      else n.add(g)
                      return n
                    })
                  }
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-r-pill border px-2.5 text-[12px] font-bold transition-all duration-150',
                    hidden ? 'border-line opacity-40' : 'border-transparent',
                  )}
                  style={{
                    background: CATEGORY_COLORS[g].fill,
                    color: CATEGORY_COLORS[g].text,
                  }}
                >
                  <Eye className="h-3.5 w-3.5" />
                  {GROUP_LABEL[g]} {count}
                </button>
              )
            },
          )}
        </div>

        {offDutyTechs.length > 0 && (
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setOffPopover((v) => !v)}
              className="text-[13px] font-semibold text-ink-faint transition-colors hover:text-ink"
            >
              Hidden: {offDutyTechs.length} off today
            </button>
            {offPopover && (
              <>
                <button
                  aria-label="Close"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setOffPopover(false)}
                />
                <div className="absolute right-0 top-9 z-50 w-60 rounded-r-lg border border-line bg-surface p-2 shadow-sh-2">
                  <p className="px-2 pb-1 text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
                    Off duty — next working day
                  </p>
                  {offDutyTechs.map((t) => (
                    <div key={t.id} className="flex items-center justify-between px-2 py-1.5">
                      <span className="text-[13px] font-semibold">{t.name}</span>
                      <span className="text-small font-medium text-ink-faint">
                        {nextWorkingLabel(t, date) ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ══ body: grid + requests rail ══ */}
      <div className="flex min-h-0 flex-1">
        {isMobile ? (
          <MobileAgenda
            appointments={appointments}
            catKeyOf={catKeyOf}
            bannerDismissed={bannerDismissed}
            onDismissBanner={() => setBannerDismissed(true)}
          />
        ) : offDay ? (
          <div className="flex-1">
            <OffDayState
              onJump={() => {
                for (let i = 1; i <= 7; i++) {
                  const d = addDaysStr(date, i)
                  if (staff.some((t) => t.active && workWindow(t, d) != null)) {
                    setParams({ date: d })
                    return
                  }
                }
              }}
            />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setDragData(null)
              setDropHint(null)
            }}
          >
            <div className="relative min-w-0 flex-1">
              <div
                ref={scrollRef}
                data-schedule-grid
                tabIndex={0}
                className="schedule-scroll h-full overflow-auto outline-none"
                onScroll={(e) => {
                  const el = e.currentTarget
                  setScrollState({
                    left: el.scrollLeft > 4,
                    right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
                    x: el.scrollLeft,
                  })
                }}
              >
                <div className="min-w-full" style={{ width: 'max-content' }}>
                  {/* sticky header */}
                  <div className="sticky top-0 z-30 bg-surface shadow-[0_1px_0_#E7DDCF]">
                    {/* group bands row */}
                    <div className="flex border-b border-line">
                      <div
                        className="sticky left-0 z-40 h-10 shrink-0 border-r border-line bg-surface"
                        style={{ width: GUTTER_W }}
                      />
                      <div
                        className="sticky z-30 flex h-10 shrink-0 items-center border-r border-line-strong bg-cream px-3 sched-stripe-bg"
                        style={{ left: GUTTER_W, width: UNASSIGNED_W }}
                      >
                        <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-soft">
                          Queue
                        </span>
                      </div>
                      {groups.map((g) => (
                        <GroupBand
                          key={g.key}
                          label={GROUP_LABEL[g.key] ?? g.key}
                          catLine={CATEGORY_COLORS[g.key].line}
                          techCount={g.techs.length}
                          apptCount={apptCountByGroup.get(g.key) ?? 0}
                          width={collapsedGroups.has(g.key) ? 48 : g.techs.length * colW}
                          collapsed={collapsedGroups.has(g.key)}
                          onToggle={() =>
                            setCollapsedGroups((s) => {
                              const n = new Set(s)
                              if (n.has(g.key)) n.delete(g.key)
                              else n.add(g.key)
                              return n
                            })
                          }
                        />
                      ))}
                    </div>
                    {/* tech headers row */}
                    <div className="flex">
                      <div
                        className="sticky left-0 z-40 h-16 shrink-0 border-r border-line bg-cream/50"
                        style={{ width: GUTTER_W }}
                      />
                      <div className="sticky z-30 shrink-0" style={{ left: GUTTER_W }}>
                        <UnassignedHeader count={unassignedItems.length} width={UNASSIGNED_W} />
                      </div>
                      {groups.map((g) =>
                        collapsedGroups.has(g.key) ? (
                          <div
                            key={g.key}
                            className="flex h-16 w-12 shrink-0 items-center justify-center border-r border-line bg-cream/40"
                          >
                            <span className="rotate-180 whitespace-nowrap text-micro font-bold uppercase tracking-[0.15em] text-ink-faint [writing-mode:vertical-rl]">
                              {GROUP_LABEL[g.key]}
                            </span>
                          </div>
                        ) : (
                          g.techs.map((t) => (
                            <TechColumnHeader
                              key={t.id}
                              tech={t}
                              count={countByStaff.get(t.id) ?? 0}
                              working={workWindow(t, date) != null}
                              width={colW}
                              flash={flashStaff.has(t.id)}
                              onFilterTo={(name) => setTechSearch(name)}
                            />
                          ))
                        ),
                      )}
                    </div>
                  </div>

                  {/* body */}
                  <motion.div
                    key={date + density}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="relative flex"
                    style={{ height: gridH }}
                  >
                    {/* gutter */}
                    <div className="sticky left-0 z-20 h-full shrink-0" style={{ width: GUTTER_W }}>
                      <TimeGutter openMin={openMin} closeMin={closeMin} density={density} />
                    </div>

                    {/* unassigned column */}
                    <div className="sticky z-10 h-full shrink-0" style={{ left: GUTTER_W }}>
                      <ColumnBody
                        colKey="col:unassigned"
                        staffId={null}
                        width={UNASSIGNED_W}
                        gridH={gridH}
                        openMin={openMin}
                        closeMin={closeMin}
                        density={density}
                        unassigned
                        wash={
                          dropHint && dropHint.staffId == null
                            ? dropHint.valid
                              ? 'valid'
                              : 'invalid'
                            : null
                        }
                        ghost={
                          dragData && dropHint && dropHint.staffId == null && dragData.kind !== 'resize-bottom'
                            ? {
                                topMin: dropHint.min,
                                durationMin: dragData.item.endMin - dragData.item.startMin,
                              }
                            : null
                        }
                        onSlotClick={onSlotClick}
                      >
                        {unassignedItems.map(({ appt, item, lane }) => (
                          <AppointmentBlock
                            key={item.id}
                            {...sharedBlockData(appt, item, lane, unassignedLaneCount)}
                            top={(item.startMin - openMin) * ppm}
                            height={(item.endMin - item.startMin) * ppm}
                            colWidth={UNASSIGNED_W}
                            {...blockProps(appt)}
                          />
                        ))}
                      </ColumnBody>
                    </div>

                    {/* tech columns */}
                    {groups.map((g) =>
                      collapsedGroups.has(g.key) ? (
                        <div
                          key={g.key}
                          className="h-full w-12 shrink-0 border-r border-line bg-cream/30"
                        />
                      ) : (
                        g.techs.map((t) => {
                          const win = workWindow(t, date)
                          const items: { appt: Appointment; item: ApptItem }[] = []
                          for (const a of appointments)
                            for (const it of a.items) if (it.staffId === t.id) items.push({ appt: a, item: it })
                          return (
                            <ColumnBody
                              key={t.id}
                              colKey={`col:${t.id}`}
                              staffId={t.id}
                              width={colW}
                              gridH={gridH}
                              openMin={openMin}
                              closeMin={closeMin}
                              density={density}
                              offDuty={!win}
                              wash={
                                dropHint && dropHint.staffId === t.id
                                  ? dropHint.valid
                                    ? 'valid'
                                    : 'invalid'
                                  : null
                              }
                              ghost={
                                dragData && dropHint && dropHint.staffId === t.id && dragData.kind !== 'resize-bottom'
                                  ? {
                                      topMin: dropHint.min,
                                      durationMin: dragData.item.endMin - dragData.item.startMin,
                                    }
                                  : null
                              }
                              onSlotClick={onSlotClick}
                            >
                              {/* working-hours shading */}
                              {win && win.start > openMin && (
                                <div
                                  aria-hidden
                                  className="pointer-events-none absolute inset-x-0 top-0 bg-cream/60"
                                  style={{ height: (win.start - openMin) * ppm }}
                                />
                              )}
                              {win && win.end < closeMin && (
                                <div
                                  aria-hidden
                                  className="pointer-events-none absolute inset-x-0 bottom-0 bg-cream/60"
                                  style={{ height: (closeMin - win.end) * ppm }}
                                />
                              )}
                              {items.map(({ appt, item }) => (
                                <AppointmentBlock
                                  key={item.id}
                                  {...sharedBlockData(appt, item)}
                                  top={(item.startMin - openMin) * ppm}
                                  height={(item.endMin - item.startMin) * ppm}
                                  colWidth={colW}
                                  {...blockProps(appt)}
                                />
                              ))}
                            </ColumnBody>
                          )
                        })
                      ),
                    )}

                    {/* past wash + now-line */}
                    {isToday && nowMin > openMin && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-0 z-[15] bg-ink/[0.03]"
                        style={{ height: Math.min(gridH, (nowMin - openMin) * ppm) }}
                      />
                    )}
                    {isToday && nowMin >= openMin && nowMin <= closeMin && (
                      <NowLine nowMin={nowMin} openMin={openMin} density={density} pulse={nowPulse} />
                    )}
                  </motion.div>
                </div>
              </div>

              {/* edge shadows */}
              {scrollState.left && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 z-40 w-4 bg-gradient-to-r from-paper to-transparent"
                  style={{ left: GUTTER_W + UNASSIGNED_W }}
                />
              )}
              {scrollState.right && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-0 z-40 w-4 bg-gradient-to-l from-paper to-transparent"
                />
              )}
              {scrollState.left && (
                <button
                  type="button"
                  onClick={() => scrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' })}
                  className="absolute bottom-4 z-40 flex h-8 items-center rounded-r-pill border border-line bg-surface px-3 text-[12px] font-bold text-ink-soft shadow-sh-2 transition-colors hover:text-ink"
                  style={{ left: GUTTER_W + UNASSIGNED_W + 12 }}
                >
                  ← {Math.max(1, Math.floor(scrollState.x / colW))} more techs
                </button>
              )}
            </div>

            {/* drag overlay */}
            <DragOverlay dropAnimation={null}>
              {dragData ? (
                <div style={{ width: colW - 8 }}>
                  <div
                    style={{
                      height: Math.max(
                        22,
                        (dragData.item.endMin - dragData.item.startMin) * ppm,
                      ),
                      transform: 'scale(1.03)',
                    }}
                  >
                    <BlockVisual
                      d={sharedBlockData(dragData.appt, dragData.item)}
                      height={Math.max(22, (dragData.item.endMin - dragData.item.startMin) * ppm)}
                      overlay
                    />
                  </div>
                  <div className="mt-1 inline-flex rounded-r-pill bg-night px-2.5 py-1 text-[11.5px] font-bold text-white shadow-sh-2 tnum">
                    {dragData.kind === 'resize-bottom'
                      ? `${Math.max(15, (dropHint?.min ?? dragData.item.endMin) - dragData.item.startMin)} min`
                      : dropHint
                        ? `${fmtRange(
                            dropHint.min,
                            dropHint.min + (dragData.item.endMin - dragData.item.startMin),
                          )} · ${
                            dropHint.staffId == null
                              ? 'Unassigned'
                              : (staffById.get(dropHint.staffId)?.name ?? '')
                          }`
                        : ''}
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {/* requests rail / collapsed strip */}
        <AnimatePresence initial={false}>
          {railOpen ? (
            <RequestsRail
              key="rail"
              open={railOpen}
              requests={requests}
              staff={staff}
              appointments={appointments}
              categories={categories}
              salonId={salonId}
              viewDate={date}
            />
          ) : (
            <motion.button
              key="rail-closed"
              type="button"
              initial={{ width: 0 }}
              animate={{ width: 48 }}
              exit={{ width: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 34 }}
              onClick={() => setParams({ rail: 'open' })}
              className="relative flex h-full shrink-0 flex-col items-center gap-2 overflow-hidden border-l border-line bg-surface pt-3"
              title="Open requests"
            >
              <Inbox className="h-4 w-4 text-ink-soft" />
              {requests.length > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-r-pill bg-clay px-1 text-[10px] font-extrabold text-white tnum">
                  {requests.length}
                </span>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ══ batch selection bar ══ */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22 }}
            className="fixed bottom-5 left-1/2 z-[65] flex -translate-x-1/2 items-center gap-2 rounded-r-pill bg-night px-4 py-2 shadow-sh-3"
          >
            <span className="text-[13px] font-bold text-white tnum">{selected.size} selected</span>
            {(
              [
                ['Mark completed', 'completed' as const],
                ['Mark no-show', 'no-show' as const],
                ['Cancel all', 'cancelled' as const],
              ] as const
            ).map(([label, st]) => (
              <button
                key={st}
                type="button"
                onClick={() => {
                  const targets = appointments.filter((a) => selected.has(a.id))
                  targets.forEach((a) => doStatus(a, st, { silent: true }))
                  toast.success(`${label} — ${targets.length} appointments`)
                  setSelected(new Set())
                }}
                className={cn(
                  'h-8 rounded-r-pill px-3 text-[12.5px] font-bold transition-colors',
                  st === 'cancelled'
                    ? 'bg-rust/20 text-[#F0A396] hover:bg-rust/30'
                    : 'bg-white/10 text-white hover:bg-white/20',
                )}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              aria-label="Clear selection"
              onClick={() => setSelected(new Set())}
              className="flex h-8 w-8 items-center justify-center rounded-r-pill text-white/70 hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══ overlays ══ */}
      {popover && popoverAppt && (
        <AppointmentPopover
          appt={popoverAppt}
          anchor={popover}
          catKeyOf={catKeyOf}
          onClose={() => setPopover(null)}
          onStatus={(a, st) => {
            doStatus(a, st)
            setPopover(null)
          }}
          onEdit={(a) => {
            setEditAppt(a)
            setPopover(null)
          }}
          onRescheduleHint={(a) => {
            setPopover(null)
            const el = blockRefs.current.get(a.items[0]?.id ?? -1)
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            toast('Drag the block to a new time or technician', {
              icon: <Info className="h-4 w-4" />,
            })
          }}
        />
      )}

      <QuickCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        salonId={salonId}
        date={date}
        prefill={createPrefill}
        staff={staff}
        categories={categories}
        appointments={appointments}
      />

      <EditAppointmentModal
        appt={editAppt}
        salonId={salonId}
        staff={staff}
        onClose={() => setEditAppt(null)}
        onSaved={(orig) => {
          if (!editAppt) return
          const a = editAppt
          toast.success('Appointment updated', {
            action: {
              label: 'Undo',
              onClick: () => {
                doReschedule(a, { startMin: orig.startMin, staffId: orig.staffId }, { silent: true })
                if (orig.status !== a.status) doStatus(a, orig.status, { silent: true })
              },
            },
          })
        }}
      />

      {legendAnchor && (
        <LegendPopover
          anchor={legendAnchor}
          colorMode={colorMode}
          onColorMode={(m) => setParams({ color: m })}
          onClose={() => setLegendAnchor(null)}
        />
      )}
      {dateAnchor && (
        <DatePickerPopover
          anchor={dateAnchor}
          selected={date}
          today={todayStr}
          appointmentDates={new Set(activeApptCount > 0 ? [date] : [])}
          onSelect={(d) => {
            setParams({ date: d })
            setDateAnchor(null)
          }}
          onClose={() => setDateAnchor(null)}
        />
      )}
    </div>
  )
}

/* ── media query hook ──────────────────────────────────────────────── */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const m = window.matchMedia(query)
    const onChange = () => setMatches(m.matches)
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/* ── mobile agenda fallback (salon-schedule.md §9) ─────────────────── */
function MobileAgenda({
  appointments,
  catKeyOf,
  bannerDismissed,
  onDismissBanner,
}: {
  appointments: Appointment[]
  catKeyOf: (i: ApptItem) => CatKey
  bannerDismissed: boolean
  onDismissBanner: () => void
}) {
  const sorted = [...appointments]
    .filter((a) => a.status !== 'cancelled')
    .sort((a, b) => a.startMin - b.startMin)
  return (
    <div className="flex-1 overflow-y-auto p-4 schedule-scroll">
      {!bannerDismissed && (
        <div className="mb-3 flex items-center gap-2 rounded-r-md border border-amber/30 bg-amber-tint p-3">
          <Info className="h-4 w-4 shrink-0 text-amber" />
          <p className="flex-1 text-[13px] font-semibold text-ink">
            The schedule grid is best on desktop — here's today's agenda.
          </p>
          <button type="button" aria-label="Dismiss" onClick={onDismissBanner}>
            <X className="h-4 w-4 text-ink-soft" />
          </button>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {sorted.length === 0 && (
          <p className="py-12 text-center text-small font-medium text-ink-faint">
            No appointments this day.
          </p>
        )}
        {sorted.map((a) => (
          <div key={a.id} className="rounded-r-md border border-line bg-surface p-3 shadow-sh-1">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold">
                {a.client.firstName} {a.client.lastName}
              </span>
              <span className="text-small font-semibold text-ink-soft tnum">
                {fmtRange(a.startMin, a.endMin)}
              </span>
            </div>
            {a.items.map((it) => (
              <div key={it.id} className="mt-1 flex items-center gap-1.5 text-small font-medium text-ink-soft">
                <span
                  className="h-2 w-2 rounded-r-pill"
                  style={{ background: CATEGORY_COLORS[catKeyOf(it)].line }}
                />
                {it.service.name} · {it.staff?.name ?? 'Unassigned'}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
