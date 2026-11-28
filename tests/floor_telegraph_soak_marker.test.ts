// The shared soak marker (src/render/floor_telegraph/soak_marker*.ts): one
// raid-language look for every "stack on the marked player and share it"
// circle, its palette driven by the element, its share meaning carried by the
// shape and the motion (rings converging, chevrons in), never by the hue.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildBalgathRangedStandIn } from '../src/render/balgath_ranged_fx';
import { FloorTellPool } from '../src/render/floor_telegraph/floor_tell';
import { buildSoakMarkerGeometry, SoakMarker } from '../src/render/floor_telegraph/soak_marker';
import {
  newSoakMarkerLook,
  SOAK_CHARACTER,
  SOAK_ELEMENTS,
  SOAK_MARKER,
  SOAK_PALETTES,
  SOAK_STILL_TIME,
  soakMarkerLook,
  soakMarkerStage,
  soakRipple,
  soakTimerLeft,
  soakWispCount,
  soakWispHeight,
} from '../src/render/floor_telegraph/soak_marker_core';
import { cradleNeedOf, cradleUnder } from '../src/render/smith_heart_fx/breath_fight_fx_core';
import { buildVarkhulEncounterPrewarmVisual } from '../src/render/varkhul_encounter';
import { BREATH_DIFFICULTY } from '../src/sim/encounters/smith_heart/breath_ids';

const lum = (hex: number) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

describe('the soak marker palette (the element drives it)', () => {
  it('every element runs dark to hot, and no two elements share a body colour', () => {
    expect(SOAK_ELEMENTS).toEqual(
      expect.arrayContaining(['fire', 'earth', 'lightning', 'shadow', 'frost', 'water']),
    );
    const bodies = new Set<number>();
    for (const el of SOAK_ELEMENTS) {
      const p = SOAK_PALETTES[el];
      expect(lum(p.deep)).toBeLessThan(lum(p.body));
      expect(lum(p.body)).toBeLessThan(lum(p.bright));
      expect(lum(p.bright)).toBeLessThan(lum(p.hot));
      bodies.add(p.body);
    }
    expect(bodies.size).toBe(SOAK_ELEMENTS.length);
  });

  it('fire is red-orange, earth sandy, lightning blue, shadow violet', () => {
    const c = (hex: number) => new THREE.Color(hex);
    const fire = c(SOAK_PALETTES.fire.body);
    expect(fire.r).toBeGreaterThan(fire.g * 2);
    expect(fire.r).toBeGreaterThan(fire.b * 2);
    const earth = c(SOAK_PALETTES.earth.bright);
    expect(earth.r).toBeGreaterThan(earth.g);
    expect(earth.g).toBeGreaterThan(earth.b);
    const bolt = c(SOAK_PALETTES.lightning.body);
    expect(bolt.b).toBeGreaterThan(bolt.r * 2);
    const shadow = c(SOAK_PALETTES.shadow.bright);
    expect(shadow.b).toBeGreaterThan(shadow.g);
    expect(shadow.r).toBeGreaterThan(shadow.g);
  });

  it('each element has its own character, not a recolour only', () => {
    expect(SOAK_CHARACTER.fire.tongues).toBeGreaterThan(0.5);
    expect(SOAK_CHARACTER.earth.grain).toBeGreaterThan(0.5);
    expect(SOAK_CHARACTER.lightning.crackle).toBeGreaterThan(0.5);
    expect(SOAK_CHARACTER.shadow.smoke).toBeGreaterThan(0.5);
    for (const el of SOAK_ELEMENTS) expect(SOAK_CHARACTER[el].speed).toBeGreaterThan(0);
  });
});

