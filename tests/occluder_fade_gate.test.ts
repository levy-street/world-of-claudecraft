// The occluder-fade gate (src/render/occluder_fade_gate.ts): the hold between
// a structure blocking the camera and its materials drawing transparent. These
// cases pin the contract end to end: no gate means the historical immediate
// flip; an installed gate mints ONE twin per program, compiles it through the
// reveal host at the consult's priority, holds the structure OPAQUE while the
// link is in flight (its alpha still stepping), and flips it the frame the
// settle lands; the instanced-ghost pool goes through the same gate with the
// live stand-in recipe; a prefetch is imminent only under an arrival curtain.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetArrivalCoverForTest, setArrivalCover } from '../src/render/arrival_cover';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { addRimGlow } from '../src/render/gfx';
import { gpuPrepEventsSnapshot } from '../src/render/gpu_prep_events';
import {
  createInstancedGhostMaterial,
  InstancedOccluderGhosts,
  instancedGhostKey,
  instancedGhostTwin,
} from '../src/render/instanced_occluder_ghosts';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';
import {
  advanceOccluderFade,
  applyOccluderFade,
  occluderFadeApplied,
  occluderFadeMat,
  occluderFadeReady,
  occluderFadeRecordFor,
  prefetchOccluderFade,
  prefetchOccluderFadeWithin,
  stageOccluderFadeOnce,
} from '../src/render/occluder_fade';
import { OCCLUDER_FADE_ALPHA, OCCLUDER_FADE_PREFETCH_YD } from '../src/render/occluder_fade_core';
import {
  buildOccluderFadeTwin,
  installOccluderFadeGate,
  occluderFadeEscalatedCount,
  occluderFadeGateInstalled,
  occluderFadeTwinCount,
  occluderFadeTwinReady,
  resetOccluderFadeGateForTest,
  uninstallOccluderFadeGate,
} from '../src/render/occluder_fade_gate';
import {
  isOccluderGhostMaterial,
  isOccluderGhostTwin,
  occluderGhostTargetOf,
  occluderGhostVariantKey,
} from '../src/render/occluder_ghost_variant_key';

const ROOT = new URL('../', import.meta.url);
/** Source with its line comments stripped, so a commented-out line cannot
 *  satisfy a pin. */
