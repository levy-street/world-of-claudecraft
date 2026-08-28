import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error untyped zero-dependency authoring tool (scripts/*.mjs convention)
import * as manifestModule from '../scripts/sfx/manifest.mjs';
// @ts-expect-error untyped zero-dependency authoring tool (scripts/*.mjs convention)
import * as profileModule from '../scripts/sfx/playback_profile.mjs';

const { buildSfxManifestData } = manifestModule;
const {
  DEFAULT_SFX_GAIN_MAP,
  DEFAULT_SFX_SPEED_MAP,
  normalizeSfxGainMap,
  normalizeSfxSpeedMap,
  readSfxPlaybackProfile,
  resolvedGainCeilingDb,
  resolveSfxPlaybackProfile,
  SFX_GAIN_MAP_PATH,
  SFX_SPEED_MAP_PATH,
  writeSfxPlaybackProfile,
} = profileModule;

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'woc-sfx-playback-profile-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('SFX runtime playback profile', () => {
  it('uses neutral sparse defaults when checked-in maps are absent', () => {
    const profile = readSfxPlaybackProfile(temporaryRoot());

    expect(profile.gainMap).toEqual(DEFAULT_SFX_GAIN_MAP);
    expect(profile.speedMap).toEqual(DEFAULT_SFX_SPEED_MAP);
    expect(resolveSfxPlaybackProfile('foot_grass', profile)).toEqual({
      gainDb: 0,
      gain: 1,
      playbackRate: 1,
    });
  });

  it('layers category gain and key trim while resolving rate independently', () => {
    const root = temporaryRoot();
    const rawProfile = {
      gainMap: {
        version: 1,
        categoryBaselineDb: { movement: -6 },
        keyTrimDb: { foot_grass: 3, foot_dirt: -2 },
      },
      speedMap: {
        version: 1,
        rateByKey: { foot_grass: 1.25 },
      },
    };

    writeSfxPlaybackProfile(root, rawProfile);
    const profile = readSfxPlaybackProfile(root);

    expect(resolveSfxPlaybackProfile('foot_grass', profile)).toEqual({
      gainDb: -3,
      gain: 0.707946,
      playbackRate: 1.25,
    });
    expect(resolveSfxPlaybackProfile('foot_stone', profile)).toEqual({
      gainDb: -6,
      gain: 0.501187,
      playbackRate: 1,
    });
    expect(Object.keys(profile.gainMap.categoryBaselineDb)).toEqual([
      'ui',
      'movement',
      'combat',
      'spells',
      'voices',
      'ambience',
      'other',
    ]);
    expect(Object.keys(profile.gainMap.keyTrimDb)).toEqual(['foot_dirt', 'foot_grass']);

    const gainFirst = readFileSync(join(root, SFX_GAIN_MAP_PATH), 'utf8');
    const speedFirst = readFileSync(join(root, SFX_SPEED_MAP_PATH), 'utf8');
    expect(statSync(join(root, SFX_GAIN_MAP_PATH)).mode & 0o777).toBe(0o644);
    expect(statSync(join(root, SFX_SPEED_MAP_PATH)).mode & 0o777).toBe(0o644);
    writeSfxPlaybackProfile(root, rawProfile);
    expect(readFileSync(join(root, SFX_GAIN_MAP_PATH), 'utf8')).toBe(gainFirst);
    expect(readFileSync(join(root, SFX_SPEED_MAP_PATH), 'utf8')).toBe(speedFirst);
  });

  it('rejects malformed, unknown, and unsafe profile values instead of coercing or clamping', () => {
    expect(() =>
      normalizeSfxGainMap({
        version: 2,
        categoryBaselineDb: {},
        keyTrimDb: {},
      }),
    ).toThrow('version must be 1');
    expect(() =>
      normalizeSfxGainMap({
        version: 1,
        categoryBaselineDb: { music: 0 },
        keyTrimDb: {},
      }),
    ).toThrow('unknown SFX gain category');
    expect(() =>
      normalizeSfxGainMap({
        version: 1,
        categoryBaselineDb: { movement: null },
        keyTrimDb: {},
      }),
    ).toThrow('finite number');
    expect(() =>
      normalizeSfxGainMap({
        version: 1,
        categoryBaselineDb: {},
        keyTrimDb: { typo_cue: -3 },
      }),
    ).toThrow('unknown SFX gain key');
    expect(() =>
      normalizeSfxGainMap({
        version: 1,
        categoryBaselineDb: { movement: -50 },
        keyTrimDb: { foot_grass: -20 },
      }),
    ).toThrow('resolved gain for foot_grass');
    expect(() =>
      normalizeSfxGainMap({
        version: 1,
        categoryBaselineDb: {},
        // foot_grass has its own computed ceiling above the flat 0dB default
        // now (see sfx_gain_ceiling.mjs), so this must clear ANY plausible
        // per-key ceiling, not just the old flat one, to still be unsafe.
        keyTrimDb: { foot_grass: 20 },
      }),
    ).toThrow('resolved gain for foot_grass');
    // Accept-path counterpart to the two reject cases above: a custom key's
    // computed ceiling (see sfx_gain_ceiling.mjs) sits above the flat 0dB a
    // non-custom key like foot_grass is bound to, so a trim below its OWN
    // ceiling but above the old flat max must be genuinely honored, not
    // silently clamped back down to 0dB.
    const belowCeiling = resolveSfxPlaybackProfile('foot_grass', {
      gainMap: {
        version: 1,
        categoryBaselineDb: {},
        keyTrimDb: { foot_grass: 5 },
      },
      speedMap: DEFAULT_SFX_SPEED_MAP,
    });
    expect(belowCeiling.gainDb).toBe(5);
    expect(belowCeiling.gain).toBeGreaterThan(1);
    // A non-custom key has no computed ceiling to raise it above the old
    // flat 0dB max: the ceiling system is opt-in per key, not a blanket
    // relaxation of the safety floor for everything. ui_quest_done, not
    // ui_click/ui_sheep: those are real custom content now and each has its
    // own computed ceiling.
    expect(() =>
      normalizeSfxGainMap({
        version: 1,
        categoryBaselineDb: {},
        keyTrimDb: { ui_quest_done: 5 },
      }),
    ).toThrow('resolved gain for ui_quest_done');
    expect(() => normalizeSfxSpeedMap({ version: 1, rateByKey: { foot_grass: '1.2' } })).toThrow(
      'finite number',
    );
    expect(() => normalizeSfxSpeedMap({ version: 1, rateByKey: { foot_grass: 4.01 } })).toThrow(
      'between 0.25 and 4',
    );
    expect(() => normalizeSfxSpeedMap({ version: 1, rateByKey: { typo_cue: 1 } })).toThrow(
      'unknown SFX speed key',
    );

    const root = temporaryRoot();
    expect(() =>
      writeSfxPlaybackProfile(root, {
        gainMap: DEFAULT_SFX_GAIN_MAP,
        speedMap: { version: 1, rateByKey: { foot_grass: 5 } },
      }),
    ).toThrow('between 0.25 and 4');
    expect(existsSync(join(root, SFX_GAIN_MAP_PATH))).toBe(false);
    expect(existsSync(join(root, SFX_SPEED_MAP_PATH))).toBe(false);
  });

  it('addresses mob subfamily extension keys in both maps, held to their computed ceilings', () => {
    // mob_beast_wolf_* are filesystem-discovered subfamily keys with no
    // catalog row; their committed ceiling records come from the custom-family
    // inheritance in sfx_gain_ceiling.mjs. The wolf pack is used on purpose:
    // it shipped long before any subfamily carried a trim, so this test proves
    // the pipeline on pre-existing content rather than on whichever new voice
    // pack landed last. Read the live ceiling rather than hardcoding it so a
    // re-cut take moves this test with the artifact.
    const ceiling = resolvedGainCeilingDb('mob_beast_wolf_attack');
    expect(ceiling).toBeGreaterThan(0);
    // A trim at the computed ceiling is the intended shape and must resolve.
    const boosted = resolveSfxPlaybackProfile('mob_beast_wolf_attack', {
      gainMap: {
        version: 1,
        categoryBaselineDb: {},
        keyTrimDb: { mob_beast_wolf_attack: ceiling },
      },
      speedMap: DEFAULT_SFX_SPEED_MAP,
    });
    expect(boosted.gainDb).toBe(ceiling);
    expect(boosted.gain).toBeGreaterThan(1);
    // Past the ceiling fails outright, exactly like a catalog custom key.
    expect(() =>
      normalizeSfxGainMap({
        version: 1,
        categoryBaselineDb: {},
        keyTrimDb: { mob_beast_wolf_attack: ceiling + 0.5 },
      }),
    ).toThrow('resolved gain for mob_beast_wolf_attack');
    // A valid-shape subfamily key with NO ceiling record keeps the flat 0dB
    // cap, so a positive trim on it can never validate.
    expect(() =>
      normalizeSfxGainMap({
        version: 1,
        categoryBaselineDb: {},
        keyTrimDb: { mob_elemental_nosuchsub_aggro: 1 },
      }),
    ).toThrow('resolved gain for mob_elemental_nosuchsub_aggro');
    // Outside the known voice families, or off the key grammar, both maps
    // still refuse the key outright.
    expect(() =>
      normalizeSfxGainMap({
        version: 1,
        categoryBaselineDb: {},
        keyTrimDb: { mob_notafamily_testsub_aggro: -3 },
      }),
    ).toThrow('unknown SFX gain key');
    expect(() =>
      normalizeSfxSpeedMap({ version: 1, rateByKey: { mob_notafamily_testsub_aggro: 1.2 } }),
    ).toThrow('unknown SFX speed key');
    // A speed entry for a real subfamily key is addressable like gain is.
    expect(
      normalizeSfxSpeedMap({ version: 1, rateByKey: { mob_beast_wolf_attack: 1.1 } }).rateByKey
        .mob_beast_wolf_attack,
    ).toBe(1.1);
  });

  it('uses only the runtime maps for manifest gain and rate without changing audio identity', () => {
    const root = temporaryRoot();
    const audioDir = join(root, 'public/audio/sfx');
    const mixDir = join(root, 'scripts/sfx');
    mkdirSync(audioDir, { recursive: true });
    mkdirSync(mixDir, { recursive: true });
    const bytes = Buffer.from('fixture audio bytes');
    writeFileSync(join(audioDir, 'foot_grass.mp3'), bytes);
    writeFileSync(
      join(mixDir, 'sfx_mix.json'),
      JSON.stringify({ version: 1, clips: { foot_grass: { runtimeGainDb: -40 } } }),
    );
    writeSfxPlaybackProfile(root, {
      gainMap: {
        version: 1,
        categoryBaselineDb: { movement: -6 },
        keyTrimDb: { foot_grass: 3 },
      },
      speedMap: { version: 1, rateByKey: { foot_grass: 1.2 } },
    });

    const tuned = buildSfxManifestData(root, { requireComplete: false }).foot_grass;
    expect(tuned).toMatchObject({ gain: 0.707946, playbackRate: 1.2, bytes: bytes.length });

    writeSfxPlaybackProfile(root, {
      gainMap: DEFAULT_SFX_GAIN_MAP,
      speedMap: DEFAULT_SFX_SPEED_MAP,
    });
    const neutral = buildSfxManifestData(root, { requireComplete: false }).foot_grass;
    expect(neutral).toMatchObject({ gain: 1, playbackRate: 1 });
    expect({ url: neutral.url, hash: neutral.hash, bytes: neutral.bytes }).toEqual({
      url: tuned.url,
      hash: tuned.hash,
      bytes: tuned.bytes,
    });
  });
});
