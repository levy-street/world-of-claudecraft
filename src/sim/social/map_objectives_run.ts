// The objective driver for AUTHORED MAPS: the flags and rune pads a maker
// tagged actually work.
//
// Ravenrift (social/battleground.ts) has had a complete capture-the-flag
// simulation for a long time, deliberate pickup, carry, drop on death, own-team
// return, timed auto-return, the classic own-flag-home capture gate, scoring.
// None of it could ever run on a map somebody made, because every anchor it
// reads is a module constant in battleground_layout.ts and the whole mode lives
// in a fixed instance band. A maker who placed a flag got a banner model and an
// inert `regionRole` tag.
//
// This module is the other half. It reads the anchors off the ACTIVE world
// content (sim/map_objectives.ts projects them out of the map's placements) and
// runs the same rules on the map's own coordinates, so pressing the flag key
// next to your own authored flag picks it up.
//
// What it deliberately is NOT: matchmaking, ranked teams, Elo, honor, the
// ladder, wave respawns, the graveyard rite. Those are Ravenrift's, they are
// tied to its queue and its instance band, and a maker walking their own map
// wants none of them. This is a REHEARSAL, one local side, practice bots on
// the other, the objective rules faithful.
//
// Gating: `run()` returns null unless the active content is an authored map
// (isAuthoredMapPresentation) carrying a playable objective record. The built-in
// world can never enter this code, and neither can a map that tagged nothing.
//
// Determinism: no rng at all. Rune recharges and the flag return clock are tick
// math; a claimed power rune flips its face deterministically, exactly as
// Ravenrift's does; bot decisions are pure functions of position.

import { getActiveWorldContent } from '../data';
import { createGroundObject } from '../entity';
import type { MapObjectives, ObjectivePoint } from '../map_objectives';
import { objectivesArePlayable } from '../map_objectives';
import { isAuthoredMapPresentation } from '../map_presentation';
import type { SimContext } from '../sim_context';
import { DT, type Entity, type Vec3 } from '../types';
import { BATTLE_RUNE_AURA_ID, SPRINT_RUNE_AURA_ID, WARD_RUNE_AURA_ID } from './battleground';

// Tuning, mirroring Ravenrift's so a map plays the way the shipped battleground
// does. Its copies are module-private over there and that module is heavily
// pinned by tests, so these are restated rather than exported out of it; the
// AURA IDS are imported, so a rune here grants literally the same buff the
// battleground grants and the HUD shows the same thing.
const PICKUP_RADIUS = 2.5; // press the flag action this close to grab it
const CAPTURE_RADIUS = 4; // carry the enemy flag this close to your own stand
const FLAG_RETURN_TIME = 20; // a dropped flag auto-returns home after this
const RUNE_RADIUS = 2.5; // step this close to a pad to claim it
const RUNE_COOLDOWN = 30; // a claimed pad recharges over this
const RUNE_SPEED = 1.4; // sprint multiplier
const RUNE_DURATION = 10; // seconds of haste
const POWER_RUNE_VALUE = 0.15; // +15% dealt / -15% taken
const POWER_RUNE_DURATION = 10;
/** Yards of ground the pickup zap lights up. Wider than the pad's own claim
 *  radius so the discharge reads as an explosion, not a sparkle. */
const ZAP_RADIUS = 5;

export type ObjTeam = 0 | 1;
// English at the source like every sim line: the flag announcements below are
// worded byte-for-byte as the client's map-objective rules in src/ui/sim_i18n.ts
// expect (the battleground flag-log family), and the flag entity names resolve
// through entityDisplayName (src/ui/entity_display_core.ts).
const TEAM_NAMES = ['Crimson', 'Azure'] as const;
const TEAM_COLORS = [0xd1413a, 0x3a78d1] as const;

export interface ObjFlag {
  team: ObjTeam;
  home: Vec3;
  pos: Vec3;
  state: 'home' | 'carried' | 'dropped';
  carrier: number | null;
  dropTimer: number;
  entityId: number;
}

type RuneFace = 'sprint' | 'damage' | 'defense';

export interface ObjRune {
  /** A pad is either a sprint pad or a power pad; a power pad alternates face. */
  power: boolean;
  face: RuneFace;
  pos: Vec3;
  active: boolean;
  cooldown: number;
  entityId: number;
}