describe('the soak marker clips (birth, hold, decay)', () => {
  it('a mark is born, holds, and once released decays to done', () => {
    expect(soakMarkerStage(0, null)).toBe('birth');
    expect(soakMarkerStage(SOAK_MARKER.birth - 0.01, null)).toBe('birth');
    expect(soakMarkerStage(SOAK_MARKER.birth, null)).toBe('hold');
    expect(soakMarkerStage(99, null)).toBe('hold');
    expect(soakMarkerStage(99, 0)).toBe('decay');
    expect(soakMarkerStage(99, SOAK_MARKER.decay)).toBe('done');
  });

  it('the birth blooms out from the middle and the decay draws it back in', () => {
    const look = newSoakMarkerLook();
    soakMarkerLook(10, 0, null, 0, false, false, look);
    expect(look.bloom).toBeCloseTo(SOAK_MARKER.bloomFrom, 6);
    expect(look.wisp).toBe(0);
    const born = soakMarkerLook(10, SOAK_MARKER.birth, null, 0, false, false, newSoakMarkerLook());
    expect(born.bloom).toBeCloseTo(1, 6);
    // The birth's strong outward ring runs on `born` (0 laid .. 1 born).
    expect(look.born).toBe(0);
    expect(born.born).toBe(1);
    expect(born.alpha).toBeGreaterThan(look.alpha);
    const dying = soakMarkerLook(
      10,
      5,
      SOAK_MARKER.decay * 0.5,
      0,
      false,
      false,
      newSoakMarkerLook(),
    );
    expect(dying.bloom).toBeLessThan(1);
    expect(dying.alpha).toBeLessThan(born.alpha);
    const gone = soakMarkerLook(10, 5, SOAK_MARKER.decay, 0, false, false, newSoakMarkerLook());
    expect(gone.alpha).toBeCloseTo(0, 6);
    expect(gone.bloom).toBeCloseTo(SOAK_MARKER.bloomTo, 6);
  });

  it('the spin is continuous through the birth (no jump) and burns brighter to the end', () => {
    const a = soakMarkerLook(5, 0.3, null, 0.2, false, false, newSoakMarkerLook());
    const b = soakMarkerLook(5.001, 0.301, null, 0.2, false, false, newSoakMarkerLook());
    expect(Math.abs(b.spin - a.spin)).toBeLessThan(0.05);
    const early = soakMarkerLook(5, 3, null, 0, false, false, newSoakMarkerLook());
    const late = soakMarkerLook(5, 3, null, 1, false, false, newSoakMarkerLook());
    expect(late.alpha).toBeGreaterThan(early.alpha);
  });

  it('reduced motion holds everything still and skips the bloom', () => {
    const a = soakMarkerLook(3, 0, null, 0.5, false, true, newSoakMarkerLook());
    const b = soakMarkerLook(9, 0.2, null, 0.5, false, true, newSoakMarkerLook());
    expect(a.spin).toBe(b.spin);
    expect(a.time).toBe(SOAK_STILL_TIME);
    expect(b.time).toBe(SOAK_STILL_TIME);
    expect(a.bloom).toBe(1);
    expect(a.wisp).toBe(1);
  });

  it('the ready flare lights once every soaker stands inside', () => {
    expect(soakMarkerLook(1, 1, null, 0, true, false, newSoakMarkerLook()).flare).toBe(1);
    expect(soakMarkerLook(1, 1, null, 0, false, false, newSoakMarkerLook()).flare).toBe(0);
  });
});

