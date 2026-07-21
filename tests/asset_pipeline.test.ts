// Guards for the AI asset pipeline tooling (scripts/asset_pipeline/lib/*.mjs):
// family specs cross-checked against the engine's VARIANT_GRIPS clamps, the
// anchored registry-edit helpers on fixtures AND the real registry sources
// (read-only), prompt builders, clip plans, the structural validators calibrated
// against shipped GLBs, the normalizeWeapon convention round-trip, and the
// resumable Job ledger. Everything runs in plain Node; temp output goes under
// tmp/asset_pipeline/ (gitignored) and is removed in afterAll.
//
// The pipeline modules are plain Node .mjs tools with no type declarations, so
// each import is a namespace import behind @ts-expect-error (the same convention
// as tests/backdrop_filter_survival.test.ts importing scripts/*.mjs).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformMesh } from '@gltf-transform/functions';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error untyped zero-dep pipeline tool (scripts/*.mjs convention)
import * as families from '../scripts/asset_pipeline/lib/families.mjs';
// @ts-expect-error untyped zero-dep pipeline tool (scripts/*.mjs convention)
import * as glb from '../scripts/asset_pipeline/lib/glb.mjs';
// @ts-expect-error untyped zero-dep pipeline tool (scripts/*.mjs convention)
import * as integrate from '../scripts/asset_pipeline/lib/integrate.mjs';
// @ts-expect-error untyped zero-dep pipeline tool (scripts/*.mjs convention)
import * as jobs from '../scripts/asset_pipeline/lib/job.mjs';
// @ts-expect-error untyped zero-dep pipeline tool (scripts/*.mjs convention)
import * as prompts from '../scripts/asset_pipeline/lib/prompts.mjs';
// @ts-expect-error untyped zero-dep pipeline tool (scripts/*.mjs convention)
import * as validate from '../scripts/asset_pipeline/lib/validate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SWORD_GLB = join(ROOT, 'public/models/weapons/sword_a.glb');
const FOX_GLB = join(ROOT, 'public/models/creatures/fox.glb');
const BARREL_GLB = join(ROOT, 'public/models/props/barrel.glb');
const TMP = join(ROOT, 'tmp/asset_pipeline/test');

// ---------------------------------------------------------------------------
// 1. Weapon families
// ---------------------------------------------------------------------------

