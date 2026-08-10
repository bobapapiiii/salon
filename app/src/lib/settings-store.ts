// ─── Salon settings store, salon-scoped configuration ───────────────────────
// One settings object per salon; persisted under the salon account. Sections:
// general info, online booking, payments, loyalty, notifications.
import { useSyncExternalStore } from "react";
import { sdata } from "./persist";

/** a reward clients can redeem with loyalty points */
export interface Redemption {
  id: string;
  name: string;
  pointsCost: number;
  /** amount = $ off, percent = % off the ticket, freeService = comp one service */
  type: "amount" | "percent" | "freeService";
  /** dollars for amount, 1-100 for percent, ignored for freeService */
  value: number;
  serviceId?: string;
  active: boolean;
}

/** a salon-defined text field shown at checkout */
export interface CheckoutField {
  id: string;
  label: string;
}

export interface SalonSettings {
  general: {
    name: string; phone: string; email: string; address: string; website: string; clockFormat: '12h' | '24h';
    /** operating hours per weekday (0=Sun), absolute minutes from midnight; missing = 8 AM to 8 PM */
    weekHours: Record<number, { off?: boolean; open?: number; close?: number }>;
    /** salon-wide closures (holidays), booking is off for the whole day */
    holidays: { id: string; date: string; label: string }[];
  };
  booking: {
    /** true = online bookings confirm instantly; false = salon approves first */
    autoConfirm: boolean;
    minLeadHrs: number;
    maxDaysOut: number;
    allowTechChoice: boolean;
    allowSameTime: boolean;
    /** staff-side: appointments may overlap on one tech */
    allowOverlap: boolean;
    /** ask before placing an overlapping appointment */
    warnOnDoubleBook: boolean;
    /** when a booking, edit, or drag pins an appointment to a specific tech
     *  and a non-requested appointment is already sitting in that slot,
     *  automatically move the non-requested one to the next least-booked
     *  qualified tech instead of prompting to double-book. Off restores the
     *  double-book prompt (or overlap error) for every such clash. */
    autoRelocateNonRequested: boolean;
    /** booking time steps, minutes */
    increment: 15 | 30 | 60;
  };
  payments: { methods: string[]; tipPresets: number[] };
  loyalty: { pointsPerDollar: number; redemptions: Redemption[] };
  notifications: { confirmSms: boolean; reminderSms: boolean; reminderHrs: number };
  /** extra notation fields at checkout: per-service (e.g. polish color) and per-ticket */
  checkout: { serviceFields: CheckoutField[]; generalFields: CheckoutField[] };
}

export const ALL_METHODS = ["Cash", "Card", "Venmo", "Zelle"];

const defaults: SalonSettings = {
  general: {
    name: "Gloss Nail Bar", phone: "(555) 010-1000", email: "hello@glossnailbar.com", address: "123 Blossom Ave, Suite 4", website: "glossnailbar.com", clockFormat: "12h",
    weekHours: {},
    holidays: [],
  },
  booking: {
    autoConfirm: false, minLeadHrs: 2, maxDaysOut: 60, allowTechChoice: true, allowSameTime: true,
    allowOverlap: false, warnOnDoubleBook: true, autoRelocateNonRequested: true, increment: 15,
  },
  payments: { methods: [...ALL_METHODS], tipPresets: [0, 15, 18, 20, 25] },
  loyalty: {
    pointsPerDollar: 1,
    redemptions: [
      { id: "r-5off", name: "$5 off", pointsCost: 500, type: "amount", value: 5, active: true },
      { id: "r-10off", name: "$10 off", pointsCost: 900, type: "amount", value: 10, active: true },
      { id: "r-15pct", name: "15% off the visit", pointsCost: 1200, type: "percent", value: 15, active: true },
      { id: "r-freemani", name: "Free Classic Manicure", pointsCost: 1500, type: "freeService", value: 0, serviceId: "m-classic", active: true },
    ],
  },
  notifications: { confirmSms: true, reminderSms: true, reminderHrs: 24 },
  checkout: { serviceFields: [{ id: "f-color", label: "Color" }], generalFields: [] },
};

const KEY = sdata("settings-v1");

function load(): SalonSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<SalonSettings>;
    // shallow-merge each section so new fields get defaults on old saves
    return {
      general: { ...defaults.general, ...p.general },
      booking: { ...defaults.booking, ...p.booking },
      payments: { ...defaults.payments, ...p.payments },
      loyalty: { ...defaults.loyalty, ...p.loyalty },
      notifications: { ...defaults.notifications, ...p.notifications },
      checkout: { ...defaults.checkout, ...p.checkout },
    };
  } catch {
    return defaults;
  }
}

let state: SalonSettings = load();

const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSettingsStore(): SalonSettings {
  return useSyncExternalStore(subscribe, () => state);
}

export function getSettings(): SalonSettings {
  return state;
}

export function setSettings(up: (s: SalonSettings) => SalonSettings) {
  state = up(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}
