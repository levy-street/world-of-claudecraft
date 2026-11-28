// Elemental Fusion: the Masterless Strength fuses the quarter it left with
// the one it entered (Jose's brief of 2026-11-19 (b); every number in
// final_elements_ids.ts).
//
//   When        every change into a NEW quarter in the quarter fight (never
//               the pull's first quarter, an intermission or the final
//               phase); it waits until the boss is free (a planted bar, a
//               drag), then a 3 s bar with both elements in its hands. The
//               quarter kit holds its clocks through the bar (final.ts
//               runKit), so the combo never lands on top of the kit's opener.
//   The combos  one per unordered pair, inside the quarter it entered:
//     Heat + Quench     Scalding Steam: drifting clouds that scald inside.
//     Heat + Hammer     Magma Rift: marked players (arrow) erupt in 3 s, each
//                       leaving a lava pool for 20 s.
//     Heat + Breath     Firestorm: a lane across the room, then a wall of
//                       flame sweeps along it.
//     Quench + Breath   Hailstorm: 6 s of hailstones into small circles all
//                       over the quarter (half of them on players).
//     Quench + Hammer   Avalanche: spikes of ice and stone run from the wall
//                       toward the centre in lanes; the gaps are safe.
//     Breath + Hammer   Storm Spires: dark spires rise and charge; then
//                       lightning jumps spire to spire along every link.
//   Mythic      every combo leaves a lingering residue on the floor.
// Deterministic: every spot is hashed off the boss id and the fusion count;
// the only rng draws are the damage rolls, in player order.

import { HEART_ROOM, type SmithHeartVein } from '../../content/smith_heart_layout';
import {
  HEART_QUARTERS,
  heartQuarterAt,
  heartQuarterRidges,
  heartRidgeBearingDeg,
} from '../../content/smith_heart_quarters';
import { DT, type Entity } from '../../types';
import { clearCastIf } from '../sunken_bastion/claim';
import {
  COMBO_RESIDUE,
  ELEMENT_TUNING as E,
  ELEMENT_AURAS,
  ELEMENT_CASTS,
  ELEMENT_CUES,
  ELEMENT_NAMES,
  ELEMENT_OBJECTS,
  elementLaneTemplate,
  type FusionCombo,
  fusionCombo,
  hailTemplate,
  residueTemplate,
  segmentDistance,
  spireLinks,
  spireTemplate,
  steamTemplate,
} from './final_elements_ids';
import type { ElementLane, LavaPool } from './final_elements_state';
import { FINAL_ZONE_CODES, finalHash } from './final_ids';
import {
  at,
  beamCue,
  beginBar,
  bossFree,
  cueAt,
  cueOn,
  dropAura,
  dropFightObject,
  type FinalScope,
  type FPoint,
  hit,
  livePlayers,
  moveFightObject,
  overTheVoid,
  pickPlayers,
  putMarker,
  roll,
  spawnFightObject,
} from './final_scope';
import { elementRules } from './final_strike';

const DEG = Math.PI / 180;
const unit = (h: number) => h / 0x100000000;

// ---- the quarter's floor ------------------------------------------------------------------

/** The middle bearing (radians) of `vein`'s quarter at radius `r`. */
function quarterBearing(vein: SmithHeartVein, r: number): number {
  const [a, b] = heartQuarterRidges(vein);
  const ba = heartRidgeBearingDeg(a, r);
  const bb = heartRidgeBearingDeg(b, r);
  const span = (((bb - ba) % 360) + 360) % 360;
  return (ba + span / 2) * DEG;
}

/** A point of `vein`'s quarter at radius `r`, `off` radians round from its
 *  middle bearing. */
function quarterPoint(vein: SmithHeartVein, r: number, off = 0): FPoint {
  const b = quarterBearing(vein, r) + off;
  return { x: HEART_ROOM.x + Math.sin(b) * r, z: HEART_ROOM.z + Math.cos(b) * r };
}

/** A hashed spot on `vein`'s floor (never over the void, never the ring),
 *  at least `clear` yards from every point in `avoid`. */
