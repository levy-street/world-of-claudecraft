// Presentation math for Bonelord Xarreth's Wandering Scythe and Soul Harvest.
// Pure: no three, no DOM. Where the hazard IS comes straight from the shared sim
// choreography (src/sim/rift/hoard_bone_reaper_core.ts), so the picture can never
// drift off the hitbox; this file only decides how it LOOKS there: how it
// assembles, how heavy it moves, how long its trail is, how a soul floats, and
// which of two endings a vanished soul gets.

import {
  BONE_SCYTHE,
  BONE_SCYTHE_TOTAL_SEC,
  type BoneScytheFrame,
  SOUL_HARVEST,
  scytheAngle,
  scythePhase,
  scythePivot,
  soulPhase,
  soulPosition,
} from '../sim/rift/hoard_bone_reaper_core';

export const BONE_REAPER_LOOK = Object.freeze({
  /** Height of the blade plane over the ground: a player's chest. */
  bladeHeight: 1.15,
  /** It rises out of the floor while it assembles. */
  summonDepth: 1.4,
  /** How far it leans into its travel, radians per yard-per-second. */
  leanPerSpeed: 0.035,
  maxLean: 0.16,
  /** Seconds of blade history the spectral trail shows. Short: it must never
   *  close into a ring, or it would read as a standing hazard. */
  trailSec: 0.42,
  trailSamples: 9,
  /** Seconds of pivot history drawn as a faint wake on the floor. */
  wakeSec: 1.6,
  wakeSamples: 7,
  /** Ground scrape sparks thrown off the blade tip per second at full speed. */
  scrapePerSec: 14,
  necro: 0x7dffc8,
  necroDeep: 0x1c8f6a,
  bone: 0xe9e2c8,
  soul: 0x9bf3ff,
  soulCore: 0xf2ffff,
  soulDeep: 0x2f9fb8,
  absorb: 0x63ff9e,
  /** A soul model is 2.3 yards tall as authored; this is its size in the room. */
  soulScale: 1.0,
  soulFloat: 0.55,
  /** How near the boss a vanished soul must have been to count as absorbed. */
  absorbedWithin: SOUL_HARVEST.absorbRadius + 1.6,
  releaseBurstSec: 0.7,
  absorbBurstSec: 1.1,
});

export interface ScythePose {
  /** World pivot. */
  x: number;
  z: number;
  /** Shaft angle (Entity.facing convention). */
  angle: number;
  /** 0..1 how assembled it is: scale and opacity of the weapon. */
  formed: number;
  /** Extra height: negative while it rises out of the floor. */
  lift: number;
  /** Lean, as a tilt about the axis across its travel. */
  leanX: number;
  leanZ: number;
  /** 0..1 strength of the necrotic glow (cracks, hub, pivot sigil). */
  glow: number;
  /** 0..1 how far it has broken apart. */
  broken: number;
  /** Pivot speed, yards per second. */
  speed: number;
  /** Unit travel direction (zero while still). */
  dirX: number;
  dirZ: number;
  active: boolean;
}

const SCRATCH_A = { x: 0, z: 0 };
const SCRATCH_B = { x: 0, z: 0 };
const SCRATCH_SPAWN = { x: 0, z: 0 };
const SCRATCH_BOSS = { x: 0, z: 0 };

const smooth = (t: number): number => {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
};

/** Fill `out` with the scythe's look at `elapsed`. Allocation free. */
export function scythePose(
  out: ScythePose,
  anchorX: number,
  anchorZ: number,
  facing: number,
  pattern: number,
  frame: BoneScytheFrame,
  elapsed: number,
): ScythePose {
  const pivot = scythePivot(anchorX, anchorZ, pattern, frame, elapsed, SCRATCH_A);
  const ahead = scythePivot(anchorX, anchorZ, pattern, frame, elapsed + 0.1, SCRATCH_B);
  const vx = (ahead.x - pivot.x) / 0.1;
  const vz = (ahead.z - pivot.z) / 0.1;
  const speed = Math.hypot(vx, vz);
  const phase = scythePhase(elapsed);
  const summon = smooth(elapsed / BONE_SCYTHE.castSec);
  const endStart = BONE_SCYTHE.castSec + BONE_SCYTHE.activeSec;
  const broken =
    phase === 'ending' || phase === 'done' ? smooth((elapsed - endStart) / BONE_SCYTHE.endSec) : 0;
  out.x = pivot.x;
  out.z = pivot.z;
  out.angle = scytheAngle(facing, elapsed);
  // A small overshoot as it locks together, then it holds its size.
  out.formed =
    phase === 'summon' ? summon * (1 + 0.12 * Math.sin(summon * Math.PI)) : 1 - broken * 0.35;
  out.lift = phase === 'summon' ? -BONE_REAPER_LOOK.summonDepth * (1 - summon) : broken * 0.5;
  const lean = Math.min(BONE_REAPER_LOOK.maxLean, speed * BONE_REAPER_LOOK.leanPerSpeed);
  out.dirX = speed > 1e-4 ? vx / speed : 0;
  out.dirZ = speed > 1e-4 ? vz / speed : 0;
  // Leaning INTO travel: tilt about the horizontal axis across the direction.
  out.leanX = out.dirZ * lean;
  out.leanZ = -out.dirX * lean;
  out.glow = phase === 'summon' ? 0.35 + 0.65 * summon : 1 - broken;
  out.broken = broken;
  out.speed = speed;
  out.active = phase === 'active';
  return out;
}

