// Observation adapter: distill the live world (bot.self + bot.ents + party) into
// a compact, token-bounded JSON snapshot for the LLM planner. Pure read-only.
// Mirrors the wire-short fields the multibox brain already uses.

const r1 = (n) => Math.round((n ?? 0) * 10) / 10;     // 1 decimal
const frac = (a, b) => (b > 0 ? Math.round((a / b) * 100) / 100 : 0);

function selfSummary(s) {
  if (!s) return null;
  return {
    class: s.cls ?? s.class ?? '?',
    level: s.lv ?? 1,
    hpFrac: frac(s.hp, s.mhp),
    resFrac: frac(s.res, s.mres),
    pos: { x: Math.round(s.x ?? 0), z: Math.round(s.z ?? 0) },
    inCombat: !!s.inCombat,
    dead: !!s.dead,
    gcd: r1(s.gcd),
    target: s.target ?? null,
    auras: Array.isArray(s.auras) ? s.auras.slice(0, 8) : [],
    bagItems: Array.isArray(s.inv) ? s.inv.length : 0,
  };
}

// nearest N hostiles, with whether each is already aggroed on us/party
function threats(bot, n = 6) {
  const me = bot.self; if (!me) return [];
  const out = [];
  for (const e of bot.ents.values()) {
    if (e.k !== 'mob' || e.dead) continue;
    const dx = (e.x ?? 0) - (me.x ?? 0), dz = (e.z ?? 0) - (me.z ?? 0);
    const dist = Math.round(Math.hypot(dx, dz));
    out.push({ id: e.id, name: e.nm ?? '?', level: e.lv ?? 0, dist, hostile: !!e.h, dead: false });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, n);
}

/** Build the compact snapshot the planner will reason over. */
export function summarize(ctx) {
  const { leader, bots = [], phase, arrived, now } = ctx;
  const lead = leader ?? bots[0];
  const recent = (lead?.events ?? []).slice(-6).map((e) => e.type ?? e).filter(Boolean);
  const party = bots.map((b) => ({
    name: b.charName, class: b.self?.cls, lv: b.self?.lv,
    hpFrac: frac(b.self?.hp, b.self?.mhp), dead: !!b.self?.dead,
  }));
  return {
    t: now ?? Date.now(),
    phase: phase ?? 'grind',
    arrived: !!arrived,
    self: selfSummary(lead?.self),
    threats: lead ? threats(lead) : [],
    nearbyHostiles: lead ? threats(lead, 30).filter((m) => m.hostile).length : 0,
    party,
    recentEvents: recent,
  };
}

// Roughly how big the snapshot is (chars) — keep prompts cheap.
export function snapshotSize(snap) { return JSON.stringify(snap).length; }
