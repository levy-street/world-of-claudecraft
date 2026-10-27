// Soul in the Stone, the Hammer Council's mythic-only mechanic (docs/design/
// raid/smith_heart.md section 7.1, Mythic): when a member falls on mythic, its
// soul flows into the most intact standing pillar (the highest integrity, the
// nearest to the body on a tie, the lower id after that; with no pillar
// standing, a fresh one rises where the body lies to hold it). That pillar is
// a soul pillar:
//
//   Its look      the template id carries whose soul, the pillar's kind and
//                 its 3 soul pips (councilSoulTemplate), so every client draws
//                 it with no wire change.
//   Immune        nothing cracks it (council_pillars.ts crackPillar refuses
//                 it); only a Falling Rock landing within 6 yd of its face and
//                 a Resonance carrier standing by it for 3 s (the Singer's
//                 soul: 1.5 s) strike a pip off (council_stone.ts,
//                 council_song.ts call strikeSoulPip). It shields nobody from
//                 Mountain's Wrath or the Echo, but its wall still stands.
//   At 0 pips     it bursts and leaves the usual rubble; its behaviour stops.
//                 Nothing else: the survivors keep their Memory of Stone and
//                 their mythic inheritance.
//   The last kill every soul pillar crumbles with the council.
//
// What it does is whose soul it holds:
//   Guardian      Echo of Wrath: every 20 s the pillar's own 3 s bar, then 60
//                 percent of a Wrath on every player with no other pillar
//                 between them and it; a pillar that shields someone loses a
//                 piece, like the Wrath.
//   Slabwright    the Walking Slab: it drags itself (1.5 yd a second, its
//                 wall with it) toward the largest group, re-picked every 3 s;
//                 a player under it is struck hard and thrown, anyone near it
//                 grinds each second.
//   Seam Singer   the Endless Song: a raid-wide pulse every 3 s, each 12
//                 percent louder than the first, capped at 4 times it (the
//                 pulse count is a stack of an aura on the pillar).
//
// Deterministic: every pick is ordered (integrity, distance, entity id; the
// group by roster order); the only rng draws are the damage rolls, in
// claim-player order. Zero draws off mythic (no soul ever stands there).

import { HAMMER_PIT } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { dropAuraById, dropEncounterObject } from '../sunken_bastion/claim';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_NAMES,
  COUNCIL_ROLES,
  type CouncilRole,
  councilPillarFull,
  councilPillarTemplate,
  councilSoulTemplate,
  endlessSongMult,
  COUNCIL_TUNING as T,
} from './council_ids';
import {
  type CouncilPillar,
  collapsePillar,
  councilPillars,
  crackPillar,
  onQuarryFloor,
  pillarBetween,
  raisePillar,
  syncPillarWalls,
} from './council_pillars';
import { type CouncilScope, damageMult, living, raidWarn, roll } from './council_scope';
import type { CouncilSoul } from './council_state';

/** The lines the raid reads (raid warnings, `hudChrome.council.warn.*`). */
const TAKE_LINES: Readonly<Record<CouncilRole, string>> = {
  guardian: "The Guardian's soul takes the stone! Its Echo of Wrath will strike from the pillar.",
  slabwright: "The Slabwright's soul takes the stone! The Walking Slab drags itself after you.",
  singer: "The Seam Singer's soul takes the stone! Its Endless Song grows with every pulse.",
};
const BREAK_LINES: Readonly<Record<CouncilRole, string>> = {
  guardian: "The Guardian's soul pillar breaks! Its Echo falls silent.",
  slabwright: "The Slabwright's soul pillar breaks! The Walking Slab is still.",
  singer: "The Seam Singer's soul pillar breaks! The Endless Song falls silent.",
};
const ECHO_LINE = 'Echo of Wrath! Put another pillar between you and the soul pillar!';

/** Seconds a Resonance carrier must stand by a soul pillar to strike a pip. */
export function soulResonanceSeconds(role: CouncilRole): number {
  return role === 'singer' ? T.singerSoulResonanceSeconds : T.soulResonanceSeconds;
}

