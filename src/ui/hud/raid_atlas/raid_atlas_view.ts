// The raid atlas's live frame: where the player stands and faces, where the
// raid is, which bosses still stand, which floor and area are current. Read
// from IWorld only (the offline Sim and the online ClientWorld mirror the
// same entities, roster and seal markers), so both hosts draw the same atlas.
//
// Boss state has two sources, best first:
//   1. the boss's own body in the client's interest (alive, fighting, dead);
//   2. the heart seal's markers (content/smith_heart.ts SMITH_HEART_SEAL_*):
//      inert objects spread so every walkable point stands within interest
//      of one, whose template id carries which veins are lit (a vein lights
//      the moment its guardian's encounter is won) and whether the Heart's
//      exit stands open (the Masterless Strength has fallen). That is how a
//      far-off guardian still reads as defeated.
// Neither source: 'unknown' (drawn as standing, never as dead).
//
// DOM-free, deterministic, allocation-light enough for an open window.

import {
  SMITH_HEART_EXIT_BIT,
  smithHeartSealMaskOf,
  smithHeartVeinLit,
} from '../../../sim/encounters/smith_heart/seal';
import type { IWorld } from '../../../world_api';
import {
  type RaidAtlasArea,
  type RaidAtlasBoss,
  type RaidAtlasFloorId,
  type RaidAtlasPlan,
  raidAtlasAreaAt,
  raidAtlasFloorAt,
} from './raid_atlas_plan_core';

export type RaidAtlasBossState = 'alive' | 'engaged' | 'dead' | 'unknown';

export interface RaidAtlasBossMark {
  boss: RaidAtlasBoss;
  state: RaidAtlasBossState;
}

export interface RaidAtlasMember {
  x: number;
  z: number;
  cls: string;
  dead: boolean;
  name: string;
}

export interface RaidAtlasFrame {
  /** The page the local player stands on, or null when they view the raid
   *  from outside it (a party member's plan). */
  playerFloor: RaidAtlasFloorId | null;
  playerArea: RaidAtlasArea | null;
  /** Instance-local position and facing (radians, the sim's: 0 = +z). */
  player: { x: number; z: number; facing: number } | null;
  members: RaidAtlasMember[];
  bosses: RaidAtlasBossMark[];
  /** Bosses defeated / total (the cartouche's progress line). */
  defeated: number;
}

/** The instance a frame is read in: its origin in world coordinates. */
export interface RaidAtlasOrigin {
  originX: number;
  originZ: number;
  /** Is a world point inside THIS instance copy? */
  contains(x: number, z: number): boolean;
}

function bossStateOf(
  world: Pick<IWorld, 'entities'>,
  origin: RaidAtlasOrigin,
  boss: RaidAtlasBoss,
  sealMask: number | null,
): RaidAtlasBossState {
  let seen = 0;
  let deadBodies = 0;
  let fighting = false;
  for (const e of world.entities.values()) {
    if (e.kind !== 'mob' || !boss.bodyIds.includes(e.templateId)) continue;
    if (!origin.contains(e.pos.x, e.pos.z)) continue;
    seen++;
    if (e.dead) deadBodies++;
    else if (e.inCombat) fighting = true;
  }
  if (sealMask !== null) {
    const won =
      boss.id === 'final'
        ? (sealMask & SMITH_HEART_EXIT_BIT) !== 0
        : smithHeartVeinLit(sealMask, boss.id);
    if (won) return 'dead';
  }
  if (seen > 0 && deadBodies === boss.bodyIds.length) return 'dead';
  if (fighting) return 'engaged';
  if (seen > 0) return 'alive';
  return 'unknown';
}

/** The seal's value from any marker of this instance in interest, or null. */
function sealMaskIn(world: Pick<IWorld, 'entities'>, origin: RaidAtlasOrigin): number | null {
  for (const e of world.entities.values()) {
    if (e.kind !== 'object') continue;
    const mask = smithHeartSealMaskOf(e.templateId);
    if (mask === null || !origin.contains(e.pos.x, e.pos.z)) continue;
    return mask;
  }
  return null;
}

export function buildRaidAtlasFrame(
  world: Pick<IWorld, 'entities' | 'player' | 'partyInfo'>,
  plan: RaidAtlasPlan,
  origin: RaidAtlasOrigin,
): RaidAtlasFrame {
  const p = world.player;
  const inside = origin.contains(p.pos.x, p.pos.z);
  const lx = p.pos.x - origin.originX;
  const lz = p.pos.z - origin.originZ;
  const members: RaidAtlasMember[] = [];
  const party = world.partyInfo;
  if (party) {
    for (const m of party.members) {
      if (m.pid === p.id || !origin.contains(m.x, m.z)) continue;
      members.push({
        x: m.x - origin.originX,
        z: m.z - origin.originZ,
        cls: m.cls,
        dead: m.dead !== 0,
        name: m.name,
      });
    }
  }
  const sealMask = sealMaskIn(world, origin);
  const bosses = plan.bosses.map((boss) => ({
    boss,
    state: bossStateOf(world, origin, boss, sealMask),
  }));
  return {
    playerFloor: inside ? raidAtlasFloorAt(lx, lz) : null,
    playerArea: inside ? raidAtlasAreaAt(lx, lz) : null,
    player: inside ? { x: lx, z: lz, facing: p.facing } : null,
    members,
    bosses,
    defeated: bosses.filter((b) => b.state === 'dead').length,
  };
}

/** The page the atlas opens on: the player's own, else the first page that
 *  holds a raid member, else the first. */
export function defaultRaidAtlasFloor(
  frame: Pick<RaidAtlasFrame, 'playerFloor' | 'members'>,
): RaidAtlasFloorId {
  if (frame.playerFloor) return frame.playerFloor;
  const m = frame.members[0];
  return m ? raidAtlasFloorAt(m.x, m.z) : 'veins';
}
