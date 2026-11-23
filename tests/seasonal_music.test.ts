// Gourdlight Eve's town theme (src/game/seasonal_music.ts): while the event runs, the
// three event cities play "Lanterns on the Hollow Road" instead of their own theme,
// through the same zone-change path (so the soundtrack crossfades it like any other),
// and the moment the event closes each city plays its own again.
import { describe, expect, it, vi } from 'vitest';
import { authoredMapMusicInput } from '../src/game/authored_map_music';
import {
  InstanceMusicController,
  type InstanceMusicInput,
  instanceMusicDecision,
} from '../src/game/instance_music';
import { buildMusicThemes, THEME_TRIM } from '../src/game/music';
import { ZONE_STREAM_URLS } from '../src/game/music_tracks';
import { ALL_MUSIC_ZONES, type MusicZone } from '../src/game/music_zones';
import { seasonalMusicZone } from '../src/game/seasonal_music';
import { GOURDLIGHT_EVE_ID } from '../src/sim/content/gourdlight_eve';
import { ZONES } from '../src/sim/data';

const TOWNS: [string, MusicZone][] = [
  ['eastbrook_vale', 'town_eastbrook'],
  ['mirefen_marsh', 'town_fenbridge'],
  ['thornpeak_heights', 'town_highwatch'],
];

function zone(id: string) {
  const z = ZONES.find((zn) => zn.id === id);
  if (!z) throw new Error(`missing zone ${id}`);
  return z;
}

function input(
  zoneId: string,
  seasonalEvent: string | null,
  at?: { x: number; z: number },
): InstanceMusicInput {
  const z = zone(zoneId);
  return {
    now: 20000,
    lastCombatEventAt: 0,
    lastBossCombatEventAt: 0,
    inCombat: false,
    playerId: 7,
    playerPos: at ?? { x: z.hub.x, z: z.hub.z },
    zone: z,
    inDungeon: false,
    entities: [],
    riftFloor: null,
    seasonalEvent,
  };
}

describe('the Gourdlight Eve town theme', () => {
  it('takes over the three event cities only while the event runs', () => {
    for (const [, town] of TOWNS) {
      expect(seasonalMusicZone(town, GOURDLIGHT_EVE_ID)).toBe('town_gourdlight');
      expect(seasonalMusicZone(town, null)).toBe(town);
      // another event, or none, never touches the town
      expect(seasonalMusicZone(town, 'some_other_event')).toBe(town);
    }
    // the wilds, the dungeons and the other capitals keep their own cue
    for (const other of ['vale', 'marsh', 'peaks', 'town_goldcrest', 'dungeon_hollow_crypt']) {
      expect(seasonalMusicZone(other as MusicZone, GOURDLIGHT_EVE_ID)).toBe(other);
    }
  });

  it('is what the world decides in each event city square, and outside the town it is not', () => {
    for (const [zoneId, town] of TOWNS) {
      expect(instanceMusicDecision(input(zoneId, GOURDLIGHT_EVE_ID)).zone).toBe('town_gourdlight');
      expect(instanceMusicDecision(input(zoneId, null)).zone).toBe(town);
    }
    // the open Vale, far from Eastbrook's hub, keeps the vale theme through the event
    const vale = zone('eastbrook_vale');
    const out = { x: vale.hub.x + 200, z: vale.hub.z + 150 };
    expect(instanceMusicDecision(input('eastbrook_vale', GOURDLIGHT_EVE_ID, out)).zone).not.toBe(
      'town_gourdlight',
    );
  });

  it('swaps in and back out through the zone-change path (the crossfade)', () => {
    const port = { resetForDungeonEntry: vi.fn(), update: vi.fn(), setBossCombat: vi.fn() };
    const controller = new InstanceMusicController(port);
    controller.update(input('eastbrook_vale', null));
    expect(port.update).toHaveBeenLastCalledWith('town_eastbrook', false);
    // the event opens while the player stands in the square
    controller.update(input('eastbrook_vale', GOURDLIGHT_EVE_ID));
    expect(port.update).toHaveBeenLastCalledWith('town_gourdlight', false);
    // ...and closes: the town's own theme returns
    controller.update(input('eastbrook_vale', null));
    expect(port.update).toHaveBeenLastCalledWith('town_eastbrook', false);
    // never a dungeon-entry reset: a plain zone change, crossfaded by update()
    expect(port.resetForDungeonEntry).not.toHaveBeenCalled();
  });

  it('reads the running event off the world', () => {
    expect(authoredMapMusicInput({ activeSeasonalEvent: GOURDLIGHT_EVE_ID }).seasonalEvent).toBe(
      GOURDLIGHT_EVE_ID,
    );
    expect(authoredMapMusicInput({ activeSeasonalEvent: null }).seasonalEvent).toBeNull();
  });

  it('is a registered, trimmed, streamed cue', () => {
    expect(ALL_MUSIC_ZONES).toContain('town_gourdlight');
    const theme = buildMusicThemes(false).town_gourdlight;
    expect(theme).toBeDefined();
    expect(theme.bars).toBe(32);
    // every note sits inside the loop
    for (const e of theme.events) expect(e.beat + 0.01).toBeLessThan(theme.bars * 4);
    expect(THEME_TRIM.town_gourdlight).toBeGreaterThan(0);
    expect(ZONE_STREAM_URLS.town_gourdlight).toMatch(
      /^\/audio\/music\/town_gourdlight\.mp3\?v=[a-f0-9]{12}$/,
    );
  });
});