/** The soul a pillar holds, by its entity id. */
export function soulOfPillar(s: CouncilScope, pillarId: number): CouncilSoul | undefined {
  return s.st.souls.find((q) => q.pillarId === pillarId);
}

/** The first living member: every soul's damage is dealt in its name. */
function firstLiving(s: CouncilScope): Entity | null {
  for (const r of COUNCIL_ROLES) {
    const b = s.bodies[r];
    if (living(b)) return b;
  }
  return null;
}

/** Instance-local (x, z) of an entity. */
function local(s: CouncilScope, e: Entity): { x: number; z: number } {
  const o = s.ctx.instanceOriginOf(s.inst);
  return { x: e.pos.x - o.x, z: e.pos.z - o.z };
}

/** Lift the soul's own bar and song off its pillar. */
function quietPillar(e: Entity): void {
  e.castingAbility = null;
  e.castRemaining = 0;
  e.castTotal = 0;
  e.castTargetId = null;
  dropAuraById(e, COUNCIL_AURAS.endlessSong);
}

/**
 * The pillar a fallen member's soul takes: the most intact standing pillar
 * that holds no soul yet (the highest integrity, then the nearest to `from`,
 * then the lower entity id). Pure over the list.
 */
export function soulHost(
  pillars: readonly CouncilPillar[],
  from: { x: number; z: number },
): CouncilPillar | null {
  let best: CouncilPillar | null = null;
  let bestD = 0;
  for (const p of pillars) {
    if (p.soul) continue;
    const d = Math.hypot(p.e.pos.x - from.x, p.e.pos.z - from.z);
    if (
      !best ||
      p.integrity > best.integrity ||
      (p.integrity === best.integrity &&
        (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && p.e.id < best.e.id)))
    ) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** `role`'s soul takes a pillar (its body `from`, dead or, for a dev line,
 *  alive). Returns the soul pillar, or null when none could stand. */
export function takeSoul(s: CouncilScope, role: CouncilRole, from: Entity): Entity | null {
  if (s.st.souls.some((q) => q.role === role)) return null;
  const source = firstLiving(s) ?? from;
  let host = soulHost(councilPillars(s.ctx, s.inst), from.pos);
  if (!host) {
    // No pillar stands: one rises where the body lies (never refused by the
    // cap), else at the Quarry's middle.
    const bodies = COUNCIL_ROLES.map((r) => s.bodies[r]).filter((b): b is Entity => b !== null);
    const at = local(s, from);
    const spots = onQuarryFloor(at.x, at.z) ? [at, HAMMER_PIT] : [HAMMER_PIT];
    for (const spot of spots) {
      const e = raisePillar(
        s.ctx,
        s.inst,
        source,
        bodies,
        s.players,
        spot.x,
        spot.z,
        damageMult(s, source),
        true,
      );
      if (!e) continue;
      host = councilPillars(s.ctx, s.inst).find((p) => p.e.id === e.id) ?? null;
      if (host) break;
    }
  }
  if (!host) return null;
  const e = host.e;
  e.templateId = councilSoulTemplate(role, host.risen, T.soulPips);
  syncPillarWalls(s.ctx, s.inst);
  s.st.souls.push({
    role,
    pillarId: e.id,
    timer: role === 'guardian' ? T.echoFirst : role === 'singer' ? T.songPulseFirst : 0,
    echo: null,
    pulses: 0,
    goal: null,
    retarget: 0,
    grind: T.slabGrindEvery,
    crushed: {},
  });
  s.ctx.emit({
    type: 'spellfx',
    sourceId: from.id,
    targetId: e.id,
    school: 'physical',
    fx: 'beam',
    ability: COUNCIL_CUES.soulTake,
  });
  raidWarn(s, from, `soul_${role}`, TAKE_LINES[role]);
  return e;
}

/** A soul pillar bursts: its soul dissipates, the pillar falls into rubble,
 *  its behaviour stops. No reward: the survivors keep every stack. */