describe('the soak marker shape (gather in, yard-true, tier-fair)', () => {
  it('the rings converge: born at the rim, they close on the middle, never past the rim', () => {
    const step = 0.05;
    for (let k = 0; k < SOAK_MARKER.ripples; k++) {
      for (let t = 0.02; t < 3; t += 0.37) {
        const now = soakRipple(t, k);
        const next = soakRipple(t + step, k);
        expect(now.r).toBeLessThanOrEqual(1);
        expect(now.r).toBeGreaterThanOrEqual(SOAK_MARKER.rippleTo - 1e-9);
        // Unless it wrapped back to the rim, it moved inward.
        if (next.r < now.r + 0.5) expect(next.r).toBeLessThan(now.r);
      }
    }
    // A ring is strongest soon after it leaves the rim and fades as it closes.
    const fresh = soakRipple(SOAK_MARKER.rippleEvery * SOAK_MARKER.ripples * 0.15, 0);
    const old = soakRipple(SOAK_MARKER.rippleEvery * SOAK_MARKER.ripples * 0.9, 0);
    expect(fresh.a).toBeGreaterThan(old.a);
  });

  it('no share-marker ring moves outside the rim: only the soft halo lies past it', () => {
    // The Round 02 rule: outward motion says keep out, so a share soak only
    // moves IN. The disc reaches a hair past the rim for the halo alone.
    expect(SOAK_MARKER.outer).toBeGreaterThan(1);
    expect(SOAK_MARKER.outer).toBeLessThanOrEqual(1.2);
    expect('emitEvery' in SOAK_MARKER).toBe(false);
    // Every ring it draws converges inside the rim, at every moment.
    for (let k = 0; k < SOAK_MARKER.ripples; k++)
      for (let t = 0; t < 6; t += 0.05) expect(soakRipple(t, k).r).toBeLessThanOrEqual(1);
    // The shader carries no outward-emitted ring (its uniform and loop are gone).
    const src = readFileSync(
      join(__dirname, '../src/render/floor_telegraph/soak_marker.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/uEmitEvery|rings it sends out/);
    // The disc's mesh stops at the halo's reach.
    const m = new SoakMarker(buildSoakMarkerGeometry(), [], 26);
    m.disc.geometry.computeBoundingSphere();
    expect(m.disc.geometry.boundingSphere?.radius).toBeLessThanOrEqual(1.2);
  });

  it('only the wisps thin on the low tier, never to none', () => {
    expect(soakWispCount(1)).toBe(SOAK_MARKER.wisps);
    expect(soakWispCount(0)).toBe(SOAK_MARKER.wispsLow);
    expect(soakWispCount(0)).toBeGreaterThan(0);
    expect(soakWispHeight(1)).toBe(SOAK_MARKER.wispMin);
    expect(soakWispHeight(100)).toBe(SOAK_MARKER.wispMax);
    expect(soakTimerLeft(null)).toBe(-1);
    expect(soakTimerLeft(0.25)).toBeCloseTo(0.75, 9);
  });

  it('the marker draws its disc at the sim radius, its pips and its arc', () => {
    const mats: THREE.Material[] = [];
    const m = new SoakMarker(buildSoakMarkerGeometry(), mats, 26);
    expect(mats.length).toBe(2);
    m.paint({
      x: 3,
      y: 1,
      z: -2,
      radius: 6,
      element: 'lightning',
      fill: 0.3,
      clock: 4,
      reduced: false,
      need: 3,
      have: 5,
      timer: 0.3,
      detail: 0,
    });
    expect(m.shown).toBe(true);
    expect(m.disc.scale.x).toBe(6);
    // The disc's unit radius is the rim; only the rim's soft halo
    // reaches past it, to SOAK_MARKER.outer.
    m.disc.geometry.computeBoundingSphere();
    expect(m.disc.geometry.boundingSphere?.radius).toBeCloseTo(SOAK_MARKER.outer, 6);
    expect(SOAK_MARKER.outer).toBeLessThanOrEqual(1.2);
    expect(m.group.position.toArray()).toEqual([3, 1, -2]);
    const u = m.discMat.uniforms;
    expect(u.uNeed.value).toBe(3);
    expect(u.uLit.value).toBe(3);
    expect(u.uTimer.value).toBeCloseTo(0.7, 9);
    expect(
      (u.uBody.value as THREE.Color).equals(new THREE.Color(SOAK_PALETTES.lightning.body)),
    ).toBe(true);
    // The low tier keeps a few wisps (the drawRange of the ribbon mesh).
    // The strands plus the axis's glow column (ribbon 0, always drawn).
    const perWisp = m.wisps.geometry.index!.count / (SOAK_MARKER.wisps + 1);
    expect(m.wisps.geometry.drawRange.count).toBe((SOAK_MARKER.wispsLow + 1) * perWisp);
    // Released: it decays, then hides on its own clock.
    m.release();
    expect(m.decaying).toBe(true);
    m.settle(4 + SOAK_MARKER.decay * 0.5);
    expect(m.shown).toBe(true);
    m.settle(4 + SOAK_MARKER.decay + 0.01);
    expect(m.shown).toBe(false);
  });

  it('the tell pool is the soak marker alone (no keep-out disc)', () => {
    const root = new THREE.Group();
    const mats: THREE.Material[] = [];
    const pool = new FloorTellPool(root, 1, [], mats);
    expect(mats.map((m) => m.name)).toEqual(['soakMarkerDisc', 'soakMarkerWisps']);
    pool.paint(0, {
      x: 0,
      y: 0,
      z: 0,
      radius: 5,
      element: 'fire',
      fill: 0,
      clock: 1,
      reduced: false,
      need: 2,
      have: 1,
    });
    expect(pool.uniformsOf(0)?.uNeed.value).toBe(2);
    expect(pool.uniformsOf(0)?.uLit.value).toBe(1);
  });
});

describe('the soak marker programs are prewarmed', () => {
  const names = (root: THREE.Object3D) => {
    const out = new Set<string>();
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && (m as THREE.ShaderMaterial).isShaderMaterial) out.add(m.name);
    });
    return out;
  };
  it("Varkhul's and Balgath's prewarm visuals carry both marker programs", () => {
    for (const root of [buildVarkhulEncounterPrewarmVisual(), buildBalgathRangedStandIn()]) {
      const n = names(root);
      expect(n.has('soakMarkerDisc')).toBe(true);
      expect(n.has('soakMarkerWisps')).toBe(true);
    }
  });
});

