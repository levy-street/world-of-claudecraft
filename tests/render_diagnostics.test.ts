import { describe, expect, it } from 'vitest';
import {
  RENDER_DIAGNOSTICS_SAMPLE_MS,
  RenderDiagnostics,
  type RenderDiagnosticsHost,
} from '../src/render/render_diagnostics';

interface FakeObject {
  visible: boolean;
  userData: Record<string, unknown>;
  children: FakeObject[];
  uuid: string;
  name?: string;
  type?: string;
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isPoints?: boolean;
  count?: number;
  geometry?: {
    uuid: string;
    groups: unknown[];
    index?: { count: number } | null;
    getAttribute(name: string): { count: number } | undefined;
  };
  material?:
    | { name: string; type: string; uuid: string }
    | { name: string; type: string; uuid: string }[];
}

let uuidCounter = 0;
function makeObject(overrides: Partial<FakeObject> = {}): FakeObject {
  uuidCounter++;
  return {
    visible: true,
    userData: {},
    children: [],
    uuid: `uuid-${uuidCounter}`,
    type: 'Object3D',
    ...overrides,
  };
}

function makeMesh(materialName: string, triangles: number, category?: string): FakeObject {
  uuidCounter++;
  return makeObject({
    isMesh: true,
    name: `${materialName}-mesh`,
    userData: category ? { renderCategory: category } : {},
    geometry: {
      uuid: `geo-${uuidCounter}`,
      groups: [],
      index: { count: triangles * 3 },
      getAttribute: () => undefined,
    },
    material: {
      name: materialName,
      type: 'MeshStandardMaterial',
      uuid: `mat-${materialName}-0000`,
    },
  });
}

interface Harness {
  diagnostics: RenderDiagnostics;
  host: RenderDiagnosticsHost;
  scene: FakeObject;
  counters: { programs: number; textures: number };
  idleRuns: (() => void)[];
  generation: { value: number };
  shutdown: { value: boolean };
}

function makeHarness(scene: FakeObject, enabled = true): Harness {
  const counters = { programs: 10, textures: 4 };
  const idleRuns: (() => void)[] = [];
  const generation = { value: 1 };
  const shutdown = { value: false };
  const host: RenderDiagnosticsHost = {
    counters: () => ({ ...counters }),
    scene: () => scene as unknown as ReturnType<RenderDiagnosticsHost['scene']>,
    generation: () => generation.value,
    shutdown: () => shutdown.value,
    scheduleIdle: (run) => idleRuns.push(run),
  };
  return {
    diagnostics: new RenderDiagnostics(host, enabled),
    host,
    scene,
    counters,
    idleRuns,
    generation,
    shutdown,
  };
}

describe('render diagnostics census', () => {
  it('aggregates category stats and skips invisible subtrees', () => {
    const scene = makeObject();
    const town = makeObject({ userData: { renderCategory: 'props' } });
    town.children.push(makeMesh('village:Wood', 100), makeMesh('village:Plaster', 50));
    const hidden = makeObject({ visible: false });
    hidden.children.push(makeMesh('never-drawn', 999));
    scene.children.push(town, hidden);
    const { diagnostics } = makeHarness(scene);
    const snapshot = diagnostics.collect();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.totalObjects).toBe(2);
    expect(snapshot.estimatedTriangles).toBe(150);
    expect(snapshot.categories.props.objects).toBe(2);
    expect(snapshot.categories.props.materials).toBe(2);
    expect(snapshot.newMaterials.some((label) => label.startsWith('village:Wood'))).toBe(true);
    expect(snapshot.newMaterials.some((label) => label.startsWith('never-drawn'))).toBe(false);
  });

  it('reports program and texture deltas across collects', () => {
    const harness = makeHarness(makeObject());
    expect(harness.diagnostics.collect().programDelta).toBe(10);
    harness.counters.programs = 15;
    harness.counters.textures = 5;
    const second = harness.diagnostics.collect();
    expect(second.programDelta).toBe(5);
    expect(second.textureDelta).toBe(1);
  });

  it('reports a material and a visible object as new exactly once', () => {
    const scene = makeObject();
    scene.children.push(makeMesh('village:Wood', 10));
    const { diagnostics } = makeHarness(scene);
    const first = diagnostics.collect();
    expect(first.newMaterials).toHaveLength(1);
    expect(first.firstVisibleObjects).toHaveLength(1);
    const second = diagnostics.collect();
    expect(second.newMaterials).toHaveLength(0);
    expect(second.firstVisibleObjects).toHaveLength(0);
  });

  it('a disabled instance never walks the scene', () => {
    let walked = 0;
    const scene = makeObject();
    Object.defineProperty(scene, 'children', {
      get() {
        walked++;
        return [];
      },
    });
    const harness = makeHarness(scene, false);
    expect(harness.diagnostics.collect().enabled).toBe(false);
    expect(harness.diagnostics.forFrame(0).enabled).toBe(false);
    expect(walked).toBe(0);
  });
});

describe('render diagnostics sampling', () => {
  it('samples on idle at the pinned cadence and not before', () => {
    const scene = makeObject();
    scene.children.push(makeMesh('village:Wood', 10));
    const harness = makeHarness(scene);
    expect(RENDER_DIAGNOSTICS_SAMPLE_MS).toBe(2000);
    harness.diagnostics.forFrame(0);
    expect(harness.idleRuns).toHaveLength(1);
    // Before the cadence elapses, and while a sample is pending, no re-arm.
    harness.diagnostics.forFrame(1000);
    harness.diagnostics.forFrame(RENDER_DIAGNOSTICS_SAMPLE_MS + 1);
    expect(harness.idleRuns).toHaveLength(1);
    harness.idleRuns[0]();
    expect(harness.diagnostics.current().totalObjects).toBe(1);
    harness.diagnostics.forFrame(2 * RENDER_DIAGNOSTICS_SAMPLE_MS + 2);
    expect(harness.idleRuns).toHaveLength(2);
  });

  it('force collects synchronously (the stall-attribution arm)', () => {
    const scene = makeObject();
    scene.children.push(makeMesh('village:Wood', 10));
    const harness = makeHarness(scene);
    const snapshot = harness.diagnostics.forFrame(0, true);
    expect(snapshot.totalObjects).toBe(1);
    expect(harness.idleRuns).toHaveLength(0);
  });

  it('a queued sample from a dead generation or a shutdown never lands', () => {
    const scene = makeObject();
    scene.children.push(makeMesh('village:Wood', 10));
    const harness = makeHarness(scene);
    harness.diagnostics.forFrame(0);
    harness.generation.value = 2;
    harness.idleRuns[0]();
    expect(harness.diagnostics.current().totalObjects).toBe(0);
    const second = makeHarness(scene);
    second.diagnostics.forFrame(0);
    second.shutdown.value = true;
    second.idleRuns[0]();
    expect(second.diagnostics.current().totalObjects).toBe(0);
  });
});