function burstSoul(s: CouncilScope, p: CouncilPillar, rubble: boolean): void {
  const soul = soulOfPillar(s, p.e.id);
  s.ctx.emit({
    type: 'spellfxAt',
    x: p.e.pos.x,
    z: p.e.pos.z,
    school: 'physical',
    fx: 'burst',
    ability: COUNCIL_CUES.soulBurst,
    radius: p.r,
  });
  quietPillar(p.e);
  collapsePillar(s.ctx, s.inst, s.st, p);
  if (!rubble) {
    // The council's own fall: the pillar crumbles with it, no hazard left.
    const r = s.st.rubble.pop();
    if (r) dropEncounterObject(s.ctx, s.inst, r.objectId);
  }
  s.st.souls = s.st.souls.filter((q) => q.pillarId !== p.e.id);
  if (soul && rubble && !s.st.soulsSpent.includes(soul.role)) s.st.soulsSpent.push(soul.role);
  const speaker = firstLiving(s);
  if (soul && speaker && rubble)
    raidWarn(s, speaker, `soulBreak_${soul.role}`, BREAK_LINES[soul.role]);
}

/** A Falling Rock or a Resonance carrier strikes one soul pip off (the only
 *  two things that can). Returns true when the pillar burst. */
export function strikeSoulPip(
  s: CouncilScope,
  p: CouncilPillar,
  _cause: 'rock' | 'resonance' | 'dev',
): boolean {
  if (!p.soul || !s.ctx.entities.has(p.e.id)) return false;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: p.e.id,
    targetId: p.e.id,
    school: 'physical',
    fx: 'nova',
    ability: COUNCIL_CUES.soulPip,
  });
  const left = p.integrity - 1;
  if (left <= 0) {
    burstSoul(s, p, true);
    return true;
  }
  p.integrity = left;
  p.e.templateId = councilSoulTemplate(p.soul, p.risen, left);
  return false;
}

// ---- the Guardian's soul: Echo of Wrath ----------------------------------------------------

/** The Echo lands: every player in its reach with no other (soulless) pillar
 *  between them and the soul pillar is struck; each shielding pillar loses a
 *  piece. Returns how many it struck (the tests read it). */
export function landEcho(s: CouncilScope, pillar: Entity, source: Entity): number {
  const { ctx, inst, st } = s;
  ctx.emit({
    type: 'spellfx',
    sourceId: pillar.id,
    targetId: pillar.id,
    school: 'physical',
    fx: 'nova',
    ability: COUNCIL_CUES.echoBlast,
  });
  const cover = councilPillars(ctx, inst).filter((p) => !p.soul);
  const shields = new Set<number>();
  let struck = 0;
  for (const p of s.players) {
    if (p.dead) continue;
    if (Math.hypot(p.pos.x - pillar.pos.x, p.pos.z - pillar.pos.z) > T.echoRadius) continue;
    const shield = pillarBetween(cover, pillar.pos, p.pos);
    if (shield) {
      shields.add(shield.e.id);
      continue;
    }
    const amount = roll(s, source, T.wrathMin * T.echoShare, T.wrathMax * T.echoShare);
    ctx.dealDamage(source, p, amount, false, 'physical', COUNCIL_NAMES.echo, 'hit', true);
    struck++;
  }
  for (const pl of cover) if (shields.has(pl.e.id)) crackPillar(ctx, inst, st, pl);
  return struck;
}

function stepEcho(s: CouncilScope, soul: CouncilSoul, pillar: Entity, source: Entity): void {
  if (soul.echo !== null) {
    soul.echo -= DT;
    pillar.castRemaining = Math.max(0, soul.echo);
    if (soul.echo > 1e-9) return;
    soul.echo = null;
    quietPillar(pillar);
    landEcho(s, pillar, source);
    return;
  }
  soul.timer -= DT;
  if (soul.timer > 1e-9) return;
  soul.timer = T.echoEvery;
  soul.echo = T.echoCast;
  s.st.casts++;
  pillar.castingAbility = COUNCIL_CASTS.echo;
  pillar.castTotal = T.echoCast;
  pillar.castRemaining = T.echoCast;
  pillar.castTargetId = null;
  raidWarn(s, source, 'echo', ECHO_LINE);
}

