import { delveAt, dungeonAt, isBgPos, isDelvePos, type ZoneDef } from '../sim/data';
import {
  type MusicZone,
  musicZoneForLocation,
  riftMusicZoneForTheme,
  shouldResetMusicForDungeonEntry,
} from './music';

export interface InstanceMusicEntity {
  kind: string;
  dead: boolean;
  templateId: string;
  aggroTargetId: number | null;
}

// The slice of RiftFloorView the soundtrack needs: the floor's environment
// archetype plus enough identity to key per-floor phrasing resets.
export interface InstanceMusicRiftFloor {
  instanceId: number;
  floorIndex: number;
  themeName: string;
}

export interface InstanceMusicInput {
  now: number;
  lastCombatEventAt: number;
  lastBossCombatEventAt: number;
  playerId: number;
  playerPos: { x: number; z: number };
  zone: Pick<ZoneDef, 'id' | 'biome' | 'hub'>;
  inDungeon: boolean;
  entities: Iterable<InstanceMusicEntity>;
  // The active procedural Rift floor (null outside a rift). A rift floor scores
  // by its RiftTheme, not the dungeon fallback, and each floor counts as its own
  // instance entry so the crawl cue re-phrases from the top even when two floors
  // roll the same theme.
  riftFloor: InstanceMusicRiftFloor | null;
}

export interface InstanceMusicDecision {
  zone: MusicZone;
  inCombat: boolean;
  musicCombat: boolean;
  bossEngaged: boolean;
  instanceId: string | null;
}

export interface InstanceMusicPort {
  // A procedural Rift floor has no DUNGEON_MUSIC row (its cue follows the
  // floor's RiftTheme), so the resolved zone rides along explicitly.
  resetForDungeonEntry(dungeonId: string | null, zone?: MusicZone): void;
  update(zone: MusicZone, inCombat: boolean): void;
  setBossCombat(active: boolean): void;
}

const RAID_ARENA_ID = 'nythraxis_boss_arena';
const RAID_BOSS_ID = 'nythraxis_scourge_of_thornpeak';
const FALLBACK_DELVE_ID = 'collapsed_reliquary';
const RECENT_COMBAT_MS = 5000;
const RECENT_BOSS_COMBAT_MS = 10000;

export function instanceMusicDecision(input: InstanceMusicInput): InstanceMusicDecision {
  let aggroed = false;
  let bossEngaged = false;
  for (const entity of input.entities) {
    if (entity.kind !== 'mob' || entity.dead) continue;
    if (entity.aggroTargetId === input.playerId) aggroed = true;
    if (entity.templateId === RAID_BOSS_ID && entity.aggroTargetId !== null) bossEngaged = true;
  }

  const dungeon = dungeonAt(input.playerPos.x);
  const inRaidArena = dungeon?.id === RAID_ARENA_ID;
  // Thornhollow Fields battleground: the whole match rides the existing battle track
  // (the raid-arena musicCombat treatment; no dedicated audio asset).
  const inBattleground = isBgPos(input.playerPos.x);
  const inCombat = aggroed || input.now - input.lastCombatEventAt < RECENT_COMBAT_MS;
  bossEngaged =
    bossEngaged || inRaidArena || input.now - input.lastBossCombatEventAt < RECENT_BOSS_COMBAT_MS;

  const { hub } = input.zone;
  const inHub =
    !input.inDungeon &&
    Math.hypot(input.playerPos.x - hub.x, input.playerPos.z - hub.z) < hub.radius + 10;
  const instanceId = isDelvePos(input.playerPos.x)
    ? (delveAt(input.playerPos.x)?.id ?? FALLBACK_DELVE_ID)
    : (dungeon?.id ?? null);
  // The Forge-Lift shares the approach's score (one shaft, one theme).
  // Aliased here in the decision layer, zone selection only (the reset key
  // keeps the real id), because music.ts sits at its monolith ceiling.
  const scoredInstanceId =
    instanceId === 'ignivar_forge_lift' ? 'ignivar_forge_approach' : instanceId;
  const riftFloor = input.riftFloor;
  const zone = riftFloor
    ? riftMusicZoneForTheme(riftFloor.themeName)
    : musicZoneForLocation(
        input.zone.id,
        input.zone.biome,
        inHub,
        input.inDungeon || inRaidArena,
        scoredInstanceId,
      );
  const musicInstanceId = riftFloor
    ? `rift:${riftFloor.instanceId}:${riftFloor.floorIndex}`
    : input.inDungeon || inRaidArena
      ? instanceId
      : null;

  return {
    zone,
    inCombat,
    musicCombat: inCombat || inRaidArena || inBattleground,
    bossEngaged,
    instanceId: musicInstanceId,
  };
}

export class InstanceMusicController {
  private lastInstanceId: string | null = null;

  constructor(private readonly music: InstanceMusicPort) {}

  update(input: InstanceMusicInput): InstanceMusicDecision {
    const decision = instanceMusicDecision(input);
    if (shouldResetMusicForDungeonEntry(this.lastInstanceId, decision.instanceId)) {
      this.music.resetForDungeonEntry(decision.instanceId, decision.zone);
    }
    this.lastInstanceId = decision.instanceId;
    this.music.update(decision.zone, decision.musicCombat);
    this.music.setBossCombat(decision.bossEngaged);
    return decision;
  }
}