const read = (path: string): string =>
  readFileSync(new URL(path, ROOT), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const FRAME = 1 / 60;

interface Compile {
  root: THREE.Object3D;
  imminent: boolean;
  priority: number | undefined;
  resolve: () => void;
}

/** A reveal compile host whose links settle only when the test says so. */
function fakeHost() {
  const compiles: Compile[] = [];
  const host = {
    compile: (root: object, imminent: boolean, priority?: number) =>
      new Promise<void>((resolve) => {
        compiles.push({ root: root as THREE.Object3D, imminent, priority, resolve });
      }),
    schedule: () => () => undefined,
  };
  return { host, compiles };
}

function structure(name = 'wall'): {
  mesh: THREE.Mesh;
  record: ReturnType<typeof occluderFadeMat>;
} {
  const material = new THREE.MeshStandardMaterial({ name, opacity: 0.75 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  return { mesh, record: occluderFadeMat(material, mesh) };
}

beforeEach(() => {
  resetOccluderFadeGateForTest();
  resetArrivalCoverForTest();
});

afterEach(() => {
  resetOccluderFadeGateForTest();
  resetArrivalCoverForTest();
});

describe('without an installed gate', () => {
  it('every consult is ready and no twin is minted (the historical immediate flip)', () => {
    expect(occluderFadeGateInstalled()).toBe(false);
    let minted = 0;
    expect(
      occluderFadeTwinReady(
        'k',
        'edge',
        () => {
          minted++;
          return new THREE.Object3D();
        },
        undefined,
      ),
    ).toBe(true);
    expect(minted).toBe(0);
    expect(occluderFadeTwinCount()).toBe(0);
    const { record } = structure();
    const alpha = advanceOccluderFade([record], 1, true, FRAME);
    expect(alpha).toBe(OCCLUDER_FADE_ALPHA);
    expect(record.mat.transparent).toBe(true);
  });
});

describe('the gate registry', () => {
  it('mints one twin per key, compiles it once at the consult priority, holds until settled', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    expect(occluderFadeGateInstalled()).toBe(true);
    const twin = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    let minted = 0;
    const mint = () => {
      minted++;
      return twin;
    };
    expect(occluderFadeTwinReady('k', 'edge', mint, undefined)).toBe(false);
    expect(occluderFadeTwinReady('k', 'edge', mint, undefined)).toBe(false);
    expect(minted).toBe(1);
    expect(compiles).toHaveLength(1);
    // The edge frame names the actionable floor: the player's own body is
    // what the opaque hold hides, and the lane may be seconds deep.
    expect(compiles[0]).toMatchObject({
      root: twin,
      imminent: true,
      priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
    });
    compiles[0].resolve();
    await flush();
    expect(occluderFadeTwinReady('k', 'edge', mint, undefined)).toBe(true);
    expect(minted).toBe(1);
    expect(compiles).toHaveLength(1);
  });

  it('keys are independent, and an ordinary consult submits without the imminent flag', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const mint = () => new THREE.Object3D();
    expect(occluderFadeTwinReady('a', 'prefetch', mint, undefined)).toBe(false);
    expect(occluderFadeTwinReady('b', 'edge', mint, undefined)).toBe(false);
    expect(compiles.map((c) => [c.imminent, c.priority])).toEqual([
      [false, undefined],
      [true, GPU_WORK_PRIORITY.ACTIONABLE_VIEW],
    ]);
    // A prefetched key an edge frame then meets is escalated: the reveal gate
    // keeps its one request, and one more compile rides the actionable floor.
    expect(occluderFadeTwinReady('a', 'edge', mint, undefined)).toBe(false);
    expect(compiles).toHaveLength(3);
    expect(compiles[2]).toMatchObject({
      imminent: true,
      priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
    });
    expect(occluderFadeTwinCount()).toBe(2);
  });

  it('a reinstall drops the previous twins with the previous context', () => {
    installOccluderFadeGate(fakeHost().host);
    occluderFadeTwinReady('a', 'edge', () => new THREE.Object3D(), undefined);
    expect(occluderFadeTwinCount()).toBe(1);
    installOccluderFadeGate(fakeHost().host);
    expect(occluderFadeTwinCount()).toBe(0);
  });
});

describe('the fade twin recipe', () => {
  it('is the exact state applyOccluderFade writes, on a hidden twin sharing the live geometry', () => {
    const { mesh, record } = structure('kfol:Wall');
    const twin = buildOccluderFadeTwin(occluderGhostTargetOf(record.mat, mesh), 'ghost-fade-gate');
    const material = twin.material as THREE.Material;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.opacity).toBeCloseTo(0.75 * OCCLUDER_FADE_ALPHA);
    expect(material.name).toBe('kfol:Wall:ghost-fade-gate');
    expect(isOccluderGhostTwin(material)).toBe(true);
    // The clone copied the record's ghost marker; the twin must not carry it,
    // or a later scene scan would mint a twin of a twin.
    expect(isOccluderGhostMaterial(material)).toBe(false);
    expect(twin.geometry).toBe(mesh.geometry);
    expect(twin.visible).toBe(false);
    expect(twin.frustumCulled).toBe(false);
    // The twin keys the SAME program the live flip will ask for.
    expect(occluderGhostVariantKey(occluderGhostTargetOf(material, twin))).toBe(
      occluderGhostVariantKey(occluderGhostTargetOf(record.mat, mesh)),
    );
  });

  it('the boot prewarm and the gate share one recipe (source pin)', () => {
    const prewarm = read('src/render/occluder_ghost_prewarm.ts');
    expect(prewarm).toContain("buildOccluderFadeTwin(target, 'ghost-fade-prewarm')");
    expect(prewarm).not.toContain('cloneMaterialWithHooks(');
  });
});

