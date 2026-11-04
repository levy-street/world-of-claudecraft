// The Hammer Council's mechanic AI for the raid bots (scripts/heart_raid.mjs
// BOSS=council; the plumbing is scripts/lib/heart_raid_bots.mjs): the two
// members (the Guardian of the Hammer and the Seam Singer), the cover from
// Mountain's Wrath (and the Mythic Echo) behind the pillars with Narrow
// Shelter's limit, Wake the Stone's marks carried to a spot, the Falling Rock
// shared by three or four, the Resonance spread, Mountain's Rush led through
// the cursed pillar and its lane left clear, Bond of the Stone broken by the
// off-tank dragging the Singer away, and the kicks on Seam Bolt and the Song
// (never on Wake the Stone). Reads only what the server sends.
//
// IGNORE=cover  the raid never hides from Mountain's Wrath (the key mechanic)
// ORDER=guardian,singer | singer,guardian  the damage dealers' kill order

import {
  COUNCIL_REACH,
  coverSpots,
  faceDistance,
  hiddenFrom,
  onFloor,
  parsePillar,
  pillarBetween,
  riseClear,
  rockSpot,
} from './heart_council_tactics.mjs';
import {
  add,
  alive,
  auraOf,
  DIFF,
  fightSec,
  fmtSec,
  HEROIC_PLUS,
  hasAura,
  hitsNear,
  hypot,
  IGNORE,
  log,
  perp,
  segDist,
  unit,
} from './heart_raid_bots.mjs';

const ROLES = ['guardian', 'singer'];
const ORDER = (process.env.ORDER ?? 'guardian,singer')
  .toLowerCase()
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (ORDER.length !== ROLES.length || !ROLES.every((r) => ORDER.includes(r)))
  throw new Error(`ORDER must name guardian and singer once each: ${ORDER}`);

const CAST = {
  wrath: 'heart_mountains_wrath',
  weight: 'heart_hammers_weight',
  rush: 'heart_mountains_rush',
  wake: 'heart_wake_the_stone',
  rock: 'heart_falling_rock',
  bolt: 'heart_seam_bolt',
  song: 'heart_song_of_the_seam',
  echo: 'heart_echo_of_wrath',
};
const AURA = {
  weight: 'heart_hammers_weight',
  wake: 'heart_wake_mark',
  rock: 'heart_falling_rock_mark',
  rush: 'heart_mountains_rush_mark',
  resonance: 'heart_resonance',
  bond: 'heart_bond_of_the_stone',
  stunned: 'heart_rush_shattered',
};
const NAMES = {
  wrath: "Mountain's Wrath",
  echo: 'Echo of Wrath',
  rock: 'Falling Rock',
  tremor: 'Rockfall Tremor',
  rush: "Mountain's Rush",
  cursed: 'Cursed Pillar',
  bond: 'Bond of the Stone',
  collapse: 'Quarry Collapse',
  resonance: 'Resonance',
};
const RUBBLE = 'sh_council_rubble';
const RISE_SPOT = 'sh_council_rise_spot';
const CURSED = 'sh_council_cursed';
/** Narrow Shelter: how many one pillar shields (COUNCIL_DIFFICULTY). */
const SHELTER = { normal: 5, heroic: 4, mythic: 3 }[DIFF];
const RUSH_LANE = 2.5 + 1.0; // half width + girth, and a margin
const BOND_REACH = 20;

const rem = (e, id) => auraOf(e, id)?.rem ?? auraOf(e, id)?.remaining ?? 5;

function pillarsKey(world) {
  return [...world.pillars.values()].map((p) => `${p.id}:${p.integrity}`).join(',');
}

