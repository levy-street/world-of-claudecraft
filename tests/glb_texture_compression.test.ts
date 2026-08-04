// Guard for the GLB texture KTX2 conversion (scripts/assets/compress_glb_textures.mjs).
//
// Every embedded texture in a shipped GLB stays KTX2 (KHR_texture_basisu) so it
// remains GPU-compressed in memory instead of decoding to a full RGBA bitmap:
// the decode amplification (~50 MB of files to ~1.5 GB of process) is what got
// the native iOS client jetsam-killed at world entry. The one sanctioned
// exception is the WEAPON_VFX skin set, whose emissive derivation draws the
// baseColor image into a canvas and therefore needs a drawable webp/png.
//
// An asset exporter re-run silently reverts its outputs to webp (nothing in
// scripts/assets knows about KTX2); this suite is what turns that drift red.
// The fix is one command:
//   node scripts/assets/compress_glb_textures.mjs && node scripts/build_media_manifest.mjs generate
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyGlb,
  glbJsonChunk,
  snapshotMismatch,
  structuralSnapshot,
  weaponVfxModelKeys,
} from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import {
  patchBasisTranscoderSource,
  VENDORED_TRANSCODER_DIR,
} from '../scripts/patch_basis_transcoder.mjs';
import { WEAPON_VFX } from '../src/render/weapon_vfx';

const ROOT = path.resolve(__dirname, '..');
const MODELS = path.join(ROOT, 'public', 'models');

function* walkGlbs(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkGlbs(p);
    else if (e.name.endsWith('.glb')) yield p;
  }
}

const vfxSkinFiles = new Set(
  Object.keys(WEAPON_VFX).map((k) => path.join(MODELS, 'weapons', `${k}.glb`)),
);

describe('GLB texture KTX2 compression', () => {
  it('keeps every embedded texture KTX2, except the drawable WEAPON_VFX skins', () => {
    const offenders: string[] = [];
    let converted = 0;
    let skins = 0;
    for (const file of walkGlbs(MODELS)) {
      // tests/sfx_studio_server_security.test.ts plants (and can leak) a
      // sfx-studio-security-<pid>.glb symlink in public/models during the
      // parallel suite; it is not a shipped model and its target is not a
      // GLB. Same filter tests/server/new_endpoint.test.ts applies to its
      // git-status sweep for the same leak.
      if (/^sfx-studio-security-\d+\.glb$/.test(path.basename(file))) continue;
      const json = glbJsonChunk(fs.readFileSync(file));
      const mimes = (json.images ?? []).map((i) => i.mimeType);
      if (mimes.length === 0) continue;
      const rel = path.relative(ROOT, file);
      if (vfxSkinFiles.has(file)) {
        skins++;
        // deriveEmissive must be able to drawImage this file's baseColor.
        if (mimes.some((m) => m === 'image/ktx2')) {
          offenders.push(`${rel}: WEAPON_VFX skin must stay drawable, found ktx2`);
        }
        continue;
      }
      if (mimes.some((m) => m !== 'image/ktx2')) {
        offenders.push(`${rel}: ${mimes.join(', ')}`);
        continue;
      }
      // GLTFLoader rejects a basisu GLB without a KTX2Loader only when the
      // extension is REQUIRED; keep it required so a missing transcoder fails
      // loudly at parse instead of silently rendering black.
      if (!(json.extensionsRequired ?? []).includes('KHR_texture_basisu')) {
        offenders.push(`${rel}: KHR_texture_basisu missing from extensionsRequired`);
        continue;
      }
      converted++;
    }
    expect(offenders).toEqual([]);
    // Tight vacuity floors (tests/CLAUDE.md): a deleted or renamed file drops
    // out of the walk silently, so the counts must sit at the real set size.
    // Every WEAPON_VFX model must exist on disk and carry drawable textures.
    expect(skins).toBe(vfxSkinFiles.size);
    // 1037 converted at introduction; new textured models only add to this.
    expect(converted).toBeGreaterThanOrEqual(1037);
  });

  it('extracts the same WEAPON_VFX exclusion set the converter uses', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'render', 'weapon_vfx.ts'), 'utf8');
    expect(weaponVfxModelKeys(source).sort()).toEqual(Object.keys(WEAPON_VFX).sort());
  });

  it('ships the basis transcoder and wires KTX2Loader into the runtime loader', () => {
    const vendoredDir = path.join(ROOT, ...VENDORED_TRANSCODER_DIR);
    for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
      expect(fs.existsSync(path.join(ROOT, 'public', 'basis', f)), `public/basis/${f}`).toBe(true);
    }
    // The wasm must match the installed three's transcoder byte for byte:
    // KTX2Loader and its worker expect this exact ABI, and a three bump that
    // changes it would otherwise fail every GLB parse with no red test.
    expect(
      fs
        .readFileSync(path.join(ROOT, 'public', 'basis', 'basis_transcoder.wasm'))
        .equals(fs.readFileSync(path.join(vendoredDir, 'basis_transcoder.wasm'))),
      'basis_transcoder.wasm matches three',
    ).toBe(true);
    // The JS glue ships with the eval-free embind patch applied (the Electron
    // shell CSP has no 'unsafe-eval'; see scripts/patch_basis_transcoder.mjs
    // and tests/basis_transcoder_csp.test.ts). Pin shipped === patch(vendored)
    // so a three bump still turns red until the patcher is re-run, keeping the
    // ABI-drift protection the plain byte pin used to give.
    expect(
      fs.readFileSync(path.join(ROOT, 'public', 'basis', 'basis_transcoder.js'), 'utf8'),
      'basis_transcoder.js is patch(vendored)',
    ).toBe(
      patchBasisTranscoderSource(
        fs.readFileSync(path.join(vendoredDir, 'basis_transcoder.js'), 'utf8'),
      ),
    );
    const loaderSrc = fs.readFileSync(
      path.join(ROOT, 'src', 'render', 'assets', 'loader.ts'),
      'utf8',
    );
    expect(loaderSrc).toContain('setKTX2Loader(ktx2Loader())');
    const supportSrc = fs.readFileSync(
      path.join(ROOT, 'src', 'render', 'assets', 'ktx2_support.ts'),
      'utf8',
    );
    expect(supportSrc).toContain("const TRANSCODER_PATH = '/basis/';");
    expect(supportSrc).toContain('detectSupport');
  });

  it('guards deriveEmissive against undrawable compressed maps, in game and mirror', () => {
    const game = fs.readFileSync(path.join(ROOT, 'src', 'render', 'weapon_vfx.ts'), 'utf8');
    expect(game).toContain('isCompressedTexture');
    const mirror = fs.readFileSync(
      path.join(ROOT, 'scripts', 'asset_pipeline', 'weapon_vfx.js'),
      'utf8',
    );
    expect(mirror).toContain('mat.map?.isCompressedTexture');
  });

  it('classifies and snapshots GLB json chunks correctly', () => {
    const converted = glbJsonChunk(
      fs.readFileSync(path.join(MODELS, 'chars', 'players', 'mage_classic.glb')),
    );
    expect(classifyGlb(converted)).toMatchObject({ convertible: 0, skip: true });
    const skin = glbJsonChunk(fs.readFileSync([...vfxSkinFiles][0]!));
    expect(classifyGlb(skin).convertible).toBeGreaterThan(0);
    const snap = structuralSnapshot(converted);
    expect(snap.skins).toBeGreaterThan(0);
    expect(snapshotMismatch(snap, snap)).toBeNull();
    expect(snapshotMismatch(snap, { ...snap, skins: snap.skins + 1 })).toEqual(['skins']);
  });
});
