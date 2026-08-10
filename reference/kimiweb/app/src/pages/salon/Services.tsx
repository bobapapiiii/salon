import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Archive, ChevronDown, Clock, Copy, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import Avatar, { normalizeTint } from '@/components/ops/Avatar'
import ServiceModal from '@/components/ops/ServiceModal'
import { OpsToaster, Toggle } from '@/components/ops/primitives'
import { CAT, catKey, fmtPrice } from '@/components/ops/format'
import type { ServiceRow, StaffRow } from '@/components/ops/types'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]

type ModalState =
  | { mode: 'new'; categoryId?: number }
  | { mode: 'edit'; service: ServiceRow }
  | null

export default function Services() {
  const utils = trpc.useUtils()
  const salonQ = trpc.salon.get.useQuery()
  const salonId = salonQ.data?.id ?? 0
  const enabled = salonId > 0

  const servicesQ = trpc.services.list.useQuery({ salonId }, { enabled })
  const staffQ = trpc.staff.list.useQuery({ salonId }, { enabled })

  const [closed, setClosed] = useState<Set<number>>(new Set())
  const [modal, setModal] = useState<ModalState>(null)
  const [flashId, setFlashId] = useState<number | null>(null)
  const [confirmArchiveId, setConfirmArchiveId] = useState<number | null>(null)

  const categories = useMemo(() => servicesQ.data ?? [], [servicesQ.data])
  const staff = useMemo(() => staffQ.data ?? [], [staffQ.data])
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff])

  const allServices = useMemo(
    () => categories.flatMap((c) => c.services.filter((s) => s.active)),
    [categories],
  )
  const bookable = allServices.filter((s) => s.onlineBookable).length

  /* ── Mutations ────────────────────────────────────────────────────────── */
  const update = trpc.services.update.useMutation({
    onError: (e) => toast.error(e.message),
  })
  const create = trpc.services.create.useMutation({
    onError: (e) => toast.error(e.message),
  })

  function flip(s: ServiceRow, field: 'onlineBookable' | 'requiresApproval') {
    const v = !s[field]
    const onMsg =
      field === 'onlineBookable'
        ? `“${s.name}” is bookable online`
        : `“${s.name}” now requires approval`
    const offMsg =
      field === 'onlineBookable'
        ? `“${s.name}” no longer bookable online`
        : `“${s.name}” no longer requires approval`
    update.mutate(
      { id: s.id, data: { [field]: v } },
      {
        onSuccess: () => {
          utils.services.list.invalidate()
          toast.success(v ? onMsg : offMsg, {
            action: {
              label: 'Undo',
              onClick: () =>
                update.mutate(
                  { id: s.id, data: { [field]: !v } },
                  { onSuccess: () => utils.services.list.invalidate() },
                ),
            },
          })
        },
      },
    )
  }

  function archive(s: ServiceRow) {
    if (confirmArchiveId !== s.id) {
      setConfirmArchiveId(s.id)
      window.setTimeout(() => setConfirmArchiveId((cur) => (cur === s.id ? null : cur)), 3000)
      return
    }
    setConfirmArchiveId(null)
    update.mutate(
      { id: s.id, data: { active: false } },
      {
        onSuccess: () => {
          utils.services.list.invalidate()
          toast.success(`“${s.name}” archived — it stays on existing appointments`)
        },
      },
    )
  }

  function duplicate(s: ServiceRow) {
    create.mutate(
      {
        salonId,
        categoryId: s.categoryId,
        name: `${s.name} (copy)`,
        description: s.description ?? undefined,
        durationMin: s.durationMin,
        processingMin: s.processingMin,
        bufferMin: s.bufferMin,
        priceCents: s.priceCents,
        onlineBookable: s.onlineBookable,
        requiresApproval: s.requiresApproval,
        staffIds: s.staffIds,
      },
      {
        onSuccess: (res) => {
          utils.services.list.invalidate()
          setFlashId(res.id)
          toast.success(`Duplicated as “${s.name} (copy)”`)
        },
      },
    )
  }

  const toggleCat = (id: number) =>
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const loading = servicesQ.isLoading || salonQ.isLoading

  return (
    <div className="mx-auto max-w-[1400px] p-8">
      <OpsToaster />

      {/* ── Section 1: header row ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE }}
        className="mb-5 flex flex-wrap items-center gap-3"
      >
        <p className="text-small font-medium text-ink-faint tnum">
          {allServices.length} services · {categories.length} categories · {bookable} bookable online
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() =>
                document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              className="flex h-9 cursor-pointer items-center gap-2 rounded-r-pill border border-line bg-surface px-3 text-[12.5px] font-bold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
            >
              <span className={cn('h-2 w-2 rounded-r-pill', CAT[catKey(c.name)].dot)} />
              {c.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setModal({ mode: 'new' })}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-r-md bg-clay px-4 text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-clay-deep hover:shadow-sh-1 active:translate-y-0"
          >
            <Plus className="h-4 w-4" /> New service
          </button>
        </div>
      </motion.div>

      <div className="flex items-start gap-6">
        {/* ── Section 2: category accordions ─────────────────────────────── */}
        <div className="min-w-0 max-w-[1080px] flex-1 space-y-4">
          {loading ? (
            [0, 1].map((i) => (
              <div key={i} className="rounded-r-lg border border-line bg-surface p-4">
                <div className="h-5 w-40 animate-pulse rounded-r-sm bg-cream" />
                <div className="mt-4 space-y-2">
                  {[0, 1, 2].map((j) => (
                    <div key={j} className="h-12 animate-pulse rounded-r-md bg-cream" />
                  ))}
                </div>
              </div>
            ))
          ) : (
            categories.map((c) => {
              const active = c.services.filter((s) => s.active)
              const isOpen = !closed.has(c.id)
              const cc = CAT[catKey(c.name)]
              const prices = active.map((s) => s.priceCents)
              const meta = active.length
                ? `${active.length} service${active.length === 1 ? '' : 's'} · ${fmtPrice(Math.min(...prices))}–${fmtPrice(Math.max(...prices))}`
                : 'No services'
              return (
                <section
                  key={c.id}
                  id={`cat-${c.id}`}
                  className="scroll-mt-6 overflow-hidden rounded-r-lg border border-line bg-surface shadow-sh-1"
                >
                  {/* Accordion header (56px) */}
                  <div className="flex h-14 items-center gap-3 border-b border-line px-4">
                    <span className={cn('h-2 w-8 rounded-r-pill', cc.dot)} />
                    <h3 className="text-[15px] font-bold leading-[22px]">{c.name}</h3>
                    <span className="text-micro font-bold uppercase text-ink-faint tnum">{meta}</span>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setModal({ mode: 'new', categoryId: c.id })}
                        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-r-md px-2.5 text-[12.5px] font-semibold text-ink-soft transition-colors hover:bg-cream hover:text-ink"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add service
                      </button>
                      <button
                        type="button"
                        aria-label={isOpen ? `Collapse ${c.name}` : `Expand ${c.name}`}
                        onClick={() => toggleCat(c.id)}
                        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-r-md text-ink-soft transition-colors hover:bg-cream hover:text-ink"
                      >
                        <ChevronDown
                          className={cn('h-[18px] w-[18px] transition-transform duration-200', !isOpen && '-rotate-180')}
                        />
                      </button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.26, ease: EASE }}
                        className="overflow-hidden"
                      >
                        {active.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => setModal({ mode: 'new', categoryId: c.id })}
                            className="m-4 flex h-14 w-[calc(100%-32px)] cursor-pointer items-center justify-center gap-2 rounded-r-md border border-dashed border-line-strong text-[13px] font-semibold text-ink-faint transition-colors hover:bg-cream hover:text-clay"
                          >
                            <Plus className="h-4 w-4" /> No services yet — Add service
                          </button>
                        ) : (
                          <div className="overflow-x-auto">
                            <div className="min-w-[920px] divide-y divide-line">
                              <AnimatePresence initial={false}>
                                {active.map((s, i) => (
                                  <ServiceRowView
                                    key={s.id}
                                    s={s}
                                    index={i}
                                    cc={cc}
                                    staffById={staffById}
                                    flash={s.id === flashId}
                                    confirmArchive={confirmArchiveId === s.id}
                                    onFlip={flip}
                                    onEdit={() => setModal({ mode: 'edit', service: s })}
                                    onDuplicate={() => duplicate(s)}
                                    onArchive={() => archive(s)}
                                  />
                                ))}
                              </AnimatePresence>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              )
            })
          )}
        </div>

        {/* ── Section 4: side insight rail (≥1280px) ─────────────────────── */}
        <InsightRail
          services={allServices}
          bookable={bookable}
          onOpenService={(s) => setModal({ mode: 'edit', service: s })}
        />
      </div>

      <ServiceModal
        open={modal !== null}
        onClose={() => setModal(null)}
        salonId={salonId}
        categories={categories}
        staff={staff}
        editing={modal?.mode === 'edit' ? modal.service : null}
        presetCategoryId={modal?.mode === 'new' ? (modal.categoryId ?? null) : null}
        onSaved={(id) => {
          setFlashId(id)
          window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1600)
        }}
      />
    </div>
  )
}

