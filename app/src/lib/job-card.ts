// ─── Job cards, thermal receipt printing ────────────────────────────────────
// A job card is the paper ticket that rides with the client through the visit:
// who they are, what they booked, who they asked for, and a blank grid the tech
// fills in with what the client actually got. Printed on an Epson TM-T30III or
// any similar 58mm/80mm receipt printer, via the browser's own print dialog.
//
// Nothing here touches app state — callers hand in plain data, this module turns
// it into a self-contained HTML document and opens the print dialog on it.

import type { Appointment, ClientRecord, Service, Tech } from './booking-types'
import { fmtTime } from './booking-types'

/** roll width in mm; the salon picks this in Settings → Checkout */
export type JobCardWidth = 58 | 80

export interface JobCardService {
  /** formatted start time, e.g. "10:15 AM" */
  time: string
  name: string
  durationMin: number
  addons: { name: string; mins: number }[]
  /** the client asked for this tech by name — prints with a heart */
  requestedTechName?: string
  /** gender preference with no specific name, e.g. "F PREFER" */
  preferLabel?: string
}

export interface JobCardData {
  clientName: string
  phone: string
  dateLabel: string
  services: JobCardService[]
  notes: string[]
  /** only set when this booking is part of a multi-person party */
  group?: { size: number; host: string }
}

// ── building cards from appointments ───────────────────────────────────────

/** "Sarah Mitchell" → "Sarah M." — how a group host is identified on the card */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

/** a party is a parallelGroup holding more than one distinct person */
function groupInfo(
  a: Appointment,
  dayAppts: Appointment[],
  clients: ClientRecord[],
): JobCardData['group'] {
  if (!a.parallelGroup) return undefined
  const party = dayAppts.filter((x) => x.parallelGroup === a.parallelGroup)
  const people = [...new Set(party.map((x) => x.clientName))]
  // one person booking several services shares a parallelGroup too — not a group
  if (people.length < 2) return undefined
  // the host is whoever booked under their own profile (guests carry guestOf)
  const hostAppt = party.find((x) => !x.guestOf)
  let host = hostAppt?.clientName
  if (!host) {
    const hostId = party.find((x) => x.guestOf)?.guestOf
    host = clients.find((c) => c.id === hostId)?.name ?? people[0]
  }
  return { size: people.length, host: shortName(host) }
}

export interface JobCardCtx {
  svc: (id: string) => Service | undefined
  techs: Tech[]
  clients: ClientRecord[]
  dateLabel: string
  /** every appointment on the day — needed to size the group and find its host */
  dayAppts: Appointment[]
}

/**
 * One card per client. `group` is that single client's appointments for the visit
 * (already filtered by clientName upstream, same as the edit panel's detailGroup).
 */
export function buildJobCard(group: Appointment[], ctx: JobCardCtx): JobCardData {
  const sorted = [...group].sort((x, y) => x.startMin - y.startMin)
  const first = sorted[0]
  const techName = (id: string) => ctx.techs.find((t) => t.id === id)?.name ?? ''

  const client = ctx.clients.find(
    (c) => c.name === first.clientName || c.id === first.guestOf,
  )
  // a name-only guest has no profile of their own — fall back to the host's number
  const phone = ctx.clients.find((c) => c.name === first.clientName)?.phone
    ?? (first.guestOf ? client?.phone ?? '' : client?.phone ?? '')

  const services: JobCardService[] = sorted.map((a) => {
    const s = ctx.svc(a.serviceId)
    const requested = a.techRequested === true
    return {
      time: fmtTime(a.startMin),
      name: s?.name ?? a.serviceId,
      durationMin: a.durationMin,
      addons: (a.addons ?? []).map((x) => ({ name: x.name, mins: x.mins })),
      requestedTechName: requested ? techName(a.techId) : undefined,
      preferLabel:
        !requested && a.requestedTechChoice === 'pref-female' ? 'F PREFER'
          : !requested && a.requestedTechChoice === 'pref-male' ? 'M PREFER'
            : undefined,
      // no request and no preference — the card deliberately shows no tech at all
    }
  })

  const notes = [...new Set(sorted.map((a) => a.notes?.trim()).filter((n): n is string => !!n))]

  return {
    clientName: first.clientName,
    phone,
    dateLabel: ctx.dateLabel,
    services,
    notes,
    group: groupInfo(first, ctx.dayAppts, ctx.clients),
  }
}