describe('advanceOccluderFade', () => {
  it('holds the structure opaque while the gate links, alpha stepping, then flips on the settle', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const { record } = structure();
    const mats = [record];

    let alpha = advanceOccluderFade(mats, 1, true, FRAME);
    expect(alpha).toBe(OCCLUDER_FADE_ALPHA);
    expect(record.mat.transparent).toBe(false);
    expect(record.mat.opacity).toBe(0.75);
    expect(record.applied).toBe(1);
    expect(compiles).toHaveLength(1);
    expect(compiles[0].imminent).toBe(true);
    // The twin is a real mesh on the live program's identity.
    expect((compiles[0].root as THREE.Mesh).isMesh).toBe(true);
    expect(occluderFadeTwinCount()).toBe(1);

    // Still held: the structure keeps drawing opaque, and no second compile.
    alpha = advanceOccluderFade(mats, alpha, true, FRAME);
    expect(record.mat.transparent).toBe(false);
    expect(compiles).toHaveLength(1);

    compiles[0].resolve();
    await flush();
    alpha = advanceOccluderFade(mats, alpha, true, FRAME);
    expect(alpha).toBe(OCCLUDER_FADE_ALPHA);
    expect(record.mat.transparent).toBe(true);
    expect(record.mat.opacity).toBeCloseTo(0.75 * OCCLUDER_FADE_ALPHA);
    expect(record.applied).toBe(OCCLUDER_FADE_ALPHA);
    // Settled and applied: free from here on.
    expect(advanceOccluderFade(mats, alpha, true, FRAME)).toBe(OCCLUDER_FADE_ALPHA);
  });

  it('a hold that clears before the link lands restores the authored state without a consult', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const { record } = structure();
    const mats = [record];
    let alpha = advanceOccluderFade(mats, 1, true, FRAME);
    expect(compiles).toHaveLength(1);
    // The camera clears: the alpha eases back to 1 with the material never
    // having flipped; the restore write needs no gate and no second compile.
    for (let i = 0; i < 400 && alpha < 1; i++)
      alpha = advanceOccluderFade(mats, alpha, false, FRAME);
    expect(alpha).toBe(1);
    expect(record.mat.transparent).toBe(false);
    expect(record.applied).toBe(1);
    expect(compiles).toHaveLength(1);
  });

  it('a fresh cold gate holds an ease-back too, and the terminal restore still lands ungated', () => {
    // A flipped structure meets a NEW gate (a graphics rebuild mid-fade): the
    // intermediate ease frames consult and hold, the write at exactly 1 never
    // consults, so the authored state is restored whatever the gate says.
    const { record } = structure();
    applyOccluderFade([record], OCCLUDER_FADE_ALPHA);
    expect(record.mat.transparent).toBe(true);
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    let alpha = OCCLUDER_FADE_ALPHA;
    for (let i = 0; i < 400 && alpha < 1; i++)
      alpha = advanceOccluderFade([record], alpha, false, FRAME);
    expect(alpha).toBe(1);
    expect(compiles).toHaveLength(1);
    expect(record.mat.transparent).toBe(false);
    expect(record.mat.opacity).toBe(0.75);
    expect(record.applied).toBe(1);
  });

  it('the mesh kind is part of the identity: one material on a Mesh and on an InstancedMesh is two twins', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const material = new THREE.MeshStandardMaterial({ name: 'wall' });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const plain = occluderFadeMat(material, new THREE.Mesh(geometry, material));
    const instanced = occluderFadeMat(material, new THREE.InstancedMesh(geometry, material, 2));
    expect(occluderFadeReady([plain], 'edge')).toBe(false);
    expect(occluderFadeReady([instanced], 'edge')).toBe(false);
    expect(occluderFadeTwinCount()).toBe(2);
    expect(compiles).toHaveLength(2);
    expect(
      (compiles[0].root as THREE.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh,
    ).toBeUndefined();
    expect((compiles[1].root as THREE.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh).toBe(
      true,
    );
  });

  it('a warm key flips at once, then eases back through the (still warm) gate', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const { record } = structure();
    advanceOccluderFade([record], 1, true, FRAME);
    compiles[0].resolve();
    await flush();
    let alpha = advanceOccluderFade([record], OCCLUDER_FADE_ALPHA, true, FRAME);
    expect(record.mat.transparent).toBe(true);
    alpha = advanceOccluderFade([record], alpha, false, FRAME);
    expect(alpha).toBeGreaterThan(OCCLUDER_FADE_ALPHA);
    expect(alpha).toBeLessThan(1);
    expect(record.mat.opacity).toBeCloseTo(0.75 * alpha);
    expect(compiles).toHaveLength(1);
  });

  it('consults every record of a structure in one frame, never short-circuiting', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const a = structure('a');
    const b = new THREE.MeshLambertMaterial({ name: 'b' });
    const bMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), b);
    const mats = [a.record, occluderFadeMat(b, bMesh)];
    expect(occluderFadeReady(mats, 'edge')).toBe(false);
    expect(compiles).toHaveLength(2);
    expect(occluderFadeApplied(mats, 1)).toBe(true);
  });

  it('applyOccluderFade tracks the alpha it wrote', () => {
    const { record } = structure();
    applyOccluderFade([record], 0.5);
    expect(record.applied).toBe(0.5);
    expect(occluderFadeApplied([record], 0.5)).toBe(true);
    expect(occluderFadeApplied([record], 1)).toBe(false);
    applyOccluderFade([record], 1);
    expect(record.applied).toBe(1);
  });
});

