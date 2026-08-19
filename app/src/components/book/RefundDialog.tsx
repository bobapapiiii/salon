// ─── Reopen a paid ticket ─────────────────────────────────────────────────
// Reached from the edit panel's Reopen checkout / Check out button. This is
// the exact same checkout panel used for a fresh ticket -- add, remove, or
// edit services, adjust the tip -- except its payment section starts from
// what's already been collected (shown locked, since that already happened)
// instead of an empty ticket. Charging works the same way for any new
// remainder; a compact refund panel appears only if the correction brings
// the total below what's already been taken. See PaymentFlow's `existing`
// prop in CheckoutDialog.tsx for how that's wired up.
import { useState } from 'react'
import type { Appointment } from '@/lib/booking-types'
import { svcById } from '@/lib/services-store'
import { catById } from '@/lib/categories-store'
import { PaymentFlow, paymentSources, type PaymentLine, type PaymentResult, type PaymentSource } from './CheckoutDialog'

export { refundedBySource, totalRefunded, netCollected, balanceDue, type RefundRecord } from '@/lib/payments'
import { balanceDue } from '@/lib/payments'
import type { RefundRecord } from '@/lib/payments'

/** the slice of a payment record this dialog needs -- includes the per-tech
 *  service/tip breakdown so a refund can be charged against the right
 *  person's commission or tip payout */
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
  lines?: { techId: string; price: number }[]
  tipByTech?: { techId: string; amount: number }[]
}

export function ReopenCheckoutDialog({ payment, items, dateLabel, onPatchLine, onRemoveLine, onAddExtra, onRemoveExtra, onRefund, onSync, onComplete, onClose, accountNames, existingPrefs }: {
  payment: RefundablePayment
  items: Appointment[]
  dateLabel: string
  onPatchLine: (id: string, patch: Partial<Appointment>) => void
  onRemoveLine: (id: string) => void
  onAddExtra: (x: { serviceId: string; techId: string; person?: string }) => void
  onRemoveExtra: (id: string) => void
  onRefund: (input: {
    sourceId: string
    amount: number
    reason?: string
    from?: 'service' | 'tip'
    techId?: string
    snapshot: { apptIds: string[]; subtotal: number; tip: number; total: number; points: number }
  }) => void
  /** live correction sync -- keeps the ledger current as services/tech/price
   *  change, no explicit save needed; see PaymentFlow's `existing.onSync` */
  onSync: (p: PaymentResult) => void
  onComplete: (p: PaymentResult) => void
  onClose: () => void
  /** everyone on this ticket who already has a ClientRecord -- see
   *  PaymentFlow's own accountNames doc */
  accountNames?: string[]
  /** technician + category pairs already saved for someone on this ticket --
   *  pre-checks a "save as preferred" box that already matches one */
  existingPrefs?: { person: string; techId: string; categoryId: string }[]
}) {
  // items added THIS session render with the "added" badge and the full-delete
  // remove icon, same as a fresh checkout -- frozen at open so it doesn't
  // shift as edits land
  const [originalIds] = useState(() => new Set(items.map((a) => a.id)))
  const addedIds = items.filter((a) => !originalIds.has(a.id)).map((a) => a.id)

  // a balance still owed means this ticket isn't really "done" yet -- reads
  // as finishing checkout, not reopening one that already closed clean
  const startingBalanceDue = balanceDue(payment.total, paymentSources(payment), payment.refunds)
  const title = startingBalanceDue > 0.004 ? `Checkout: ${payment.clientName}` : `Reopen checkout: ${payment.clientName}`

  const lines: PaymentLine[] = items.map((a) => {
    const svc = svcById[a.serviceId]
    return {
      id: a.id,
      label: svc?.name ?? a.serviceId,
      badge: a.clientName !== payment.clientName ? `${a.clientName} · guest` : undefined,
      sub: `${a.durationMin}m${(a.addons ?? []).length > 0 ? ` · +${a.addons!.map((x) => x.name).join(', +')}` : ''}`,
      color: svc ? catById[svc.categoryId]?.line : undefined,
      price: (a.priceOverride ?? svc?.price ?? 0) + (a.addons ?? []).reduce((x, ad) => x + ad.price, 0),
      person: a.clientName,
      serviceId: a.serviceId,
      startMin: a.startMin,
      techId: a.techId,
      customFields: a.customFields,
    }
  })

  return (
    <PaymentFlow
      title={title}
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
      existing={{ payment, tip: payment.tip, refunds: payment.refunds, onRefund, onSync }}
      accountNames={accountNames}
      existingPrefs={existingPrefs}
    />
  )
}
