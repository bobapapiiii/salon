import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import Avatar, { normalizeTint } from '@/components/ops/Avatar'
import { Modal, ModalHeader, Toggle } from '@/components/ops/primitives'
import { CAT, catKey } from '@/components/ops/format'
import type { CategoryWithServices, ServiceRow, StaffRow } from '@/components/ops/types'

const GROUP_LABEL: Record<string, string> = { nails: 'Nails', hair: 'Hair', lashes: 'Lashes', spa: 'Spa' }

function Stepper({
  label,
  value,
  step,
  min,
  max,
  onChange,
  helper,
  error,
}: {
  label: string
  value: number
  step: number
  min: number
  max: number
  onChange: (v: number) => void
  helper?: string
  error?: string
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-micro font-bold uppercase text-ink-faint">{label}</p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-r-md border border-line bg-surface text-ink-soft transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 rounded-r-md border border-line bg-paper px-2 py-1.5 text-center">
          <span className="text-[18px] font-extrabold leading-6 text-ink tnum">{value}</span>
          <span className="ml-1 text-[11px] font-semibold text-ink-faint">min</span>
        </div>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-r-md border border-line bg-surface text-ink-soft transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {error ? (
        <p className="mt-1 text-[11px] font-semibold text-rust">{error}</p>
      ) : helper ? (
        <p className="mt-1 text-[11px] font-medium leading-[15px] text-ink-faint">{helper}</p>
      ) : null}
    </div>
  )
}

/**
 * Service add/edit modal — salon-services.md §3. Basics, timing steppers with
 * live timeline preview, price, booking rules, qualified tech multi-select.
 */
