import { getDb } from "../api/queries/connection";
import {
  salons,
  staff,
  staffSchedules,
  serviceCategories,
  services,
  staffServices,
  clients,
  clientNotes,
  appointments,
  appointmentServices,
  bookingRequests,
  bookingRequestItems,
} from "./schema";

function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return todayStr(d);
}
const NOW_MIN = new Date().getHours() * 60 + new Date().getMinutes();

async function seed() {
  const db = getDb();
  console.log("Seeding Lumina Salon...");

  const existing = await db.query.salons.findFirst();
  if (existing) {
    console.log("Database already seeded — skipping.");
    process.exit(0);
  }

  // ---- Salon ----
  const [{ id: salonId }] = await db
    .insert(salons)
    .values({
      name: "Lumina Salon",
      timezone: "America/Los_Angeles",
      phone: "(415) 555-0134",
      address: "218 Hayes St, San Francisco, CA",
      openMin: 480,
      closeMin: 1200,
    })
    .$returningId();

  // ---- Staff: 16 techs (7 Nails, 5 Hair, 4 Lashes) ----
  const staffSeed: {
    name: string;
    group: "nails" | "hair" | "lashes";
    title: string;
    tint: string;
    daysOff: number[]; // day-of-week offsets from today they DON'T work
  }[] = [
    { name: "Maya Tran", group: "nails", title: "Senior Nail Artist", tint: "clay", daysOff: [] },
    { name: "Linh Nguyen", group: "nails", title: "Nail Technician", tint: "honey", daysOff: [] },
    { name: "Sofia Reyes", group: "nails", title: "Nail Technician", tint: "rose", daysOff: [0] }, // off today
    { name: "Amy Pham", group: "nails", title: "Nail Technician", tint: "olive", daysOff: [] },
    { name: "Grace Kim", group: "nails", title: "Gel Specialist", tint: "clay", daysOff: [] },
    { name: "Nora Patel", group: "nails", title: "Nail Technician", tint: "honey", daysOff: [1] }, // off tomorrow
    { name: "Jade Ho", group: "nails", title: "Junior Nail Tech", tint: "rose", daysOff: [] },
    { name: "Elena Brooks", group: "hair", title: "Master Stylist", tint: "olive", daysOff: [] },
    { name: "Marco Silva", group: "hair", title: "Color Specialist", tint: "clay", daysOff: [] },
    { name: "Priya Shah", group: "hair", title: "Senior Stylist", tint: "honey", daysOff: [] },
    { name: "Dana Cole", group: "hair", title: "Stylist", tint: "rose", daysOff: [0] }, // off today
    { name: "Yuki Tanaka", group: "hair", title: "Junior Stylist", tint: "olive", daysOff: [] },
    { name: "Chloe Bennett", group: "lashes", title: "Lash Artist", tint: "honey", daysOff: [] },
    { name: "Isla Moreau", group: "lashes", title: "Lash Artist", tint: "clay", daysOff: [] },
    { name: "Tessa Wang", group: "lashes", title: "Lash Technician", tint: "rose", daysOff: [2] }, // off in 2 days
    { name: "Ruby Santos", group: "lashes", title: "Lash Technician", tint: "olive", daysOff: [] },
  ];

  const staffIds: number[] = [];
  for (const s of staffSeed) {
    const initials = s.name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    const [{ id }] = await db
      .insert(staff)
      .values({
        salonId,
        name: s.name,
        initials,
        title: s.title,
        roleGroup: s.group,
        avatarTint: s.tint,
      })
      .$returningId();
    staffIds.push(id);
    // Weekly schedule: works Mon-Sat 9:00-18:00 (some 10-19), skip their "daysOff" by omitting matching weekdays
    for (let offset = 0; offset < 7; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      const dow = d.getDay();
      if (dow === 0) continue; // salon closed Sundays
      if (s.daysOff.includes(offset)) continue;
      const start = offset % 2 === 0 ? 540 : 600; // 9:00 or 10:00
      await db.insert(staffSchedules).values({
        staffId: id,
        dayOfWeek: dow,
        startMin: start,
        endMin: start + 540, // 9h shift
      });
    }
  }

  // ---- Service categories + services ----
  const catDefs = [
    { name: "Nails", sortOrder: 0 },
    { name: "Hair", sortOrder: 1 },
    { name: "Lashes", sortOrder: 2 },
  ];
  const catIds: number[] = [];
  for (const c of catDefs) {
    const [{ id }] = await db
      .insert(serviceCategories)
      .values({ salonId, name: c.name, sortOrder: c.sortOrder })
      .$returningId();
    catIds.push(id);
  }

  const svcDefs: {
    cat: number;
    name: string;
    desc: string;
    dur: number;
    proc?: number;
    buf?: number;
    price: number;
    online?: boolean;
    approval?: boolean;
  }[] = [
    { cat: 0, name: "Classic Manicure", desc: "Shape, cuticle care, polish", dur: 45, buf: 5, price: 3800 },
    { cat: 0, name: "Gel Manicure", desc: "Long-wear gel polish", dur: 60, buf: 5, price: 5200 },
    { cat: 0, name: "Classic Pedicure", desc: "Soak, exfoliate, polish", dur: 60, buf: 10, price: 5800 },
    { cat: 0, name: "Gel-X Extensions", desc: "Full-set soft gel extensions", dur: 105, buf: 10, price: 9500, approval: true },
    { cat: 0, name: "Acrylic Fill", desc: "Fill + rebalance", dur: 75, buf: 5, price: 6200 },
    { cat: 0, name: "Nail Art (per nail)", desc: "Hand-painted detail", dur: 15, price: 800, online: false },
    { cat: 1, name: "Haircut & Style", desc: "Consult, cut, blowout", dur: 60, buf: 10, price: 7800 },
    { cat: 1, name: "Balayage", desc: "Hand-painted dimension + toner", dur: 180, proc: 45, buf: 15, price: 24000, approval: true },
    { cat: 1, name: "Full Color", desc: "Root-to-tip single process", dur: 120, proc: 30, buf: 10, price: 14500 },
    { cat: 1, name: "Blowout", desc: "Wash + style", dur: 45, price: 5200 },
    { cat: 1, name: "Deep Conditioning", desc: "Repair mask treatment", dur: 30, price: 3500 },
    { cat: 2, name: "Classic Lash Full Set", desc: "1:1 extensions", dur: 120, buf: 10, price: 16000, approval: true },
    { cat: 2, name: "Lash Fill", desc: "2-3 week fill", dur: 75, buf: 5, price: 8500 },
    { cat: 2, name: "Lash Lift & Tint", desc: "Natural curl + tint", dur: 60, price: 9500 },
  ];

  const svcIds: number[] = [];
  const svcMeta: { id: number; cat: number; dur: number; proc: number; buf: number; price: number }[] = [];
  for (const s of svcDefs) {
    const [{ id }] = await db
      .insert(services)
      .values({
        salonId,
        categoryId: catIds[s.cat],
        name: s.name,
        description: s.desc,
        durationMin: s.dur,
        processingMin: s.proc ?? 0,
        bufferMin: s.buf ?? 0,
        priceCents: s.price,
        onlineBookable: s.online ?? true,
        requiresApproval: s.approval ?? false,
      })
      .$returningId();
    svcIds.push(id);
    svcMeta.push({ id, cat: s.cat, dur: s.dur, proc: s.proc ?? 0, buf: s.buf ?? 0, price: s.price });
  }

  // Qualifications: techs can do all services in their group; seniors cross-trained
  for (let i = 0; i < staffSeed.length; i++) {
    const group = staffSeed[i].group;
    const catIdx = group === "nails" ? 0 : group === "hair" ? 1 : 2;
    for (const svc of svcMeta.filter((s) => s.cat === catIdx)) {
      await db.insert(staffServices).values({ staffId: staffIds[i], serviceId: svc.id });
    }
  }
  // Cross-train: Maya (nails 0) + Grace (nails 4) can do lash fills; Elena (hair 7) can do blowouts already
  await db.insert(staffServices).values({ staffId: staffIds[0], serviceId: svcMeta[12].id });
  await db.insert(staffServices).values({ staffId: staffIds[4], serviceId: svcMeta[12].id });

  // ---- Clients ----
  const clientDefs = [
    { first: "Hannah", last: "Lee", phone: "(415) 555-0182", email: "hannah.l@example.com", notes: [{ kind: "allergy" as const, text: "Latex allergy — use nitrile gloves", pinned: true }] },
    { first: "Olivia", last: "Martinez", phone: "(415) 555-0117", email: "olivia.m@example.com", notes: [] },
    { first: "Emma", last: "Chen", phone: "(628) 555-0143", email: "emma.chen@example.com", notes: [{ kind: "preference" as const, text: "Prefers square nail shape, neutral tones", pinned: true }] },
    { first: "Ava", last: "Johnson", phone: "(415) 555-0199", email: "ava.j@example.com", notes: [{ kind: "alert" as const, text: "Running-late risk — confirm morning-of", pinned: true }] },
    { first: "Mia", last: "Kowalski", phone: "(628) 555-0166", email: "mia.k@example.com", notes: [] },
    { first: "Sophia", last: "Nguyen", phone: "(415) 555-0128", email: "sophia.n@example.com", notes: [{ kind: "allergy" as const, text: "Sensitive to acetone — soak-off only", pinned: true }] },
    { first: "Isabella", last: "Rossi", phone: "(415) 555-0171", email: "isabella.r@example.com", notes: [] },
    { first: "Luna", last: "Park", phone: "(628) 555-0150", email: "luna.p@example.com", notes: [{ kind: "preference" as const, text: "Always books with Maya", pinned: false }] },
    { first: "Zoe", last: "Fitzgerald", phone: "(415) 555-0105", email: "zoe.f@example.com", notes: [], blocked: true },
    { first: "Aria", last: "Hassan", phone: "(628) 555-0190", email: "aria.h@example.com", notes: [{ kind: "alert" as const, text: "2 no-shows — deposit required", pinned: true }] },
    { first: "Ella", last: "Thompson", phone: "(415) 555-0144", email: "ella.t@example.com", notes: [] },
    { first: "Scarlett", last: "Diaz", phone: "(628) 555-0121", email: "scarlett.d@example.com", notes: [] },
  ];

  const clientIds: number[] = [];
  for (const c of clientDefs) {
    const [{ id }] = await db
      .insert(clients)
      .values({
        salonId,
        firstName: c.first,
        lastName: c.last,
        phone: c.phone,
        email: c.email,
        blocked: c.blocked ?? false,
      })
      .$returningId();
    clientIds.push(id);
    for (const n of c.notes) {
      await db.insert(clientNotes).values({ clientId: id, kind: n.kind, text: n.text, pinned: n.pinned });
    }
  }

  // ---- Appointments ----
  const mkAppt = async (
    clientIdx: number,
    dateOffset: number,
    status: "requested" | "confirmed" | "checked-in" | "in-progress" | "completed" | "cancelled" | "no-show",
    source: "front-desk" | "online" | "walk-in",
    items: { svcIdx: number; staffIdx: number | null; start: number; anyStaff?: boolean; sameGroup?: string }[],
    note?: string,
    sameTimeGroupId?: string,
  ) => {
    const segs = items.map((i) => {
      const svc = svcMeta[i.svcIdx];
      return {
        serviceId: svc.id,
        staffId: i.staffIdx !== null ? staffIds[i.staffIdx] : null,
        requestedStaffId: null,
        anyStaff: i.anyStaff ?? false,
        startMin: i.start,
        endMin: i.start + svc.dur,
        durationMin: svc.dur,
        processingMin: svc.proc,
        bufferMin: svc.buf,
        priceCents: svc.price,
      };
    });
    const [{ id }] = await db
      .insert(appointments)
      .values({
        salonId,
        clientId: clientIds[clientIdx],
        status,
        source,
        date: addDays(dateOffset),
        startMin: Math.min(...segs.map((s) => s.startMin)),
        endMin: Math.max(...segs.map((s) => s.endMin)),
        noteToSalon: note,
        sameTimeGroupId,
      })
      .$returningId();
    await db.insert(appointmentServices).values(segs.map((s) => ({ ...s, appointmentId: id })));
    return id;
  };

  // Today
  const t0 = Math.max(600, Math.ceil((NOW_MIN - 90) / 15) * 15); // in-progress started ~1.5h ago
  await mkAppt(0, 0, "in-progress", "front-desk", [{ svcIdx: 1, staffIdx: 0, start: t0 }]); // Hannah gel mani w/ Maya
  await mkAppt(1, 0, "checked-in", "online", [{ svcIdx: 6, staffIdx: 7, start: t0 + 30 }]); // Olivia haircut w/ Elena
  await mkAppt(2, 0, "confirmed", "online", [
    { svcIdx: 0, staffIdx: 1, start: 840, sameGroup: "g1" }, // Emma mani 14:00
    { svcIdx: 2, staffIdx: 3, start: 840, sameGroup: "g1" }, // + pedi SAME TIME w/ Amy
  ], "Mani + pedi at the same time please!", "g1");
  await mkAppt(3, 0, "confirmed", "front-desk", [{ svcIdx: 7, staffIdx: 8, start: 600 }]); // Ava balayage w/ Marco 10:00 (processing)
  await mkAppt(4, 0, "confirmed", "online", [{ svcIdx: 12, staffIdx: 12, start: 960 }]); // Mia lash fill 16:00
  await mkAppt(5, 0, "confirmed", "walk-in", [{ svcIdx: 9, staffIdx: 11, start: 900 }]); // Sophia blowout 15:00
  await mkAppt(6, 0, "requested", "online", [{ svcIdx: 3, staffIdx: 4, start: 1020 }]); // Isabella gel-x request 17:00
  await mkAppt(7, 0, "confirmed", "online", [{ svcIdx: 0, staffIdx: null, start: 780, anyStaff: true }]); // Luna unassigned 13:00
  await mkAppt(9, 0, "no-show", "online", [{ svcIdx: 10, staffIdx: 10, start: 540 }]); // Aria no-show 9:00
  await mkAppt(10, 0, "cancelled", "online", [{ svcIdx: 13, staffIdx: 13, start: 1080 }]); // Ella cancelled

  // Tomorrow + coming days
  await mkAppt(1, 1, "confirmed", "online", [{ svcIdx: 1, staffIdx: 0, start: 600 }]);
  await mkAppt(2, 1, "confirmed", "online", [{ svcIdx: 8, staffIdx: 8, start: 720 }]); // full color w/ Marco (processing)
  await mkAppt(4, 1, "confirmed", "front-desk", [{ svcIdx: 4, staffIdx: 6, start: 840 }]);
  await mkAppt(5, 2, "confirmed", "online", [{ svcIdx: 11, staffIdx: 13, start: 600 }]); // lash full set
  await mkAppt(6, 2, "confirmed", "online", [{ svcIdx: 6, staffIdx: 9, start: 660 }]);
  await mkAppt(10, 2, "confirmed", "online", [{ svcIdx: 2, staffIdx: 3, start: 780 }]);
  await mkAppt(11, 3, "confirmed", "online", [{ svcIdx: 7, staffIdx: 7, start: 600 }]); // balayage w/ Elena
  await mkAppt(0, 3, "confirmed", "front-desk", [{ svcIdx: 13, staffIdx: 14, start: 900 }]);
  await mkAppt(3, 4, "confirmed", "online", [{ svcIdx: 12, staffIdx: 12, start: 720 }]);
  await mkAppt(7, 5, "confirmed", "online", [{ svcIdx: 1, staffIdx: 4, start: 600 }]);
  await mkAppt(9, 6, "confirmed", "online", [{ svcIdx: 9, staffIdx: 11, start: 660 }]);

  // Past (history) — last week, completed
  await mkAppt(0, -7, "completed", "online", [{ svcIdx: 1, staffIdx: 0, start: 600 }]);
  await mkAppt(0, -14, "completed", "online", [{ svcIdx: 2, staffIdx: 1, start: 660 }]);
  await mkAppt(0, -21, "completed", "front-desk", [{ svcIdx: 0, staffIdx: 0, start: 540 }]);
  await mkAppt(1, -5, "completed", "online", [{ svcIdx: 9, staffIdx: 7, start: 720 }]);

  // ---- Pending booking requests ----
  const mkReq = async (
    clientIdx: number,
    dateOffset: number,
    startMin: number,
    items: { svcIdx: number; staffIdx?: number; anyStaff?: boolean; sameTime?: boolean }[],
    note?: string,
  ) => {
    const [{ id }] = await db
      .insert(bookingRequests)
      .values({ salonId, clientId: clientIds[clientIdx], date: addDays(dateOffset), startMin, noteToSalon: note })
      .$returningId();
    await db.insert(bookingRequestItems).values(
      items.map((i) => ({
        requestId: id,
        serviceId: svcMeta[i.svcIdx].id,
        requestedStaffId: i.staffIdx !== undefined ? staffIds[i.staffIdx] : null,
        anyStaff: i.anyStaff ?? false,
        sameTime: i.sameTime ?? false,
      })),
    );
  };

  await mkReq(2, 1, 600, [{ svcIdx: 3, staffIdx: 4 }], "First time doing Gel-X — excited!");
  await mkReq(4, 2, 720, [{ svcIdx: 7, staffIdx: 8 }], "Want to go lighter for summer");
  await mkReq(6, 1, 900, [
    { svcIdx: 0, staffIdx: 1 },
    { svcIdx: 2, staffIdx: 3, sameTime: true },
  ], "Mani pedi same time if possible");
  await mkReq(11, 3, 660, [{ svcIdx: 12, anyStaff: true }], undefined);

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