export interface ObjectiveRun {
  flags: [ObjFlag, ObjFlag];
  runes: ObjRune[];
  scores: [number, number];
  /** pid -> side. The local player joins the base they spawned nearest. */
  teamOf: Map<number, ObjTeam>;
  /** Flag-action presses waiting for this tick, cleared every tick. */
  pendingPress: Set<number>;
  /** Signature of the objective record this run was built from; a different
   *  map (or a re-export that moved a flag) rebuilds instead of drifting. */
  signature: string;
}

// State hangs off the SimContext rather than off Sim: the ctx object is built
// once per Sim (buildSimContext) and never replaced, so it is a stable identity,
// and a WeakMap keeps a torn-down Sim collectable. Same shape as the ramp cache
// in sim/placement_ramps.ts.
const runs = new WeakMap<SimContext, ObjectiveRun>();

function dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function signatureOf(o: MapObjectives): string {
  const pt = (p: ObjectivePoint | null) => (p ? `${p.x.toFixed(2)},${p.z.toFixed(2)}` : '-');
  return [
    o.bases.map((b) => `${pt(b.flag)}|${b.spawns.map(pt).join('~')}`).join(';'),
    o.speedRunes.map(pt).join('~'),
    o.powerRunes.map(pt).join('~'),
  ].join('#');
}

/** The objective record for the live world, or null when this world has none. */
function activeObjectives(): MapObjectives | null {
  const content = getActiveWorldContent();
  if (!isAuthoredMapPresentation(content.presentationMode)) return null;
  const o = content.objectives;
  return objectivesArePlayable(o) ? (o as MapObjectives) : null;
}

/** The live run for this Sim, built on first use and rebuilt when the map's
 *  anchors change underneath it. Null when the world carries no objectives. */
export function objectiveRun(ctx: SimContext): ObjectiveRun | null {
  const objectives = activeObjectives();
  if (!objectives) {
    const stale = runs.get(ctx);
    if (stale) {
      teardownRun(ctx, stale);
      runs.delete(ctx);
    }
    return null;
  }
  const signature = signatureOf(objectives);
  const existing = runs.get(ctx);
  if (existing && existing.signature === signature) return existing;
  if (existing) teardownRun(ctx, existing);
  const run = buildRun(ctx, objectives, signature);
  runs.set(ctx, run);
  return run;
}

function teardownRun(ctx: SimContext, run: ObjectiveRun): void {
  for (const flag of run.flags) {
    if (flag.entityId >= 0) ctx.dropEntity(flag.entityId);
  }
  for (const rune of run.runes) {
    if (rune.entityId >= 0) ctx.dropEntity(rune.entityId);
  }
}