export const council = {
  key: 'council',
  title: 'Hammer Council',
  tids: { guardian: 'heart_hammer_guardian', singer: 'heart_seam_singer' },
  swapAura: AURA.weight,
  swapStacks: 1,
  tp: '/dev heart tp pit',
  setup(diff) {
    const out = ['/dev heart kill pack h1', '/dev heart kill pack h2', '/dev heart kill pack h3'];
    if (diff === 'mythic') out.push('/dev heart council mythic on');
    else if (diff === 'heroic') out.push('/dev heart council heroic on');
    else out.push('/dev heart council heroic off', '/dev heart council mythic off');
    return out;
  },

  onFloor(world, at) {
    return onFloor(at, world.floor, 5);
  },

  locate(world) {
    world.council = world.mobs;
    readPillars(world);
    const cols = [...world.pillars.values()].filter((p) => !p.risen && !p.soul);
    if (cols.length < 5) return false;
    world.center = {
      x: cols.reduce((s, p) => s + p.x, 0) / cols.length,
      z: cols.reduce((s, p) => s + p.z, 0) / cols.length,
    };
    world.floor = { x: world.center.x, z: world.center.z, rx: 46, rz: 40 };
    const away = unit(world.center, world.obs.self);
    world.home = away;
    // The Guardian just past the middle; the Singer dragged off to one side
    // well past Bond of the Stone's reach; the raid near the Guardian.
    world.tankG = add(world.center, away, -3);
    world.tankS = add(add(world.center, perp(away), 30), away, -4);
    world.anchor = add(world.tankG, away, 4);
    world.prepull = add(world.center, away, 30);
    world.reach = 42;
    world.energyRate = 100 / 55;
    return true;
  },

  read(world) {
    readPillars(world);
    // The Singer's keeper counts as a tank (healers watch him, the rest
    // keep their threat under his).
    // The Guardian's swap partner counts as a tank (healers watch him, the
    // rest keep their threat under his).
    const sw = swapper(world);
    if (sw && alive(world.mobs.guardian)) {
      const p = world.players.get(sw.pid);
      if (p) p.tank = true;
    }
    // The Wrath's energy rate, measured (the soft enrage speeds it up).
    const h = holder(world);
    const now = Date.now();
    const pe = world.prevEnergy;
    if (h && pe && pe.id === h.id && (h.res ?? 0) > pe.res) {
      const dt = (now - pe.t) / 1000;
      if (dt > 0.5) {
        world.energyRate = 0.7 * world.energyRate + (0.3 * ((h.res ?? 0) - pe.res)) / dt;
        world.prevEnergy = { id: h.id, res: h.res ?? 0, t: now };
      }
    } else if (h) world.prevEnergy = { id: h.id, res: h.res ?? 0, t: now };
  },

  obstacles(world) {
    const out = [...world.pillars.values()].map((p) => ({ x: p.x, z: p.z, r: p.r }));
    if (world.cursed) out.push({ x: world.cursed.x, z: world.cursed.z, r: 2.2 });
    return out;
  },
  blocksLine(world, a, b) {
    return !!pillarBetween(allWalls(world), a, b, 0.5);
  },
  tankSpot(world, st, b, t) {
    const g = world.mobs.guardian;
    if (t && t.id === g?.id) return world.tankG;
    // The off-tank waits at the Guardian's back for the swap.
    if (!t && b.offTank && alive(g)) return offTankSpot(world);
    // The Singer's keeper holds her past the Bond's reach of the Guardian;
    // once he fell she is brought to the raid's spot.
    if (alive(g) && t) return keeperSpot(world, st);
    return world.tankG;
  },
  targets(world, st, b) {
    if (keeper(world) === b && alive(world.mobs.guardian) && alive(world.mobs.singer))
      return world.mobs.singer;
    for (const r of ORDER) if (alive(world.mobs[r])) return world.mobs[r];
    return null;
  },
  roleSpot(world, st, b) {
    // Healers stand between the Guardian's tank and the Singer's keeper, so
    // both stay in reach.
    if (b.spec.role !== 'healer') return null;
    const g = world.mobs.guardian;
    const s = world.mobs.singer;
    if (!alive(g) || !alive(s) || hypot(g, s) < 22) return null;
    const mid = add(g, unit(g, s), hypot(g, s) * 0.45);
    const side = b.spec.key === 'h1' ? -1 : 1;
    return add(add(mid, world.home, 6), perp(unit(g, s)), side * 3);
  },
  tankAssign(world, st, b) {
    tankPlan(world, st, b);
  },
  kickables(world) {
    const s = world.mobs.singer;
    if (!alive(s) || (s.cast !== CAST.bolt && s.cast !== CAST.song)) return [];
    return [{ mob: s, cast: s.cast }];
  },
  stillFor(world, st) {
    const cr = st.activeCover ? Math.min(...coverCasts(world).map((c) => c.rem), 99) : 99;
    return Math.min(cr, secondsToBar(world) + 0.3);
  },

  track(world, st) {
    init(st);
    trackState(world, st);
  },
  plan(world, st) {
    planMechanics(world, st);
  },
  duty(world, st, b, me) {
    return duty(world, st, b, me);
  },
  hazards(world, st, b, me) {
    return hazardsFor(world, st, b, me);
  },
  bad(world, st, at) {
    return inLane(world, st, at);
  },
  statusLine(world) {
    const h = holder(world);
    const souls = soulPillars(world)
      .map((p) => `${p.soul}:${p.integrity}`)
      .join(' ');
    const g = world.mobs.guardian;
    const s = world.mobs.singer;
    const bond = alive(g) && alive(s) ? `${hypot(g, s).toFixed(0)} yd apart` : '-';
    return `energy ${h ? Math.round(h.res ?? 0) : '-'}; pillars ${coverPillars(world).length}${world.cursed ? ' + cursed' : ''}; bond ${bond}${souls ? `; souls ${souls}` : ''}`;
  },
  report(world, st, note) {
    note(`Kill order: ${ORDER.join(' > ')}`);
    const wrathHits = st.wraths.reduce((a, w) => a + w.hits.length, 0);
    note(
      `Wraths: ${st.wraths.length} (players hit in total: ${wrathHits}; ${st.wraths.map((w, i) => `#${i + 1} ${w.hits.length} hit`).join('; ')})`,
    );
    if (st.echoes.length)
      note(
        `Echoes of Wrath: ${st.echoes.length} (${st.echoes.map((w, i) => `#${i + 1} ${w.hits.length} hit`).join('; ')})`,
      );
    const rises = st.pillarEvents.filter((e) => e.kind === 'rise').length;
    const falls = st.pillarEvents.filter((e) => e.kind === 'fall').length;
    note(`Pillars: ${rises} risen, ${falls} fallen`);
    const soaks = st.rocks.filter((r) => r.landedAt);
    note(
      `Falling Rocks: ${soaks.length} (${soaks.map((r) => `${r.who}: ${r.soakHits.length} under${r.tremor ? ', TREMOR' : ''}`).join('; ')})`,
    );
    note(
      `Rushes: ${st.rushes.length} (${st.rushes.map((r) => `${r.who}: ${r.outcome ?? '?'}`).join('; ')}); bond time together ${st.bondTicks ? (st.bondTicks / 10).toFixed(0) : 0} s`,
    );
    note(`Wake the Stone marks: ${st.wakes.length}; Resonance marks: ${st.resonance.length}`);
  },
  row(world, st) {
    const wrathHits = st.wraths.reduce((a, w) => a + w.hits.length, 0);
    const bd = (r) => (st.bossDeaths[r] !== undefined ? fmtSec(st.bossDeaths[r]) : 'alive');
    return [
      ['Guardian', bd('guardian')],
      ['Singer', bd('singer')],
      ['Wraths (hit)', `${st.wraths.length} (${wrathHits})`],
      [
        'Rush hit cursed',
        `${st.rushes.filter((r) => r.outcome === 'cursed').length}/${st.rushes.length}`,
      ],
    ];
  },
};

function init(st) {
  if (st.wraths) return;
  Object.assign(st, {
    wraths: [],
    echoes: [],
    rocks: [],
    wakes: [],
    resonance: [],
    rushes: [],
    pillarEvents: [],
    activeCover: null,
    rock: null,
    wakePlan: new Map(),
    prevPillars: new Map(),
    prevCasts: new Map(),
    prevAuras: new Map(),
    echoNext: new Map(),
    rush: null,
    bondTicks: 0,
  });
}

// ---- reading the Quarry -----------------------------------------------------------------

function readPillars(world) {
  const pillars = new Map();
  const rubble = [];
  const rise = [];
  let cursed = null;
  for (const e of world.obs.ents.values()) {
    if (e.k !== 'object') continue;
    if (e.tid === CURSED) {
      cursed = { id: e.id, x: e.x, z: e.z, r: 2.2 };
      continue;
    }
    const p = parsePillar(e.tid);
    if (p) {
      pillars.set(e.id, {
        id: e.id,
        tid: e.tid,
        x: e.x,
        z: e.z,
        ...p,
        cast: e.cast ?? null,
        castRem: e.castRem ?? 0,
        auras: e.auras ?? [],
      });
      continue;
    }
    if (e.tid === RUBBLE) rubble.push({ x: e.x, z: e.z, r: (e.sc ?? 3) + 1 });
    else if (typeof e.tid === 'string' && e.tid.startsWith(RISE_SPOT))
      rise.push({ x: e.x, z: e.z, r: (e.sc ?? 3) + 1.4 });
  }
  world.pillars = pillars;
  world.rubble = rubble;
  world.riseSpots = rise;
  world.cursed = cursed;
}