describe('prefetch', () => {
  it('asks at the ordinary priority in the open, imminent under an arrival curtain', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    prefetchOccluderFade([structure('open').record]);
    setArrivalCover(true);
    // A different program (a Lambert material keys apart from a Standard one):
    // the same program would be one key, already compiling.
    const covered = new THREE.MeshLambertMaterial({ name: 'covered' });
    prefetchOccluderFade([
      occluderFadeMat(covered, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), covered)),
    ]);
    expect(compiles.map((c) => [c.imminent, c.priority])).toEqual([
      [false, undefined],
      [true, undefined],
    ]);
  });

  it('the reach is geometry: past the cinematic opening pull-back, well past the wheel range', () => {
    expect(OCCLUDER_FADE_PREFETCH_YD).toBe(60);
    const cinematic = read('src/game/spawn_cinematic.ts');
    expect(cinematic).toContain('startDist: 55');
  });

  it('stageOccluderFadeOnce asks once for every record, unconditionally, on the shared latch', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const stone = new THREE.MeshStandardMaterial({ name: 'stone' });
    const banner = new THREE.MeshLambertMaterial({ name: 'banner' });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mats = [
      occluderFadeMat(stone, new THREE.InstancedMesh(geometry, stone, 2)),
      occluderFadeMat(banner, new THREE.Mesh(geometry, banner)),
    ];
    stageOccluderFadeOnce(mats);
    // No distance argument at all: the stage never consults the reach.
    expect(compiles).toHaveLength(2);
    expect(compiles.map((c) => c.imminent)).toEqual([false, false]);
    expect(occluderFadeTwinCount()).toBe(2);
    // Latched once per structure ...
    stageOccluderFadeOnce(mats);
    expect(compiles).toHaveLength(2);
    // ... on the SAME latch the within-reach prefetch uses: a staged
    // structure never asks again when it later comes within reach.
    prefetchOccluderFadeWithin(mats, 0, 0, 0, 0);
    expect(compiles).toHaveLength(2);
  });
});

describe('the instanced-ghost pool', () => {
  function source(name = 'Leaves'): THREE.InstancedMesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 4), 4),
    );
    const material = new THREE.MeshStandardMaterial({ name, opacity: 0.9 });
    return new THREE.InstancedMesh(geometry, material, 4);
  }

  it('keys per program identity and attribute set, stably per mesh', () => {
    const a = source();
    expect(instancedGhostKey(a)).toBe(instancedGhostKey(a));
    expect(instancedGhostKey(a)).toContain('MeshStandardMaterial');
    expect(instancedGhostKey(a)).toContain('color4');
    // Same material, geometries differing only in an attribute: two programs.
    const material = a.material as THREE.Material;
    const bare = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 2);
    expect(instancedGhostKey(bare)).not.toBe(instancedGhostKey(a));
    // Same material AND geometry on two meshes: one program, one key.
    const sibling = new THREE.InstancedMesh(a.geometry, material, 3);
    expect(instancedGhostKey(sibling)).toBe(instancedGhostKey(a));
  });

  it('the twin is the live stand-in recipe: hookless transparent clone, no depth write, plain mesh', () => {
    const src = source('Bark');
    // A hooked source, like every live foliage material (wind, collapse, haze
    // layers compose its customProgramCacheKey): the live stand-in's bare
    // clone DROPS the hook, and the twin must land on that hookless program,
    // not on the hook-preserving clone the building twins use.
    addRimGlow(src.material as THREE.Material);
    const hookedKey = (src.material as THREE.Material).customProgramCacheKey();
    const twin = instancedGhostTwin(src);
    const material = twin.material as THREE.Material;
    const live = createInstancedGhostMaterial(src.material as THREE.Material);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.customProgramCacheKey()).toBe(live.customProgramCacheKey());
    expect(material.customProgramCacheKey()).not.toBe(hookedKey);
    expect(cloneMaterialWithHooks(src.material as THREE.Material).customProgramCacheKey()).toBe(
      hookedKey,
    );
    expect((twin as THREE.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh).toBeUndefined();
    expect(twin.geometry).toBe(src.geometry);
    expect(twin.castShadow).toBe(false);
    expect(twin.visible).toBe(false);
    expect(material.name).toBe('Bark:ghost-fade-gate');
  });

  it('holds every part of a tree until its ghost programs link, then acquires', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const ghosts = new InstancedOccluderGhosts();
    // Two programs: the leaves are double-sided, which three keys on.
    const leaves = source('Leaves');
    (leaves.material as THREE.Material).side = THREE.DoubleSide;
    const parts = [{ mesh: source('Bark') }, { mesh: leaves }];
    expect(ghosts.allReady(parts)).toBe(false);
    expect(compiles).toHaveLength(2);
    expect(compiles.every((c) => c.imminent)).toBe(true);
    compiles[0].resolve();
    await flush();
    expect(ghosts.allReady(parts)).toBe(false);
    compiles[1].resolve();
    await flush();
    expect(ghosts.allReady(parts)).toBe(true);
    expect(compiles).toHaveLength(2);
    const handle = ghosts.acquire(parts[0].mesh, 0, new THREE.Matrix4());
    expect(handle.mesh.parent).toBe(parts[0].mesh);
  });

  it('prefetchAll asks without the imminent flag in the open, imminent under a cover', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    new InstancedOccluderGhosts().prefetchAll([{ mesh: source() }]);
    setArrivalCover(true);
    const covered = source('covered');
    (covered.material as THREE.Material).side = THREE.DoubleSide;
    new InstancedOccluderGhosts().prefetchAll([{ mesh: covered }]);
    expect(compiles.map((c) => c.imminent)).toEqual([false, true]);
  });
});

