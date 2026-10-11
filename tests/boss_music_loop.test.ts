import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BOSS_TRACK_URLS, bossTrackFor, DEFAULT_BOSS_TRACK_URL } from '../src/game/boss_music_loop';
import {
  InstanceMusicController,
  type InstanceMusicEntity,
  type InstanceMusicInput,
  instanceMusicDecision,
} from '../src/game/instance_music';
import { DUNGEONS, instanceOrigin, MOBS, ZONES } from '../src/sim/data';

const MORTHEN_URL = '/audio/music/boss_morthen.mp3?v=664edb19bfe2';
const DUNGEON_BOSS_IDS = [
  'morthen',
  'sexton_marrow',
  'rimeweb',
  'cantor_ilvane',
  'crypt_knellwyrm',
  'knight_commander_olen',
  'gaoler_ossick',
  'vael_the_mistcaller',
  'korgath_the_bound',
  'grand_necromancer_velkhar',
  'korzul_the_gravewyrm',
  'wildheart_beastmaster',
  'the_gorgebloom',
  'wildheart_high_priest',
  'choirmother_selthe',
  'mere_hydra_head_left',
  'mere_hydra_head_center',
  'mere_hydra_head_right',
  'tideglass_colossus',
  'ysolei',
] as const;

const zoneFixture = ZONES.find((zone) => zone.id === 'eastbrook_vale');
if (!zoneFixture) throw new Error('eastbrook_vale fixture is missing');
const zone = zoneFixture;
const crypt = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);

function input(overrides: Partial<InstanceMusicInput> = {}): InstanceMusicInput {
  return {
    now: 20000,
    lastCombatEventAt: 0,
    lastBossCombatEventAt: 0,
    inCombat: false,
    playerId: 7,
    playerPos: { x: crypt.x, z: crypt.z },
    zone,
    inDungeon: true,
    entities: [],
    riftFloor: null,
    ...overrides,
  };
}

const morthen = (aggroTargetId: number | null): InstanceMusicEntity => ({
  kind: 'mob',
  dead: false,
  templateId: 'morthen',
  aggroTargetId,
});