describe('the marker information is never faded or ghosted', () => {
  it('draws the rim and pips whole while held, drops them at once on release', () => {
    const m = new SoakMarker(buildSoakMarkerGeometry(), [], 26);
    const paint = {
      x: 0,
      y: 0,
      z: 0,
      radius: 5,
      element: 'fire' as const,
      fill: 0,
      clock: 1,
      reduced: false,
      need: 4,
      have: 4,
    };
    m.paint(paint);
    const u = m.discMat.uniforms;
    expect(u.uInfo.value).toBe(1);
    expect(u.uAlpha.value).toBeLessThan(1); // the body is still blooming in
    expect(u.uFlare.value).toBe(1); // ready: every soaker inside
    m.release();
    m.settle(1.1);
    expect(m.shown).toBe(true);
    expect(u.uInfo.value).toBe(0);
  });
});

describe("the Thunder's Cradle's want", () => {
  it('reads the claim difficulty, or the circles when the run view is missing', () => {
    expect(cradleNeedOf('normal', 1)).toBe(BREATH_DIFFICULTY.normal.cradleSoakers);
    expect(cradleNeedOf('heroic', 1)).toBe(BREATH_DIFFICULTY.heroic.cradleSoakers);
    expect(cradleNeedOf(null, 3)).toBe(BREATH_DIFFICULTY.heroic.cradleSoakers);
    expect(cradleNeedOf(undefined, 1)).toBe(BREATH_DIFFICULTY.normal.cradleSoakers);
    expect(cradleNeedOf('mythic', 1)).toBe(BREATH_DIFFICULTY.mythic.cradleSoakers);
  });

  it('counts a body for the nearest circle only, as the sim discharges it', () => {
    const circles = [
      { x: 0, z: 0 },
      { x: 8, z: 0 },
      { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
    ];
    const pts = [
      { x: 0, z: 0 }, // the lifted player over circle 0
      { x: 3, z: 0 }, // under both: nearer circle 0
      { x: 5, z: 0 }, // under both: nearer circle 1
      { x: 8, z: 6 }, // the rim of circle 1 (inclusive)
      { x: 30, z: 0 }, // under none
    ];
    const out: number[] = [];
    expect(cradleUnder(circles, 3, pts, pts.length, 6, out)).toEqual([2, 2, 0]);
    expect(cradleUnder(circles, 3, pts, 1, 6, out)).toEqual([1, 0, 0]);
  });
});
