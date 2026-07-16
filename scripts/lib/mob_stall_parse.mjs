// Pure parsing and threshold logic for scripts/mob_stall_repro.mjs, kept
// side-effect-free so the Vitest suite (tests/mob_stall_parse.test.ts) can pin
// the server heartbeat formats token by token. The harness entry script stays
// a thin orchestrator per scripts/CLAUDE.md; these regexes mirror the server's
// [perf] / [perf.sim] emitters in server/game.ts and must track them.

export function boundedInt(raw, fallback, min, max) {
  // A set-but-empty env var must mean "unset", not Number('') === 0 silently
  // clamping to the minimum.
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function num(re, line) {
  const m = re.exec(line);
  return m ? Number(m[1]) : null;
}

// Extracts a "name=p95/max" timing pair. The \b prefix keeps `tick=` from
// matching inside `tickMs=` or `tickHz=`; requiring the second "/number" keeps
// scalar fields (tickMs=1.83) from matching a pair-shaped name.
export function timingPair(name, line) {
  const m = new RegExp(`\\b${name}=([\\d.]+)/([\\d.]+)`).exec(line);
  return m ? { p95: Number(m[1]), max: Number(m[2]) } : null;
}

export function parseHeartbeat(line) {
  const tickHzMatch = /\btickHz=(n\/a|[\d.]+)/.exec(line);
  const tickHz = tickHzMatch ? (tickHzMatch[1] === 'n/a' ? null : Number(tickHzMatch[1])) : null;
  const timings = {};
  for (const name of ['total', 'tick', 'broadcast', 'bcastSelf', 'bcastGrid', 'events', 'social']) {
    const p = timingPair(name, line);
    if (p) timings[name] = p;
  }
  return {
    online: num(/\bonline=(\d+)/, line),
    ents: num(/\bents=(\d+)/, line),
    tickHz,
    tickMs: num(/\btickMs=([\d.]+)/, line),
    over: / OVER\b/.test(line),
    timings,
    visits: num(/\bvisits=(\d+)/, line),
    serializes: num(/\bserializes=(\d+)/, line),
    serializeMs: num(/\bserializeMs=([\d.]+)/, line),
    aggroVisits: num(/\baggroVisits=(\d+)/, line),
    threatVisits: num(/\bthreatVisits=(\d+)/, line),
  };
}

export function parseSimline(line) {
  const body = line.replace(/^\[perf\.sim\]\s+mean\/p95\/max\s+/, '');
  const buckets = {};
  const re = /([A-Za-z0-9.|_]+)=([\d.]+)\/([\d.]+)\/([\d.]+)/g;
  for (const m of body.matchAll(re)) {
    buckets[m[1]] = { mean: Number(m[2]), p95: Number(m[3]), max: Number(m[4]) };
  }
  return buckets;
}

// Judges whether staging produced the scenario's signature counter. `empty`
// distinguishes "no heartbeats were parsed at all" (a plumbing problem:
// PERF_TICK_LOG off, wrong SERVER_LOG) from a genuine signature miss (usually
// stale content coordinates), so the caller can print the right hint.
export function evaluateStaging(fresh, sig, botCount) {
  if (fresh.length === 0) {
    return {
      ok: false,
      empty: true,
      detail: 'no [perf] heartbeat lines were observed during the staging window',
    };
  }
  const maxAggro = fresh.reduce((m, h) => Math.max(m, h.aggroVisits ?? 0), 0);
  const maxThreat = fresh.reduce((m, h) => Math.max(m, h.threatVisits ?? 0), 0);
  if (sig === 'aggro') {
    const need = botCount; // at least one idle mob scanning the whole crowd
    return {
      ok: maxAggro >= need,
      empty: false,
      detail: `aggroVisits max=${maxAggro} (need >= ${need}); threatVisits max=${maxThreat} (expect ~0)`,
    };
  }
  // Both tap scenarios prove the signature with threatVisits clearly scaling past a
  // half-crowd table. mass-pull spreads across several camp mobs that leash and respawn,
  // so its tables never all fill at once; boss-pulse holds one big table but churns as
  // the boss AoE kills and the crowd re-taps. A half-N floor confirms the mechanism
  // without flaking on that churn (the heartbeats and captures carry the magnitude).
  const need = Math.max(2, Math.floor(botCount / 2));
  return {
    ok: maxThreat >= need,
    empty: false,
    detail: `threatVisits max=${maxThreat} (need >= ${need}); aggroVisits max=${maxAggro}`,
  };
}
