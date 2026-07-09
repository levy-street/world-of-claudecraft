// Protect Yumi mystery power-ups: a randomized, high-impact pickup that spawns
// on the maze during a live bout. Every orb shows the same `(?)` icon; the type
// is chosen at spawn but hidden until a fighter scoops it. Each grants exactly
// one flat 15-second advantage, and a player runs ONLY ONE at a time: while a
// power-up is active you cannot grab another, so you must wait it out.
//
// Grabbing is a HOLD-TO-CHANNEL: a fighter holds Interact next to a ready orb
// and the grab takes YUMI_POWERUP_GRAB_TIME seconds (a cast-style bar). The
// channel cancels if the player is stunned, already holds a power-up, leaves the
// orb radius, releases Interact, or the orb is taken/despawns; movement in-place
// is fine. The channel is SERVER-AUTHORITATIVE (advanced here each tick); the
// client only sends yumiGrabStart/yumiGrabStop intent.
//
// Architecture: a sibling A-slice next to social/yumi.ts, driven once per tick
// from updateYumiActive. State lives on `match.yumi` (the orbs, the spawn
// countdown, an id counter, and the in-progress grabs); the channel progress
// rides `entity.yumiGrabRemaining`/`yumiGrabTotal` (self-wire, like swingTimer)
// so the grab bar reads it. The module talks only to the SimContext seam. The
// effects themselves are real auras handled at their hot paths (dealDamage for
// invuln/berserk, the free-cast plumbing for endless mana, the stealthed cache
// for stealth), so they survive recalc and auto-expire.
//
// Determinism: the def pick and the spawn point draw from the PER-MATCH stream
// `match.yumi.rng` (the fiesta two-stream rule), never the shared sim stream, so
// existing golden traces stay byte-identical. A spawn always draws EXACTLY two
// values (def, then point) regardless of how many maze cells are free. The grab
// channel draws no rng.

import { isStunned } from '../combat/cc';
import { yumiMazeOrigin } from '../data';
import type { ArenaMatch, YumiGroundPowerup } from '../sim';
import type { SimContext } from '../sim_context';
import { type AuraKind, DT, type Entity } from '../types';
import { teleportPoints, yumiMazeLayout } from '../yumi_maze_layout';

// ---- Tuning (all configurable in one place) --------------------------------
export const YUMI_POWERUP_DURATION = 15; // s each mystery power-up lasts
export const YUMI_POWERUP_GRAB_TIME = 1.8; // s to hold Interact to grab an orb
export const YUMI_POWERUP_FIRST = 25; // s into the bout before the first spawn attempt
export const YUMI_POWERUP_INTERVAL = 45; // s between spawn attempts (special, not constant)
export const YUMI_POWERUP_TELEGRAPH = 4; // s of "spawning" warning before it is grabbable
export const YUMI_POWERUP_TTL = 20; // s a ready power-up waits to be grabbed
export const YUMI_POWERUP_RADIUS = 2.5; // grab radius (yd)
export const YUMI_POWERUP_MAX = 1; // concurrent orbs on the maze (one at a time = special)
export const YUMI_POWERUP_MIN_PLAYER_DIST = 6; // never spawn within this of a live fighter
export const YUMI_BERSERK_DMG_MULT = 1.4; // Berserker deals +40% damage
export const YUMI_BERSERK_TAKEN_MULT = 1.35; // Berserker takes +35% damage

// The shared aura id every mystery power-up buff carries, so the replace-not-
// stack strip finds them by id or kind.
export const MYSTERY_POWERUP_AURA_ID = 'mystery_powerup';

export interface MysteryPowerupDef {
  id: 'invuln' | 'stealth' | 'endless_mana' | 'berserk';
  auraKind: AuraKind; // the aura the pickup grants
  // English buff-frame / aura-log label. Re-localized client-side by aura NAME
  // via AURA_NAME_KEY in src/ui/sim_i18n.ts (the banner + "grabbed" lines
  // localize by defId instead). Keep the two in sync when renaming.
  auraName: string;
  auraColor: number | null; // carrier hue (hex); null = no aura (Stealth stays hidden)
  value: number; // berserk: outgoing damage mult; others: unused (1)
}

export const MYSTERY_POWERUPS: MysteryPowerupDef[] = [
  { id: 'invuln', auraKind: 'pu_invuln', auraName: 'Invulnerable', auraColor: 0xffd700, value: 1 },
  // Stealth deliberately has NO carrier aura (auraColor null): a glow would give
  // the hidden player away.
  { id: 'stealth', auraKind: 'pu_stealth', auraName: 'Stealth', auraColor: null, value: 1 },
  {
    id: 'endless_mana',
    auraKind: 'pu_endless_mana',
    auraName: 'Endless Mana',
    auraColor: 0x3aa0ff,
    value: 1,
  },
  {
    id: 'berserk',
    auraKind: 'pu_berserk',
    auraName: 'Berserker',
    auraColor: 0xff3b30,
    value: YUMI_BERSERK_DMG_MULT,
  },
];