export function quarterSpot(
  s: FinalScope,
  vein: SmithHeartVein,
  salt: number,
  avoid: readonly FPoint[] = [],
  clear = 0,
): FPoint {
  const rMin = HEART_QUARTERS.ringR + 4;
  const rMax = HEART_QUARTERS.rimR - 4;
  let best: FPoint | null = null;
  for (let k = 0; k < 40; k++) {
    const h1 = finalHash(s.boss.id + salt * 31, k * 2 + 1);
    const h2 = finalHash(s.boss.id + salt * 17, k * 2 + 2);
    const r = rMin + (rMax - rMin) * Math.sqrt(unit(h1));
    const p = quarterPoint(vein, r, (unit(h2) - 0.5) * 80 * DEG);
    if (heartQuarterAt(p.x, p.z) !== vein || overTheVoid(s, p)) continue;
    best ??= p;
    if (avoid.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= clear)) return p;
  }
  return best ?? quarterPoint(vein, HEART_QUARTERS.spotR);
}

/** The players standing in `vein`'s quarter. */
function inQuarter(s: FinalScope, vein: SmithHeartVein): Entity[] {
  return livePlayers(s).filter((p) => {
    const q = at(s, p);
    return heartQuarterAt(q.x, q.z) === vein;
  });
}

// ---- the trigger and the bar --------------------------------------------------------------

/** A quarter change in the quarter fight: the fusion of the two waits for
 *  the boss to be free (a later change before it begins replaces it). */
export function queueFusion(s: FinalScope, from: SmithHeartVein, to: SmithHeartVein): void {
  if (from === to) return;
  s.st.elements.pending = { from, to };
}

/** Is the fusion's bar running (the quarter kit holds its clocks)? */
export function fusionHolds(s: Pick<FinalScope, 'st'>): boolean {
  return s.st.elements.casting !== null;
}

/** Begin the fusion's bar now (the dev verb skips the wait). */
export function startFusion(s: FinalScope, from: SmithHeartVein, to: SmithHeartVein): boolean {
  const el = s.st.elements;
  if (!fusionCombo(from, to)) return false;
  el.pending = null;
  el.casting = { from, to };
  putMarker(s.boss, ELEMENT_AURAS.fusion, ELEMENT_NAMES.fusion, E.fusionCast, s.boss.id, {
    value: FINAL_ZONE_CODES[from],
    value2: FINAL_ZONE_CODES[to],
  });
  cueOn(s, s.boss, ELEMENT_CUES.fusionStart, 'arcane');
  beginBar(s, ELEMENT_CASTS.fusion, E.fusionCast, s.boss.facing);
  return true;
}

/** The bar lands (final.ts landBar): its combo. Returns the combo. */
export function landFusion(s: FinalScope): FusionCombo | null {
  const el = s.st.elements;
  const c = el.casting;
  el.casting = null;
  dropAura(s.boss, ELEMENT_AURAS.fusion);
  if (!c) return null;
  return fireCombo(s, c.from, c.to);
}

/** One tick: a waiting fusion begins once the boss is free, in the quarter
 *  fight only (an intermission or the final phase drops it). */
export function stepFusion(s: FinalScope): void {
  const el = s.st.elements;
  if (s.st.phase.stage !== 'fight') {
    el.pending = null;
    if (el.casting) {
      el.casting = null;
      dropAura(s.boss, ELEMENT_AURAS.fusion);
      clearCastIf(s.boss, ELEMENT_CASTS.fusion);
    }
    return;
  }
  // A polarity round under way: the fusion waits for it (never both at once).
  if (el.pending && !el.casting && el.marks.length === 0 && bossFree(s))
    startFusion(s, el.pending.from, el.pending.to);
}

/** Fire the pair's combo in the quarter it entered (`to`). */
export function fireCombo(s: FinalScope, from: SmithHeartVein, to: SmithHeartVein): FusionCombo {
  const el = s.st.elements;
  const combo = fusionCombo(from, to) ?? 'spires';
  el.fusions++;
  el.lastCombo = combo;
  el.comboQuarter = to;
  cueOn(s, s.boss, ELEMENT_CUES.fusion, 'arcane');
  switch (combo) {
    case 'steam':
      raiseSteam(s, to);
      break;
    case 'magma':
      markMagma(s);
      break;
    case 'firestorm':
      layFirestorm(s, to);
      break;
    case 'hail':
      el.hailWaves = Math.ceil(E.hailSeconds / E.hailWaveEvery - 1e-9);
      el.hailClock = 0;
      break;
    case 'avalanche':
      layAvalanche(s, to, 0);
      if (elementRules(s).avalancheWaves > 1)
        el.avalancheLater = {
          left: E.avalancheWarn + E.avalancheRun + E.avalancheWaveGap,
          offset: 0.5,
        };
      break;
    case 'spires':
      raiseSpires(s, to);
      break;
  }
  return combo;
}

