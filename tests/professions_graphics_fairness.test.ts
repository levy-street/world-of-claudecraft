// The professions fairness guard (the UX pass): names, with teeth, which
// professions presentation is ACTIONABLE (must be graphics-preset-identical,
// per docs/design/graphics-settings-fairness.md) and which is COSMETIC (a
// preset may shed it).
//
// ACTIONABLE, preset-identical:
//   - The fishing bobber and its bite state (the reel window's one visual
//     affordance): fishing_bobber.ts and its core read neither the static
//     preset profile nor the FPS governor.
//   - The minimap's node markers (ready/cooldown, the lock strike): the
//     touch player's only node-spotting surface, so the marker build and
//     paint stay profile-free.
//   - The node props' TIER differentiation (nodeTierScale): tier is the
//     access gate's number, so the scale ladder is static content -> size,
//     identical everywhere.
//
// COSMETIC, and allowed to vary: the low preset's shorter fog (LOW_FOG in
// renderer.ts) sheds distant SCENERY, node props included, because the
// actionable spotting surface at range is the minimap above, which does not
// shorten; and the water surface's splash richness around a bite, because
// the bite itself is carried by the bobber state, the cue, and the log line.

import { readFileSync } from 'node:fs';
import type * as THREE from 'three';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildGatherNodes } from '../src/render/gather_nodes';
import { NODE_TIER_SCALE_STEP, nodeTierScale } from '../src/render/gather_nodes_lookup';
import { GATHER_NODES } from '../src/sim/data';
import { terrainHeight } from '../src/sim/world';

// Comments stripped before scanning (the architecture-test rule): prose that
// NAMES the invariant ("nothing here reads ui_effects_profile") must never
// trip the scan that enforces it.
const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// The two spellings a profile/governor read would arrive through. Import
// specifiers are enough: the per-file scan matches the architecture test's
// scope (a module reaching for the profile does it by importing it). The
// governor tokens name the REAL module and class (src/render/render_budget.ts
// RenderBudgetGovernor): the phase 14 QA found the original pair matched
// nothing in the repo, leaving the governor arm of this guard inert.
const PROFILE_TOKENS = ['ui_effects_profile', 'render_budget', 'RenderBudgetGovernor'];

function expectProfileFree(rel: string): void {
  const source = read(rel);
  for (const token of PROFILE_TOKENS) {
    expect(source.includes(token), `${rel} must not read ${token}`).toBe(false);
  }
}

describe('professions graphics fairness (actionable surfaces stay preset-identical)', () => {
  it('the fishing bobber (bite affordance) reads no profile and no governor', () => {
    expectProfileFree('src/render/fishing_bobber.ts');
    expectProfileFree('src/render/fishing_bobber_core.ts');
  });

  it('the minimap node markers (spotting + lock) read no profile and no governor', () => {
    expectProfileFree('src/ui/minimap_markers.ts');
    expectProfileFree('src/ui/minimap_painter.ts');
    // The node tooltip carries two actionable lines of its own (the respawn
    // countdown and the fine-grade preview), so it joins the scan (the
    // phase 14 QA).
    expectProfileFree('src/ui/gather_node_tooltip_controller.ts');
  });

  it('the node prop tier ladder is static and profile-free', () => {
    expectProfileFree('src/render/gather_nodes.ts');
    expectProfileFree('src/render/gather_nodes_lookup.ts');
    // The ladder itself, pinned to LITERALS (the phase 14 QA: recomputing
    // the source's own formula with the imported constant let any positive
    // step pass, including one too small to see). Shape, not self: 0.18 is
    // the shipped visual step; moving it is a deliberate retune that edits
    // this line with it.
    expect(NODE_TIER_SCALE_STEP).toBe(0.18);
    expect(nodeTierScale(0)).toBe(1);
    expect(nodeTierScale(1)).toBe(1);
    expect(nodeTierScale(2)).toBeCloseTo(1.18, 10);
    expect(nodeTierScale(3)).toBeCloseTo(1.36, 10);
  });

  it('the ladder is APPLIED: a built tier-2 prop is larger and still sits on the ground', () => {
    // The phase 14 QA: nodeTierScale was unit-pinned but deleting the
    // multiplyScalar in buildGatherNodes reddened nothing. Drive the real
    // build and compare two ore nodes of different tiers: the scale lands
    // in the instance matrix at the literal ladder values, and the
    // base-anchor compensation keeps each prop's bottom at the same height
    // above its terrain sample (a center-anchored upscale sank tier-3
    // props). The nodes are InstancedMesh batches after the v0.33.0
    // draw-call diet: resolve each node to (batch, instance index) through
    // the same userData.gatherNodeIds list the raycast resolver uses.
    const seed = 20260730;
    const { group } = buildGatherNodes(seed);
    const t1 = GATHER_NODES.find((n) => n.type === 'ore' && n.tier === 1);
    const t2 = GATHER_NODES.find((n) => n.type === 'ore' && n.tier === 2);
    expect(t1 && t2).toBeTruthy();
    if (!t1 || !t2) return;
    const instanceOf = (
      id: string,
    ): { position: THREE.Vector3; scale: THREE.Vector3; minY: number } => {
      for (const child of group.children) {
        const ids = child.userData.gatherNodeIds;
        if (!Array.isArray(ids)) continue;
        const index = ids.indexOf(id);
        if (index === -1) continue;
        const mesh = child as THREE.InstancedMesh;
        const matrix = new Matrix4();
        mesh.getMatrixAt(index, matrix);
        const position = new Vector3();
        const rotation = new Quaternion();
        const scale = new Vector3();
        matrix.decompose(position, rotation, scale);
        mesh.geometry.computeBoundingBox();
        return { position, scale, minY: mesh.geometry.boundingBox?.min.y ?? 0 };
      }
      throw new Error(`node ${id} not found in any instanced batch`);
    };
    const i1 = instanceOf(t1.id);
    const i2 = instanceOf(t2.id);
    // Instance matrices live in a Float32Array, so the read-back scale and
    // position carry float32 rounding: 6 decimal places is the float32
    // precision floor, still 5 orders of magnitude below the 0.18 step.
    expect(i1.scale.x).toBeCloseTo(1, 6);
    expect(i2.scale.x).toBeCloseTo(1.18, 6);
    const baseAboveTerrain = (
      inst: { position: THREE.Vector3; scale: THREE.Vector3; minY: number },
      node: { pos: { x: number; z: number } },
    ): number =>
      inst.position.y + inst.scale.y * inst.minY - terrainHeight(node.pos.x, node.pos.z, seed);
    // 3 decimal places: the float32 position error at world-coordinate
    // magnitudes reaches ~1e-5, while the center-anchored-sink bug this
    // guards produced a ~0.13 world-unit offset.
    expect(baseAboveTerrain(i2, t2)).toBeCloseTo(baseAboveTerrain(i1, t1), 3);
  });

  it('the cosmetic side is the one that varies: LOW_FOG exists and the bobber does not read it', () => {
    // The low preset's fog trade is real (the constant exists in the
    // renderer)...
    const renderer = read('src/render/renderer.ts');
    expect(renderer.includes('LOW_FOG')).toBe(true);
    // ...and it is scenery-only for professions because the actionable
    // surfaces above never import the renderer's fog state either.
    expect(read('src/render/fishing_bobber.ts').includes('LOW_FOG')).toBe(false);
    expect(read('src/ui/minimap_markers.ts').includes('LOW_FOG')).toBe(false);
  });
});