export const MYSTERY_POWERUPS_BY_ID: Record<string, MysteryPowerupDef> = Object.fromEntries(
  MYSTERY_POWERUPS.map((d) => [d.id, d]),
);

const MYSTERY_POWERUP_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'pu_invuln',
  'pu_stealth',
  'pu_endless_mana',
  'pu_berserk',
]);

export function isMysteryPowerupAura(kind: AuraKind): boolean {
  return MYSTERY_POWERUP_KINDS.has(kind);
}

// ---- Per-tick driver -------------------------------------------------------

export function updateYumiPowerups(ctx: SimContext, match: ArenaMatch): void {
  const y = match.yumi!;
  // Age each orb: spawning -> ready -> despawn.
  for (let i = y.powerups.length - 1; i >= 0; i--) {
    const p = y.powerups[i];
    p.timer -= DT;
    if (p.timer <= 0) {
      if (p.state === 'spawning') {
        p.state = 'ready';
        p.timer = YUMI_POWERUP_TTL;
      } else {
        y.powerups.splice(i, 1);
      }
      // Any transition forces an immediate yumiStatus heartbeat: the orbs ride
      // that heartbeat online (the arena wire is rate-limited ~10s, coarser
      // than the 4s telegraph), so ready/timeout must not wait a whole second.
      y.statusDirty = true;
    }
  }
  // Advance every in-progress hold-to-grab channel (grant on completion).
  updateYumiGrabs(ctx, match);
  // Spawn cadence: frozen during sudden death (like the cat teleports), and only
  // one orb on the maze at a time so each one feels special.
  if (y.suddenDeath) return;
  y.powerupTimer -= DT;
  if (y.powerupTimer <= 0) {
    y.powerupTimer = YUMI_POWERUP_INTERVAL;
    if (y.powerups.length < YUMI_POWERUP_MAX) spawnYumiPowerup(ctx, match);
  }
}

export function spawnYumiPowerup(ctx: SimContext, match: ArenaMatch): void {
  const y = match.yumi!;
  const def = y.rng.pick(MYSTERY_POWERUPS);
  const origin = yumiMazeOrigin(match.slot);
  const pts = teleportPoints(yumiMazeLayout());
  // Collect live fighter positions so we never drop an orb on top of someone.
  const livePos: { x: number; z: number }[] = [];
  for (const pid of ctx.arenaAllPids(match)) {
    if (ctx.arenaIsDown(match, pid)) continue;
    const e = ctx.entities.get(pid);
    if (e && !e.dead) livePos.push(e.pos);
  }
  const clear = (p: { x: number; z: number }) => {
    const wx = origin.x + p.x;
    const wz = origin.z + p.z;
    return livePos.every((q) => Math.hypot(q.x - wx, q.z - wz) >= YUMI_POWERUP_MIN_PLAYER_DIST);
  };
  // The same fair, symmetric, reachable maze cells the cats teleport onto (valid
  // terrain for free). Prefer cells clear of players; fall back to the full set
  // if the maze is crowded so the draw count stays geometry-independent.
  const candidates = pts.filter(clear);
  const pool = candidates.length > 0 ? candidates : pts;
  const p = pool[Math.floor(y.rng.next() * pool.length)];
  const pos = ctx.groundPos(origin.x + p.x, origin.z + p.z);
  y.powerups.push({
    id: y.nextPowerupId++,
    defId: def.id,
    x: pos.x,
    z: pos.z,
    state: 'spawning',
    timer: YUMI_POWERUP_TELEGRAPH,
  });
  y.statusDirty = true; // spawn transition: force an immediate heartbeat (orbs ride it online)
  // Personal per fighter (an anchor-less world event would broadcast realm-wide,
  // and only the maze fighters can see it anyway).
  for (const pid of ctx.arenaAllPids(match)) {
    ctx.emit({ type: 'yumiPowerupSpawn', x: pos.x, z: pos.z, pid });
  }
}

// ---- Hold-to-grab channel --------------------------------------------------

function clearGrabState(e: Entity): void {
  e.yumiGrabRemaining = 0;
  e.yumiGrabTotal = 0;
}

// True when this fighter may start or keep grabbing `orb`: the orb is ready, the
// fighter is alive/unbenched, NOT stunned, does NOT already hold a power-up (the
// one-at-a-time rule), and is within the grab radius (movement in-place is fine,
// only leaving the radius cancels).
function canGrab(
  ctx: SimContext,
  match: ArenaMatch,
  e: Entity,
  orb: YumiGroundPowerup | undefined,
): boolean {
  return (
    !!orb &&
    orb.state === 'ready' &&
    !e.dead &&
    !ctx.arenaIsDown(match, e.id) &&
    !isStunned(e) &&
    !e.auras.some((a) => isMysteryPowerupAura(a.kind)) &&
    Math.hypot(e.pos.x - orb.x, e.pos.z - orb.z) <= YUMI_POWERUP_RADIUS
  );
}

