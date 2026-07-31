// The vendored Basis transcoder must stay free of dynamic code execution.
//
// KTX2Loader runs public/basis/basis_transcoder.js inside a blob-URL worker,
// and a blob worker inherits the CSP of the page that created it. The Electron
// shell's CSP (electron/shell_guards.cjs buildContentSecurityPolicy) allows
// 'wasm-unsafe-eval' but never 'unsafe-eval', so any string-eval in the
// transcoder (new Function, a bare Function(...) call, direct or indirect
// eval) throws EvalError inside the worker, the transcoder's ready promise
// never settles, and every KTX2-textured GLB load hangs the loader queue: the
// v0.32.2/v0.32.3 desktop "Loading world" freeze.
//
// The shipped file carries a local patch replacing embind's four dynamic-code
// sites with the eval-free generic implementations (the shapes Emscripten
// emits with -sDYNAMIC_EXECUTION=0), applied by scripts/patch_basis_transcoder.mjs.
// Three layers pin it: the no-dynamic-code scans here, the transform's own
// throw arms (exercised below), and a full transcode of a shipped KTX2
// texture asserting byte parity with three's pristine transcoder, so a
// re-vendor that patches cleanly but breaks at runtime still goes red.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_FUNCTION_CALL,
  EVAL_REFERENCE,
  patchBasisTranscoderSource,
  SHIPPED_TRANSCODER_DIR,
  VENDORED_TRANSCODER_DIR,
  withoutBanner,
} from '../scripts/patch_basis_transcoder.mjs';

const ROOT = path.resolve(__dirname, '..');
const shippedPath = (f: string): string => path.join(ROOT, ...SHIPPED_TRANSCODER_DIR, f);
const vendoredPath = (f: string): string => path.join(ROOT, ...VENDORED_TRANSCODER_DIR, f);

const transcoderSource = readFileSync(shippedPath('basis_transcoder.js'), 'utf8');
const transcoderBody = withoutBanner(transcoderSource);
const vendoredSource = readFileSync(vendoredPath('basis_transcoder.js'), 'utf8');
const ktx2LoaderSource = readFileSync(
  path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'loaders', 'KTX2Loader.js'),
  'utf8',
);

describe('basis transcoder blob worker survives a CSP without unsafe-eval', () => {
  it('has no dynamic Function-constructor use in the shipped transcoder', () => {
    expect(transcoderBody).not.toContain('new Function');
    expect(transcoderBody).not.toContain('new_(Function');
    expect(DYNAMIC_FUNCTION_CALL.test(transcoderBody)).toBe(false);
  });

  it('has no eval reference at all in the shipped transcoder', () => {
    // \beval\b also catches indirect (0,eval)(...) and globalThis.eval(...),
    // both CSP-blocked exactly like the direct form. Banner already stripped.
    expect(EVAL_REFERENCE.test(transcoderBody)).toBe(false);
  });

  it('scans the real file: the four patched sites exist and the size is right', () => {
    for (const name of [
      'function createNamedFunction(',
      'function craftInvokerFunction(',
      'function craftEmvalAllocator(',
      'function __emval_get_method_caller(',
    ]) {
      expect(transcoderSource).toContain(name);
    }
    // Vacuity floor: a truncated or stubbed artifact cannot satisfy the
    // negative scans above and this floor at once (the real file is ~61k).
    expect(transcoderSource.length).toBeGreaterThan(50_000);
  });

  it('keeps the local-patch banner so a re-vendor is a conscious decision', () => {
    expect(transcoderSource).toContain('WoC local patch');
  });

  it('keeps the KTX2Loader worker glue free of dynamic code too', () => {
    expect(DYNAMIC_FUNCTION_CALL.test(ktx2LoaderSource)).toBe(false);
    expect(EVAL_REFERENCE.test(ktx2LoaderSource)).toBe(false);
  });

  it('the scans are decisive: both flag the pristine vendored transcoder', () => {
    expect(vendoredSource).toContain('new Function');
    expect(DYNAMIC_FUNCTION_CALL.test(vendoredSource)).toBe(true);
  });
});

describe('patchBasisTranscoderSource fails loudly instead of shipping evals', () => {
  it('throws on an already-patched source (idempotence guard)', () => {
    expect(() => patchBasisTranscoderSource(patchBasisTranscoderSource(vendoredSource))).toThrow(
      /already patched/,
    );
  });

  it('throws when an embind site is renamed upstream, even by a prefix rename', () => {
    const renamed = vendoredSource.replaceAll('craftInvokerFunction', 'craftInvokerFunctionV2');
    expect(() => patchBasisTranscoderSource(renamed)).toThrow(/not found/);
  });

  it('throws when a site appears twice', () => {
    const doubled = `${vendoredSource}\nfunction craftEmvalAllocator(){}`;
    expect(() => patchBasisTranscoderSource(doubled)).toThrow(/ambiguous/);
  });

  it('throws when dynamic code survives outside the four known sites', () => {
    const extra = `${vendoredSource}\nvar sneaky=new Function("return 1");`;
    expect(() => patchBasisTranscoderSource(extra)).toThrow(/markers remain/);
  });
});

