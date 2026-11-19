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
//                 it, a Wrath leaves it standing); only a Falling Rock landing
//                 within 6 yd of its face strikes a pip off (council_stone.ts
//                 calls strikeSoulPip; Resonance is a spread now and never
//                 touches a pillar). A living member always drops the rock on
//                 mythic (the Guardian keeps it once the Singer has fallen).
//                 It shields nobody from Mountain's Wrath or the Echo, but its
//                 wall still stands.
//   At 0 pips     it bursts and leaves the usual rubble; its behaviour stops.
//                 Nothing else: the survivors keep their Memory of Stone and
//                 their mythic inheritance.
//   The last kill every soul pillar crumbles with the council.
//
// What it does is whose soul it holds (two souls, one per member: the
// Slabwright's Walking Slab left with it in the two-boss rework):
//   Guardian      Echo of Wrath: every 20 s the pillar's own 3 s bar, then 60
//                 percent of a Wrath on every player with no other pillar
//                 between them and it; a pillar that shields someone loses a
//                 piece, like the Wrath.
//   Seam Singer   the Endless Song: a raid-wide pulse every 3 s, each 12
//                 percent louder than the first, capped at 4 times it (the
//                 pulse count is a stack of an aura on the pillar).
//
// Deterministic: every pick is ordered (integrity, distance, entity id); the
// only rng draws are the damage rolls, in
// claim-player order. Zero draws off mythic (no soul ever stands there).

import { HAMMER_PIT } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { dropAuraById, dropEncounterObject } from '../sunken_bastion/claim';
import { stampFloor } from './council_floor_gap';
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
import { type CouncilScope, damageMult, living, roll } from './council_scope';
import type { CouncilSoul } from './council_state';

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
    if (p.soul || p.cursed) continue;
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
    timer: role === 'guardian' ? T.echoFirst : T.songPulseFirst,
    echo: null,
    pulses: 0,
  });
  s.ctx.emit({
    type: 'spellfx',
    sourceId: from.id,
    targetId: e.id,
    school: 'physical',
    fx: 'beam',
    ability: COUNCIL_CUES.soulTake,
  });
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
}

/** A Falling Rock strikes one soul pip off (the only thing that can). Returns true when the pillar burst. */
export function strikeSoulPip(s: CouncilScope, p: CouncilPillar, _cause: 'rock' | 'dev'): boolean {
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
  const cover = councilPillars(ctx, inst).filter((p) => !p.soul && !p.cursed);
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

/** Its bar counts down and lands; between two bars its clock runs (the bar
 *  itself starts through the floor gap: startEcho). */
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
}

/** The Guardian's soul and its standing pillar, or null. */
function guardianSoul(s: CouncilScope): { soul: CouncilSoul; pillar: Entity } | null {
  const soul = s.st.souls.find((q) => q.role === 'guardian');
  if (!soul) return null;
  const p = councilPillars(s.ctx, s.inst).find(
    (q) => q.e.id === soul.pillarId && q.soul === 'guardian',
  );
  return p ? { soul, pillar: p.e } : null;
}

/** The Echo's clock has run out and no bar of it is in flight. */
export function guardianSoulReady(s: CouncilScope): boolean {
  const g = guardianSoul(s);
  return g !== null && g.soul.echo === null && g.soul.timer <= 1e-9 && firstLiving(s) !== null;
}

/** The Echo of Wrath's bar begins on its pillar (a floor mechanic: the floor
 *  gap calls it, council_floor.ts). */
export function startEcho(s: CouncilScope): boolean {
  if (!guardianSoulReady(s)) return false;
  const g = guardianSoul(s);
  const source = firstLiving(s);
  if (!g || !source) return false;
  const { soul, pillar } = g;
  soul.timer = T.echoEvery;
  soul.echo = T.echoCast;
  s.st.casts++;
  stampFloor(s.st);
  pillar.castingAbility = COUNCIL_CASTS.echo;
  pillar.castTotal = T.echoCast;
  pillar.castRemaining = T.echoCast;
  pillar.castTargetId = null;
  return true;
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
    if (!role) return 'Name a soul: /dev heart council soul guardian|singer.';
    const body = s.bodies[role];
    if (!body) return 'That member is missing from this run.';
    if (s.st.souls.some((q) => q.role === role))
      return `The ${role}'s soul already holds a pillar.`;
    if (!takeSoul(s, role, body)) return 'No pillar could hold the soul.';
    return `The ${role}'s soul takes the stone.`;
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