// ---- the Slabwright's soul: the Walking Slab ------------------------------------------------

/** The largest group of players: the one with the most others within the
 *  group reach of it (roster order breaks a tie), as its group's centre.
 *  Pure over the list (entity-id order). */
export function largestGroup(players: readonly Entity[]): { x: number; z: number } | null {
  let best: Entity | null = null;
  let bestN = 0;
  for (const p of players) {
    if (p.dead) continue;
    let n = 0;
    for (const q of players) {
      if (!q.dead && Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z) <= T.slabGroupR) n++;
    }
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  if (!best) return null;
  let x = 0;
  let z = 0;
  let n = 0;
  for (const q of players) {
    if (q.dead || Math.hypot(q.pos.x - best.pos.x, q.pos.z - best.pos.z) > T.slabGroupR) continue;
    x += q.pos.x;
    z += q.pos.z;
    n++;
  }
  return { x: x / n, z: z / n };
}

/** Headings the slab tries when the straight line is blocked (radians off
 *  the line, nearest first). */
const SLAB_SWERVE = [0, 0.6, -0.6, 1.2, -1.2] as const;

function stepSlab(s: CouncilScope, soul: CouncilSoul, p: CouncilPillar, source: Entity): void {
  const { ctx, inst } = s;
  const e = p.e;
  soul.retarget -= DT;
  if (soul.retarget <= 1e-9 || !soul.goal) {
    soul.retarget = T.slabRetarget;
    const g = largestGroup(s.players);
    const o = ctx.instanceOriginOf(inst);
    soul.goal = g ? { x: g.x - o.x, z: g.z - o.z } : null;
  }
  if (soul.goal) {
    const o = ctx.instanceOriginOf(inst);
    const at = local(s, e);
    const dx = soul.goal.x - at.x;
    const dz = soul.goal.z - at.z;
    const d = Math.hypot(dx, dz);
    if (d > T.slabArrive) {
      const step = Math.min(d - T.slabArrive, T.slabSpeed * DT);
      const heading = Math.atan2(dx, dz);
      const others = councilPillars(ctx, inst).filter((q) => q.e.id !== e.id);
      for (const off of SLAB_SWERVE) {
        const a = heading + off;
        const nx = at.x + Math.sin(a) * step;
        const nz = at.z + Math.cos(a) * step;
        if (!onQuarryFloor(nx, nz)) continue;
        const blocked =
          others.some(
            (q) => Math.hypot(q.e.pos.x - o.x - nx, q.e.pos.z - o.z - nz) < q.r + p.r + 0.3,
          ) ||
          // Round the council's own bodies too (a wall never closes on a boss).
          COUNCIL_ROLES.some((r) => {
            const b = s.bodies[r];
            return (
              living(b) &&
              Math.hypot(b.pos.x - o.x - nx, b.pos.z - o.z - nz) < p.r + T.slabClearOfBodies &&
              Math.hypot(b.pos.x - o.x - nx, b.pos.z - o.z - nz) <
                Math.hypot(b.pos.x - o.x - at.x, b.pos.z - o.z - at.z)
            );
          });
        if (blocked) continue;
        e.prevPos.x = e.pos.x;
        e.prevPos.y = e.pos.y;
        e.prevPos.z = e.pos.z;
        const g = ctx.groundPos(o.x + nx, o.z + nz);
        e.pos.x = g.x;
        e.pos.y = g.y;
        e.pos.z = g.z;
        e.facing = a;
        ctx.rebucket(e);
        syncPillarWalls(ctx, inst);
        break;
      }
    }
  }
  // Under it: a heavy hit and a throw (once per player a breath); near it,
  // the grind each second.
  const clock = s.st.clock;
  let shove: Entity | null = null;
  for (const pl of s.players) {
    if (pl.dead) continue;
    const face = Math.hypot(pl.pos.x - e.pos.x, pl.pos.z - e.pos.z) - p.r;
    if (face > T.slabCrushReach) continue;
    const last = soul.crushed[pl.id];
    if (last !== undefined && clock - last < T.slabCrushEvery - 1e-9) continue;
    soul.crushed[pl.id] = clock;
    ctx.emit({
      type: 'spellfx',
      sourceId: e.id,
      targetId: pl.id,
      school: 'physical',
      fx: 'nova',
      ability: COUNCIL_CUES.slabCrush,
    });
    const amount = roll(s, source, T.slabCrushMin, T.slabCrushMax);
    ctx.dealDamage(source, pl, amount, false, 'physical', COUNCIL_NAMES.slab, 'hit', true);
    shove ??= { ...source, pos: { ...e.pos } } as Entity;
    if (!pl.dead) ctx.applyKnockback(shove, pl, T.slabCrushKnockback);
  }
  soul.grind -= DT;
  if (soul.grind > 1e-9) return;
  soul.grind += T.slabGrindEvery;
  for (const pl of s.players) {
    if (pl.dead) continue;
    const face = Math.hypot(pl.pos.x - e.pos.x, pl.pos.z - e.pos.z) - p.r;
    if (face > T.slabGrindReach) continue;
    const amount = roll(s, source, T.slabGrindMin, T.slabGrindMax);
    ctx.dealDamage(source, pl, amount, false, 'physical', COUNCIL_NAMES.grind, 'hit', true);
  }
}

