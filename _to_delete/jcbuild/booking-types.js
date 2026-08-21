// ── Salon appointment book, domain types ──────────────────────────────────
export const logEntry = (text) => ({ at: Date.now(), text });
// ── Calendar constants ─────────────────────────────────────────────────────
export const OPEN_MIN = 8 * 60; // 8:00 AM
export const CLOSE_MIN = 20 * 60; // 8:00 PM
export const SLOT_MIN = 15;
export const DAY_SLOTS = (CLOSE_MIN - OPEN_MIN) / SLOT_MIN; // 48
export const MIN_COL_W = 22;
export const MAX_COL_W = 260;
export const MIN_PPM = 0.35;
export const MAX_PPM = 2.6;
export const SCALE_PRESETS = [
    { id: 'overview', label: 'Overview', scale: { colW: 30, ppm: 0.55 } },
    { id: 'compact', label: 'Compact', scale: { colW: 104, ppm: 1.15 } },
    { id: 'comfortable', label: 'Comfortable', scale: { colW: 168, ppm: 1.7 } },
];
/** below this width the book behaves as a density overview (no drag) */
export const OVERVIEW_COL_W = 48;
/** below this width cards stop rendering text */
export const TEXT_COL_W = 64;
let clockFormat = '12h';
/** Settings → General drives this */
export function setClockFormat(f) {
    clockFormat = f;
}
export function fmtTime(minFromOpen) {
    const total = OPEN_MIN + minFromOpen;
    const h24 = Math.floor(total / 60);
    const mm = String(total % 60).padStart(2, '0');
    if (clockFormat === '24h')
        return `${String(h24).padStart(2, '0')}:${mm}`;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}
/** do two [start,end) intervals overlap? */
export function overlaps(aS, aE, bS, bE) {
    return aS < bE && bS < aE;
}
