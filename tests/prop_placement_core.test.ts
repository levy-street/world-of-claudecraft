// Characterization pins for the ONE prop-placement resolver.
//
// These values are the ones the game produced BEFORE the resolver was extracted out of
// `src/render/characters/assets.ts`, read off its tables branch by branch. They exist so
// the extraction is provably behavior-preserving, and so the precedence order cannot be
// reshuffled by accident later: every branch below is a case that used to be answered by
// a different surface differently.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isHandslotBone,
  modelBasename,
  type PropTransform,
  resolvePropPlacement,
} from '../src/render/characters/prop_placement_core';

describe('the shared mount stays cheap enough for the Guide to import', () => {
  // The /wiki viewer is a LAZY chunk that deliberately loads one model on demand instead
  // of the renderer's ~23 MB boot preload. `characters/assets.ts` kicks that preload off
  // at MODULE IMPORT via registerPreload, so if `prop_mount` ever reaches it (directly or
  // through the core), merely opening a wiki page starts fetching every character and
  // weapon GLB in the game. That is the failure this pins, and it would not show up in
  // any behavior test.
  const ALLOWED = new Set([
    'three',
    './back_grips',
    './held_item_grips',
    './prop_placement_core',
    './weapon_grip',
  ]);

  it.each(['prop_mount.ts', 'prop_placement_core.ts'])('%s imports nothing heavy', (file) => {
    const src = readFileSync(new URL(`../src/render/characters/${file}`, import.meta.url), 'utf8');
    const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specs.length, 'vacuity floor: the file really does import things').toBeGreaterThan(0);
    const forbidden = specs.filter((s) => !ALLOWED.has(s));
    expect(forbidden, `only leaf, preload-free modules may be imported: ${forbidden}`).toEqual([]);
  });
});

const RIGHT = 'handslot.r';
const LEFT = 'handslot.l';

describe('bone and model identification', () => {
  it('accepts both the authored and the GLTFLoader-sanitized spelling', () => {
    // GLTFLoader strips [].:/ from node names, so a rig arrives with "handslotr".
    expect(isHandslotBone('handslot.r')).toBe(true);
    expect(isHandslotBone('handslotr')).toBe(true);
    expect(isHandslotBone('handslot.l')).toBe(true);
    expect(isHandslotBone('handslotl')).toBe(true);
    expect(isHandslotBone('lowerarm.l')).toBe(false);
    expect(isHandslotBone('chest')).toBe(false);
  });

  it('keys tables by the bare glb basename', () => {
    expect(modelBasename('models/weapons/sword_1handed.glb')).toBe('sword_1handed');
    expect(modelBasename('sword_1handed.glb')).toBe('sword_1handed');
  });
});

describe('the KayKit hand-grip family (no VAR_* row)', () => {
  it("puts the warrior's sword where the game puts it, not at the bone origin", () => {
    // The number /wiki disagreed with: it applied nothing at all, leaving the sword half
    // a yard down the arm and 180 degrees around.
    const p = resolvePropPlacement({ url: 'models/weapons/sword_1handed.glb', bone: RIGHT });
    expect(p.position).toEqual([0, 0.555174, 0]);
    expect(p.quaternion).toEqual([0, 1, 0, 0]);
    expect(p.scale).toBe(0.8876);
  });

  it('mirrors to the identity rotation on the off hand', () => {
    const p = resolvePropPlacement({ url: 'models/weapons/sword_1handed.glb', bone: LEFT });
    expect(p.position).toEqual([0, 0.555174, 0]);
    expect(p.quaternion).toEqual([0, 0, 0, 1]);
    expect(p.scale).toBe(0.8876);
  });

  it('prefers a grip node the rig actually carries over the fallback table', () => {
    // The shipped KayKit bodies carry no accessory nodes, which is why the table exists.
    // A rig that DOES carry one wins, and this is the seam a per-figure authored grip
    // baked into a body GLB will arrive through.
    const authored: PropTransform = {
      position: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      scale: [2, 2, 2],
    };
    const p = resolvePropPlacement({
      url: 'models/weapons/sword_1handed.glb',
      bone: RIGHT,
      lookupNode: (name) => (name === '1H_Sword' ? authored : null),
    });
    expect(p.position).toEqual([1, 2, 3]);
    expect(p.scale).toEqual([2, 2, 2]);
  });

  it('looks for the off-hand accessory node under its own name', () => {
    const seen: string[] = [];
    resolvePropPlacement({
      url: 'models/weapons/sword_1handed.glb',
      bone: LEFT,
      lookupNode: (name) => {
        seen.push(name);
        return null;
      },
    });
    expect(seen).toEqual(['1H_Sword_Offhand']);
  });
});

