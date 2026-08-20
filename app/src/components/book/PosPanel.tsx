// ─── POS, ring up a sale without touching the appointment book ──────────────
// Walk-up clients, retail, or services done off-book: build a party the same
// way New/Edit Appointment do (search an existing client, add a name-only
// guest, or create a full account on the spot), add service lines with a
// tech each, then take payment in the shared PaymentFlow panel.
import { useMemo, useState } from "react";
import { Plus, Search, ShoppingBag, UserPlus, X } from "lucide-react";
import type { ClientRecord } from "@/lib/booking-types";
import { useStaffStore } from "@/lib/staff-store";
import { activeServices, orderedServices, serviceGroupLabel, svcById, useServicesStore } from '@/lib/services-store'
import { catById, useCategoriesStore } from '@/lib/categories-store'
import { PaymentFlow, type CheckoutDraftState, type PaymentLine, type PaymentResult } from "./CheckoutDialog";
import { SearchSelect } from "./SearchSelect";


const field =
  "w-full rounded-[8px] border border-input bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-ring";

interface SaleRow {
  id: string;
  serviceId: string;
  techId: string; // '' = no tech credited
  /** whose line this is, once there's more than one guest on the sale --
   *  matches a PosGuest's name. Unset lines ride along regardless of who's
   *  selected to pay (a shared/retail item), same as a solo or guest sale
   *  where there's nobody to assign it to in the first place */
  person?: string;
  /** salon-defined per-service notation (Color, etc.), keyed by field id --
   *  same idea as an appointment's own customFields, just kept on the row
   *  here since a POS sale has no appointment to hold it */
  customFields?: Record<string, string>;
}

/** one guest on a POS sale -- same three ways to add them as New/Edit
 *  Appointment's own guest picker: an existing client, a name-only guest
 *  with no profile, or creating a full account on the spot */
interface PosGuest {
  id: string;
  /** set once this guest is (or becomes) a real ClientRecord */
  clientId?: string;
  name: string;
  /** true = name-only, no ClientRecord -- can never hold loyalty points */
  isGuest: boolean;
}

