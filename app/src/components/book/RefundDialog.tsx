// ─── Reopen a paid ticket ─────────────────────────────────────────────────
// Reached from the edit panel's Reopen Ticket button. This is the exact same
// checkout panel used for a fresh ticket -- add, remove, or edit services,
// adjust the tip -- except its payment section starts from what's already
// been collected (shown locked, since that already happened) instead of an
// empty ticket. Charging works the same way for any new remainder; a compact
// refund panel appears only if the correction brings the total below what's
// already been taken. See PaymentFlow's `existing` prop in CheckoutDialog.tsx
// for how that's wired up.
import { useState } from 'react'
import type { Appointment } from '@/lib/booking-types'
import { svcById } from '@/lib/services-store'
import { catById } from '@/lib/categories-store'
import { PaymentFlow, type PaymentLine, type PaymentResult, type PaymentSource } from './CheckoutDialog'

export { refundedBySource, totalRefunded, netCollected, balanceDue, type RefundRecord } from '@/lib/payments'
import type { RefundRecord } from '@/lib/payments'

/** the slice of a payment record this dialog needs */
export interface RefundablePayment {
  id: string
  clientName: string
  subtotal: number
  tip: number
  total: number
  discount?: number
  method: string
  sources?: PaymentSource[]
  refunds?: RefundRecord[]
}

export function ReopenCheckoutDialog({ payment, items, dateLabel, onPatchLine, onRemoveLine, onAddExtra, onRemoveExtra, onRefund, onComplete, onClose }: {
  payment: RefundablePayment
  items: Appointment[]
  dateLabel: string
  onPatchLine: (id: string, patch: Partial<Appointment>) => void
  onRemoveLine: (id: string) => void
  onAddExtra: (x: { serviceId: string; techId: string; person?: string }) => void
  onRemoveExtra: (id: string) => void
  onRefund: (sourceId: string, amount: number, reason: string | undefined, snapshot: { apptIds: string[]; subtotal: number; tip: number; total: number; points: number }) => void
  onComplete: (p: PaymentResult) => void
  onClose: () => void
}) {
  // items added THIS session render with the "added" badge and the full-delete
  // remove icon, same as a fresh checkout -- frozen at open so it doesn't
  // shift as edits land
  const [originalIds] = useState(() => new Set(items.map((a) => a.id)))
  const addedIds = items.filter((a) => !originalIds.has(a.id)).map((a) => a.id)

  const lines: PaymentLine[] = items.map((a) => {
    const svc = svcById[a.serviceId]
    return {
      id: a.id,
      label: svc?.name ?? a.serviceId,
      badge: a.clientName !== payment.clientName ? `${a.clientName} · guest` : undefined,
      sub: `${a.durationMin}m${(a.addons ?? []).length > 0 ? ` · +${a.addons!.map((x) => x.name).join(', +')}` : ''}`,
      color: svc ? catById[svc.categoryId]?.line : undefined,
      price: (a.priceOverride ?? svc?.price ?? 0) + (a.addons ?? []).reduce((x, ad) => x + ad.price, 0),
      serviceId: a.serviceId,
      startMin: a.startMin,
      techId: a.techId,
      customFields: a.customFields,
    }
  })

  return (
    <PaymentFlow
      title={`Reopen ticket: ${payment.clientName}`}
      subtitle={`${dateLabel} · ${items.length} ${items.length === 1 ? 'service' : 'services'}`}
      lines={lines}
      onComplete={onComplete}
      onClose={onClose}
      hostName={payment.clientName}
      editable
      addedIds={addedIds}
      onPatchLine={onPatchLine}
      onRemoveLine={onRemoveLine}
      onAddExtra={onAddExtra}
      onRemoveExtra={onRemoveExtra}
      existing={{ payment, tip: payment.tip, refunds: payment.refunds, onRefund }}
    />
  )
}