function allWalls(world) {
  const w = [...world.pillars.values()];
  if (world.cursed) w.push(world.cursed);
  return w;
}
function coverPillars(world) {
  return [...world.pillars.values()].filter((p) => !p.soul);
}
function soulPillars(world) {
  return [...world.pillars.values()].filter((p) => p.soul);
}
function holder(world) {
  let best = null;
  for (const r of ROLES) {
    const m = world.mobs[r];
    if (!alive(m) || m.rtype !== 'energy') continue;
    if (!best || (m.res ?? 0) > (best.res ?? 0)) best = m;
  }
  return best;
}
function secondsToBar(world) {
  const h = holder(world);
  if (!h) return Number.POSITIVE_INFINITY;
  if (h.cast === CAST.wrath) return 0;
  return Math.max(0, 100 - (h.res ?? 0)) / Math.max(0.5, world.energyRate ?? 1.8);
}
function coverCasts(world) {
  const out = [];
  for (const r of ROLES) {
    const m = world.mobs[r];
    if (alive(m) && m.cast === CAST.wrath)
      out.push({ kind: 'wrath', id: m.id, x: m.x, z: m.z, rem: m.castRem ?? 0 });
  }
  for (const p of world.pillars.values()) {
    if (p.cast === CAST.echo)
      out.push({ kind: 'echo', id: p.id, x: p.x, z: p.z, rem: p.castRem ?? 0 });
  }
  return out;
}
function where(world, p) {
  return world.center ? `${hypot(world.center, p).toFixed(0)} yd from the middle` : '?';
}

// ---- the log ----------------------------------------------------------------------------

