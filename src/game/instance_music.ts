import { delveAt, dungeonAt, isDelvePos, type ZoneDef } from '../sim/data';
import { isAtSowfield } from '../sim/vale_cup_layout';
import { type MusicZone, musicZoneForLocation, shouldResetMusicForDungeonEntry } from './music';

export interface InstanceMusicEntity {
  kind: string;
  dead: boolean;
  templateId: string;
  aggroTargetId: number | null;
}

export interface InstanceMusicMatch {
  phase: string;
  origin: { x: number; z: number };
}

export interface InstanceMusicCupInfo {
  match: InstanceMusicMatch | null;
  spectate: InstanceMusicMatch | null;
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
  cupInfo: InstanceMusicCupInfo | null;
}

export interface InstanceMusicDecision {
  zone: MusicZone;
  inCombat: boolean;
  musicCombat: boolean;
  bossEngaged: boolean;
  instanceId: string | null;
  atSowfield: boolean;
  sowfieldTrack: 'match' | 'waiting' | null;
}

export interface InstanceMusicPort {
  resetForDungeonEntry(dungeonId: string | null): void;
  update(zone: MusicZone, inCombat: boolean): void;
  setBossCombat(active: boolean): void;
  setSowfieldTrack(track: 'match' | 'waiting' | null): void;
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
  const atSowfield = !input.inDungeon && isAtSowfield(input.playerPos.x, input.playerPos.z);
  const zone = atSowfield
    ? 'vale_cup'
    : musicZoneForLocation(
        input.zone.id,
        input.zone.biome,
        inHub,
        input.inDungeon || inRaidArena,
        instanceId,
      );
  const musicInstanceId = input.inDungeon || inRaidArena ? instanceId : null;

  const cupMatchView = input.cupInfo?.match ?? input.cupInfo?.spectate ?? null;
  const cupKickedOff =
    cupMatchView?.phase === 'active' ||
    cupMatchView?.phase === 'goal' ||
    cupMatchView?.phase === 'golden';
  const ownMatch = input.cupInfo?.match;
  const inPracticeMatch = !!ownMatch && (ownMatch.origin.x !== 0 || ownMatch.origin.z !== 0);

  return {
    zone,
    inCombat,
    musicCombat: inCombat || inRaidArena,
    bossEngaged,
    instanceId: musicInstanceId,
    atSowfield,
    sowfieldTrack: atSowfield || inPracticeMatch ? (cupKickedOff ? 'match' : 'waiting') : null,
  };
}

export class InstanceMusicController {
  private lastInstanceId: string | null = null;

  constructor(private readonly music: InstanceMusicPort) {}

  update(input: InstanceMusicInput): InstanceMusicDecision {
    const decision = instanceMusicDecision(input);
    if (shouldResetMusicForDungeonEntry(this.lastInstanceId, decision.instanceId)) {
      this.music.resetForDungeonEntry(decision.instanceId);
    }
    this.lastInstanceId = decision.instanceId;
    this.music.update(decision.zone, decision.musicCombat);
    this.music.setBossCombat(decision.bossEngaged);
    this.music.setSowfieldTrack(decision.sowfieldTrack);
    return decision;
  }
}