/** The blade tip's world position `back` seconds ago: the true path of BOTH
 *  transforms together, which is what makes the trail bend when the pivot turns. */
export function scytheTipAt(
  out: { x: number; z: number },
  anchorX: number,
  anchorZ: number,
  facing: number,
  pattern: number,
  frame: BoneScytheFrame,
  elapsed: number,
  radius: number,
): { x: number; z: number } {
  const t = Math.max(0, Math.min(BONE_SCYTHE_TOTAL_SEC, elapsed));
  const pivot = scythePivot(anchorX, anchorZ, pattern, frame, t, SCRATCH_A);
  // The blade leads the shaft: its mid-line is half an arc ahead.
  const angle = scytheAngle(facing, t) + BONE_SCYTHE.rotationDirection * BONE_SCYTHE.bladeArc * 0.5;
  out.x = pivot.x + Math.sin(angle) * radius;
  out.z = pivot.z + Math.cos(angle) * radius;
  return out;
}

export interface SoulPose {
  x: number;
  z: number;
  /** Height over the ground, with its float. */
  y: number;
  /** Heading toward the boss (Entity.facing convention). */
  yaw: number;
  scale: number;
  /** 0..1 overall brightness. */
  glow: number;
  /** >1 stretches it along its heading: drawn thin as the boss takes it. */
  stretch: number;
  /** 0..1 how far along its walk it is: drives the trail length. */
  travelled: number;
  drawn: boolean;
}

export function soulPose(
  out: SoulPose,
  spawnX: number,
  spawnZ: number,
  bossX: number,
  bossZ: number,
  elapsed: number,
  total: number,
  seed: number,
): SoulPose {
  SCRATCH_SPAWN.x = spawnX;
  SCRATCH_SPAWN.z = spawnZ;
  SCRATCH_BOSS.x = bossX;
  SCRATCH_BOSS.z = bossZ;
  // `total` is the soul's life: its pace was set when it was cast.
  const at = soulPosition(SCRATCH_SPAWN, SCRATCH_BOSS, elapsed, SCRATCH_A, total);
  const phase = soulPhase(elapsed);
  const forming = smooth(elapsed / SOUL_HARVEST.castSec);
  const left = Math.max(0, total - elapsed);
  // The last moments: it is pulled thin and quick into his ribs.
  const taken = 1 - smooth(left / 0.55);
  const walk = Math.max(0.001, total - SOUL_HARVEST.castSec - SOUL_HARVEST.holdSec);
  out.x = at.x;
  out.z = at.z;
  out.y = BONE_REAPER_LOOK.soulFloat + 0.16 * Math.sin(elapsed * 2.1 + seed * 1.7) + 0.5 * taken;
  out.yaw = Math.atan2(bossX - at.x, bossZ - at.z);
  out.scale = BONE_REAPER_LOOK.soulScale * (phase === 'forming' ? forming : 1) * (1 - 0.45 * taken);
  out.glow =
    phase === 'forming'
      ? 0.25 + 0.4 * forming
      : phase === 'holding'
        ? 0.65 + 0.35 * smooth((elapsed - SOUL_HARVEST.castSec) / SOUL_HARVEST.holdSec)
        : 1;
  out.stretch = 1 + 1.4 * taken;
  out.travelled = Math.max(
    0,
    Math.min(1, (elapsed - SOUL_HARVEST.castSec - SOUL_HARVEST.holdSec) / walk),
  );
  out.drawn = phase === 'drawn';
  return out;
}

export type SoulEnding = 'released' | 'absorbed';

/** A soul's cue has gone. Which ending does it get? One that vanished on the
 *  boss's doorstep was absorbed; anywhere else, a player released it. */
export function soulEnding(lastX: number, lastZ: number, bossX: number, bossZ: number): SoulEnding {
  return Math.hypot(lastX - bossX, lastZ - bossZ) <= BONE_REAPER_LOOK.absorbedWithin
    ? 'absorbed'
    : 'released';
}

/** How empowered the boss reads, 0..1, from his Harvested Soul stacks: a glow in
 *  the ribs first, then brighter, then energy in the bones, then an aura. */
export interface HarvestedLook {
  ribs: number;
  veins: number;
  aura: number;
  orbiters: number;
}

export function harvestedLook(
  stacks: number,
  out: HarvestedLook = { ribs: 0, veins: 0, aura: 0, orbiters: 0 },
): HarvestedLook {
  const s = Math.max(0, Math.min(SOUL_HARVEST.maxStacks, stacks));
  out.ribs = s <= 0 ? 0 : Math.min(1, 0.35 + s * 0.2);
  out.veins = s < 3 ? 0 : Math.min(1, (s - 2) * 0.3);
  out.aura = s < 4 ? 0 : Math.min(1, (s - 3) * 0.25);
  out.orbiters = s < 4 ? 0 : Math.min(4, s - 3);
  return out;
}
