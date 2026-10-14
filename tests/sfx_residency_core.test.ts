import { describe, expect, it } from 'vitest';
import { SFX_CLIPS, type SfxEntry } from '../src/game/sfx_manifest.generated';
import {
  audioBufferBytes,
  isSfxClipEvictable,
  SFX_EVICTABLE_CATEGORIES,
  SFX_IOS_COSMETIC_BUDGET_BYTES,
  SfxResidencyLedger,
  sfxResidencyFor,
} from '../src/game/sfx_residency_core';

const MIB = 1024 * 1024;
const BUDGET_MIB = 20;
const CLIPS: Record<string, SfxEntry> = SFX_CLIPS;

// Every clip key the iOS profile may drop, frozen on purpose. A new clip filed
// under ambience or movement, or named mount_*, fails here until someone
// decides it carries nothing a player reacts to and adds it by hand.
const EVICTABLE_KEYS = [
  'amb_birds',
  'amb_campfire',
  'amb_dungeon',
  'amb_forge',
  'amb_rain',
  'amb_snow',
  'amb_water',
  'amb_wind_marsh',
  'amb_wind_peaks',
  'amb_wind_vale',
  'foot_dirt',
  'foot_grass',
  'foot_snow',
  'foot_stone',
  'foot_water',
  'foot_wood',
  'mount_flap_avian_strider',
  'mount_idle_mech_bird',
  'mount_jump_avian_strider',
  'mount_jump_mech_bird',
  'mount_jump_rallycart_rxt',
  'mount_land_avian_strider',
  'mount_land_mech_bird',
  'mount_land_rallycart_rxt',
  'mount_loop_rickshaw_mount',
  'mount_run_aether_hover_cycle',
  'mount_run_avian_strider',
  'mount_run_drakemaw_raptor',
  'mount_run_goblin_rocket_sled',
  'mount_run_goblin_rocket_sled_reverse',
  'mount_run_goblin_rocket_sled_reverse_start',
  'mount_run_goblin_rocket_sled_reverse_stop',
  'mount_run_goblin_rocket_sled_start',
  'mount_run_goblin_rocket_sled_stop',
  'mount_run_grag_bear',
  'mount_run_mech_bird',
  'mount_run_rallycart_rxt',
  'mount_run_rallycart_rxt_idle',
  'mount_run_rallycart_rxt_reverse',
  'mount_run_rallycart_rxt_reverse_start',
  'mount_run_rallycart_rxt_reverse_stop',
  'mount_run_rallycart_rxt_start',
  'mount_run_rallycart_rxt_stop',
  'mount_run_shadowjump_toad',
  'mount_run_stalkglider_snail',
  'mount_run_stormfeather_griffin',
  'mount_run_terrorspark_groundshaker',
  'mount_run_terrorspark_groundshaker_start',
  'mount_run_terrorspark_groundshaker_stop',
  'mount_run_thunderstrut_gobbler',
  'mount_run_valorsteed',
  'mount_squawk_avian_strider',
  'mount_summon_avian_strider',
  'mount_summon_goblin_rocket_sled',
  'mount_summon_rallycart_rxt',
  'mount_summon_rickshaw_mount',
  'move_jump',
  'move_land',
  'move_splash',
  'move_swim',
];

describe('sfx residency profile', () => {
  it('budgets decoded cosmetic clips only on the iOS memory profile', () => {
    expect(SFX_IOS_COSMETIC_BUDGET_BYTES).toBe(BUDGET_MIB * MIB);
    const ledger = sfxResidencyFor({ iosMemoryProfile: true });
    expect(ledger?.budgetBytes).toBe(BUDGET_MIB * MIB);
  });

  it('keeps every other host unbounded: no ledger, so nothing is ever tracked or dropped', () => {
    expect(sfxResidencyFor({ iosMemoryProfile: false })).toBeNull();
  });
});

describe('sfx residency classification (from the clip table)', () => {
  const evictable = Object.entries(CLIPS)
    .filter(([key, entry]) => isSfxClipEvictable(key, entry))
    .map(([key]) => key);

  it('evicts exactly the frozen list of cosmetic clip keys', () => {
    expect([...evictable].sort()).toEqual(EVICTABLE_KEYS);
  });

  it('evicts exactly the ambience and movement categories plus the mount takes', () => {
    const expected = Object.entries(CLIPS)
      .filter(
        ([key, entry]) =>
          entry.category === 'ambience' ||
          entry.category === 'movement' ||
          (entry.category === 'other' && key.startsWith('mount_')),
      )
      .map(([key]) => key);
    expect(evictable.sort()).toEqual(expected.sort());
    expect([...SFX_EVICTABLE_CATEGORIES].sort()).toEqual(['ambience', 'movement']);
  });

  it('is not vacuous: each cosmetic class has clips in the table', () => {
    for (const category of SFX_EVICTABLE_CATEGORIES) {
      expect(Object.values(CLIPS).some((entry) => entry.category === category)).toBe(true);
    }
    expect(
      evictable.some((key) => key.startsWith('mount_') && CLIPS[key].category === 'other'),
    ).toBe(true);
    for (const key of ['amb_water', 'amb_wind_vale', 'foot_grass', 'move_jump']) {
      expect(isSfxClipEvictable(key, CLIPS[key])).toBe(true);
    }
    expect(isSfxClipEvictable('mount_run_rallycart_rxt', CLIPS.mount_run_rallycart_rxt)).toBe(true);
  });

  it('pins every combat, spell, UI and voice clip (what a player reacts to)', () => {
    for (const [key, entry] of Object.entries(CLIPS)) {
      if (['combat', 'spells', 'ui', 'voices'].includes(entry.category)) {
        expect(isSfxClipEvictable(key, entry), key).toBe(false);
      }
    }
  });

  it('pins the catch-all category outside the mount takes: hazards, mechanics, abilities, alerts', () => {
    for (const key of [
      'rift_boulder_roll',
      'rift_portal_spawn',
      'hoard_tide_build',
      'hoard_tide_rush',
      'blizzard',
      'frost_nova',
      'temporal_clock',
      'quest_ready',
      'lockpick_fail',
      'wand_arcane',
    ]) {
      expect(CLIPS[key]?.category, key).toBe('other');
      expect(isSfxClipEvictable(key, CLIPS[key]), key).toBe(false);
    }
  });

  it('pins a buffer with no clip row: procedural beds have no reload path', () => {
    expect(isSfxClipEvictable('amb_crowd', undefined)).toBe(false);
    expect(isSfxClipEvictable('mob_water_elemental_aggro', undefined)).toBe(false);
  });
});