// ---- Mythic's residue ---------------------------------------------------------------------

function leaveResidue(s: FinalScope, combo: FusionCombo, p: FPoint): void {
  if (!elementRules(s).residue) return;
  const el = s.st.elements;
  const residues = el.pools.filter((q) => q.residue);
  if (residues.length >= E.residueCap) {
    const old = residues[0];
    dropFightObject(s.ctx, s.inst, old.objectId);
    el.pools = el.pools.filter((q) => q !== old);
  }
  const element = COMBO_RESIDUE[combo];
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    residueTemplate(element),
    ELEMENT_NAMES.residue,
    p.x,
    p.z,
    E.residueR,
  );
  el.pools.push({
    objectId: obj.id,
    x: p.x,
    z: p.z,
    r: E.residueR,
    life: E.residueLife,
    element,
    residue: true,
  });
}

// ---- Scalding Steam -----------------------------------------------------------------------

export function raiseSteam(s: FinalScope, vein: SmithHeartVein): number {
  const el = s.st.elements;
  const n = elementRules(s).steamClouds;
  const placed: FPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = quarterSpot(s, vein, el.fusions * 13 + i, placed, E.steamR * 2.2);
    placed.push(p);
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      steamTemplate('warn'),
      ELEMENT_NAMES.steam,
      p.x,
      p.z,
      E.steamR,
    );
    el.steam.push({
      objectId: obj.id,
      x: p.x,
      z: p.z,
      warn: E.steamWarn,
      life: E.steamLife,
      heading: unit(finalHash(s.boss.id, el.fusions * 7 + i)) * Math.PI * 2,
      turn: E.steamTurnEvery,
      tick: 0,
    });
  }
  return n;
}

function stepSteam(s: FinalScope): void {
  const el = s.st.elements;
  if (el.steam.length === 0) return;
  const r = elementRules(s);
  const keep: typeof el.steam = [];
  for (const c of el.steam) {
    const obj = s.ctx.entities.get(c.objectId);
    if (c.warn > 0) {
      c.warn -= DT;
      if (c.warn <= 1e-9 && obj) obj.templateId = steamTemplate('live');
      keep.push(c);
      continue;
    }
    c.life -= DT;
    if (c.life <= 1e-9) {
      dropFightObject(s.ctx, s.inst, c.objectId);
      leaveResidue(s, 'steam', c);
      continue;
    }
    // Drift, turning on a hashed beat; turned back at its quarter's edge.
    c.turn -= DT;
    if (c.turn <= 0) {
      c.turn = E.steamTurnEvery;
      c.heading += (unit(finalHash(c.objectId, Math.round(c.life * 10))) - 0.5) * 2.2;
    }
    const nx = c.x + Math.sin(c.heading) * E.steamSpeed * DT;
    const nz = c.z + Math.cos(c.heading) * E.steamSpeed * DT;
    const q = el.comboQuarter;
    if (q && heartQuarterAt(nx, nz) !== q) c.heading += Math.PI;
    else {
      c.x = nx;
      c.z = nz;
      if (obj) moveFightObject(s.ctx, s.inst, obj, c.x, c.z);
    }
    c.tick -= DT;
    if (c.tick <= 1e-9) {
      c.tick = E.steamTick;
      for (const p of livePlayers(s)) {
        const pq = at(s, p);
        if (Math.hypot(pq.x - c.x, pq.z - c.z) > E.steamR) continue;
        if (obj)
          s.ctx.emit({
            type: 'spellfx',
            sourceId: obj.id,
            targetId: p.id,
            school: 'fire',
            fx: 'nova',
            ability: ELEMENT_CUES.steam,
          });
        hit(s, p, roll(s, r.steamMin, r.steamMax), ELEMENT_NAMES.steam, 'fire');
      }
    }
    keep.push(c);
  }
  el.steam = keep;
}