function buildRun(ctx: SimContext, o: MapObjectives, signature: string): ObjectiveRun {
  const flags = [0, 1].map((team) => {
    const anchor = o.bases[team].flag as ObjectivePoint;
    const home = ctx.groundPos(anchor.x, anchor.z);
    const flag: ObjFlag = {
      team: team as ObjTeam,
      home,
      pos: { ...home },
      state: 'home',
      carrier: null,
      dropTimer: 0,
      entityId: -1,
    };
    return flag;
  }) as [ObjFlag, ObjFlag];

  const runes: ObjRune[] = [
    ...o.speedRunes.map((p) => ({
      power: false,
      face: 'sprint' as RuneFace,
      pos: ctx.groundPos(p.x, p.z),
      active: true,
      cooldown: 0,
      entityId: -1,
    })),
    // Power pads open on alternating faces by INDEX, not by a draw: the mode
    // stays zero-rng, and the two mirrored halves of a symmetric map open the
    // same way round.
    ...o.powerRunes.map((p, i) => ({
      power: true,
      face: (i % 2 === 0 ? 'damage' : 'defense') as RuneFace,
      pos: ctx.groundPos(p.x, p.z),
      active: true,
      cooldown: 0,
      entityId: -1,
    })),
  ];

  const run: ObjectiveRun = {
    flags,
    runes,
    scores: [0, 0],
    teamOf: new Map(),
    pendingPress: new Set(),
    signature,
  };
  for (const flag of run.flags) spawnFlagEntity(ctx, flag);
  for (const rune of run.runes) spawnRuneEntity(ctx, rune);
  return run;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
// Both reuse the battleground's own template ids, so render/battleground_props
// draws them with the pole-and-cloth and the rune mote it already has. Nothing
// new had to be modeled for an authored map to show a working flag.

function spawnFlagEntity(ctx: SimContext, flag: ObjFlag): void {
  const e = createGroundObject(ctx.nextId++, '', `${TEAM_NAMES[flag.team]} Flag`, { ...flag.pos });
  e.templateId = 'bg_flag';
  e.objectItemId = null;
  e.lootable = false;
  e.color = TEAM_COLORS[flag.team];
  ctx.addEntity(e);
  flag.entityId = e.id;
}

const RUNE_VISUALS: Record<RuneFace, { name: string; color: number }> = {
  sprint: { name: 'Sprint Rune', color: 0xff9a3c },
  damage: { name: 'Battle Rune', color: 0xe0392e },
  defense: { name: 'Ward Rune', color: 0x3ccfe8 },
};

function spawnRuneEntity(ctx: SimContext, rune: ObjRune): void {
  const visual = RUNE_VISUALS[rune.face];
  const e = createGroundObject(ctx.nextId++, '', visual.name, { ...rune.pos });
  // Its OWN template id, not Ravenrift's: the renderer routes anything 'bg_' to
  // the same builder, and that builder gives this one a spinning lightning bolt
  // whatever the pad grants (render/battleground_props.ts).
  e.templateId = 'bg_map_rune';
  e.objectItemId = null;
  e.lootable = false;
  e.color = visual.color;
  ctx.addEntity(e);
  rune.entityId = e.id;
}

function syncFlagEntity(ctx: SimContext, flag: ObjFlag): void {
  const e = ctx.entities.get(flag.entityId);
  if (!e) return;
  e.pos = { ...flag.pos };
  e.prevPos = { ...flag.pos };
  ctx.rebucket(e);
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/** The side a player fights for: the base whose flag they are nearest when the
 *  run first sees them. On a mirrored map that is simply the half they spawned
 *  in, which is what a maker pressing Playtest expects. */
export function objectiveTeamOf(run: ObjectiveRun, e: Entity): ObjTeam {
  // A bot is created for a side and keeps it; only players are read off the
  // ground they are standing on.
  if (e.objectiveBot) return e.objectiveBot.team;
  const known = run.teamOf.get(e.id);
  if (known !== undefined) return known;
  const d0 = dist2d(e.pos, run.flags[0].home);
  const d1 = dist2d(e.pos, run.flags[1].home);
  const team: ObjTeam = d0 <= d1 ? 0 : 1;
  run.teamOf.set(e.id, team);
  return team;
}

/** Every live body the run should consider: players and practice bots. */
function participants(ctx: SimContext): Entity[] {
  const out: Entity[] = [];
  for (const e of ctx.entities.values()) {
    if (e.dead) continue;
    if (e.kind === 'player') out.push(e);
    else if (e.objectiveBot) out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function updateMapObjectives(ctx: SimContext): void {
  const run = objectiveRun(ctx);
  if (!run) return;
  const bodies = participants(ctx);
  tickRunes(ctx, run, bodies);
  tickFlags(ctx, run, bodies);
  run.pendingPress.clear();
}

function tickRunes(ctx: SimContext, run: ObjectiveRun, bodies: Entity[]): void {
  for (const rune of run.runes) {
    if (!rune.active) {
      rune.cooldown -= DT;
      if (rune.cooldown <= 0) {
        rune.active = true;
        spawnRuneEntity(ctx, rune);
      }
      continue;
    }
    // Walk-over, unlike the flag: the first body inside the radius claims it.
    for (const e of bodies) {
      if (dist2d(e.pos, rune.pos) > RUNE_RADIUS) continue;
      grantRune(ctx, rune, e);
      zapBurst(ctx, rune);
      rune.active = false;
      rune.cooldown = RUNE_COOLDOWN;
      if (rune.entityId >= 0) {
        ctx.dropEntity(rune.entityId);
        rune.entityId = -1;
      }
      // A claimed power pad flips its face for the next spawn: variety without
      // a draw. Sprint pads always come back as sprint.
      if (rune.power) rune.face = rune.face === 'damage' ? 'defense' : 'damage';
      break;
    }
  }
}

/**
 * The discharge a pad goes off with when somebody takes it.
 *
 * 'nova' is the renderer's heavy detonation (renderer.ts spellfxAt) and the
 * radius flashes a terrain-draped ring under it, so the bolt does not just
 * vanish, it blows up and the ground lights. Purely cosmetic: the buff and the
 * despawn above are the mechanics, and nothing reads this event back.
 */
function zapBurst(ctx: SimContext, rune: ObjRune): void {
  ctx.emit({
    type: 'spellfxAt',
    x: rune.pos.x,
    z: rune.pos.z,
    school: 'lightning',
    fx: 'nova',
    radius: ZAP_RADIUS,
  });
}

function grantRune(ctx: SimContext, rune: ObjRune, e: Entity): void {
  const pid = e.kind === 'player' ? e.id : undefined;
  if (rune.face === 'sprint') {
    ctx.applyAura(e, {
      id: SPRINT_RUNE_AURA_ID,
      name: 'Sprint',
      kind: 'buff_speed',
      value: RUNE_SPEED,
      remaining: RUNE_DURATION,
      duration: RUNE_DURATION,
      sourceId: e.id,
      school: 'physical',
    });
    if (pid !== undefined) {
      ctx.emit({ type: 'log', text: 'You seize a Sprint Rune!', color: '#ff9a3c', pid });
    }
    return;
  }
  if (rune.face === 'damage') {
    ctx.applyAura(e, {
      id: BATTLE_RUNE_AURA_ID,
      name: 'Battle Rune',
      kind: 'buff_dmg_done',
      value: POWER_RUNE_VALUE,
      remaining: POWER_RUNE_DURATION,
      duration: POWER_RUNE_DURATION,
      sourceId: e.id,
      school: 'physical',
    });
    if (pid !== undefined) {
      ctx.emit({ type: 'log', text: 'You seize a Battle Rune!', color: '#ff6a5a', pid });
    }
    return;
  }
  ctx.applyAura(e, {
    id: WARD_RUNE_AURA_ID,
    name: 'Ward Rune',
    kind: 'shield_wall',
    value: POWER_RUNE_VALUE,
    remaining: POWER_RUNE_DURATION,
    duration: POWER_RUNE_DURATION,
    sourceId: e.id,
    school: 'physical',
  });
  if (pid !== undefined) {
    ctx.emit({ type: 'log', text: 'You seize a Ward Rune!', color: '#3ccfe8', pid });
  }
}

function tickFlags(ctx: SimContext, run: ObjectiveRun, bodies: Entity[]): void {
  for (const flag of run.flags) {
    if (flag.state === 'carried') {
      tickCarriedFlag(ctx, run, flag);
      continue;
    }
    // 1) The flag's OWN side returns a dropped flag by proximity, automatically
    //    and instantly. Ordered BEFORE pickup presses, so a return beats a
    //    same-tick grab, the pinned race rule Ravenrift uses.
    if (flag.state === 'dropped') {
      let returned = false;
      for (const e of bodies) {
        if (objectiveTeamOf(run, e) !== flag.team) continue;
        if (dist2d(e.pos, flag.pos) > PICKUP_RADIUS) continue;
        returnFlag(ctx, run, flag, nameOf(ctx, e));
        returned = true;
        break;
      }
      if (returned) continue;
    }
    // 2) The other side takes it, from the stand or off the ground, ONLY on the
    //    deliberate press. Walking over a flag never picks it up.
    let taken = false;
    for (const e of bodies) {
      if (!run.pendingPress.has(e.id)) continue;
      if (objectiveTeamOf(run, e) === flag.team) continue;
      if (dist2d(e.pos, flag.pos) > PICKUP_RADIUS) continue;
      if (run.flags.some((f) => f.carrier === e.id)) continue; // one flag per runner
      flag.state = 'carried';
      flag.carrier = e.id;
      breakStealthFor(ctx, e);
      announce(
        ctx,
        run,
        `${nameOf(ctx, e)} has taken the ${TEAM_NAMES[flag.team]} flag!`,
        '#ffd479',
      );
      taken = true;
      break;
    }
    if (taken) continue;
    if (flag.state === 'dropped') {
      flag.dropTimer -= DT;
      if (flag.dropTimer <= 0) returnFlag(ctx, run, flag, '');
    }
  }
}

function tickCarriedFlag(ctx: SimContext, run: ObjectiveRun, flag: ObjFlag): void {
  const carrier = flag.carrier !== null ? ctx.entities.get(flag.carrier) : null;
  if (!carrier || carrier.dead) {
    dropFlag(ctx, run, flag, carrier ?? null);
    return;
  }
  // Flags and hiding never mix: a carrier who goes invisible by any means drops
  // it on the spot and stays hidden, flagless.
  if (carrier.stealthed) {
    dropFlag(ctx, run, flag, carrier);
    return;
  }
  flag.pos = { ...carrier.pos };
  syncFlagEntity(ctx, flag);
  // The classic gate: a capture only resolves while your OWN flag is home. A
  // carrier waiting on their stand caps the moment their flag comes back.
  const carrierTeam = objectiveTeamOf(run, carrier);
  const ownFlag = run.flags[carrierTeam];
  if (dist2d(carrier.pos, ownFlag.home) <= CAPTURE_RADIUS && ownFlag.state === 'home') {
    captureFlag(ctx, run, flag, carrierTeam, nameOf(ctx, carrier));
  }
}

function captureFlag(
  ctx: SimContext,
  run: ObjectiveRun,
  flag: ObjFlag,
  scoringTeam: ObjTeam,
  byName: string,
): void {
  run.scores[scoringTeam]++;
  returnFlag(ctx, run, flag, '', true);
  const [crimsonCount, azureCount] = run.scores;
  announce(
    ctx,
    run,
    `${byName} captured the ${TEAM_NAMES[flag.team]} flag. Score ${crimsonCount}:${azureCount}.`,
    '#8fe388',
  );
}

function returnFlag(
  ctx: SimContext,
  run: ObjectiveRun,
  flag: ObjFlag,
  byName: string,
  silent = false,
): void {
  flag.state = 'home';
  flag.carrier = null;
  flag.dropTimer = 0;
  flag.pos = { ...flag.home };
  syncFlagEntity(ctx, flag);
  if (silent) return;
  // A defender's touch names the defender; the clock's own return has no actor.
  if (byName)
    announce(ctx, run, `${byName} returned the ${TEAM_NAMES[flag.team]} flag.`, '#9fd6c8');
  else announce(ctx, run, `The ${TEAM_NAMES[flag.team]} flag was returned.`, '#9fd6c8');
}

function dropFlag(ctx: SimContext, run: ObjectiveRun, flag: ObjFlag, at: Entity | null): void {
  const carrierName = flag.carrier !== null ? nameOf(ctx, ctx.entities.get(flag.carrier)) : '?';
  flag.state = 'dropped';
  flag.carrier = null;
  flag.dropTimer = FLAG_RETURN_TIME;
  if (at) flag.pos = { x: at.pos.x, y: at.pos.y, z: at.pos.z };
  syncFlagEntity(ctx, flag);
  announce(ctx, run, `${carrierName} dropped the ${TEAM_NAMES[flag.team]} flag.`, '#ff9a3c');
}

/** Strip every stealth-kind aura and refresh the cache: a flag grab is a
 *  deliberate, revealing act (mirrors Sim.breakStealth). */
function breakStealthFor(ctx: SimContext, e: Entity): void {
  for (let i = e.auras.length - 1; i >= 0; i--) {
    if (e.auras[i].kind !== 'stealth') continue;
    const name = e.auras[i].name;
    e.auras.splice(i, 1);
    ctx.emit({ type: 'aura', targetId: e.id, name, gained: false });
  }
  e.stealthed = false;
}

function nameOf(ctx: SimContext, e: Entity | null | undefined): string {
  if (!e) return '?';
  if (e.kind === 'player') return ctx.players.get(e.id)?.name ?? e.name ?? '?';
  return e.name ?? '?';
}

/** One line to every player in the world. A rehearsal has no team rosters to
 *  address, and everyone present is watching the same two flags. Every caller
 *  passes the line as ONE literal so the S3 drift guard
 *  (tests/localization_fixes.test.ts, its announce form) can read it. */
function announce(ctx: SimContext, _run: ObjectiveRun, text: string, color: string): void {
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'player' || e.dead) continue;
    ctx.emit({ type: 'log', text, color, pid: e.id });
  }
}

// ---------------------------------------------------------------------------
// Entry points reached from Sim
// ---------------------------------------------------------------------------

/** The deliberate flag press. Returns true when this world had an objective run
 *  to give it to, so the caller knows the key was consumed. */
export function mapObjectiveFlagAction(ctx: SimContext, pid: number): boolean {
  const run = objectiveRun(ctx);
  if (!run) return false;
  run.pendingPress.add(pid);
  return true;
}

/** Death hook: a carrier's death drops the flag where they fell. */
export function mapObjectiveOnDeath(ctx: SimContext, e: Entity): void {
  const run = runs.get(ctx);
  if (!run) return;
  for (const flag of run.flags) {
    if (flag.carrier === e.id) dropFlag(ctx, run, flag, e);
  }
}

/** Current score, for the HUD / tests. Null when no run is live. */
export function mapObjectiveScores(ctx: SimContext): [number, number] | null {
  const run = runs.get(ctx);
  return run ? [run.scores[0], run.scores[1]] : null;
}