describe('wiring (source pins)', () => {
  it('every fade painter steps through the gated advance and prefetches within reach', () => {
    for (const file of [
      'src/render/props.ts',
      'src/render/eastbrook_town.ts',
      'src/render/fenbridge_town.ts',
      'src/render/hollow_gates.ts',
    ]) {
      const src = read(file);
      expect(src, file).toContain('advanceOccluderFade(');
      expect(src, file).toContain('prefetchOccluderFadeWithin(');
      expect(src, file).not.toContain('stepOccluderFade(');
      if (file !== 'src/render/props.ts') expect(src, file).not.toContain('applyOccluderFade(');
    }
    // The dungeon drives its walls through the extracted module only.
    const dungeon = read('src/render/dungeon.ts');
    expect(dungeon).toContain('updateWallOcclusion(');
    expect(dungeon).not.toContain('stepOccluderFade(');
    expect(dungeon).not.toContain('applyOccluderFade(');
    expect(dungeon).not.toContain('advanceOccluderFade(');
    // The wall driver gates every sightline fade; the raid backface cull is
    // the pinned exception (its hide frame never draws the transparent twin,
    // it hides the group outright, and gating the ease-back while VISIBLE
    // would pop the re-shown wall opaque; rationale in
    // dungeon_wall_occlusion.ts). The exception is paid for two ways: the
    // arm's first advanced frame STAGES a twin for every record it will
    // flip, and the re-show out of the fully hidden state CONSULTS
    // readiness (an edge consult, so a pending prefetch escalates) and
    // holds the wall hidden until every exact twin is ready. The staged
    // set, the consulted set, and the flipped set are pinned to the SAME
    // expression (h.mats): a backface material a registration adds lands in
    // h.mats or the flip cannot touch it either. Exactly the two floor
    // steps (wall arm, prop arm), the one wall-arm apply, the one
    // unconditional stage, and the one re-show readiness consult.
    const walls = read('src/render/dungeon_wall_occlusion.ts');
    expect(walls).toContain('advanceOccluderFade(');
    expect(walls).toContain('prefetchOccluderFadeWithin(');
    expect(walls.match(/stepOccluderFade\(/g)).toHaveLength(2);
    expect(walls).toContain('stepOccluderFade(h.alpha, hide, dt, reducedMotion, 0)');
    expect(walls).toContain('stepOccluderFade(b.alpha, hide, dt, reducedMotion, 0)');
    expect(walls.match(/applyOccluderFade\(/g)).toHaveLength(1);
    expect(walls.match(/stageOccluderFadeOnce\(/g)).toHaveLength(1);
    expect(walls).toContain('stageOccluderFadeOnce(h.mats)');
    expect(walls).toContain('applyOccluderFade(h.mats, h.alpha)');
    // The re-show flip consults readiness while the wall is still fully
    // hidden (alpha 0), and only there: the hold cannot pop what is not
    // showing, and a mid-ease (visible) wall never waits.
    expect(walls.match(/occluderFadeReady\(/g)).toHaveLength(1);
    expect(walls).toContain("!occluderFadeReady(h.mats, 'edge')");
    expect(walls).toContain(
      "if (h.alpha === 0 && next > 0 && next < 1 && !occluderFadeReady(h.mats, 'edge')) continue;",
    );
    // The consult sits AFTER the step and BEFORE the apply: it decides
    // whether this frame writes, never how far the fade has eased.
    expect(walls.indexOf("!occluderFadeReady(h.mats, 'edge')")).toBeLessThan(
      walls.indexOf('applyOccluderFade(h.mats, h.alpha)'),
    );
    // The stage sits BEFORE the settled early-out, so it cannot wait on the
    // first hide: a wall whose camera starts inside is staged all the same.
    expect(walls.indexOf('stageOccluderFadeOnce(h.mats)')).toBeLessThan(
      walls.indexOf('occluderFadeSettled(h.alpha, hide, 0)'),
    );
    // The prop arm restores off the WALL's recovered alpha, never its own
    // proxy clock alone: a wall held for readiness keeps its mounted props
    // held with it. The lazy owner-plus-plane link runs on the binding's
    // first advanced frame so the cover consult always has a wall to read.
    expect(walls).toContain('wallPropCoverAlpha(b) >= WALL_PROP_SHOW_ALPHA');
    expect(walls).not.toContain('b.alpha >= WALL_PROP_SHOW_ALPHA');
    expect(walls).toContain('if (b.walls === undefined) linkWallPropBinding(b, hideables);');
    // The one direct write left: the far-mode restore to the authored state,
    // which never flips to transparent and so never needs the gate.
    const props = read('src/render/props.ts');
    expect(props.match(/applyOccluderFade\(/g)).toHaveLength(1);
    expect(props).toContain('applyOccluderFade(h.mats, 1)');
  });

  it('the tree hides consult the pool for every part and prefetch within reach', () => {
    const foliage = read('src/render/tree_hide_fade.ts');
    // The decision itself is the pure occluderKeepsInstances (truth table in
    // tests/occluder_fade_core.test.ts); the painter only feeds it.
    expect(foliage).toContain('occluderKeepsInstances(hide, t.ghosts.length > 0, ghosts, t.parts)');
    expect(foliage).toContain('ghosts.prefetchAll(t.parts)');
    expect(foliage).toContain('withinOccluderFadePrefetch(t.x, t.z, camX, camZ)');
  });

  it('the renderer installs the gate on the reveal compile host, beside the scenery gates', () => {
    const renderer = read('src/render/renderer.ts');
    const install = renderer.indexOf('installOccluderFadeGate(revealHost)');
    expect(install).toBeGreaterThan(-1);
    const foliageGate = renderer.indexOf('this.foliageRevealGate = createRevealGate(revealHost');
    expect(foliageGate).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(foliageGate);
    expect(renderer.slice(foliageGate, install)).not.toContain('}');
    // ... and that pair sits inside the async-compile branch: no gate without
    // KHR_parallel_shader_compile, where the gate itself would be the stall.
    const branch = renderer.lastIndexOf('if (this.asyncCompileSupported) {', install);
    expect(branch).toBeGreaterThan(-1);
    expect(renderer.slice(branch, install)).not.toContain('\n    }');
  });
});

describe('second-pass contracts', () => {
  it('a link landing while a never-flipped structure eases back never flashes it translucent', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const { record } = structure();
    const mats = [record];
    let alpha = advanceOccluderFade(mats, 1, true, FRAME);
    expect(record.mat.transparent).toBe(false);
    // The camera clears while the link is still pending ...
    alpha = advanceOccluderFade(mats, alpha, false, FRAME);
    expect(alpha).toBeGreaterThan(OCCLUDER_FADE_ALPHA);
    // ... then the link lands mid-ease: nothing was flipped, nothing to
    // restore, so no write at all until the alpha is back at 1.
    compiles[0].resolve();
    await flush();
    for (let i = 0; i < 400 && alpha < 1; i++) {
      alpha = advanceOccluderFade(mats, alpha, false, FRAME);
      expect(record.mat.transparent).toBe(false);
      expect(record.mat.opacity).toBe(0.75);
    }
    expect(alpha).toBe(1);
    expect(record.applied).toBe(1);
  });

  it('two records on one program share one twin and one compile', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const a = structure('a').record;
    const b = structure('b').record;
    expect(occluderFadeReady([a, b], 'edge')).toBe(false);
    expect(compiles).toHaveLength(1);
    expect(occluderFadeTwinCount()).toBe(1);
  });

  it('mixed readiness never applies partially: the flip waits for the slowest program', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const a = structure('a').record;
    const lambert = new THREE.MeshLambertMaterial({ name: 'b', opacity: 0.5 });
    const b = occluderFadeMat(lambert, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lambert));
    const mats = [a, b];
    let alpha = advanceOccluderFade(mats, 1, true, FRAME);
    expect(compiles).toHaveLength(2);
    compiles[0].resolve();
    await flush();
    alpha = advanceOccluderFade(mats, alpha, true, FRAME);
    expect(a.mat.transparent).toBe(false);
    expect(b.mat.transparent).toBe(false);
    compiles[1].resolve();
    await flush();
    alpha = advanceOccluderFade(mats, alpha, true, FRAME);
    expect(a.mat.transparent).toBe(true);
    expect(b.mat.transparent).toBe(true);
    expect(b.mat.opacity).toBeCloseTo(0.5 * OCCLUDER_FADE_ALPHA);
  });

  it('reduced motion holds the same way: a direct state change, still behind the link', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const { record } = structure();
    const alpha = advanceOccluderFade([record], 1, true, FRAME, true);
    expect(alpha).toBe(OCCLUDER_FADE_ALPHA);
    expect(record.mat.transparent).toBe(false);
    compiles[0].resolve();
    await flush();
    expect(advanceOccluderFade([record], alpha, true, FRAME, true)).toBe(OCCLUDER_FADE_ALPHA);
    expect(record.mat.transparent).toBe(true);
    // And back: reduced motion restores in one step, ungated.
    expect(advanceOccluderFade([record], OCCLUDER_FADE_ALPHA, false, FRAME, true)).toBe(1);
    expect(record.mat.transparent).toBe(false);
  });

  it('uninstall drops the gate and its twins; consults are immediate again', () => {
    const { host } = fakeHost();
    installOccluderFadeGate(host);
    occluderFadeTwinReady('k', 'edge', () => new THREE.Object3D(), undefined);
    expect(occluderFadeTwinCount()).toBe(1);
    uninstallOccluderFadeGate();
    expect(occluderFadeGateInstalled()).toBe(false);
    expect(occluderFadeTwinCount()).toBe(0);
    expect(occluderFadeTwinReady('k', 'edge', () => new THREE.Object3D(), undefined)).toBe(true);
  });

  it('the renderer teardown seam uninstalls the gate (source pin)', () => {
    const lifecycle = read('src/render/renderer_resource_lifecycle.ts');
    expect(lifecycle).toContain('bestEffort(() => uninstallOccluderFadeGate())');
    expect(read('src/render/renderer.ts')).toContain(
      'disposeRendererPrewarmAndGroundFx(this, bestEffort)',
    );
  });

  it('occluderFadeRecordFor mints one record per (material, mesh variant) and reuses it', () => {
    const material = new THREE.MeshStandardMaterial({ name: 'kit' });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mats: ReturnType<typeof occluderFadeMat>[] = [];
    const plain = occluderFadeRecordFor(mats, material, new THREE.Mesh(geometry, material));
    expect(occluderFadeRecordFor(mats, material, new THREE.Mesh(geometry, material))).toBe(plain);
    const instanced = occluderFadeRecordFor(
      mats,
      material,
      new THREE.InstancedMesh(geometry, material, 2),
    );
    expect(instanced).not.toBe(plain);
    expect(instanced.mat).toBe(material);
    const colored = geometry.clone();
    colored.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(colored.getAttribute('position').count * 3), 3),
    );
    occluderFadeRecordFor(mats, material, new THREE.Mesh(colored, material));
    expect(mats).toHaveLength(3);
    // All records write the same material; the gate links all three programs.
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    expect(occluderFadeReady(mats, 'edge')).toBe(false);
    expect(compiles).toHaveLength(3);
    expect(occluderFadeTwinCount()).toBe(3);
  });

  it('the props and hollow-gate registries mint per variant (source pin)', () => {
    for (const file of ['src/render/props.ts', 'src/render/hollow_gates.ts']) {
      const src = read(file);
      expect(src, file).toContain('occluderFadeRecordFor(mats,');
      expect(src, file).not.toContain('occluderFadeMat(');
    }
  });

  it('the instanced-ghost key is value-keyed: two materials with equal parameters share one key', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const a = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ name: 'x' }), 2);
    const b = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ name: 'y' }), 2);
    expect(instancedGhostKey(a)).toBe(instancedGhostKey(b));
    // A parameter three keys on splits them again.
    const c = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }),
      2,
    );
    expect(instancedGhostKey(c)).not.toBe(instancedGhostKey(a));
    // A hooked source keys the same as an unhooked one: the ghost is hookless.
    const hooked = new THREE.MeshStandardMaterial({ name: 'h' });
    addRimGlow(hooked);
    expect(instancedGhostKey(new THREE.InstancedMesh(geometry, hooked, 2))).toBe(
      instancedGhostKey(a),
    );
  });

  it('every instanced-ghost consumer keeps its instances behind the predicate (source pin)', () => {
    expect(read('src/render/yumi_maze.ts')).toContain(
      'occluderKeepsInstances(hide, h.ghost !== null, wallGhosts, wallParts)',
    );
    expect(read('src/render/battleground_placements.ts')).toContain(
      'occluderKeepsInstances(hide, o.parts[0].ghost !== null, ghosts, o.parts)',
    );
    expect(read('src/render/tree_hide_fade.ts')).toContain(
      'occluderKeepsInstances(hide, t.ghosts.length > 0, ghosts, t.parts)',
    );
  });

  it('a skipped intro drops the establishing shot (source pin)', () => {
    const main = read('src/main.ts');
    const finish = main.indexOf('const finishIntro = ');
    expect(finish).toBeGreaterThan(-1);
    const body = main.slice(finish, main.indexOf('};', finish));
    expect(body).toContain('setArrivalEstablishingShot(false)');
  });
});

