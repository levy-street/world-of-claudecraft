// KTX2/Basis transcoder wiring for GLB-embedded compressed textures.
//
// Every GLB under public/models carries its textures as KTX2 (KHR_texture_basisu)
// so they stay GPU-compressed in memory instead of decoding to full RGBA bitmaps
// (the decode amplification was the bulk of the WKWebView process footprint that
// got the native iOS client jetsam-killed at world entry). GLTFLoader needs a
// KTX2Loader attached before it can parse them.
//
// KTX2Loader.detectSupport requires a live WebGLRenderer, but GLB preloads start
// at the launcher, long before the real Renderer exists. detectSupport only reads
// extension support flags, so a 1x1 throwaway renderer is enough; it is released
// immediately (browsers cap ~16 live WebGL contexts, see context_release.ts).
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import {
  isKtx2MipReleaseEnabled,
  type Ktx2MipLevel,
  setKtx2MipRederive,
  stashKtx2TranscodeSource,
} from './ktx2_mip_release';

// Served verbatim from public/basis/ in every host (vite dev, the deployed
// site, the Capacitor native bundle, the Electron app scheme). The files are
// deliberately not media-manifest hashed: KTX2Loader fetches them by path.
const TRANSCODER_PATH = '/basis/';

let ktx2: KTX2Loader | null = null;

// The extension each KTX2Loader workerConfig flag answers to: the exact names
// three r165's detectSupport queries on its WebGL arm. A raw context probe
// through this table gives the same capability answer as the full renderer.
const KTX2_SUPPORT_EXTENSIONS = {
  astcSupported: 'WEBGL_compressed_texture_astc',
  etc1Supported: 'WEBGL_compressed_texture_etc1',
  etc2Supported: 'WEBGL_compressed_texture_etc',
  dxtSupported: 'WEBGL_compressed_texture_s3tc',
  bptcSupported: 'EXT_texture_compression_bptc',
  pvrtcSupported: 'WEBGL_compressed_texture_pvrtc',
} as const;

type Ktx2WorkerConfig = Record<keyof typeof KTX2_SUPPORT_EXTENSIONS, boolean>;

interface RawGlContext {
  getExtension(name: string): unknown;
}

// three's detectSupport additionally ORs the WebKit-prefixed pvrtc alias on
// its WebGL arm; the raw probe must give the same capability answer.
const PVRTC_WEBKIT_ALIAS = 'WEBKIT_WEBGL_compressed_texture_pvrtc';

/** Build the KTX2 workerConfig from a raw WebGL context's real extension set.
 *  Exported for direct unit coverage of the fallback probe. */
export function ktx2WorkerConfigFromRawContext(gl: RawGlContext): Ktx2WorkerConfig {
  const config = {} as Ktx2WorkerConfig;
  for (const key of Object.keys(KTX2_SUPPORT_EXTENSIONS) as (keyof Ktx2WorkerConfig)[]) {
    config[key] = gl.getExtension(KTX2_SUPPORT_EXTENSIONS[key]) != null;
  }
  config.pvrtcSupported = config.pvrtcSupported || gl.getExtension(PVRTC_WEBKIT_ALIAS) != null;
  return config;
}

/** Second-chance probe when the throwaway THREE renderer cannot be built: the
 *  capability answer only needs getExtension, not a full renderer, and a raw
 *  context can outlive renderer-construction failures (a partial WebGL host,
 *  a three-internal throw). Returns null when no context exists at all. */
function rawContextWorkerConfig(): Ktx2WorkerConfig | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const gl =
      (canvas.getContext('webgl2') as RawGlContext | null) ??
      (canvas.getContext('webgl') as RawGlContext | null);
    if (!gl) return null;
    const config = ktx2WorkerConfigFromRawContext(gl);
    // Release the probe context promptly (browsers cap ~16 live contexts).
    const lose = gl.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null;
    lose?.loseContext?.();
    return config;
  } catch {
    return null;
  }
}