// ---- Magma Rift ---------------------------------------------------------------------------

export function markMagma(s: FinalScope): Entity[] {
  const el = s.st.elements;
  const marked = pickPlayers(s, elementRules(s).magmaMarks, el.fusions * 5 + 901);
  for (const p of marked) {
    putMarker(p, ELEMENT_AURAS.magmaMark, ELEMENT_NAMES.magma, E.magmaMarkSeconds, s.boss.id, {
      school: 'fire',
    });
    el.magma.push({ pid: p.id, left: E.magmaMarkSeconds });
  }
  return marked;
}

function stepMagma(s: FinalScope): void {
  const el = s.st.elements;
  if (el.magma.length === 0) return;
  const r = elementRules(s);
  const keep: typeof el.magma = [];
  for (const m of el.magma) {
    m.left -= DT;
    if (m.left > 1e-9) {
      keep.push(m);
      continue;
    }
    const p = s.ctx.entities.get(m.pid);
    if (!p) continue;
    dropAura(p, ELEMENT_AURAS.magmaMark);
    if (p.dead) continue;
    const c = at(s, p);
    cueAt(s, ELEMENT_CUES.magma, c.x, c.z, E.magmaR, 'fire');
    for (const o of livePlayers(s)) {
      const q = at(s, o);
      if (Math.hypot(q.x - c.x, q.z - c.z) > E.magmaR) continue;
      hit(s, o, roll(s, r.magmaMin, r.magmaMax), ELEMENT_NAMES.magma, 'fire');
    }
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      ELEMENT_OBJECTS.lava,
      ELEMENT_NAMES.lava,
      c.x,
      c.z,
      E.magmaR,
    );
    el.pools.push({
      objectId: obj.id,
      x: c.x,
      z: c.z,
      r: E.magmaR,
      // Mythic's residue: the pool smoulders on half as long again.
      life: E.lavaLife * (r.residue ? 1.5 : 1),
      element: 'fire',
      residue: false,
    });
  }
  el.magma = keep;
}

/** The pools (lava and residue): each bites whoever stands in it every
 *  second; gone at its life's end. */
function stepPools(s: FinalScope): void {
  const el = s.st.elements;
  if (el.pools.length === 0) return;
  const r = elementRules(s);
  el.poolTick -= DT;
  const bite = el.poolTick <= 1e-9;
  if (bite) el.poolTick = E.lavaTick;
  const keep: LavaPool[] = [];
  for (const p of el.pools) {
    p.life -= DT;
    if (p.life <= 1e-9) {
      dropFightObject(s.ctx, s.inst, p.objectId);
      continue;
    }
    keep.push(p);
    if (!bite) continue;
    for (const o of livePlayers(s)) {
      const q = at(s, o);
      if (Math.hypot(q.x - p.x, q.z - p.z) > p.r) continue;
      const school =
        p.element === 'frost'
          ? 'frost'
          : p.element === 'storm'
            ? 'nature'
            : p.element === 'stone'
              ? 'physical'
              : 'fire';
      if (p.residue) hit(s, o, roll(s, E.residueMin, E.residueMax), ELEMENT_NAMES.residue, school);
      else hit(s, o, roll(s, r.lavaMin, r.lavaMax), ELEMENT_NAMES.lava, 'fire');
    }
  }
  el.pools = keep;
}

// ---- the lanes (Firestorm, Avalanche) -----------------------------------------------------

function layLane(
  s: FinalScope,
  kind: 'fire' | 'avalanche',
  start: FPoint,
  facing: number,
  length: number,
  half: number,
  warn: number,
  run: number,
): ElementLane {
  const prefix = kind === 'fire' ? ELEMENT_OBJECTS.firePrefix : ELEMENT_OBJECTS.avalanchePrefix;
  const mid = {
    x: start.x + Math.sin(facing) * (length / 2),
    z: start.z + Math.cos(facing) * (length / 2),
  };
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    elementLaneTemplate(prefix, 'warn', length, half),
    kind === 'fire' ? ELEMENT_NAMES.firestorm : ELEMENT_NAMES.avalanche,
    mid.x,
    mid.z,
    half,
  );
  obj.facing = facing;
  obj.prevFacing = facing;
  const lane: ElementLane = {
    objectId: obj.id,
    kind,
    x: start.x,
    z: start.z,
    facing,
    length,
    half,
    warn,
    front: 0,
    run,
    struck: [],
  };
  s.st.elements.lanes.push(lane);
  return lane;
}