/** split a day's appointments into one card-worth of appointments per person */
export function cardGroupsFor(appts: Appointment[]): Appointment[][] {
  const byPerson = new Map<string, Appointment[]>()
  for (const a of appts) {
    // one card per client per booking — the same key the edit panel scopes to
    const key = `${a.parallelGroup ?? a.id}::${a.clientName}`
    const list = byPerson.get(key)
    if (list) list.push(a)
    else byPerson.set(key, [a])
  }
  return [...byPerson.values()].sort(
    (x, y) => Math.min(...x.map((a) => a.startMin)) - Math.min(...y.map((a) => a.startMin)),
  )
}

// ── rendering ──────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const mins = (n: number) => `${n}m`

/** blank ruled rows the tech writes the real service, color and price into */
function writeIn(width: JobCardWidth, rows: number): string {
  if (width === 80) {
    // an explicit colgroup on both tables so the TOTAL blank lands exactly
    // under the Price column instead of floating somewhere near it
    const cols = `<colgroup><col class="c1"><col class="c2"><col class="c3"></colgroup>`
    const line = `<tr><td class="wl"></td><td class="wl"></td><td class="wl"></td></tr>`
    return `
      <table class="wi">
        ${cols}
        <thead><tr><th>Service given</th><th>Color</th><th>Price</th></tr></thead>
        <tbody>${line.repeat(rows)}</tbody>
      </table>
      <table class="wi tot">
        ${cols}
        <tbody><tr><td class="tl" colspan="2">TOTAL</td><td class="wl"></td></tr></tbody>
      </table>`
  }
  // 58mm — stack each entry so nothing gets squeezed to nothing
  const block = `
    <div class="wi58">
      <div class="w58row"><span class="w58k">Service</span><span class="wl58"></span></div>
      <div class="w58row"><span class="w58k">Color</span><span class="wl58"></span><span class="w58k pl">Price</span><span class="wl58 sm"></span></div>
    </div>`
  return `${block.repeat(rows)}
    <div class="w58row tot58"><span class="w58k">TOTAL</span><span class="wl58"></span></div>`
}

function cardHtml(c: JobCardData, width: JobCardWidth, salonName: string): string {
  // the narrow roll spends two printed lines per write-in row, so it gets fewer
  // of them — otherwise a one-service card trails a foot of blank paper
  const rows = width === 80
    ? Math.max(4, c.services.length + 2)
    : Math.max(3, c.services.length + 1)

  const group = c.group
    ? `<div class="grp"><div class="grpn">GROUP #${c.group.size}</div><div class="grph">Group host: ${esc(c.group.host)}</div></div>`
    : ''

  const services = c.services
    .map((s) => {
      const tech = s.requestedTechName
        ? `<div class="tech req"><span class="hrt">&#9829;</span>${esc(s.requestedTechName)}</div>`
        : s.preferLabel
          ? `<div class="tech pref">${esc(s.preferLabel)}</div>`
          : ''
      const addons = s.addons.length
        ? `<div class="adds">${s.addons
            .map((a) => `<div class="add">+ ${esc(a.name)}${a.mins ? ` <span class="am">${mins(a.mins)}</span>` : ''}</div>`)
            .join('')}</div>`
        : ''
      return `
        <div class="svc">
          <div class="srow"><span class="stime">${esc(s.time)}</span><span class="sname">${esc(s.name)}</span><span class="sdur">${mins(s.durationMin)}</span></div>
          ${tech}
          ${addons}
        </div>`
    })
    .join('')

  const notes = c.notes.length
    ? `<div class="sec"><div class="sech">NOTES</div>${c.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}</div>`
    : ''

  return `
  <div class="card">
    <div class="hd">
      <div class="salon">${esc(salonName)}</div>
      <div class="title">JOB CARD</div>
    </div>
    ${group}
    <div class="who">
      <div class="cname">${esc(c.clientName)}</div>
      ${c.phone ? `<div class="cmeta">${esc(c.phone)}</div>` : ''}
      <div class="cmeta">${esc(c.dateLabel)}</div>
    </div>
    <div class="sec">
      <div class="sech">SERVICES</div>
      ${services}
    </div>
    ${notes}
    <div class="sec">
      <div class="sech">TECH USE &mdash; what the client got</div>
      ${writeIn(width, rows)}
    </div>
    <div class="sign">
      <div class="srow2"><span class="w58k">Tech</span><span class="wl58"></span><span class="w58k pl">Time</span><span class="wl58 sm"></span></div>
    </div>
  </div>`
}