// ---------------------------------------------------------------------------
// Functional parity: the patched transcoder must do byte-identical work.
// This is what catches a re-vendor that patches cleanly but breaks at runtime
// (dangling call sites, a bad splice): the structural pins above stay green in
// that scenario, this transcode does not.
// ---------------------------------------------------------------------------

interface Ktx2FileInstance {
  isValid(): boolean;
  getWidth(): number;
  getHeight(): number;
  getLevels(): number;
  startTranscoding(): boolean;
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(
    dst: Uint8Array,
    level: number,
    layer: number,
    face: number,
    format: number,
    flags: number,
    rowPitch: number,
    outputRows: number,
  ): boolean;
  close(): void;
  delete(): void;
}

interface BasisModule {
  initializeBasis(): void;
  KTX2File: new (data: Uint8Array) => Ktx2FileInstance;
}

type BasisFactory = (opts: { wasmBinary: Buffer }) => Promise<BasisModule>;

// Evaluate the classic UMD transcoder script in plain Node (no CSP here) and
// take its CommonJS export arm. The glue's Node branch reads __dirname and
// require, so both are supplied as if it were a real CJS module.
function loadBasisFactory(source: string, sourceDir: string): BasisFactory {
  const moduleShim = { exports: {} as unknown };
  const requireShim = createRequire(path.join(sourceDir, 'basis_transcoder.js'));
  new Function('module', 'exports', 'require', '__filename', '__dirname', source)(
    moduleShim,
    moduleShim.exports,
    requireShim,
    path.join(sourceDir, 'basis_transcoder.js'),
    sourceDir,
  );
  return moduleShim.exports as BasisFactory;
}

// Pull the first KHR_texture_basisu payload out of a shipped GLB.
function ktx2FromGlb(glbPath: string): Uint8Array {
  const buf = readFileSync(glbPath);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  let offset = 12;
  let json: {
    images?: { mimeType?: string; bufferView?: number }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  } | null = null;
  let bin: Buffer | null = null;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    offset += 8 + length;
  }
  const image = json?.images?.find((i) => i.mimeType === 'image/ktx2');
  expect(image, 'GLB carries a ktx2 image').toBeDefined();
  expect(bin, 'GLB carries a BIN chunk').not.toBeNull();
  const view = json?.bufferViews[image?.bufferView ?? -1];
  expect(view).toBeDefined();
  const start = view?.byteOffset ?? 0;
  return new Uint8Array(bin!.subarray(start, start + (view?.byteLength ?? 0)));
}

const TRANSCODE_RGBA32 = 13;

async function transcodeAllLevels(
  factory: BasisFactory,
  wasmBinary: Buffer,
  data: Uint8Array,
): Promise<{ width: number; height: number; levels: number; hashes: string[] }> {
  const module = await factory({ wasmBinary });
  module.initializeBasis();
  const file = new module.KTX2File(data);
  expect(file.isValid()).toBe(true);
  expect(file.startTranscoding()).toBeTruthy();
  const out = {
    width: file.getWidth(),
    height: file.getHeight(),
    levels: file.getLevels(),
    hashes: [] as string[],
  };
  for (let level = 0; level < out.levels; level++) {
    const size = file.getImageTranscodedSizeInBytes(level, 0, 0, TRANSCODE_RGBA32);
    const dst = new Uint8Array(size);
    expect(file.transcodeImage(dst, level, 0, 0, TRANSCODE_RGBA32, 0, -1, -1)).toBeTruthy();
    expect(dst.some((b) => b !== 0)).toBe(true);
    out.hashes.push(createHash('sha256').update(dst).digest('hex'));
  }
  file.close();
  file.delete();
  return out;
}

describe('patched transcoder transcodes a shipped KTX2 byte-identically', () => {
  it('matches the pristine three transcoder on every mip level', async () => {
    const wasm = readFileSync(shippedPath('basis_transcoder.wasm'));
    const ktx2 = ktx2FromGlb(path.join(ROOT, 'public', 'models', 'biome', 'beach_anchor.glb'));
    const patched = await transcodeAllLevels(
      loadBasisFactory(transcoderSource, shippedPath('')),
      wasm,
      ktx2,
    );
    const pristine = await transcodeAllLevels(
      loadBasisFactory(vendoredSource, vendoredPath('')),
      wasm,
      ktx2,
    );
    expect(patched.levels).toBeGreaterThan(0);
    expect(patched).toEqual(pristine);
  }, 30_000);
});
