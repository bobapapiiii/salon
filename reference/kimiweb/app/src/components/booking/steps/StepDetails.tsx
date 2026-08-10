import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Pencil, ShieldCheck, MessageSquareText, PhoneCall, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { trpc } from '@/providers/trpc'
import {
  apiItemsOf,
  filterSlotsForPicks,
  itemStartsOf,
  commonStaffIdOf,
  useBookingStore,
  type RawSlot,
  type SlotPick,
} from '../store'
import { useCatalog } from '../useCatalog'
import BookingFooter from '../BookingFooter'
import BottomSheet, { sheetItem } from '../BottomSheet'
import { findClientByPhone, useDemoIdentity, useIdentityStore } from '../identity'
import { EASE_OUT_EXPO, fmtDayLabel, fmtMin, fmtMoney, fmtPhoneInput, phoneDigits, shortName } from '../utils'

export type BookingOutcome =
  | { kind: 'confirmed' }
  | { kind: 'requested'; phone: string }

const inputCls =
  'h-11 w-full rounded-r-sm border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-ink-faint transition-shadow duration-150 focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/30'

function Field({
  label,
  error,
  shakeKey,
  children,
  helper,
}: {
  label: string
  error?: string | null
  shakeKey: number
  children: React.ReactNode
  helper?: string
}) {
  return (
    <motion.label
      className="block"
      animate={shakeKey > 0 && error ? { x: [0, -4, 4, -4, 0] } : { x: 0 }}
      transition={{ duration: 0.2 }}
    >
      <span className="mb-1 block text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </span>
      {children}
      <AnimatePresence>
        {error ? (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-1 block text-small font-semibold text-rust"
          >
            {error}
          </motion.span>
        ) : helper ? (
          <span className="mt-1 block text-micro font-semibold uppercase tracking-[0.08em] text-ink-faint">
            {helper}
          </span>
        ) : null}
      </AnimatePresence>
    </motion.label>
  )
}