// ---- the Seam Singer's soul: the Endless Song -----------------------------------------------

function stepSong(s: CouncilScope, soul: CouncilSoul, pillar: Entity, source: Entity): void {
  soul.timer -= DT;
  // The bar between two pulses is the song's clock (the renderer charges it).
  pillar.castingAbility = COUNCIL_CASTS.endlessSong;
  pillar.castTotal = T.songPulseEvery;
  pillar.castRemaining = Math.max(0, Math.round(soul.timer * 10) / 10);
  if (soul.timer > 1e-9) return;
  soul.timer += T.songPulseEvery;
  const mult = endlessSongMult(soul.pulses);
  soul.pulses++;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: pillar.id,
    targetId: pillar.id,
    school: 'nature',
    fx: 'nova',
    ability: COUNCIL_CUES.songPulse,
  });
  for (const pl of s.players) {
    if (pl.dead) continue;
    const amount = roll(s, source, T.songPulseMin * mult, T.songPulseMax * mult);
    s.ctx.dealDamage(source, pl, amount, false, 'nature', COUNCIL_NAMES.endlessSong, 'hit', true);
  }
  // The pulse count rides an aura on the pillar (an object: never ticked).
  const next = endlessSongMult(soul.pulses);
  const have = pillar.auras.find((a) => a.id === COUNCIL_AURAS.endlessSong);
  if (have) {
    have.stacks = soul.pulses;
    have.value = next;
    return;
  }
  pillar.auras.push({
    id: COUNCIL_AURAS.endlessSong,
    name: COUNCIL_NAMES.endlessSong,
    kind: 'buff_dmg_done',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: next,
    stacks: soul.pulses,
    sourceId: pillar.id,
    school: 'nature',
    undispellable: true,
  });
}

// ---- the pass ---------------------------------------------------------------------------------

/** One tick of every standing soul. */
export function stepSouls(s: CouncilScope): void {
  if (s.st.souls.length === 0) return;
  const source = firstLiving(s);
  if (!source) return;
  const pillars = councilPillars(s.ctx, s.inst);
  for (const soul of [...s.st.souls]) {
    const p = pillars.find((q) => q.e.id === soul.pillarId && q.soul === soul.role);
    if (!p) {
      // Its pillar is gone (a reset in between): so is the soul.
      s.st.souls = s.st.souls.filter((q) => q !== soul);
      continue;
    }
    if (soul.role === 'guardian') stepEcho(s, soul, p.e, source);
    else if (soul.role === 'slabwright') stepSlab(s, soul, p, source);
    else stepSong(s, soul, p.e, source);
  }
}

