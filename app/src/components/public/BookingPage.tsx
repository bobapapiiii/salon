// ─── Public online-booking page ────────────────────────────────────────────
// Served at /book/:slug (see App.tsx). Talks to the new backend (server/)
// directly via booking-api.ts -- this page has nothing to do with the
// existing localStorage calendar; it's a standalone booking form that
// creates a "requested" appointment for staff to approve, see the
// "Online requests" panel in Settings (OnlineRequestsSection.tsx).
import { useEffect, useMemo, useState } from "react";
import { Calendar, Check, ChevronLeft, Clock, Loader2, MapPin, Phone } from "lucide-react";
import {
  ApiError,
  createBooking,
  fetchAvailability,
  fetchBookingInfo,
  fmtMinutes,
  type BookingInfo,
  type BookingService,
  type BookingTech,
} from "@/lib/booking-api";

type Step = "service" | "tech" | "time" | "details" | "confirmed";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextNDays(n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ key, label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) });
  }
  return out;
}

export function BookingPage({ slug }: { slug: string }) {
  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("service");

  const [service, setService] = useState<BookingService | null>(null);
  const [tech, setTech] = useState<BookingTech | "any" | null>(null);
  const [date, setDate] = useState(todayKey());
  const [slots, setSlots] = useState<{ startMin: number; techIds: string[] }[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [startMin, setStartMin] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedTechName, setConfirmedTechName] = useState<string>("");

  useEffect(() => {
    fetchBookingInfo(slug)
      .then(setInfo)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Couldn't load this salon's booking page."));
  }, [slug]);

  useEffect(() => {
    if (!service || step !== "time") return;
    setSlotsLoading(true);
    setSlots(null);
    setStartMin(null);
    fetchAvailability(slug, { serviceId: service.id, date, techId: tech !== "any" && tech ? tech.id : undefined })
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [slug, service, tech, date, step]);

  const eligibleTechs = useMemo(() => {
    if (!info || !service) return [];
    return info.techs.filter((t) => t.skillServiceIds.includes(service.id));
  }, [info, service]);

  const days = useMemo(() => nextNDays(14), []);

  async function submit() {
    if (!service || !tech || startMin == null) return;
    const chosenTechId = tech === "any" ? slots?.find((s) => s.startMin === startMin)?.techIds[0] : tech.id;
    if (!chosenTechId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createBooking(slug, {
        serviceId: service.id,
        techId: chosenTechId,
        date,
        startMin,
        client: { name: name.trim(), phone: phone.trim(), email: email.trim() || undefined },
        note: note.trim() || undefined,
      });
      setConfirmedTechName(result.tech.name);
      setStep("confirmed");
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : "Something went wrong -- please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center bg-cream px-6 text-center">
        <div>
          <p className="text-[15px] font-semibold text-ink">This booking page isn't available.</p>
          <p className="mt-1 text-[13px] text-ink-faint">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex h-screen items-center justify-center bg-cream">
        <Loader2 className="h-6 w-6 animate-spin text-clay" />
      </div>
    );
  }

  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[520px] px-4 py-8">
        <header className="mb-6 text-center">
          <h1 className="font-display text-[24px] font-bold text-ink">{info.salon.name}</h1>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[12.5px] text-ink-faint">
            {info.salon.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {info.salon.address}
              </span>
            )}
            {info.salon.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" /> {info.salon.phone}
              </span>
            )}
          </div>
        </header>

        <div className="rounded-2xl border border-line bg-popover shadow-sm">
          {step !== "service" && step !== "confirmed" && (
            <button
              onClick={() => {
                if (step === "tech") setStep("service");
                else if (step === "time") setStep("tech");
                else if (step === "details") setStep("time");
              }}
              className="flex items-center gap-1 px-5 pt-4 text-[12.5px] font-semibold text-ink-faint hover:text-ink"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back
            </button>
          )}

          {step === "service" && (
            <div className="p-5">
              <h2 className="mb-3 text-[15px] font-bold text-ink">Choose a service</h2>
              <div className="space-y-4">
                {info.categories
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((cat) => {
                    const svcs = info.services.filter((s) => s.categoryId === cat.id);
                    if (svcs.length === 0) return null;
                    return (
                      <div key={cat.id}>
                        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">{cat.name}</p>
                        <div className="space-y-1.5">
                          {svcs.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => {
                                setService(s);
                                setTech(null);
                                setStep("tech");
                              }}
                              className="flex w-full items-center justify-between rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-clay hover:bg-clay-tint/30"
                            >
                              <span>
                                <span className="block text-[13.5px] font-semibold text-ink">{s.name}</span>
                                <span className="block text-[11.5px] text-ink-faint">{s.durationMin} min</span>
                              </span>
                              <span className="tnum text-[13.5px] font-bold text-ink">{money(s.priceCents)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {step === "tech" && service && (
            <div className="p-5">
              <h2 className="mb-3 text-[15px] font-bold text-ink">Choose a stylist</h2>
              <div className="space-y-1.5">
                <button
                  onClick={() => {
                    setTech("any");
                    setStep("time");
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-clay hover:bg-clay-tint/30"
                >
                  <span className="text-[13.5px] font-semibold text-ink">No preference</span>
                  <span className="text-[11.5px] text-ink-faint">Earliest available</span>
                </button>
                {eligibleTechs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTech(t);
                      setStep("time");
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-clay hover:bg-clay-tint/30"
                  >
                    <span className="text-[13.5px] font-semibold text-ink">{t.name}</span>
                    {t.title && <span className="text-[11.5px] text-ink-faint">{t.title}</span>}
                  </button>
                ))}
                {eligibleTechs.length === 0 && (
                  <p className="px-1 py-4 text-[12.5px] text-ink-faint">No stylists currently offer this service online.</p>
                )}
              </div>
            </div>
          )}

          {step === "time" && service && (
            <div className="p-5">
              <h2 className="mb-3 text-[15px] font-bold text-ink">Choose a time</h2>
              <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                {days.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => setDate(d.key)}
                    className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
                      date === d.key ? "border-clay bg-clay text-white" : "border-line text-ink-soft hover:bg-clay-tint/30"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              {slotsLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-clay" />
                </div>
              )}
              {!slotsLoading && slots && slots.length === 0 && (
                <p className="py-6 text-center text-[12.5px] text-ink-faint">No open times this day -- try another date.</p>
              )}
              {!slotsLoading && slots && slots.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={s.startMin}
                      onClick={() => {
                        setStartMin(s.startMin);
                        setStep("details");
                      }}
                      className="rounded-lg border border-line py-2 text-center text-[12.5px] font-semibold text-ink transition-colors hover:border-clay hover:bg-clay-tint/30"
                    >
                      {fmtMinutes(s.startMin)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "details" && service && startMin != null && (
            <div className="p-5">
              <h2 className="mb-1 text-[15px] font-bold text-ink">Your details</h2>
              <p className="mb-3 flex items-center gap-3 text-[12.5px] text-ink-faint">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> {date}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {fmtMinutes(startMin)}
                </span>
              </p>
              <div className="space-y-2.5">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] outline-none focus:border-clay"
                />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] outline-none focus:border-clay"
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (optional)"
                  className="w-full rounded-lg border border-line px-3 py-2 text-[13.5px] outline-none focus:border-clay"
                />
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything we should know? (optional)"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-line px-3 py-2 text-[13.5px] outline-none focus:border-clay"
                />
              </div>
              {submitError && <p className="mt-2 text-[12px] font-semibold text-rust">{submitError}</p>}
              <button
                onClick={submit}
                disabled={submitting || !name.trim() || !phone.trim()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-clay py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Request appointment"}
              </button>
              <p className="mt-2 text-center text-[11px] text-ink-faint">
                This holds your spot as a request -- {info.salon.name} will confirm shortly.
              </p>
            </div>
          )}

          {step === "confirmed" && service && startMin != null && (
            <div className="flex flex-col items-center p-8 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <h2 className="text-[16px] font-bold text-ink">Request sent!</h2>
              <p className="mt-1.5 text-[13px] text-ink-faint">
                {service.name} with {confirmedTechName} on {date} at {fmtMinutes(startMin)}.
              </p>
              <p className="mt-2.5 text-[12px] text-ink-faint">{info.salon.name} will reach out to confirm.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