function detectViaThrowawayContext(loader: KTX2Loader): void {
  let probe: THREE.WebGLRenderer | null = null;
  try {
    // Node test hosts drive loadGltf without a DOM; they take the fallback
    // arms below instead of a renderer probe.
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    probe = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    loader.detectSupport(probe);
  } catch {
    // No probe renderer. Before surrendering to uncompressed RGBA, ask a raw
    // context directly: real capability keeps textures GPU-compressed, which
    // is the entire memory story of the KTX2 conversion.
    const raw = rawContextWorkerConfig();
    if (raw) {
      // Dev-channel English: the renderer probe failed but the capability
      // answer is real; note the degraded path without the RGBA cost.
      console.warn('[ktx2] no probe renderer; using raw WebGL context capability');
      loader.workerConfig = raw;
    } else {
      // No context of any kind (DOM-less host, exhausted pool): fall back to
      // transcoding into plain RGBA. RGBA is the ONLY universally-safe target
      // here: no compressed format is guaranteed without asking a real
      // context, and KTX2Loader.load throws outright on a null workerConfig,
      // so deferring the decision would fail every model parse instead.
      // Dev-channel English: this restores the decoded-bitmap footprint the
      // KTX2 conversion exists to remove, so it must be visible in a console.
      console.warn('[ktx2] no probe context; transcoding to uncompressed RGBA');
      loader.workerConfig = {
        astcSupported: false,
        etc1Supported: false,
        etc2Supported: false,
        dxtSupported: false,
        bptcSupported: false,
        pvrtcSupported: false,
      };
    }
  } finally {
    try {
      probe?.forceContextLoss();
      probe?.dispose();
    } catch {
      // Best-effort teardown; the probe context is unreachable afterwards
      // either way and the browser reclaims lost contexts.
    }
  }
}

interface Ktx2CreateTextureHost {
  _createTexture?: (buffer: ArrayBuffer, config?: object) => Promise<unknown>;
}

/** Wrap loader._createTexture so every transcoded texture's SOURCE KTX2 bytes
 *  reach the mip-release stash. The copy is taken BEFORE the original runs:
 *  _createTexture transfers its buffer to the transcode worker, which detaches
 *  it in this thread. `shouldCapture` is read per call: an entry that never
 *  opted in to mip release (editor, guide) pays no copy at all. Exported for
 *  direct unit coverage; returns false (no wrap, mips stay resident for the
 *  session) if a three bump renames the hook, so a version drift degrades to
 *  the pre-release behavior instead of breaking loads. */
export function wrapKtx2CreateTexture(
  host: Ktx2CreateTextureHost,
  stash: (texture: unknown, source: ArrayBuffer) => void,
  shouldCapture: () => boolean = () => true,
): boolean {
  const original = host._createTexture;
  if (typeof original !== 'function') return false;
  host._createTexture = function wrapped(this: unknown, buffer: ArrayBuffer, config?: object) {
    if (!shouldCapture()) return original.call(this, buffer, config);
    const source = buffer.slice(0);
    return original.call(this, buffer, config).then((texture) => {
      stash(texture, source);
      return texture;
    });
  };
  return true;
}

/** Build the restore re-transcode for the mip-release registry from the
 *  UNWRAPPED _createTexture, so restore transcodes are never re-stashed (a
 *  re-stash per context loss would grow the registry unboundedly). The
 *  registry passes a private copy because the transcode detaches its input.
 *  Exported for direct unit coverage. */
export function buildKtx2Rederive(
  loader: object,
  original: (buffer: ArrayBuffer, config?: object) => Promise<unknown>,
): (source: ArrayBuffer) => Promise<{ mipmaps: Ktx2MipLevel[]; format: number }> {
  return async (source) => {
    const texture = (await original.call(loader, source)) as {
      mipmaps?: unknown;
      format?: unknown;
      dispose?: () => void;
    };
    const mipmaps = texture.mipmaps;
    const format = texture.format;
    // Only the mip chain and format survive; the throwaway texture (never
    // uploaded, so no GPU side) is disposed deterministically either way.
    texture.dispose?.();
    if (!Array.isArray(mipmaps) || typeof format !== 'number') {
      throw new Error('ktx2 restore transcode returned no mip chain');
    }
    return { mipmaps: mipmaps as Ktx2MipLevel[], format };
  };
}

/** Wire the mip-release capture + restore hooks onto the shared loader.
 *  _createTexture is a KTX2Loader private (a shape this file already owns on
 *  the workerConfig fallback arm; re-verify on any three bump). */
function wireMipRelease(loader: KTX2Loader): void {
  const host = loader as unknown as Ktx2CreateTextureHost;
  const original = host._createTexture;
  if (
    typeof original !== 'function' ||
    !wrapKtx2CreateTexture(host, stashKtx2TranscodeSource, isKtx2MipReleaseEnabled)
  ) {
    // Dev-channel English: a three bump moved the private hook; textures keep
    // their CPU mip chains for the session (the pre-release behavior).
    console.warn('[ktx2] KTX2Loader._createTexture unavailable; mip release inactive');
    return;
  }
  setKtx2MipRederive(buildKtx2Rederive(loader, original));
}

/** The shared KTX2 transcoder, initialized on first use. Attach to a
 *  GLTFLoader via setKTX2Loader before parsing any public/models GLB. */
export function ktx2Loader(): KTX2Loader {
  if (!ktx2) {
    ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath(TRANSCODER_PATH);
    detectViaThrowawayContext(ktx2);
    wireMipRelease(ktx2);
  }
  return ktx2;
}

export const ktx2InternalsForTest = {
  reset(): void {
    ktx2 = null;
  },
};
