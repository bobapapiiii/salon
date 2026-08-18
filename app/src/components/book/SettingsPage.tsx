// ─── Settings, full-screen salon configuration ──────────────────────────────
// Sidebar sections: General, Job roles, Technicians, Services, Online booking,
// Payments, Loyalty, Notifications. Roles/techs edit as a draft with Save;
// everything else writes instantly to the salon's settings store.
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, Banknote, Bell, Briefcase, Check, CreditCard, Download, FileText, Globe, GripVertical, KeyRound, Plus, Sparkles, Star, Store, Trash2, Users, X,
} from "lucide-react";
import type { Tech } from "../../lib/booking-types";
import { roleColor, setStaff, uid, useStaffStore, type JobRole } from "../../lib/staff-store";

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
import { activeServices, orderedServices, serviceGroupLabel, setServices, svcById, useServicesStore } from "../../lib/services-store";
import { addCategory, catById, setCategories, useCategoriesStore } from "../../lib/categories-store";
import type { ServiceAddon } from "../../lib/booking-types";
import { ALL_METHODS, setSettings, useSettingsStore, type RegisterConfig, type Redemption } from "../../lib/settings-store";
import { sdata, usePersistentState } from "../../lib/persist";
import type { Appointment, Service, TechDocument, TechTimeOff, WeeklyDay } from "../../lib/booking-types";
import { DAY_SLOTS, SLOT_MIN, fmtTime } from "../../lib/booking-types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ReportsSection } from "./ReportsSection";
import { SearchSelect } from "./SearchSelect";

// ── shared bits ──────────────────────────────────────────────────────────────
const inputCls =
  "w-full rounded-lg border border-[#E3DDE3] bg-white px-2.5 py-1.5 text-[12.5px] text-slate-800 outline-none transition focus:border-[#5B54D6] focus:ring-2 focus:ring-[#5B54D6]/15";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] text-slate-400">{hint}</span>}
    </label>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function ToggleRow({ title, body, on, onClick }: { title: string; body: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-[#EDE7EE] bg-white px-3.5 py-2.5 text-left transition hover:border-[#D8D0D9]">
      <Toggle on={on} onClick={onClick} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-slate-800">{title}</span>
        <span className="block text-[10.5px] text-slate-400">{body}</span>
      </span>
    </button>
  );
}

function SectionHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[17px] font-bold text-slate-900">{title}</h2>
      <p className="text-[12px] text-slate-400">{blurb}</p>
    </div>
  );
}

const card = "rounded-xl border border-[#EDE7EE] bg-white p-4";

// ── draft model for roles + techs ────────────────────────────────────────────
interface DraftTech {
  id: string; name: string; teamId: string; phone: string; email: string; hireDate: string;
  commissionPct: number; active: boolean; loginEnabled: boolean; pin: string; isNew?: boolean;
  firstName: string; lastName: string; nickname: string; gender: string; birthday: string; endDate: string;
  bookableOnline: boolean; photoUrl: string; showPhotoOnCalendar: boolean; description: string;
  weekly: Record<number, WeeklyDay>;
  address: string; city: string; state: string; zip: string; country: string;
  documents: TechDocument[];
  timeOff: TechTimeOff[];
  serviceOverrides: Record<string, { durationMin?: number; price?: number; online?: boolean }>;
  extraSkills: string[];
  archived: boolean;
}
const newPin = () => String(Math.floor(1000 + Math.random() * 9000));

export type SectionId = "general" | "roles" | "techs" | "services" | "booking" | "payments" | "checkout" | "registers" | "loyalty" | "notifications" | "reports";

const SECTIONS: { id: SectionId; label: string; blurb: string; icon: typeof Store }[] = [
  { id: "general", label: "General", blurb: "Salon name & contact", icon: Store },
  { id: "roles", label: "Job roles", blurb: "What each role can do", icon: Briefcase },
  { id: "techs", label: "Technicians", blurb: "Roster, pay & logins", icon: Users },
  { id: "services", label: "Services", blurb: "Menu, duration & pricing", icon: Sparkles },
  { id: "booking", label: "Online booking", blurb: "Approvals & rules", icon: Globe },
  { id: "payments", label: "Payments", blurb: "Methods & tip presets", icon: CreditCard },
  { id: "checkout", label: "Checkout", blurb: "Service & invoice fields", icon: FileText },
  { id: "registers", label: "Registers", blurb: "Cash drawers to open & close", icon: Banknote },
  { id: "loyalty", label: "Loyalty", blurb: "Points earning", icon: Star },
  { id: "notifications", label: "Notifications", blurb: "SMS preferences", icon: Bell },
  { id: "reports", label: "Reports", blurb: "Sales, techs & clients", icon: BarChart3 },
];

