// Contract: every URL scheme the three.js GLB decoder stack bootstraps through must be
// allowed by the desktop shell CSP (electron/shell_guards.cjs buildContentSecurityPolicy).
//
// The desktop (Electron) shell is the only host that ships a CSP, and only PACKAGED
// builds serve it (electron:dev loads the Vite server, never the app:// handler that
// attaches the header), so a scheme the CSP misses breaks only the packed desktop app,
// which no other suite exercises. That is how the v0.39.0 desktop build hung at world
// entry: three's ZSTDDecoder (KTX2Loader's Zstandard path) boots its WASM via
// fetch("data:application/wasm;base64,...") and connect-src did not list data:.
//
// The scanned surface is DISCOVERED, not hand-listed: every three loaders/libs module
// src/render imports, plus those modules' own relative loaders/libs imports (KTX2Loader
// pulls in zstddec that way), so a renderer that adopts a new decoder grows the scan
// automatically. Literal scheme-prefixed bootstraps (fetch, new Worker, importScripts)
// must be allowed by the matching directive; dynamic URLs (object URLs minted at
// runtime, variable wasm paths) cannot be seen statically, so the known object-URL
// paths are pinned explicitly below. A commented-out bootstrap in a vendored source
// would scan the same as live code; that fails toward a loud spurious red, never a
// silent green. Peer suites: tests/electron_shell_guards.test.ts pins the CSP string;
// tests/basis_transcoder_csp.test.ts pins the eval-free basis transcoder patch. The
// live end-to-end variant is scripts/csp_shell_smoke.mjs (real browser, real CSP).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from '../electron/shell_guards.cjs';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const ROOT = path.resolve(__dirname, '..');
const JSM_ROOT = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm');

function readSource(absPath: string): string {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    throw new Error(
      `cannot read ${absPath}: the three decoder surface moved (upgrade or rename). ` +
        're-derive what the decoder stack bootstraps through and update this suite.',
    );
  }
}

// Seed: every three loaders/libs module the renderer imports ('three/addons/*' is the
// package alias for 'three/examples/jsm/*'). Closure: those modules' own relative
// imports into loaders/libs (this is how KTX2Loader reaches zstddec).
const IMPORT_SPECIFIER =
  /from\s+["']three\/(?:addons|examples\/jsm)\/((?:loaders|libs)\/[^"']+)["']/g;
const RELATIVE_IMPORT = /from\s+["'](\.\.?\/[^"']+)["']/g;

function discoverDecoderSurface(): Map<string, string> {
  const queue: string[] = [];
  for (const { full } of tsFilesUnder(path.join(ROOT, 'src', 'render'))) {
    for (const match of readSource(full).matchAll(IMPORT_SPECIFIER)) queue.push(match[1]);
  }
  const surface = new Map<string, string>();
  while (queue.length > 0) {
    const rel = queue.pop() as string;
    if (surface.has(rel)) continue;
    const source = readSource(path.join(JSM_ROOT, rel));
    surface.set(rel, source);
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const resolved = path
        .normalize(path.join(path.dirname(rel), match[1]))
        .split(path.sep)
        .join('/');
      if (/^(?:loaders|libs)\//.test(resolved)) queue.push(resolved);
    }
  }
  return surface;
}

const decoderSurface = discoverDecoderSurface();

// Literal scheme-prefixed bootstrap targets, mapped to the directive that governs them.
const BOOTSTRAP_SCANS: Array<{ pattern: RegExp; directive: string; api: string }> = [
  { pattern: /\bfetch\(\s*["'`]([a-z][a-z0-9+.-]*):/gi, directive: 'connect-src', api: 'fetch' },
  {
    pattern: /\bnew\s+Worker\(\s*["'`]([a-z][a-z0-9+.-]*):/gi,
    directive: 'worker-src',
    api: 'new Worker',
  },
  {
    pattern: /\bimportScripts\(\s*["'`]([a-z][a-z0-9+.-]*):/gi,
    directive: 'script-src',
    api: 'importScripts',
  },
];

const csp = buildContentSecurityPolicy({ apiOrigin: 'https://worldofclaudecraft.com' });

// Exact token membership, never substring: 'https:' must not match the API origin
// token 'https://worldofclaudecraft.com' (host-scoped sources do not allow other
// hosts, so a decoder that hardcodes a remote fetch must fail here, not pass).
function directiveTokens(name: string): string[] {
  const entry = csp.split('; ').find((d) => d.startsWith(`${name} `));
  expect(entry, `CSP is missing the ${name} directive`).toBeTruthy();
  return (entry as string).split(' ').slice(1);
}

describe('GLB decoder stack vs the desktop shell CSP', () => {
  it('walks src/render only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });

  it('discovers the known decoder surface, so the scan cannot rot silently', () => {
    const files = [...decoderSurface.keys()];
    expect(files).toContain('loaders/GLTFLoader.js');
    expect(files).toContain('loaders/KTX2Loader.js');
    expect(files).toContain('libs/zstddec.module.js');
    expect(files).toContain('libs/meshopt_decoder.module.js');
  });

  it('still sees the zstd data: wasm bootstrap, the v0.39.0 world-entry regression', () => {
    // If a three upgrade removes this, the decoder bootstrap changed shape: re-derive
    // what the new code fetches (or spawns) and update the scans before trusting green.
    expect(decoderSurface.get('libs/zstddec.module.js')).toMatch(
      /fetch\(\s*["'`]data:application\/wasm/,
    );
  });

  it('allows every literal scheme the decoder surface bootstraps through', () => {
    for (const [file, source] of decoderSurface) {
      for (const scan of BOOTSTRAP_SCANS) {
        for (const match of source.matchAll(scan.pattern)) {
          const scheme = match[1].toLowerCase();
          expect(
            directiveTokens(scan.directive),
            `${file} calls ${scan.api} on ${scheme}: URIs, which ${scan.directive} must allow`,
          ).toContain(`${scheme}:`);
        }
      }
    }
  });

  it('keeps blob: allowed for the object-URL paths a static scan cannot see', () => {
    // GLTFLoader hands embedded textures to fetch() as blob: object URLs (a connect-src
    // request), and KTX2Loader runs its transcoder inside a blob worker.
    expect(decoderSurface.get('loaders/GLTFLoader.js')).toContain('createObjectURL');
    expect(decoderSurface.get('loaders/KTX2Loader.js')).toContain('createObjectURL');
    expect(directiveTokens('connect-src')).toContain('blob:');
    expect(directiveTokens('worker-src')).toContain('blob:');
  });

  it('keeps WASM instantiation possible without unsafe-eval', () => {
    expect(decoderSurface.get('libs/zstddec.module.js')).toContain('WebAssembly.instantiate');
    expect(directiveTokens('script-src')).toContain("'wasm-unsafe-eval'");
    expect(directiveTokens('script-src')).not.toContain("'unsafe-eval'");
  });

  it('keeps the data: allowance scoped to fetch and image surfaces, never executable ones', () => {
    for (const name of ['default-src', 'script-src', 'worker-src', 'frame-src', 'object-src']) {
      expect(directiveTokens(name), `${name} must not gain data:`).not.toContain('data:');
    }
    expect(directiveTokens('img-src')).toContain('data:');
  });
});