function trackState(world, st) {
  const now = Date.now();
  const lastRock = st.rocks[st.rocks.length - 1];
  if (lastRock && !lastRock.landedAt) {
    const still = world.living().some((p) => hasAura(p, AURA.rock));
    if (!still) {
      lastRock.landedAt = now;
      setTimeout(() => {
        lastRock.soakHits = hitsNear(st, NAMES.rock, lastRock.landedAt);
        lastRock.tremor = hitsNear(st, NAMES.tremor, lastRock.landedAt).length;
        log(
          `ROCK landed on ${lastRock.who}: ${lastRock.soakHits.length} under it (${lastRock.soakHits.map((h) => `${h.who} ${h.amount}`).join(', ') || 'nobody'})${lastRock.tremor ? `, TREMOR on ${lastRock.tremor}` : ''}`,
        );
      }, 1100);
    }
  }
  const casters = [];
  for (const r of ROLES) if (world.mobs[r]) casters.push({ key: r, e: world.mobs[r] });
  for (const p of world.pillars.values()) casters.push({ key: `pillar#${p.id}`, e: p });
  for (const { key, e } of casters) {
    const prev = st.prevCasts.get(key) ?? null;
    const cur = e.cast ?? null;
    if (cur !== prev) {
      if (prev) castEnded(world, st, key, prev, e);
      if (cur) castStarted(world, st, key, cur, e);
      st.prevCasts.set(key, cur);
    }
  }
  for (const [id, p] of world.pillars) {
    const before = st.prevPillars.get(id);
    if (!before) {
      if (st.prevPillars.size > 0) {
        log(`PILLAR #${id} rises (${p.risen ? 'risen' : 'column'}) at ${where(world, p)}`);
        st.pillarEvents.push({ t: fightSec(), kind: 'rise', id });
      }
      continue;
    }
    if (p.soul && !before.soul) {
      log(`SOUL: the ${p.soul}'s soul takes pillar #${id}`);
      if (p.soul === 'guardian') st.echoNext.set(id, now + 12000);
    } else if (p.integrity < before.integrity)
      log(`CRACK: pillar #${id} ${before.integrity} -> ${p.integrity}`);
  }
  for (const [id, before] of st.prevPillars) {
    if (world.pillars.has(id)) continue;
    log(`PILLAR #${id} FALLS${before.soul ? ` (the ${before.soul}'s soul pillar)` : ''}`);
    st.pillarEvents.push({ t: fightSec(), kind: 'fall', id });
  }
  st.prevPillars = new Map([...world.pillars].map(([id, p]) => [id, { ...p }]));
  for (const [pid, p] of world.players) {
    const prev = st.prevAuras.get(pid) ?? new Set();
    const cur = new Set((p.auras ?? []).map((a) => a.id));
    if (cur.has(AURA.resonance) && !prev.has(AURA.resonance))
      st.resonance.push({ t: fightSec(), who: p.name });
    st.prevAuras.set(pid, cur);
  }
  // Bond of the Stone: the time the two spend together.
  const g = world.mobs.guardian;
  const s = world.mobs.singer;
  if (alive(g) && alive(s) && st.engagedAt && hypot(g, s) < BOND_REACH) st.bondTicks++;
  // Who holds each member (a change logged: a lost Singer is the Bond).
  for (const r of ROLES) {
    const m = world.mobs[r];
    const on = alive(m) && m.aggro != null ? (world.players.get(m.aggro)?.name ?? '?') : null;
    const key = `hold_${r}`;
    if (on !== (st[key] ?? null)) {
      if (on && st.engagedAt)
        log(
          `  ${r} now on ${on}${r === 'singer' && alive(g) && alive(s) ? ` (${hypot(g, s).toFixed(0)} yd from the guardian)` : ''}`,
        );
      st[key] = on;
    }
  }
  // The Rush's outcome: the Guardian stunned (the cursed pillar broken), or
  // whoever its blow struck.
  const r = st.rushes[st.rushes.length - 1];
  if (r && !r.outcome && r.landedAt && now - r.landedAt > 2600) {
    const hits = hitsNear(st, NAMES.rush, r.landedAt, 0, 2600);
    r.outcome = r.stunned
      ? 'cursed'
      : hits.length
        ? `hit ${hits.map((h) => h.who).join(', ')}`
        : 'missed, nobody hit';
    log(`RUSH outcome: ${r.outcome}`);
  }
  if (r && !r.stunned && hasAura(g, AURA.stunned)) r.stunned = true;
}

function castStarted(world, st, key, castId, e) {
  if (castId === CAST.wrath) {
    st.activeCover = null;
    log(`WRATH cast by the ${key}: ${(e.castRem ?? 0).toFixed(1)} s to hide`);
  } else if (castId === CAST.echo) {
    log(`ECHO OF WRATH charging on soul pillar ${key}`);
    st.echoNext.set(e.id, Date.now() + 20000);
  } else if (castId === CAST.rush) {
    const t = world.players.get(e.castTgt);
    log(`MOUNTAIN'S RUSH marks ${t?.name ?? '?'}${world.cursed ? ' (cursed pillar up)' : ''}`);
    st.rushes.push({ t: fightSec(), who: t?.name ?? '?', pid: e.castTgt, outcome: null });
  } else if (castId === CAST.weight)
    log(`HAMMER'S WEIGHT cast at ${world.players.get(e.castTgt)?.name ?? '?'}`);
  else if (castId === CAST.wake) log('WAKE THE STONE cast');
  else if (castId === CAST.rock) log(`FALLING ROCK cast by the ${key}`);
}

function castEnded(world, st, key, castId, e) {
  if (castId === CAST.rush) {
    const r = st.rushes[st.rushes.length - 1];
    const t = r ? world.players.get(r.pid) : null;
    const g = world.mobs.guardian;
    if (r && t && alive(g)) {
      // The line is fixed where the marked player stands as the bar lands.
      const dir = unit(g, t);
      const { hit, stop } = rushStop(world, g, t);
      r.landedAt = Date.now();
      r.aim = hit ? (hit.cursed ? 'the cursed pillar' : `pillar #${hit.id}`) : 'no pillar';
      st.rush = {
        from: { x: g.x, z: g.z },
        to: add(g, dir, stop),
        until: Date.now() + (0.8 + stop / 22) * 1000 + 600,
        pid: r.pid,
      };
      log(`  RUSH lands: the line meets ${r.aim} (${stop.toFixed(0)} yd)`);
    }
    return;
  }
  if (castId !== CAST.wrath && castId !== CAST.echo) return;
  const rec = { t: fightSec(), caster: key, landedAt: Date.now(), hits: [] };
  if (castId === CAST.wrath) {
    if (!alive(e)) return;
    st.wraths.push(rec);
  } else st.echoes.push(rec);
  setTimeout(() => {
    rec.hits = hitsNear(st, castId === CAST.wrath ? NAMES.wrath : NAMES.echo, rec.landedAt);
    log(
      `${castId === CAST.wrath ? 'WRATH' : 'ECHO'} landed: hit ${rec.hits.map((h) => `${h.who} ${h.amount}`).join(', ') || 'nobody'}`,
    );
  }, 1100);
  st.activeCover = null;
}

// ---- the plan ---------------------------------------------------------------------------

function planMechanics(world, st) {
  const now = Date.now();
  if (st.rush && now > st.rush.until) st.rush = null;
  let casts = IGNORE === 'cover' ? [] : coverCasts(world);
  let pre = false;
  const coming = [];
  const h = holder(world);
  if (IGNORE !== 'cover' && h && !casts.some((c) => c.kind === 'wrath')) {
    const heir = world.roleOfTid[h.tid] !== 'guardian';
    const toBar = secondsToBar(world);
    if (toBar <= (heir ? 3.2 : 1.8))
      coming.push({ kind: 'wrath', id: h.id, x: h.x, z: h.z, rem: toBar + (heir ? 3 : 4) });
  }
  for (const [id, at] of st.echoNext) {
    const p = world.pillars.get(id);
    if (!p || p.soul !== 'guardian') {
      st.echoNext.delete(id);
      continue;
    }
    const toBar = (at - now) / 1000;
    if (IGNORE !== 'cover' && toBar <= 2 && toBar > -0.5 && !casts.some((c) => c.id === id))
      coming.push({ kind: 'echo', id, x: p.x, z: p.z, rem: Math.max(0, toBar) + 3 });
  }
  if (coming.length > 0) {
    pre = casts.length === 0;
    casts = casts.concat(coming);
  }
  const key = `${casts.map((c) => `${c.kind}${c.id}`).join('+')}${pre ? `@${Math.floor(now / 600)}` : ''}`;
  if (casts.length === 0) st.activeCover = null;
  else if (
    !st.activeCover ||
    st.activeCover.key !== key ||
    st.activeCover.pillarsKey !== pillarsKey(world)
  )
    st.activeCover = planCover(world, st, casts, key, pre);

  const marked = world.living().find((p) => hasAura(p, AURA.rock));
  if (marked && (!st.rock || st.rock.pid !== marked.pid)) {
    st.rock = planRock(world, st, marked);
    st.rocks.push({ t: fightSec(), who: marked.name, landedAt: null, soakHits: [], tremor: 0 });
    log(
      `FALLING ROCK on ${marked.name}: soak with ${[...st.rock.soakers].map((pid) => world.players.get(pid)?.name).join(', ')} at ${where(world, st.rock.spot)}`,
    );
  } else if (!marked && st.rock) st.rock = null;
  if (st.rock && !world.players.get(st.rock.pid)?.bot) {
    const hm = world.players.get(st.rock.pid);
    if (hm) st.rock.spot = { x: hm.x, z: hm.z };
  }

  for (const p of world.players.values()) {
    if (p.dead || !hasAura(p, AURA.wake)) {
      st.wakePlan.delete(p.pid);
      continue;
    }
    if (st.wakePlan.has(p.pid)) continue;
    const spot = wakeSlot(world, st, p);
    st.wakePlan.set(p.pid, { spot, at: now });
    st.wakes.push({ t: fightSec(), who: p.name, ok: !!spot });
    log(
      `WAKE THE STONE on ${p.name}: carries it to ${spot ? where(world, spot) : 'nowhere clear (stays put)'}`,
    );
  }
}

/** The bearings (off the raid's side of the Wrath's caster) and the
 *  distances a Wake the Stone pillar is raised at: at the flanks of the
 *  ranged arc first, so the cover stands beside the raid and never in its
 *  line of fire; then wider, then nearer the middle. */
const WAKE_SLOTS = [
  [1, 12],
  [-1, 12],
  [-1.5, 12],
  [1.5, 12],
  [1, 17],
  [-1, 17],
  [-1.5, 17],
  [0.55, 9],
  [-0.55, 9],
  [0, 16],
];

/** Where a Wake the Stone mark carries his pillar: the first slot clear
 *  for a rise (no pillar, planned or standing, and no council body near)
 *  that he reaches with time to spare. */
function wakeSlot(world, st, p) {
  const src = world.tankG;
  const pillars = [...world.pillars.values()];
  if (world.cursed) pillars.push(world.cursed);
  for (const w of st.wakePlan.values()) if (w.spot) pillars.push({ ...w.spot });
  const bodies = ROLES.map((r) => world.mobs[r]).filter(alive);
  const secs = rem(p, AURA.wake);
  const base = Math.atan2(world.home.x, world.home.z);
  let best = null;
  WAKE_SLOTS.forEach(([da, r], i) => {
    const at = add(src, { x: Math.sin(base + da), z: Math.cos(base + da) }, r);
    if (!riseClear(at, pillars, bodies, world.floor, 0.8)) return;
    if (inLane(world, st, at)) return;
    const travel = hypot(p, at) / 7;
    if (travel > secs - 0.6) return;
    const cost = i * 1.5 + travel;
    if (!best || cost < best.cost) best = { at, cost };
  });
  return best?.at ?? null;
}

function planCover(world, st, casts, key, pre = false) {
  const sources = casts.map((c) => ({ x: c.x, z: c.z }));
  const cover = coverPillars(world);
  const remS = Math.min(...casts.map((c) => c.rem));
  const assign = new Map();
  const used = new Map();
  const people = world.living().filter((p) => p.bot);
  const forbidden = new Set();
  const rockGroup = rockCover(world, st, cover, sources, remS);
  const soaking = new Set();
  if (rockGroup?.open) {
    // No shadow with the room: the group soaks away from the cover.
    for (const p of rockGroup.group) soaking.add(p.pid);
  } else if (rockGroup) {
    for (const [pid, spot] of rockGroup.assign) {
      assign.set(pid, spot);
      used.set(spot.pillar.id, (used.get(spot.pillar.id) ?? 0) + 1);
    }
    for (const q of cover)
      if (faceDistance(q, rockGroup.at) <= COUNCIL_REACH.rock + 1) forbidden.add(q.id);
  }
  // The nearest first: the far ones then take what is left in reach.
  people.sort((a, b) => nearestCover(cover, a) - nearestCover(cover, b));
  for (const p of people) {
    if (assign.has(p.pid) || soaking.has(p.pid)) continue;
    const minFace = HEROIC_PLUS ? COUNCIL_REACH.pulse + 0.5 : 1.2;
    let best = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const pl of cover) {
      if (forbidden.has(pl.id)) continue;
      if ((used.get(pl.id) ?? 0) >= SHELTER) continue;
      for (const raw of coverSpots(pl, cover, sources, minFace)) {
        // The server counts a player against the FIRST pillar on the line
        // from the caster (council_wrath.ts landWrath), not the one he
        // meant to stand behind: count him there.
        const first =
          sources.length === 1 ? (pillarBetween(cover, sources[0], raw, 0.35) ?? pl) : pl;
        if (forbidden.has(first.id) || (used.get(first.id) ?? 0) >= SHELTER) continue;
        const spot = first === pl ? raw : { ...raw, pillar: first };
        if (!onFloor(spot, world.floor, 5)) continue;
        if (world.rubble.some((q) => hypot(q, spot) < q.r)) continue;
        if (world.riseSpots.some((q) => hypot(q, spot) < q.r)) continue;
        if (inLane(world, st, spot)) continue;
        const travel = hypot(p, spot) / 7;
        if (travel > remS - 0.3) continue;
        const sp = spot.pillar;
        const was = st.activeCover?.assign.get(p.pid)?.pillar?.id === sp.id ? 3 : 0;
        const pref =
          (sp.risen ? 0 : 1.2) + (sp.integrity - 1) * 2.5 - (used.get(sp.id) ?? 0) * 0.6 - was;
        const cost = travel + pref;
        if (cost < bestCost) {
          bestCost = cost;
          best = spot;
        }
      }
    }
    if (best) {
      assign.set(p.pid, best);
      used.set(best.pillar.id, (used.get(best.pillar.id) ?? 0) + 1);
    }
  }
  const summary =
    [...used.entries()].map(([id, n]) => `#${id} x${n}`).join(', ') || 'no reachable cover';
  const unplaced = people
    .filter((p) => !assign.has(p.pid) && !soaking.has(p.pid))
    .map((p) => p.name);
  const line = `${summary}${unplaced.length ? `; no spot in time for ${unplaced.join(', ')}` : ''}${rockGroup ? (rockGroup.open ? '; the rock soaks in the open' : `; the rock in #${rockGroup.pillar.id}'s shadow`) : ''}`;
  if (!pre && line !== st.lastCoverLine) log(`  cover plan: ${line}`);
  else if (pre && !st.lastCoverLine?.startsWith('pre'))
    log(`  moving to cover early (the bar is due): ${line}`);
  st.lastCoverLine = pre ? `pre ${line}` : line;
  return { key, pillarsKey: pillarsKey(world), assign, summary, sources, soaking };
}

function nearestCover(cover, p) {
  let d = Number.POSITIVE_INFINITY;
  for (const q of cover) d = Math.min(d, hypot(q, p));
  return d;
}

/** Who the Wrath's bar comes from and how long it runs (the heir's is
 *  shorter). */
function wrathTiming(world) {
  const h = holder(world);
  if (!h) return null;
  const heir = world.roleOfTid[h.tid] !== 'guardian';
  const bar = heir ? 3 : 4;
  const toBar = secondsToBar(world);
  return { h, bar, toBar, toLand: h.cast === CAST.wrath ? (h.castRem ?? 0) : toBar + bar };
}

/**
 * A Falling Rock shared in a pillar's shadow (it lands while the Wrath's bar
 * runs): the mark stands on the shadow's axis more than the rock's reach
 * from every cover pillar's face (no pillar loses a piece), the soakers
 * between him and the pillar, all hidden from the sources, the whole group
 * within that pillar's Narrow Shelter. Null when no pillar has the room.
 */
function rockShadow(world, st, marked, cover, sources, used, groupN, secs) {
  if (sources.length === 0) return null;
  const src = {
    x: sources.reduce((a, s) => a + s.x, 0) / sources.length,
    z: sources.reduce((a, s) => a + s.z, 0) / sources.length,
  };
  let best = null;
  for (const pl of cover) {
    if (pl.soul || SHELTER - (used?.get(pl.id) ?? 0) < groupN) continue;
    const u = unit(src, pl);
    for (const extra of [0, 1, 2])
      for (const side of [0, 0.8, -0.8]) {
        const at = add(add(pl, u, pl.r + COUNCIL_REACH.rock + 1.4 + extra), perp(u), side);
        if (!onFloor(at, world.floor, 5)) continue;
        if (cover.some((q) => faceDistance(q, at) <= COUNCIL_REACH.rock + 1)) continue;
        if (!hiddenFrom(cover, sources, at, 0.6)) continue;
        if (sources.some((s) => pillarBetween(cover, s, at, 0.35)?.id !== pl.id)) continue;
        if (world.rubble.some((q) => hypot(q, at) < q.r)) continue;
        if (inLane(world, st, at)) continue;
        const travel = hypot(marked, at) / 7;
        if (travel > secs - 0.4) continue;
        const cost = travel + extra * 0.2 + Math.abs(side) * 0.1;
        if (!best || cost < best.cost) best = { pillar: pl, at, u, cost };
      }
  }
  if (!best) return null;
  const spots = [];
  for (const [d, s] of [
    [-1.6, 0],
    [-3, 0],
    [-1.3, 1.2],
    [-1.3, -1.2],
  ]) {
    const at = add(add(best.at, best.u, d), perp(best.u), s);
    if (hiddenFrom(cover, sources, at, 0.4)) spots.push({ ...at, pillar: best.pillar });
  }
  return { pillar: best.pillar, at: { ...best.at, pillar: best.pillar }, spots };
}

/** The rock group's place through a Wrath bar: in a pillar's shadow when the
 *  rock lands inside the bar (or too late to soak first and hide after);
 *  `open` when no shadow has the room (the group soaks away from the cover
 *  and takes the blast rather than crack the raid's pillar). Null when the
 *  rock does not meet the Wrath. */
function rockCover(world, st, cover, sources, remS) {
  const rock = st.rock;
  if (!rock || IGNORE === 'rock') return null;
  const marked = world.players.get(rock.pid);
  if (!marked || marked.dead || !marked.bot) return null;
  const rockRem = rem(marked, AURA.rock);
  if (rockRem > remS + 0.3 || rockRem < remS - 2.4) return null;
  const group = [...rock.soakers]
    .map((pid) => world.players.get(pid))
    .filter((p) => p && !p.dead && p.bot);
  const n = Math.min(group.length, SHELTER);
  const sh = rockShadow(world, st, marked, cover, sources, null, n, rockRem);
  if (!sh) return { open: true, group };
  const assign = new Map([[marked.pid, sh.at]]);
  const others = group
    .filter((p) => p.pid !== marked.pid)
    .sort((x, y) => hypot(x, sh.at) - hypot(y, sh.at))
    .slice(0, n - 1);
  const spots = sh.spots.slice();
  for (const p of others) {
    spots.sort((x, y) => hypot(x, p) - hypot(y, p));
    const spot = spots.shift();
    if (spot) assign.set(p.pid, spot);
  }
  return { pillar: sh.pillar, at: sh.at, assign };
}

function planRock(world, st, marked) {
  const cover = coverPillars(world);
  const souls = soulPillars(world);
  const soul = souls.length
    ? souls.reduce((a, b) => (hypot(a, marked) < hypot(b, marked) ? a : b))
    : null;
  const g = world.mobs.guardian;
  const hazards = [...world.rubble, ...world.riseSpots];
  if (alive(g)) {
    const f = { x: Math.sin(g.f ?? 0), z: Math.cos(g.f ?? 0) };
    hazards.push({ ...add(g, f, 5), r: 6 });
  }
  for (const w of st.wakePlan.values()) if (w.spot) hazards.push({ ...w.spot, r: 4 });
  const candidates = world
    .living()
    .filter(
      (p) =>
        p.pid !== marked.pid &&
        p.bot &&
        !p.tank &&
        !p.healer &&
        !hasAura(p, AURA.wake) &&
        !hasAura(p, AURA.resonance) &&
        !(st.rushSpot?.pid === p.pid && laneNow(world, st)?.bar),
    )
    .filter((p) => p.hp / p.mhp > 0.45);
  const rockRem = rem(marked, AURA.rock);
  // The rock meets the Wrath's bar: plan it in a pillar's shadow now.
  const w = wrathTiming(world);
  if (w && soul === null && rockRem >= w.toBar - 0.5 && rockRem <= w.toLand + 0.3) {
    const n = Math.min(SHELTER, 4);
    const sh = rockShadow(world, st, marked, cover, [w.h], null, n, rockRem);
    if (sh) {
      const soakers = candidates.sort((a, b) => hypot(a, sh.at) - hypot(b, sh.at)).slice(0, n - 1);
      return {
        pid: marked.pid,
        spot: { x: sh.at.x, z: sh.at.z },
        soakers: new Set([marked.pid, ...soakers.map((p) => p.pid)]),
        shadow: true,
      };
    }
  }
  const home = add(world.anchor, world.home, 12);
  const spot = rockSpot({
    from: marked,
    cover,
    soul,
    hazards,
    floor: world.floor,
    home,
    homeWeight: 0.25,
  });
  const need = HEROIC_PLUS ? 4 : 3;
  candidates.sort((a, b) => hypot(a, spot ?? marked) - hypot(b, spot ?? marked));
  const soakers = new Set([marked.pid, ...candidates.slice(0, need).map((p) => p.pid)]);
  return { pid: marked.pid, spot: spot ?? { x: marked.x, z: marked.z }, soakers };
}

// ---- Mountain's Rush --------------------------------------------------------------------

/** The Rush's walls: every pillar (the cursed one too) widened by the
 *  charge's half width and the sight pad (council_rush.ts landRush). */
const RUSH_WALL = 2 + 0.35;
function rushWalls(world, pad = 0) {
  const all = [...world.pillars.values()];
  if (world.cursed) all.push({ ...world.cursed, cursed: true });
  return all.map((p) => ({ ...p, r: p.r + RUSH_WALL + pad }));
}

/** The first pillar on the charge's line from `g` through `at` (on to the
 *  Quarry's edge), and how far along it the Guardian stops. */
function rushStop(world, g, at, pad = 0) {
  const d = unit(g, at);
  const end = add(g, d, 70);
  const hit = pillarBetween(rushWalls(world, pad), g, end, 0);
  if (!hit) return { hit: null, stop: 70 };
  const along = (hit.x - g.x) * d.x + (hit.z - g.z) * d.z;
  return { hit, stop: Math.max(0, along - hit.r) };
}

/**
 * Where the marked player stands so the charge breaks the cursed pillar: a
 * spot whose line from the Guardian meets the cursed pillar first (no
 * sheltering pillar before it), the nearest he can reach in the bar's time.
 * Behind the pillar he can stay put (the Guardian stops at it); in front of
 * it he steps out of the lane as the bar lands. With no such spot, a line
 * that meets no pillar at all (the curse stays, no cover is lost). Returns
 * { at, kind: 'behind' | 'front' | 'miss' } or null.
 */
function rushSpot(world, st, me, secs) {
  const g = world.mobs.guardian;
  if (!alive(g)) return null;
  const c = world.cursed;
  const reach = Math.max(0, (secs - 0.45) * 7);
  let best = null;
  for (let r = 0; r <= reach + 1e-6; r += 1.25) {
    const n = r === 0 ? 1 : Math.max(10, Math.round((2 * Math.PI * r) / 1.25));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const at = { x: me.x + Math.sin(a) * r, z: me.z + Math.cos(a) * r };
      if (!onFloor(at, world.floor, 4)) continue;
      const dg = hypot(g, at);
      if (dg < 8) continue;
      if (world.rubble.some((q) => hypot(q, at) < q.r)) continue;
      if ([...world.pillars.values()].some((q) => hypot(q, at) < q.r + 1)) continue;
      // Margins: the cursed pillar met with a yard to spare, the others
      // missed with one.
      const tight = rushStop(world, g, at, -1);
      const wide = rushStop(world, g, at, 1);
      let kind = null;
      let cost = r;
      if (c && tight.hit?.cursed && wide.hit?.cursed) {
        if (c && hypot(at, c) < c.r + 1) continue;
        kind = dg > hypot(g, c) ? 'behind' : 'front';
        if (kind === 'front') cost += 6;
      } else if (!wide.hit || wide.hit.soul) {
        kind = 'miss';
        cost += 14;
      } else continue;
      if (!best || cost < best.cost) best = { at, kind, cost };
    }
  }
  return best;
}

