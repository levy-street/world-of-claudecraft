// The vendored Basis transcoder must stay free of dynamic code execution.
//
// KTX2Loader runs public/basis/basis_transcoder.js inside a blob-URL worker,
// and a blob worker inherits the CSP of the page that created it. The Electron
// shell's CSP (electron/shell_guards.cjs buildContentSecurityPolicy) allows
// 'wasm-unsafe-eval' but never 'unsafe-eval', so any string-eval in the
// transcoder (new Function / eval) throws EvalError inside the worker, the
// transcoder's ready promise never settles, and every KTX2-textured GLB load
// hangs the loader queue: the v0.32.2/v0.32.3 desktop "Loading world" freeze.
//
// The shipped file carries a local patch replacing embind's four dynamic-code
// sites with the eval-free generic implementations (the shapes Emscripten
// emits with -sDYNAMIC_EXECUTION=0). Re-vendoring the transcoder from a new
// three.js or basis_universal release without that patch reintroduces the
// freeze, which is exactly what these pins catch.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const transcoderSource = read('../public/basis/basis_transcoder.js');
const ktx2LoaderSource = read('../node_modules/three/examples/jsm/loaders/KTX2Loader.js');

// Bare eval( calls; property accesses like foo.eval( would be fine, but none
// exist in either file so the stricter scan stays simple.
const BARE_EVAL = /[^\w.$]eval\s*\(/;

describe('basis transcoder blob worker survives a CSP without unsafe-eval', () => {
  it('has no new Function in the transcoder', () => {
    expect(transcoderSource).not.toContain('new Function');
  });

  it('has no Function construction through the embind new_ helper', () => {
    expect(transcoderSource).not.toContain('new_(Function');
  });

  it('has no bare eval call in the transcoder', () => {
    expect(BARE_EVAL.test(transcoderSource)).toBe(false);
  });

  it('still contains the four patched embind sites (the scan scans the real file)', () => {
    for (const name of [
      'function createNamedFunction',
      'function craftInvokerFunction',
      'function craftEmvalAllocator',
      'function __emval_get_method_caller',
    ]) {
      expect(transcoderSource).toContain(name);
    }
  });

  it('keeps the local-patch banner so a re-vendor is a conscious decision', () => {
    expect(transcoderSource).toContain('WoC local patch');
  });

  it('keeps the KTX2Loader worker glue free of dynamic code too', () => {
    expect(ktx2LoaderSource).not.toContain('new Function');
    expect(BARE_EVAL.test(ktx2LoaderSource)).toBe(false);
  });
});