export function PosPanel({ clients, pointsByClient, onAddClient, onComplete, onClose }: {
  clients: ClientRecord[];
  pointsByClient: Record<string, number>;
  onAddClient: (c: ClientRecord) => void;
  onComplete: (r: PaymentResult & {
    clientName: string;
    /** everyone actually on this transaction (host first), so each of them
     *  sees it in their own visit history -- undefined for an anonymous
     *  guest sale with nobody attached at all */
    clientNames?: string[];
    party?: number;
    /** who this ticket's earned/redeemed points go to, if anyone selected
     *  actually has an account to hold them */
    pointsRecipient?: string | null;
    itemCount: number;
    lines: { techId: string; price: number; customFields?: Record<string, string> }[];
  }) => void;
  onClose: () => void;
}) {
  // live catalog -- so a service just added or removed in Settings shows
  // up in POS immediately instead of the stale baseline list
  const services = activeServices(useServicesStore())
  const categories = useCategoriesStore()
  // same order as the Settings service list
  const orderedSvcs = orderedServices(services, categories)
  const { techs, roles } = useStaffStore()
  // technician picker options for a service row: grouped under their job
  // role (same roles/order as the calendar's own column groups), each
  // group alphabetized by name; no avatar chip, this is a plain text list
  const techOptionsFor = (qualified: typeof techs) => {
    const used = new Set<string>()
    const grouped = roles.flatMap((role) => {
      const inRole = qualified.filter((t) => t.teamId === role.id).sort((a, b) => a.name.localeCompare(b.name))
      inRole.forEach((t) => used.add(t.id))
      return inRole.map((t) => ({ value: t.id, label: t.name, group: role.name }))
    })
    const rest = qualified.filter((t) => !used.has(t.id)).sort((a, b) => a.name.localeCompare(b.name))
    return [
      { value: "", label: "No tech credited" },
      ...grouped,
      ...rest.map((t) => ({ value: t.id, label: t.name, group: "Other" })),
    ]
  }
  const [step, setStep] = useState<"build" | "pay">("build")
  const [guests, setGuests] = useState<PosGuest[]>([])
  // which guest's services the build step shows -- click a chip to switch,
  // same as New Appointment's own guest tabs
  const [activeGuest, setActiveGuest] = useState(0)
  // who's actually paying together on this transaction -- same idea as the
  // regular checkout's "Paying together" chips, defaults to everyone on the
  // sale, toggled at the payment step
  const [posSelected, setPosSelected] = useState<Set<string>>(new Set())
  // controlled draft, so the "Give points to" pick (and everything else the
  // payment panel tracks) is visible up here instead of trapped in
  // PaymentFlow's own internal fallback state
  const [posDraft, setPosDraft] = useState<CheckoutDraftState>({ tipPct: 18, tipCustom: "", method: "Cash", note: "", redeemId: null, custom: {} })
  const [q, setQ] = useState("")
  const [searching, setSearching] = useState(false)
  const [newPhone, setNewPhone] = useState("")
  // a blank line prompts for a service instead of silently defaulting to
  // the catalog's first item -- picking one is an explicit action here
  const [rows, setRows] = useState<SaleRow[]>([{ id: "r1", serviceId: "", techId: "" }])

  const matches = useMemo(() => {
    if (!q.trim()) return []
    const text = q.toLowerCase()
    const digits = q.replace(/\D/g, "")
    const already = new Set(guests.map((g) => g.name))
    return clients
      .filter((c) => !already.has(c.name) && (c.name.toLowerCase().includes(text) || (digits && c.phone.replace(/\D/g, "").includes(digits))))
      .slice(0, 6)
  }, [q, clients, guests])

  const subtotal = rows.reduce((s, r) => s + (svcById[r.serviceId]?.price ?? 0), 0)
  const money = (v: number) => `$${v.toFixed(2)}`
  // clamp against a guest just having been removed
  const activeIdx = guests.length === 0 ? 0 : Math.min(activeGuest, guests.length - 1)
  const activeName = guests[activeIdx]?.name
  const visibleRows = guests.length > 0 ? rows.filter((r) => r.person === activeName) : rows
  // every guest on the sale needs at least one *picked* service before
  // checking out -- a blank prompt row doesn't count
  const guestsMissingServices = guests.filter((g) => !rows.some((r) => r.person === g.name && r.serviceId))
  const hasBlankRow = rows.some((r) => !r.serviceId)

  // add a guest to the party and make them the active tab, same as New
  // Appointment's own guest picker -- the first guest on an otherwise-
  // anonymous sale claims whatever rows aren't assigned to anyone yet
  const attachGuest = (g: PosGuest) => {
    if (guests.some((x) => x.name === g.name)) { setQ(""); setSearching(false); return }
    setGuests((gs) => [...gs, g])
    setActiveGuest(guests.length) // the new guest lands at this index
    setPosSelected((s) => new Set([...s, g.name]))
    if (guests.length === 0) setRows((rs) => rs.map((r) => (r.person ? r : { ...r, person: g.name })))
    setQ("")
    setSearching(false)
    setNewPhone("")
  }
  const addAccountGuest = (c: ClientRecord) => attachGuest({ id: `g${Date.now()}`, clientId: c.id, name: c.name, isGuest: false })
  const addNameOnlyGuest = (name: string) => {
    const trimmed = name.trim()
    if (trimmed) attachGuest({ id: `g${Date.now()}`, name: trimmed, isGuest: true })
  }
  const createAccountGuest = () => {
    const trimmed = q.trim()
    const phone = newPhone.trim()
    if (!trimmed || !phone) return
    const c: ClientRecord = { id: `c${Date.now()}`, name: trimmed, phone, visits: 0 }
    onAddClient(c)
    attachGuest({ id: `g${Date.now()}`, clientId: c.id, name: c.name, isGuest: false })
  }
  // removing a guest drops their services with them, same as New
  // Appointment -- a blank row takes their place if that emptied the sale
  // entirely, so the panel never shows nothing to add to
  const removeGuest = (id: string, name: string) => {
    setGuests((gs) => gs.filter((x) => x.id !== id))
    setPosSelected((s) => { const n = new Set(s); n.delete(name); return n })
    setRows((rs) => {
      const next = rs.filter((r) => r.person !== name)
      return next.length > 0 ? next : [{ id: `r${Date.now()}`, serviceId: "", techId: "" }]
    })
    setActiveGuest(0)
  }
  // never let the selection go empty -- at least one payer stays on the ticket
  const toggleGuestSelected = (name: string) =>
    setPosSelected((s) => {
      if (s.size === 1 && s.has(name)) return s
      const n = new Set(s)
      if (n.has(name)) n.delete(name); else n.add(name)
      return n
    })

  const addRow = () => setRows((r) => [...r, { id: `r${Date.now()}`, serviceId: "", techId: "", person: activeName }])
  const patchRow = (id: string, patch: Partial<SaleRow>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const removeRow = (id: string) => setRows((r) => r.filter((x) => x.id !== id))

  if (step === "pay") {
    // "Paying together" can leave some of the party's rows off THIS
    // transaction, same as the regular checkout splitting a party into
    // separate tickets -- an unassigned (shared/retail) row always rides along
    const included = rows.filter((r) => !r.person || posSelected.has(r.person))
    const name = guests[0]?.name ?? "Guest sale"
    const selectedNames = guests.filter((g) => posSelected.has(g.name)).map((g) => g.name)
    // who's actually eligible for points -- selected and has a real account;
    // a name-only guest can never hold points themselves
    const pointsRecipients = selectedNames.filter((n) => clients.some((c) => c.name === n))
    const pointsRecipient = posDraft.pointsRecipient && pointsRecipients.includes(posDraft.pointsRecipient)
      ? posDraft.pointsRecipient
      : pointsRecipients[0] ?? null
    const existingPrefs = guests.flatMap((g) => {
      const c = clients.find((x) => x.name === g.name)
      return (c?.preferredTechs ?? []).flatMap((pr) => pr.categoryIds.map((categoryId) => ({ person: g.name, techId: pr.techId, categoryId })))
    })
    const lines: PaymentLine[] = included.map((r) => {
      const svc = svcById[r.serviceId]
      const tech = techs.find((t) => t.id === r.techId)
      return {
        id: r.id,
        label: svc?.name ?? r.serviceId,
        sub: tech ? `Tech: ${tech.name}` : "No tech credited",
        color: svc ? catById[svc.categoryId]?.line : undefined,
        price: svc?.price ?? 0,
        // serviceId/person/customFields feed the same per-service Color
        // field + "save as preferred tech" checkbox the regular checkout
        // shows (see the `annotate` prop below)
        serviceId: r.serviceId,
        techId: r.techId || undefined,
        person: r.person,
        customFields: r.customFields,
      }
    })
    return (
      <PaymentFlow
        title={`POS: ${name}`}
        subtitle={`${included.length} ${included.length === 1 ? "item" : "items"}`}
        lines={lines}
        onBack={() => setStep("build")}
        annotate
        onPatchLine={(id, patch) => patch.customFields && patchRow(id, { customFields: patch.customFields })}
        people={guests.map((g) => g.name)}
        selected={posSelected}
        onTogglePerson={toggleGuestSelected}
        onSelectAll={() => setPosSelected(new Set(guests.map((g) => g.name)))}
        hostName={guests[0]?.name}
        accountNames={pointsRecipients}
        pointsRecipients={pointsRecipients}
        existingPrefs={existingPrefs}
        draft={posDraft}
        onDraft={(patch) => setPosDraft((d) => ({ ...d, ...patch }))}
        onComplete={(p) => onComplete({
          ...p,
          clientName: name,
          clientNames: selectedNames.length > 0 ? selectedNames : undefined,
          party: selectedNames.length > 1 ? selectedNames.length : undefined,
          pointsRecipient,
          itemCount: included.length,
          lines: included.map((r) => ({ techId: r.techId, price: svcById[r.serviceId]?.price ?? 0, customFields: r.customFields })),
        })}
        onClose={onClose}
        loyaltyBalance={pointsRecipient ? (() => { const c = clients.find((x) => x.name === pointsRecipient); return c ? pointsByClient[c.id] ?? 0 : 0 })() : null}
      />
    )
  }

  return (
    <div className="fixed inset-y-0 right-0 z-[94] flex w-[634px] max-w-[95vw] flex-col border-l border-line bg-popover shadow-2xl">
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
        {/* guests -- same three ways to add someone as New/Edit Appointment's
            own guest picker: search an existing client, a name-only guest
            with no profile, or create a full account on the spot */}
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Guests</p>
        {guests.length > 0 && (
          // click a chip to switch whose services show below, same
          // click-to-select tabs as New Appointment's own guest chips
          <div className="mb-2 flex flex-wrap gap-2">
            {guests.map((g, i) => {
              const count = rows.filter((r) => r.person === g.name && r.serviceId).length
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setActiveGuest(i)}
                  title={`Select services for ${g.name}`}
                  className={`flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeIdx === i ? "border-clay/60 bg-clay-tint text-ink" : "border-line text-ink-faint hover:border-clay/40"
                  }`}
                >
                  {g.name}
                  {g.isGuest && <span className="rounded-full bg-cream px-1.5 text-[10px] font-semibold text-ink-faint">guest</span>}
                  <span className={`rounded-full px-1.5 text-[10px] ${count === 0 ? "bg-rust-tint text-rust" : "bg-olive-tint text-olive"}`}>
                    {count} svc
                  </span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); removeGuest(g.id, g.name) }}
                    className="hover:text-rust"
                    title={`Remove ${g.name}`}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            autoFocus={guests.length === 0}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSearching(true) }}
            onFocus={() => setSearching(true)}
            onBlur={() => setTimeout(() => setSearching(false), 150)}
            placeholder={guests.length === 0 ? "Search client, name or phone" : "Add another guest"}
            className={`${field} pl-7`}
          />
          {searching && q.trim() && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-[8px] border border-line bg-popover shadow-sh-2">
              {matches.map((c) => (
                <button key={c.id} type="button" onMouseDown={() => addAccountGuest(c)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-cream">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-clay-tint text-[9px] font-extrabold text-clay">
                    {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  <span className="text-[10px] text-ink-faint">{c.phone}</span>
                </button>
              ))}
              {/* or just a name, no profile */}
              <button type="button" onMouseDown={() => addNameOnlyGuest(q)}
                className="flex w-full items-center gap-2 border-t border-line px-2.5 py-1.5 text-left text-[12px] hover:bg-cream">
                <UserPlus className="h-3.5 w-3.5 shrink-0 text-clay" />
                <span className="min-w-0 flex-1 truncate">Add &quot;{q.trim()}&quot; as guest</span>
              </button>
              {/* or a full account for them, phone required */}
              <div className="border-t border-line p-1.5">
                <div className="flex items-center gap-1">
                  <UserPlus className="h-3.5 w-3.5 shrink-0 text-clay" />
                  <input
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder={`New account "${q.trim()}", phone`}
                    className="min-w-0 flex-1 rounded-[6px] border border-input bg-background px-1.5 py-1 text-[11px] outline-none"
                  />
                  <button type="button" disabled={!q.trim() || !newPhone.trim()} onMouseDown={createAccountGuest}
                    className="rounded-[6px] bg-clay px-2 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                    Add
                  </button>
                </div>
                <p className="mt-1 pl-5 text-[10px] text-ink-faint">phone required for an account, or use the guest option above</p>
              </div>
            </div>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-faint">
          {guests.length === 0
            ? <>No profile? Leave blank, the sale rings up as a <b>guest sale</b>.</>
            : "Add another guest, or continue with this party."}
        </p>

        {/* service rows -- scoped to whichever guest chip is active above,
            same as New Appointment's own "Services for {name}" list */}
        <div className="mb-1.5 mt-5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {activeName ? `Services for ${activeName}` : "Services"}
          </p>
          <button onClick={addRow} className="flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-bold text-clay hover:bg-clay-tint">
            <Plus className="h-3 w-3" /> Add service
          </button>
        </div>
        {visibleRows.length === 0 && (
          <p className="rounded-[10px] border border-dashed border-line py-4 text-center text-[12px] text-ink-faint">
            {activeName ? `No services yet for ${activeName}` : "No services yet"} -- add one above.
          </p>
        )}
        <div className="space-y-2">
          {visibleRows.map((r) => {
            const svc = svcById[r.serviceId]
            const qualified = techs.filter((t) => t.skills.includes(r.serviceId))
            return (
              <div key={r.id} className="flex items-center gap-1.5 rounded-[10px] border border-line p-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: svc ? catById[svc.categoryId]?.line : "#5B54D6" }} />
                <div className="min-w-0 flex-1 space-y-1">
                  <SearchSelect
                    options={orderedSvcs.map((s) => ({ value: s.id, label: s.name, sublabel: `$${s.price}`, group: serviceGroupLabel(s, categories) }))}
                    value={r.serviceId}
                    onChange={(v) => patchRow(r.id, { serviceId: v, techId: "" })}
                    placeholder="Select a service"
                    searchPlaceholder="Search services"
                    className="w-full"
                  />
                  <SearchSelect
                    options={techOptionsFor(qualified)}
                    value={r.techId}
                    onChange={(v) => patchRow(r.id, { techId: v })}
                    searchPlaceholder="Search technicians"
                    className="w-full"
                  />
                </div>
                <span className="tnum w-12 shrink-0 text-right text-[12.5px] font-semibold">{money(svc?.price ?? 0)}</span>
                <button
                  onClick={() => removeRow(r.id)}
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
        {(guestsMissingServices.length > 0 || hasBlankRow) && (
          <p className="mb-2 text-[11px] font-semibold text-rust">
            {guestsMissingServices.length > 0
              ? `Add a service for ${guestsMissingServices.map((g) => g.name).join(", ")} before checking out.`
              : "Pick a service for every line before checking out."}
          </p>
        )}
        <button
          onClick={() => setStep("pay")}
          disabled={rows.length === 0 || hasBlankRow || guestsMissingServices.length > 0}
          className="w-full rounded-xl bg-clay py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-clay-deep disabled:opacity-40"
        >
          Continue to payment →
        </button>
      </div>
    </div>
  )
}