/* ── Service row (§2) ───────────────────────────────────────────────────── */
function ServiceRowView({
  s,
  index,
  cc,
  staffById,
  flash,
  confirmArchive,
  onFlip,
  onEdit,
  onDuplicate,
  onArchive,
}: {
  s: ServiceRow
  index: number
  cc: (typeof CAT)['nails']
  staffById: Map<number, StaffRow>
  flash: boolean
  confirmArchive: boolean
  onFlip: (s: ServiceRow, field: 'onlineBookable' | 'requiresApproval') => void
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
}) {
  const techs = s.staffIds.map((id) => staffById.get(id)).filter((t): t is StaffRow => !!t)
  const shown = techs.slice(0, 4)
  const extra = techs.length - shown.length

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, ...(flash ? { backgroundColor: '#F6E3D6' } : {}) }}
      animate={{ opacity: 1, y: 0, ...(flash ? { backgroundColor: 'rgba(246,227,214,0)' } : {}) }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.25 } }}
      transition={{ duration: flash ? 1 : 0.3, delay: flash ? 0 : Math.min(index, 8) * 0.03, ease: EASE }}
      className="group flex min-h-16 items-center gap-4 px-4 py-2 transition-colors hover:bg-cream"
    >
      {/* Name + description */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-r-pill', cc.dot)} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-ink">{s.name}</p>
          {s.description && (
            <p className="truncate text-small font-medium text-ink-faint" title={s.description}>
              {s.description}
            </p>
          )}
        </div>
      </div>

      {/* Duration cluster */}
      <div className="flex w-[230px] shrink-0 flex-wrap items-center gap-1">
        <span className="rounded-r-sm bg-cream px-2 py-1 text-[11.5px] font-bold text-ink tnum">
          {s.durationMin} min
        </span>
        {s.processingMin > 0 && (
          <span
            className="flex items-center gap-1 rounded-r-sm bg-olive-tint px-2 py-1 text-[11.5px] font-bold text-olive tnum"
            title="Tech is free during processing"
          >
            <span
              className="inline-block h-2.5 w-2.5"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, currentColor 0 1.5px, transparent 1.5px 4px)',
              }}
            />
            {s.processingMin} processing
          </span>
        )}
        {s.bufferMin > 0 && (
          <span className="rounded-r-sm bg-cream px-2 py-1 text-[11.5px] font-bold text-ink-soft tnum">
            {s.bufferMin} buffer
          </span>
        )}
      </div>

      {/* Price */}
      <div className="w-[70px] shrink-0 text-[14px] font-extrabold text-ink tnum">{fmtPrice(s.priceCents)}</div>

      {/* Qualified techs */}
      <button
        type="button"
        onClick={onEdit}
        title={techs.length ? techs.map((t) => t.name).join(', ') : 'No qualified techs — click to assign'}
        className="flex w-[110px] shrink-0 cursor-pointer items-center"
      >
        {techs.length === 0 ? (
          <span className="text-[11.5px] font-bold text-rust">No techs</span>
        ) : (
          <span className="flex -space-x-1.5">
            {shown.map((t) => (
              <Avatar
                key={t.id}
                initials={t.initials}
                tint={normalizeTint(t.avatarTint, t.name)}
                size={28}
                className="ring-2 ring-surface"
              />
            ))}
            {extra > 0 && (
              <span className="flex h-7 w-7 items-center justify-center rounded-r-pill bg-cream text-[10px] font-extrabold text-ink-soft ring-2 ring-surface">
                +{extra}
              </span>
            )}
          </span>
        )}
      </button>

      {/* Toggles */}
      <div className="flex w-[150px] shrink-0 flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <Toggle small checked={s.onlineBookable} onChange={() => onFlip(s, 'onlineBookable')} label="Bookable online" />
          <span className="text-micro font-bold uppercase text-ink-faint">Online</span>
        </span>
        <span className="flex items-center gap-2">
          <Toggle small checked={s.requiresApproval} onChange={() => onFlip(s, 'requiresApproval')} label="Requires approval" />
          <span className="flex items-center gap-1 text-micro font-bold uppercase text-ink-faint">
            Approval
            {s.requiresApproval && <Clock className="h-3 w-3 text-amber" />}
          </span>
        </span>
      </div>

      {/* Row actions (hover) */}
      <div className="flex w-[96px] shrink-0 items-center justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          title="Edit"
          onClick={onEdit}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-r-md text-ink-soft transition-colors hover:bg-surface hover:text-clay"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Duplicate"
          onClick={onDuplicate}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-r-md text-ink-soft transition-colors hover:bg-surface hover:text-clay"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          type="button"
          title={confirmArchive ? 'Tap again to archive' : 'Archive'}
          onClick={onArchive}
          className={cn(
            'flex h-8 cursor-pointer items-center justify-center rounded-r-md transition-colors',
            confirmArchive
              ? 'w-auto bg-rust px-2 text-[11px] font-bold text-white'
              : 'w-8 text-ink-soft hover:bg-surface hover:text-rust',
          )}
        >
          {confirmArchive ? 'Archive?' : <Archive className="h-4 w-4" />}
        </button>
      </div>
    </motion.div>
  )
}

