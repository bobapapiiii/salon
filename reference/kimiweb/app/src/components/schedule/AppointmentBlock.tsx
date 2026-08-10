import { memo, useMemo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Clock, Check, FlaskConical, Flag, TriangleAlert, Link2, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CATEGORY_COLORS,
  STATUS_FILL,
  fmtRange,
  minToTime,
  type Appointment,
  type ApptItem,
  type CatKey,
  type ColorMode,
} from './schedule-utils'

/* ═══════════════════════════════════════════════════════════════════
   AppointmentBlock — salon-schedule.md §4.2 + design.md §3.3
   Status always has a non-color channel (dashes, icons, fills, opacity).
   ═══════════════════════════════════════════════════════════════════ */

export interface BlockData {
  appt: Appointment
  item: ApptItem
  catKey: CatKey
  colorMode: ColorMode
  nowMin: number
  isToday: boolean
  lane: number
  laneCount: number
  freshCancelled: boolean
}

/** Pure visual content — shared between the grid block and the DragOverlay. */
export function BlockVisual({ d, height, overlay }: { d: BlockData; height: number; overlay?: boolean }) {
  const { appt, item, catKey, colorMode, nowMin, isToday } = d
  const cat = CATEGORY_COLORS[catKey]
  const status = appt.status
  const compact = height < 36
  const tall = height >= 56
  const veryTall = height >= 90

  const clientName = `${appt.client.firstName} ${appt.client.lastName.charAt(0)}.`
  const isCancelled = status === 'cancelled'
  const isNoShow = status === 'no-show'
  const isCompleted = status === 'completed'
  const isRequested = status === 'requested'
  const isInProgress = status === 'in-progress'

  const fill = colorMode === 'status' ? STATUS_FILL[status] : cat.fill
  const nameColor = colorMode === 'status' ? '#2A211A' : cat.text
  const strikeName =
    isCancelled || (isCompleted && colorMode === 'status')

  // In-progress elapsed % (only meaningful on today's view)
  const elapsed =
    isInProgress && isToday
      ? Math.min(1, Math.max(0.05, (nowMin - item.startMin) / Math.max(1, item.endMin - item.startMin)))
      : 0

  // Processing segment occupies the tail of the service (tech is free then)
  const procFrac = item.processingMin > 0 ? item.processingMin / (item.endMin - item.startMin) : 0

  const notes = appt.client.notes.filter((n) => n.kind === 'allergy' || n.kind === 'alert' || n.kind === 'preference')
  const hasAllergy = notes.some((n) => n.kind === 'allergy')

  const border = isCancelled
    ? '1.5px dashed #A3937F'
    : isNoShow
      ? '1.5px solid #B3402F'
      : isRequested
        ? `1.5px dashed ${cat.line}`
        : `1px solid ${cat.line}66`

  // Appointments fully in the past fade automatically (salon-schedule.md §4.1)
  const isPast = isToday && item.endMin < nowMin
  const opacity = isCancelled
    ? 0.45
    : isCompleted
      ? 0.55
      : isPast && !isNoShow
        ? 0.55
        : 1

  return (
    <div
      className={cn(
        'relative flex h-full w-full flex-col overflow-hidden rounded-r-sm text-left',
        isNoShow && 'saturate-50',
      )}
      style={{
        background: fill,
        border,
        opacity,
        boxShadow: overlay ? '0 12px 28px rgba(42,33,26,.22)' : undefined,
      }}
    >
      {/* 4px category left rail */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[4px]"
        style={{ background: cat.line, opacity: isCancelled ? 0.4 : 1 }}
      />
      {/* Requested fill is at 55% — emulate with a white wash */}
      {isRequested && (
        <span aria-hidden className="absolute inset-0 bg-white/45" />
      )}
      {/* In-progress diagonal fill over elapsed % + slow sheen */}
      {isInProgress && (
        <span aria-hidden className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${elapsed * 100}%` }}>
          <span className="sched-hatch absolute inset-0" />
          <span
            className="sched-sheen absolute inset-y-0 w-1/3"
            style={{ background: 'linear-gradient(100deg, transparent, rgba(255,255,255,.5), transparent)' }}
          />
        </span>
      )}
      {/* Processing tail segment (hatched) + dashed divider */}
      {procFrac > 0 && !isCancelled && (
        <>
          <span
            aria-hidden
            className="absolute bottom-0 left-0 right-0 border-t border-dashed sched-hatch"
            style={{ height: `${procFrac * 100}%`, borderColor: `${cat.line}` }}
          />
          {veryTall && (
            <span
              className="absolute bottom-1 left-2 flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.06em]"
              style={{ color: nameColor }}
            >
              <FlaskConical className="h-2.5 w-2.5" /> processing
            </span>
          )}
        </>
      )}

      <div className={cn('relative z-10 flex min-h-0 flex-1 flex-col pl-[9px] pr-1', compact ? 'pt-0' : 'pt-[3px]')}>
        {compact ? (
          <div className="flex items-center gap-1 overflow-hidden">
            <span
              className={cn('truncate text-[11px] font-bold leading-[14px]', strikeName && 'line-through')}
              style={{ color: isCancelled ? '#6E5F50' : nameColor }}
            >
              {clientName}
            </span>
            <StatusIcon status={status} catLine={cat.line} />
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-1">
              <span
                className={cn('truncate text-[12.5px] font-bold leading-[16px]', strikeName && 'line-through')}
                style={{ color: isCancelled ? '#6E5F50' : nameColor }}
              >
                {clientName}
              </span>
              <StatusIcon status={status} catLine={cat.line} />
            </div>
            <span className="truncate text-small font-medium leading-[15px]" style={{ color: isCancelled ? '#A3937F' : nameColor, opacity: 0.85 }}>
              {item.service.name}
            </span>
            {tall && (
              <span className="mt-auto flex items-center gap-1.5 pb-[3px] text-micro font-bold tnum" style={{ color: isCancelled ? '#A3937F' : nameColor, opacity: 0.75 }}>
                {fmtRange(item.startMin, item.endMin)}
                {appt.sameTimeGroupId && <Link2 className="h-2.5 w-2.5" />}
              </span>
            )}
            {veryTall && notes.length > 0 && (
              <span className="flex items-center gap-1 pb-1">
                {hasAllergy && <Flag className="h-3 w-3 text-rust" fill="#B3402F" />}
                {notes.some((n) => n.kind === 'alert') && <TriangleAlert className="h-3 w-3 text-amber" />}
              </span>
            )}
          </>
        )}
      </div>

      {/* No-show tag */}
      {isNoShow && height >= 30 && (
        <span className="absolute bottom-1 right-1 z-10 rounded-r-sm bg-rust px-1 py-px text-[9px] font-extrabold uppercase tracking-[0.06em] text-white">
          No-show
        </span>
      )}
    </div>
  )
}

function StatusIcon({ status, catLine }: { status: Appointment['status']; catLine: string }) {
  if (status === 'requested')
    return <Clock className="h-3 w-3 shrink-0" style={{ color: catLine }} aria-label="Requested" />
  if (status === 'checked-in')
    return (
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-r-pill bg-white shadow-sh-1" aria-label="Checked in">
        <Check className="h-2.5 w-2.5" style={{ color: catLine }} strokeWidth={3.5} />
      </span>
    )
  if (status === 'in-progress')
    return <Play className="h-3 w-3 shrink-0" style={{ color: catLine }} fill={catLine} aria-label="In progress" />
  return null
}

/* ── Grid block (draggable, resizable, memoized) ───────────────────── */
interface ApptBlockProps extends BlockData {
  top: number
  height: number
  colWidth: number
  selected: boolean
  shaking: boolean
  linkedHighlight: boolean
  dragDisabled: boolean
  onOpen: (apptId: number, itemId: number, rect: DOMRect) => void
  onSelectToggle: (apptId: number) => void
  onPartnerHover: (groupId: string | null) => void
  registerRef: (itemId: number, el: HTMLElement | null) => void
}

export const AppointmentBlock = memo(function AppointmentBlock(p: ApptBlockProps) {
  const { appt, item, top, height, colWidth } = p
  const isCancelled = appt.status === 'cancelled'
  const collapsedStub = isCancelled && !p.freshCancelled
  const h = collapsedStub ? 12 : Math.max(22, height)

  const dragId = `appt:${appt.id}:item:${item.id}`
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { kind: 'move', apptId: appt.id, itemId: item.id },
    disabled: p.dragDisabled || collapsedStub,
  })
  const topResize = useDraggable({
    id: `resize-top:${appt.id}:${item.id}`,
    data: { kind: 'resize-top', apptId: appt.id, itemId: item.id },
    disabled: p.dragDisabled || isCancelled || appt.status === 'completed',
  })
  const bottomResize = useDraggable({
    id: `resize-bottom:${appt.id}:${item.id}`,
    data: { kind: 'resize-bottom', apptId: appt.id, itemId: item.id },
    disabled: p.dragDisabled || isCancelled || appt.status === 'completed',
  })

  const laneW = useMemo(() => {
    const inset = 4
    const usable = colWidth - inset * 2
    return p.laneCount > 1 ? (usable - 4 * (p.laneCount - 1)) / p.laneCount : usable
  }, [colWidth, p.laneCount])

  const left = 4 + p.lane * (laneW + 4)

  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        p.registerRef(item.id, el)
      }}
      aria-label={`${appt.client.firstName} ${appt.client.lastName}, ${item.service.name}, ${minToTime(item.startMin)}`}
      className={cn(
        'group/blk absolute transition-[box-shadow,transform] duration-150 ease-out-expo',
        !isDragging && 'hover:-translate-y-px hover:shadow-sh-2',
        isDragging && 'z-30 opacity-30',
        p.shaking && 'sched-shake',
        p.linkedHighlight && 'ring-2 ring-clay ring-offset-1',
        p.selected && 'ring-2 ring-clay',
        collapsedStub ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
      )}
      style={{
        top,
        height: h,
        left,
        width: laneW,
        touchAction: 'none',
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (e.shiftKey) {
          p.onSelectToggle(appt.id)
          return
        }
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        p.onOpen(appt.id, item.id, rect)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.stopPropagation()
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          p.onOpen(appt.id, item.id, rect)
        }
      }}
      onMouseEnter={() => appt.sameTimeGroupId && p.onPartnerHover(appt.sameTimeGroupId)}
      onMouseLeave={() => appt.sameTimeGroupId && p.onPartnerHover(null)}
      {...attributes}
      {...(p.dragDisabled || collapsedStub ? {} : listeners)}
    >
      <BlockVisual d={p} height={h} />
      {/* Resize handles (appear on hover) */}
      {!isCancelled && appt.status !== 'completed' && !collapsedStub && h >= 30 && (
        <>
          <span
            ref={topResize.setNodeRef}
            {...topResize.attributes}
            {...topResize.listeners}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 top-0 h-[6px] cursor-ns-resize opacity-0 transition-opacity duration-150 group-hover/blk:opacity-100"
            style={{ background: 'linear-gradient(to bottom, rgba(42,33,26,.14), transparent)', touchAction: 'none' }}
            aria-label="Resize start"
          />
          <span
            ref={bottomResize.setNodeRef}
            {...bottomResize.attributes}
            {...bottomResize.listeners}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 h-[6px] cursor-ns-resize opacity-0 transition-opacity duration-150 group-hover/blk:opacity-100"
            style={{ background: 'linear-gradient(to top, rgba(42,33,26,.14), transparent)', touchAction: 'none' }}
            aria-label="Resize end"
          />
        </>
      )}
    </div>
  )
})