/** Does a planned Rush spot still aim where it meant to? */
function rushStillGood(world, plan) {
  const g = world.mobs.guardian;
  if (!alive(g)) return false;
  const tight = rushStop(world, g, plan.at, -1);
  const wide = rushStop(world, g, plan.at, 1);
  if (plan.kind === 'miss') return !wide.hit || !!wide.hit.soul;
  return !!(tight.hit?.cursed && wide.hit?.cursed);
}

/** The fixed lane of a landed Rush (or the drawn lane of a running bar),
 *  from the Guardian to where it stops. */
function laneNow(world, st) {
  const g = world.mobs.guardian;
  if (st?.rush) return st.rush;
  if (!alive(g) || g.cast !== CAST.rush) return null;
  const t = world.players.get(g.castTgt);
  if (!t) return null;
  // The marked heads for his planned spot: draw the lane through it.
  const aim = st?.rushSpot?.pid === t.pid ? st.rushSpot.at : t;
  const { stop } = rushStop(world, g, aim);
  return { from: g, to: add(g, unit(g, aim), stop), pid: t.pid, bar: true };
}
function inLane(world, st, at) {
  const lane = laneNow(world, st);
  if (!lane) return false;
  return segDist(at, lane.from, lane.to) < RUSH_LANE;
}