/** The last member fell: every soul pillar crumbles with the council. */
export function crumbleSouls(s: CouncilScope): void {
  if (s.st.souls.length === 0) return;
  for (const p of councilPillars(s.ctx, s.inst)) if (p.soul) burstSoul(s, p, false);
  s.st.souls = [];
}

// ---- the tier changing mid-fight -----------------------------------------------------------

/** Every soul leaves its pillar (the fight left mythic): each soul pillar is a
 *  plain pillar of its kind again, whole, its bar, its song and its walk gone,
 *  its soul seen climbing out of the stone. Nothing bursts, nothing falls. */
export function releaseSouls(s: CouncilScope): number {
  let n = 0;
  for (const p of councilPillars(s.ctx, s.inst)) {
    if (!p.soul) continue;
    s.ctx.emit({
      type: 'spellfxAt',
      x: p.e.pos.x,
      z: p.e.pos.z,
      school: 'physical',
      fx: 'burst',
      ability: COUNCIL_CUES.soulBurst,
      radius: p.r,
    });
    quietPillar(p.e);
    p.e.templateId = councilPillarTemplate(councilPillarFull(p.risen), p.risen);
    n++;
  }
  s.st.souls = [];
  if (n > 0) syncPillarWalls(s.ctx, s.inst);
  return n;
}

/**
 * The fight's tier changed (`/dev heart council mythic|heroic on|off`): apply
 * Soul in the Stone whole, never half. Off mythic every standing soul leaves
 * its pillar; onto mythic every member already fallen this pull whose soul
 * neither stands nor burst takes its pillar now, in the order they fell (the
 * rest of mythic, the inheritances and the rock, read the rules each tick).
 * Returns how many souls moved.
 */
export function syncSoulsToTier(s: CouncilScope): number {
  if (!s.rules.soulInTheStone) return releaseSouls(s);
  if (!firstLiving(s)) return 0;
  let n = 0;
  for (const role of s.st.fallen) {
    if (s.st.souls.some((q) => q.role === role) || s.st.soulsSpent.includes(role)) continue;
    const body = s.bodies[role];
    if (body && takeSoul(s, role, body)) n++;
  }
  return n;
}

// ---- dev ------------------------------------------------------------------------------------

/** `/dev heart council soul <role>` and `soulpip <n>`: the reply, or null
 *  for another verb. */
export function soulDevTrigger(
  s: CouncilScope,
  verb: string,
  arg: string | undefined,
): string | null {
  if (verb === 'soul') {
    const role = COUNCIL_ROLES.find((r) => r === arg);
    if (!role) return 'Name a soul: /dev heart council soul guardian|slabwright|singer.';
    const body = s.bodies[role];
    if (!body) return 'That member is missing from this run.';
    if (s.st.souls.some((q) => q.role === role))
      return `The ${role}'s soul already holds a pillar.`;
    return takeSoul(s, role, body)
      ? `The ${role}'s soul takes the stone.`
      : 'No pillar could hold the soul.';
  }
  if (verb === 'soulpip') {
    const n = Number(arg);
    if (!Number.isFinite(n)) return 'Name how many pips to leave: /dev heart council soulpip 1.';
    const want = Math.max(0, Math.min(T.soulPips, Math.round(n)));
    let touched = 0;
    for (const p of councilPillars(s.ctx, s.inst)) {
      if (!p.soul) continue;
      touched++;
      if (want > p.integrity) {
        p.integrity = want;
        p.e.templateId = councilSoulTemplate(p.soul, p.risen, want);
        continue;
      }
      while (p.integrity > want && s.ctx.entities.has(p.e.id)) strikeSoulPip(s, p, 'dev');
    }
    return touched === 0 ? 'No soul pillar stands.' : `Soul pillars left at ${want} pips.`;
  }
  return null;
}

/** The souls for the readout ("guardian 3, singer 1"). */
export function soulReadout(s: Pick<CouncilScope, 'ctx' | 'inst' | 'st'>): string {
  const parts: string[] = [];
  for (const p of councilPillars(s.ctx, s.inst)) if (p.soul) parts.push(`${p.soul} ${p.integrity}`);
  return parts.join(', ') || 'none';
}
