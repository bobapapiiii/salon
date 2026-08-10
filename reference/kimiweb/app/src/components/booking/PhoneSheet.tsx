import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { trpc } from '@/providers/trpc'
import BottomSheet, { sheetItem } from './BottomSheet'
import { findClientByPhone, useIdentityStore } from './identity'
import { fmtPhoneInput, phoneDigits } from './utils'

/**
 * Phone-entry sheet ("Not Hannah?" / Switch): finds the client by phone and
 * switches the demo identity.
 */
export default function PhoneSheet({
  open,
  onClose,
  salonId,
}: {
  open: boolean
  onClose: () => void
  salonId: number | undefined
}) {
  const utils = trpc.useUtils()
  const setClient = useIdentityStore((s) => s.setClient)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const find = async () => {
    if (salonId == null || phoneDigits(phone).length !== 10) {
      setError('Enter a 10-digit phone number')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const found = await findClientByPhone(utils, salonId, phone)
      if (!found) {
        setError('No bookings found for that number')
        return
      }
      setClient(found.id)
      setPhone('')
      onClose()
      toast(`Welcome back, ${found.firstName}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="phone-sheet-title">
      <motion.h2
        variants={sheetItem}
        id="phone-sheet-title"
        className="font-display text-[22px] font-semibold leading-[28px] text-ink"
      >
        Find my bookings
      </motion.h2>
      <motion.p variants={sheetItem} className="mt-1 text-[14px] leading-[21px] text-ink-soft">
        Enter the phone number you booked with — no account needed.
      </motion.p>
      <motion.div variants={sheetItem} className="mt-4">
        <input
          className="h-11 w-full rounded-r-sm border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-clay focus:outline-none focus:ring-2 focus:ring-clay/30"
          value={phone}
          inputMode="tel"
          autoComplete="tel"
          placeholder="(555) 555-1234"
          onChange={(e) => setPhone(fmtPhoneInput(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && void find()}
        />
        {error && <p className="mt-1.5 text-small font-semibold text-rust">{error}</p>}
      </motion.div>
      <motion.button
        variants={sheetItem}
        type="button"
        disabled={busy}
        onClick={() => void find()}
        className="mt-4 flex h-11 w-full items-center justify-center rounded-r-md bg-clay text-[14px] font-semibold text-white transition-colors hover:bg-clay-deep disabled:opacity-60"
      >
        {busy ? 'Looking…' : 'Find my bookings'}
      </motion.button>
    </BottomSheet>
  )
}