// ---- a bot's duty -----------------------------------------------------------------------

/** The Singer's keeper while both live: the arms warrior holds her alone
 *  past the Bond's reach (Goad, no stance needed), so the two tanks swap
 *  the Guardian on Hammer's Weight without ever bringing her along. */
function keeper(world) {
  const k = world.bots.find((x) => x.spec.key === 'ot' && x.self && !x.self.dead);
  return k ?? null;
}

/** The Guardian's second tank for the Hammer's Weight swap while the
 *  off-tank keeps the Singer: the arms warrior (Goad, no stance needed). */
function swapper(world) {
  return world.bots.find((x) => x.spec.key === 'arms' && x.self && !x.self.dead) ?? null;
}

function swapperDuty(world, st, b, me) {
  const g = world.mobs.guardian;
  if (swapper(world) !== b || !alive(g) || st.mainTankPid !== b.pid || !st.engagedAt) return null;
  const holding = g.aggro === b.pid;
  const goal = holding
    ? world.tankG
    : hypot(me, g) > 6
      ? add(g, unit(g, me), 3)
      : { x: me.x, z: me.z };
  return {
    goal,
    tol: 1.5,
    duty: 'swap tank',
    ownThreat: true,
    cast(bot) {
      if (holding || hypot(bot.self, g) > 7.5) return false;
      if ((bot.self.cds?.taunt ?? 0) > 0.05 || Date.now() - (bot.lastSent.taunt ?? 0) < 1000)
        return false;
      if (bot.self.target !== g.id) bot.cmd({ cmd: 'target', id: g.id });
      bot.lastSent.taunt = Date.now();
      bot.cmd({ cmd: 'cast', ability: 'taunt' });
      log(`TAUNT: ${bot.name} takes the Guardian for the Hammer's Weight swap`);
      return true;
    },
  };
}