describe('weapon families', () => {
  it('resolves kinds and variant-key tokens to families', () => {
    expect(families.weaponFamilyFor('sword').name).toBe('sword');
    expect(families.weaponFamilyFor('emberfang_sword').name).toBe('sword');
    expect(families.weaponFamilyFor('war_hammer').name).toBe('hammer');
    expect(families.weaponFamilyFor('spiked_mace').name).toBe('mace');
    expect(families.weaponFamilyFor('moon_staff').name).toBe('staff');
    expect(families.weaponFamilyFor('bone_wand').name).toBe('wand');
    expect(families.weaponFamilyFor('reaver_scythe').name).toBe('polearm');
    expect(families.weaponFamilyFor('oak_longbow').name).toBe('bow');
    // "bow" is a substring of "crossbow"; a crossbow key must still resolve to crossbow.
    expect(families.weaponFamilyFor('skeleton_crossbow').name).toBe('crossbow');
    expect(families.weaponFamilyFor('mystery_orb')).toBeNull();
  });

  it('keeps every family spec internally consistent', () => {
    const entries = Object.entries(families.WEAPON_FAMILIES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, fam] of entries as [string, any][]) {
      expect(fam.gripFrac, `${name} gripFrac`).toBeGreaterThan(0);
      expect(fam.gripFrac, `${name} gripFrac`).toBeLessThan(1);
      expect(fam.height, `${name} height vs maxHeight`).toBeLessThanOrEqual(fam.maxHeight + 0.01);
      expect(fam.tokens.length, `${name} tokens`).toBeGreaterThan(0);
    }
  });

  it('matches the engine VARIANT_GRIPS maxHeight clamp per grip family (drift check)', () => {
    // Parse the engine source rather than importing it: the pipeline numbers are
    // MEASUREMENTS of that file's convention, so drift must fail this test.
    const src = readFileSync(join(ROOT, 'src/render/characters/assets.ts'), 'utf8');
    const block = src.match(/const VARIANT_GRIPS[^=]*=\s*\{([\s\S]*?)\n\};/);
    expect(block, 'VARIANT_GRIPS block in assets.ts').not.toBeNull();
    const engine: Record<string, number> = {};
    for (const m of (block as RegExpMatchArray)[1].matchAll(
      /(VAR_[A-Z]+):\s*\{[^}]*?maxHeight:\s*([0-9.]+)/g,
    )) {
      engine[m[1]] = Number(m[2]);
    }
    // The six families shipped today (VAR_SWORD 2.0, VAR_DAGGER 1.4, VAR_STAFF
    // 2.4, VAR_AXE 1.5, VAR_POLEARM 2.5, VAR_WAND 1.2).
    expect(Object.keys(engine).length).toBeGreaterThanOrEqual(6);
    for (const [name, fam] of Object.entries(families.WEAPON_FAMILIES) as [string, any][]) {
      expect(engine[fam.grip], `${name}: engine grip ${fam.grip}`).toBeDefined();
      expect(fam.maxHeight, `${name}: maxHeight vs engine ${fam.grip}`).toBe(engine[fam.grip]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Anchored registry edits (findBlockEnd / insertIntoBlock)
// ---------------------------------------------------------------------------

const OBJ_ANCHOR = 'const KAYKIT_WEAPON_ACCESSORY: Record<string, string> = {';
const FIXTURE = [
  OBJ_ANCHOR,
  "  sword_a: 'VAR_SWORD',",
  // The '{}' string only survives raw bracket counting because it is BALANCED;
  // an unbalanced brace inside a string would break matching (known limitation
  // of the implementation, acceptable for the pure data registries it targets).
  "  nested: { deep: '{}' },",
  '};',
  'const OTHER = { x: 1 };',
  '',
].join('\n');

describe('anchored registry edits', () => {
  it('findBlockEnd matches the closing bracket and skips nested blocks', () => {
    const src = '{ a: { b: [1, 2] } }';
    expect(integrate.findBlockEnd(src, 0)).toBe(src.length - 1);
    expect(integrate.findBlockEnd(src, src.indexOf('['))).toBe(src.indexOf(']'));
  });

  it('findBlockEnd rejects a non-bracket start and unbalanced input', () => {
    expect(() => integrate.findBlockEnd('abc', 0)).toThrow('not an opening bracket');
    expect(() => integrate.findBlockEnd('{ open: {', 0)).toThrow('unbalanced');
  });

  it('inserts immediately before the closing brace of the FIRST block only', () => {
    const line = "  new_key: 'VAR_AXE',\n";
    const out = integrate.insertIntoBlock(FIXTURE, OBJ_ANCHOR, line);
    const at = out.indexOf(line);
    expect(at).toBeGreaterThan(-1);
    expect(out.lastIndexOf(line)).toBe(at); // exactly once
    // Lands after the nested entry, immediately before the first block's `};`,
    // never inside the OTHER block.
    expect(at).toBeGreaterThan(out.indexOf('nested:'));
    expect(out.slice(at + line.length).startsWith('};\nconst OTHER')).toBe(true);
    expect(out).toContain("  nested: { deep: '{}' },");
  });

  it('throws loudly when the anchor is missing', () => {
    expect(() => integrate.insertIntoBlock(FIXTURE, 'const MISSING = {', '  x: 1,\n')).toThrow(
      'anchor not found',
    );
  });

  it('supports array anchors, inserting before the closing bracket', () => {
    const ARR = [
      'export const SKINS = {',
      '  player_warrior: [',
      "    'skins/a.png',",
      '  ],',
      '  player_mage: [',
      "    'skins/b.png',",
      '  ],',
      '};',
      '',
    ].join('\n');
    const inserted = "    'skins/c.png',\n";
    const out = integrate.insertIntoBlock(ARR, 'player_warrior: [', inserted);
    const at = out.indexOf(inserted);
    expect(at).toBeGreaterThan(out.indexOf("'skins/a.png'"));
    expect(out.slice(at + inserted.length).startsWith('  ],\n  player_mage:')).toBe(true);
  });

  it('splices into a SINGLE-LINE array block without corrupting the line (paladin case)', () => {
    // SKINS.player_paladin is authored on one line; a naive line-based insert
    // would land the new entry as a bare expression BEFORE the whole line.
    const SRC = [
      'export const SKINS = {',
      '  player_paladin: [null, `${SKINS_DIR}/paladin/alt_a.png`],',
      '  player_mage: [',
      '    null,',
      '  ],',
      '};',
      '',
    ].join('\n');
    const out = integrate.insertIntoBlock(
      SRC,
      'player_paladin: [',
      '    `${SKINS_DIR}/paladin/alt_d.png`,\n',
    );
    expect(out).toContain(
      '  player_paladin: [null, `${SKINS_DIR}/paladin/alt_a.png`, `${SKINS_DIR}/paladin/alt_d.png`,],',
    );
    // The other entries are untouched and bracket balance holds.
    expect(out).toContain('  player_mage: [\n    null,\n  ],');
    const balance = (s: string) => s.split('[').length - s.split(']').length;
    expect(balance(out)).toBe(balance(SRC));
  });

  it('splices into an EMPTY single-line block without a leading comma', () => {
    const SRC = 'const M = {};\n';
    const out = integrate.insertIntoBlock(SRC, 'const M = {', "  a: 'b',\n");
    expect(out).toBe("const M = { a: 'b',};\n");
  });

  it('inserts into the REAL registries with the anchors integrate.mjs uses (read-only)', () => {
    const cases = [
      {
        file: 'src/ui/weapon_variants.ts',
        anchor: 'export const ITEM_WEAPON_VARIANTS: Record<string, string> = {',
      },
      { file: 'src/render/characters/assets.ts', anchor: OBJ_ANCHOR },
    ];
    const dummy = "  __asset_pipeline_test__: 'VAR_TEST',\n";
    for (const { file, anchor } of cases) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      const out = integrate.insertIntoBlock(src, anchor, dummy);
      const at = out.indexOf(dummy);
      expect(at, `${file}: inserted`).toBeGreaterThan(-1);
      expect(out.lastIndexOf(dummy), `${file}: inserted exactly once`).toBe(at);
      // Positioned inside the anchored block, before its closing brace.
      const openIdx = out.indexOf(anchor) + anchor.length - 1;
      const closeIdx = integrate.findBlockEnd(out, openIdx);
      expect(at, `${file}: after the block open`).toBeGreaterThan(openIdx);
      expect(at, `${file}: before the block close`).toBeLessThan(closeIdx);
      // Whole-file brace balance is unchanged and growth is exactly one line.
      const balance = (s: string) => s.split('{').length - s.split('}').length;
      expect(balance(out), `${file}: brace balance`).toBe(balance(src));
      expect(out.length, `${file}: length delta`).toBe(src.length + dummy.length);
    }
  });
});

// ---------------------------------------------------------------------------
// 2b. Per-weapon grip overrides (formatGripOverride / upsertGripOverride)
// ---------------------------------------------------------------------------

const GRIP_ANCHOR = 'export const WEAPON_GRIP_OVERRIDES: Record<string, WeaponGripOverride> = {';
const GRIP_FIXTURE = [
  GRIP_ANCHOR,
  '  // Populated by hand or by the inspector Save button.',
  '  worn_axe: { rot: [0, 0, 12] },',
  '};',
  '',
].join('\n');

describe('per-weapon grip overrides', () => {
  it('formatGripOverride drops identity fields and rounds to 4 decimals', () => {
    expect(integrate.formatGripOverride({})).toBe('');
    expect(integrate.formatGripOverride({ pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 })).toBe('');
    expect(integrate.formatGripOverride({ scale: 1.05 })).toBe('{ scale: 1.05 }');
    expect(integrate.formatGripOverride({ pos: [0.123456, 0, -0.05] })).toBe(
      '{ pos: [0.1235, 0, -0.05] }',
    );
    expect(integrate.formatGripOverride({ pos: [0, 0.02, 0], rot: [0, 0, 8], scale: 1.1 })).toBe(
      '{ pos: [0, 0.02, 0], rot: [0, 0, 8], scale: 1.1 }',
    );
  });

  it('upsertGripOverride inserts a new keyed entry before the closing brace', () => {
    const { src, action } = integrate.upsertGripOverride(GRIP_FIXTURE, 'emberfang_sword', {
      scale: 1.1,
    });
    expect(src).toContain('  emberfang_sword: { scale: 1.1 },');
    expect(action).toContain('registered emberfang_sword');
    // The pre-existing entry and the closing brace are intact.
    expect(src).toContain('  worn_axe: { rot: [0, 0, 12] },');
    const balance = (s: string) => s.split('{').length - s.split('}').length;
    expect(balance(src)).toBe(balance(GRIP_FIXTURE));
  });

  it('upsertGripOverride replaces an existing entry in place (no duplication)', () => {
    const { src, action } = integrate.upsertGripOverride(GRIP_FIXTURE, 'worn_axe', {
      rot: [0, 0, 20],
    });
    expect(src).toContain('  worn_axe: { rot: [0, 0, 20] },');
    expect(src).not.toContain('rot: [0, 0, 12]');
    expect(src.match(/worn_axe:/g)).toHaveLength(1);
    expect(action).toContain('updated worn_axe');
  });

  it('upsertGripOverride removes the key when the override is identity (reset)', () => {
    const { src, action } = integrate.upsertGripOverride(GRIP_FIXTURE, 'worn_axe', {});
    expect(src).not.toContain('worn_axe');
    expect(src).toContain(GRIP_ANCHOR); // registry itself survives
    expect(action).toContain('removed worn_axe');
  });

  it('upsertGripOverride is idempotent on an unchanged value', () => {
    const { src, action } = integrate.upsertGripOverride(GRIP_FIXTURE, 'worn_axe', {
      rot: [0, 0, 12],
    });
    expect(src).toBe(GRIP_FIXTURE);
    expect(action).toContain('skipped');
  });

  it('upsertGripOverride rejects a bad key or non-finite values', () => {
    expect(() => integrate.upsertGripOverride(GRIP_FIXTURE, 'Bad-Key', { scale: 1.1 })).toThrow(
      'snake_case',
    );
    expect(() =>
      integrate.upsertGripOverride(GRIP_FIXTURE, 'ok', { scale: Number.POSITIVE_INFINITY }),
    ).toThrow('finite');
    expect(() =>
      integrate.upsertGripOverride(GRIP_FIXTURE, 'ok', { pos: [Number.NaN, 0, 0] }),
    ).toThrow('finite');
  });

  it('the real weapon_grip.ts carries the WEAPON_GRIP_OVERRIDES anchor', () => {
    const src = readFileSync(join(ROOT, 'src/render/characters/weapon_grip.ts'), 'utf8');
    expect(src).toContain(GRIP_ANCHOR);
    // A round-trip insert keeps whole-file brace balance.
    const { src: out } = integrate.upsertGripOverride(src, '__grip_test__', { scale: 1.2 });
    const balance = (s: string) => s.split('{').length - s.split('}').length;
    expect(balance(out)).toBe(balance(src));
  });
});

// ---------------------------------------------------------------------------
// 2b2. Per-weapon VFX tuning (formatVfxTuning / upsertVfxTuning; inspector "Save VFX")
// ---------------------------------------------------------------------------

const VFX_ANCHOR = 'export const WEAPON_VFX_TUNING: Record<string, Partial<WeaponVfxTuning>> = {';
const VFX_FIXTURE = [
  VFX_ANCHOR,
  '  // Populated by the inspector Save VFX button, keyed by weapon model basename.',
  '  worn_axe: { glow: 0.8, mist: 0.6 },',
  '};',
  '',
].join('\n');

describe('per-weapon vfx tuning', () => {
  it('formatVfxTuning drops 1.0 channels and rounds to 2 decimals', () => {
    expect(integrate.formatVfxTuning({})).toBe('');
    expect(integrate.formatVfxTuning({ glow: 1, bloom: 1, pool: 1 })).toBe('');
    expect(integrate.formatVfxTuning({ glow: 0.55, bloom: 1, sparkle: 0.649 })).toBe(
      '{ glow: 0.55, sparkle: 0.65 }',
    );
  });

  it('upsertVfxTuning inserts a new keyed row before the closing brace', () => {
    const { src, action } = integrate.upsertVfxTuning(VFX_FIXTURE, 'emberfang_sword', {
      glow: 0.55,
      light: 0.5,
    });
    expect(src).toContain('  emberfang_sword: { glow: 0.55, light: 0.5 },');
    expect(action).toContain('saved emberfang_sword');
    expect(src).toContain('  worn_axe: { glow: 0.8, mist: 0.6 },');
    const balance = (s: string) => s.split('{').length - s.split('}').length;
    expect(balance(src)).toBe(balance(VFX_FIXTURE));
  });

  it('upsertVfxTuning replaces an existing row in place (no duplication)', () => {
    const { src, action } = integrate.upsertVfxTuning(VFX_FIXTURE, 'worn_axe', { glow: 0.7 });
    expect(src).toContain('  worn_axe: { glow: 0.7 },');
    expect(src).not.toContain('mist: 0.6');
    expect(src.match(/worn_axe:/g)).toHaveLength(1);
    expect(action).toContain('updated worn_axe');
  });

  it('upsertVfxTuning removes the row on an all-default tuning or null', () => {
    const reset = integrate.upsertVfxTuning(VFX_FIXTURE, 'worn_axe', { glow: 1 });
    expect(reset.src).not.toContain('worn_axe');
    expect(reset.src).toContain(VFX_ANCHOR);
    expect(reset.action).toContain('removed worn_axe');
    const viaNull = integrate.upsertVfxTuning(VFX_FIXTURE, 'worn_axe', null);
    expect(viaNull.src).not.toContain('worn_axe');
  });

  it('upsertVfxTuning is idempotent on an unchanged row', () => {
    const { src, action } = integrate.upsertVfxTuning(VFX_FIXTURE, 'worn_axe', {
      glow: 0.8,
      mist: 0.6,
    });
    expect(src).toBe(VFX_FIXTURE);
    expect(action).toContain('skipped');
  });

  it('upsertVfxTuning rejects a bad key or out-of-range values', () => {
    expect(() => integrate.upsertVfxTuning(VFX_FIXTURE, 'Bad-Key', { glow: 0.5 })).toThrow(
      'snake_case',
    );
    expect(() =>
      integrate.upsertVfxTuning(VFX_FIXTURE, 'ok', { glow: Number.POSITIVE_INFINITY }),
    ).toThrow('finite');
    expect(() => integrate.upsertVfxTuning(VFX_FIXTURE, 'ok', { glow: -0.1 })).toThrow('finite');
    expect(() => integrate.upsertVfxTuning(VFX_FIXTURE, 'ok', { glow: 9 })).toThrow('finite');
  });

  it('the real weapon_vfx_tuning.ts carries the WEAPON_VFX_TUNING anchor', () => {
    const src = readFileSync(join(ROOT, 'src/render/weapon_vfx_tuning.ts'), 'utf8');
    expect(src).toContain(VFX_ANCHOR);
    const { src: out } = integrate.upsertVfxTuning(src, '__vfx_test__', { glow: 0.5 });
    const balance = (s: string) => s.split('{').length - s.split('}').length;
    expect(balance(out)).toBe(balance(src));
  });

  it('the writer covers every WeaponVfxTuning channel (stays in sync with the TS interface)', async () => {
    const { DEFAULT_TUNING } = await import('../src/render/weapon_vfx');
    const halved = Object.fromEntries(Object.keys(DEFAULT_TUNING).map((k) => [k, 0.5]));
    const body = integrate.formatVfxTuning(halved);
    for (const k of Object.keys(DEFAULT_TUNING)) {
      expect(body, `formatVfxTuning must serialize channel ${k}`).toContain(`${k}: 0.5`);
    }
  });

  it('weaponVfxTuningFor prefers the saved row, else the tier baseline', async () => {
    const { WEAPON_VFX_TUNING, weaponVfxTuningFor } = await import(
      '../src/render/weapon_vfx_tuning'
    );
    const { WORLD_TUNING } = await import('../src/render/weapon_vfx');
    expect(weaponVfxTuningFor('__unsaved__', 'epic')).toBe(WORLD_TUNING.epic);
    WEAPON_VFX_TUNING.__vfx_probe__ = { glow: 0.3 };
    try {
      expect(weaponVfxTuningFor('__vfx_probe__', 'legendary')).toEqual({ glow: 0.3 });
    } finally {
      delete WEAPON_VFX_TUNING.__vfx_probe__;
    }
  });
});

// ---------------------------------------------------------------------------
// 2c. removeWeaponFromSources (viewer "Delete asset" -- inverse of registerWeapon)
// ---------------------------------------------------------------------------

describe('removeWeaponFromSources', () => {
  const ACCESSORY = [
    OBJ_ANCHOR,
    "  sword_a: 'VAR_SWORD',",
    "  notched_woodaxe: 'VAR_AXE',",
    "  redskull_hammer: 'VAR_AXE',",
    '};',
    '',
  ].join('\n');
  const VARIANTS = [
    'export const ITEM_WEAPON_VARIANTS: Record<string, string> = {',
    "  worn_sword: 'sword_a',",
    "  hand_axe: 'notched_woodaxe',",
    "  woodsmans_axe: 'notched_woodaxe',",
    '};',
    '',
  ].join('\n');
  const bal = (s: string) => s.split('{').length - s.split('}').length;

  it('strips the accessory entry + every variant row mapping to the key', () => {
    const out = integrate.removeWeaponFromSources(
      { accessory: ACCESSORY, grip: GRIP_FIXTURE, variants: VARIANTS },
      'notched_woodaxe',
    );
    expect(out.accessory).not.toContain('notched_woodaxe');
    // Neighbours are untouched.
    expect(out.accessory).toContain("sword_a: 'VAR_SWORD'");
    expect(out.accessory).toContain("redskull_hammer: 'VAR_AXE'");
    // BOTH items that mapped to the deleted model are gone; the sword item stays.
    expect(out.variants).not.toContain('notched_woodaxe');
    expect(out.variants).toContain("worn_sword: 'sword_a'");
    expect(out.actions.some((a: string) => a.includes('KAYKIT_WEAPON_ACCESSORY'))).toBe(true);
    expect(out.actions.some((a: string) => a.includes('ITEM_WEAPON_VARIANTS'))).toBe(true);
    // Brace balance holds on both edited sources.
    expect(bal(out.accessory)).toBe(bal(ACCESSORY));
    expect(bal(out.variants)).toBe(bal(VARIANTS));
  });

  it('removes a saved grip override for the key', () => {
    const out = integrate.removeWeaponFromSources(
      { accessory: ACCESSORY, grip: GRIP_FIXTURE, variants: VARIANTS },
      'worn_axe', // present in GRIP_FIXTURE
    );
    expect(out.grip).not.toContain('worn_axe');
    expect(out.actions.some((a: string) => a.includes('worn_axe'))).toBe(true);
  });

  it('round-trips register -> remove back to the original accessory source', () => {
    const added = integrate.insertIntoBlock(ACCESSORY, OBJ_ANCHOR, "  ember_maul: 'VAR_HAMMER',\n");
    expect(added).toContain('ember_maul');
    const out = integrate.removeWeaponFromSources(
      { accessory: added, grip: GRIP_FIXTURE, variants: VARIANTS },
      'ember_maul',
    );
    expect(out.accessory).toBe(ACCESSORY);
  });

  it('is a no-op for an absent key (sources unchanged, no actions)', () => {
    const out = integrate.removeWeaponFromSources(
      { accessory: ACCESSORY, grip: GRIP_FIXTURE, variants: VARIANTS },
      'does_not_exist',
    );
    expect(out.accessory).toBe(ACCESSORY);
    expect(out.grip).toBe(GRIP_FIXTURE);
    expect(out.variants).toBe(VARIANTS);
    expect(out.actions).toEqual([]);
  });

  it('rejects a non-snake_case key (no injection surface)', () => {
    expect(() =>
      integrate.removeWeaponFromSources(
        { accessory: ACCESSORY, grip: GRIP_FIXTURE, variants: VARIANTS },
        'Bad-Key',
      ),
    ).toThrow('snake_case');
  });
});

// ---------------------------------------------------------------------------
// 3. Prompt builders
// ---------------------------------------------------------------------------

describe('prompt builders', () => {
  const sword = families.weaponFamilyFor('sword');
  const hammer = families.weaponFamilyFor('war_hammer');

  it('weapon concept prompts isolate the object on a plain background with no text', () => {
    const p = prompts.conceptPrompt({
      kind: 'weapon',
      description: 'a fiery sword',
      family: sword,
    });
    expect(p).toContain('plain white opaque background');
    expect(p).toContain('no text');
  });

  it('heavy-headed families are described head at the top', () => {
    const p = prompts.conceptPrompt({
      kind: 'weapon',
      description: 'a war hammer',
      family: hammer,
    });
    expect(p).toContain('head at the top');
  });

  it('creature concept prompts require a T-pose', () => {
    const p = prompts.conceptPrompt({ kind: 'creature', description: 'a swamp troll' });
    expect(p).toContain('T-pose');
  });

  it('model prompts strip the 2D layout constraints and fit the Tripo 1024 cap', () => {
    const p = prompts.modelPrompt({ kind: 'weapon', description: 'a fiery sword', family: sword });
    expect(p).not.toContain('plain white opaque background');
    expect(p.length).toBeLessThanOrEqual(1024);
  });

  it('atlas edit prompts keep the UV regions in place', () => {
    const p = prompts.atlasEditPrompt('royal blue with gold trim');
    expect(p).toContain('Keep every color region exactly in place');
  });

  it('never emits an em dash, en dash, or emoji (repo copy rules)', () => {
    const banned = /[\u2013\u2014\u{1F300}-\u{1FAFF}]/u;
    const built = [
      prompts.conceptPrompt({ kind: 'weapon', description: 'a fiery sword', family: sword }),
      prompts.conceptPrompt({ kind: 'weapon', description: 'a war hammer', family: hammer }),
      prompts.conceptPrompt({ kind: 'prop', description: 'an oak barrel' }),
      prompts.conceptPrompt({ kind: 'creature', description: 'a swamp troll' }),
      prompts.modelPrompt({ kind: 'weapon', description: 'a fiery sword', family: sword }),
      prompts.modelPrompt({ kind: 'creature', description: 'a swamp troll' }),
      prompts.atlasEditPrompt('royal blue with gold trim'),
    ];
    for (const p of built) expect(p).not.toMatch(banned);
  });
});

// ---------------------------------------------------------------------------
// 4. Clip plans
// ---------------------------------------------------------------------------

describe('clip plans', () => {
  it('the biped plan covers the required ClipMap fields plus Hit/Cast/Jump', () => {
    const games = families.BIPED_CLIP_PLAN.map((c: any) => c.game);
    for (const need of ['Idle', 'Walk', 'Run', 'Attack', 'Death', 'Hit', 'Cast', 'Jump']) {
      expect(games, need).toContain(need);
    }
  });

  it('every biped preset comes from the biped library', () => {
    for (const c of families.BIPED_CLIP_PLAN as { game: string; presets: string[] }[]) {
      expect(c.presets.length, c.game).toBeGreaterThan(0);
      for (const p of c.presets) {
        expect(p.startsWith('preset:biped:'), `${c.game}: ${p}`).toBe(true);
      }
    }
  });

  it('quadClipPlan maps known rigs to their walk preset and rejects unknown rigs', () => {
    expect(families.quadClipPlan('quadruped')).toEqual([
      { game: 'Walk', presets: ['preset:quadruped:walk'] },
    ]);
    expect(families.quadClipPlan('bogus')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Validators calibrated against SHIPPED assets
// ---------------------------------------------------------------------------

describe('validators calibrated against shipped assets', () => {
  it.skipIf(!existsSync(SWORD_GLB))(
    'accepts the shipped sword_a.glb as a sword-family weapon',
    async () => {
      const res = await validate.validateWeapon(SWORD_GLB, families.weaponFamilyFor('sword'));
      expect(res.errors).toEqual([]);
      expect(res.ok).toBe(true);
    },
    30000,
  );

  it.skipIf(!existsSync(FOX_GLB))(
    'accepts the shipped fox.glb creature with its game clips',
    async () => {
      const res = await validate.validateCreature(FOX_GLB, {
        requiredClips: ['Idle', 'Walk', 'Gallop', 'Attack', 'Death'],
      });
      expect(res.errors).toEqual([]);
      expect(res.ok).toBe(true);
    },
    30000,
  );

  it.skipIf(!existsSync(BARREL_GLB))(
    'accepts the shipped barrel.glb prop',
    async () => {
      const res = await validate.validateProp(BARREL_GLB, {});
      expect(res.errors).toEqual([]);
      expect(res.ok).toBe(true);
    },
    30000,
  );
});

// ---------------------------------------------------------------------------
// 6. normalizeWeapon round-trip (the load-bearing correctness check)
// ---------------------------------------------------------------------------

describe('normalizeWeapon round-trip', () => {
  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it.skipIf(!existsSync(SWORD_GLB))(
    'recovers the family convention from a translated, scaled, rotated sword',
    async () => {
      mkdirSync(TMP, { recursive: true });
      const mangledPath = join(TMP, 'mangled_sword.glb');
      const outPath = join(TMP, 'normalized_sword.glb');
      copyFileSync(SWORD_GLB, mangledPath);

      // Mangle: rotate the blade off +Y, triple the size, shove it off-origin
      // (rotation first, then scale, then translate).
      const doc = await glb.openGlb(mangledPath);
      const mangle = glb.mat4Multiply(
        glb.mat4Translate(2.5, -1.2, 0.7),
        glb.mat4Multiply(glb.mat4Scale(3), glb.mat4RotZ(Math.PI / 2)),
      );
      for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, mangle);
      await glb.saveGlb(doc, mangledPath);

      const family = families.weaponFamilyFor('sword');
      const result = await glb.normalizeWeapon(mangledPath, outPath, family);
      // The mangle plus the long-axis fix leave the sword upside down, so the
      // end-moment heuristic must flip it back tip-up.
      expect(result.flipped).toBe(true);

      const report = await glb.inspectGlb(outPath);
      const { min, max } = report.bounds;
      const height = max[1] - min[1];
      expect(Math.abs(height - 2.0), `height ${height}`).toBeLessThan(0.01);
      const gripFrac = -min[1] / height;
      expect(Math.abs(gripFrac - 0.18), `gripFrac ${gripFrac}`).toBeLessThan(0.01);
      const centerX = (min[0] + max[0]) / 2;
      const centerZ = (min[2] + max[2]) / 2;
      expect(Math.abs(centerX), `centerX ${centerX}`).toBeLessThan(0.01);
      expect(Math.abs(centerZ), `centerZ ${centerZ}`).toBeLessThan(0.01);
    },
    60000,
  );
});

// ---------------------------------------------------------------------------
// 7. Job ledger (resume semantics)
// ---------------------------------------------------------------------------

describe('job ledger', () => {
  const createdDirs: string[] = [];
  afterAll(() => {
    for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
  });

  it('runs a step once and a resumed job returns the cached result, not re-running', async () => {
    const job = jobs.Job.open({ kind: 'test', name: 'ledger' });
    createdDirs.push(job.dir);
    const first = await job.step('a', async () => ({ v: 1 }));
    expect(first).toEqual({ v: 1 });

    const resumed = new jobs.Job(job.id);
    let called = false;
    const second = await resumed.step('a', async () => {
      called = true;
      throw new Error('must not run on resume');
    });
    expect(called).toBe(false);
    expect(second).toEqual({ v: 1 });
  });

  it('records a failed step in the ledger and rethrows', async () => {
    const job = jobs.Job.open({ kind: 'test', name: 'ledger_fail' });
    createdDirs.push(job.dir);
    await expect(
      job.step('boom', async () => {
        throw new Error('kaboom');
      }),
    ).rejects.toThrow('kaboom');
    expect(job.state.steps.boom.status).toBe('failed');
    // The failure is persisted, so a resumed job sees it too.
    const reread = new jobs.Job(job.id);
    expect(reread.state.steps.boom.status).toBe('failed');
    expect(reread.state.steps.boom.error).toContain('kaboom');
  });
});

// ---------------------------------------------------------------------------
// 8. Asset-library registry parsers (read-only against the real sources)
// ---------------------------------------------------------------------------

describe('asset library registry parsers', () => {
  // @ts-expect-error untyped zero-dep pipeline tool (scripts/*.mjs convention)
  const libraryImport = import('../scripts/asset_pipeline/lib/library.mjs');

  it('parses ITEM_WEAPON_VARIANTS into variantKey -> itemIds', async () => {
    const library = await libraryImport;
    const src = readFileSync(join(ROOT, 'src/ui/weapon_variants.ts'), 'utf8');
    const map = library.parseItemVariants(src);
    // Known shipped facts: worn_sword maps to sword_a; dagger_a serves several items.
    expect(map.get('sword_a')).toContain('worn_sword');
    expect((map.get('dagger_a') ?? []).length).toBeGreaterThan(1);
    for (const [key, items] of map) {
      expect(key).toMatch(/^[a-z0-9_]+$/);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('parses KAYKIT_WEAPON_ACCESSORY into weaponKey -> grip family', async () => {
    const library = await libraryImport;
    const src = readFileSync(join(ROOT, 'src/render/characters/assets.ts'), 'utf8');
    const map = library.parseAccessoryMap(src);
    expect(map.get('sword_a')).toBe('VAR_SWORD');
    expect(map.get('sword_1handed')).toBe('1H_Sword');
    expect(map.get('emberfang_sword')).toBe('VAR_SWORD');
    expect(map.size).toBeGreaterThan(30);
  });

  it('parses WEAPON_GRIP_OVERRIDES into weaponKey -> {pos,rot,scale}, ignoring comments', async () => {
    const library = await libraryImport;
    // Comment lines that LOOK like entries must not be parsed as real overrides.
    const src = [
      'export const WEAPON_GRIP_OVERRIDES: Record<string, WeaponGripOverride> = {',
      '  // ghost_sword: { scale: 9 } is only an example, never a real entry',
      '  emberfang_sword: { pos: [0, 0.02, 0], rot: [0, 0, 8], scale: 1.1 },',
      '  worn_dagger: { scale: 0.9 },',
      '};',
    ].join('\n');
    const map = library.parseGripOverrides(src);
    expect(map.size).toBe(2);
    expect(map.has('ghost_sword')).toBe(false);
    expect(map.get('emberfang_sword')).toEqual({ pos: [0, 0.02, 0], rot: [0, 0, 8], scale: 1.1 });
    expect(map.get('worn_dagger')).toEqual({ scale: 0.9 });
    // The real (empty by default) registry parses without throwing.
    const realSrc = readFileSync(join(ROOT, 'src/render/characters/weapon_grip.ts'), 'utf8');
    expect(() => library.parseGripOverrides(realSrc)).not.toThrow();
  });

  it('the viewer twin WORLD_TUNING matches src/render/weapon_vfx.ts (values in sync)', async () => {
    const { WORLD_TUNING } = await import('../src/render/weapon_vfx');
    const library = await libraryImport;
    const twinSrc = readFileSync(join(ROOT, 'scripts/asset_pipeline/weapon_vfx.js'), 'utf8');
    const block = twinSrc.match(/export const WORLD_TUNING = \{([\s\S]*?)\n\};/);
    expect(block, 'weapon_vfx.js twin must export WORLD_TUNING').toBeTruthy();
    // Reuse the registry row parser: same `key: { channel: n }` row shape.
    const parsed = library.parseVfxTuning(
      `export const WEAPON_VFX_TUNING: twin = {${block?.[1]}\n};`,
    );
    expect(Object.fromEntries(parsed)).toEqual(WORLD_TUNING);
  });

  it('parses WEAPON_VFX_TUNING into weaponKey -> channel multipliers, ignoring comments', async () => {
    const library = await libraryImport;
    const src = [
      'export const WEAPON_VFX_TUNING: Record<string, Partial<WeaponVfxTuning>> = {',
      '  // ghost_sword: { glow: 9 } is only an example, never a real entry',
      '  emberfang_sword: { glow: 0.55, light: 0.5, shell: 0.5 },',
      '  worn_dagger: { mist: 0.7 },',
      '};',
    ].join('\n');
    const map = library.parseVfxTuning(src);
    expect(map.size).toBe(2);
    expect(map.has('ghost_sword')).toBe(false);
    expect(map.get('emberfang_sword')).toEqual({ glow: 0.55, light: 0.5, shell: 0.5 });
    expect(map.get('worn_dagger')).toEqual({ mist: 0.7 });
    // The real (empty by default) registry parses without throwing.
    const realSrc = readFileSync(join(ROOT, 'src/render/weapon_vfx_tuning.ts'), 'utf8');
    expect(() => library.parseVfxTuning(realSrc)).not.toThrow();
  });

  it('parses VISUALS urls into modelPath -> visualKeys (template dirs resolved)', async () => {
    const library = await libraryImport;
    const src = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');
    const map = library.parseVisualUrls(src);
    expect(map.get('models/chars/players/knight.glb')).toContain('player_warrior');
    expect(map.get('models/creatures/wolf_basic.glb')).toEqual(
      expect.arrayContaining(['form_cat', 'mob_wolf']),
    );
    // Attach urls are attributed too (the knight's default sword).
    expect(map.get('models/weapons/sword_1handed.glb')).toContain('player_warrior');
  });

  it('parses SKINS into atlasPath -> [{key, index}] with correct indexes', async () => {
    const library = await libraryImport;
    const src = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');
    const map = library.parseSkinsMap(src);
    const knightA = map.get('textures/skins/knight/alt_a.png') ?? [];
    expect(knightA).toEqual(expect.arrayContaining([{ key: 'player_warrior', index: 1 }]));
    // mage.glb atlases serve priest, mage, and warlock.
    const mageA = map.get('textures/skins/mage/alt_a.png') ?? [];
    expect(mageA.map((s: { key: string }) => s.key).sort()).toEqual([
      'player_mage',
      'player_priest',
      'player_warlock',
    ]);
  });

  it('parses MECH_CHROMAS ids and ranks from the sim data', async () => {
    const library = await libraryImport;
    const src = readFileSync(join(ROOT, 'src/sim/content/skins.ts'), 'utf8');
    const map = library.parseMechChromas(src);
    expect(map.size).toBeGreaterThanOrEqual(15);
    const ranks = new Set(map.values());
    expect([...ranks].sort()).toEqual(['epic', 'rare', 'uncommon']);
  });

  it('collects an inventory that covers every category with sane statuses', async () => {
    const library = await libraryImport;
    const assets = library.collectInventory();
    const cats = new Set(assets.map((a: { category: string }) => a.category));
    for (const want of ['weapons', 'creatures', 'chars/players', 'props', 'skins']) {
      expect(cats.has(want), `category ${want}`).toBe(true);
    }
    const swordA = assets.find((a: { path: string }) => a.path === 'models/weapons/sword_a.glb');
    expect(swordA.registration.gripFamily).toBe('VAR_SWORD');
    expect(swordA.registration.itemIds).toContain('worn_sword');
    expect(swordA.registration.icon).toBe('ui/weapons/sword_a.jpg');
    const knight = assets.find(
      (a: { path: string }) => a.path === 'models/chars/players/knight.glb',
    );
    expect(knight.registration.visualKeys).toContain('player_warrior');
    expect(knight.registration.referenced).toBe(true);
  });
});