/** Firestorm: a lane (two on Heroic and Mythic, crossing) through a player
 *  in the quarter, rim to rim. Returns the lanes laid. */
export function layFirestorm(s: FinalScope, vein: SmithHeartVein): number {
  const el = s.st.elements;
  const r = elementRules(s);
  const here = inQuarter(s, vein);
  const salt = el.fusions * 11 + 3;
  const aim0 =
    here.length > 0
      ? at(s, here[finalHash(s.boss.id, salt) % here.length])
      : quarterSpot(s, vein, salt);
  const base = unit(finalHash(s.boss.id, salt + 1)) * Math.PI;
  for (let i = 0; i < r.fireLanes; i++) {
    const heading = base + i * (Math.PI / 2.4);
    const start = {
      x: aim0.x - Math.sin(heading) * (E.fireLength / 2),
      z: aim0.z - Math.cos(heading) * (E.fireLength / 2),
    };
    layLane(
      s,
      'fire',
      start,
      heading,
      E.fireLength,
      r.fireHalf,
      E.fireWarn + i * 0.8,
      E.fireLength / E.fireSpeed,
    );
  }
  return r.fireLanes;
}

/** Avalanche: lanes from the quarter's wall toward the centre, spaced so
 *  the gaps between them are safe (`offset` shifts them by a share of the
 *  spacing: Mythic's second wave runs in the first's gaps). */
export function layAvalanche(s: FinalScope, vein: SmithHeartVein, offset: number): number {
  const r = elementRules(s);
  const rim = quarterPoint(vein, HEART_QUARTERS.rimR - 1);
  const heading = Math.atan2(HEART_ROOM.x - rim.x, HEART_ROOM.z - rim.z);
  const side = { x: Math.cos(heading), z: -Math.sin(heading) };
  const n = r.avalancheLanes;
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2 + offset) * E.avalancheSpacing;
    const start = { x: rim.x + side.x * off, z: rim.z + side.z * off };
    layLane(
      s,
      'avalanche',
      start,
      heading,
      E.avalancheLength,
      r.avalancheHalf,
      E.avalancheWarn,
      E.avalancheRun,
    );
  }
  return n;
}

function stepLanes(s: FinalScope): void {
  const el = s.st.elements;
  if (el.avalancheLater) {
    el.avalancheLater.left -= DT;
    if (el.avalancheLater.left <= 1e-9) {
      const off = el.avalancheLater.offset;
      el.avalancheLater = null;
      if (el.comboQuarter) layAvalanche(s, el.comboQuarter, off);
    }
  }
  if (el.lanes.length === 0) return;
  const r = elementRules(s);
  const keep: ElementLane[] = [];
  for (const L of el.lanes) {
    const prefix = L.kind === 'fire' ? ELEMENT_OBJECTS.firePrefix : ELEMENT_OBJECTS.avalanchePrefix;
    const obj = s.ctx.entities.get(L.objectId);
    if (L.warn > 1e-9) {
      L.warn -= DT;
      if (L.warn <= 1e-9) {
        if (obj)
          obj.templateId = elementLaneTemplate(
            prefix,
            L.kind === 'fire' ? 'burn' : 'run',
            L.length,
            L.half,
          );
        cueAt(
          s,
          L.kind === 'fire' ? ELEMENT_CUES.firestorm : ELEMENT_CUES.avalanche,
          L.x,
          L.z,
          L.half,
          L.kind === 'fire' ? 'fire' : 'frost',
        );
      }
      keep.push(L);
      continue;
    }
    const was = L.front;
    L.front = Math.min(L.length, L.front + (L.length / Math.max(0.1, L.run)) * DT);
    const dx = Math.sin(L.facing);
    const dz = Math.cos(L.facing);
    for (const p of livePlayers(s)) {
      if (L.struck.includes(p.id)) continue;
      const q = at(s, p);
      const t = (q.x - L.x) * dx + (q.z - L.z) * dz;
      if (t < -0.5 || t > L.front + 0.5) continue;
      const side = Math.abs((q.x - L.x) * dz - (q.z - L.z) * dx);
      if (side > L.half) continue;
      L.struck.push(p.id);
      if (L.kind === 'fire') {
        if (obj)
          s.ctx.emit({
            type: 'spellfx',
            sourceId: obj.id,
            targetId: p.id,
            school: 'fire',
            fx: 'nova',
            ability: ELEMENT_CUES.firestormHit,
          });
        hit(s, p, roll(s, r.fireMin, r.fireMax), ELEMENT_NAMES.firestorm, 'fire');
      } else hit(s, p, roll(s, r.avalancheMin, r.avalancheMax), ELEMENT_NAMES.avalanche, 'frost');
    }
    if (was >= L.length - 1e-6) {
      dropFightObject(s.ctx, s.inst, L.objectId);
      const combo = L.kind === 'fire' ? 'firestorm' : 'avalanche';
      if (L.kind === 'fire')
        for (const t of [0.3, 0.5, 0.7])
          leaveResidue(s, combo, { x: L.x + dx * L.length * t, z: L.z + dz * L.length * t });
      else leaveResidue(s, combo, { x: L.x + dx * L.length * 0.6, z: L.z + dz * L.length * 0.6 });
      continue;
    }
    keep.push(L);
  }
  el.lanes = keep;
}