/** The two tanks hold the Guardian and swap him on Hammer's Weight; once
 *  he falls (or the keeper is gone) they take the Singer. */
function tankPlan(world, st, b) {
  const g = world.mobs.guardian;
  const s = world.mobs.singer;
  const holderOf = (m) => (m?.aggro != null ? (world.players.get(m.aggro) ?? null) : null);
  b.loose = null;
  const kp = keeper(world);
  if (kp === b && alive(g) && alive(s)) {
    b.tankTarget = 'singer';
    const h = holderOf(s);
    if (h && h.pid !== b.pid) b.loose = { r: 'singer', m: s, onTank: h.tank };
    return;
  }
  const sw = swapper(world);
  const tanks = world
    .living()
    .filter((p) => (p.tank && (!kp || p.pid !== kp.pid || !alive(s))) || (sw && p.pid === sw.pid));
  if (!alive(g)) {
    b.tankTarget = alive(s) ? 'singer' : null;
    const h = holderOf(s);
    if (alive(s) && h && !h.tank) b.loose = { r: 'singer', m: s, onTank: false };
    return;
  }
  let main = tanks.find((p) => p.pid === st.mainTankPid) ?? null;
  if (!main)
    main =
      (holderOf(g)?.tank ? holderOf(g) : null) ??
      tanks.find((p) => p.bot?.spec.key === 'mt') ??
      tanks[0];
  const other = main ? tanks.find((p) => p.pid !== main.pid) : null;
  if (main && other && hasAura(main, AURA.weight) && !hasAura(other, AURA.weight)) {
    if (!st.swapSince || Date.now() - st.swapSince > 3000) {
      main = other;
      st.swapSince = Date.now();
    }
  }
  st.mainTankPid = main?.pid ?? null;
  const k = keeper(world);
  if (!k && alive(s) && main?.pid !== b.pid) {
    // No keeper left: the off-tank drags her himself.
    b.tankTarget = 'singer';
    const h = holderOf(s);
    if (h && h.pid !== b.pid && (!h.tank || h.pid === main?.pid))
      b.loose = { r: 'singer', m: s, onTank: h.tank };
    return;
  }
  const h = holderOf(g);
  b.offTank = main?.pid !== b.pid;
  if (!b.offTank) {
    b.tankTarget = 'guardian';
    if (h && h.pid !== b.pid) b.loose = { r: 'guardian', m: g, onTank: h.tank };
    return;
  }
  // The off-tank holds no threat war with the main: he stops hitting the
  // Guardian until the swap hands it to him (a debuffed tank who keeps
  // swinging takes it back and dies under Hammer's Weight).
  b.tankTarget = null;
  if (b.self?.auto && Date.now() - (b.lastAttackCmd ?? 0) > 1000) {
    b.cmd({ cmd: 'stopattack' });
    b.lastAttackCmd = Date.now();
  }
  // A Guardian loose on a non-tank (the main tank dead or out of reach):
  // take it.
  if (h && !h.tank && (!main || hypot(main, g) > 12)) {
    b.tankTarget = 'guardian';
    b.loose = { r: 'guardian', m: g, onTank: false };
  }
}

/** Where the off-tank waits: at the Guardian's back (out of Hammerfall's
 *  arc), in taunt reach. */
function offTankSpot(world) {
  const g = world.mobs.guardian;
  const h = g.aggro != null ? world.players.get(g.aggro) : null;
  if (!h) return world.tankG;
  return add(g, unit(h, g), (g.reach ?? 2) + 3);
}

/** The keeper's spot: the planned one while it stays far from the
 *  Guardian; when the Guardian comes near (a Rush, a drag) a new one 30 yd
 *  from him, the nearest to the old, away from the raid. */
function keeperSpot(world, st) {
  const g = world.mobs.guardian;
  st.keeperSpot ??= world.tankS;
  if (!alive(g) || hypot(st.keeperSpot, g) >= BOND_REACH + 8) return st.keeperSpot;
  let best = null;
  for (const r of [30, 27, 33]) {
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const at = add(g, { x: Math.sin(a), z: Math.cos(a) }, r);
      if (!onFloor(at, world.floor, 6)) continue;
      if (hypot(at, world.anchor) < 18) continue;
      const cost = hypot(at, st.keeperSpot);
      if (!best || cost < best.cost) best = { at, cost };
    }
    if (best) break;
  }
  if (best) {
    st.keeperSpot = best.at;
    log(`  KEEPER: the Guardian came near, the Singer goes to ${where(world, best.at)}`);
  }
  return st.keeperSpot;
}

