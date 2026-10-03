// @vitest-environment happy-dom
// Every GLB the game keeps in a cache used to keep its three.js GLTFParser too
// (`gltf.parser`): a copy of the whole binary chunk, the parser's bufferView
// promise cache (embedded image slices included) and the parsed JSON. Nothing
// drawn needs any of it once the parse resolves: geometry and animation arrays
// are views over their OWN decoded bufferViews, and a texture re-uploads from
// its image or mip chain, never from the parser. The loader therefore drops
// the parser once its post-parse hooks have run, and this suite pins both
// halves: the cached result carries no parser (and the parser and its binary
// body are really collectable, not merely unlinked), and no src/ module reads
// one (a future consumer is a conscious decision, made here).
//
// happy-dom on purpose: its virtual server (vite.config.ts, environmentOptions)
// serves public/ at the window origin, so the real loadGltf path (FileLoader
// fetch, GLTFLoader, meshopt decode, the post-parse hooks) runs unchanged on a
// shipped GLB, with no loader double.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LoadedGltf, loadGltf, releaseGltf } from '../src/render/assets/loader';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { sourceFilesUnder } from './helpers/source_files_under';
import { stripComments } from './helpers/strip_comments';

const ROOT = path.resolve(__dirname, '..');
// A shipped creature: skinned, nine animation clips, meshopt-compressed, and no
// embedded image, so the Node host needs no KTX2 transcoder to parse it.
const YETI_URL = '/models/creatures/yeti.glb';

setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

/** Let pending loader callbacks settle, then force full collections: a
 *  WeakRef target stays alive until the job that created or read it ends. */
async function settleAndCollect(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collectGarbage();
  }
}

interface ParserProbe {
  parser: WeakRef<object> | null;
  body: WeakRef<ArrayBuffer> | null;
  bodyBytes: number;
}

const probe: ParserProbe = { parser: null, body: null, bodyBytes: 0 };
const realParse = GLTFLoader.prototype.parse;
let gltf: LoadedGltf;

beforeAll(async () => {
  // Observe the parse the loader runs (without keeping it alive): wrap the
  // parse callback, record weak handles to the parser and its binary body.
  GLTFLoader.prototype.parse = function observedParse(
    this: GLTFLoader,
    data,
    dir,
    onLoad,
    onError,
  ) {
    return realParse.call(
      this,
      data,
      dir,
      (result) => {
        const parser = result.parser as unknown as {
          extensions: Record<string, { body?: ArrayBuffer } | undefined>;
        };
        const body = parser.extensions.KHR_binary_glTF?.body ?? null;
        probe.parser = new WeakRef(parser);
        probe.body = body ? new WeakRef(body) : null;
        probe.bodyBytes = body?.byteLength ?? 0;
        onLoad(result);
      },
      onError,
    );
  };
  gltf = await loadGltf(YETI_URL);
});

afterAll(() => {
  GLTFLoader.prototype.parse = realParse;
  releaseGltf(YETI_URL);
});