// ---- Hailstorm ----------------------------------------------------------------------------

/** One wave of hail: half on players in the quarter, the rest hashed over
 *  it. Returns the stones laid. */
export function hailWave(s: FinalScope, vein: SmithHeartVein): number {
  const el = s.st.elements;
  const n = elementRules(s).hailPerWave;
  const here = inQuarter(s, vein);
  const salt = el.fusions * 97 + el.hailWaves * 7;
  const laid: FPoint[] = [];
  for (let i = 0; i < n; i++) {
    let p: FPoint;
    if (i % 2 === 0 && here.length > 0)
      p = at(s, here[finalHash(s.boss.id, salt + i) % here.length]);
    else p = quarterSpot(s, vein, salt + i, laid, E.hailR * 2);
    laid.push(p);
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      hailTemplate(E.hailWarn),
      ELEMENT_NAMES.hail,
      p.x,
      p.z,
      E.hailR,
    );
    el.hail.push({ objectId: obj.id, x: p.x, z: p.z, left: E.hailWarn });
  }
  return n;
}

function stepHail(s: FinalScope): void {
  const el = s.st.elements;
  if (el.hailWaves > 0 && el.comboQuarter) {
    el.hailClock -= DT;
    if (el.hailClock <= 1e-9) {
      el.hailClock = E.hailWaveEvery;
      hailWave(s, el.comboQuarter);
      el.hailWaves--;
    }
  }
  if (el.hail.length === 0) return;
  const r = elementRules(s);
  const keep: typeof el.hail = [];
  let landed = 0;
  for (const h of el.hail) {
    h.left -= DT;
    if (h.left > 1e-9) {
      keep.push(h);
      continue;
    }
    dropFightObject(s.ctx, s.inst, h.objectId);
    cueAt(s, ELEMENT_CUES.hail, h.x, h.z, E.hailR, 'frost');
    for (const p of livePlayers(s)) {
      const q = at(s, p);
      if (Math.hypot(q.x - h.x, q.z - h.z) > E.hailR) continue;
      hit(s, p, roll(s, r.hailMin, r.hailMax), ELEMENT_NAMES.hail, 'frost');
    }
    // Mythic: one stone in three leaves its frost.
    if (landed++ % 3 === 0) leaveResidue(s, 'hail', h);
  }
  el.hail = keep;
}

// ---- Storm Spires -------------------------------------------------------------------------

