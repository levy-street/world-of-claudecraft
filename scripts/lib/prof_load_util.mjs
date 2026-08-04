// Pure helpers for the professions load rig (scripts/load_professions.mjs),
// extracted per the scripts/CLAUDE.md module-first rule so each is unit-tested
// in tests/prof_load_util.test.ts while the entry script stays an orchestrator.

/** Integer env parsing with silent clamping into [min, max]; a non-numeric or
 *  unset value takes the fallback. Named apart from mob_stall_parse.mjs's
 *  boundedInt on purpose: the two parse differently (this one is parseInt
 *  semantics, the sibling is Number+trunc) and each preserves its own rig's
 *  historical behavior; a shared name would invite silent cross-imports. */
export function boundedEnvInt(raw, fallback, min, max) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Deterministic per-bot rng so tour routes are stable across runs of one
 *  scenario (comparable baselines); this is rig code, not sim code. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** A letters-only suffix for classic-legal character names, distinct per
 *  non-negative index. */
export function lettersOf(n) {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    s = LETTERS[x % 26] + s;
    x = Math.floor(x / 26);
  }
  return s;
}

/** A distinct PRIVATE-range (RFC 1918) X-Forwarded-For address per bot, so a
 *  loopback fleet spreads across per-IP buckets without impersonating any
 *  public range. Collision-free across 1..65535. */
export function ipFor(n) {
  return `10.77.${(n >> 8) & 255}.${n & 255}`;
}

/** The URL a committed artifact may carry: credentials stripped (a
 *  basic-auth SERVER_URL must never land in a checked-in report). The query
 *  and hash go with them: a token parked in either is the same secret the
 *  userinfo strip exists to catch, and a base URL has no use for them. */
export function sanitizeBaseUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return 'invalid-url';
  }
}

/** The worst observer gap INCLUDING the terminal one: the span from the last
 *  snapshot to window close. `gapStats` only ever sees gaps BETWEEN two
 *  snapshots, so an observer that went silent for the last minute of the
 *  window reports the healthy gaps it had before dying and sails past the
 *  continuity ceiling. All three arguments are WINDOW-RELATIVE milliseconds,
 *  which is what makes the zero-snapshot case fall out: no snapshot means no
 *  last-snapshot mark, the terminal gap runs from window open, and the whole
 *  window IS the gap. Non-finite inputs read as 0 rather than poisoning the
 *  verdict with NaN. */
export function terminalAwareGapMax(gapMax, lastSnapAtMs, windowCloseAtMs) {
  const worst = Number.isFinite(gapMax) ? gapMax : 0;
  const lastAt = Number.isFinite(lastSnapAtMs) ? lastSnapAtMs : 0;
  const closeAt = Number.isFinite(windowCloseAtMs) ? windowCloseAtMs : 0;
  return Math.max(worst, Math.max(0, closeAt - lastAt));
}

/** Dry-footed standing spots with fishable water ahead: spiral out from the
 *  gather-node anchors (guaranteed near play space) probing the sim's own
 *  water walk; the discovered facing is reused verbatim by the bot. `sim` is
 *  the esbuild-bundled sim-data surface the rig loads at run time. */
export function findFishingSpots(sim, want) {
  const spots = [];
  const seen = new Set();
  for (let radius = 0; radius <= 96 && spots.length < want; radius += 12) {
    for (const node of sim.GATHER_NODES) {
      if (spots.length >= want) break;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const x = node.pos.x + Math.sin(ang) * radius;
        const z = node.pos.z + Math.cos(ang) * radius;
        const cell = `${Math.round(x / 8)},${Math.round(z / 8)}`;
        if (seen.has(cell)) continue;
        seen.add(cell);
        if (sim.groundHeight(x, z, sim.WORLD_SEED) < sim.waterLevelAt(x, z)) continue; // swimming
        for (let f = 0; f < 12; f++) {
          const facing = (f / 12) * Math.PI * 2;
          const sample = sim.firstFishableSampleAhead(x, z, facing, sim.WORLD_SEED);
          if (sample) {
            spots.push({ x, z, facing, zoneId: sim.zoneAt(sample.x, sample.z).id });
            break;
          }
        }
        if (spots.length >= want) break;
      }
    }
  }
  return spots;
}

/** Per-role reduction over the parsing observers: snapshot-size distribution,
 *  gap medians, and the ncd/tslot budget attribution. `gapStats` and
 *  `sampleStats` are injected (scripts/lib/bench_gate.mjs) so this stays a
 *  pure reduction. The median over per-observer p95s deliberately mirrors
 *  bench_gate's `pct(sorted, 50)` floor nearest-rank convention (the same
 *  floor(n/2) index), so the two summaries stay comparable. */
export function aggregateObservers(observers, { gapStats, sampleStats }) {
  const byRole = {};
  for (const role of ['gather', 'fish']) {
    const rows = observers.filter((o) => o.role === role);
    if (rows.length === 0) continue;
    const allSizes = rows.flatMap((o) => o.snapSizes);
    const allGapArrays = rows.map((o) => gapStats(o.snapTimes));
    const totalSnaps = rows.reduce((a, o) => a + o.snapCount, 0);
    const ncdCount = rows.reduce((a, o) => a + o.ncdCount, 0);
    const ncdBytes = rows.reduce((a, o) => a + o.ncdBytes, 0);
    const tslotCount = rows.reduce((a, o) => a + o.tslotCount, 0);
    const tslotBytes = rows.reduce((a, o) => a + o.tslotBytes, 0);
    byRole[role] = {
      observers: rows.length,
      snapshots: totalSnaps,
      snapBytes: sampleStats(allSizes),
      gapP95Median: +[...allGapArrays.map((g) => g.p95)]
        .sort((a, b) => a - b)
        [Math.floor(allGapArrays.length / 2)].toFixed(1),
      gapMaxWorst: Math.max(...allGapArrays.map((g) => g.max)),
      ncd: {
        presenceRatio: totalSnaps ? +(ncdCount / totalSnaps).toFixed(4) : 0,
        bytesPerSnapshot: totalSnaps ? +(ncdBytes / totalSnaps).toFixed(1) : 0,
        bytesWhenPresent: ncdCount ? +(ncdBytes / ncdCount).toFixed(1) : 0,
      },
      tslot: {
        presenceRatio: totalSnaps ? +(tslotCount / totalSnaps).toFixed(4) : 0,
        bytesPerSnapshot: totalSnaps ? +(tslotBytes / totalSnaps).toFixed(1) : 0,
        bytesWhenPresent: tslotCount ? +(tslotBytes / tslotCount).toFixed(1) : 0,
      },
    };
  }
  return byRole;
}
