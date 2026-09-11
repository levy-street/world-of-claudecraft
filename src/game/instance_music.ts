import { delveAt, dungeonAt, isBgPos, isDelvePos, MOBS, type ZoneDef } from '../sim/data';
import type { MapMusic } from '../sim/types';
import { type CrucibleFloor, crucibleFloorForDungeon } from './crucible_music';
import {
  ALL_MUSIC_ZONES,
  type MusicVenue,
  type MusicZone,
  musicZoneForLocation,
  riftMusicZoneForTheme,
  shouldResetMusicForDungeonEntry,
  type VenueTrack,
} from './music';

export interface InstanceMusicEntity {
  kind: string;
  dead: boolean;
  templateId: string;
  aggroTargetId: number | null;
}

// The Deepglass bell is its own WORLD rather than a corner of the overworld, so
// there is no position test for it: the HUD reports whether this session booted
// the arena at all, plus the bout's phase (null when no bout is on). The phase
// is what arms the venue music: a bout, not the visit.
export interface InstanceMusicDeepglass {
  inArena: boolean;
  phase: string | null;
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
  // The world's own in-combat flag (IWorld player.inCombat): the sim's engaged
  // pass offline, the server's mirrored `cbt` bit online. Authoritative, so it
  // alone puts the player in combat; the aggro-target and recent-event arms
  // below stay as the fallback that bridges a snapshot in flight.
  inCombat: boolean;
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
  // The Deepglass arena (null in every other world).
  deepglass: InstanceMusicDeepglass | null;
  // The active map's AUTHORED soundtrack (WorldContent.music: the Studio's
  // "Map track" plus any rect areas), or null/absent for the shipped world.
  // Resolved by resolveMapMusicZone below, and it outranks the location walk:
  // an authored world's coordinates otherwise resolve through the OVERWORLD's
  // zone table (the Deepglass map spans seven of its zones), which is how a
  // player standing on the causeway heard the score churn through them.
  mapMusic?: MapMusic | null;
}

export interface InstanceMusicDecision {
  zone: MusicZone;
  inCombat: boolean;
  musicCombat: boolean;
  bossEngaged: boolean;
  instanceId: string | null;
  venue: MusicVenue;
  venueTrack: VenueTrack | null;
  crucibleFloor: CrucibleFloor | null;
}

export interface InstanceMusicPort {
  // A procedural Rift floor has no DUNGEON_MUSIC row (its cue follows the
  // floor's RiftTheme), so the resolved zone rides along explicitly.
  resetForDungeonEntry(dungeonId: string | null, zone?: MusicZone): void;
  update(zone: MusicZone, inCombat: boolean, crucibleFloor?: CrucibleFloor | null): void;
  setBossCombat(active: boolean): void;
  setVenueTrack(venue: MusicVenue, track: VenueTrack | null): void;
}

const MUSIC_ZONE_SET: ReadonlySet<string> = new Set(ALL_MUSIC_ZONES);

/**
 * The track an authored map asks for at (x, z), or null when it asks for
 * nothing there. The smallest containing area wins, then the map-wide track.
 * Unknown ids are ignored (documents stay forward-compatible), so a stale or
 * misspelt track simply falls back to the location walk.
 */
export function resolveMapMusicZone(
  music: MapMusic | null | undefined,
  x: number,
  z: number,
): MusicZone | null {
  if (!music) return null;
  let best: { track: string; size: number } | null = null;
  for (const a of music.areas ?? []) {
    if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
    if (!MUSIC_ZONE_SET.has(a.track)) continue;
    const size = Math.max(0, a.maxX - a.minX) * Math.max(0, a.maxZ - a.minZ);
    if (best === null || size < best.size) best = { track: a.track, size };
  }
  if (best) return best.track as MusicZone;
  const track = music.zoneTrack;
  return track && MUSIC_ZONE_SET.has(track) ? (track as MusicZone) : null;
}

const RAID_ARENA_ID = 'nythraxis_boss_arena';
const RAID_BOSS_ID = 'nythraxis_scourge_of_thornpeak';
const FALLBACK_DELVE_ID = 'collapsed_reliquary';
const RECENT_COMBAT_MS = 5000;
const RECENT_BOSS_COMBAT_MS = 10000;

