import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyPointLightBudget,
  countDrawnPointLights,
  flickerContributingFireLights,
  pointLightPadCount,
  type RankedPointLight,
} from '../src/render/point_light_budget';

const RANGE_SQ = 100 * 100;

function rankedLight(x: number, z: number, base: number | null = 5): RankedPointLight {
  const light = new THREE.PointLight(0xffffff, base ?? 5, 10, 2);
  light.position.set(x, 0, z);
  return { light, d2: 0, worldPos: new THREE.Vector3(x, 0, z), base, dynamic: false };
}

function visibleCount(ranked: RankedPointLight[]): number {
  return ranked.filter((entry) => entry.light.visible).length;
}

describe('pointLightPadCount', () => {
  it('fills the whole budget when no real lights exist', () => {
    expect(pointLightPadCount(0, 6)).toBe(6);
  });

  it('tops up when fewer real lights than the budget exist', () => {
    expect(pointLightPadCount(4, 6)).toBe(2);
  });

  it('adds nothing once the budget is met or exceeded', () => {
    expect(pointLightPadCount(6, 6)).toBe(0);
    expect(pointLightPadCount(9, 6)).toBe(0);
  });
});

describe('applyPointLightBudget', () => {
  it('keeps exactly min(ranked, visibleCount) lights visible, pads pin the total', () => {
    for (const count of [0, 2, 6, 9]) {
      const ranked: RankedPointLight[] = [];
      for (let i = 0; i < count; i++) ranked.push(rankedLight(i * 2, 0));
      applyPointLightBudget(ranked, 0, 0, 6, 6, RANGE_SQ);
      expect(visibleCount(ranked)).toBe(Math.min(count, 6));
      expect(visibleCount(ranked) + pointLightPadCount(ranked.length, 6)).toBe(6);
    }
  });

  it('sorts by distance so the visible set is the nearest one', () => {
    const a = rankedLight(1, 0);
    const b = rankedLight(2, 0);
    const c = rankedLight(3, 0);
    const ranked = [c, b, a];
    applyPointLightBudget(ranked, 0, 0, 2, 2, RANGE_SQ);
    expect(a.light.visible).toBe(true);
    expect(b.light.visible).toBe(true);
    expect(c.light.visible).toBe(false);
  });

  it('keeps the prior full-rank order when discarded-tail lights later tie', () => {
    const a = rankedLight(4, 0);
    const b = rankedLight(1, 0);
    const c = rankedLight(3, 0);
    const d = rankedLight(2, 0);
    const ranked = [a, b, c, d];

    applyPointLightBudget(ranked, 0, 0, 2, 2, RANGE_SQ);
    expect(ranked.map((entry) => entry.light)).toEqual([b.light, d.light, c.light, a.light]);

    c.worldPos.set(1, 0, 0);
    a.worldPos.set(-1, 0, 0);
    b.worldPos.set(10, 0, 0);
    d.worldPos.set(11, 0, 0);
    applyPointLightBudget(ranked, 0, 0, 2, 1, RANGE_SQ);

    expect(ranked.slice(0, 2).map((entry) => entry.light)).toEqual([c.light, a.light]);
    expect(c.light.intensity).toBe(5);
    expect(a.light.intensity).toBe(0);
  });

  it('only lights inside the live budget and range shine', () => {
    const near = rankedLight(1, 0);
    const mid = rankedLight(5, 0);
    const far = rankedLight(500, 0);
    // Already sorted by distance, so this stays green regardless of the sort guard.
    const ranked = [near, mid, far];
    applyPointLightBudget(ranked, 0, 0, 6, 2, RANGE_SQ);
    expect(near.light.intensity).toBe(5);
    expect(mid.light.intensity).toBe(5);
    expect(far.light.intensity).toBe(0);
    expect(far.light.visible).toBe(true); // counted, but contributes nothing
  });

  it('sorts by distance when the live budget truncates fewer lights than visibleCount', () => {
    // liveBudget(2) < ranked.length(3) <= visibleCount(6): a sort guard keyed off
    // visibleCount alone would skip sorting here even though the live budget still
    // truncates the ranked list, so array order (not distance) would pick the
    // winners. All three lights sit inside range so only the live-budget cutoff
    // is under test.
    const near = rankedLight(1, 0);
    const mid = rankedLight(5, 0);
    const farInRange = rankedLight(50, 0);
    const ranked = [farInRange, near, mid]; // misordered: farthest listed first
    applyPointLightBudget(ranked, 0, 0, 6, 2, RANGE_SQ);
    expect(near.light.intensity).toBe(5);
    expect(mid.light.intensity).toBe(5);
    expect(farInRange.light.intensity).toBe(0);
  });

  it('leaves base-less (externally driven) light intensity alone while shining', () => {
    const driven = rankedLight(1, 0, null);
    driven.light.intensity = 7;
    applyPointLightBudget([driven], 0, 0, 6, 6, RANGE_SQ);
    expect(driven.light.intensity).toBe(7);
    const outOfRange = rankedLight(500, 0, null);
    outOfRange.light.intensity = 7;
    applyPointLightBudget([outOfRange], 0, 0, 6, 6, RANGE_SQ);
    expect(outOfRange.light.intensity).toBe(0);
  });

  it('flickers only fire lights that survive the live budget and range', () => {
    const near = rankedLight(1, 0, null);
    const overBudget = rankedLight(2, 0, null);
    const uncounted = rankedLight(3, 0, null);
    near.fireIndex = 4;
    overBudget.fireIndex = 5;
    uncounted.fireIndex = 6;
    near.light.userData.baseIntensity = 8;
    overBudget.light.intensity = 91;
    uncounted.light.intensity = 92;
    const ranked = [uncounted, overBudget, near];

    applyPointLightBudget(ranked, 0, 0, 2, 1, RANGE_SQ);
    flickerContributingFireLights(ranked, 0.75, 2, 1, RANGE_SQ);

    expect(near.light.intensity).toBe(8 + Math.sin(0.75 * 11 + 4 * 1.7) * 2.5 * (8 / 11));
    expect(overBudget.light.intensity).toBe(0);
    expect(uncounted.light.intensity).toBe(92);
  });

  it('does not flicker view lights or counted fire lights outside range', () => {
    const fire = rankedLight(1, 0, null);
    const view = rankedLight(2, 0, null);
    const outOfRange = rankedLight(500, 0, null);
    fire.fireIndex = 2;
    outOfRange.fireIndex = 3;
    view.light.intensity = 77;
    outOfRange.light.intensity = 78;
    const ranked = [fire, view, outOfRange];

    applyPointLightBudget(ranked, 0, 0, 6, 6, RANGE_SQ);
    flickerContributingFireLights(ranked, 0.5, 6, 6, RANGE_SQ);

    expect(fire.light.intensity).toBe(11 + Math.sin(0.5 * 11 + 2 * 1.7) * 2.5);
    expect(view.light.intensity).toBe(77);
    expect(outOfRange.light.intensity).toBe(0);
  });

  // The pin's blind spot (found via BENCH_LIGHT_AUDIT on the geared-arrival
  // bench): three's render counts a point light iff its WHOLE ancestor chain
  // is visible, but the budget only drove light.visible. A budget-chosen
  // light under a group the world hid (zone streaming, far-LOD wrap, a
  // compile gate) kept its counted slot while the render dropped it, so the
  // drawn numPointLights wandered 4..10 and every new value relinked every
  // lit material in view.
  describe('drawn-eligibility (hidden ancestors, detached lights)', () => {
    function inScene(scene: THREE.Object3D, entry: RankedPointLight, parent?: THREE.Object3D) {
      (parent ?? scene).add(entry.light);
      return entry;
    }

    it('a light under a hidden ancestor gives its slot to the next eligible light', () => {
      const scene = new THREE.Scene();
      const hiddenGroup = new THREE.Group();
      hiddenGroup.visible = false;
      scene.add(hiddenGroup);
      const near = inScene(scene, rankedLight(1, 0), hiddenGroup);
      const mid = inScene(scene, rankedLight(5, 0));
      const far = inScene(scene, rankedLight(9, 0));
      const ranked = [near, mid, far];

      const drawn = applyPointLightBudget(ranked, 0, 0, 2, 2, RANGE_SQ, scene);

      expect(drawn).toBe(2);
      expect(mid.light.visible).toBe(true);
      expect(far.light.visible).toBe(true);
      expect(near.light.visible).toBe(false);
    });

    it('a light not attached under the scene root is not drawn-eligible', () => {
      const scene = new THREE.Scene();
      const attached = inScene(scene, rankedLight(2, 0));
      const detached = rankedLight(1, 0); // never added to the scene
      const ranked = [detached, attached];

      const drawn = applyPointLightBudget(ranked, 0, 0, 2, 2, RANGE_SQ, scene);

      expect(drawn).toBe(1);
      expect(attached.light.visible).toBe(true);
      expect(detached.light.visible).toBe(false);
    });

    it('returns the drawn count so pads can pin the render-visible total', () => {
      const scene = new THREE.Scene();
      const hidden = new THREE.Group();
      hidden.visible = false;
      scene.add(hidden);
      const ranked = [
        inScene(scene, rankedLight(1, 0), hidden),
        inScene(scene, rankedLight(2, 0), hidden),
        inScene(scene, rankedLight(3, 0)),
      ];

      const drawn = applyPointLightBudget(ranked, 0, 0, 6, 6, RANGE_SQ, scene);

      // One eligible light drawn; pads must fill the remaining five so the
      // scene's traverseVisible point-light count stays exactly visibleCount.
      expect(drawn).toBe(1);
      expect(pointLightPadCount(drawn, 6)).toBe(5);
    });

    it('re-admits a light the frame its ancestor is revealed', () => {
      const scene = new THREE.Scene();
      const group = new THREE.Group();
      group.visible = false;
      scene.add(group);
      const gated = inScene(scene, rankedLight(1, 0), group);
      const other = inScene(scene, rankedLight(5, 0));
      const ranked = [gated, other];

      expect(applyPointLightBudget(ranked, 0, 0, 1, 1, RANGE_SQ, scene)).toBe(1);
      expect(other.light.visible).toBe(true);
      expect(gated.light.visible).toBe(false);

      group.visible = true;
      expect(applyPointLightBudget(ranked, 0, 0, 1, 1, RANGE_SQ, scene)).toBe(1);
      expect(gated.light.visible).toBe(true);
      expect(other.light.visible).toBe(false);
    });

    it('without a scene root every ranked light stays eligible (legacy shape)', () => {
      const ranked = [rankedLight(1, 0), rankedLight(2, 0)];
      const drawn = applyPointLightBudget(ranked, 0, 0, 6, 6, RANGE_SQ);
      expect(drawn).toBe(2);
      expect(visibleCount(ranked)).toBe(2);
    });
  });

  describe('countDrawnPointLights (the bounded prewarm mask)', () => {
    function addTo(parent: THREE.Object3D, entry: RankedPointLight): RankedPointLight {
      parent.add(entry.light);
      return entry;
    }

    it('re-derives the drawn count when a transient mask hides chosen ancestors', () => {
      // The zone-prewarm bounded render hides most top-level scene children
      // transiently, OUT OF BAND of the budget pass: view lights under those
      // children leave Three's counted set, NUM_POINT_LIGHTS drifts below the
      // pinned total, and the bounded render synchronously links a program
      // variant the live render never draws (measured: prewarm units with a
      // link cost ~119 ms on a 3090; units without, 0.3 ms).
      const scene = new THREE.Scene();
      const viewGroup = new THREE.Group();
      scene.add(viewGroup);
      const viewLight = addTo(viewGroup, rankedLight(1, 0));
      const rootLight = addTo(scene, rankedLight(2, 0));
      const ranked = [viewLight, rootLight];
      applyPointLightBudget(ranked, 0, 0, 6, 6, RANGE_SQ, scene);
      expect(countDrawnPointLights(ranked, scene)).toBe(2);

      // The bounded mask hides the view group; no budget pass runs in between.
      viewGroup.visible = false;
      const boundedDrawn = countDrawnPointLights(ranked, scene);
      expect(boundedDrawn).toBe(1);
      // The pad top-up restores the exact pinned total the compile lane
      // linked against, so the bounded render draws the same variant.
      expect(boundedDrawn + pointLightPadCount(boundedDrawn, 6)).toBe(6);
    });

    it('does not count a light the budget itself turned off', () => {
      const scene = new THREE.Scene();
      const near = addTo(scene, rankedLight(1, 0));
      const far = addTo(scene, rankedLight(9, 0));
      const ranked = [near, far];
      applyPointLightBudget(ranked, 0, 0, 1, 1, RANGE_SQ, scene);
      expect(far.light.visible).toBe(false);
      expect(countDrawnPointLights(ranked, scene)).toBe(1);
    });

    it('does not count a detached light', () => {
      const scene = new THREE.Scene();
      const attached = addTo(scene, rankedLight(1, 0));
      const detached = rankedLight(2, 0);
      attached.light.visible = true;
      detached.light.visible = true;
      expect(countDrawnPointLights([attached, detached], scene)).toBe(1);
    });
  });

  it('wires the bounded prewarm render to re-pin the pads in its masked state', () => {
    // The bounded render's visibility mask hides entity views (and their
    // lights) without a budget pass: it must recount drawn lights in ITS
    // state, pad up to the same pinned total the compile lane linked against
    // BEFORE rendering, and restore the live pad state afterwards. Dropping
    // any half silently reinstates the synchronous mid-unit program links.
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const methodStart = source.indexOf('private renderBoundedPrewarmRoot(');
    const methodEnd = source.indexOf('private renderPrewarmPass(', methodStart);
    expect(methodStart).toBeGreaterThan(-1);
    expect(methodEnd).toBeGreaterThan(methodStart);
    const method = source.slice(methodStart, methodEnd);
    expect(method).toContain('countDrawnPointLights(this.lightRank, this.scene)');
    expect(method).toContain('pointLightPadCount(');
    expect(method).toContain('GFX.maxPointLights');
    const sceneMaskIndex = method.indexOf('boundedPrewarmVisibility');
    // The recount must observe BOTH mask levels: the scene-level mask and the
    // group-level one (a recount between the two would still miss the drift).
    const groupMaskIndex = method.indexOf('entry === childRoot');
    const countIndex = method.indexOf('countDrawnPointLights');
    const padWriteIndex = method.indexOf('this.lightPads[i].visible = i < boundedPadCount');
    const renderIndex = method.indexOf('this.webgl.render(');
    const finallyIndex = method.indexOf('} finally {');
    const restoreIndex = method.indexOf('previousPadVisibility[');
    expect(sceneMaskIndex).toBeGreaterThan(-1);
    expect(groupMaskIndex).toBeGreaterThan(sceneMaskIndex);
    expect(countIndex).toBeGreaterThan(groupMaskIndex);
    // The pad WRITE must land between the recount and the render: pinned
    // separately because the count/pad substrings also appear in comments.
    expect(padWriteIndex).toBeGreaterThan(countIndex);
    expect(renderIndex).toBeGreaterThan(padWriteIndex);
    // The pad restore must live in the finally: restored only after the render
    // would leak raised pads into live frames on a throw.
    expect(finallyIndex).toBeGreaterThan(renderIndex);
    expect(restoreIndex).toBeGreaterThan(finallyIndex);
  });

  it('wires the drawn-count pin: scene root in, pads on the drawn count out', () => {
    // The whole-scene relink fix has two wiring halves that no unit case can
    // see: the renderer must pass its scene so ancestry is checked against the
    // real root, and the pads must fill against the DRAWN count, not the
    // chosen count. Dropping either silently reinstates the arrival freeze.
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const methodStart = source.indexOf('private budgetFireLights(');
    const methodEnd = source.indexOf('// light shafts fade', methodStart);
    // A renamed end marker must fail here, never silently widen the slice to
    // the rest of the file (which would let the pins match anywhere).
    expect(methodStart).toBeGreaterThan(-1);
    expect(methodEnd).toBeGreaterThan(methodStart);
    const method = source.slice(methodStart, methodEnd);

    expect(method).toContain('const drawnCount = applyPointLightBudget(');
    expect(method).toContain('this.scene,');
    expect(method).toContain('pointLightPadCount(drawnCount, visibleCount)');
    expect(method).not.toContain('pointLightPadCount(ranked.length');
  });

  it('wires contributor flicker after the renderer completes selection', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const methodStart = source.indexOf('private budgetFireLights(');
    const methodEnd = source.indexOf('// light shafts fade', methodStart);
    const method = source.slice(methodStart, methodEnd);
    const selection = method.indexOf('applyPointLightBudget(');
    const flickerGate = method.indexOf('if (flicker) {');
    const flickerCall = method.indexOf('flickerContributingFireLights(');

    expect(methodStart).toBeGreaterThan(-1);
    expect(methodEnd).toBeGreaterThan(methodStart);
    expect(selection).toBeGreaterThan(-1);
    expect(flickerGate).toBeGreaterThan(selection);
    expect(flickerCall).toBeGreaterThan(flickerGate);
    expect(source).toContain('this.budgetFireLights(p.pos.x, p.pos.z, true);');
  });
});