export default function StepDetails({
  onOutcome,
}: {
  onOutcome: (o: BookingOutcome) => void
}) {
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const { salon, salonId, serviceById, staffById } = useCatalog()
  const identity = useDemoIdentity()
  const setClient = useIdentityStore((s) => s.setClient)

  const items = useBookingStore((s) => s.items)
  const slot = useBookingStore((s) => s.slot)
  const details = useBookingStore((s) => s.details)
  const setDetails = useBookingStore((s) => s.setDetails)
  const setSlot = useBookingStore((s) => s.setSlot)
  const setStep = useBookingStore((s) => s.setStep)
  const rescheduleOf = useBookingStore((s) => s.rescheduleOf)
  const reset = useBookingStore((s) => s.reset)

  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [shakeKey, setShakeKey] = useState(0)
  const [welcomeName, setWelcomeName] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [takenOptions, setTakenOptions] = useState<RawSlot[] | null>(null)
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const createAppt = trpc.appointments.create.useMutation()
  const createReq = trpc.requests.create.useMutation()
  const reschedule = trpc.appointments.reschedule.useMutation()
  const createClient = trpc.clients.create.useMutation()

  // Prefill from the demo identity (editable after).
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !identity.client) return
    prefilled.current = true
    setDetails({
      firstName: details.firstName || identity.client.firstName,
      lastName: details.lastName || identity.client.lastName,
      phone: details.phone || identity.client.phone || '',
      email: details.email || identity.client.email || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.client])

  // Phone-as-identity lookup (debounced) → welcome-back chip / blocked modal.
  useEffect(() => {
    if (salonId == null) return
    if (lookupTimer.current) clearTimeout(lookupTimer.current)
    const digits = phoneDigits(details.phone)
    if (digits.length !== 10) {
      setWelcomeName(null)
      return
    }
    lookupTimer.current = setTimeout(async () => {
      const found = await findClientByPhone(utils, salonId, details.phone)
      if (!found) {
        setWelcomeName(null)
        return
      }
      if (found.blocked) {
        setBlocked(true)
        return
      }
      setWelcomeName(found.firstName)
      setDetails({
        firstName: found.firstName,
        lastName: found.lastName,
        email: details.email || found.email || '',
      })
    }, 500)
    return () => {
      if (lookupTimer.current) clearTimeout(lookupTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.phone, salonId])

  if (!slot || items.length === 0 || salonId == null) {
    return (
      <div className="rounded-r-lg border border-line bg-cream p-4 text-small text-ink-soft">
        Pick a time first — then tell us who’s coming.
      </div>
    )
  }

  const durations = new Map(items.map((i) => [i.serviceId, serviceById.get(i.serviceId)?.durationMin ?? 0]))
  const starts = itemStartsOf(items, durations, slot.startMin)
  const requiresApproval = items.some((i) => serviceById.get(i.serviceId)?.requiresApproval)
  const total = items.reduce((sum, i) => sum + (serviceById.get(i.serviceId)?.priceCents ?? 0), 0)
  const techNameFor = (serviceId: number) => {
    const assigned = slot.items.find((si) => si.serviceId === serviceId)
    if (assigned?.staffName) return shortName(assigned.staffName)
    const picked = items.find((i) => i.serviceId === serviceId)?.staffId
    if (picked != null) return shortName(staffById.get(picked)?.name)
    return 'Any available'
  }

  const validate = () => {
    const e: Record<string, string | null> = {}
    if (!details.firstName.trim()) e.firstName = 'First name is required'
    if (!details.lastName.trim()) e.lastName = 'Last name is required'
    if (phoneDigits(details.phone).length !== 10) e.phone = 'Enter a 10-digit phone number'
    if (details.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.email)) e.email = 'That email doesn’t look right'
    setErrors(e)
    if (Object.keys(e).length) setShakeKey((k) => k + 1)
    return Object.keys(e).length === 0
  }

  const invalidateAll = async () => {
    await Promise.all([
      utils.appointments.forClient.invalidate(),
      utils.appointments.byDate.invalidate(),
      utils.requests.forClient.invalidate(),
      utils.requests.list.invalidate(),
      utils.availability.slots.invalidate(),
      utils.clients.list.invalidate(),
    ])
  }

  const fetchAlternatives = async (taken: SlotPick) => {
    try {
      const raw = await utils.availability.slots.fetch({
        salonId,
        date: taken.date,
        items: apiItemsOf(items),
        staffId: commonStaffIdOf(items),
        stepMin: 15,
      })
      const options = filterSlotsForPicks(raw, items)
        .filter((s) => s.startMin !== taken.startMin)
        .sort((a, b) => Math.abs(a.startMin - taken.startMin) - Math.abs(b.startMin - taken.startMin))
        .slice(0, 3)
      setTakenOptions(options)
    } catch {
      setTakenOptions([])
    }
  }

  const confirm = async (picked: SlotPick) => {
    if (submitting) return
    if (!validate()) return
    setSubmitting(true)
    setTakenOptions(null)
    try {
      // Find-or-create client by phone.
      const found = await findClientByPhone(utils, salonId, details.phone)
      if (found?.blocked) {
        setBlocked(true)
        setSubmitting(false)
        return
      }
      let clientId: number
      if (found) {
        clientId = found.id
      } else {
        const created = await createClient.mutateAsync({
          salonId,
          firstName: details.firstName.trim(),
          lastName: details.lastName.trim(),
          phone: details.phone,
          email: details.email || undefined,
        })
        clientId = created.id
      }

      // Reschedule path: update the original appointment, undo-able.
      if (rescheduleOf) {
        const original = rescheduleOf
        await reschedule.mutateAsync({ id: original.id, date: picked.date, startMin: picked.startMin })
        await invalidateAll()
        setClient(clientId)
        reset()
        toast('Rescheduled', {
          duration: 10000,
          action: {
            label: 'Undo',
            onClick: async () => {
              await reschedule.mutateAsync({ id: original.id, date: original.date, startMin: original.startMin })
              await invalidateAll()
              toast('Moved back')
            },
          },
        })
        navigate('/book/appointments')
        return
      }

      const note = details.note.trim() || undefined
      if (requiresApproval) {
        await createReq.mutateAsync({
          salonId,
          clientId,
          date: picked.date,
          startMin: picked.startMin,
          noteToSalon: note,
          items: items.map((i) => ({
            serviceId: i.serviceId,
            requestedStaffId: i.staffId ?? null,
            anyStaff: i.staffId == null,
            sameTime: i.mode === 'same-time',
          })),
        })
        await invalidateAll()
        setClient(clientId)
        onOutcome({ kind: 'requested', phone: details.phone })
        return
      }

      const hasSameTime = items.some((i) => i.mode === 'same-time')
      await createAppt.mutateAsync({
        salonId,
        clientId,
        date: picked.date,
        items: items.map((i) => {
          const assigned = picked.items.find((si) => si.serviceId === i.serviceId)
          return {
            serviceId: i.serviceId,
            staffId: assigned?.staffId ?? null,
            requestedStaffId: i.staffId ?? null,
            anyStaff: i.staffId == null,
            startMin: starts.get(i.serviceId) ?? picked.startMin,
          }
        }),
        source: 'online',
        status: 'confirmed',
        noteToSalon: note,
        sameTimeGroupId: hasSameTime ? `st-${Date.now()}` : undefined,
      })
      await invalidateAll()
      setClient(clientId)
      onOutcome({ kind: 'confirmed' })
    } catch (err) {
      const code = (err as { data?: { code?: string } })?.data?.code
      if (code === 'CONFLICT') {
        await fetchAlternatives(picked)
      } else {
        toast.error('Something went wrong — please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const takeAlternative = (s: RawSlot) => {
    const next: SlotPick = { date: slot.date, startMin: s.startMin, endMin: s.endMin, items: s.items }
    setSlot(next)
    setTakenOptions(null)
    void confirm(next)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Booking summary card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
        className="rounded-r-lg bg-cream p-4"
      >
        <p className="tnum mb-2 text-small font-bold text-ink-soft">
          {fmtDayLabel(slot.date)} · {fmtMin(slot.startMin)}
          <button
            type="button"
            onClick={() => setStep(3)}
            className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-r-pill text-ink-faint hover:bg-surface hover:text-clay"
            title="Edit time"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </p>
        <div className="flex flex-col gap-2.5">
          {items.map((i) => {
            const svc = serviceById.get(i.serviceId)
            if (!svc) return null
            return (
              <div key={i.serviceId} className="flex items-baseline gap-2 text-[14px]">
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{svc.name}</span>
                  <span className="text-ink-soft">
                    {' '}
                    · with {techNameFor(i.serviceId)} · {fmtMin(starts.get(i.serviceId) ?? slot.startMin)}
                  </span>
                  {i.mode === 'same-time' && (
                    <span className="ml-1.5 rounded-r-pill bg-clay-tint px-1.5 py-0.5 text-micro font-bold uppercase tracking-[0.08em] text-clay-deep">
                      Same time
                    </span>
                  )}
                </div>
                <span className="tnum font-extrabold text-ink">{fmtMoney(svc.priceCents)}</span>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-r-pill text-ink-faint hover:bg-surface hover:text-clay"
                  title="Edit services"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-line-strong pt-2.5">
          <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-faint">Total</span>
          <span className="tnum text-[16px] font-extrabold text-ink">{fmtMoney(total)}</span>
        </div>
      </motion.div>

      {/* Slot-taken alert */}
      <AnimatePresence>
        {takenOptions && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="rounded-r-lg border border-amber/40 bg-amber-tint p-4"
          >
            <p className="flex items-center gap-2 text-[14px] font-bold text-amber">
              <TriangleAlert className="h-4 w-4" />
              That time was just taken — here are the closest options
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {takenOptions.length === 0 && (
                <span className="text-small font-semibold text-amber">
                  Nothing left that day — pick another time.
                </span>
              )}
              {takenOptions.map((s) => (
                <button
                  key={s.startMin}
                  type="button"
                  onClick={() => takeAlternative(s)}
                  className="tnum h-11 rounded-r-pill border border-amber/50 bg-surface px-4 text-[13px] font-bold text-amber hover:bg-amber-tint"
                >
                  {fmtMin(s.startMin)}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form */}
      <motion.div
        className="flex flex-col gap-4"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.045 } } }}
      >
        <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="grid grid-cols-2 gap-3">
          <Field label="First name" error={errors.firstName} shakeKey={shakeKey}>
            <input
              className={inputCls}
              value={details.firstName}
              onChange={(e) => setDetails({ firstName: e.target.value })}
              autoComplete="given-name"
            />
          </Field>
          <Field label="Last name" error={errors.lastName} shakeKey={shakeKey}>
            <input
              className={inputCls}
              value={details.lastName}
              onChange={(e) => setDetails({ lastName: e.target.value })}
              autoComplete="family-name"
            />
          </Field>
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
          <Field label="Phone" error={errors.phone} shakeKey={shakeKey}>
            <input
              className={inputCls}
              value={details.phone}
              inputMode="tel"
              autoComplete="tel"
              placeholder="(555) 555-1234"
              onChange={(e) => setDetails({ phone: fmtPhoneInput(e.target.value) })}
            />
          </Field>
          <AnimatePresence>
            {welcomeName && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-r-pill bg-olive-tint px-2.5 py-1 text-small font-bold text-[#4B552F]"
              >
                Welcome back, {welcomeName} — we filled your details
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
          <Field label="Email (optional)" error={errors.email} shakeKey={shakeKey} helper="for confirmations">
            <input
              className={inputCls}
              value={details.email}
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              onChange={(e) => setDetails({ email: e.target.value })}
            />
          </Field>
        </motion.div>

        <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
          <Field label="Note to salon" shakeKey={shakeKey}>
            <textarea
              className={cn(inputCls, 'h-auto min-h-[68px] py-2.5 leading-[21px]')}
              rows={2}
              value={details.note}
              placeholder="Gel allergy? Running late? Tell us here."
              onChange={(e) => setDetails({ note: e.target.value })}
            />
          </Field>
        </motion.div>
      </motion.div>

      {/* Policy micro */}
      <div className="flex flex-col gap-1.5 text-small font-medium text-ink-soft">
        <p className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-olive" />
          Free cancellation up to 4h before
        </p>
        <p className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-olive" />
          No account needed — we’ll text you
        </p>
      </div>

      <BookingFooter
        summary={
          <span className="tnum block">
            {items.length} service{items.length > 1 ? 's' : ''} · {fmtMoney(total)}
          </span>
        }
        cta={
          rescheduleOf
            ? 'Confirm new time'
            : requiresApproval
              ? 'Send request'
              : 'Confirm booking'
        }
        loading={submitting}
        onCta={() => void confirm(slot)}
      />

      {/* Blocked client modal */}
      <BottomSheet open={blocked} onClose={() => setBlocked(false)} labelledBy="blocked-title">
        <motion.div variants={sheetItem} className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-r-pill bg-rust-tint">
            <PhoneCall className="h-6 w-6 text-rust" />
          </span>
          <h2 id="blocked-title" className="mt-3 font-display text-[22px] font-semibold leading-[28px] text-ink">
            We can’t book this number online
          </h2>
          <p className="mt-1.5 text-[14px] leading-[21px] text-ink-soft">
            This number can’t book online. Please call the salon and we’ll take care of you.
          </p>
          <a
            href={`tel:${salon?.phone ?? ''}`}
            className="mt-4 flex h-11 items-center justify-center gap-2 rounded-r-md bg-clay text-[14px] font-semibold text-white hover:bg-clay-deep"
          >
            <PhoneCall className="h-4 w-4" />
            Call {salon?.name ?? 'the salon'}
          </a>
          <button
            type="button"
            onClick={() => setBlocked(false)}
            className="mt-2 h-11 w-full rounded-r-md text-[14px] font-semibold text-ink-soft hover:bg-cream"
          >
            Use a different number
          </button>
        </motion.div>
      </BottomSheet>
    </div>
  )
}
