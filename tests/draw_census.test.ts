import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DrawCensusSampler, sampleDrawCensus } from '../src/render/draw_census';
import {
  DRAW_CENSUS_LABEL_MAX,
  DRAW_CENSUS_SAMPLE_MS,
  DRAW_CENSUS_WINDOW_SAMPLES,
  type DrawCensusSample,
  DrawCensusWindow,
  drawCensusLabel,
  rankDrawCounts,
} from '../src/render/draw_census_core';
import { RenderDiagnostics } from '../src/render/render_diagnostics';

const box = new THREE.BoxGeometry(1, 1, 1);
const mesh = (name = ''): THREE.Mesh => {
  const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial());
  m.name = name;
  return m;
};

function group(name: string, category: string | null, children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (category) g.userData.renderCategory = category;
  g.add(...children);
  return g;
}

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

function sample(draws: number): DrawCensusSample {
  return {
    draws,
    objects: draws,
    walkMs: 1,
    categories: [['c', draws]],
    roots: [['r', draws]],
    nodes: [['c>r', draws]],
  };
}

describe('draw census core', () => {
  it('ranks highest first with a stable tie order and folds the tail into other', () => {
    const counts = new Map<string, number>([
      ['b', 5],
      ['a', 5],
      ['big', 40],
      ['zero', 0],
      ...Array.from({ length: 12 }, (_, i) => [`t${i}`, 1] as [string, number]),
    ]);
    const ranked = rankDrawCounts(counts, 3);
    expect(ranked).toEqual([
      ['big', 40],
      ['a', 5],
      ['b', 5],
      ['other', 12],
    ]);
    // Nothing below the cut: no `other` entry, and zero counts never rank.
    expect(
      rankDrawCounts(
        new Map([
          ['x', 2],
          ['y', 0],
        ]),
        3,
      ),
    ).toEqual([['x', 2]]);
  });

  it('bounds labels and names an empty one', () => {
    expect(drawCensusLabel('x'.repeat(200))).toHaveLength(DRAW_CENSUS_LABEL_MAX);
    expect(drawCensusLabel('  ')).toBe('unnamed');
    // Plain ids only: anything outside the charset becomes `_`, so no label
    // can carry free text or a JSON escape onto the wire.
    expect(drawCensusLabel('entity:player>helm-01 #2')).toBe('entity:player>helm-01 #2');
    expect(drawCensusLabel('a"b\\c\u0001d\u00e9')).toBe('a_b_c_d_');
  });

  it('keeps the latest sample and the peak of the rolling window only', () => {
    const window = new DrawCensusWindow(3);
    expect(window.snapshot()).toEqual({ samples: 0, latest: null, peak: null });
    window.push(sample(900));
    window.push(sample(100));
    let snap = window.snapshot();
    expect(snap.latest?.draws).toBe(100);
    expect(snap.peak?.draws).toBe(900);
    // Three more pushes evict the 900 sample: the peak follows the window.
    window.push(sample(200));
    window.push(sample(150));
    window.push(sample(120));
    snap = window.snapshot();
    expect(snap.samples).toBe(5);
    expect(snap.peak?.draws).toBe(200);
    expect(snap.latest?.draws).toBe(120);
    expect(DRAW_CENSUS_WINDOW_SAMPLES * DRAW_CENSUS_SAMPLE_MS).toBe(5 * 60_000);
  });
});

