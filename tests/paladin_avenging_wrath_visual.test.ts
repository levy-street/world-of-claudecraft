import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';
import { ContactQueue, heldUntilCollapse } from '../src/render/contact_queue';
import {
  type PaladinAvengingWrathVisual,
  syncPaladinAvengingWrathVisual,
} from '../src/render/paladin_avenging_wrath_visual';

// Node tests run at the Medium preset; the tests below pin the authored
// composition (full detail) unless a test names another tier.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('Paladin Avenging Wrath visual', () => {
  it('unfurls two layered wings of light behind the wearer and holds them still for reduced motion', () => {
    const parent = new THREE.Group();
    const visual = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0, false);
    expect(visual).not.toBeNull();
    if (!visual) throw new Error('missing Zealwing visual');

    const left = parent.getObjectByName('paladin-avenging-wrath-left-wing');
    const right = parent.getObjectByName('paladin-avenging-wrath-right-wing');
    const feathers = parent.getObjectByName('paladin-avenging-wrath-left-feathers') as THREE.Mesh;
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(feathers).toBeInstanceOf(THREE.Mesh);
    // Mirrored wings share one prepared geometry and one additive light material.
    const rightFeathers = parent.getObjectByName(
      'paladin-avenging-wrath-right-feathers',
    ) as THREE.Mesh;
    expect(rightFeathers.geometry).toBe(feathers.geometry);
    expect(left?.scale.x).toBeLessThan(0);
    expect(right?.scale.x).toBeGreaterThan(0);
    expect(visual.material.blending).toBe(THREE.AdditiveBlending);
    expect(visual.material.uniforms.uGold.value.getHex()).toBe(0xffd84a);
    // Feathers and motes live in the one geometry; no hanging filaments.
    const kinds = new Set(Array.from(visual.geometry.getAttribute('aKind').array));
    expect(kinds).toEqual(new Set([0, 1]));
    // Both wings sit behind the shoulders.
    expect(left?.position.z).toBeLessThan(0);
    expect(visual.wingRig.scale.x).toBeCloseTo(1.8 * 0.8);

    // Unfurls from tucked to spread, overshoots slightly, then settles and breathes.
    expect(visual.open).toBe(0);
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.2, false);
    const partway = visual.open;
    expect(partway).toBeGreaterThan(0.3);
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.2, false);
    expect(visual.open).toBeGreaterThan(1);
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 1, false);
    expect(visual.open).toBeCloseTo(1, 1);
    expect(visual.material.uniforms.uOpen.value).toBe(visual.open);

    const reducedTime = visual.material.uniforms.uTime.value;
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.5, true);
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.5, true);
    expect(visual.open).toBe(1);
    expect(visual.material.uniforms.uTime.value).toBe(reducedTime);
    expect(left?.rotation.z).toBeCloseTo(0);

    const dispose = vi.spyOn(visual.material, 'dispose');
    // The aura gone, the wings furl away behind the shoulders, then go.
    expect(syncPaladinAvengingWrathVisual(visual, parent, 1.8, false, 0.2, false)).toBe(visual);
    expect(visual.furling).toBe(true);
    expect(visual.open).toBeLessThan(0.9);
    expect(visual.open).toBeGreaterThan(0.3);
    expect(dispose).not.toHaveBeenCalled();
    expect(syncPaladinAvengingWrathVisual(visual, parent, 1.8, false, 0.4, false)).toBeNull();
    expect(parent.getObjectByName('paladin-avenging-wrath')).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('unfurls again if the aura returns mid-furl, and goes at once for reduced motion or a hand-over', () => {
    const parent = new THREE.Group();
    const wrath = [{ id: 'avenging_wrath', kind: 'buff_dmg_done' }];
    const visual = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 1, false, wrath);
    if (!visual) throw new Error('missing Avenging Wrath visual');
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 1, false, wrath);
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, false, 0.2, false, []);
    const furled = visual.open;
    expect(visual.furling).toBe(true);
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.2, false, wrath);
    expect(visual.furling).toBe(false);
    expect(visual.open).toBeGreaterThan(furled);

    // Reduced motion: no furl.
    expect(syncPaladinAvengingWrathVisual(visual, parent, 1.8, false, 0, true, [])).toBeNull();
    // Divine Ascension's pair takes the shoulders: nothing to furl.
    const next = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 1, false, wrath);
    syncPaladinAvengingWrathVisual(next, parent, 1.8, true, 1, false, wrath);
    expect(
      syncPaladinAvengingWrathVisual(next, parent, 1.8, false, 0, false, [
        { id: 'divine_ascension', kind: 'internal_cd' },
      ]),
    ).toBeNull();
  });

  it("draws Avenging Wrath's rune band on the ground, but not for wings borrowed without auras", () => {
    const parent = new THREE.Group();
    const wrath = [{ id: 'avenging_wrath', kind: 'buff_dmg_done' }];
    const visual = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0, false, wrath);
    if (!visual) throw new Error('missing Avenging Wrath visual');
    const band = parent.getObjectByName('paladin-avenging-wrath-rune-band') as THREE.Mesh;
    expect(band.visible).toBe(true);
    // On the ground beneath the wings, the same span as Divine Ascension's circle.
    expect(band.position.y).toBeCloseTo(-1.8 * 0.62 + 0.05);
    expect(band.scale.x).toBeCloseTo(5.2);
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0.2, false, wrath);
    expect(visual.runeAge).toBeCloseTo(0.2);

    // Divine Ascension's borrowed pair has no band.
    const borrowed = new THREE.Group();
    syncPaladinAvengingWrathVisual(null, borrowed, 1.8, true, 0, false);
    expect(borrowed.getObjectByName('paladin-avenging-wrath-rune-band')?.visible).toBe(false);
  });

  it('claims the cast cue so the generic buff wings never double the Seraphic wings', () => {
    const releaseGesture = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      releaseGesture,
      deps: { fx: {} },
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
    }) as AbilityVfx;
    const event = { sourceId: 1, targetId: 1, school: 'holy', ability: 'avenging_wrath' };
    expect(painter.handleSpellfx({ ...event, fx: 'selfCast' })).toBe(true);
    expect(painter.handleSpellfx({ ...event, fx: 'nova' })).toBe(true);
    expect(releaseGesture).toHaveBeenCalledExactlyOnceWith(1, 'avenging_wrath');
  });

  it('is wired into the renderer aura scan and entity visual lifecycle', () => {
    const rendererPath = fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url));
    const renderer = readFileSync(rendererPath, 'utf8');

    expect(renderer).toContain('if (isPaladinWingAura(a)) hasPaladinWings = true');
    expect(renderer).toContain('v.paladinAvengingWrathVisual = syncPaladinAvengingWrathVisual(');
    expect(renderer).toContain('v.paladinAvengingWrathVisual?.dispose()');
    expect(renderer).toContain('!e.dead && hasPaladinWings');
    // ...read through the one death hold, against the wings the body showed the frame before
    expect(renderer).toContain(
      'heldUntilCollapse(deathHeld, !e.dead && hasPaladinWings, !!v.paladinAvengingWrathVisual),',
    );
    // Valkyr's Calling: the flight wears the wings (and they outlive its aura for the slam).
    expect(renderer).toContain('if (valkyrElapsed !== null) hasPaladinWings = true;');
    expect(renderer).toContain('valkyrElapsed,');
  });

  it('keeps the wings on a body killed by a blade still in the air, until it collapses', () => {
    // The sim strips the wing aura on the tick the paladin dies (every buff goes:
    // src/sim/resurrection.ts aurasSurvivingDeath), so the live read is false on the first
    // held frame. The renderer's wing line, on the real wing module:
    const parent = new THREE.Group();
    const queue = new ContactQueue();
    const PALADIN = 3;
    let wings: PaladinAvengingWrathVisual | null = null;
    const frame = (now: number, live: { dead: boolean; hasPaladinWings: boolean }) => {
      queue.tick(now);
      const deathHeld = live.dead && queue.holdsDeath(PALADIN);
      wings = syncPaladinAvengingWrathVisual(
        wings,
        parent,
        1.8,
        heldUntilCollapse(deathHeld, !live.dead && live.hasPaladinWings, !!wings),
        1 / 60,
        false,
      );
      return wings;
    };
    const spread = frame(984, { dead: false, hasPaladinWings: true });
    expect(spread).not.toBeNull();
    const dispose = vi.spyOn((spread as PaladinAvengingWrathVisual).material, 'dispose');
    queue.note({}, 0.4, PALADIN, 1000);
    const killed = { dead: true, hasPaladinWings: false };
    let beat = (spread as PaladinAvengingWrathVisual).elapsed;
    for (const now of [1000, 1016, 1399]) {
      // the same wings, still on the body...
      expect(frame(now, killed), `held at ${now}`).toBe(spread);
      expect(parent.getObjectByName('paladin-avenging-wrath')).toBeDefined();
      // ...and still beating: the sync keeps driving them, it does not merely skip the dispose
      const elapsed = (spread as PaladinAvengingWrathVisual).elapsed;
      expect(elapsed, `held at ${now}`).toBeGreaterThan(beat);
      beat = elapsed;
    }
    expect(dispose).not.toHaveBeenCalled();
    // the blade lands: the wings go with the collapse (furling away from that frame,
    // or at once while they had barely opened)
    const furling = (now: number) => {
      const left = frame(now, killed);
      return left === null || left.furling;
    };
    const gone = (from: number) => {
      for (let now = from; now < from + 1000; now += 16) if (!frame(now, killed)) return true;
      return false;
    };
    expect(furling(1400)).toBe(true);
    expect(gone(1416)).toBe(true);
    expect(parent.getObjectByName('paladin-avenging-wrath')).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
    // a paladin killed with no blade in the air loses them on the event, as before
    wings = null;
    const second = frame(2000, { dead: false, hasPaladinWings: true });
    expect(second).not.toBeNull();
    expect(furling(2016)).toBe(true);
    expect(gone(2032)).toBe(true);
    // and a held body that wore none grows none
    queue.note({}, 0.4, PALADIN, 3000);
    expect(frame(3016, killed)).toBeNull();
  });

  it('re-poses the wings when the aura changes and leaves the defenses to the kit', () => {
    const parent = new THREE.Group();
    expect(
      syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0, true, [
        { id: 'guardian_covenant', kind: 'buff_dr' },
      ]),
    ).toBeNull();
    // Life Covenant holds a shield (life_covenant.ts), not wings.
    expect(
      syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0, true, [
        { id: 'life_covenant', kind: 'buff_dr' },
      ]),
    ).toBeNull();
    const visual = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0, true, [
      { id: 'avenging_wrath', kind: 'buff_dmg_done' },
      { id: 'holy_shield_absorb', kind: 'absorb' },
      { id: 'bastion_rite', kind: 'buff_dr_phys' },
    ])!;
    expect(visual.open).toBe(1);
    expect(visual.rightWing.scale.x).toBe(1);
    // The defenses are drawn by the Paladin kit (hallowed_wall.ts,
    // bastion_rite.ts), not the wing rig: alone they raise nothing here.
    expect(
      syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 0, true, [
        { id: 'holy_shield_absorb', kind: 'absorb' },
      ]),
    ).toBeNull();
    expect(syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0, true, [])).toBeNull();
  });

  it('draws thinner wings on lighter tiers through the same buffers and program', () => {
    const wrath = [{ id: 'avenging_wrath', kind: 'buff_dmg_done' }];
    const drawn = (detail: 'full' | 'light' | 'minimal') => {
      setPaladinVfxDetailForTest(detail);
      const parent = new THREE.Group();
      const visual = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0, false, wrath);
      if (!visual) throw new Error('missing Avenging Wrath visual');
      const feathers = parent.getObjectByName('paladin-avenging-wrath-left-feathers') as THREE.Mesh;
      const geometry = feathers.geometry;
      const vertices = geometry.index?.count ?? geometry.getAttribute('position').count;
      const kinds = new Set<number>();
      const kind = geometry.getAttribute('aKind');
      for (let i = 0; i < vertices; i++) kinds.add(kind.getX(geometry.index?.getX(i) ?? i));
      const out = {
        quads: vertices / 6,
        band: parent.getObjectByName('paladin-avenging-wrath-rune-band')?.visible,
        wings: parent.getObjectByName('paladin-avenging-wrath-left-wing')?.visible,
        motes: kinds.has(1),
        program: visual.material.fragmentShader,
        buffers: geometry.getAttribute('aRoot'),
      };
      visual.dispose();
      return out;
    };
    const full = drawn('full'),
      light = drawn('light'),
      minimal = drawn('minimal');
    expect(full.quads).toBe(57);
    // Light keeps the coverts and the band, half the motes.
    expect(light.quads).toBe(50);
    expect(light.band).toBe(true);
    // Minimal keeps the silhouette (primaries and secondaries) and a few motes.
    expect(minimal.quads).toBe(23);
    expect(minimal.band).toBe(false);
    for (const tier of [full, light, minimal]) {
      expect(tier.wings).toBe(true);
      expect(tier.motes).toBe(true);
      // One shared attribute buffer and the same shader on every tier.
      expect(tier.buffers).toBe(full.buffers);
      expect(tier.program).toBe(full.program);
    }
  });

  it('keeps the wings at the detail they were built with and furls them faster on lighter tiers', () => {
    const wrath = [{ id: 'avenging_wrath', kind: 'buff_dmg_done' }];
    setPaladinVfxDetailForTest('minimal');
    const parent = new THREE.Group();
    const visual = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 1, false, wrath);
    if (!visual) throw new Error('missing Avenging Wrath visual');
    setPaladinVfxDetailForTest('full');
    syncPaladinAvengingWrathVisual(visual, parent, 1.8, true, 1, false, wrath);
    expect(visual.detail).toBe('minimal');
    expect(parent.getObjectByName('paladin-avenging-wrath-rune-band')?.visible).toBe(false);
    // Minimal's furl is 0.45 of the authored half second.
    expect(syncPaladinAvengingWrathVisual(visual, parent, 1.8, false, 0.1, false, [])).toBe(visual);
    expect(syncPaladinAvengingWrathVisual(visual, parent, 1.8, false, 0.15, false, [])).toBeNull();
  });
});