describe('the variant pack (a VAR_* row)', () => {
  it('lifts along the bone, flips for the right hand, and only ever shrinks', () => {
    const p = resolvePropPlacement({
      url: 'models/weapons/adv_sword_1handed.glb',
      bone: RIGHT,
      measureNativeHeight: () => 1,
    });
    expect(p.position).toEqual([0, 0.04, 0]);
    expect(p.quaternion).toEqual([0, 1, 0, 0]);
    expect(p.scale).toBe(1); // min(1, VAR_SWORD maxHeight 2.0 / 1) clamps to no growth
  });

  it('clamps an oversized model down so a long blade does not drag', () => {
    const p = resolvePropPlacement({
      url: 'models/weapons/adv_sword_1handed.glb',
      bone: RIGHT,
      measureNativeHeight: () => 4,
    });
    expect(p.scale).toBeCloseTo(0.5, 10); // 2.0 / 4
  });

  it('never measures or looks anything up when the answer does not need it', () => {
    // Laziness is not an optimization detail here: it is what lets precedence live in
    // exactly one place, because no caller has to predict which lookups will be reached.
    let measured = 0;
    let looked = 0;
    resolvePropPlacement({
      url: 'models/weapons/sword_1handed.glb',
      bone: RIGHT,
      measureNativeHeight: () => {
        measured++;
        return 1;
      },
      lookupNode: () => {
        looked++;
        return null;
      },
    });
    expect(measured, 'hand-grip family must not walk a bounding box').toBe(0);
    expect(looked, 'hand-grip family checks its accessory node once').toBe(1);
  });
});

describe('authored overrides', () => {
  it('an explicit position wins over the hand-grip family, and keeps native scale', () => {
    const p = resolvePropPlacement({
      url: 'models/weapons/sword_1handed.glb',
      bone: RIGHT,
      position: [0.1, 0.2, 0.3],
    });
    expect(p.position).toEqual([0.1, 0.2, 0.3]);
    expect(p.scale, 'an absent scale means the flattened native scale stands').toBeUndefined();
  });

  it('rotationY alone sets euler Y only and leaves position and scale alone', () => {
    const p = resolvePropPlacement({
      url: 'models/weapons/sword_1handed.glb',
      bone: RIGHT,
      rotationY: 1.5,
    });
    expect(p.rotationY).toBe(1.5);
    expect(p.position).toBeUndefined();
    expect(p.quaternion).toBeUndefined();
    expect(p.scale).toBeUndefined();
  });

  it('a gripRef naming a node the rig does not carry resolves to NOTHING', () => {
    // Live today: both `gripRef: 'Spellbook_open'` call sites sit on mage.glb, which has
    // no such node, so the warlock's spellbook is placed at the bone origin by accident.
    // Pinned as the current behavior, not as desirable behavior.
    const p = resolvePropPlacement({
      url: 'models/weapons/spellbook_open.glb',
      bone: LEFT,
      gripRef: 'Spellbook_open',
      lookupNode: () => null,
    });
    expect(p).toEqual({});
  });
});

describe('a prop on a bone that is not a hand slot', () => {
  it("gets no placement at all, which is why Coalfast's shield needed authoring", () => {
    // A strapped shield rides `lowerarm.l`. Every derived grip path is handslot-only, so
    // the model lands at the bone origin: the gap a per-figure authored grip fills.
    const p = resolvePropPlacement({ url: 'models/weapons/shield_square.glb', bone: 'lowerarm.l' });
    expect(p).toEqual({});
  });
});

describe('sheathed', () => {
  it('replaces where it sits but keeps the scale the grip pass computed', () => {
    const hand = resolvePropPlacement({ url: 'models/weapons/sword_1handed.glb', bone: RIGHT });
    const back = resolvePropPlacement({
      url: 'models/weapons/sword_1handed.glb',
      bone: RIGHT,
      stowed: true,
    });
    expect(back.scale, 'variant clamps and family scales must survive a stow').toBe(hand.scale);
    expect(back.position).not.toEqual(hand.position);
    expect(back.quaternion).not.toEqual(hand.quaternion);
  });

  it('drops a euler-Y knob it would silently overwrite', () => {
    const back = resolvePropPlacement({
      url: 'models/weapons/sword_1handed.glb',
      bone: RIGHT,
      rotationY: 1.5,
      stowed: true,
    });
    expect(back.rotationY).toBeUndefined();
    expect(back.quaternion).toBeDefined();
  });

  it('leaves a non-handslot prop alone: only hands sheathe', () => {
    const p = resolvePropPlacement({
      url: 'models/weapons/shield_square.glb',
      bone: 'lowerarm.l',
      stowed: true,
    });
    expect(p).toEqual({});
  });
});