describe('edge-frame escalation past a prefetch', () => {
  it('compiles the twin once more at the actionable floor and settles the key on that result', async () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const { record } = structure();
    // A prefetch queued the key at the ordinary priority ...
    prefetchOccluderFade([record]);
    expect(compiles.map((c) => c.priority)).toEqual([undefined]);
    expect(occluderFadeEscalatedCount()).toBe(0);
    // ... then the camera enters the structure while that unit still waits.
    let alpha = advanceOccluderFade([record], 1, true, FRAME);
    expect(record.mat.transparent).toBe(false);
    expect(compiles).toHaveLength(2);
    expect(compiles[1]).toMatchObject({
      imminent: true,
      priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
    });
    expect(occluderFadeEscalatedCount()).toBe(1);
    // Escalated once, however many frames the hold lasts.
    alpha = advanceOccluderFade([record], alpha, true, FRAME);
    expect(compiles).toHaveLength(2);
    // The escalated link lands first: the key is warm and the flip goes through
    // while the prefetch unit is still queued.
    compiles[1].resolve();
    await flush();
    alpha = advanceOccluderFade([record], alpha, true, FRAME);
    expect(record.mat.transparent).toBe(true);
    // The prefetch unit landing later changes nothing.
    compiles[0].resolve();
    await flush();
    expect(advanceOccluderFade([record], alpha, true, FRAME)).toBe(OCCLUDER_FADE_ALPHA);
    expect(record.mat.transparent).toBe(true);
  });

  it('never escalates a key whose first consult was the edge frame (already actionable)', () => {
    const { host, compiles } = fakeHost();
    installOccluderFadeGate(host);
    const { record } = structure();
    advanceOccluderFade([record], 1, true, FRAME);
    advanceOccluderFade([record], OCCLUDER_FADE_ALPHA, true, FRAME);
    expect(compiles).toHaveLength(1);
    expect(occluderFadeEscalatedCount()).toBe(0);
  });

  it('a rejected escalation still settles the key (fail-soft, like the gate)', async () => {
    const compiles: { priority: number | undefined; reject: () => void }[] = [];
    installOccluderFadeGate({
      compile: (_root: object, _imminent: boolean, priority?: number) =>
        new Promise<void>((_resolve, reject) => {
          compiles.push({ priority, reject: () => reject(new Error('context lost')) });
        }),
      schedule: () => () => undefined,
    });
    const { record } = structure();
    prefetchOccluderFade([record]);
    advanceOccluderFade([record], 1, true, FRAME);
    expect(compiles).toHaveLength(2);
    compiles[1].reject();
    await flush();
    expect(occluderFadeReady([record], 'edge')).toBe(true);
  });

  it('the reveal watchdog stays silent on a key the escalation settled first', async () => {
    // The gate's own request never resolves; the escalation does. When the
    // watchdog timer fires, the key is warm and no reveal-watchdog event lands.
    const timers: (() => void)[] = [];
    const compiles: { priority: number | undefined; resolve: () => void }[] = [];
    installOccluderFadeGate({
      compile: (_root: object, _imminent: boolean, priority?: number) =>
        new Promise<void>((resolve) => {
          compiles.push({ priority, resolve });
        }),
      schedule: (onTimeout: () => void) => {
        timers.push(onTimeout);
        return () => undefined;
      },
    });
    const { record } = structure();
    prefetchOccluderFade([record]);
    advanceOccluderFade([record], 1, true, FRAME);
    compiles[1].resolve();
    await flush();
    const before = gpuPrepEventsSnapshot().counts['reveal-watchdog'];
    for (const fire of timers) fire();
    expect(gpuPrepEventsSnapshot().counts['reveal-watchdog']).toBe(before);
  });
});