export default function ServiceModal({
  open,
  onClose,
  salonId,
  categories,
  staff,
  editing,
  presetCategoryId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  salonId: number
  categories: CategoryWithServices[]
  staff: StaffRow[]
  editing: ServiceRow | null
  presetCategoryId?: number | null
  onSaved?: (id: number) => void
}) {
  const utils = trpc.useUtils()

  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<number>(0)
  const [description, setDescription] = useState('')
  const [durationMin, setDurationMin] = useState(60)
  const [processingMin, setProcessingMin] = useState(0)
  const [bufferMin, setBufferMin] = useState(10)
  const [price, setPrice] = useState('55')
  const [onlineBookable, setOnlineBookable] = useState(true)
  const [requiresApproval, setRequiresApproval] = useState(false)
  const [staffIds, setStaffIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!open) return
    if (editing) {
      setName(editing.name)
      setCategoryId(editing.categoryId)
      setDescription(editing.description ?? '')
      setDurationMin(editing.durationMin)
      setProcessingMin(editing.processingMin)
      setBufferMin(editing.bufferMin)
      setPrice(String(editing.priceCents / 100))
      setOnlineBookable(editing.onlineBookable)
      setRequiresApproval(editing.requiresApproval)
      setStaffIds(new Set(editing.staffIds))
    } else {
      setName('')
      setCategoryId(presetCategoryId ?? categories[0]?.id ?? 0)
      setDescription('')
      setDurationMin(60)
      setProcessingMin(0)
      setBufferMin(10)
      setPrice('55')
      setOnlineBookable(true)
      setRequiresApproval(false)
      setStaffIds(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, presetCategoryId])

  const catName = categories.find((c) => c.id === categoryId)?.name ?? ''
  const cat = CAT[catKey(catName)]

  const priceCents = Math.round((parseFloat(price) || 0) * 100)
  const nameError = name.trim() ? null : 'Name is required'
  const processingError = processingMin >= durationMin ? 'Processing must be shorter than duration' : null
  const valid = !nameError && !processingError && durationMin >= 15

  const createMut = trpc.services.create.useMutation()
  const updateMut = trpc.services.update.useMutation()
  const busy = createMut.isPending || updateMut.isPending

  async function handleSave() {
    if (!valid) return
    const base = {
      name: name.trim(),
      description: description.trim() || undefined,
      durationMin,
      processingMin,
      bufferMin,
      priceCents,
      onlineBookable,
      requiresApproval,
    }
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: base, staffIds: [...staffIds] })
        toast.success(`“${base.name}” saved`)
        onSaved?.(editing.id)
      } else {
        const res = await createMut.mutateAsync({ salonId, categoryId, ...base, staffIds: [...staffIds] })
        toast.success(`“${base.name}” added to ${catName}`)
        onSaved?.(res.id)
      }
      utils.services.list.invalidate()
      utils.staff.list.invalidate()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save service')
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, StaffRow[]>()
    for (const s of staff) {
      if (!s.active) continue
      const arr = map.get(s.roleGroup) ?? []
      arr.push(s)
      map.set(s.roleGroup, arr)
    }
    return [...map.entries()]
  }, [staff])

  const toggleStaff = (id: number) => {
    setStaffIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /* Timeline preview: 3-hour (180 min) scale */
  const SCALE = 180
  const blockPct = Math.min(100, (durationMin / SCALE) * 100)
  const bufferPct = Math.min(100 - blockPct, (bufferMin / SCALE) * 100)
  const procPct = durationMin > 0 ? Math.min(100, (processingMin / durationMin) * 100) : 0

  return (
    <Modal open={open} onClose={onClose} maxWidth={600} labelledBy="service-modal-title">
      <ModalHeader
        title={editing ? `Edit ${editing.name}` : 'New service'}
        sub={editing ? 'Changes apply to future bookings' : `Added to ${catName || 'the catalog'}`}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        {/* 1 — Basics */}
        <section>
          <p className="mb-1 text-micro font-bold uppercase text-ink-faint">Name</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Gel-X Full Set"
            className="h-10 w-full rounded-r-sm border border-line bg-surface px-3 text-[14px] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-faint focus:border-clay focus:ring-2 focus:ring-clay/30"
          />
          {!name.trim() && <p className="mt-1 text-[11px] font-semibold text-rust">Name is required</p>}

          <p className="mb-1 mt-4 text-micro font-bold uppercase text-ink-faint">Category</p>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => {
              const cc = CAT[catKey(c.name)]
              const active = c.id === categoryId
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  className={cn(
                    'flex h-9 cursor-pointer items-center gap-2 rounded-r-pill border px-3.5 text-[13px] font-bold transition-colors',
                    active ? 'border-clay bg-clay-tint text-clay' : 'border-line bg-surface text-ink-soft hover:bg-cream',
                  )}
                >
                  <span className={cn('h-2.5 w-2.5 rounded-r-pill', cc.dot)} />
                  {c.name}
                </button>
              )
            })}
          </div>

          <p className="mb-1 mt-4 text-micro font-bold uppercase text-ink-faint">Description</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Shown to clients in booking step 1…"
            className="w-full resize-none rounded-r-sm border border-line bg-surface px-3 py-2 text-[13.5px] outline-none placeholder:text-ink-faint focus:border-clay focus:ring-2 focus:ring-clay/30"
          />
        </section>

        {/* 2 — Timing */}
        <section>
          <p className="mb-2 text-micro font-bold uppercase text-ink-faint">Timing</p>
          <div className="flex gap-3">
            <Stepper label="Duration" value={durationMin} step={15} min={15} max={240} onChange={setDurationMin} />
            <Stepper
              label="Processing"
              value={processingMin}
              step={15}
              min={0}
              max={120}
              onChange={setProcessingMin}
              helper="Tech is free during processing — e.g. color developing"
              error={processingError ?? undefined}
            />
            <Stepper
              label="Buffer"
              value={bufferMin}
              step={5}
              min={0}
              max={30}
              onChange={setBufferMin}
              helper="Cleanup between clients"
            />
          </div>

          {/* Live preview — mini 3-hour timeline */}
          <div className="mt-3 rounded-r-md border border-line bg-paper p-3">
            <div className="flex h-7 w-full overflow-hidden rounded-r-sm bg-cream">
              <motion.div
                className={cn('relative flex h-full overflow-hidden', cat.fill)}
                animate={{ width: `${blockPct}%` }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className={cn('z-10 flex h-full items-center pl-2 text-[10.5px] font-extrabold tnum', cat.text)}>
                  {durationMin}m
                </span>
                {processingMin > 0 && (
                  <motion.span
                    className="absolute right-0 top-0 h-full"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(45deg, rgba(42,33,26,.10) 0 3px, transparent 3px 7px)',
                    }}
                    animate={{ width: `${procPct}%` }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    title={`${processingMin} min processing`}
                  />
                )}
              </motion.div>
              {bufferMin > 0 && (
                <motion.div
                  className="h-full bg-line-strong/50"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(90deg, rgba(42,33,26,.06) 0 2px, transparent 2px 6px)',
                  }}
                  animate={{ width: `${bufferPct}%` }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  title={`${bufferMin} min buffer`}
                />
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[10.5px] font-semibold text-ink-faint">
              <span className="flex items-center gap-1">
                <span className={cn('h-2 w-2 rounded-[2px]', cat.dot)} /> service
              </span>
              {processingMin > 0 && <span className="flex items-center gap-1">▨ processing (tech free)</span>}
              {bufferMin > 0 && <span className="flex items-center gap-1">░ buffer</span>}
              <span className="ml-auto tnum">total {durationMin + bufferMin} min</span>
            </div>
          </div>
        </section>

        {/* 3 — Price */}
        <section>
          <p className="mb-1 text-micro font-bold uppercase text-ink-faint">Price</p>
          <div className="flex h-10 w-40 items-center rounded-r-sm border border-line bg-surface px-3 focus-within:border-clay focus-within:ring-2 focus-within:ring-clay/30">
            <span className="text-[14px] font-bold text-ink-faint">$</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className="w-full bg-transparent px-1 text-[14px] font-extrabold text-ink outline-none tnum"
            />
          </div>
        </section>

        {/* 4 — Booking rules */}
        <section className="space-y-3">
          <p className="text-micro font-bold uppercase text-ink-faint">Booking rules</p>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-r-md border border-line bg-paper px-4 py-3">
            <span>
              <span className="block text-[13.5px] font-bold text-ink">Bookable online</span>
              <span className="block text-[12px] font-medium text-ink-faint">
                Clients can pick this service in the booking flow
              </span>
            </span>
            <Toggle checked={onlineBookable} onChange={setOnlineBookable} label="Bookable online" />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-r-md border border-line bg-paper px-4 py-3">
            <span>
              <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink">
                Requires approval
                {requiresApproval && <Clock className="h-3.5 w-3.5 text-amber" />}
              </span>
              <span className="block text-[12px] font-medium text-ink-faint">
                Online bookings arrive as requests instead of confirmed appointments
              </span>
            </span>
            <Toggle checked={requiresApproval} onChange={setRequiresApproval} label="Requires approval" />
          </label>
        </section>

        {/* 5 — Qualified technicians */}
        <section>
          <p className="mb-2 text-micro font-bold uppercase text-ink-faint">
            Qualified technicians · {staffIds.size} selected
          </p>
          <div className="space-y-3">
            {groups.map(([group, members]) => (
              <div key={group}>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-ink-soft">
                    <span className={cn('h-2 w-2 rounded-r-pill', CAT[catKey(GROUP_LABEL[group] ?? group)].dot)} />
                    {GROUP_LABEL[group] ?? group}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setStaffIds((prev) => {
                        const next = new Set(prev)
                        const allIn = members.every((m) => next.has(m.id))
                        for (const m of members) {
                          if (allIn) next.delete(m.id)
                          else next.add(m.id)
                        }
                        return next
                      })
                    }
                    className="cursor-pointer text-[11.5px] font-bold text-clay hover:text-clay-deep"
                  >
                    All {GROUP_LABEL[group] ?? group} techs
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((s) => {
                    const active = staffIds.has(s.id)
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleStaff(s.id)}
                        className={cn(
                          'flex h-9 cursor-pointer items-center gap-2 rounded-r-pill border py-1 pl-1 pr-3 text-[12.5px] font-bold transition-colors',
                          active
                            ? cn('border-transparent', cat.fill, cat.text)
                            : 'border-line bg-surface text-ink-soft hover:bg-cream',
                        )}
                      >
                        <Avatar
                          initials={s.initials}
                          tint={normalizeTint(s.avatarTint, s.name)}
                          size={28}
                          className="!h-7 !w-7"
                        />
                        {s.name.split(' ')[0]}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="h-10 cursor-pointer rounded-r-md px-4 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-cream"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={handleSave}
          className="h-10 cursor-pointer rounded-r-md bg-clay px-5 text-[14px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-clay-deep hover:shadow-sh-1 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save service'}
        </button>
      </div>
    </Modal>
  )
}
