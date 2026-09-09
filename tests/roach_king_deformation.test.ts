import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';

interface GeometryGlb {
  meshes: { primitives: { material?: number }[] }[];
  materials?: unknown;
  textures?: unknown;
  images?: unknown;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

// Exercise shipping geometry and Three's real skinning/mixer, without a GPU or
// image decoder. Only material references are removed; indices, meshopt buffers,
// skin weights, inverse binds, transforms and animation tracks remain untouched.
async function loadGeometry(name: string): Promise<GLTF> {
  const bytes = readFileSync(resolve(__dirname, `../public/models/creatures/${name}.glb`));
  const json = glbJsonChunk(bytes) as GeometryGlb;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) delete primitive.material;
  }
  delete json.materials;
  delete json.textures;
  delete json.images;
  for (const key of ['extensionsUsed', 'extensionsRequired'] as const) {
    json[key] = (json[key] ?? []).filter((name: string) => name !== 'KHR_texture_basisu');
  }
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(padded);
  const binaryChunk = bytes.subarray(20 + bytes.readUInt32LE(12));
  const header = Buffer.from(bytes.subarray(0, 20));
  header.writeUInt32LE(20 + padded.length + binaryChunk.length, 8);
  header.writeUInt32LE(padded.length, 12);
  const geometryOnly = Uint8Array.from(Buffer.concat([header, padded, binaryChunk]));
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(geometryOnly.buffer, '');
}

type Edge = { a: number; b: number; length: number };
type MeshData = { mesh: THREE.SkinnedMesh; edges: Edge[]; bodyVertices: number[] };

function distance(points: Float64Array, a: number, b: number): number {
  return Math.hypot(
    points[a * 3] - points[b * 3],
    points[a * 3 + 1] - points[b * 3 + 1],
    points[a * 3 + 2] - points[b * 3 + 2],
  );
}

function maximumDelta(a: Float64Array[], b: Float64Array[]): number {
  let maximum = 0;
  for (let mesh = 0; mesh < a.length; mesh++) {
    for (let i = 0; i < a[mesh].length; i += 3) {
      maximum = Math.max(
        maximum,
        Math.hypot(
          a[mesh][i] - b[mesh][i],
          a[mesh][i + 1] - b[mesh][i + 1],
          a[mesh][i + 2] - b[mesh][i + 2],
        ),
      );
    }
  }
  return maximum;
}

function verticalBounds(points: Float64Array[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const mesh of points) {
    for (let i = 1; i < mesh.length; i += 3) {
      min = Math.min(min, mesh[i]);
      max = Math.max(max, mesh[i]);
    }
  }
  return { min, max };
}

function geometryProbe(gltf: GLTF, name: string) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const data: MeshData[] = [];
  const point = new THREE.Vector3();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const position = object.geometry.getAttribute('position');
    const index = object.geometry.index;
    if (!index) throw new Error(`Unindexed shipping mesh: ${object.name}`);
    const bind = new Float64Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      point.toArray(bind, i * 3);
    }
    const edges: Edge[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < index.count; i += 3) {
      for (let corner = 0; corner < 3; corner++) {
        const a = index.getX(i + corner);
        const b = index.getX(i + ((corner + 1) % 3));
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a, b, length: distance(bind, a, b) });
      }
    }
    // The king's head/crown can touch down while its abdomen floats. Only the
    // actual thorax and abdomen count as body support for that donor rig.
    const bodyNames = new Set(
      name === 'roach_king'
        ? ['tripo0_Left_Limb_0', 'bone_2']
        : [
            'Root',
            'Hip',
            'Pelvis',
            'Waist',
            'Spine01',
            'Spine02',
            'tripoRoot',
            'tripo0_Left_Limb_0',
            'bone_2',
            'tripoSpine_0',
          ],
    );
    const bodyJoints = new Set(
      object.skeleton.bones.flatMap((bone, index) =>
        bodyNames.has(bone.name.replace(/[^a-zA-Z0-9_]/g, '')) ? [index] : [],
      ),
    );
    const joints = object.geometry.getAttribute('skinIndex');
    const weights = object.geometry.getAttribute('skinWeight');
    const bodyVertices: number[] = [];
    for (let vertex = 0; vertex < position.count; vertex++) {
      let bodyWeight = 0;
      for (let influence = 0; influence < 4; influence++) {
        if (bodyJoints.has(joints.getComponent(vertex, influence))) {
          bodyWeight += weights.getComponent(vertex, influence);
        }
      }
      if (bodyWeight > 0.8) bodyVertices.push(vertex);
    }
    data.push({ mesh: object, edges, bodyVertices });
  });
  if (data.length === 0) throw new Error('No skinned shipping geometry');

  function sample(name: string, seconds: number): Float64Array[] {
    const clip = gltf.animations.find((clip) => clip.name === name);
    if (!clip) throw new Error(`Missing ${name} animation`);
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(seconds);
    gltf.scene.updateMatrixWorld(true);
    return data.map(({ mesh }) => {
      mesh.skeleton.update();
      const position = mesh.geometry.getAttribute('position');
      const result = new Float64Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
        point.toArray(result, i * 3);
      }
      return result;
    });
  }

  const idle = verticalBounds(sample('Idle', 0.5));
  const height = idle.max - idle.min;
  return {
    data,
    height,
    floor: idle.min,
    sample,
    duration(name: string): number {
      const clip = gltf.animations.find((clip) => clip.name === name);
      if (!clip) throw new Error(`Missing ${name} animation`);
      return clip.duration;
    },
  };
}