function styles(width: JobCardWidth): string {
  const paper = width === 80 ? '80mm' : '58mm'
  const pad = width === 80 ? '3mm' : '2mm'
  const base = width === 80 ? 12 : 10.5
  return `
    @page { size: ${paper} auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: ${base}px; line-height: 1.35; color: #000;
      -webkit-font-smoothing: none;
    }
    .card {
      width: ${paper}; padding: ${pad} ${pad} 6mm; margin: 0 auto;
      page-break-after: always; break-after: page;
    }
    .card:last-child { page-break-after: auto; break-after: auto; }

    .hd { text-align: center; padding-bottom: 2mm; border-bottom: 2px solid #000; }
    .salon { font-size: ${base + 1}px; font-weight: 800; letter-spacing: .02em; }
    .title { font-size: ${base + 4}px; font-weight: 900; letter-spacing: .16em; margin-top: .5mm; }

    .grp { margin-top: 2mm; padding: 1.5mm 2mm; border: 2px solid #000; text-align: center; }
    .grpn { font-size: ${base + 3}px; font-weight: 900; letter-spacing: .08em; }
    .grph { font-size: ${base}px; font-weight: 700; }

    .who { margin-top: 2mm; padding-bottom: 2mm; border-bottom: 1px dashed #000; }
    .cname { font-size: ${base + 3}px; font-weight: 800; }
    .cmeta { font-size: ${base}px; font-weight: 600; }

    .sec { margin-top: 2mm; padding-bottom: 1.5mm; border-bottom: 1px dashed #000; }
    .sech { font-size: ${base - 1}px; font-weight: 800; letter-spacing: .1em; margin-bottom: 1mm; }

    .svc { margin-bottom: 2.2mm; }
    .svc:last-child { margin-bottom: 0; }
    .srow { display: flex; align-items: baseline; gap: 1.5mm; }
    .stime { font-weight: 800; white-space: nowrap; }
    .sname { flex: 1; font-weight: 700; }
    .sdur { font-weight: 600; white-space: nowrap; }
    .tech { margin-left: 2mm; font-size: ${base}px; font-weight: 700; }
    .tech.req .hrt { margin-right: 1mm; }
    .tech.pref { letter-spacing: .06em; }
    .tech.any { font-weight: 500; }
    .adds { margin-left: 2mm; }
    .add { font-size: ${base - 1}px; font-weight: 500; }
    .am { font-weight: 600; }

    .note { font-size: ${base}px; font-weight: 500; }

    /* border-spacing keeps each column's rule separate so the tech can see
       where Service ends and Color begins; the negative margin cancels the
       spacing the table would otherwise add outside its left/right edges */
    table.wi { width: 100%; border-collapse: separate; border-spacing: 1.6mm 0; margin: 0 -1.6mm; }
    table.wi col.c1 { width: 52%; }
    table.wi col.c2 { width: 24%; }
    table.wi col.c3 { width: 24%; }
    table.wi th {
      font-size: ${base - 2}px; font-weight: 700; text-align: left;
      letter-spacing: .04em; padding-bottom: .5mm; border-bottom: 1px solid #000;
    }
    td.wl { height: 7mm; border-bottom: 1px solid #000; }
    table.wi.tot { margin-top: 1mm; }
    table.wi.tot td.tl { font-weight: 800; text-align: right; }

    .wi58 { margin-bottom: 1mm; }
    .w58row { display: flex; align-items: flex-end; gap: 1mm; margin-bottom: 2mm; }
    .w58k { font-size: ${base - 2}px; font-weight: 700; white-space: nowrap; }
    .w58k.pl { padding-left: 1.5mm; }
    .wl58 { flex: 1; border-bottom: 1px solid #000; height: 5mm; }
    .wl58.sm { flex: 0 0 12mm; }
    .tot58 { margin-top: 1.5mm; }
    .tot58 .w58k { font-size: ${base}px; font-weight: 800; }

    .sign { margin-top: 2.5mm; }
    .srow2 { display: flex; align-items: flex-end; gap: 1mm; }
  `
}

/** the full print document for a batch of cards, one receipt per card */
export function jobCardsHtml(
  cards: JobCardData[],
  width: JobCardWidth,
  salonName: string,
): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Job cards</title><style>${styles(width)}</style></head>
<body>${cards.map((c) => cardHtml(c, width, salonName)).join('')}</body></html>`
}

/**
 * Open the browser print dialog on a batch of job cards, one receipt per card.
 * Returns false when the popup was blocked so the caller can surface a hint.
 */
export function printJobCards(
  cards: JobCardData[],
  width: JobCardWidth,
  salonName: string,
): boolean {
  if (cards.length === 0) return true
  const html = jobCardsHtml(cards, width, salonName)

  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  w.focus()
  // let the layout settle before handing off to the print dialog
  setTimeout(() => w.print(), 250)
  return true
}
