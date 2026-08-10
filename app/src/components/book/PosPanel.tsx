// ─── POS, ring up a sale without touching the appointment book ──────────────
// Walk-up clients, retail, or services done off-book: pick (or create) the
// client, add service lines with a tech each, then take payment in the shared
// PaymentFlow panel.
import { useMemo, useState } from "react";
import { Plus, Search, ShoppingBag, UserPlus, X } from "lucide-react";
import type { ClientRecord } from "@/lib/booking-types";
import { SERVICES } from "@/lib/mock-data";
import { useStaffStore } from "@/lib/staff-store";
import { svcById } from '@/lib/services-store'
import { catById } from '@/lib/categories-store'
import { PaymentFlow, type PaymentLine, type PaymentResult } from "./CheckoutDialog";


const field =
  "w-full rounded-[8px] border border-input bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-ring";

interface SaleRow {
  id: string;
  serviceId: string;
  techId: string; // '' = no tech credited
}

export function PosPanel({ clients, pointsByClient, onAddClient, onComplete, onClose }: {
  clients: ClientRecord[];
  pointsByClient: Record<string, number>;
  onAddClient: (c: ClientRecord) => void;
  onComplete: (r: PaymentResult & { clientName: string; itemCount: number; lines: { techId: string; price: number }[] }) => void;
  onClose: () => void;
}) {
  const { techs } = useStaffStore()
  const [step, setStep] = useState<"build" | "pay">("build")
  const [client, setClient] = useState<ClientRecord | null>(null)
  const [q, setQ] = useState("")
  const [searching, setSearching] = useState(false)
  const [newPhone, setNewPhone] = useState("")
  const [rows, setRows] = useState<SaleRow[]>([{ id: "r1", serviceId: SERVICES[0].id, techId: "" }])

  const matches = useMemo(() => {
    if (!q.trim()) return []
    const text = q.toLowerCase()
    const digits = q.replace(/\D/g, "")
    return clients
      .filter((c) => c.name.toLowerCase().includes(text) || (digits && c.phone.replace(/\D/g, "").includes(digits)))
      .slice(0, 6)
  }, [q, clients])

  const subtotal = rows.reduce((s, r) => s + (svcById[r.serviceId]?.price ?? 0), 0)
  const money = (v: number) => `$${v.toFixed(2)}`

  const pickClient = (c: ClientRecord) => {
    setClient(c)
    setQ("")
    setSearching(false)
  }

  const createClient = () => {
    if (!q.trim()) return
    const c: ClientRecord = { id: `c${Date.now()}`, name: q.trim(), phone: newPhone.trim() || "(555) 000-0000", visits: 0 }
    onAddClient(c)
    pickClient(c)
    setNewPhone("")
  }

  const addRow = () => setRows((r) => [...r, { id: `r${Date.now()}`, serviceId: SERVICES[0].id, techId: "" }])
  const patchRow = (id: string, patch: Partial<SaleRow>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const removeRow = (id: string) => setRows((r) => r.filter((x) => x.id !== id))

  if (step === "pay") {
    const name = client?.name ?? "Guest sale"
    const lines: PaymentLine[] = rows.map((r) => {
      const svc = svcById[r.serviceId]
      const tech = techs.find((t) => t.id === r.techId)
      return {
        id: r.id,
        label: svc?.name ?? r.serviceId,
        sub: tech ? `Tech: ${tech.name}` : "No tech credited",
        color: svc ? catById[svc.categoryId]?.line : undefined,
        price: svc?.price ?? 0,
        techId: r.techId || undefined,
      }
    })
    return (
      <PaymentFlow
        title={`POS: ${name}`}
        subtitle={`${rows.length} ${rows.length === 1 ? "item" : "items"}`}
        lines={lines}
        onComplete={(p) => onComplete({
          ...p,
          clientName: name,
          itemCount: rows.length,
          lines: rows.map((r) => ({ techId: r.techId, price: svcById[r.serviceId]?.price ?? 0 })),
        })}
        onClose={onClose}
        loyaltyBalance={client ? pointsByClient[client.id] ?? 0 : null}
      />
    )
  }

  return (
    <div className="fixed inset-y-0 right-0 z-[94] flex w-[460px] max-w-[95vw] flex-col border-l border-line bg-popover shadow-2xl">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-bold text-ink">
            <ShoppingBag className="h-4 w-4 text-clay" /> Point of sale
          </h2>
          <p className="text-[11.5px] text-ink-faint">Ring up a sale, no appointment needed</p>
        </div>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-cream hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {/* client lookup */}
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Client</p>
        {client ? (
          <div className="flex items-center gap-2 rounded-[8px] border border-clay/40 bg-clay-tint px-2.5 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-clay text-[10px] font-extrabold text-white">
              {client.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-clay">{client.name}</span>
            <span className="shrink-0 text-[10px] text-clay/70">{client.phone}</span>
            <button onClick={() => setClient(null)} className="shrink-0 text-clay/70 hover:text-rust" title="Change client">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
              <input
                autoFocus
                value={q}
                onChange={(e) => { setQ(e.target.value); setSearching(true) }}
                onFocus={() => setSearching(true)}
                onBlur={() => setTimeout(() => setSearching(false), 150)}
                placeholder="Search client, name or phone"
                className={`${field} pl-7`}
              />
              {searching && q.trim() && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-[10px] border border-line bg-popover shadow-sh-2">
                  {matches.map((c) => (
                    <button key={c.id} type="button" onMouseDown={() => pickClient(c)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-cream">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-clay-tint text-[9px] font-extrabold text-clay">
                        {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                      <span className="text-[10px] text-ink-faint">{c.phone}</span>
                    </button>
                  ))}
                  <div className="border-t border-line p-1.5">
                    <div className="flex items-center gap-1">
                      <UserPlus className="h-3.5 w-3.5 shrink-0 text-clay" />
                      <input
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        placeholder={`New client "${q}", phone`}
                        className="min-w-0 flex-1 rounded-[6px] border border-input bg-background px-1.5 py-1 text-[11px] outline-none"
                      />
                      <button type="button" onMouseDown={createClient} className="rounded-[6px] bg-clay px-2 py-1 text-[11px] font-semibold text-white">
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-faint">
              No profile? Leave blank, the sale rings up as a <b>guest sale</b>.
            </p>
          </>
        )}

        {/* service rows */}
        <div className="mb-1.5 mt-5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Services</p>
          <button onClick={addRow} className="flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-bold text-clay hover:bg-clay-tint">
            <Plus className="h-3 w-3" /> Add service
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((r) => {
            const svc = svcById[r.serviceId]
            const qualified = techs.filter((t) => t.skills.includes(r.serviceId))
            return (
              <div key={r.id} className="flex items-center gap-1.5 rounded-[10px] border border-line p-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: svc ? catById[svc.categoryId]?.line : "#5B54D6" }} />
                <div className="min-w-0 flex-1 space-y-1">
                  <select value={r.serviceId} onChange={(e) => patchRow(r.id, { serviceId: e.target.value, techId: "" })} className={field}>
                    {SERVICES.map((s) => <option key={s.id} value={s.id}>{s.name} · ${s.price}</option>)}
                  </select>
                  <select value={r.techId} onChange={(e) => patchRow(r.id, { techId: e.target.value })} className={field}>
                    <option value="">No tech credited</option>
                    {qualified.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <span className="tnum w-12 shrink-0 text-right text-[12.5px] font-semibold">{money(svc?.price ?? 0)}</span>
                <button
                  onClick={() => removeRow(r.id)}
                  disabled={rows.length === 1}
                  className="shrink-0 text-ink-faint transition-colors hover:text-rust disabled:opacity-30"
                  title="Remove line"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* footer */}
      <div className="border-t border-line px-5 py-3.5">
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="text-[12px] text-ink-soft">{rows.length} {rows.length === 1 ? "item" : "items"}</span>
          <span className="text-[15px] font-bold">Subtotal <span className="tnum text-clay">{money(subtotal)}</span></span>
        </div>
        <button
          onClick={() => setStep("pay")}
          disabled={rows.length === 0}
          className="w-full rounded-xl bg-clay py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-clay-deep disabled:opacity-40"
        >
          Continue to payment →
        </button>
      </div>
    </div>
  )
}