describe('escalation edges', () => {
  it('an escalation settling after a reinstall never warms the new gate', async () => {
    const first = fakeHost();
    installOccluderFadeGate(first.host);
    const { record } = structure();
    prefetchOccluderFade([record]);
    advanceOccluderFade([record], 1, true, FRAME);
    expect(first.compiles).toHaveLength(2);
    // A graphics rebuild: a new gate, a new registry.
    const second = fakeHost();
    installOccluderFadeGate(second.host);
    first.compiles[1].resolve();
    await flush();
    // The new gate has never heard of the key: its first consult requests anew.
    expect(occluderFadeReady([record], 'edge')).toBe(false);
    expect(second.compiles).toHaveLength(1);
  });

  it('a synchronous throw out of the escalation compile settles the key (fail-soft)', () => {
    let calls = 0;
    installOccluderFadeGate({
      compile: (_root: object, _imminent: boolean, priority?: number) => {
        calls++;
        if (priority === GPU_WORK_PRIORITY.ACTIONABLE_VIEW) throw new Error('context lost');
        return new Promise<void>(() => undefined);
      },
      schedule: () => () => undefined,
    });
    const { record } = structure();
    prefetchOccluderFade([record]);
    advanceOccluderFade([record], 1, true, FRAME);
    expect(calls).toBe(2);
    expect(occluderFadeReady([record], 'edge')).toBe(true);
  });

  it('honours the page-entry barrier: an escalation compiles only after the first paint', async () => {
    let release = (): void => {};
    const firstPaint = new Promise<void>((resolve) => {
      release = resolve;
    });
    const compiles: number[] = [];
    installOccluderFadeGate({
      compile: (_root: object, _imminent: boolean, priority?: number) => {
        compiles.push(priority ?? -1);
        return new Promise<void>(() => undefined);
      },
      startAfterInitialPaint: () => firstPaint,
      schedule: () => () => undefined,
    });
    const { record } = structure();
    prefetchOccluderFade([record]);
    advanceOccluderFade([record], 1, true, FRAME);
    expect(compiles).toEqual([]);
    release();
    await flush();
    await flush();
    // Both the reveal gate's own request and the escalation waited for the paint.
    expect([...compiles].sort((a, b) => a - b)).toEqual([-1, GPU_WORK_PRIORITY.ACTIONABLE_VIEW]);
  });
});