describe('draw census scene walk', () => {
  it('attributes draws by inherited category and by top-level scene node', () => {
    const scene = new THREE.Scene();
    scene.add(
      group('characters', 'entity:player', [mesh(), mesh(), group('weapon', 'vfx', [mesh()])]),
    );
    scene.add(group('arena', 'dungeon', [mesh()]));
    scene.add(mesh('loose'));
    const out = sampleDrawCensus(scene, null);
    expect(out.draws).toBe(5);
    expect(out.objects).toBe(5);
    expect(out.categories).toEqual([
      ['entity:player', 2],
      ['dungeon', 1],
      ['unknown', 1],
      ['vfx', 1],
    ]);
    expect(out.roots).toEqual([
      ['characters', 3],
      ['arena', 1],
      ['loose', 1],
    ]);
    // The finer split: category plus the nearest named node above the mesh.
    expect(out.nodes).toEqual([
      ['entity:player>characters', 2],
      ['dungeon>arena', 1],
      ['unknown>loose', 1],
      ['vfx>weapon', 1],
    ]);
    expect(out.walkMs).toBeGreaterThanOrEqual(0);
  });

  it('counts multi-material draws per visible group, as three submits them', () => {
    const scene = new THREE.Scene();
    // BoxGeometry has six groups over material indices 0 to 5.
    const mats = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial());
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats));
    expect(sampleDrawCensus(scene, null).draws).toBe(6);
    // A hidden group material drops only that group's draw.
    mats[2].visible = false;
    expect(sampleDrawCensus(scene, null).draws).toBe(5);
    // An array material over a geometry with no groups submits nothing.
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), [new THREE.MeshBasicMaterial()]));
    expect(sampleDrawCensus(scene, null).draws).toBe(5);
  });

  it('counts nothing for an empty draw range', () => {
    const scene = new THREE.Scene();
    const empty = mesh('empty');
    empty.geometry = new THREE.BoxGeometry(1, 1, 1);
    empty.geometry.setDrawRange(0, 0);
    scene.add(empty, mesh('drawn'));
    const out = sampleDrawCensus(scene, null);
    expect(out.draws).toBe(1);
    expect(out.roots).toEqual([['drawn', 1]]);
  });

  it('skips what three would skip: hidden subtrees, empty instancing, hidden materials', () => {
    const scene = new THREE.Scene();
    const hidden = group('hidden', null, [mesh(), mesh()]);
    hidden.visible = false;
    scene.add(hidden);
    scene.add(new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), 4));
    const empty = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), 4);
    empty.count = 0;
    scene.add(empty);
    const invisibleMat = mesh();
    (invisibleMat.material as THREE.Material).visible = false;
    scene.add(invisibleMat);
    expect(sampleDrawCensus(scene, null).draws).toBe(1);
  });

  it('applies the camera frustum and layer mask, and frustumCulled=false bypasses the frustum', () => {
    const scene = new THREE.Scene();
    const inView = mesh('in');
    const behind = mesh('behind');
    behind.position.set(0, 0, 50);
    const behindUnculled = mesh('behind-unculled');
    behindUnculled.position.set(0, 0, 50);
    behindUnculled.frustumCulled = false;
    const otherLayer = mesh('layer');
    otherLayer.layers.set(5);
    scene.add(inView, behind, behindUnculled, otherLayer);
    scene.updateMatrixWorld(true);
    const out = sampleDrawCensus(scene, camera());
    expect(out.roots.map(([label]) => label).sort()).toEqual(['behind-unculled', 'in']);
    expect(out.draws).toBe(2);
  });
});

describe('draw census sampler pacing', () => {
  function harness() {
    const queued: Array<() => void> = [];
    const scene = new THREE.Scene();
    scene.add(mesh('a'));
    let generation = 1;
    let skip = false;
    const sampler = new DrawCensusSampler({
      scene: () => scene,
      camera: () => null,
      skip: () => skip,
      generation: () => generation,
      shutdown: () => false,
      scheduleIdle: (run) => queued.push(run),
    });
    return {
      queued,
      scene,
      sampler,
      bump: () => generation++,
      setSkip: (value: boolean) => {
        skip = value;
      },
    };
  }

  it('waits one full interval after the first frame, then walks once per interval on idle', () => {
    const { queued, sampler } = harness();
    sampler.forFrame(1000);
    sampler.forFrame(1000 + DRAW_CENSUS_SAMPLE_MS - 1);
    expect(queued).toHaveLength(0);
    sampler.forFrame(1000 + DRAW_CENSUS_SAMPLE_MS);
    sampler.forFrame(1000 + DRAW_CENSUS_SAMPLE_MS * 3); // still pending: no second queue
    expect(queued).toHaveLength(1);
    expect(sampler.current().samples).toBe(0);
    queued.shift()?.();
    expect(sampler.current().latest?.draws).toBe(1);
  });

  it('skips the walk while the drawn scene differs from the graph (underworld mask)', () => {
    const { queued, sampler, setSkip } = harness();
    sampler.forFrame(0);
    sampler.forFrame(DRAW_CENSUS_SAMPLE_MS);
    setSkip(true);
    queued.shift()?.();
    expect(sampler.current().samples).toBe(0);
    // Not stuck: the next interval walks once the mask is off.
    setSkip(false);
    sampler.forFrame(DRAW_CENSUS_SAMPLE_MS * 2);
    queued.shift()?.();
    expect(sampler.current().samples).toBe(1);
  });

  it('drops a walk queued in a dead lifecycle generation', () => {
    const { queued, sampler, bump } = harness();
    sampler.forFrame(0);
    sampler.forFrame(DRAW_CENSUS_SAMPLE_MS);
    bump();
    queued.shift()?.();
    expect(sampler.current().samples).toBe(0);
  });

  it('runs on every build through RenderDiagnostics, even with the dev census disabled', () => {
    const queued: Array<() => void> = [];
    const scene = new THREE.Scene();
    scene.add(group('arena', 'dungeon', [mesh(), mesh()]));
    const diagnostics = new RenderDiagnostics(
      {
        counters: () => ({ programs: 0, textures: 0 }),
        scene: () => scene,
        generation: () => 1,
        shutdown: () => false,
        scheduleIdle: (run) => queued.push(run),
      },
      false,
    );
    diagnostics.forFrame(0);
    const snap = diagnostics.forFrame(DRAW_CENSUS_SAMPLE_MS);
    expect(snap.enabled).toBe(false);
    queued.shift()?.();
    expect(diagnostics.drawCensus().latest?.categories).toEqual([['dungeon', 2]]);
  });
});