export function SettingsPage({ open, section, onSection, onClose, focusTechId }: {
  open: boolean;
  section: SectionId;
  onSection: (id: SectionId) => void;
  onClose: () => void;
  /** deep-link from the calendar, preselect this technician */
  focusTechId?: string | null;
}) {
  const staff = useStaffStore();
  const [roles, setRoles] = useState<JobRole[] | null>(null);
  const [techs, setTechs] = useState<DraftTech[] | null>(null);
  const [selRoleId, setSelRoleId] = useState<string | null>(null);
  const [selTechId, setSelTechId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [moveToId, setMoveToId] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  // clone the staff draft when the page opens
  if (open && roles === null) {
    setRoles(staff.roles.map((r) => ({ ...r, serviceIds: [...r.serviceIds] })));
    setTechs(staff.techs.map((t) => ({
      id: t.id, name: t.name, teamId: t.teamId,
      phone: t.phone ?? "", email: t.email ?? "", hireDate: t.hireDate ?? "",
      commissionPct: t.commissionPct ?? 60, active: t.active ?? true,
      loginEnabled: t.loginEnabled ?? false, pin: t.pin ?? "",
      firstName: t.firstName ?? t.name.split(" ")[0] ?? "",
      lastName: t.lastName ?? t.name.split(" ").slice(1).join(" "),
      nickname: t.nickname ?? "", gender: t.gender ?? "", birthday: t.birthday ?? "", endDate: t.endDate ?? "",
      bookableOnline: t.bookableOnline ?? true,
      photoUrl: t.photoUrl ?? "", showPhotoOnCalendar: t.showPhotoOnCalendar ?? false,
      description: t.description ?? "",
      weekly: Object.fromEntries(Object.entries(t.weeklySchedule ?? {}).map(([k, v]) => [k, { ...v }])),
      address: t.address ?? "", city: t.city ?? "", state: t.state ?? "", zip: t.zip ?? "", country: t.country ?? "United States",
      documents: (t.documents ?? []).map((d) => ({ ...d })),
      timeOff: (t.timeOff ?? []).map((x) => ({ ...x })),
      serviceOverrides: Object.fromEntries(Object.entries(t.serviceOverrides ?? {}).map(([k, v]) => [k, { ...v }])),
      extraSkills: [...(t.extraSkills ?? [])],
      archived: t.archived ?? false,
    })));
    setSelRoleId(staff.roles[0]?.id ?? null);
    setSelTechId(focusTechId ?? staff.techs[0]?.id ?? null);
    setConfirmDeleteId(null);
  }

  // deep-link from the calendar while settings is already open: follow the tech
  useEffect(() => {
    if (open && focusTechId) setSelTechId(focusTechId);
  }, [open, focusTechId]);

  const techCountByRole = useMemo(() => {
    const m = new Map<string, number>();
    (techs ?? []).forEach((t) => m.set(t.teamId, (m.get(t.teamId) ?? 0) + 1));
    return m;
  }, [techs]);

  if (!open || !roles || !techs) return null;

  const selRole = roles.find((r) => r.id === selRoleId) ?? roles[0];
  const selTech = techs.find((t) => t.id === selTechId) ?? techs[0];

  // ── roles draft actions ──
  const patchRole = (id: string, patch: Partial<JobRole>) => setRoles(roles.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const toggleSvc = (roleId: string, svcId: string) => {
    const r = roles.find((x) => x.id === roleId);
    if (!r) return;
    const has = r.serviceIds.includes(svcId);
    patchRole(roleId, { serviceIds: has ? r.serviceIds.filter((x) => x !== svcId) : [...r.serviceIds, svcId] });
  };
  const addRole = () => {
    const r: JobRole = { id: uid("role"), name: "New role", serviceIds: [] };
    setRoles([...roles, r]);
    setSelRoleId(r.id);
  };
  const deleteRole = (id: string) => {
    if (roles.length <= 1) return;
    setMoveToId(roles.find((r) => r.id !== id)?.id ?? "");
    setConfirmDeleteId(id);
  };
  const confirmDeleteRole = () => {
    if (!confirmDeleteId) return;
    if ((techCountByRole.get(confirmDeleteId) ?? 0) > 0) {
      if (!moveToId) return;
      setTechs(techs.map((t) => (t.teamId === confirmDeleteId ? { ...t, teamId: moveToId } : t)));
    }
    const next = roles.filter((r) => r.id !== confirmDeleteId);
    setRoles(next);
    if (selRoleId === confirmDeleteId) setSelRoleId(next[0]?.id ?? null);
    setConfirmDeleteId(null);
  };

  // ── tech draft actions ──
  const patchTech = (id: string, patch: Partial<DraftTech>) => setTechs(techs.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const addTech = () => {
    const roleId = selRole?.id ?? roles[0]?.id;
    if (!roleId) return;
    const t: DraftTech = {
      id: uid("tech"), name: "", teamId: roleId, phone: "", email: "", hireDate: "",
      commissionPct: 60, active: true, loginEnabled: false, pin: "", isNew: true,
      firstName: "", lastName: "", nickname: "", gender: "", birthday: "", endDate: "",
      bookableOnline: true, photoUrl: "", showPhotoOnCalendar: false, description: "",
      weekly: {}, address: "", city: "", state: "", zip: "", country: "United States", documents: [], timeOff: [],
      serviceOverrides: {},
      extraSkills: [],
      archived: false,
    };
    setTechs([...techs, t]);
    setSelTechId(t.id);
  };

  const saveStaff = () => {
    const finalRoles = roles.map((r) => ({ ...r, name: r.name.trim() || "Untitled role" }));
    const roleIds = new Set(finalRoles.map((r) => r.id));
    const fallback = finalRoles[0]?.id ?? "";
    setStaff((s) => {
      const existing = new Map(s.techs.map((t) => [t.id, t]));
      const nextTechs: Tech[] = techs
        .filter((t) => `${t.firstName.trim()} ${t.lastName.trim()}`.trim() !== "" || t.name.trim() !== "")
        .map((t) => {
          const teamId = roleIds.has(t.teamId) ? t.teamId : fallback;
          const fullName = `${t.firstName.trim()} ${t.lastName.trim()}`.trim() || t.name.trim();
          const prev = existing.get(t.id);
          const details = {
            phone: t.phone.trim() || undefined,
            email: t.email.trim() || undefined,
            hireDate: t.hireDate || undefined,
            endDate: t.endDate || undefined,
            commissionPct: t.commissionPct,
            active: t.active,
            loginEnabled: t.loginEnabled,
            pin: t.loginEnabled ? t.pin || newPin() : undefined,
            firstName: t.firstName.trim() || undefined,
            lastName: t.lastName.trim() || undefined,
            nickname: t.nickname.trim() || undefined,
            gender: (t.gender || undefined) as Tech["gender"],
            birthday: t.birthday || undefined,
            bookableOnline: t.bookableOnline,
            photoUrl: t.photoUrl || undefined,
            showPhotoOnCalendar: t.showPhotoOnCalendar,
            description: t.description.trim() || undefined,
            weeklySchedule: Object.keys(t.weekly).length > 0 ? t.weekly : undefined,
            address: t.address.trim() || undefined,
            city: t.city.trim() || undefined,
            state: t.state.trim() || undefined,
            zip: t.zip.trim() || undefined,
            country: t.country.trim() || undefined,
            documents: t.documents.length > 0 ? t.documents : undefined,
            timeOff: t.timeOff.length > 0 ? t.timeOff : undefined,
            serviceOverrides: Object.keys(t.serviceOverrides).length > 0 ? t.serviceOverrides : undefined,
            extraSkills: t.extraSkills.length > 0 ? t.extraSkills : undefined,
            archived: t.archived || (t.endDate !== "" && t.endDate <= todayKey()) || undefined,
          };
          if (prev) return { ...prev, name: fullName, teamId, ...details };
          return {
            id: t.id, name: fullName,
            initials: fullName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
            teamId, skills: [], ...details,
          };
        });
      return { roles: finalRoles, techs: nextTechs };
    });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  const close = () => {
    setRoles(null);
    setTechs(null);
    setConfirmDeleteId(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[96] flex bg-[#FAF8FA]">
      {/* sidebar */}
      <div className="flex w-60 shrink-0 flex-col border-r border-[#EDE7EE] bg-white">
        <div className="flex items-center justify-between border-b border-[#EDE7EE] px-4 py-4">
          <h1 className="text-[16px] font-bold text-slate-900">Settings</h1>
          <button onClick={close} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[#F4F0F5] hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5">
          {SECTIONS.map(({ id, label, blurb, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onSection(id)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition ${
                section === id ? "bg-[#5B54D6]/[0.07] text-[#5B54D6]" : "text-slate-600 hover:bg-[#F4F0F5]"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{label}</span>
                <span className={`block truncate text-[10px] ${section === id ? "text-[#5B54D6]/70" : "text-slate-400"}`}>{blurb}</span>
              </span>
            </button>
          ))}
        </nav>
        {(section === "roles" || section === "techs") && (
          <div className="border-t border-[#EDE7EE] p-3">
            <button
              onClick={saveStaff}
              className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-semibold text-white transition ${
                savedFlash ? "bg-emerald-600" : "bg-[#5B54D6] hover:bg-[#4C46C4]"
              }`}
            >
              {savedFlash ? (<><Check className="h-3.5 w-3.5" /> Saved</>) : "Save team changes"}
            </button>
          </div>
        )}
      </div>

      {/* content */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-10 py-7">
          {section === "general" && <GeneralSection />}
          {section === "roles" && (
            <RolesSection
              roles={roles} techCountByRole={techCountByRole} selRole={selRole}
              onSelectRole={setSelRoleId} onAddRole={addRole} onDeleteRole={deleteRole}
              onPatchRole={patchRole} onToggleSvc={toggleSvc}
            />
          )}
          {section === "techs" && (
            <TechsSection
              techs={techs} roles={roles} selTech={selTech}
              onSelectTech={setSelTechId} onAddTech={addTech} onPatchTech={patchTech}
              onDeleteTech={(id) => {
                const next = techs.filter((t) => t.id !== id);
                setTechs(next);
                if (selTechId === id) setSelTechId(next.find((t) => !t.archived)?.id ?? next[0]?.id ?? null);
              }}
            />
          )}
          {section === "services" && <ServicesSection />}
          {section === "booking" && <BookingSection />}
          {section === "payments" && <PaymentsSection />}
          {section === "checkout" && <CheckoutSection />}
          {section === "registers" && <RegistersSection />}
          {section === "loyalty" && <LoyaltySection />}
          {section === "notifications" && <NotificationsSection />}
          {section === "reports" && <ReportsSection />}
        </div>
      </div>

      {/* delete-role confirmation */}
      {confirmDeleteId && (() => {
        const count = techCountByRole.get(confirmDeleteId) ?? 0;
        return (
          <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-[400px] rounded-2xl bg-white p-5 shadow-2xl">
              <h3 className="text-[15px] font-bold text-slate-900">Delete &ldquo;{roles.find((r) => r.id === confirmDeleteId)?.name}&rdquo;?</h3>
              {count > 0 ? (
                <>
                  <p className="mt-1.5 text-[12.5px] leading-5 text-slate-500">
                    {count} {count === 1 ? "tech is" : "techs are"} in this role. Choose where they move, their bookable services will follow the new role.
                  </p>
                  <select value={moveToId} onChange={(e) => setMoveToId(e.target.value)} className={`${inputCls} mt-3`}>
                    {roles.filter((r) => r.id !== confirmDeleteId).map((r) => (
                      <option key={r.id} value={r.id}>Move to: {r.name}</option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="mt-1.5 text-[12.5px] leading-5 text-slate-500">This role has no technicians. Deleting it can&rsquo;t be undone.</p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setConfirmDeleteId(null)} className="rounded-xl px-4 py-2 text-[13px] font-semibold text-slate-500 transition hover:bg-[#F4F0F5]">Back</button>
                <button
                  onClick={confirmDeleteRole}
                  disabled={count > 0 && !moveToId}
                  className="rounded-xl bg-rose-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-rose-600 disabled:opacity-40"
                >
                  {count > 0 ? "Move techs & delete" : "Delete role"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── General ─────────────────────────────────────────────────────────────────
function GeneralSection() {
  const s = useSettingsStore();
  const g = s.general;
  const patch = (p: Partial<typeof g>) => setSettings((x) => ({ ...x, general: { ...x.general, ...p } }));
  const [holidayDraft, setHolidayDraft] = useState({ date: "", label: "" });
  const [confirmHolidayId, setConfirmHolidayId] = useState<string | null>(null);

  const DOWS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const fmtAbs = (m: number) => {
    const h = Math.floor(m / 60);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const TIME_OPTS = Array.from({ length: (23 * 60 - 6 * 60) / 30 + 1 }, (_, i) => 6 * 60 + i * 30);

  return (
    <div>
      <SectionHead title="General" blurb="Your salon's identity, shown across the app, receipts, and online booking" />
      <div className={`${card} grid grid-cols-2 gap-4`}>
        <Field label="Salon name"><input value={g.name} onChange={(e) => patch({ name: e.target.value })} className={inputCls} /></Field>
        <Field label="Phone"><input value={g.phone} onChange={(e) => patch({ phone: e.target.value })} className={inputCls} /></Field>
        <Field label="Email"><input value={g.email} onChange={(e) => patch({ email: e.target.value })} className={inputCls} /></Field>
        <Field label="Website"><input value={g.website} onChange={(e) => patch({ website: e.target.value })} className={inputCls} /></Field>
        <div className="col-span-2">
          <Field label="Address"><input value={g.address} onChange={(e) => patch({ address: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="col-span-2">
          <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Time display</span>
          <div className="flex gap-1.5">
            {(["12h", "24h"] as const).map((f) => (
              <button
                key={f}
                onClick={() => patch({ clockFormat: f })}
                className={`h-9 flex-1 rounded-lg border text-[12px] font-bold transition ${
                  g.clockFormat === f ? "border-[#5B54D6] bg-[#5B54D6]/[0.07] text-[#5B54D6]" : "border-[#EDE7EE] text-slate-500 hover:border-[#D8D0D9]"
                }`}
              >
                {f === "12h" ? "12-hour (2:30 PM)" : "24-hour (14:30)"}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10.5px] text-slate-400">Applies everywhere: calendar gutter, cards, booking, checkout</p>
        </div>
      </div>

      {/* operating hours */}
      <div className={`${card} mt-3`}>
        <p className="text-[12px] font-bold text-slate-800">Operating hours</p>
        <p className="mb-3 mt-0.5 text-[10.5px] text-slate-400">Days off here close the calendar and online booking for that weekday.</p>
        <div className="space-y-1.5">
          {DOWS.map((name, dow) => {
            const h = g.weekHours?.[dow] ?? {};
            const off = h.off ?? false;
            const setDay = (p: Partial<typeof h>) => patch({ weekHours: { ...(g.weekHours ?? {}), [dow]: { ...h, ...p } } });
            return (
              <div key={dow} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-[12.5px] font-semibold text-slate-700">{name}</span>
                <Toggle on={!off} onClick={() => setDay({ off: !off })} />
                {off ? (
                  <span className="text-[12px] text-slate-400">Closed</span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <select
                      value={h.open ?? 480}
                      onChange={(e) => setDay({ open: Number(e.target.value) })}
                      className="tnum h-8 rounded-lg border border-[#E3DDE3] bg-white px-2 text-[12px] font-semibold outline-none focus:border-[#5B54D6]"
                    >
                      {TIME_OPTS.filter((m) => m < (h.close ?? 1200)).map((m) => <option key={m} value={m}>{fmtAbs(m)}</option>)}
                    </select>
                    <span className="text-[11px] text-slate-400">to</span>
                    <select
                      value={h.close ?? 1200}
                      onChange={(e) => setDay({ close: Number(e.target.value) })}
                      className="tnum h-8 rounded-lg border border-[#E3DDE3] bg-white px-2 text-[12px] font-semibold outline-none focus:border-[#5B54D6]"
                    >
                      {TIME_OPTS.filter((m) => m > (h.open ?? 480)).map((m) => <option key={m} value={m}>{fmtAbs(m)}</option>)}
                    </select>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* holidays / salon-wide closures */}
      <div className={`${card} mt-3`}>
        <p className="text-[12px] font-bold text-slate-800">Days off & holidays</p>
        <p className="mb-3 mt-0.5 text-[10.5px] text-slate-400">Specific dates the salon is closed, the calendar and online booking turn off for the day.</p>
        <div className="space-y-1.5">
          {(g.holidays ?? []).map((h) => (
            <div key={h.id} className="flex items-center gap-2 rounded-lg border border-[#EDE7EE] px-3 py-1.5">
              <span className="tnum w-24 shrink-0 text-[12px] font-semibold text-slate-700">
                {new Date(h.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-slate-500">{h.label}</span>
              <button
                onClick={() => setConfirmHolidayId(h.id)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                title={`Remove ${h.label}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {(g.holidays ?? []).length === 0 && <p className="text-[11px] text-slate-400">No closures scheduled.</p>}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="date"
              value={holidayDraft.date}
              onChange={(e) => setHolidayDraft((d) => ({ ...d, date: e.target.value }))}
              className="h-9 rounded-lg border border-[#E3DDE3] bg-white px-2 text-[12px] outline-none focus:border-[#5B54D6]"
            />
            <input
              value={holidayDraft.label}
              onChange={(e) => setHolidayDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="Reason, e.g. July 4th"
              className="h-9 min-w-0 flex-1 rounded-lg border border-[#E3DDE3] bg-white px-2.5 text-[12px] outline-none focus:border-[#5B54D6]"
            />
            <button
              onClick={() => {
                if (!holidayDraft.date || !holidayDraft.label.trim()) return;
                patch({ holidays: [...(g.holidays ?? []), { id: uid("hol"), date: holidayDraft.date, label: holidayDraft.label.trim() }] });
                setHolidayDraft({ date: "", label: "" });
              }}
              disabled={!holidayDraft.date || !holidayDraft.label.trim()}
              className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-[#5B54D6] px-3 text-[12px] font-bold text-white transition hover:bg-[#4A45C4] disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Add day off
            </button>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-slate-400">Saves automatically as you type.</p>
      {confirmHolidayId && (
        <ConfirmDialog
          title="Remove this day off?"
          body="The salon becomes bookable on that date again."
          confirmLabel="Remove"
          onConfirm={() => {
            patch({ holidays: (g.holidays ?? []).filter((h) => h.id !== confirmHolidayId) });
            setConfirmHolidayId(null);
          }}
          onClose={() => setConfirmHolidayId(null)}
        />
      )}
    </div>
  );
}

// ─── Job roles ───────────────────────────────────────────────────────────────
function RolesSection({ roles, techCountByRole, selRole, onSelectRole, onAddRole, onDeleteRole, onPatchRole, onToggleSvc }: {
  roles: JobRole[];
  techCountByRole: Map<string, number>;
  selRole: JobRole | undefined;
  onSelectRole: (id: string) => void;
  onAddRole: () => void;
  onDeleteRole: (id: string) => void;
  onPatchRole: (id: string, patch: Partial<JobRole>) => void;
  onToggleSvc: (roleId: string, svcId: string) => void;
}) {
  const services = useServicesStore();
  const cats = useCategoriesStore();
  const svcGroups = cats.map((c) => ({ cat: c, svcs: activeServices(services).filter((s) => s.categoryId === c.id) }));
  return (
    <div>
      <SectionHead title="Job roles" blurb="Roles decide which services a tech can perform, drag the chips on the calendar to reorder them" />
      <div className="flex gap-4">
        <div className="w-[220px] shrink-0 space-y-1.5">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelectRole(r.id)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                selRole?.id === r.id ? "border-[#5B54D6] bg-[#5B54D6]/[0.05]" : "border-[#EDE7EE] bg-white hover:border-[#D8D0D9]"
              }`}
            >
              <p className="truncate text-[13px] font-semibold text-slate-800">{r.name}</p>
              <p className="mt-0.5 text-[10.5px] text-slate-400">{r.serviceIds.length} services · {techCountByRole.get(r.id) ?? 0} techs</p>
            </button>
          ))}
          <button
            onClick={onAddRole}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#D8D0D9] px-3 py-2.5 text-[12px] font-semibold text-slate-500 transition hover:border-[#5B54D6] hover:text-[#5B54D6]"
          >
            <Plus className="h-3.5 w-3.5" /> New role
          </button>
        </div>

        {selRole ? (
          <div className={`${card} min-w-0 flex-1`}>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Field label="Role name"><input value={selRole.name} onChange={(e) => onPatchRole(selRole.id, { name: e.target.value })} className={inputCls} /></Field>
              </div>
              <button
                onClick={() => onDeleteRole(selRole.id)}
                disabled={roles.length <= 1}
                title={roles.length <= 1 ? "Keep at least one role" : (techCountByRole.get(selRole.id) ?? 0) > 0 ? "Move its techs to another role, then delete" : "Delete role"}
                className="flex h-[34px] items-center gap-1.5 rounded-lg border border-[#EDE7EE] px-3 text-[12px] font-semibold text-rose-500 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
            <p className="mb-2 mt-4 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
              Services this role can perform · {selRole.serviceIds.length}
            </p>
            <div className="space-y-3">
              {svcGroups.map(({ cat, svcs }) => (
                <div key={cat.id}>
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                    <span className="h-2 w-2 rounded-full" style={{ background: cat.line }} /> {cat.name}
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {svcs.map((s) => {
                      const on = selRole.serviceIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          onClick={() => onToggleSvc(selRole.id, s.id)}
                          className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition ${
                            on ? "border-[#5B54D6]/40 bg-[#5B54D6]/[0.06] font-semibold text-slate-800" : "border-[#EDE7EE] text-slate-500 hover:border-[#D8D0D9]"
                          }`}
                        >
                          <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-[#5B54D6] bg-[#5B54D6] text-white" : "border-[#CFC7D0]"}`}>
                            {on && <Check className="h-2.5 w-2.5" />}
                          </span>
                          <span className="truncate">{s.name}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-slate-400">{s.durationMin}m</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[12.5px] text-slate-400">Create a role to get started</div>
        )}
      </div>
    </div>
  );
}

// ─── Technicians ─────────────────────────────────────────────────────────────
function TechsSection({ techs, roles, selTech, onSelectTech, onAddTech, onPatchTech, onDeleteTech }: {
  techs: DraftTech[];
  roles: JobRole[];
  selTech: DraftTech | undefined;
  onSelectTech: (id: string) => void;
  onAddTech: () => void;
  onPatchTech: (id: string, patch: Partial<DraftTech>) => void;
  onDeleteTech: (id: string) => void;
}) {
  const [arcOpen, setArcOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const isArc = (t: DraftTech) => t.archived || (t.endDate !== "" && t.endDate <= todayKey());
  const activeList = [...techs].filter((t) => !isArc(t)).sort((a, b) => (`${a.firstName} ${a.lastName}`.trim() || a.name).localeCompare(`${b.firstName} ${b.lastName}`.trim() || b.name));
  const archivedList = [...techs].filter(isArc).sort((a, b) => (`${a.firstName} ${a.lastName}`.trim() || a.name).localeCompare(`${b.firstName} ${b.lastName}`.trim() || b.name));
  const DAY_MIN = DAY_SLOTS * SLOT_MIN;
  const TIME_OPTS = Array.from({ length: DAY_SLOTS + 1 }, (_, i) => i * SLOT_MIN);
  const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Mon to Sun
  const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const [tab, setTab] = useState<"profile" | "services">("profile");

  const uploadPhoto = (file: File | undefined, id: string) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        onPatchTech(id, { photoUrl: canvas.toDataURL("image/jpeg", 0.85) });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <SectionHead title="Technicians" blurb="Profiles, employment, weekly schedule, and portal logins, bookable services come from each tech's role" />
      <div className="flex gap-4">
        <div className="w-[210px] shrink-0 space-y-1 overflow-y-auto">
          <button
            onClick={onAddTech}
            className="mb-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#5B54D6] px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-[#4C46C4]"
          >
            <Plus className="h-3.5 w-3.5" /> Add technician
          </button>
          {activeList.map((t) => {
            const dot = roleColor(roles, t.teamId);
            const display = `${t.firstName} ${t.lastName}`.trim() || t.name || "New tech";
            const initials = display !== "New tech" ? display.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() : "?";
            return (
              <button
                key={t.id}
                onClick={() => onSelectTech(t.id)}
                className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                  selTech?.id === t.id ? "border-[#5B54D6] bg-[#5B54D6]/[0.05]" : "border-[#EDE7EE] bg-white hover:border-[#D8D0D9]"
                }`}
              >
                {t.photoUrl ? (
                  <img src={t.photoUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: dot }}>{initials}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-slate-800">{display}</span>
                  <span className="block truncate text-[10px] text-slate-400">{roles.find((r) => r.id === t.teamId)?.name}</span>
                </span>
                {t.loginEnabled && <KeyRound className="h-3 w-3 shrink-0 text-[#5B54D6]" />}
                {!t.active && <span className="shrink-0 rounded-full bg-slate-200 px-1.5 text-[9px] font-bold text-slate-500">off</span>}
              </button>
            );
          })}

          {/* archived, ended employment lands here automatically */}
          {archivedList.length > 0 && (
            <div className="mt-3 border-t border-[#EDE7EE] pt-2">
              <button
                onClick={() => setArcOpen((o) => !o)}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-400 transition hover:bg-[#F4F0F5] hover:text-slate-600"
              >
                <span className={`transition-transform ${arcOpen ? "rotate-180" : ""}`}>▾</span>
                Archived ({archivedList.length})
              </button>
              {arcOpen && archivedList.map((t) => {
                const display = `${t.firstName} ${t.lastName}`.trim() || t.name;
                return (
                  <div key={t.id} className="mb-1 flex items-center gap-2 rounded-xl border border-[#EDE7EE] bg-slate-50 px-2.5 py-2 opacity-80">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[10px] font-bold text-white">
                      {display.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-slate-500">{display}</span>
                      <span className="block truncate text-[9.5px] text-slate-400">
                        {t.endDate ? `ended ${t.endDate}` : "archived"}
                      </span>
                    </span>
                    <button
                      onClick={() => onPatchTech(t.id, { archived: false, endDate: "" })}
                      title="Restore to the active roster"
                      className="shrink-0 rounded-md border border-emerald-600/30 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => setDeleteId(t.id)}
                      title="Delete permanently"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* permanent delete confirmation */}
          {deleteId && (
            <ConfirmDialog
              title={`Delete ${(() => { const t = techs.find((x) => x.id === deleteId); return t ? `${t.firstName} ${t.lastName}`.trim() || t.name : "tech"; })()} permanently?`}
              body="Her past appointments will show as Unassigned. Tip: archiving keeps her name on history, delete only if you're sure."
              confirmLabel="Delete permanently"
              onConfirm={() => { onDeleteTech(deleteId); }}
              onClose={() => setDeleteId(null)}
            />
          )}
        </div>

        {selTech ? (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="mb-3 flex shrink-0 gap-1 border-b border-[#EDE7EE]">
              {(["profile", "services"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] font-semibold transition ${
                    tab === t ? "border-[#5B54D6] text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {t === "profile" ? "Profile" : "Services & pricing"}
                </button>
              ))}
            </div>
            {tab === "profile" ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {/* photo + identity */}
            <div className={card}>
              <div className="flex items-start gap-4">
                <div className="shrink-0 text-center">
                  {selTech.photoUrl ? (
                    <img src={selTech.photoUrl} alt="Profile" className="h-16 w-16 rounded-full border border-[#EDE7EE] object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-[#D8D0D9] text-[10px] font-bold text-slate-400">
                      No photo
                    </span>
                  )}
                  <label className="mt-1.5 block cursor-pointer text-[11px] font-semibold text-[#5B54D6] hover:underline">
                    {selTech.photoUrl ? "Change" : "Upload"}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(e.target.files?.[0], selTech.id)} />
                  </label>
                  {selTech.photoUrl && (
                    <button onClick={() => onPatchTech(selTech.id, { photoUrl: "", showPhotoOnCalendar: false })} className="mt-0.5 text-[10px] text-slate-400 hover:text-rose-500">
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                  <Field label="First name"><input value={selTech.firstName} onChange={(e) => onPatchTech(selTech.id, { firstName: e.target.value })} className={inputCls} /></Field>
                  <Field label="Last name"><input value={selTech.lastName} onChange={(e) => onPatchTech(selTech.id, { lastName: e.target.value })} className={inputCls} /></Field>
                  <Field label="Nickname" hint="Shown to clients">
                    <input value={selTech.nickname} onChange={(e) => onPatchTech(selTech.id, { nickname: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Gender">
                    <select value={selTech.gender} onChange={(e) => onPatchTech(selTech.id, { gender: e.target.value })} className={inputCls}>
                      <option value="">Not set</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label="Birthday"><input type="date" value={selTech.birthday} onChange={(e) => onPatchTech(selTech.id, { birthday: e.target.value })} className={inputCls} /></Field>
                </div>
              </div>
              {selTech.photoUrl && (
                <div className="mt-3">
                  <ToggleRow
                    title="Show photo on the calendar"
                    body="Her picture appears in her column header"
                    on={selTech.showPhotoOnCalendar}
                    onClick={() => onPatchTech(selTech.id, { showPhotoOnCalendar: !selTech.showPhotoOnCalendar })}
                  />
                </div>
              )}
            </div>

            {/* employment */}
            <div className={card}>
              <p className="mb-2.5 text-[12px] font-bold text-slate-800">Employment</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Job role">
                  <select value={selTech.teamId} onChange={(e) => onPatchTech(selTech.id, { teamId: e.target.value })} className={inputCls}>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
                <Field label="Commission %">
                  <input
                    type="number" min={0} max={100} value={selTech.commissionPct}
                    onChange={(e) => onPatchTech(selTech.id, { commissionPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Employment started"><input type="date" value={selTech.hireDate} onChange={(e) => onPatchTech(selTech.id, { hireDate: e.target.value })} className={inputCls} /></Field>
                <Field label="Employment ended"><input type="date" value={selTech.endDate} onChange={(e) => onPatchTech(selTech.id, { endDate: e.target.value })} className={inputCls} /></Field>
                <Field label="Phone"><input value={selTech.phone} onChange={(e) => onPatchTech(selTech.id, { phone: e.target.value })} placeholder="(555) 000-0000" className={inputCls} /></Field>
                <Field label="Email"><input type="email" value={selTech.email} onChange={(e) => onPatchTech(selTech.id, { email: e.target.value })} placeholder="tech@email.com" className={inputCls} /></Field>
              </div>
              <div className="mt-3 space-y-2.5">
                <ToggleRow title="Active" body="Inactive techs stay on the roster but off the board" on={selTech.active} onClick={() => onPatchTech(selTech.id, { active: !selTech.active })} />
                <ToggleRow title="Bookable online" body="Clients can pick this tech on the online booking page" on={selTech.bookableOnline} onClick={() => onPatchTech(selTech.id, { bookableOnline: !selTech.bookableOnline })} />
              </div>
            </div>

            {/* address */}
            <div className={card}>
              <p className="mb-2.5 text-[12px] font-bold text-slate-800">Address</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Field label="Street address"><input value={selTech.address} onChange={(e) => onPatchTech(selTech.id, { address: e.target.value })} placeholder="123 Blossom Ave, Apt 2" className={inputCls} /></Field>
                </div>
                <Field label="City"><input value={selTech.city} onChange={(e) => onPatchTech(selTech.id, { city: e.target.value })} className={inputCls} /></Field>
                <Field label="State"><input value={selTech.state} onChange={(e) => onPatchTech(selTech.id, { state: e.target.value })} className={inputCls} /></Field>
                <Field label="Zip code"><input value={selTech.zip} onChange={(e) => onPatchTech(selTech.id, { zip: e.target.value })} className={inputCls} /></Field>
                <Field label="Country"><input value={selTech.country} onChange={(e) => onPatchTech(selTech.id, { country: e.target.value })} className={inputCls} /></Field>
              </div>
            </div>

            {/* documents */}
            <DocumentsCard selTech={selTech} onPatchTech={onPatchTech} />

            {/* online booking profile */}
            <div className={card}>
              <p className="mb-2.5 text-[12px] font-bold text-slate-800">Online booking profile</p>
              <Field label="Description" hint="Shown under her name and photo on the booking page">
                <textarea
                  value={selTech.description}
                  onChange={(e) => onPatchTech(selTech.id, { description: e.target.value })}
                  rows={3}
                  placeholder="e.g. 10 years of Japanese gel artistry, loves minimalist sets and hand-painted florals."
                  className={`${inputCls} resize-none`}
                />
              </Field>
            </div>

            {/* permanent weekly schedule */}
            <div className={card}>
              <p className="text-[12px] font-bold text-slate-800">Permanent weekly schedule</p>
              <p className="mb-2.5 text-[10.5px] text-slate-400">Her normal week, the calendar defaults to this; the Schedule panel can override single days</p>
              <div className="space-y-1">
                {WEEK.map((d) => {
                  const w = selTech.weekly[d] ?? {};
                  const off = w.off === true;
                  return (
                    <div key={d} className="flex items-center gap-2 rounded-lg border border-[#EDE7EE] px-2.5 py-1.5">
                      <span className="w-10 shrink-0 text-[12px] font-bold text-slate-700">{DAY_LABEL[d]}</span>
                      <button
                        onClick={() => onPatchTech(selTech.id, { weekly: { ...selTech.weekly, [d]: { ...w, off: !off } } })}
                        className={`h-6 w-14 shrink-0 rounded-md text-[10.5px] font-bold transition ${
                          off ? "bg-slate-200 text-slate-500" : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {off ? "Off" : "Works"}
                      </button>
                      {!off && (
                        <>
                          <select
                            value={w.startMin ?? 0}
                            onChange={(e) => onPatchTech(selTech.id, { weekly: { ...selTech.weekly, [d]: { ...w, startMin: Number(e.target.value) } } })}
                            className={`${inputCls} w-[86px]`}
                          >
                            {TIME_OPTS.slice(0, -1).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
                          </select>
                          <span className="text-[10.5px] font-bold text-slate-400">to</span>
                          <select
                            value={w.endMin ?? DAY_MIN}
                            onChange={(e) => onPatchTech(selTech.id, { weekly: { ...selTech.weekly, [d]: { ...w, endMin: Number(e.target.value) } } })}
                            className={`${inputCls} w-[86px]`}
                          >
                            {TIME_OPTS.slice(1).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
                          </select>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* temporary time off */}
            <TimeOffCard selTech={selTech} onPatchTech={onPatchTech} />

            {/* danger zone */}
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
              <p className="text-[12px] font-bold text-rose-600">Danger zone</p>
              <p className="mb-2.5 text-[10.5px] text-rose-400">Archiving removes her from the board but keeps her history. Takes effect on Save.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => onPatchTech(selTech.id, { archived: true, endDate: selTech.endDate || todayKey() })}
                  disabled={selTech.archived}
                  className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-40"
                >
                  {selTech.archived ? "Archived, will move below on Save" : "Archive tech"}
                </button>
                <button
                  onClick={() => setDeleteId(selTech.id)}
                  className="rounded-lg border border-rose-300 bg-rose-600 px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-rose-700"
                >
                  Delete permanently
                </button>
              </div>
            </div>

            {/* portal login */}
            <div className={card}>
              <ToggleRow
                title="Portal login"
                body="Tech signs in to see their appointments, reports & tips"
                on={selTech.loginEnabled}
                onClick={() => onPatchTech(selTech.id, { loginEnabled: !selTech.loginEnabled, pin: selTech.pin || newPin() })}
              />
              {selTech.loginEnabled && (
                <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-[#5B54D6]/30 bg-[#5B54D6]/[0.04] px-3.5 py-2.5">
                  <KeyRound className="h-4 w-4 shrink-0 text-[#5B54D6]" />
                  <span className="text-[11.5px] text-slate-500">Sign-in PIN</span>
                  <input
                    value={selTech.pin}
                    onChange={(e) => onPatchTech(selTech.id, { pin: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                    className="tnum w-16 rounded-lg border border-[#E3DDE3] bg-white px-2 py-1 text-center text-[13px] font-bold tracking-widest outline-none focus:border-[#5B54D6]"
                  />
                  <button onClick={() => onPatchTech(selTech.id, { pin: newPin() })} className="text-[11px] font-semibold text-[#5B54D6] hover:underline">Regenerate</button>
                </div>
              )}
            </div>
          </div>
            ) : (
              <ServiceOverridesEditor selTech={selTech} roles={roles} onPatchTech={onPatchTech} />
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[12.5px] text-slate-400">Add a technician to get started</div>
        )}
      </div>
    </div>
  );
}

// ─── Services ────────────────────────────────────────────────────────────────
const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180];

/** number input that stays exactly what you typed while focused instead of
 *  snapping to 0 (and re-formatting) on every keystroke — it only clamps
 *  and commits on blur / Enter, so clearing a field and typing a fresh
 *  value never leaves a stray leading digit behind */
function NumberField({ value, onCommit, min = 0, step, className }: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  step?: number;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Math.max(min, Number(text) || 0);
    setText(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={className}
    />
  );
}

function ServicesSection() {
  const services = useServicesStore();
  const cats = useCategoriesStore();
  const [apptDays] = usePersistentState<Record<string, Appointment[]>>(sdata("appts-v2"), {});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);
  const [addonsFor, setAddonsFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dragCatId, setDragCatId] = useState<string | null>(null);
  const [overCatId, setOverCatId] = useState<string | null>(null);
  const [archOpen, setArchOpen] = useState(false);

  const usedIds = useMemo(
    () => new Set(Object.values(apptDays).flat().map((a) => a.serviceId)),
    [apptDays],
  );

  const patch = (id: string, p: Partial<Service>) =>
    setServices((list) => list.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const addService = (categoryId: string) =>
    setServices((list) => [
      ...list,
      {
        id: `svc-${Math.random().toString(36).slice(2, 8)}`,
        name: "New service",
        short: "New",
        durationMin: 45,
        price: 30,
        categoryId,
      } as Service & { active?: boolean },
    ]);

  const deleteService = (id: string) => setServices((list) => list.filter((s) => s.id !== id));

  const renameCategory = (id: string, name: string) =>
    setCategories((list) => list.map((c) => (c.id === id ? { ...c, name } : c)));

  /** archive a category (and, for a top-level one, its subcategories) along
   *  with every service inside it. Nothing is removed from storage -- every
   *  appointment that already references it, past or already booked, keeps
   *  resolving its name/color/price exactly as before. It just disappears
   *  from booking menus and this list until it's restored. */
  const archiveCategory = (id: string) => {
    const ids = [id, ...cats.filter((c) => c.parentId === id).map((c) => c.id)];
    setCategories((list) => list.map((c) => (ids.includes(c.id) ? { ...c, archived: true } : c)));
    setServices((list) => list.map((s) => (ids.includes(s.categoryId) ? { ...s, active: false } : s)));
  };

  /** bring a category back -- for a top-level one, its subcategories too,
   *  and their services. Restoring a lone subcategory also un-archives its
   *  parent (just the category record, not the parent's own services) so
   *  it has a card to sit in again. */
  const restoreCategory = (id: string) => {
    const target = cats.find((c) => c.id === id);
    const ids = [id, ...cats.filter((c) => c.parentId === id).map((c) => c.id)];
    setCategories((list) => list.map((c) => (ids.includes(c.id) || c.id === target?.parentId ? { ...c, archived: false } : c)));
    setServices((list) => list.map((s) => (ids.includes(s.categoryId) ? { ...s, active: true } : s)));
  };

  /** actually remove a category (and, for a top-level one, its
   *  subcategories) and every service inside it. Only ever offered once
   *  it's empty or already archived with nothing still in use. */
  const permanentlyDeleteCategory = (id: string) => {
    const ids = [id, ...cats.filter((c) => c.parentId === id).map((c) => c.id)];
    setServices((list) => list.filter((s) => !ids.includes(s.categoryId)));
    setCategories((list) => list.filter((c) => !ids.includes(c.id)));
  };

  const patchAddons = (svcId: string, addons: ServiceAddon[]) => patch(svcId, { addons } as Partial<Service>);

  /** drag a service to a new spot -- dropping it onto another row inserts it
   *  right before that row (and moves it into that row's category if it's
   *  not already there); `beforeId: null` drops it at the end of
   *  `targetCategoryId`'s group instead. This is how both plain reordering
   *  and dragging a service into a subcategory are handled, they're the
   *  same operation, one just also changes categoryId. */
  const moveServiceTo = (draggedId: string, targetCategoryId: string, beforeId: string | null) =>
    setServices((list) => {
      const dragged = list.find((s) => s.id === draggedId);
      if (!dragged) return list;
      const rest = list.filter((s) => s.id !== draggedId);
      const moved = dragged.categoryId === targetCategoryId ? dragged : { ...dragged, categoryId: targetCategoryId };
      let insertAt: number;
      if (beforeId) {
        insertAt = rest.findIndex((s) => s.id === beforeId);
        if (insertAt === -1) insertAt = rest.length;
      } else {
        const groupItems = rest.filter((s) => s.categoryId === targetCategoryId);
        const last = groupItems[groupItems.length - 1];
        insertAt = last ? rest.findIndex((s) => s.id === last.id) + 1 : rest.length;
      }
      const next = [...rest];
      next.splice(insertAt, 0, moved);
      return next;
    });

  /** drag a subcategory to reorder it among its own siblings (same parent
   *  category); dropping it onto another subcategory inserts it right
   *  before that one, `beforeId: null` drops it at the end. Re-parenting a
   *  subcategory to a different top-level category isn't supported here. */
  const moveCategoryTo = (draggedId: string, parentId: string, beforeId: string | null) =>
    setCategories((list) => {
      const dragged = list.find((c) => c.id === draggedId);
      if (!dragged || dragged.parentId !== parentId) return list;
      const rest = list.filter((c) => c.id !== draggedId);
      let insertAt: number;
      if (beforeId) {
        insertAt = rest.findIndex((c) => c.id === beforeId);
        if (insertAt === -1) return list;
      } else {
        const siblings = rest.filter((c) => c.parentId === parentId);
        const last = siblings[siblings.length - 1];
        insertAt = last ? rest.findIndex((c) => c.id === last.id) + 1 : rest.length;
      }
      const next = [...rest];
      next.splice(insertAt, 0, dragged);
      return next;
    });

  // flat list for the "move to category" picker, subcategories indented
  // under their parent so the hierarchy still reads at a glance
  const catOptions = useMemo(() => {
    const top = cats.filter((c) => !c.parentId && !c.archived);
    return top.flatMap((t) => [
      { id: t.id, label: t.name },
      ...cats.filter((c) => c.parentId === t.id && !c.archived).map((s) => ({ id: s.id, label: `— ${s.name}` })),
    ]);
  }, [cats]);

  const renderServiceRow = (sv: Service) => {
    const active = (sv as Service & { active?: boolean }).active !== false;
    const inUse = usedIds.has(sv.id);
    const addons = sv.addons ?? [];
    const addonsOpen = addonsFor === sv.id;
    const dropBefore = dragId && dragId !== sv.id && overId === sv.id;
    return (
      <div
        key={sv.id}
        onDragOver={(e) => {
          if (!dragId || dragId === sv.id) return;
          e.preventDefault();
          if (overId !== sv.id) setOverId(sv.id);
        }}
        onDragLeave={() => setOverId((o) => (o === sv.id ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dragId && dragId !== sv.id) moveServiceTo(dragId, sv.categoryId, sv.id);
          setDragId(null);
          setOverId(null);
        }}
      >
        <div
          className={`svc-row flex items-center gap-2 rounded-lg border border-[#EDE7EE] px-2.5 py-1.5 transition-[opacity,box-shadow] duration-150 ${active ? "bg-white" : "bg-slate-50 opacity-60"} ${dragId === sv.id ? "opacity-40" : ""} ${dropBefore ? "shadow-[0_-2px_0_0_#5B54D6]" : ""}`}
        >
          <span
            draggable
            onDragStart={(e) => {
              setDragId(sv.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", sv.id);
              // drag the actual row as the ghost image instead of the tiny
              // grip icon, and anchor it under the cursor where it was
              // grabbed so it doesn't jump when the drag starts
              const row = (e.currentTarget as HTMLElement).closest(".svc-row") as HTMLElement | null;
              if (row) {
                const r = row.getBoundingClientRect();
                e.dataTransfer.setDragImage(row, e.clientX - r.left, e.clientY - r.top);
              }
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            title="Drag to reorder"
            className="shrink-0 cursor-grab text-slate-300 transition hover:text-slate-500 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <input
            value={sv.name}
            onChange={(e) => patch(sv.id, { name: e.target.value })}
            className="min-w-0 flex-[2] rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] font-semibold text-slate-800 outline-none transition focus:border-[#5B54D6] focus:bg-white"
          />
          <input
            value={sv.short}
            onChange={(e) => patch(sv.id, { short: e.target.value })}
            title="Short label for tight calendar cells"
            className="min-w-0 w-20 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[11.5px] text-slate-500 outline-none transition focus:border-[#5B54D6] focus:bg-white"
          />
          <select
            value={sv.categoryId}
            onChange={(e) => patch(sv.id, { categoryId: e.target.value })}
            title="Move to a different category"
            className="w-[132px] shrink-0 rounded-md border border-[#E3DDE3] bg-white px-1.5 py-1 text-[11.5px] outline-none focus:border-[#5B54D6]"
          >
            {catOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select
            value={sv.durationMin}
            onChange={(e) => patch(sv.id, { durationMin: Number(e.target.value) })}
            className="w-[86px] rounded-md border border-[#E3DDE3] bg-white px-1.5 py-1 text-[11.5px] outline-none focus:border-[#5B54D6]"
          >
            {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
          </select>
          <span className="flex items-center text-[12px] font-semibold text-slate-600">
            $<NumberField
              value={sv.price}
              onCommit={(n) => patch(sv.id, { price: n })}
              className="tnum w-14 rounded-md border border-[#E3DDE3] bg-white px-1 py-1 text-right outline-none focus:border-[#5B54D6]"
            />
          </span>
          <button
            onClick={() => setAddonsFor(addonsOpen ? null : sv.id)}
            title="Add-ons, extra time & money offered with this service"
            className={`shrink-0 rounded-md px-1.5 py-1 text-[10.5px] font-bold transition ${
              addonsOpen || addons.length > 0 ? "bg-[#5B54D6]/[0.08] text-[#5B54D6]" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {addons.length > 0 ? `${addons.length} add-on${addons.length > 1 ? "s" : ""}` : "+ add-on"}
          </button>
          <span title={active ? "Active, bookable" : "Inactive, hidden from menus"}>
            <Toggle on={active} onClick={() => patch(sv.id, { active: !active } as Partial<Service>)} />
          </span>
          <button
            onClick={() => !inUse && setDeleteId(sv.id)}
            disabled={inUse}
            title={inUse ? "Used by appointments, deactivate instead" : "Delete service"}
            className="shrink-0 text-slate-300 transition hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {addonsOpen && (
          <div className="ml-6 mt-1 space-y-1 rounded-lg border border-[#EDE7EE] bg-[#FAF8FA] p-2">
            {addons.length === 0 && <p className="px-1 py-1 text-[11px] text-slate-400">No add-ons yet, they add time and price on top of {sv.name}.</p>}
            {addons.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5">
                <input
                  value={a.name}
                  onChange={(e) => patchAddons(sv.id, addons.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))}
                  placeholder="Add-on name"
                  className="min-w-0 flex-1 rounded-md border border-[#E3DDE3] bg-white px-1.5 py-1 text-[11.5px] outline-none focus:border-[#5B54D6]"
                />
                <span className="flex items-center gap-0.5 text-[10.5px] font-semibold text-slate-500">
                  +<NumberField
                    value={a.mins}
                    step={5}
                    onCommit={(n) => patchAddons(sv.id, addons.map((x) => (x.id === a.id ? { ...x, mins: n } : x)))}
                    className="tnum w-12 rounded-md border border-[#E3DDE3] bg-white px-1 py-1 text-right outline-none focus:border-[#5B54D6]"
                  />m
                </span>
                <span className="flex items-center gap-0.5 text-[10.5px] font-semibold text-slate-500">
                  +$<NumberField
                    value={a.price}
                    onCommit={(n) => patchAddons(sv.id, addons.map((x) => (x.id === a.id ? { ...x, price: n } : x)))}
                    className="tnum w-12 rounded-md border border-[#E3DDE3] bg-white px-1 py-1 text-right outline-none focus:border-[#5B54D6]"
                  />
                </span>
                <button
                  onClick={() => patchAddons(sv.id, addons.filter((x) => x.id !== a.id))}
                  className="shrink-0 text-slate-300 transition hover:text-rose-500"
                  title="Remove add-on"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              onClick={() => patchAddons(sv.id, [...addons, { id: `ao-${Math.random().toString(36).slice(2, 8)}`, name: "", mins: 15, price: 10 }])}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-[#5B54D6] transition hover:bg-[#5B54D6]/[0.07]"
            >
              <Plus className="h-3 w-3" /> Add add-on
            </button>
          </div>
        )}
      </div>
    );
  };

  /** strip below a group's last row (or the whole group, if it's empty) —
   *  dropping a dragged service here sends it to the end of that
   *  category/subcategory, moving it in if it wasn't already there */
  const renderTrailingDrop = (categoryId: string, empty: boolean) => (
    <div
      onDragOver={(e) => {
        if (!dragId) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragId) moveServiceTo(dragId, categoryId, null);
        setDragId(null);
        setOverId(null);
      }}
      className={empty
        ? "flex h-9 items-center justify-center rounded-lg border border-dashed border-[#E3DDE3] text-[10.5px] text-slate-300"
        : "h-2"}
    >
      {empty && "Drop a service here"}
    </div>
  );

  const topCats = cats.filter((c) => !c.parentId && !c.archived);
  const draggedCat = dragCatId ? cats.find((c) => c.id === dragCatId) : undefined;

  return (
    <div>
      <SectionHead title="Services" blurb="Your menu, prices and durations update everywhere instantly, including the legend and checkout" />
      <div className="mb-3 flex justify-end">
        <button
          onClick={() => addCategory("New category")}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#D8D0D9] px-3 py-1.5 text-[12px] font-semibold text-slate-500 transition hover:border-[#5B54D6] hover:text-[#5B54D6]"
        >
          <Plus className="h-3.5 w-3.5" /> Add category
        </button>
      </div>
      {/* column labels for every service row below -- lined up with that row's
          own widths/gaps (card p-4 + row px-2.5 = 26px left/right inset) so
          each label sits directly above its field */}
      <div className="mb-1.5 flex items-center gap-2 pl-[26px] pr-[26px] text-[10px] font-bold uppercase tracking-wide text-slate-400">
        <span className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-[2]">Service name</span>
        <span className="min-w-0 w-20" title="Short label for tight calendar cells">Short label</span>
        <span className="w-[132px] shrink-0">Category</span>
        <span className="w-[86px] shrink-0">Duration</span>
        <span className="w-16 shrink-0 text-right">Price</span>
        <span className="w-16 shrink-0 text-center">Add-ons</span>
        <span className="w-9 shrink-0 text-center">Active</span>
        <span className="h-3.5 w-3.5 shrink-0" />
      </div>
      <div className="space-y-4">
        {topCats.map((cat) => {
          const svcs = services.filter((s) => s.categoryId === cat.id);
          const subCats = cats.filter((c) => c.parentId === cat.id && !c.archived);
          return (
            <div key={cat.id} className={card}>
              <div className="mb-2.5 flex items-center gap-2">
                <label
                  title="Category color, updates the calendar rail and legend instantly"
                  className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-[#EDE7EE]"
                  style={{ background: cat.line }}
                >
                  <input
                    type="color"
                    value={cat.line.startsWith('#') ? cat.line : '#5B54D6'}
                    onChange={(e) => setCategories((list) =>
                      list.map((c) => (c.id === cat.id ? { ...c, line: e.target.value, fill: `${e.target.value}26`, text: e.target.value } : c)),
                    )}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
                <input
                  value={cat.name}
                  onChange={(e) => renameCategory(cat.id, e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-bold text-slate-800 outline-none transition focus:border-[#5B54D6] focus:bg-white"
                />
                <span className="text-[10.5px] text-slate-400">{svcs.length} services</span>
                <button
                  onClick={() => setDeleteCatId(cat.id)}
                  title="Delete or archive category"
                  className="shrink-0 text-slate-300 transition hover:text-rose-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => addService(cat.id)}
                  className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[#5B54D6] transition hover:bg-[#5B54D6]/[0.07]"
                >
                  <Plus className="h-3 w-3" /> Add service
                </button>
              </div>
              <div className="space-y-1.5">
                {svcs.map((sv) => renderServiceRow(sv))}
                {renderTrailingDrop(cat.id, svcs.length === 0)}
              </div>

              {subCats.map((sub) => {
                const subSvcs = services.filter((s) => s.categoryId === sub.id);
                const catDropBefore = dragCatId && dragCatId !== sub.id && overCatId === sub.id;
                return (
                  <div
                    key={sub.id}
                    onDragOver={(e) => {
                      // a subcategory drag reorders siblings; a service drag
                      // dropped anywhere in here (header, padding, empty
                      // space) still moves the service into this subcategory
                      if (dragCatId && dragCatId !== sub.id && draggedCat?.parentId === cat.id) {
                        e.preventDefault();
                        if (overCatId !== sub.id) setOverCatId(sub.id);
                      } else if (dragId) {
                        e.preventDefault();
                      }
                    }}
                    onDragLeave={() => setOverCatId((o) => (o === sub.id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragCatId && dragCatId !== sub.id && draggedCat?.parentId === cat.id) moveCategoryTo(dragCatId, cat.id, sub.id);
                      else if (dragId) moveServiceTo(dragId, sub.id, null);
                      setDragCatId(null);
                      setOverCatId(null);
                      setDragId(null);
                      setOverId(null);
                    }}
                    className={`mt-3 ml-3 border-l-2 pl-3 transition-colors ${
                      catDropBefore ? "border-[#5B54D6]" : "border-[#EDE7EE]"
                    } ${dragCatId === sub.id ? "opacity-40" : ""}`}
                  >
                    <div className="subcat-header mb-2 flex items-center gap-2">
                      <span
                        draggable
                        onDragStart={(e) => {
                          setDragCatId(sub.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", sub.id);
                          const header = (e.currentTarget as HTMLElement).closest(".subcat-header") as HTMLElement | null;
                          if (header) {
                            const r = header.getBoundingClientRect();
                            e.dataTransfer.setDragImage(header, e.clientX - r.left, e.clientY - r.top);
                          }
                        }}
                        onDragEnd={() => {
                          setDragCatId(null);
                          setOverCatId(null);
                        }}
                        title="Drag to reorder"
                        className="shrink-0 cursor-grab text-slate-300 transition hover:text-slate-500 active:cursor-grabbing"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>
                      <label
                        title="Subcategory color, updates the calendar rail and legend instantly"
                        className="relative h-5 w-5 shrink-0 cursor-pointer overflow-hidden rounded-md border border-[#EDE7EE]"
                        style={{ background: sub.line }}
                      >
                        <input
                          type="color"
                          value={sub.line.startsWith('#') ? sub.line : '#5B54D6'}
                          onChange={(e) => setCategories((list) =>
                            list.map((c) => (c.id === sub.id ? { ...c, line: e.target.value, fill: `${e.target.value}26`, text: e.target.value } : c)),
                          )}
                          className="absolute inset-0 cursor-pointer opacity-0"
                        />
                      </label>
                      <input
                        value={sub.name}
                        onChange={(e) => renameCategory(sub.id, e.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[12px] font-bold text-slate-700 outline-none transition focus:border-[#5B54D6] focus:bg-white"
                      />
                      <span className="text-[10.5px] text-slate-400">{subSvcs.length} services</span>
                      <button
                        onClick={() => setDeleteCatId(sub.id)}
                        title="Delete or archive subcategory"
                        className="shrink-0 text-slate-300 transition hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => addService(sub.id)}
                        className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[#5B54D6] transition hover:bg-[#5B54D6]/[0.07]"
                      >
                        <Plus className="h-3 w-3" /> Add service
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {subSvcs.map((sv) => renderServiceRow(sv))}
                      {renderTrailingDrop(sub.id, subSvcs.length === 0)}
                    </div>
                  </div>
                );
              })}
              {subCats.length > 0 && (
                <div
                  onDragOver={(e) => { if (dragCatId && draggedCat?.parentId === cat.id) e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragCatId && draggedCat?.parentId === cat.id) moveCategoryTo(dragCatId, cat.id, null);
                    setDragCatId(null);
                    setOverCatId(null);
                  }}
                  className="h-2"
                />
              )}

              <button
                onClick={() => addCategory("New subcategory", cat.id)}
                className="mt-3 flex items-center gap-1 text-[11.5px] font-semibold text-[#5B54D6]/80 transition hover:text-[#5B54D6]"
              >
                <Plus className="h-3 w-3" /> Add subcategory
              </button>
            </div>
          );
        })}
      </div>

      {(() => {
        const archivedCats = cats.filter((c) => c.archived);
        if (archivedCats.length === 0) return null;
        return (
          <div className="mt-4 border-t border-[#EDE7EE] pt-3">
            <button
              onClick={() => setArchOpen((o) => !o)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-400 transition hover:bg-[#F4F0F5] hover:text-slate-600"
            >
              <span className={`transition-transform ${archOpen ? "rotate-180" : ""}`}>▾</span>
              Archived categories ({archivedCats.length})
            </button>
            {archOpen && (
              <div className="mt-1.5 space-y-1.5">
                {archivedCats.map((c) => {
                  const ids = [c.id, ...cats.filter((x) => x.parentId === c.id).map((x) => x.id)];
                  const count = services.filter((s) => ids.includes(s.categoryId)).length;
                  const stillUsed = services.some((s) => ids.includes(s.categoryId) && usedIds.has(s.id));
                  const parentName = c.parentId ? catById[c.parentId]?.name : undefined;
                  return (
                    <div key={c.id} className="flex items-center gap-2 rounded-lg border border-[#EDE7EE] bg-slate-50 px-2.5 py-2 opacity-80">
                      <span className="h-4 w-4 shrink-0 rounded-md border border-[#EDE7EE]" style={{ background: c.line }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-slate-500">{c.name}</span>
                        <span className="block truncate text-[9.5px] text-slate-400">
                          {parentName ? `subcategory of ${parentName} · ` : ""}{count} service{count === 1 ? "" : "s"}
                        </span>
                      </span>
                      <button
                        onClick={() => restoreCategory(c.id)}
                        title="Restore to the active menu"
                        className="shrink-0 rounded-md border border-emerald-600/30 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => !stillUsed && permanentlyDeleteCategory(c.id)}
                        disabled={stillUsed}
                        title={stillUsed ? "Still used by an appointment, can't permanently delete" : "Delete permanently"}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {deleteCatId && (() => {
        const target = catById[deleteCatId];
        const ids = [deleteCatId, ...cats.filter((c) => c.parentId === deleteCatId).map((c) => c.id)];
        const count = services.filter((s) => ids.includes(s.categoryId)).length;
        const willArchive = count > 0;
        return (
          <ConfirmDialog
            title={willArchive ? `Archive "${target?.name ?? "category"}"?` : `Delete "${target?.name ?? "category"}"?`}
            body={willArchive
              ? `This has ${count} service${count === 1 ? "" : "s"} in it. Archiving hides it from booking and from this list, but every appointment that already uses one of its services -- past or upcoming -- keeps showing it exactly as before. Restore it any time from Archived categories below.`
              : "This can't be undone."}
            confirmLabel={willArchive ? "Archive category" : "Delete category"}
            onConfirm={() => (willArchive ? archiveCategory(deleteCatId) : permanentlyDeleteCategory(deleteCatId))}
            onClose={() => setDeleteCatId(null)}
          />
        );
      })()}

      {deleteId && (
        <ConfirmDialog
          title={`Delete "${svcById[deleteId]?.name ?? "service"}"?`}
          body="This can't be undone. Services used by appointments can't be deleted."
          confirmLabel="Delete service"
          onConfirm={() => deleteService(deleteId)}
          onClose={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

// ─── Online booking ──────────────────────────────────────────────────────────
function BookingSection() {
  const s = useSettingsStore();
  const b = s.booking;
  const patch = (p: Partial<typeof b>) => setSettings((x) => ({ ...x, booking: { ...x.booking, ...p } }));
  return (
    <div>
      <SectionHead title="Online booking" blurb="Rules for the client-facing booking page" />
      <div className="space-y-3">
        <div className={card}>
          <p className="mb-2 text-[12px] font-bold text-slate-800">New online requests</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => patch({ autoConfirm: false })}
              className={`h-9 flex-1 rounded-lg border text-[12px] font-bold transition ${!b.autoConfirm ? "border-[#5B54D6] bg-[#5B54D6]/[0.07] text-[#5B54D6]" : "border-[#EDE7EE] text-slate-500 hover:border-[#D8D0D9]"}`}
            >
              Require approval
            </button>
            <button
              onClick={() => patch({ autoConfirm: true })}
              className={`h-9 flex-1 rounded-lg border text-[12px] font-bold transition ${b.autoConfirm ? "border-[#5B54D6] bg-[#5B54D6]/[0.07] text-[#5B54D6]" : "border-[#EDE7EE] text-slate-500 hover:border-[#D8D0D9]"}`}
            >
              Auto-confirm
            </button>
          </div>
          <p className="mt-2 text-[10.5px] text-slate-400">
            {b.autoConfirm
              ? "Online bookings land on the calendar instantly."
              : "Online bookings wait in the Requests queue for the front desk."}
          </p>
        </div>

        <div className={`${card} grid grid-cols-2 gap-4`}>
          <Field label="Minimum lead time (hours)" hint="Clients can't book sooner than this">
            <input type="number" min={0} value={b.minLeadHrs} onChange={(e) => patch({ minLeadHrs: Math.max(0, Number(e.target.value) || 0) })} className={inputCls} />
          </Field>
          <Field label="Book up to (days ahead)" hint="How far out clients can see availability">
            <input type="number" min={1} value={b.maxDaysOut} onChange={(e) => patch({ maxDaysOut: Math.max(1, Number(e.target.value) || 1) })} className={inputCls} />
          </Field>
        </div>

        <ToggleRow
          title="Let clients pick a technician"
          body="Off, every online booking is assigned to the least-booked qualified tech"
          on={b.allowTechChoice}
          onClick={() => patch({ allowTechChoice: !b.allowTechChoice })}
        />
        <ToggleRow
          title="Allow same-time services online"
          body="Mani + pedi at the same time with two techs"
          on={b.allowSameTime}
          onClick={() => patch({ allowSameTime: !b.allowSameTime })}
        />
        <ToggleRow
          title="Allow overlapping appointments (staff)"
          body="The calendar lets two appointments share one tech at the same time"
          on={b.allowOverlap}
          onClick={() => patch({ allowOverlap: !b.allowOverlap })}
        />
        <ToggleRow
          title="Auto-move non-requested appointments to make room"
          body="When a new booking, an edit, or a drag pins an appointment to a specific technician and she already has a non-requested appointment in that slot, automatically move that other appointment to the next least-booked qualified tech instead of double-booking her. Requested-by-name appointments are never bumped. Turn this off to always ask before double-booking instead."
          on={b.autoRelocateNonRequested}
          onClick={() => patch({ autoRelocateNonRequested: !b.autoRelocateNonRequested })}
        />
        <div className={card}>
          <p className="mb-2 text-[12px] font-bold text-slate-800">Time increments</p>
          <div className="flex gap-1.5">
            {([15, 30, 60] as const).map((v) => (
              <button
                key={v}
                onClick={() => patch({ increment: v })}
                className={`h-9 flex-1 rounded-lg border text-[12px] font-bold transition ${
                  b.increment === v ? "border-[#5B54D6] bg-[#5B54D6]/[0.07] text-[#5B54D6]" : "border-[#EDE7EE] text-slate-500 hover:border-[#D8D0D9]"
                }`}
              >
                {v === 60 ? "Hourly" : `${v} min`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-slate-400">Start-time steps when booking and editing appointments</p>
        </div>

        <ToggleRow
          title="Warn before double booking"
          body="Ask for confirmation whenever an appointment would overlap another, drags, edits, new bookings, and queue drops"
          on={b.warnOnDoubleBook}
          onClick={() => patch({ warnOnDoubleBook: !b.warnOnDoubleBook })}
        />
        <ToggleRow
          title="Show no-shows on the calendar"
          body="No-show appointments stay on the board so staff can see the gap they leave. Turn this off to hide them from the calendar (they're still recorded and counted in reports)"
          on={b.showNoShows}
          onClick={() => patch({ showNoShows: !b.showNoShows })}
        />
      </div>
    </div>
  );
}

// ─── Payments ────────────────────────────────────────────────────────────────
function PaymentsSection() {
  const s = useSettingsStore();
  const pay = s.payments;
  const patch = (p: Partial<typeof pay>) => setSettings((x) => ({ ...x, payments: { ...x.payments, ...p } }));
  return (
    <div>
      <SectionHead title="Payments" blurb="What shows at checkout and POS" />
      <div className={card}>
        <p className="mb-2 text-[12px] font-bold text-slate-800">Accepted methods</p>
        <div className="grid grid-cols-4 gap-1.5">
          {ALL_METHODS.map((m) => {
            const on = pay.methods.includes(m);
            return (
              <button
                key={m}
                onClick={() => patch({ methods: on ? pay.methods.filter((x) => x !== m) : [...pay.methods, m] })}
                disabled={on && pay.methods.length === 1}
                title={on && pay.methods.length === 1 ? "Keep at least one method" : undefined}
                className={`h-9 rounded-lg border text-[12px] font-bold transition disabled:opacity-40 ${
                  on ? "border-[#5B54D6] bg-[#5B54D6]/[0.07] text-[#5B54D6]" : "border-[#EDE7EE] text-slate-400 hover:border-[#D8D0D9]"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`${card} mt-3`}>
        <p className="mb-2 text-[12px] font-bold text-slate-800">Tip presets (%)</p>
        <div className="flex gap-1.5">
          {pay.tipPresets.map((t, i) => (
            <input
              key={i}
              type="number" min={0} max={100} value={t}
              onChange={(e) => {
                const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                patch({ tipPresets: pay.tipPresets.map((x, j) => (j === i ? v : x)) });
              }}
              className="tnum h-9 w-16 rounded-lg border border-[#E3DDE3] bg-white px-2 text-center text-[12.5px] font-bold outline-none focus:border-[#5B54D6]"
            />
          ))}
        </div>
        <p className="mt-2 text-[10.5px] text-slate-400">0 shows as &ldquo;None&rdquo; at checkout. Guests can always enter a custom amount.</p>
      </div>
    </div>
  );
}

// ─── Checkout fields ─────────────────────────────────────────────────────────
function CheckoutSection() {
  const s = useSettingsStore();
  const co = s.checkout;
  const [confirmRemove, setConfirmRemove] = useState<{ scope: "serviceFields" | "generalFields"; id: string; label: string } | null>(null);
  const patch = (p: Partial<typeof co>) => setSettings((x) => ({ ...x, checkout: { ...x.checkout, ...p } }));

  const fieldList = (scope: "serviceFields" | "generalFields", title: string, body: string) => (
    <div className={`${card} mt-3`}>
      <p className="text-[12px] font-bold text-slate-800">{title}</p>
      <p className="mb-3 mt-0.5 text-[10.5px] text-slate-400">{body}</p>
      <div className="space-y-1.5">
        {co[scope].map((f) => (
          <div key={f.id} className="flex items-center gap-2">
            <input
              value={f.label}
              onChange={(e) => patch({ [scope]: co[scope].map((x) => (x.id === f.id ? { ...x, label: e.target.value } : x)) } as Partial<typeof co>)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-[#E3DDE3] bg-white px-2.5 text-[12.5px] font-semibold outline-none focus:border-[#5B54D6]"
            />
            <button
              onClick={() => setConfirmRemove({ scope, id: f.id, label: f.label })}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500"
              title={`Remove ${f.label}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {co[scope].length === 0 && <p className="text-[11px] text-slate-400">No fields yet.</p>}
        <button
          onClick={() => patch({ [scope]: [...co[scope], { id: uid("f"), label: scope === "serviceFields" ? "New service field" : "New invoice field" }] } as Partial<typeof co>)}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#D8D0D9] px-3 py-1.5 text-[12px] font-bold text-slate-500 transition hover:border-[#5B54D6] hover:text-[#5B54D6]"
        >
          <Plus className="h-3.5 w-3.5" /> Add field
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <SectionHead title="Checkout fields" blurb="Extra notation your team fills in at checkout" />
      {fieldList("serviceFields", "Per-service fields", "Shown on every service line at checkout, saved on the appointment. Color is the default, add things like Design, Shape, or Length.")}
      {fieldList("generalFields", "General invoice fields", "Shown once per ticket next to the note, saved with the sale.")}

      <div className={`${card} mt-3`}>
        <p className="text-[12px] font-bold text-slate-800">Job card paper width</p>
        <p className="mb-3 mt-0.5 text-[10.5px] text-slate-400">
          Roll width on your receipt printer (Epson TM-T30III or similar). Job cards are laid out to fit it.
        </p>
        <div className="flex gap-2">
          {([80, 58] as const).map((w) => (
            <button
              key={w}
              onClick={() => setSettings((x) => ({ ...x, jobCard: { ...x.jobCard, width: w } }))}
              className={`h-9 rounded-lg border px-3.5 text-[12.5px] font-bold transition ${
                s.jobCard.width === w
                  ? "border-[#5B54D6] bg-[#5B54D6]/10 text-[#5B54D6]"
                  : "border-[#E3DDE3] bg-white text-slate-500 hover:border-[#5B54D6]"
              }`}
            >
              {w}mm{w === 80 ? " (standard)" : " (narrow)"}
            </button>
          ))}
        </div>
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title={`Remove "${confirmRemove.label}"?`}
          body="The field stops showing at checkout. Values already saved on past appointments are kept."
          confirmLabel="Remove field"
          onConfirm={() => {
            patch({ [confirmRemove.scope]: co[confirmRemove.scope].filter((x) => x.id !== confirmRemove.id) } as Partial<typeof co>);
            setConfirmRemove(null);
          }}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

// ─── Registers ───────────────────────────────────────────────────────────────
function RegistersSection() {
  const s = useSettingsStore();
  const regs = s.registers;
  const activeCount = regs.filter((r) => r.active).length;
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);
  const patch = (id: string, p: Partial<RegisterConfig>) =>
    setSettings((x) => ({ ...x, registers: x.registers.map((r) => (r.id === id ? { ...r, ...p } : r)) }));

  return (
    <div>
      <SectionHead title="Registers" blurb="Cash drawers your team opens and closes each day" />
      <div className={card}>
        <p className="mb-0.5 text-[12px] font-bold text-slate-800">Cash registers</p>
        <p className="mb-3 text-[10.5px] text-slate-400">
          Each register keeps its own opening float, shift totals, and close-out history. Signing in for the day
          asks which one is in use when there is more than one active.
        </p>
        <div className="space-y-1.5">
          {regs.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <input
                value={r.name}
                onChange={(e) => patch(r.id, { name: e.target.value })}
                className="h-9 min-w-0 flex-1 rounded-lg border border-[#E3DDE3] bg-white px-2.5 text-[12.5px] font-semibold outline-none focus:border-[#5B54D6]"
              />
              <span title={r.active ? "Active, shows in the daily picker" : "Inactive, hidden from the daily picker"}>
                <Toggle
                  on={r.active}
                  onClick={() => {
                    if (r.active && activeCount === 1) return;
                    patch(r.id, { active: !r.active });
                  }}
                />
              </span>
              <button
                onClick={() => setConfirmRemove({ id: r.id, name: r.name })}
                disabled={r.active && activeCount === 1}
                title={r.active && activeCount === 1 ? "Keep at least one active register" : `Remove ${r.name}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {regs.length === 0 && <p className="text-[11px] text-slate-400">No registers yet.</p>}
        </div>
        <button
          onClick={() =>
            setSettings((x) => ({
              ...x,
              registers: [...x.registers, { id: uid("reg"), name: `Register ${x.registers.length + 1}`, active: true }],
            }))
          }
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-[#D8D0D9] px-3 py-1.5 text-[12px] font-bold text-slate-500 transition hover:border-[#5B54D6] hover:text-[#5B54D6]"
        >
          <Plus className="h-3.5 w-3.5" /> Add register
        </button>
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title={`Remove "${confirmRemove.name}"?`}
          body="It drops off the daily register picker. Any shifts already opened and closed on it stay in Manage Register's history."
          confirmLabel="Remove register"
          onConfirm={() => {
            setSettings((x) => ({ ...x, registers: x.registers.filter((r) => r.id !== confirmRemove.id) }));
            setConfirmRemove(null);
          }}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

// ─── Loyalty ─────────────────────────────────────────────────────────────────
function LoyaltySection() {
  const s = useSettingsStore();
  const services = useServicesStore();
  const cats = useCategoriesStore();
  const l = s.loyalty;
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const patchR = (id: string, p: Partial<Redemption>) =>
    setSettings((x) => ({ ...x, loyalty: { ...x.loyalty, redemptions: x.loyalty.redemptions.map((r) => (r.id === id ? { ...r, ...p } : r)) } }));

  const addRedemption = () =>
    setSettings((x) => ({
      ...x,
      loyalty: {
        ...x.loyalty,
        redemptions: [
          ...x.loyalty.redemptions,
          { id: `r-${Math.random().toString(36).slice(2, 8)}`, name: "", pointsCost: 500, type: "amount", value: 5, active: true },
        ],
      },
    }));

  const typeLabel = (r: Redemption) =>
    r.type === "amount" ? `$${r.value} off` : r.type === "percent" ? `${r.value}% off` : `Free ${svcById[r.serviceId ?? ""]?.name ?? "service"}`;

  return (
    <div>
      <SectionHead title="Loyalty" blurb="How clients earn points, and what they can redeem them for" />

      {/* earn rate */}
      <div className={card}>
        <p className="mb-2 text-[12px] font-bold text-slate-800">Earning</p>
        <Field label="Points per $1 spent" hint={`A $85 ticket earns ${Math.floor(85 * l.pointsPerDollar)} pts. Points never accrue on tips.`}>
          <input
            type="number" min={0} step={0.5} value={l.pointsPerDollar}
            onChange={(e) => setSettings((x) => ({ ...x, loyalty: { ...x.loyalty, pointsPerDollar: Math.max(0, Number(e.target.value) || 0) } }))}
            className={`${inputCls} w-32`}
          />
        </Field>
      </div>

      {/* redemptions */}
      <div className={`${card} mt-3`}>
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <p className="text-[12px] font-bold text-slate-800">Redemptions</p>
            <p className="text-[10.5px] text-slate-400">Rewards clients can cash points against at checkout</p>
          </div>
          <button onClick={addRedemption} className="flex items-center gap-1 rounded-lg bg-[#5B54D6] px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-[#4C46C4]">
            <Plus className="h-3 w-3" /> Add redemption
          </button>
        </div>

        <div className="space-y-1.5">
          {l.redemptions.length === 0 && (
            <p className="rounded-lg border border-dashed border-[#D8D0D9] px-3 py-3 text-center text-[11px] text-slate-400">No redemptions yet</p>
          )}
          {l.redemptions.map((r) => (
            <div key={r.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 ${r.active ? "border-[#EDE7EE] bg-white" : "border-[#EDE7EE] bg-slate-50 opacity-60"}`}>
              <input
                value={r.name}
                placeholder="Reward name"
                onChange={(e) => patchR(r.id, { name: e.target.value })}
                className="min-w-0 flex-[2] rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] font-semibold text-slate-800 outline-none transition focus:border-[#5B54D6] focus:bg-white"
              />
              <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <input
                  type="number" min={0} value={r.pointsCost}
                  onChange={(e) => patchR(r.id, { pointsCost: Math.max(0, Number(e.target.value) || 0) })}
                  className="tnum w-[72px] rounded-md border border-[#E3DDE3] bg-white px-1.5 py-1 text-right outline-none focus:border-[#5B54D6]"
                />
                pts
              </span>
              <span className="text-slate-300">=</span>
              <select
                value={r.type}
                onChange={(e) => patchR(r.id, { type: e.target.value as Redemption["type"] })}
                className="rounded-md border border-[#E3DDE3] bg-white px-1.5 py-1 text-[11.5px] outline-none focus:border-[#5B54D6]"
              >
                <option value="amount">$ off</option>
                <option value="percent">% off</option>
                <option value="freeService">Free service</option>
              </select>
              {r.type === "amount" && (
                <span className="flex items-center text-[11px] font-semibold text-slate-500">
                  $<input
                    type="number" min={0} value={r.value}
                    onChange={(e) => patchR(r.id, { value: Math.max(0, Number(e.target.value) || 0) })}
                    className="tnum w-14 rounded-md border border-[#E3DDE3] bg-white px-1 py-1 text-right outline-none focus:border-[#5B54D6]"
                  />
                </span>
              )}
              {r.type === "percent" && (
                <span className="flex items-center text-[11px] font-semibold text-slate-500">
                  <input
                    type="number" min={1} max={100} value={r.value}
                    onChange={(e) => patchR(r.id, { value: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                    className="tnum w-14 rounded-md border border-[#E3DDE3] bg-white px-1 py-1 text-right outline-none focus:border-[#5B54D6]"
                  />
                  %
                </span>
              )}
              {r.type === "freeService" && (
                <SearchSelect
                  options={orderedServices(activeServices(services), cats).map((sv) => ({ value: sv.id, label: sv.name, group: serviceGroupLabel(sv, cats) }))}
                  value={r.serviceId ?? ""}
                  onChange={(v) => patchR(r.id, { serviceId: v })}
                  placeholder="Pick a service"
                  searchPlaceholder="Search services"
                  className="min-w-0 flex-1"
                />
              )}
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-500">{typeLabel(r)}</span>
              <Toggle on={r.active} onClick={() => patchR(r.id, { active: !r.active })} />
              <button
                onClick={() => setDeleteId(r.id)}
                className="shrink-0 text-slate-300 transition hover:text-rose-500"
                title="Delete redemption"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {deleteId && (
        <ConfirmDialog
          title={`Delete "${l.redemptions.find((r) => r.id === deleteId)?.name || "redemption"}"?`}
          body="Clients keep their points. This can't be undone."
          confirmLabel="Delete redemption"
          onConfirm={() => setSettings((x) => ({ ...x, loyalty: { ...x.loyalty, redemptions: x.loyalty.redemptions.filter((r) => r.id !== deleteId) } }))}
          onClose={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────────
function NotificationsSection() {
  const s = useSettingsStore();
  const n = s.notifications;
  const patch = (p: Partial<typeof n>) => setSettings((x) => ({ ...x, notifications: { ...x.notifications, ...p } }));
  return (
    <div>
      <SectionHead title="Notifications" blurb="Client messaging preferences, SMS connects when the backend lands" />
      <div className="space-y-3">
        <ToggleRow
          title="Confirmation text"
          body="Send an SMS when a booking is confirmed"
          on={n.confirmSms}
          onClick={() => patch({ confirmSms: !n.confirmSms })}
        />
        <ToggleRow
          title="Reminder text"
          body="Send an SMS before the appointment"
          on={n.reminderSms}
          onClick={() => patch({ reminderSms: !n.reminderSms })}
        />
        {n.reminderSms && (
          <div className={card}>
            <Field label="Send reminder (hours before)">
              <input
                type="number" min={1} value={n.reminderHrs}
                onChange={(e) => patch({ reminderHrs: Math.max(1, Number(e.target.value) || 24) })}
                className={`${inputCls} w-32`}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── tech documents, W-9, license, ID, etc. ─────────────────────────────────
const DOC_PRESETS = ["W-9", "W-2", "Nail license", "Driver's license / ID", "Certificate", "Other"];

function DocumentsCard({ selTech, onPatchTech }: {
  selTech: DraftTech;
  onPatchTech: (id: string, patch: Partial<DraftTech>) => void;
}) {
  const [label, setLabel] = useState(DOC_PRESETS[0]);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) {
      window.alert("That file is over 2.5 MB, please upload a smaller copy.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const doc: TechDocument = {
        id: `doc-${Math.random().toString(36).slice(2, 8)}`,
        label,
        fileName: file.name,
        dataUrl: String(reader.result),
        uploadedAt: new Date().toISOString(),
      };
      onPatchTech(selTech.id, { documents: [...selTech.documents, doc] });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className={card}>
      <p className="text-[12px] font-bold text-slate-800">Documents &amp; forms</p>
      <p className="mb-2.5 text-[10.5px] text-slate-400">W-9, W-2, nail license, ID, stored with the salon account on this device</p>

      <div className="space-y-1">
        {selTech.documents.length === 0 && (
          <p className="rounded-lg border border-dashed border-[#D8D0D9] px-3 py-3 text-center text-[11px] text-slate-400">No documents uploaded yet</p>
        )}
        {selTech.documents.map((d) => (
          <div key={d.id} className="flex items-center gap-2.5 rounded-lg border border-[#EDE7EE] bg-white px-2.5 py-1.5">
            <FileText className="h-4 w-4 shrink-0 text-[#5B54D6]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-slate-800">{d.label}</span>
              <span className="block truncate text-[10px] text-slate-400">
                {d.fileName} · {new Date(d.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </span>
            <a
              href={d.dataUrl}
              download={d.fileName}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[#F4F0F5] hover:text-[#5B54D6]"
              title={`Download ${d.fileName}`}
            >
              <Download className="h-3.5 w-3.5" />
            </a>
            <button
              onClick={() => setDeleteDocId(d.id)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
              title="Delete document"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* add document */}
      <div className="mt-2 flex items-center gap-1.5">
        <select value={label} onChange={(e) => setLabel(e.target.value)} className={`${inputCls} w-[190px]`}>
          {DOC_PRESETS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#D8D0D9] px-3 py-1.5 text-[11.5px] font-semibold text-slate-500 transition hover:border-[#5B54D6] hover:text-[#5B54D6]">
          <Plus className="h-3.5 w-3.5" /> Upload {label}
          <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = "" }} />
        </label>
      </div>

      {deleteDocId && (
        <ConfirmDialog
          title={`Delete "${selTech.documents.find((d) => d.id === deleteDocId)?.label ?? "document"}"?`}
          body={selTech.documents.find((d) => d.id === deleteDocId)?.fileName}
          confirmLabel="Delete document"
          onConfirm={() => onPatchTech(selTech.id, { documents: selTech.documents.filter((d) => d.id !== deleteDocId) })}
          onClose={() => setDeleteDocId(null)}
        />
      )}
    </div>
  );
}

// ─── temporary time off, exact dates, leaves the weekly schedule untouched ──
const TIMEOFF_META: Record<TechTimeOff["status"], { label: string; color: string; fill: string }> = {
  vacation: { label: "Vacation", color: "#2D7FB8", fill: "#DCEBF7" },
  off: { label: "Day off", color: "#64748B", fill: "#E8ECF1" },
  emergency: { label: "Emergency", color: "#B3402F", fill: "#F5DFDB" },
  late: { label: "Coming late", color: "#9A6B0F", fill: "#F9EBCB" },
  early: { label: "Leaving early", color: "#6B4FC4", fill: "#E8E0FA" },
};

function TimeOffCard({ selTech, onPatchTech }: {
  selTech: DraftTech;
  onPatchTech: (id: string, patch: Partial<DraftTech>) => void;
}) {
  const [status, setStatus] = useState<TechTimeOff["status"]>("vacation");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [timeMin, setTimeMin] = useState(120); // 10:00 AM default
  const [note, setNote] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const TIME_OPTS = Array.from({ length: DAY_SLOTS + 1 }, (_, i) => i * SLOT_MIN);
  const timed = status === "late" || status === "early";

  const add = () => {
    if (!from) return;
    const entry: TechTimeOff = {
      id: `to-${Math.random().toString(36).slice(2, 8)}`,
      from,
      to: to && to >= from ? to : from,
      status,
      timeMin: timed ? timeMin : undefined,
      notes: note.trim() || undefined,
    };
    onPatchTech(selTech.id, { timeOff: [...selTech.timeOff, entry].sort((a, b) => a.from.localeCompare(b.from)) });
    setFrom(""); setTo(""); setNote("");
  };

  const fmt = (dk: string) => new Date(dk + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className={card}>
      <p className="text-[12px] font-bold text-slate-800">Temporary time off</p>
      <p className="mb-2.5 text-[10.5px] text-slate-400">Exact dates off, vacation, emergency, etc., never touches her permanent weekly schedule</p>

      <div className="space-y-1">
        {selTech.timeOff.length === 0 && (
          <p className="rounded-lg border border-dashed border-[#D8D0D9] px-3 py-3 text-center text-[11px] text-slate-400">No time off scheduled</p>
        )}
        {selTech.timeOff.map((x) => {
          const m = TIMEOFF_META[x.status];
          return (
            <div key={x.id} className="flex items-center gap-2.5 rounded-lg border border-[#EDE7EE] bg-white px-2.5 py-1.5">
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold" style={{ background: m.fill, color: m.color }}>
                {m.label}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-slate-800">
                  {fmt(x.from)}{x.to !== x.from ? ` to ${fmt(x.to)}` : ""}
                  {x.status === "late" && x.timeMin != null && <span className="ml-1 font-normal text-slate-500">· arrives {fmtTime(x.timeMin)}</span>}
                  {x.status === "early" && x.timeMin != null && <span className="ml-1 font-normal text-slate-500">· leaves {fmtTime(x.timeMin)}</span>}
                </span>
                {x.notes && <span className="block truncate text-[10px] text-slate-400">{x.notes}</span>}
              </span>
              <button
                onClick={() => setDeleteId(x.id)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                title="Delete time off"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* add form */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <select value={status} onChange={(e) => setStatus(e.target.value as TechTimeOff["status"])} className={`${inputCls} w-[130px]`}>
          <option value="vacation">Vacation</option>
          <option value="off">Day off</option>
          <option value="emergency">Emergency</option>
          <option value="late">Coming late</option>
          <option value="early">Leaving early</option>
        </select>
        {timed && (
          <select
            value={timeMin}
            onChange={(e) => setTimeMin(Number(e.target.value))}
            title={status === "late" ? "Arrives at" : "Leaves at"}
            className={`${inputCls} w-[110px]`}
          >
            {(status === "late" ? TIME_OPTS.slice(0, -1) : TIME_OPTS.slice(1)).map((m) => (
              <option key={m} value={m}>{status === "late" ? "arrives " : "leaves "}{fmtTime(m)}</option>
            ))}
          </select>
        )}
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} w-[140px]`} title="First day off" />
        <span className="text-[10.5px] font-bold text-slate-400">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} w-[140px]`} title="Last day off (optional)" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={`${inputCls} min-w-[120px] flex-1`} />
        <button
          onClick={add}
          disabled={!from}
          className="flex items-center gap-1 rounded-lg bg-[#5B54D6] px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-[#4C46C4] disabled:opacity-40"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete this time off?"
          body="Her weekly schedule and the calendar return to normal for those dates."
          confirmLabel="Delete"
          onConfirm={() => onPatchTech(selTech.id, { timeOff: selTech.timeOff.filter((x) => x.id !== deleteId) })}
          onClose={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

// ─── per-tech service overrides, role gating, exceptions, timing, rates, online ──
function ServiceOverridesEditor({ selTech, roles, onPatchTech }: {
  selTech: DraftTech;
  roles: JobRole[];
  onPatchTech: (id: string, patch: Partial<DraftTech>) => void;
}) {
  const services = useServicesStore();
  const cats = useCategoriesStore();
  const [q, setQ] = useState("");
  const role = roles.find((r) => r.id === selTech.teamId);
  const roleSkills = new Set(role?.serviceIds ?? []);

  const canDo = (svcId: string) => roleSkills.has(svcId) || selTech.extraSkills.includes(svcId);

  const setOverride = (svcId: string, next: { durationMin?: number; price?: number; online?: boolean }) => {
    if (next.durationMin == null && next.price == null && next.online == null) {
      const rest = { ...selTech.serviceOverrides };
      delete rest[svcId];
      onPatchTech(selTech.id, { serviceOverrides: rest });
    } else {
      onPatchTech(selTech.id, { serviceOverrides: { ...selTech.serviceOverrides, [svcId]: next } });
    }
  };

  const enableSkill = (svcId: string) => onPatchTech(selTech.id, { extraSkills: [...selTech.extraSkills, svcId] });
  const disableSkill = (svcId: string) => onPatchTech(selTech.id, { extraSkills: selTech.extraSkills.filter((x) => x !== svcId) });

  const exceptionCount = selTech.extraSkills.filter((id) => !roleSkills.has(id)).length;
  const overrideCount = Object.keys(selTech.serviceOverrides).length;
  const query = q.trim().toLowerCase();

  const inp =
    "h-8 rounded-md border border-[#E3DDE3] bg-white px-2 text-[12px] text-slate-700 outline-none transition focus:border-[#5B54D6] focus:ring-2 focus:ring-[#5B54D6]/10";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* toolbar */}
      <div className="mb-3 flex shrink-0 items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter services"
          className={`${inp} w-56`}
        />
        <span className="text-[11px] text-slate-400">
          Services outside <b className="text-slate-500">{role?.name ?? "this role"}</b> start disabled, enable per tech when needed.
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11px] font-semibold">
          {exceptionCount > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">{exceptionCount} exception{exceptionCount > 1 ? "s" : ""}</span>}
          {overrideCount > 0 && <span className="rounded-full bg-[#5B54D6]/[0.08] px-2 py-0.5 text-[#5B54D6]">{overrideCount} customized</span>}
        </span>
      </div>

      {/* table */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#EDE7EE] bg-white">
        {/* column head */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#EDE7EE] bg-white/95 px-4 py-2 backdrop-blur">
          <span className="w-[26px] shrink-0" />
          <span className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Service</span>
          <span className="w-[86px] shrink-0 text-right text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Base</span>
          <span className="w-[104px] shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Her time</span>
          <span className="w-[86px] shrink-0 text-right text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Her price</span>
          <span className="w-[92px] shrink-0 text-center text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Online</span>
          <span className="w-7 shrink-0" />
        </div>

        {cats.map((cat) => {
          const svcs = activeServices(services)
            .filter((s) => s.categoryId === cat.id)
            .filter((s) => !query || s.name.toLowerCase().includes(query));
          if (svcs.length === 0) return null;
          return (
            <div key={cat.id}>
              {/* category band */}
              <div className="sticky top-[33px] z-10 flex items-center gap-2 border-b border-[#F1ECF2] bg-[#FAF8FA] px-4 py-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: cat.line }} />
                <span className="text-[11px] font-bold text-slate-600">{cat.name}</span>
                <span className="text-[10px] text-slate-400">{svcs.length}</span>
              </div>

              {svcs.map((sv) => {
                const allowed = canDo(sv.id);
                const isException = allowed && !roleSkills.has(sv.id);
                const ov = selTech.serviceOverrides[sv.id];
                const customized = ov != null && (ov.durationMin != null || ov.price != null || ov.online != null);
                const online = ov?.online ?? true;

                if (!allowed) {
                  return (
                    <div key={sv.id} className="flex items-center gap-3 border-b border-[#F5F1F5] bg-slate-50/60 px-4 py-2 last:border-0">
                      <span className="w-[26px] shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-slate-400">{sv.name}</span>
                        <span className="block text-[10px] text-slate-400">Not in {role?.name ?? "this role"}</span>
                      </span>
                      <span className="w-[86px] shrink-0 text-right text-[11px] text-slate-400 tnum">{sv.durationMin}m · ${sv.price}</span>
                      <span className="w-[104px] shrink-0" />
                      <span className="w-[86px] shrink-0" />
                      <span className="flex w-[92px] shrink-0 justify-center">
                        <button
                          onClick={() => enableSkill(sv.id)}
                          title={`Allow ${selTech.firstName || "this tech"} to perform ${sv.name}, staff can always book in-store`}
                          className="rounded-md border border-emerald-600/30 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          Enable
                        </button>
                      </span>
                      <span className="w-7 shrink-0" />
                    </div>
                  );
                }

                return (
                  <div
                    key={sv.id}
                    className={`group flex items-center gap-3 border-b border-[#F5F1F5] px-4 py-2 last:border-0 transition-colors hover:bg-[#FAF8FA] ${
                      customized ? "bg-[#5B54D6]/[0.03]" : ""
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 w-[26px] shrink-0 rounded-full ${customized ? "bg-[#5B54D6]" : "bg-transparent"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-slate-800">
                        {sv.name}
                        {isException && (
                          <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 align-middle text-[9px] font-bold text-emerald-600">exception</span>
                        )}
                      </span>
                    </span>
                    <span className="w-[86px] shrink-0 text-right text-[11px] text-slate-400 tnum">{sv.durationMin}m · ${sv.price}</span>
                    <select
                      value={ov?.durationMin ?? ""}
                      onChange={(e) => setOverride(sv.id, { ...ov, durationMin: e.target.value === "" ? undefined : Number(e.target.value) })}
                      title="Her duration for this service"
                      className={`${inp} w-[104px] shrink-0 ${ov?.durationMin != null ? "border-[#5B54D6] font-semibold text-[#5B54D6]" : "text-slate-500"}`}
                    >
                      <option value="">Base {sv.durationMin}m</option>
                      {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
                    </select>
                    <span className="flex w-[86px] shrink-0 items-center justify-end text-[11px] font-semibold text-slate-400">
                      $<input
                        type="number" min={0}
                        value={ov?.price ?? ""}
                        placeholder={String(sv.price)}
                        onChange={(e) => setOverride(sv.id, { ...ov, price: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })}
                        title="Her price for this service"
                        className={`${inp} tnum w-[74px] text-right ${ov?.price != null ? "border-[#5B54D6] font-semibold text-[#5B54D6]" : ""}`}
                      />
                    </span>
                    <span className="flex w-[92px] shrink-0 justify-center">
                      <button
                        onClick={() => setOverride(sv.id, { ...ov, online: !online })}
                        title={online
                          ? "Bookable online, salon can always book in-store. Click to hide online."
                          : "Hidden from online booking only, salon can still book in-store. Click to show online."}
                        className={`relative h-5 w-9 rounded-full transition-colors ${online ? "bg-sky-500" : "bg-slate-300"}`}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${online ? "left-[18px]" : "left-0.5"}`} />
                      </button>
                    </span>
                    <span className="flex w-7 shrink-0 justify-center">
                      {isException ? (
                        <button
                          onClick={() => disableSkill(sv.id)}
                          title="Remove exception, back to role skills"
                          className="text-slate-300 opacity-0 transition group-hover:opacity-100 hover:text-rose-500"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : customized ? (
                        <button
                          onClick={() => setOverride(sv.id, { durationMin: undefined, price: undefined, online: undefined })}
                          title="Reset to base"
                          className="text-slate-300 opacity-0 transition group-hover:opacity-100 hover:text-rose-500"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="mt-2 shrink-0 text-[10.5px] text-slate-400">
        The Online switch only affects the client booking page, your salon can always book any enabled service in-store.
      </p>
    </div>
  );
}