export function raiseSpires(s: FinalScope, vein: SmithHeartVein): number {
  const el = s.st.elements;
  const n = elementRules(s).spires;
  const pts: FPoint[] = [];
  for (let i = 0; i < n; i++) {
    let best: FPoint | null = null;
    for (let k = 0; k < 12 && !best; k++) {
      const p = quarterSpot(s, vein, el.fusions * 41 + i * 13 + k, pts, E.spireMinGap);
      const prev = pts[pts.length - 1];
      if (!prev || Math.hypot(p.x - prev.x, p.z - prev.z) <= E.spireMaxGap) best = p;
    }
    pts.push(best ?? quarterSpot(s, vein, el.fusions * 41 + i * 13, pts, E.spireMinGap));
  }
  const group = el.fusions % 100;
  const ids = pts.map((p, i) => {
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      spireTemplate('charge', i, n, group),
      ELEMENT_NAMES.spire,
      p.x,
      p.z,
      E.spireR,
    );
    return obj.id;
  });
  el.spires.push({
    ids,
    pts,
    charge: E.spireCharge,
    left: elementRules(s).spireDischarges,
    gap: 0,
    group,
  });
  return n;
}

function stepSpires(s: FinalScope): void {
  const el = s.st.elements;
  if (el.spires.length === 0) return;
  const r = elementRules(s);
  const keep: typeof el.spires = [];
  for (const g of el.spires) {
    if (g.charge > 1e-9) {
      g.charge -= DT;
      keep.push(g);
      continue;
    }
    g.gap -= DT;
    if (g.gap > 1e-9) {
      keep.push(g);
      continue;
    }
    if (g.left <= 0) {
      for (const id of g.ids) dropFightObject(s.ctx, s.inst, id);
      for (const p of g.pts) leaveResidue(s, 'spires', p);
      continue;
    }
    // A discharge: every link fires.
    g.left--;
    g.gap = g.left > 0 ? E.spireGap : 0.8;
    g.ids.forEach((id, i) => {
      const o = s.ctx.entities.get(id);
      if (o) o.templateId = spireTemplate('fire', i, g.ids.length, g.group);
    });
    const struck = new Set<number>();
    for (const [a, b] of spireLinks(g.pts.length)) {
      beamCue(s, g.ids[a], g.ids[b], ELEMENT_CUES.spire);
      const A = g.pts[a];
      const B = g.pts[b];
      for (const p of livePlayers(s)) {
        if (struck.has(p.id)) continue;
        const q = at(s, p);
        if (segmentDistance(q.x, q.z, A.x, A.z, B.x, B.z) > E.spireLinkHalf) continue;
        struck.add(p.id);
        hit(s, p, roll(s, r.spireMin, r.spireMax), ELEMENT_NAMES.spire, 'nature');
      }
    }
    keep.push(g);
  }
  el.spires = keep;
}

// ---- the tick and the end -----------------------------------------------------------------

/** One tick of every combo on the floor (it runs on through a stage change:
 *  footprints already down run out). */
export function stepCombos(s: FinalScope): void {
  stepSteam(s);
  stepMagma(s);
  stepPools(s);
  stepLanes(s);
  stepHail(s);
  stepSpires(s);
}

/** Is any combo still on the floor (the polarity marks wait for it)? */
export function combosRunning(s: Pick<FinalScope, 'st'>): boolean {
  const el = s.st.elements;
  return (
    el.casting !== null ||
    el.steam.length > 0 ||
    el.magma.length > 0 ||
    el.lanes.length > 0 ||
    el.hail.length > 0 ||
    el.hailWaves > 0 ||
    el.spires.length > 0 ||
    el.avalancheLater !== null
  );
}

/** Every combo footprint gone (the fight's end). */
export function clearFusion(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st' | 'boss'>,
  players: readonly Entity[],
): void {
  const el = s.st.elements;
  const drop = (id: number) => dropFightObject(s.ctx, s.inst, id);
  for (const c of el.steam) drop(c.objectId);
  for (const p of el.pools) drop(p.objectId);
  for (const l of el.lanes) drop(l.objectId);
  for (const h of el.hail) drop(h.objectId);
  for (const g of el.spires) for (const id of g.ids) drop(id);
  el.steam = [];
  el.pools = [];
  el.lanes = [];
  el.hail = [];
  el.spires = [];
  el.magma = [];
  el.hailWaves = 0;
  el.avalancheLater = null;
  el.pending = null;
  el.casting = null;
  dropAura(s.boss, ELEMENT_AURAS.fusion);
  clearCastIf(s.boss, ELEMENT_CASTS.fusion);
  for (const p of players) dropAura(p, ELEMENT_AURAS.magmaMark);
}