describe('per-boss fight tracks', () => {
  it('ships one versioned cue per dungeon boss, preserving Morthen and sharing the Hydra cue', () => {
    expect(Object.keys(BOSS_TRACK_URLS).sort()).toEqual([...DUNGEON_BOSS_IDS].sort());
    expect(BOSS_TRACK_URLS.morthen).toBe(MORTHEN_URL);
    expect(BOSS_TRACK_URLS.rimeweb).toContain('boss_rimeweb.mp3?v=964cbe52e766');
    expect(BOSS_TRACK_URLS.the_gorgebloom).toContain('boss_the_gorgebloom.mp3?v=a657f10af536');
    expect(BOSS_TRACK_URLS.wildheart_high_priest).toContain(
      'boss_wildheart_high_priest.mp3?v=ab150b2c36f3',
    );
    expect(BOSS_TRACK_URLS.mere_hydra_head_left).toBe(BOSS_TRACK_URLS.mere_hydra_head_center);
    expect(BOSS_TRACK_URLS.mere_hydra_head_right).toBe(BOSS_TRACK_URLS.mere_hydra_head_center);
    expect(new Set(Object.values(BOSS_TRACK_URLS)).size).toBe(18);
    for (const id of DUNGEON_BOSS_IDS) {
      expect(MOBS[id], id).toBeDefined();
      const [asset, hash] = BOSS_TRACK_URLS[id].split('?v=');
      const bytes = readFileSync(path.join(__dirname, '..', 'public', asset));
      expect(createHash('sha256').update(bytes).digest('hex').slice(0, 12), id).toBe(hash);
    }
  });

  it('resolves a track only for a boss that has one', () => {
    expect(bossTrackFor('morthen')).toBe(MORTHEN_URL);
    expect(bossTrackFor('sexton_marrow')).toBe(BOSS_TRACK_URLS.sexton_marrow);
    expect(bossTrackFor('wildheart_stalker')).toBeNull();
    expect(bossTrackFor('toString')).toBeNull();
  });

  it('engages each dedicated boss loop only while a living boss holds a target', () => {
    const idle = instanceMusicDecision(input({ entities: [morthen(null)] }));
    expect(idle.bossEngaged).toBe(false);
    expect(idle.bossTrackUrl).toBeNull();

    const fighting = instanceMusicDecision(input({ entities: [morthen(7)] }));
    expect(fighting.bossEngaged).toBe(true);
    expect(fighting.bossTrackUrl).toBe(MORTHEN_URL);

    const dead = instanceMusicDecision(input({ entities: [{ ...morthen(7), dead: true }] }));
    expect(dead.bossEngaged).toBe(false);
    expect(dead.bossTrackUrl).toBeNull();

    for (const id of DUNGEON_BOSS_IDS) {
      const fightingBoss = { ...morthen(9), templateId: id };
      expect(instanceMusicDecision(input({ entities: [fightingBoss] })).bossTrackUrl, id).toBe(
        BOSS_TRACK_URLS[id],
      );
    }
  });

  it('keeps his track through a short aggro gap, then hands the mix back', () => {
    const port = { resetForDungeonEntry: vi.fn(), update: vi.fn(), setBossCombat: vi.fn() };
    const controller = new InstanceMusicController(port);

    controller.update(input({ now: 20000, entities: [morthen(7)] }));
    expect(port.setBossCombat).toHaveBeenLastCalledWith(true, MORTHEN_URL);

    // An immune hover drops his target for a few seconds: the track holds.
    controller.update(input({ now: 25000, entities: [morthen(null)] }));
    expect(port.setBossCombat).toHaveBeenLastCalledWith(true, MORTHEN_URL);

    // Ten seconds without a target (a wipe, a reset): back to the zone score.
    controller.update(input({ now: 30000, entities: [morthen(null)] }));
    expect(port.setBossCombat).toHaveBeenLastCalledWith(false);
  });

  it('switches cues when the next boss engages without replaying the previous cue', () => {
    const port = { resetForDungeonEntry: vi.fn(), update: vi.fn(), setBossCombat: vi.fn() };
    const controller = new InstanceMusicController(port);
    controller.update(input({ entities: [{ ...morthen(7), templateId: 'sexton_marrow' }] }));
    expect(port.setBossCombat).toHaveBeenLastCalledWith(true, BOSS_TRACK_URLS.sexton_marrow);
    controller.update(input({ now: 21000, entities: [{ ...morthen(7), templateId: 'rimeweb' }] }));
    expect(port.setBossCombat).toHaveBeenLastCalledWith(true, BOSS_TRACK_URLS.rimeweb);
    controller.update(input({ now: 31000 }));
    expect(port.setBossCombat).toHaveBeenLastCalledWith(false);
  });

  it('gives the boss cue ownership before updating the normal combat score', () => {
    const port = { resetForDungeonEntry: vi.fn(), update: vi.fn(), setBossCombat: vi.fn() };
    const controller = new InstanceMusicController(port);
    controller.update(input({ entities: [{ ...morthen(7), templateId: 'sexton_marrow' }] }));
    expect(port.setBossCombat).toHaveBeenCalledWith(true, BOSS_TRACK_URLS.sexton_marrow);
    expect(port.setBossCombat.mock.invocationCallOrder[0]).toBeLessThan(
      port.update.mock.invocationCallOrder[0],
    );
  });

  it('keeps the shared default loop for fights without a dedicated cue', () => {
    const port = { resetForDungeonEntry: vi.fn(), update: vi.fn(), setBossCombat: vi.fn() };
    const controller = new InstanceMusicController(port);
    controller.update(input({ lastBossCombatEventAt: 19000 }));
    expect(port.setBossCombat).toHaveBeenLastCalledWith(true);
    expect(DEFAULT_BOSS_TRACK_URL).toBe('/audio/dungeon-boss-fight.mp3');
  });
});