describe('audioBufferBytes', () => {
  it('counts float32 samples per channel', () => {
    expect(audioBufferBytes({ length: 48_000, numberOfChannels: 2 })).toBe(384_000);
    expect(audioBufferBytes({ length: 10, numberOfChannels: 1 })).toBe(40);
  });

  it('reads a malformed buffer as zero bytes rather than poisoning the total', () => {
    expect(audioBufferBytes({} as { length: number; numberOfChannels: number })).toBe(0);
    expect(audioBufferBytes({ length: Number.NaN, numberOfChannels: 2 })).toBe(0);
  });
});

describe('SfxResidencyLedger', () => {
  it('evicts nothing while the cosmetic clips fit the budget', () => {
    const ledger = new SfxResidencyLedger(100);
    ledger.record('a', 40, true);
    ledger.record('b', 60, true);
    expect(ledger.cosmeticBytes).toBe(100);
    expect(ledger.evict()).toEqual([]);
  });

  it('drops the least recently used idle cosmetic clips until they fit', () => {
    const ledger = new SfxResidencyLedger(100);
    ledger.record('a', 40, true);
    ledger.record('b', 40, true);
    ledger.record('c', 40, true);
    ledger.record('d', 40, true);
    expect(ledger.evict()).toEqual(['a', 'b']);
    expect(ledger.cosmeticBytes).toBe(80);
    expect(ledger.evict()).toEqual([]);
  });

  it('orders by last play, not by decode: a replayed clip survives an older idle one', () => {
    const ledger = new SfxResidencyLedger(100);
    ledger.record('a', 40, true);
    ledger.record('b', 40, true);
    ledger.acquire('a');
    ledger.release('a');
    ledger.record('c', 40, true);
    expect(ledger.evict()).toEqual(['b']);
  });

  it('never records a pinned clip: it neither counts toward the budget nor gets dropped', () => {
    const ledger = new SfxResidencyLedger(50);
    ledger.record('combat', 80, false);
    ledger.record('bed', 30, true);
    expect(ledger.cosmeticBytes).toBe(30);
    expect(ledger.evict()).toEqual([]);
    ledger.acquire('combat');
    ledger.release('combat');
    expect(ledger.evict()).toEqual([]);
  });

  it('keeps cosmetic clips up to their budget when pinned bytes alone exceed any total', () => {
    const ledger = new SfxResidencyLedger(100);
    for (let i = 0; i < 64; i++) ledger.record(`pinned:${i}`, 2 ** 30, false);
    ledger.record('bed', 50, true);
    ledger.record('step', 40, true);
    for (let round = 0; round < 10; round++) {
      ledger.acquire('step');
      ledger.release('step');
      ledger.record(`pinned:more:${round}`, 2 ** 30, false);
      expect(ledger.evict()).toEqual([]);
    }
    expect(ledger.cosmeticBytes).toBe(90);
  });

  it('never evicts a clip a live source is playing or looping, until its last source ends', () => {
    const ledger = new SfxResidencyLedger(50);
    ledger.record('loop', 40, true);
    ledger.record('shot', 40, true);
    ledger.acquire('loop');
    ledger.acquire('shot');
    ledger.acquire('shot');
    expect(ledger.evict()).toEqual([]);
    ledger.release('shot');
    expect(ledger.evict()).toEqual([]);
    ledger.release('shot');
    expect(ledger.evict()).toEqual(['shot']);
    expect(ledger.cosmeticBytes).toBe(40);
  });

  it('skips a clip the owner still holds (a pending play or load)', () => {
    const ledger = new SfxResidencyLedger(50);
    ledger.record('pending', 40, true);
    ledger.record('idle', 40, true);
    expect(ledger.evict((key) => key === 'pending')).toEqual(['idle']);
  });

  it('re-recording a clip replaces its bytes and keeps its live sources', () => {
    const ledger = new SfxResidencyLedger(50);
    ledger.record('a', 30, true);
    ledger.acquire('a');
    ledger.record('a', 60, true);
    expect(ledger.cosmeticBytes).toBe(60);
    expect(ledger.evict()).toEqual([]);
    ledger.release('a');
    expect(ledger.evict()).toEqual(['a']);
    expect(ledger.cosmeticBytes).toBe(0);
  });

  it('ignores sources for clips it never recorded', () => {
    const ledger = new SfxResidencyLedger(10);
    ledger.acquire('ghost');
    ledger.release('ghost');
    ledger.release('ghost');
    expect(ledger.cosmeticBytes).toBe(0);
    expect(ledger.evict()).toEqual([]);
  });
});