for (const name of ['asmon_hermit', 'roach_king', 'roachling', 'garbage_beetle']) {
  describe(`${name} deformed shipping mesh`, () => {
    let probe: ReturnType<typeof geometryProbe>;
    const boss = name === 'asmon_hermit' || name === 'roach_king';
    beforeAll(async () => {
      probe = geometryProbe(await loadGeometry(name), name);
      expect(probe.height).toBeGreaterThan(0.2);
      expect(probe.data.reduce((sum, entry) => sum + entry.edges.length, 0)).toBeGreaterThan(
        boss ? 5000 : 3000,
      );
      if (boss) {
        expect(
          probe.data.reduce((sum, entry) => sum + entry.bodyVertices.length, 0),
        ).toBeGreaterThan(400);
      }
    });

    if (boss) {
      it.each(['Walk', 'Run', 'Decree', 'Death'])(
        '%s keeps connected appendages from stretching across the body',
        (clip) => {
          let maximum = 0;
          let checked = 0;
          for (let frame = 0; frame <= 16; frame++) {
            const points = probe.sample(clip, (probe.duration(clip) * frame) / 16);
            for (let mesh = 0; mesh < points.length; mesh++) {
              expect(points[mesh].every(Number.isFinite)).toBe(true);
              for (const edge of probe.data[mesh].edges) {
                // Tiny triangles amplify quantization noise. Only connected edges
                // spanning at least 0.2% of the displayed body height count here.
                if (edge.length < probe.height * 0.002) continue;
                maximum = Math.max(maximum, distance(points[mesh], edge.a, edge.b) / edge.length);
                checked++;
              }
            }
          }
          expect(checked).toBeGreaterThan(50_000);
          // Allow substantial joint flexion while rejecting the reported 14x
          // walking paws, 22x decree paws and 28x split-root corpse tearing.
          expect(maximum, `${name}/${clip} maximum connected-edge stretch`).toBeLessThan(4);
        },
      );

      it('settles the corpse on the runtime Idle floor and holds the final pose', () => {
        const duration = probe.duration('Death');
        const settled = probe.sample('Death', duration * 0.9);
        const final = probe.sample('Death', duration);
        const bounds = verticalBounds(final);
        expect(Math.abs(bounds.min - probe.floor) / probe.height).toBeLessThan(0.025);
        let bodyMin = Infinity;
        const bodyHeights: number[] = [];
        for (let mesh = 0; mesh < probe.data.length; mesh++) {
          for (const vertex of probe.data[mesh].bodyVertices) {
            bodyMin = Math.min(bodyMin, final[mesh][vertex * 3 + 1]);
            bodyHeights.push(final[mesh][vertex * 3 + 1]);
          }
        }
        if (name === 'roach_king') {
          // Require a patch of shell near the floor, not one isolated low
          // vertex while the rest of the overturned abdomen hangs above it.
          bodyHeights.sort((a, b) => a - b);
          const fifthPercentile = bodyHeights[Math.floor((bodyHeights.length - 1) * 0.05)];
          expect(
            (fifthPercentile - probe.floor) / probe.height,
            'shell contact patch',
          ).toBeLessThan(0.05);
        }
        expect((bodyMin - probe.floor) / probe.height, 'torso/shell floor clearance').toBeLessThan(
          0.05,
        );
        expect(maximumDelta(settled, final) / probe.height).toBeLessThan(0.005);
        expect((bounds.max - probe.floor) / probe.height).toBeLessThan(
          name === 'roach_king' ? 1.1 : 0.75,
        );
      });
    }

    it.each(['Idle', 'Walk', 'Run'])('%s closes without a position or velocity snap', (clip) => {
      const duration = probe.duration(clip);
      const dt = 1 / 30;
      const first = probe.sample(clip, 0);
      const after = probe.sample(clip, dt);
      const before = probe.sample(clip, duration - dt);
      const last = probe.sample(clip, duration);
      expect(maximumDelta(first, last) / probe.height).toBeLessThan(0.001);
      const forward = after.map((points, mesh) => points.map((p, i) => p - first[mesh][i]));
      const incoming = last.map((points, mesh) => points.map((p, i) => p - before[mesh][i]));
      expect(maximumDelta(forward, incoming) / probe.height).toBeLessThan(0.025);
      if (clip !== 'Idle')
        expect(maximumDelta(first, after) / probe.height).toBeGreaterThan(0.0001);
    });
  });
}
