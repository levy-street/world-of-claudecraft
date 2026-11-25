import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import {
  ASCENSION_ENTRANCE,
  ASCENSION_EXIT,
  ASCENSION_SPEND_PULSE,
  ascensionRemovalOrder,
  buildPaladinAscensionStandIn,
  PaladinAscensionVisual,
  syncPaladinAscensionVisual,
} from '../src/render/paladin_ascension_visual';
import { PALADIN_BODY_FIT } from '../src/render/paladin_body_fit';
import { syncRiderAnchor } from '../src/render/rider_anchor';

const ACTIVE_PLAN = { active: true, charges: 5, lastCharge: false };
const INACTIVE_PLAN = { active: false, charges: 0, lastCharge: false };

type Shaded = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

function requiredObject(visual: PaladinAscensionVisual, name: string): Shaded {
  const object = visual.group.getObjectByName(name) ?? visual.crown.getObjectByName(name);
  if (!object) throw new Error(`missing ${name}`);
  return object as Shaded;
}

// Node tests run at the Medium preset; the tests below pin the authored
// composition (full detail) unless a test names another tier.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('PaladinAscensionVisual', () => {
  it('is a pillar of light, a ground rune circle, a sun halo and rising motes', () => {
    const visual = new PaladinAscensionVisual(1.8);
    visual.update(ACTIVE_PLAN, 0, false);

    expect(visual.group.visible).toBe(true);
    expect(visual.crown.visible).toBe(true);
    // Split across two parents: the column and the circle stay on the view
    // group (the ground), the halo, motes and wings ride the rider anchor (the
    // saddle).
    expect(visual.group.children.map((child) => child.name).sort()).toEqual([
      'paladin-ascension-ground-seal',
      'paladin-ascension-pillar',
    ]);
    expect(visual.crown.children.map((child) => child.name).sort()).toEqual([
      'paladin-ascension-halo',
      'paladin-ascension-motes',
      'paladin-avenging-wrath',
    ]);
    const halo = requiredObject(visual, 'paladin-ascension-halo');
    expect(halo.position.y).toBeGreaterThan(1.1);
    expect(requiredObject(visual, 'paladin-ascension-pillar').scale.y).toBeGreaterThan(20);
    expect(requiredObject(visual, 'paladin-ascension-ground-seal').scale.x).toBeGreaterThan(3);
    for (const removed of ['paladin-ascension-solar-crown', 'paladin-ascension-activation-sweep']) {
      expect(visual.group.getObjectByName(removed)).toBeUndefined();
      expect(visual.crown.getObjectByName(removed)).toBeUndefined();
    }
    visual.dispose();
  });

  it('spreads the Avenging Wrath wings, adding a lower pair when Avenging Wrath has them too', () => {
    const visual = new PaladinAscensionVisual(1.8);
    visual.update(ACTIVE_PLAN, 0, false);
    visual.update(ACTIVE_PLAN, 1, false);
    const wings = visual.crown.getObjectByName('paladin-avenging-wrath');
    if (!wings) throw new Error('missing wings');
    const feathers = wings.getObjectByName('paladin-avenging-wrath-right-feathers') as THREE.Mesh;
    const open = (feathers.material as THREE.ShaderMaterial).uniforms.uOpen;
    expect(wings.getObjectByName('paladin-avenging-wrath-left-wing')?.visible).toBe(true);
    expect(wings.getObjectByName('paladin-avenging-wrath-right-wing')?.visible).toBe(true);
    const shoulders = wings.position.y;
    expect(shoulders).toBeCloseTo(1.8 * PALADIN_BODY_FIT.wingRoot, 6);
    expect(open.value).toBeGreaterThan(0.9);

    // Avenging Wrath takes the shoulders: the extra pair is at once below,
    // unfurling from closed rather than sliding down.
    visual.update({ ...ACTIVE_PLAN, wrathWings: true }, 1 / 60, false);
    expect(shoulders - wings.position.y).toBeCloseTo(1.8 * PALADIN_BODY_FIT.lowerWingDrop, 6);
    expect(open.value).toBeLessThan(0.1);
    const right = wings.getObjectByName('paladin-avenging-wrath-right-wing') as THREE.Object3D;
    expect(right.rotation.z).toBeLessThan(-0.6);
    visual.update({ ...ACTIVE_PLAN, wrathWings: true }, 1, false);
    expect(open.value).toBeGreaterThan(0.9);

    // Avenging Wrath ends: no slide back up. The lower pair furls away where it
    // is while a pair stands spread at the shoulders in place of Avenging Wrath's.
    visual.update(ACTIVE_PLAN, 1 / 60, false);
    const pairs = () =>
      visual.crown.children.filter((child) => child.name === 'paladin-avenging-wrath');
    expect(pairs()).toHaveLength(2);
    const upper = pairs().find((pair) => pair !== wings);
    if (!upper) throw new Error('missing shoulder pair');
    // Exactly where they were: nothing bobs them.
    expect(upper.position.y).toBeCloseTo(shoulders, 6);
    const upperFeathers = upper.getObjectByName(
      'paladin-avenging-wrath-right-feathers',
    ) as THREE.Mesh;
    expect((upperFeathers.material as THREE.ShaderMaterial).uniforms.uOpen.value).toBeGreaterThan(
      0.9,
    );
    expect(shoulders - wings.position.y).toBeCloseTo(1.8 * PALADIN_BODY_FIT.lowerWingDrop, 6);
    visual.update(ACTIVE_PLAN, 0.25, false);
    expect(open.value).toBeLessThan(0.7);
    visual.update(ACTIVE_PLAN, 0.4, false);
    expect(pairs()).toEqual([upper]);

    // Ascension ending: its wings furl away rather than vanishing.
    visual.update(INACTIVE_PLAN, 1 / 60, false);
    expect(pairs()).toEqual([upper]);
    visual.update(INACTIVE_PLAN, 0.2, false);
    expect((upperFeathers.material as THREE.ShaderMaterial).uniforms.uOpen.value).toBeLessThan(0.9);
    visual.update(INACTIVE_PLAN, ASCENSION_EXIT, false);
    expect(pairs()).toHaveLength(0);
    visual.dispose();
  });

  it('crashes the pillar down on ascending, then lets it fade while the halo stays', () => {
    const visual = new PaladinAscensionVisual(1.8);
    const pillar = requiredObject(visual, 'paladin-ascension-pillar');
    const halo = requiredObject(visual, 'paladin-ascension-halo');
    visual.update(ACTIVE_PLAN, 0, false);
    expect(pillar.material.uniforms.uDrop.value).toBe(0);
    visual.update(ACTIVE_PLAN, 0.3, false);
    expect(pillar.material.uniforms.uDrop.value).toBe(1);
    expect(pillar.visible).toBe(true);
    visual.update(ACTIVE_PLAN, ASCENSION_ENTRANCE, false);
    expect(pillar.visible).toBe(false);
    expect(halo.material.uniforms.uAlpha.value).toBe(1);

    // Ascending again brings the column down afresh.
    visual.update(INACTIVE_PLAN, ASCENSION_EXIT + 0.1, false);
    visual.update(ACTIVE_PLAN, 0.05, false);
    expect(pillar.material.uniforms.uDrop.value).toBeLessThan(1);
    visual.dispose();
  });

  it('puts the orbs out from the outside in, the centre orb shining last', () => {
    expect(ascensionRemovalOrder(5)).toEqual([4, 0, 3, 1, 2]);
    expect(ascensionRemovalOrder(7)).toEqual([6, 0, 5, 1, 4, 2, 3]);
    expect(ascensionRemovalOrder(6)).toEqual([5, 0, 4, 1, 3, 2]);

    const visual = new PaladinAscensionVisual(1.8);
    const uniforms = requiredObject(visual, 'paladin-ascension-halo').material.uniforms;
    const orbs = uniforms.uOrb.value as number[];
    const pops = uniforms.uPop.value as number[];
    visual.update(ACTIVE_PLAN, 0, false);
    expect(uniforms.uSlots.value).toBe(5);
    // The orbs kindle from the centre outwards as the halo forms.
    visual.update(ACTIVE_PLAN, 0.45, false);
    expect(orbs[2]).toBeGreaterThan(0);
    expect(orbs[0]).toBe(0);
    visual.update(ACTIVE_PLAN, 1, false);
    expect(orbs.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);

    visual.update({ active: true, charges: 4, lastCharge: false }, 0.05, false);
    expect(pops[4]).toBeLessThan(0.1);
    expect(pops[0]).toBeGreaterThan(10);
    visual.update({ active: true, charges: 3, lastCharge: false }, 1, false);
    expect(orbs.slice(0, 5)).toEqual([0, 1, 1, 1, 0]);
    expect(uniforms.uUrgent.value).toBe(0);
    visual.update({ active: true, charges: 1, lastCharge: true }, 1, false);
    expect(orbs.slice(0, 5)).toEqual([0, 0, 1, 0, 0]);
    expect(uniforms.uUrgent.value).toBe(1);
    visual.dispose();
  });

  it('plays the same charge-spent cue for every charge, the last one included', () => {
    const visual = new PaladinAscensionVisual(1.8);
    const ground = requiredObject(visual, 'paladin-ascension-ground-seal').material.uniforms;
    const halo = requiredObject(visual, 'paladin-ascension-halo').material.uniforms;
    visual.update(ACTIVE_PLAN, 0, false);
    visual.update(ACTIVE_PLAN, 1, false);
    expect(ground.uSpent.value).toBeGreaterThan(ASCENSION_SPEND_PULSE);
    // A charge spent: its orb bursts, its mark flares, the pulse runs out.
    visual.update({ active: true, charges: 4, lastCharge: false }, 0.05, false);
    expect((halo.uPop.value as number[])[4]).toBeLessThan(0.1);
    expect((ground.uPop.value as number[])[4]).toBeLessThan(0.1);
    expect(ground.uSpent.value).toBeLessThan(0.1);
    visual.update({ active: true, charges: 4, lastCharge: false }, ASCENSION_SPEND_PULSE, false);
    expect(ground.uSpent.value).toBeGreaterThan(ASCENSION_SPEND_PULSE);
    // The last charge ends Ascension: its orb still bursts as the halo fades.
    visual.update({ active: true, charges: 1, lastCharge: true }, 1, false);
    visual.update(INACTIVE_PLAN, 0.05, false);
    expect((halo.uPop.value as number[])[2]).toBeLessThan(0.1);
    expect(ground.uSpent.value).toBeLessThan(0.1);
    expect(halo.uAlpha.value).toBeGreaterThan(0);
    visual.dispose();
  });

  it("goes with the Paladin when Valkyr's Calling carries them out of sight", () => {
    const visual = new PaladinAscensionVisual(1.8);
    const halo = requiredObject(visual, 'paladin-ascension-halo');
    const ground = requiredObject(visual, 'paladin-ascension-ground-seal');
    const flying = { ...ACTIVE_PLAN, wrathWings: true };
    visual.update(flying, 0, false);
    visual.update(flying, 1, false);
    const wing = () => visual.crown.getObjectByName('paladin-avenging-wrath-left-wing');
    expect(wing()?.visible).toBe(true);
    expect(halo.material.uniforms.uAlpha.value).toBe(1);
    // Vanished: the halo, circle and wings burn out with the body.
    visual.update({ ...flying, vanished: true }, 0.2, false);
    expect(halo.visible).toBe(false);
    expect(ground.visible).toBe(false);
    expect(halo.material.uniforms.uAlpha.value).toBe(0);
    expect(wing()?.visible).toBe(false);
    // Back over the landing: all of it returns.
    visual.update(flying, 0.2, false);
    expect(halo.visible).toBe(true);
    expect(halo.material.uniforms.uAlpha.value).toBe(1);
    expect(wing()?.visible).toBe(true);
    visual.dispose();
  });

  it('fades out when Ascension ends rather than vanishing', () => {
    const visual = new PaladinAscensionVisual(1.8);
    const halo = requiredObject(visual, 'paladin-ascension-halo');
    visual.update(ACTIVE_PLAN, 2, false);
    visual.update(INACTIVE_PLAN, ASCENSION_EXIT / 2, false);
    expect(visual.group.visible).toBe(true);
    expect(halo.material.uniforms.uAlpha.value).toBeCloseTo(0.5);
    visual.update(INACTIVE_PLAN, ASCENSION_EXIT, false);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
  });

  // Ascension keeps the Paladin planted: it never writes the rider root, so the
  // renderer's rider placement (placeRider, the mount attitude pass) is the only
  // writer of that height, on foot or in the saddle. The regression these pin is
  // "the riding pose is broken, mostly on paladins": a visual that wrote the rig
  // root pinned a paladin to the height their first Ascension caught them at.
  // Each frame runs the renderer's order: place the rider, carry the rider
  // anchor to it, then sync the visual. A frame is a whole second.
  const SEAT = 1.15;
  type Rig = { view: THREE.Group; root: THREE.Group; anchor: THREE.Group };
  function rig(): Rig {
    const view = new THREE.Group();
    const root = new THREE.Group();
    const anchor = new THREE.Group();
    view.add(root, anchor);
    return { view, root, anchor };
  }
  function frame(
    visual: PaladinAscensionVisual | null,
    { view, root, anchor }: Rig,
    placedY: number,
    plan: typeof ACTIVE_PLAN,
    reducedMotion = true,
  ): PaladinAscensionVisual | null {
    root.position.set(0, placedY, 0);
    syncRiderAnchor(anchor, root);
    const next = syncPaladinAscensionVisual(visual, view, anchor, 1.8, plan, 1, reducedMotion);
    expect(root.position.toArray()).toEqual([0, placedY, 0]);
    return next;
  }
  function haloWorldY(visual: PaladinAscensionVisual, view: THREE.Group): number {
    view.updateMatrixWorld(true);
    return requiredObject(visual, 'paladin-ascension-halo').getWorldPosition(new THREE.Vector3()).y;
  }

  it('never lifts the character: the Paladin stays on the ground while ascended', () => {
    for (const reducedMotion of [true, false]) {
      const r = rig();
      let visual = frame(null, r, 0, ACTIVE_PLAN, reducedMotion);
      for (let i = 0; i < 4; i++) visual = frame(visual, r, 0, ACTIVE_PLAN, reducedMotion);
      if (!visual) throw new Error('visual not built');
      expect(haloWorldY(visual, r.view)).toBeCloseTo(1.8 * 0.9, 6);
      const wings = visual.crown.getObjectByName('paladin-avenging-wrath');
      expect(wings?.position.y).toBeCloseTo(1.8 * PALADIN_BODY_FIT.wingRoot, 6);
      visual = frame(visual, r, 0, INACTIVE_PLAN, reducedMotion);
      visual?.dispose();
    }
  });

  it('lets a paladin who ascended on foot sit the saddle of a later mount', () => {
    const r = rig();
    let visual = frame(null, r, 0, ACTIVE_PLAN);
    visual = frame(visual, r, 0, ACTIVE_PLAN);
    visual = frame(visual, r, 0, INACTIVE_PLAN);
    // Mounts up after the Ascension ended: the seat is the mount pass's alone.
    visual = frame(visual, r, SEAT, INACTIVE_PLAN);
    visual = frame(visual, r, SEAT, INACTIVE_PLAN);
    // Ascends again in the saddle: the halo rides the seat, the rider stays put.
    visual = frame(visual, r, SEAT, ACTIVE_PLAN);
    visual = frame(visual, r, SEAT, ACTIVE_PLAN);
    if (!visual) throw new Error('visual not built');
    expect(haloWorldY(visual, r.view)).toBeCloseTo(SEAT + 1.8 * 0.9);
    visual.dispose();
  });

  it('mounts and dismounts mid-Ascension with the rider exactly where the mount put them', () => {
    const r = rig();
    let visual = frame(null, r, 0, ACTIVE_PLAN);
    visual = frame(visual, r, 0, ACTIVE_PLAN);
    // Mounts while ascended, then dismounts while still ascended.
    visual = frame(visual, r, SEAT, ACTIVE_PLAN);
    if (!visual) throw new Error('visual not built');
    expect(haloWorldY(visual, r.view)).toBeCloseTo(SEAT + 1.8 * 0.9);
    visual = frame(visual, r, 0, ACTIVE_PLAN);
    if (!visual) throw new Error('visual not built');
    expect(haloWorldY(visual, r.view)).toBeCloseTo(1.8 * 0.9);
    visual = frame(visual, r, 0, INACTIVE_PLAN);
    visual?.dispose();
  });

  it('follows a seat that moves every frame (the bob, a seat bone) without adding to it', () => {
    const r = rig();
    let visual = frame(null, r, SEAT, ACTIVE_PLAN, false);
    for (const y of [SEAT, SEAT + 0.03, SEAT - 0.02, SEAT + 0.01]) {
      visual = frame(visual, r, y, ACTIVE_PLAN, false);
      if (!visual) throw new Error('visual not built');
      expect(haloWorldY(visual, r.view)).toBeCloseTo(y + 1.8 * 0.9);
    }
    visual?.dispose();
  });

  it('never moves the rig root on dispose', () => {
    const r = rig();
    let visual = frame(null, r, 0, ACTIVE_PLAN);
    visual = frame(visual, r, 0, ACTIVE_PLAN);
    r.root.position.y = SEAT;
    visual?.dispose();
    expect(r.root.position.y).toBe(SEAT);
  });

  it('takes no rig root to move: handed one the way the renderer once did, it stays put', () => {
    // The hover used to arrive as a trailing defaulted rig-root argument, which
    // Function.length cannot see, so this hands the root over the same way and
    // checks the visual leaves it where the mount pass put it.
    const sync = syncPaladinAscensionVisual as (
      ...args: unknown[]
    ) => PaladinAscensionVisual | null;
    for (const reducedMotion of [true, false]) {
      for (const placedY of [0, SEAT]) {
        const { view, root, anchor } = rig();
        let visual: PaladinAscensionVisual | null = null;
        for (const plan of [ACTIVE_PLAN, ACTIVE_PLAN, ACTIVE_PLAN, INACTIVE_PLAN]) {
          root.position.set(0, placedY, 0);
          syncRiderAnchor(anchor, root);
          visual = sync(visual, view, anchor, 1.8, plan, 0.5, reducedMotion, root);
          expect(root.position.toArray()).toEqual([0, placedY, 0]);
        }
        visual?.dispose();
      }
    }
    const source = readFileSync(
      new URL('../src/render/paladin_ascension_visual.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/hoverTarget/);
  });

  it('seats the halo, motes and wings on the rider anchor and the circle on the view group', () => {
    const group = new THREE.Group();
    group.position.set(2, 10, 3);
    const riderAnchor = new THREE.Group();
    riderAnchor.position.y = 1.15; // the saddle lift
    group.add(riderAnchor);
    const visual = syncPaladinAscensionVisual(null, group, riderAnchor, 1.8, ACTIVE_PLAN, 0, true);
    if (!visual) throw new Error('visual not built');
    expect(visual.group.parent).toBe(group);
    expect(visual.crown.parent).toBe(riderAnchor);
    group.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    // The halo sits behind the seated head.
    requiredObject(visual, 'paladin-ascension-halo').getWorldPosition(world);
    expect(world.y).toBeCloseTo(10 + 1.15 + 1.8 * 0.9, 5);
    requiredObject(visual, 'paladin-ascension-ground-seal').getWorldPosition(world);
    expect(world.y).toBeCloseTo(10 + 0.055, 5);
    requiredObject(visual, 'paladin-ascension-pillar').getWorldPosition(world);
    expect(world.y).toBeGreaterThan(10);
    expect(visual.crown.getObjectByName('paladin-avenging-wrath')).toBeDefined();
    visual.dispose();
    expect(visual.group.parent).toBeNull();
    expect(visual.crown.parent).toBeNull();
  });

  it('stages every piece a live Ascension draws in its hidden boot stand-in', () => {
    const standIn = buildPaladinAscensionStandIn();
    expect(buildPaladinAscensionStandIn()).toBe(standIn);
    for (const name of [
      'paladin-ascension-pillar',
      'paladin-ascension-ground-seal',
      'paladin-ascension-halo',
      'paladin-ascension-motes',
      'paladin-avenging-wrath',
    ]) {
      expect(standIn.root.getObjectByName(name), name).toBeDefined();
    }
    const live = new PaladinAscensionVisual(1.8);
    live.update(ACTIVE_PLAN, 0, false);
    const programs = (root: THREE.Object3D) => {
      const shaders = new Set<string>();
      root.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (material?.fragmentShader) shaders.add(material.fragmentShader);
      });
      return shaders;
    };
    const staged = programs(standIn.root);
    for (const shader of [...programs(live.group), ...programs(live.crown)]) {
      expect(staged.has(shader)).toBe(true);
    }
    live.dispose();
  });

  it('wires the visual to the view group and the rider anchor, never the character rig', () => {
    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );
    expect(rendererSource).toMatch(
      /syncPaladinAscensionVisual\(\s*v\.paladinAscensionVisual,\s*v\.group,\s*v\.riderAnchor,[\s\S]*?this\.reducedMotion\(\),\s*\)/,
    );
  });

  it('syncs after both rider placements and the anchor carry, so the halo rides the seat', () => {
    // The halo, motes and wings sit on the rider anchor, which copies the rider
    // root once both writers of the rider height have run (placeRider, and the
    // mount attitude pass inside updateMountPresentation). Synced before them,
    // the crown would ride one frame behind the saddle.
    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );
    const sync = rendererSource.search(/syncPaladinAscensionVisual\(\s*v\.paladinAscensionVisual/);
    const place = rendererSource.indexOf('placeRider(v, v.visual.root,');
    const mount = rendererSource.indexOf('updateMountPresentation(v, {');
    expect(place).toBeGreaterThan(0);
    expect(mount).toBeGreaterThan(0);
    expect(sync).toBeGreaterThan(Math.max(place, mount));
    const anchor = rendererSource.indexOf('syncRiderAnchor(v.riderAnchor, v.visual.root);');
    expect(anchor).toBeGreaterThan(Math.max(place, mount));
    expect(sync).toBeGreaterThan(anchor);
  });

  it('draws a lighter Ascension on lighter tiers: the halo, circle and wing silhouette kept', () => {
    const drawn = (detail: 'full' | 'light' | 'minimal') => {
      setPaladinVfxDetailForTest(detail);
      const visual = new PaladinAscensionVisual(1.8);
      visual.update(ACTIVE_PLAN, 0, false);
      visual.update(ACTIVE_PLAN, 0.1, false);
      const motes = requiredObject(visual, 'paladin-ascension-motes');
      const halo = requiredObject(visual, 'paladin-ascension-halo');
      const feathers = visual.crown.getObjectByName(
        'paladin-avenging-wrath-left-feathers',
      ) as THREE.Mesh;
      const wingVertices = feathers.geometry.index?.count ?? feathers.geometry.drawRange.count;
      const out = {
        pillar: requiredObject(visual, 'paladin-ascension-pillar').visible,
        motes: Math.min(motes.geometry.drawRange.count, 28),
        bloom: (halo.material.uniforms.uFlash.value as number) > 0,
        core:
          halo.visible &&
          requiredObject(visual, 'paladin-ascension-ground-seal').visible &&
          feathers.parent?.visible === true,
        wingQuads: Math.min(wingVertices, 57 * 6) / 6,
      };
      visual.dispose();
      return out;
    };
    const full = drawn('full'),
      light = drawn('light'),
      minimal = drawn('minimal');
    expect(full).toEqual({ pillar: true, motes: 28, bloom: true, core: true, wingQuads: 57 });
    // Light keeps the column and the coverts, halves the motes, drops the bloom.
    expect(light).toEqual({ pillar: true, motes: 14, bloom: false, core: true, wingQuads: 50 });
    // Minimal: the halo, the circle and the wing silhouette (primaries and
    // secondaries) with a few motes; no column, no coverts.
    expect(minimal).toEqual({ pillar: false, motes: 8, bloom: false, core: true, wingQuads: 23 });
  });

  it('keeps the detail an Ascension began with and shortens its exit fade on lighter tiers', () => {
    setPaladinVfxDetailForTest('minimal');
    const visual = new PaladinAscensionVisual(1.8);
    visual.update(ACTIVE_PLAN, 0, false);
    setPaladinVfxDetailForTest('full');
    visual.update(ACTIVE_PLAN, ASCENSION_ENTRANCE, false);
    expect(requiredObject(visual, 'paladin-ascension-motes').geometry.drawRange.count).toBe(8);
    visual.update(INACTIVE_PLAN, 0, false);
    // Minimal's exit is 0.45 of the authored fade.
    visual.update(INACTIVE_PLAN, ASCENSION_EXIT * 0.5, false);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
  });
});
