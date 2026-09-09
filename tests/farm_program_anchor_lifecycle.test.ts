// The farm program anchors (farm_patches.ts, buildFarmProgramAnchors) keep one
// hidden mesh per distinct farm program alive so a plot/feast rebuild always
// links against an already-warm program. Two geometry-ownership arms feed
// those meshes and dispose() owes each a DIFFERENT promise:
//   - no GLB loaded yet -> glb_instanced_props.ts' primitive-box fallback
//     mints a fresh, class-OWNED BoxGeometry per anchor call. Never disposing
//     it leaks one BufferGeometry per FarmPatchVisuals built before its GLBs
//     landed (every offline/headless boot; main.ts awaits every deferred
//     preload before constructing the renderer, so a cold ONLINE arrival
//     never reaches this arm in practice).
//   - a GLB IS loaded -> the anchor wears the CACHE's own geometry (the same
//     object the instanced beds and every later template read still share;
//     see buildFarmProgramAnchors' header comment: "wearing the SOURCE
//     materials... on the real geometries"). Disposing THAT blacks out every
//     other live user of the shared GLB scene.
// dispose() today only detaches the anchors group (`scene.remove(this.anchors)`)
// and disposes nothing, so the fallback arm leaks. This suite pins both arms
// independently so a fix that disposes everything (including shared GLB
// geometry) is caught exactly as fast as a fix that disposes nothing.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFarmPatchProps,
  FARM_PROGRAM_ANCHORS_NAME,
  type FarmCompileGate,
  FarmPatchVisuals,
  farmPatchesPreloadInternalsForTest,
} from '../src/render/farm_patches';
import { farmStageModelUrl } from '../src/render/farm_patches_core';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';

const SEED = 1234;

function recordingVfx() {
  return {
    sink: {
      burst: () => {},
      groundPuff: () => {},
    },
  };
}

/** Resolves immediately: these tests only care what dispose() does to
 *  geometry, never about the gated-attach reveal timing. */
const immediateGate: FarmCompileGate = () => Promise.resolve();

function anchorGeometries(scene: THREE.Scene): THREE.BufferGeometry[] {
  const anchors = scene.children.find((c) => c.name === FARM_PROGRAM_ANCHORS_NAME);
  const geos: THREE.BufferGeometry[] = [];
  anchors?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) geos.push(mesh.geometry);
  });
  return geos;
}

describe('farm program anchor geometry lifecycle (dispose ownership)', () => {
  afterEach(() => farmPatchesPreloadInternalsForTest.clearLoaded());

  it('disposes its own compiled fallback anchor geometry exactly once on dispose()', () => {
    // No GLB loaded: every stage/feast slot resolves through the primitive-box
    // fallback and dedupes to exactly one anchor mesh (pinned by the adjoining
    // adapter suite's "defers the program anchors..." case), so there is
    // exactly one class-owned fallback geometry to account for.
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink, immediateGate);
    visuals.stageProgramAnchors();

    const geos = anchorGeometries(scene);
    expect(geos).toHaveLength(1);
    const disposeSpy = vi.spyOn(geos[0], 'dispose');

    visuals.dispose();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('never disposes a loaded GLB anchor mesh geometry (shared with the asset cache)', () => {
    const wheatStage = new THREE.Group();
    const wheatMat = new THREE.MeshStandardMaterial({ name: 'wheat' });
    const wheatGeo = new THREE.BoxGeometry(1, 1, 1);
    wheatStage.add(new THREE.Mesh(wheatGeo, wheatMat));
    farmPatchesPreloadInternalsForTest.setLoaded(farmStageModelUrl('grain', 'stage2'), wheatStage);
    farmPatchesPreloadInternalsForTest.setLoaded(farmStageModelUrl('grain', 'stage3'), wheatStage);

    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink, immediateGate);
    visuals.stageProgramAnchors();

    const geos = anchorGeometries(scene);
    expect(geos).toContain(wheatGeo);
    const disposeSpy = vi.spyOn(wheatGeo, 'dispose');

    visuals.dispose();

    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('does not dispose the owned fallback geometry twice on a repeated dispose()', () => {
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink, immediateGate);
    visuals.stageProgramAnchors();

    const geos = anchorGeometries(scene);
    expect(geos).toHaveLength(1);
    const disposeSpy = vi.spyOn(geos[0], 'dispose');

    visuals.dispose();
    visuals.dispose();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('disposes the owned fallback geometry even when stageProgramAnchors() was never called', () => {
    // The anchors (and their owned fallback geometries) are built at
    // construction, before staging attaches them to the scene: a caller that
    // constructs a FarmPatchVisuals and tears it down without ever staging
    // (an early unmount, a failed world entry) must not leak the fallback
    // geometry either.
    const disposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(SEED, FARM_PATCHES);
    const visuals = new FarmPatchVisuals(scene, seats, recordingVfx().sink, immediateGate);

    visuals.dispose();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });
});