// Begin (or refresh) a fighter's grab of a ready orb; idempotent for the same
// orb, switching orbs restarts the channel. A no-op when the grab is not allowed
// (stunned, already holding a power-up, out of range, orb gone).
export function startYumiGrab(ctx: SimContext, match: ArenaMatch, e: Entity, orbId: number): void {
  const y = match.yumi!;
  const orb = y.powerups.find((p) => p.id === orbId);
  if (!canGrab(ctx, match, e, orb)) return;
  if (y.grab.get(e.id) === orbId) return; // already channeling this orb
  y.grab.set(e.id, orbId);
  e.yumiGrabRemaining = YUMI_POWERUP_GRAB_TIME;
  e.yumiGrabTotal = YUMI_POWERUP_GRAB_TIME;
}

// Release a fighter's grab (Interact up, or a forced cancel); clears the bar.
export function stopYumiGrab(match: ArenaMatch, e: Entity): void {
  match.yumi!.grab.delete(e.id);
  clearGrabState(e);
}

// Per-tick: advance each in-progress channel, cancel any that became invalid
// (stun, out of range, orb taken/despawned, already holding), and grant the
// power-up the instant the 1.8s completes.
//
// Same-tick tie-break: two fighters can finish channeling the SAME orb on one
// tick. We iterate `y.grab` in Map insertion order, so the one who called
// startYumiGrab first wins and the other's grab cancels next tick (its orb is
// gone -> canGrab false). This is deterministic (Map insertion order is stable
// and replays identically) but it is NOT proximity- or channel-start-time-based;
// since every channel is the same fixed 1.8s, "first to start" is also the first
// to finish, so the ordering is intuitive in practice.
export function updateYumiGrabs(ctx: SimContext, match: ArenaMatch): void {
  const y = match.yumi!;
  for (const [pid, orbId] of [...y.grab]) {
    const e = ctx.entities.get(pid);
    const orb = y.powerups.find((p) => p.id === orbId);
    if (!e || !canGrab(ctx, match, e, orb)) {
      if (e) stopYumiGrab(match, e);
      else y.grab.delete(pid);
      continue;
    }
    e.yumiGrabRemaining -= DT;
    if (e.yumiGrabRemaining > 0) continue;
    // Completed: grant the power-up and consume the orb.
    y.grab.delete(pid);
    clearGrabState(e);
    applyMysteryPowerup(ctx, e, orb!.defId);
    const idx = y.powerups.indexOf(orb!);
    if (idx >= 0) y.powerups.splice(idx, 1);
    y.statusDirty = true; // grab transition: force an immediate heartbeat (orbs ride it online)
  }
}

// Grant a mystery power-up's aura and emit the world pickup event (pop VFX +
// carrier aura + banner; auraColor null for Stealth = no aura). The one-at-a-
// time rule is enforced upstream (you cannot grab while holding), so the filter
// below is a defensive strip, not a replace.
export function applyMysteryPowerup(ctx: SimContext, e: Entity, defId: string): void {
  const def = MYSTERY_POWERUPS_BY_ID[defId];
  if (!def) return;
  // Defensive: drop any lingering mystery-power-up aura so the grant is clean.
  e.auras = e.auras.filter((a) => !isMysteryPowerupAura(a.kind));
  ctx.applyAura(e, {
    id: MYSTERY_POWERUP_AURA_ID,
    name: def.auraName,
    kind: def.auraKind,
    remaining: YUMI_POWERUP_DURATION,
    duration: YUMI_POWERUP_DURATION,
    value: def.value,
    sourceId: e.id,
    school: 'arcane',
  });
  // Keep the stealth cache live this frame (updateAuras also recomputes it);
  // pu_stealth drives it exactly like the rogue 'stealth' aura.
  e.stealthed = e.auras.some((a) => a.kind === 'stealth' || a.kind === 'pu_stealth');
  ctx.emit({
    type: 'yumiPowerup',
    entityId: e.id,
    defId: def.id,
    auraColor: def.auraColor,
    duration: YUMI_POWERUP_DURATION,
  });
}

// ---- Presentation reads (consumed by yumiMatchInfo / the HUD timer) ---------

export interface YumiGroundPowerupView {
  id: number;
  x: number;
  z: number;
  state: 'spawning' | 'ready';
  frac: number; // spawning: telegraph progress 0..1; ready: lifetime remaining 0..1
}

// The orbs as the renderer/HUD sees them: position + state + progress, but NEVER
// the type (the mystery is the whole point; every orb is a `(?)`).
export function yumiPowerupViews(match: ArenaMatch): YumiGroundPowerupView[] {
  const y = match.yumi!;
  return y.powerups.map((p) => ({
    id: p.id,
    x: p.x,
    z: p.z,
    state: p.state,
    frac:
      p.state === 'spawning'
        ? Math.max(0, Math.min(1, 1 - p.timer / YUMI_POWERUP_TELEGRAPH))
        : Math.max(0, Math.min(1, p.timer / YUMI_POWERUP_TTL)),
  }));
}

// Whole seconds until the next spawn attempt for the HUD availability timer. 0
// while an orb is already on the maze (nothing to wait for).
export function yumiNextPowerupIn(match: ArenaMatch): number {
  const y = match.yumi!;
  if (y.powerups.length > 0) return 0;
  return Math.max(0, Math.ceil(y.powerupTimer));
}