/* ── Catalog health rail (§4) ───────────────────────────────────────────── */
function InsightRail({
  services,
  bookable,
  onOpenService,
}: {
  services: ServiceRow[]
  bookable: number
  onOpenService: (s: ServiceRow) => void
}) {
  const total = services.length
  const pct = total > 0 ? bookable / total : 0
  const R = 52
  const C = 2 * Math.PI * R

  const nudges = useMemo(() => {
    const list: { s: ServiceRow; tone: 'rust' | 'amber'; text: string }[] = []
    for (const s of services) {
      if (s.staffIds.length === 0) {
        list.push({ s, tone: 'rust', text: `“${s.name}” has no qualified techs` })
      } else if (s.durationMin >= 120 && s.processingMin === 0) {
        list.push({
          s,
          tone: 'amber',
          text: `“${s.name}” takes ${s.durationMin} min — consider enabling processing time`,
        })
      }
    }
    return list.slice(0, 4)
  }, [services])

  if (total === 0) return null

  return (
    <aside className="sticky top-6 hidden w-[280px] shrink-0 xl:block">
      <div className="rounded-r-lg border border-line bg-surface p-5 shadow-sh-1">
        <h3 className="text-[15px] font-bold leading-[22px]">Catalog health</h3>
        <div className="mt-3 flex items-center gap-4">
          <svg width="84" height="84" viewBox="0 0 120 120" className="shrink-0">
            <circle cx="60" cy="60" r={R} stroke="#F2EBE0" strokeWidth="12" fill="none" />
            <motion.circle
              cx="60"
              cy="60"
              r={R}
              stroke="#B4552B"
              strokeWidth="12"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={C}
              initial={{ strokeDashoffset: C }}
              animate={{ strokeDashoffset: C * (1 - pct) }}
              transition={{ duration: 0.9, ease: EASE }}
              transform="rotate(-90 60 60)"
            />
            <text x="60" y="58" textAnchor="middle" className="fill-ink text-[20px] font-extrabold tnum">
              {bookable}/{total}
            </text>
            <text x="60" y="76" textAnchor="middle" className="fill-ink-faint text-[9px] font-bold uppercase">
              online
            </text>
          </svg>
          <p className="text-small font-medium text-ink-soft">
            {bookable} of {total} services are bookable online.
          </p>
        </div>

        {nudges.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-line pt-4">
            {nudges.map((n, i) => (
              <motion.button
                key={`${n.s.id}-${i}`}
                type="button"
                onClick={() => onOpenService(n.s)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 + i * 0.08, ease: EASE }}
                className="flex w-full cursor-pointer items-start gap-2 rounded-r-md p-2 text-left text-[12.5px] font-medium leading-[18px] text-ink-soft transition-colors hover:bg-cream hover:text-ink"
              >
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-r-pill',
                    n.tone === 'rust' ? 'bg-rust' : 'bg-amber',
                  )}
                />
                {n.text}
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