function keeperDuty(world, st, b, me) {
  const s = world.mobs.singer;
  const g = world.mobs.guardian;
  if (!alive(s) || !alive(g) || keeper(world) !== b || !st.engagedAt) return null;
  const holding = s.aggro === b.pid;
  const spot = council.tankSpot(world, st, b, s);
  // Holding her and already past the Bond's reach: stand and hit her (the
  // threat that keeps her); only drag her on while the Guardian is near.
  const apart = hypot(g, s) >= BOND_REACH + 5;
  const goal = !holding
    ? hypot(me, s) > 6
      ? add(s, unit(s, me), 4)
      : { x: me.x, z: me.z }
    : apart
      ? hypot(me, s) > 3.5
        ? add(s, unit(s, me), 2.5)
        : { x: me.x, z: me.z }
      : spot;
  return {
    goal,
    tol: holding && !apart ? 2.5 : 1.2,
    duty: 'keeper',
    ownThreat: true,
    cast(bot) {
      if (bot.cls !== 'warrior' || holding || hypot(bot.self, s) > 7.5) return false;
      if ((bot.self.cds?.taunt ?? 0) > 0.05 || Date.now() - (bot.lastSent.taunt ?? 0) < 1000)
        return false;
      if (bot.self.target !== s.id) bot.cmd({ cmd: 'target', id: s.id });
      bot.lastSent.taunt = Date.now();
      bot.cmd({ cmd: 'cast', ability: 'taunt' });
      log(`TAUNT: ${bot.name} (the Singer's keeper) takes the Singer`);
      return true;
    },
  };
}

function duty(world, st, b, me) {
  init(st);
  const kd = keeperDuty(world, st, b, me) ?? swapperDuty(world, st, b, me);
  if (kd) {
    // The keeper still dodges the Rush's lane.
    const lane = laneNow(world, st);
    if (!lane || segDist(me, lane.from, lane.to) >= RUSH_LANE || lane.pid === b.pid) return kd;
  }
  const cover = st.activeCover;
  const coverSpot = cover?.assign.get(b.pid) ?? null;
  const coverRem = cover ? Math.min(...coverCasts(world).map((c) => c.rem), 99) : 99;
  const rock = st.rock;
  const rockRem = rock ? rem(world.players.get(rock.pid), AURA.rock) : 99;
  // The Singer's tank keeps her away from the Guardian through a Wrath (the
  // Bond would cost more than the blast): he takes it in the open.
  const singerTank =
    (b.tankTarget === 'singer' || keeper(world) === b) &&
    alive(world.mobs.guardian) &&
    alive(world.mobs.singer);
  if (coverSpot && !singerTank && !(rock?.soakers.has(b.pid) && rockRem < coverRem - 2.2))
    return { goal: coverSpot, tol: 0.6, duty: 'cover' };
  // The marked player leads the charge through the cursed pillar.
  const g = world.mobs.guardian;
  if (alive(g) && g.cast === CAST.rush && g.castTgt === b.pid && IGNORE !== 'rush') {
    const secs = g.castRem ?? 0;
    const now = Date.now();
    let plan =
      st.rushSpot?.pid === b.pid && st.rushSpot.n === st.rushes.length ? st.rushSpot : null;
    const was = plan;
    if (plan && now - plan.at0 > 400) {
      if (rushStillGood(world, plan)) plan.at0 = now;
      else plan = null;
    }
    if (!plan) {
      const fresh = rushSpot(world, st, me, secs);
      if (fresh) {
        plan = { pid: b.pid, n: st.rushes.length, at: fresh.at, kind: fresh.kind, at0: now };
        st.rushSpot = plan;
        if (!was || was.kind !== plan.kind)
          log(
            `  RUSH: ${me.name} runs ${hypot(me, plan.at).toFixed(0)} yd (${plan.kind === 'miss' ? 'no line to the cursed pillar in time: a clean miss' : `the cursed pillar on the line, ${plan.kind} it`})`,
          );
      } else plan = was;
    }
    if (plan) return { goal: plan.at, tol: 0.6, duty: 'rush' };
    if (st.rushNoSpot !== st.rushes.length) {
      st.rushNoSpot = st.rushes.length;
      log(`  RUSH: ${me.name} finds no line in time`);
    }
  }
  // Anyone in the lane steps out of it (the marked too once the bar landed:
  // behind the cursed pillar the lane stops short of him).
  const lane = laneNow(world, st);
  if (lane && segDist(me, lane.from, lane.to) < RUSH_LANE && (lane.pid !== b.pid || !lane.bar)) {
    const d = unit(lane.from, lane.to);
    const side = perp(d);
    const along = (me.x - lane.from.x) * d.x + (me.z - lane.from.z) * d.z;
    const foot = add(lane.from, d, along);
    let sgn = (me.x - foot.x) * side.x + (me.z - foot.z) * side.z >= 0 ? 1 : -1;
    // The side with no pillar in the way.
    const out = (k) => add(foot, side, k * (RUSH_LANE + 1.5));
    if ([...world.pillars.values()].some((q) => hypot(q, out(sgn)) < q.r + 1)) sgn = -sgn;
    return { goal: out(sgn), tol: 0.6, duty: 'lane' };
  }
  if (st.wakePlan.has(b.pid) && st.wakePlan.get(b.pid).spot)
    return { goal: st.wakePlan.get(b.pid).spot, tol: 0.8, duty: 'wake' };
  if (rock?.soakers.has(b.pid) && IGNORE !== 'rock') {
    const i = [...rock.soakers].indexOf(b.pid);
    return {
      goal:
        i === 0 ? rock.spot : add(rock.spot, { x: Math.sin(i * 1.7), z: Math.cos(i * 1.7) }, 1.6),
      tol: 0.8,
      duty: 'soak',
    };
  }
  return null;
}

function hazardsFor(world, st, b, me) {
  init(st);
  const out = [...world.rubble, ...world.riseSpots];
  for (const [pid, w] of st.wakePlan) {
    if (pid === b.pid || !w.spot) continue;
    out.push({ ...w.spot, r: COUNCIL_REACH.riseKnock + 1.2 });
  }
  const carrier = hasAura(me, AURA.resonance);
  for (const pl of world.players.values()) {
    if (pl.dead || pl.pid === b.pid) continue;
    if (carrier || hasAura(pl, AURA.resonance))
      out.push({ x: pl.x, z: pl.z, r: COUNCIL_REACH.resonance + 1 });
  }
  for (const p of world.pillars.values()) {
    if (!p.soul && HEROIC_PLUS) out.push({ x: p.x, z: p.z, r: p.r + COUNCIL_REACH.pulse + 0.6 });
  }
  const g = world.mobs.guardian;
  if (alive(g) && b.tankTarget !== 'guardian') {
    const f = { x: Math.sin(g.f ?? 0), z: Math.cos(g.f ?? 0) };
    out.push({ ...add(g, f, 5), r: 5.5 });
  }
  // Keep off the Singer's tank's corner when she is dragged away (the raid
  // stays by the Guardian and the cover).
  return out;
}

export default council;