describe('loadGltf releases the GLTFParser of every cached GLB', () => {
  it('observed the real parse of a shipped GLB with a binary body', () => {
    expect(probe.parser).not.toBeNull();
    expect(probe.body).not.toBeNull();
    // The body is the whole BIN chunk of the file (GLB: 12-byte header, then
    // the JSON chunk's length and type words, its payload, then the BIN chunk's
    // length word), not a stub.
    const file = readFileSync(path.join(ROOT, 'public', YETI_URL));
    const jsonBytes = file.readUInt32LE(12);
    expect(probe.bodyBytes).toBe(file.readUInt32LE(20 + jsonBytes));
    expect(probe.bodyBytes).toBeGreaterThan(0);
  });

  it('resolves a result that carries no parser', async () => {
    expect('parser' in gltf).toBe(false);
    // Every caller shares the one cached object.
    expect(await loadGltf(YETI_URL)).toBe(gltf);
  });

  it('lets the parser and its binary body be collected while the GLTF stays cached', async () => {
    await settleAndCollect();
    expect(probe.parser?.deref(), 'the GLTFParser is still reachable').toBeUndefined();
    expect(probe.body?.deref(), 'the GLB binary body is still reachable').toBeUndefined();
    // The cached result is the one still held above, so this is not a cache miss.
    expect(await loadGltf(YETI_URL)).toBe(gltf);
  });

  it('keeps geometry, skeleton and animation data intact after the collection', async () => {
    await settleAndCollect();
    let skinned: THREE.SkinnedMesh | null = null;
    gltf.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh;
    });
    expect(skinned).not.toBeNull();
    const mesh = skinned as unknown as THREE.SkinnedMesh;
    const position = mesh.geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    // The attribute still views live bytes (a detached or freed buffer reads 0).
    expect(position.array.byteLength).toBeGreaterThan(0);
    expect(mesh.skeleton.bones.length).toBeGreaterThan(0);
    expect(gltf.animations).toHaveLength(9);
    for (const clip of gltf.animations) {
      expect(clip.tracks.length).toBeGreaterThan(0);
      for (const track of clip.tracks) expect(track.times.byteLength).toBeGreaterThan(0);
    }
    // A skinned clone (every character and creature view) still shares the
    // cached geometry and animates against its own skeleton.
    const copy = cloneSkinned(gltf.scene);
    let cloned: THREE.SkinnedMesh | null = null;
    copy.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !cloned) cloned = o as THREE.SkinnedMesh;
    });
    const clonedMesh = cloned as unknown as THREE.SkinnedMesh;
    expect(clonedMesh.geometry).toBe(mesh.geometry);
    const mixer = new THREE.AnimationMixer(copy);
    mixer.clipAction(gltf.animations[0]).play();
    mixer.update(0.1);
    expect(clonedMesh.skeleton.bones.length).toBe(mesh.skeleton.bones.length);
  });
});

// A read of the parser off a loaded GLTF: property access, bracket access,
// destructuring, or the parser's own dependency API reached some other way.
const PARSER_READS: readonly RegExp[] = [
  /\.\s*parser\b/,
  /\[\s*['"`]parser['"`]\s*\]/,
  /\{[^{}]*\bparser\b[^{}]*\}\s*=/,
  /\bgetDependenc(?:y|ies)\s*\(/,
  /\.\s*associations\b/,
];

// The one sanctioned touch: the loader's own drop, exempted by exact text so
// any other parser access in the loader still counts.
const LOADER = 'render/assets/loader.ts';
const DROP = 'delete (gltf as { parser?: unknown }).parser;';

describe('no src/ module reads the GLTFParser of a loaded GLB', () => {
  const files = sourceFilesUnder(path.join(ROOT, 'src'));

  it('scans the whole src tree', () => {
    // A floor near the real count, so a moved root cannot hide the tree.
    expect(files.length).toBeGreaterThan(3000);
    expect(files.some(({ file }) => file === LOADER)).toBe(true);
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['source_files_under']);
  });

  it('finds no parser read', () => {
    const offenders: string[] = [];
    for (const { file, full } of files) {
      let code = stripComments(readFileSync(full, 'utf8'));
      if (file === LOADER) {
        expect(code.split(DROP).length - 1, 'the loader drops the parser exactly once').toBe(1);
        code = code.replace(DROP, '');
      }
      for (const pattern of PARSER_READS) {
        if (pattern.test(code)) offenders.push(`${file} matches ${pattern}`);
      }
    }
    // The loader drops `gltf.parser` after its post-parse hooks (loader.ts), so
    // a reader would see undefined. Needing parser data means extracting it in
    // those hooks, before the drop, and updating this pin on purpose.
    expect(offenders).toEqual([]);
  });

  it('still recognizes each read shape it bans', () => {
    const samples = [
      'const p = gltf.parser;',
      "const p = gltf['parser'];",
      'const { scene, parser } = gltf;',
      "parser.getDependency('texture', 0);",
      'gltf.parser.associations.get(mesh);',
    ];
    for (const sample of samples) {
      expect(
        PARSER_READS.some((pattern) => pattern.test(sample)),
        sample,
      ).toBe(true);
    }
  });
});
