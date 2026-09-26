// The shader corpus record's program read on a real browser: taken off the
// shader handles three keeps on each program entry, it returns what a driver
// read of the attached shaders returns, field for field, for programs three has
// drawn with and programs it has only linked, and it never asks the driver for
// a shader's stage or the attached shaders (the stage query waits on the GPU
// process for every command already submitted).

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CorpusGl } from '../../src/game/shader_cache_warmup';
import {
  frameFallbackQueue,
  programSourcesOfEntry,
  readProgramSourcesQueued,
} from '../../src/game/shader_corpus_slices';

let renderer: THREE.WebGLRenderer;

beforeEach(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
});

afterEach(() => {
  renderer.dispose();
});

function skinnedMesh(): THREE.SkinnedMesh {
  const geometry = new THREE.CylinderGeometry(0.3, 0.3, 2, 6, 2);
  const count = geometry.attributes.position.count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const bone = new THREE.Bone();
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ color: 0x7a6a5a }));
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  return mesh;
}

function drawnScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  scene.add(
    new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a7f70 })),
    new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), new THREE.MeshBasicMaterial()),
    new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.ShaderMaterial({
        vertexShader:
          'attribute float lift; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, lift, 0.0), 1.0); }',
        fragmentShader: 'void main() { gl_FragColor = vec4(0.2, 0.4, 0.6, 1.0); }',
      }),
    ),
    skinnedMesh(),
  );
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 6);
  return { scene, camera };
}

/** Linked but never drawn: three has not run its first use on these, so their
 *  shaders are still undeleted. */
function linkedOnlyScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(
    new THREE.Mesh(new THREE.TorusGeometry(), new THREE.MeshLambertMaterial({ color: 0x445566 })),
    new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 2 })),
  );
  return scene;
}

/** The read the record used to make: the attached shaders, each one's stage
 *  asked of the driver, and the same location-0 walk. */
function driverRead(gl: WebGL2RenderingContext, program: WebGLProgram) {
  let vertex = '';
  let fragment = '';
  for (const shader of gl.getAttachedShaders(program) ?? []) {
    const source = gl.getShaderSource(shader) ?? '';
    if (gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER) vertex = source;
    else fragment = source;
  }
  let index0Attribute = '';
  const count = Number(gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) ?? 0);
  for (let i = 0; i < count && !index0Attribute; i++) {
    const attribute = gl.getActiveAttrib(program, i);
    if (attribute && gl.getAttribLocation(program, attribute.name) === 0) {
      index0Attribute = attribute.name;
    }
  }
  return { vertex, fragment, index0Attribute };
}

type ProgramEntry = {
  program?: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
};

function liveEntries(): ProgramEntry[] {
  return (renderer.info.programs ?? []) as unknown as ProgramEntry[];
}

describe('the corpus program read off three handles', () => {
  it('matches a driver read of every live program, drawn or only linked', () => {
    const { scene, camera } = drawnScene();
    renderer.render(scene, camera);
    renderer.compile(linkedOnlyScene(), camera);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const entries = liveEntries();
    expect(entries.length).toBeGreaterThanOrEqual(6);
    const deleteFlags = new Set<boolean>();
    const index0 = new Set<string>();
    for (const entry of entries) {
      if (!entry.program) throw new Error('a live entry lost its program');
      deleteFlags.add(gl.getShaderParameter(entry.vertexShader, gl.DELETE_STATUS) === true);
      const reference = driverRead(gl, entry.program);
      expect(reference.vertex).toMatch(/void main/);
      expect(reference.fragment).toMatch(/void main/);
      expect(reference.vertex).not.toBe(reference.fragment);
      const read = programSourcesOfEntry(gl as unknown as CorpusGl, entry);
      expect(read).toEqual(reference);
      index0.add(read?.index0Attribute ?? '');
    }
    // Both kinds were covered: programs three drew with (their shaders already
    // flagged for deletion by its first use) and programs it only linked.
    expect(deleteFlags).toEqual(new Set([true, false]));
    expect(index0.has('position')).toBe(true);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });

  it('makes no stage or attached-shader query during a record read', async () => {
    const { scene, camera } = drawnScene();
    renderer.render(scene, camera);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const proto = WebGL2RenderingContext.prototype;
    const counted = ['getShaderParameter', 'getAttachedShaders', 'getError'] as const;
    const originals = counted.map((name) => proto[name]);
    const calls: Record<string, number> = {};
    const stageQueries: number[] = [];
    counted.forEach((name, i) => {
      const original = originals[i] as (...args: unknown[]) => unknown;
      (proto as unknown as Record<string, unknown>)[name] = function (
        this: WebGL2RenderingContext,
        ...args: unknown[]
      ) {
        calls[name] = (calls[name] ?? 0) + 1;
        if (name === 'getShaderParameter' && args[1] === gl.SHADER_TYPE) stageQueries.push(1);
        return original.apply(this, args);
      };
    });
    let sources: Awaited<ReturnType<typeof readProgramSourcesQueued>>;
    try {
      // The wrap is live on this context: one driver read is seen.
      const [first] = liveEntries();
      if (!first.program) throw new Error('no linked program');
      driverRead(gl, first.program);
      expect(stageQueries.length).toBe(2);
      expect(calls.getAttachedShaders).toBe(1);
      for (const name of counted) calls[name] = 0;
      stageQueries.length = 0;
      sources = await readProgramSourcesQueued(
        gl as unknown as CorpusGl,
        liveEntries(),
        frameFallbackQueue((callback) => requestAnimationFrame(() => callback())),
      );
    } finally {
      counted.forEach((name, i) => {
        (proto as unknown as Record<string, unknown>)[name] = originals[i];
      });
    }
    expect(sources).toHaveLength(liveEntries().length);
    expect(stageQueries).toEqual([]);
    expect(calls).toEqual({ getShaderParameter: 0, getAttachedShaders: 0, getError: 0 });
  });

  it('skips a program destroyed after the snapshot without touching its freed shaders', () => {
    const { scene, camera } = drawnScene();
    renderer.render(scene, camera);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const [entry] = [...liveEntries()] as (ProgramEntry & { destroy(): void })[];
    // What three runs when it lets a program go (the patch's retention bound
    // or upstream's last release): deleteProgram, then `.program` nulled, the
    // shader handles kept.
    entry.destroy();
    expect(entry.program).toBeUndefined();
    expect(entry.vertexShader).toBeTruthy();
    expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(programSourcesOfEntry(gl as unknown as CorpusGl, entry)).toBeNull();
    expect(gl.getError()).toBe(gl.NO_ERROR);
    // The guard is what spared the error: the freed handle itself is refused.
    gl.getShaderSource(entry.vertexShader);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });
});