export function instanceMusicDecision(input: InstanceMusicInput): InstanceMusicDecision {
  let aggroed = false;
  let bossEngaged = false;
  // Any live boss-flagged mob that has a target, wherever it stands. Only the
  // Deepglass reads it (see the venue track below); the overworld's boss loop
  // stays on its own Nythraxis signal, so nothing here can double up on it.
  let anyBossEngaged = false;
  for (const entity of input.entities) {
    if (entity.kind !== 'mob' || entity.dead) continue;
    if (entity.aggroTargetId === input.playerId) aggroed = true;
    if (entity.templateId === RAID_BOSS_ID && entity.aggroTargetId !== null) bossEngaged = true;
    if (entity.aggroTargetId !== null && MOBS[entity.templateId]?.boss === true)
      anyBossEngaged = true;
  }

  const dungeon = dungeonAt(input.playerPos.x);
  const inRaidArena = dungeon?.id === RAID_ARENA_ID;
  // Thornhollow Fields battleground: the whole match rides the existing battle track
  // (the raid-arena musicCombat treatment; no dedicated audio asset).
  const inBattleground = isBgPos(input.playerPos.x);
  const inCombat =
    input.inCombat || aggroed || input.now - input.lastCombatEventAt < RECENT_COMBAT_MS;
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
  // A rift floor scores by its theme; an authored map by what its maker asked
  // for; the shipped world by where the player stands.
  const mapZone = riftFloor
    ? null
    : resolveMapMusicZone(input.mapMusic, input.playerPos.x, input.playerPos.z);
  const crucibleFloor = input.inDungeon && !riftFloor ? crucibleFloorForDungeon(instanceId) : null;
  const zone = riftFloor
    ? riftMusicZoneForTheme(riftFloor.themeName)
    : (mapZone ??
      musicZoneForLocation(
        input.zone.id,
        input.zone.biome,
        inHub,
        input.inDungeon || inRaidArena,
        scoredInstanceId,
      ));
  const musicInstanceId = riftFloor
    ? `rift:${riftFloor.instanceId}:${riftFloor.floorIndex}`
    : input.inDungeon || inRaidArena
      ? instanceId
      : null;

  // The match cue arms on the whistle (the 'countdown' walk-out is already the
  // bout) and holds through the celebrations and the final horn ('over'), then
  // gives way when the bout is torn down and the phase reads null. Between
  // bouts the venue's "grounds" cue holds the bell and the city around it:
  // the 2026-09-02 pass had switched that to the map's own zone track, and
  // Troy asked for the older exploration music back (2026-09-07).
  //
  // A BOSS fought in the bell outranks the match cue: a sport's music is wrong
  // under one. There is no encounter down there yet, so the rule is
  // deliberately general rather than keyed to a mob id — the day a boss is
  // placed in the arena it scores itself with no further wiring.
  const inDeepglass = input.deepglass?.inArena === true;
  const dgPhase = input.deepglass?.phase ?? null;
  const boutOn = dgPhase !== null;
  const venueTrack: VenueTrack | null = !inDeepglass
    ? null
    : anyBossEngaged
      ? 'boss'
      : boutOn
        ? 'match'
        : 'waiting';

  return {
    zone,
    inCombat,
    // The complete room score owns the mix through pulls and boss fights.
    musicCombat: crucibleFloor === null && (inCombat || inRaidArena || inBattleground),
    bossEngaged: crucibleFloor === null && bossEngaged,
    crucibleFloor,
    instanceId: musicInstanceId,
    venue: 'deepglass',
    venueTrack,
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
    if (decision.crucibleFloor !== null) {
      this.music.update(decision.zone, decision.musicCombat, decision.crucibleFloor);
    } else {
      this.music.update(decision.zone, decision.musicCombat);
    }
    this.music.setBossCombat(decision.bossEngaged);
    this.music.setVenueTrack(decision.venue, decision.venueTrack);
    return decision;
  }
}
