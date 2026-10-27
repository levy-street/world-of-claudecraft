// The Smith's Heart's areas (content/smith_heart_layout.ts smithHeartAreaAt):
// every room and the Heart resolve to their own area, and the area drives the
// score (src/game/smith_heart_music.ts), the fog and light state
// (src/render/smith_heart/heart_environment.ts) and the sky's blend. The
// Heart's area holds every floor of the Heart and no floor of the main map.

import { describe, expect, it } from 'vitest';
import { instanceMusicDecision } from '../src/game/instance_music';
import { SMITH_HEART_AREA_MUSIC, smithHeartMusicZoneAt } from '../src/game/smith_heart_music';
import {
  SMITH_HEART_CORE_FOG,
  SMITH_HEART_CORE_LIGHT,
  smithHeartCameraInHeart,
} from '../src/render/smith_heart/heart_environment';
import {
  BREATH,
  HAMMER_PIT,
  HEART_ARRIVAL,
  HEART_ROOM,
  inSmithHeartRoom,
  QUENCH,
  SMITH_HEART_BOSS_SPOTS,
  SMITH_HEART_FIELD,
  smithHeartAreaAt,
} from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const F = SMITH_HEART_FIELD;
const HEART_SURFACES = new Set(['heart_anvil', 'heart_terrace', 'heart_bridge']);

describe("the Smith's Heart's areas", () => {
  it('names each guardian room, the Ring and the Heart', () => {
    expect(smithHeartAreaAt(HAMMER_PIT.x, HAMMER_PIT.z)).toBe('hammer');
    expect(smithHeartAreaAt(-198, -212)).toBe('hammer');
    expect(smithHeartAreaAt(0, 0)).toBe('ring');
    expect(smithHeartAreaAt(0, 70)).toBe('ring');
    expect(smithHeartAreaAt(BREATH.cornice.x, BREATH.cornice.z)).toBe('breath');
    expect(smithHeartAreaAt(BREATH.b3.x, BREATH.b3.z)).toBe('breath');
    expect(smithHeartAreaAt(QUENCH.lake.x, QUENCH.lake.z)).toBe('quench');
    expect(smithHeartAreaAt(QUENCH.q2.x, QUENCH.q2.z)).toBe('quench');
    expect(smithHeartAreaAt(SMITH_HEART_BOSS_SPOTS.heat.x, 0)).toBe('heat');
    expect(smithHeartAreaAt(HEART_ARRIVAL.x, HEART_ARRIVAL.z)).toBe('heart');
    expect(smithHeartAreaAt(HEART_ROOM.x, HEART_ROOM.z)).toBe('heart');
  });

  it("holds every floor of the Heart in the Heart's area and none of the main map", () => {
    const wrong: string[] = [];
    for (let z = F.bounds.minZ; z <= F.bounds.maxZ; z += 3)
      for (let x = F.bounds.minX; x <= F.bounds.maxX; x += 3) {
        const s = authoredFieldSurfaceAt(F, x, z);
        if (!s) continue;
        if (HEART_SURFACES.has(s.id) !== inSmithHeartRoom(x, z)) wrong.push(`${s.id} (${x}, ${z})`);
      }
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it('scores each area with its own cue, the Heart apart from the veins', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 3);
    expect(smithHeartMusicZoneAt(o.x + HEART_ROOM.x, o.z + HEART_ROOM.z)).toBe(
      SMITH_HEART_AREA_MUSIC.heart,
    );
    expect(smithHeartMusicZoneAt(o.x + QUENCH.lake.x, o.z + QUENCH.lake.z)).toBe(
      SMITH_HEART_AREA_MUSIC.quench,
    );
    expect(smithHeartMusicZoneAt(o.x, o.z)).toBe(SMITH_HEART_AREA_MUSIC.ring);
    const veins = new Set([
      SMITH_HEART_AREA_MUSIC.breath,
      SMITH_HEART_AREA_MUSIC.quench,
      SMITH_HEART_AREA_MUSIC.heat,
      SMITH_HEART_AREA_MUSIC.heart,
    ]);
    expect(veins.size).toBe(4);
    // The live decision follows the player into the Heart.
    const decide = (x: number, z: number) =>
      instanceMusicDecision({
        entities: [],
        playerId: 1,
        playerPos: { x: o.x + x, z: o.z + z },
        inDungeon: true,
        inCombat: false,
        now: 0,
        lastCombatEventAt: -1e9,
        lastBossCombatEventAt: -1e9,
        zone: { id: 'thornpeak_heights', biome: 'peaks', hub: { x: 0, z: 0, radius: 0 } },
        mapMusic: null,
        riftFloor: null,
      } as unknown as Parameters<typeof instanceMusicDecision>[0]).zone;
    expect(decide(HEART_ROOM.x, HEART_ROOM.z)).toBe(SMITH_HEART_AREA_MUSIC.heart);
    expect(decide(0, 70)).toBe(SMITH_HEART_AREA_MUSIC.ring);
  });

  it('grades the Heart with its own air and a light from below', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 1);
    expect(smithHeartCameraInHeart(o.x + HEART_ROOM.x, o.z + HEART_ROOM.z)).toBe(true);
    expect(smithHeartCameraInHeart(o.x, o.z + 70)).toBe(false);
    expect(SMITH_HEART_CORE_FOG.far).toBeGreaterThan(HEART_ROOM.r * 4);
    // The hemisphere's ground is warmer than its sky: the heart lights from below.
    const warm = (c: number) => ((c >> 16) & 0xff) - (c & 0xff);
    expect(warm(SMITH_HEART_CORE_LIGHT.hemiGround)).toBeGreaterThan(
      warm(SMITH_HEART_CORE_LIGHT.hemiSky),
    );
  });
});
