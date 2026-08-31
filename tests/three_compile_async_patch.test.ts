import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { sourceFilesUnder } from './helpers/source_files_under';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

describe('three compileAsync disposal race patch', () => {
  it('keeps the installed three currentProgram guard applied', () => {
    // Install-integrity trap: compileAsync polls after a churned material can
    // lose its renderer properties. A three upgrade must re-evaluate the race.
    // Re-evaluated for the 0.185.1 train: upstream r185 still ships the
    // unguarded poll, so the guard was re-authored against 0.185.1.
    //
    // Scope: patches/three@0.185.1.patch covers build/three.module.js ONLY.
    // build/three.cjs and build/three.module.min.js still carry the race, and
    // the r185 split added more uncovered bundles: three.core(.min).js (no
    // WebGLRenderer, but a direct import is a second class-identity copy of
    // everything three.module.js re-exports), and three.webgpu(.nodes)(.min).js
    // plus three.tsl(.min).js, whose own compileAsync is unpatched (the
    // "./webgpu" and "./tsl" export subpaths resolve straight to them). The
    // bundle-scope guard below proves nothing outside node_modules consumes
    // any of them: no CommonJS require('three') (which would resolve the
    // package's "require" export condition to three.cjs), no import naming an
    // unpatched bundle directly, and no three/webgpu or three/tsl subpath
    // import. three/src IS reachable today
    // (tests/shadow_pass_gate_three.test.ts deep-imports
    // three/src/renderers/webgl/WebGLBufferRenderer.js), but that module never
    // reaches WebGLRenderer, so the claim that holds is: every path that
    // reaches WebGLRenderer resolves to the patched three.module.js. This note
    // lives here instead of inside the .patch file because pnpm-lock.yaml pins
    // the patch file's content hash: editing the patch would invalidate that
    // pin and break pnpm install --frozen-lockfile.
    const source = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );

    // Plain includes + message keeps a failure legible: a toContain miss would
    // dump the whole 1.28 MB bundle into the reporter. The needle pins the
    // guard TOGETHER with its delete: the bare 'if ( program === undefined )'
    // spelling also matches three's own acquireProgram (and the unpatched
    // three.cjs), so alone it cannot distinguish patched from unpatched.
    expect(
      source.includes(
        'if ( program === undefined ) {\n\n\t\t\t\t\t\t\tmaterials.delete( material );',
      ),
      'the three compileAsync patch is not applied; re-run pnpm install',
    ).toBe(true);
    expect(
      source.includes('three compileAsync disposal race'),
      'the three compileAsync patch marker comment is missing; re-run pnpm install',
    ).toBe(true);
  });

  it('keeps the bounded isReady poll pass applied', () => {
    // Second patch hunk: one checkMaterialsReady pass queries a bounded,
    // round-robin slice of the pending materials instead of forEach over all
    // of them. Each COMPLETION_STATUS_KHR query is a synchronous GPU-process
    // round-trip; the unbounded pass measured 10.2 s on the production main
    // thread with a link-backlogged GPU process (hitch-hunt S3/S5).
    const source = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );
    expect(
      source.includes('const POLL_PASS_BUDGET_MS = 2;'),
      'the bounded isReady poll-pass patch is not applied; re-run pnpm install',
    ).toBe(true);
    expect(
      source.includes('pending[ ( pollCursor + i ) % pending.length ]'),
      'the round-robin cursor of the bounded poll pass is missing; re-run pnpm install',
    ).toBe(true);
    // Round-robin is only real if the cursor ADVANCES on an early break and
    // the break fires only after at least one query: without the advance,
    // every pass restarts at index 0 and the tail of a large pending set is
    // never polled (starvation).
    expect(
      source.includes('pollCursor = ( pollCursor + i + 1 ) % pending.length;'),
      'the round-robin cursor advance is missing; re-run pnpm install',
    ).toBe(true);
    expect(
      source.includes('&& i + 1 < pending.length'),
      'the at-least-one-query-per-pass guard is missing; re-run pnpm install',
    ).toBe(true);
    // Per-poller backoff: every concurrent compileAsync promise owns its own
    // poll timer, so without backoff N pollers each paying an expensive query
    // every 10 ms own the whole main thread under a link backlog (measured
    // sub-1-fps locally). The interval doubles on an expensive pass, resets
    // ONLY on cheap queries (progress does not reset it: one ready material
    // per 30 ms pass would otherwise reset to 10 ms every time and still own
    // most of the main thread), and the computed interval must actually
    // reach the timer.
    expect(
      source.includes('const POLL_INTERVAL_MIN_MS = 10;'),
      'the poll-interval floor is missing; re-run pnpm install',
    ).toBe(true);
    expect(
      source.includes('const POLL_INTERVAL_MAX_MS = 320;'),
      'the poll-interval backoff cap is missing; re-run pnpm install',
    ).toBe(true);
    expect(
      source.includes(
        'passMs < POLL_PASS_BUDGET_MS\n\t\t\t\t\t\t\t? POLL_INTERVAL_MIN_MS\n\t\t\t\t\t\t\t: Math.min( POLL_INTERVAL_MAX_MS, pollIntervalMs * 2 );',
      ),
      'the cheap-pass-only reset arm of the backoff is missing; re-run pnpm install',
    ).toBe(true);
    expect(
      source.includes('setTimeout( checkMaterialsReady, pollIntervalMs );'),
      'the backoff interval never reaches the reschedule timer; re-run pnpm install',
    ).toBe(true);
    // The unbounded spelling must be GONE: the patch replaces the forEach
    // pass, it does not add a second loop beside it. Positive control: the
    // deliberately UNPATCHED sibling bundle still carries the spelling
    // exactly once, so the needle is proven matchable.
    expect(
      source.includes('materials.forEach( function ( material ) {'),
      'the unbounded materials.forEach poll pass is back; the bounded-pass patch no longer replaces it',
    ).toBe(false);
    const unpatchedSibling = readFileSync(
      new URL('../node_modules/three/build/three.cjs', import.meta.url),
      'utf8',
    );
    expect(
      unpatchedSibling.split('materials.forEach( function ( material ) {').length - 1,
      'the unpatched three.cjs control no longer matches the needle; the GONE pin above may be vacuous',
    ).toBe(1);
  });

  it('keeps the per-pass program query dedup applied', () => {
    // Third patch hunk (ported from the upstream r165 patch): materials share
    // linked programs through the program cache, and isReady() only caches a
    // POSITIVE result, so while a shared program links every material holding
    // it repaid the synchronous COMPLETION_STATUS_KHR query inside the same
    // pass. The dedup pays one not-ready verdict per DISTINCT program per pass.
    const source = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );
    expect(
      source.includes('const notReadyThisPass = new Set();'),
      'the per-pass program dedup set is missing; re-run pnpm install',
    ).toBe(true);
    // Both halves must survive: the skip arm consults the set BEFORE paying
    // the query, and a not-ready verdict actually enters the set. Either half
    // alone silently degrades back to one query per material.
    expect(
      source.includes('} else if ( notReadyThisPass.has( program ) === false ) {'),
      'the dedup skip arm no longer guards the isReady query; re-run pnpm install',
    ).toBe(true);
    expect(
      source.includes('notReadyThisPass.add( program );'),
      'not-ready programs never enter the dedup set, so the skip arm is vacuous; re-run pnpm install',
    ).toBe(true);
    // The dedup is only real while the guarded branch owns the ONLY isReady
    // call site: a second query outside the notReadyThisPass guard would pass
    // every needle above while silently paying one query per material again.
    // Positive control: the unpatched three.cjs also carries exactly one call,
    // so the count needle is proven matchable.
    expect(
      source.split('program.isReady()').length - 1,
      'a second program.isReady() call site appeared; the guarded branch no longer owns the only query',
    ).toBe(1);
    const unpatchedSibling = readFileSync(
      new URL('../node_modules/three/build/three.cjs', import.meta.url),
      'utf8',
    );
    expect(
      unpatchedSibling.split('program.isReady()').length - 1,
      'the three.cjs control no longer matches program.isReady(); the count pin above may be vacuous',
    ).toBe(1);
  });
});

describe('three released program retention patch', () => {
  // Fourth patch hunk (WebGLPrograms): upstream destroys a program the moment
  // its last material releases it, so a material disposed and re-minted under
  // the same cache key (a streamed prop cell unloading and reloading, one
  // player of a class leaving and another arriving) links the same program
  // again, cold, on the main thread; production 2026-08-19 showed 13 of the 18
  // worst live link stalls with a byte-identical cache key to a program that
  // had existed. Released programs stay linked in a bounded FIFO and
  // acquireProgram hands one back as if it had never left.
  const source = readFileSync(
    new URL('../node_modules/three/build/three.module.js', import.meta.url),
    'utf8',
  );

  it('keeps the retention applied: a released program is parked, not destroyed', () => {
    expect(
      source.includes('const RETAINED_PROGRAM_LIMIT = 64;'),
      'the retention bound is missing; re-run pnpm install',
    ).toBe(true);
    // The release arm parks and evicts the OLDEST past the bound (a count,
    // never a timer); the destroy body is the upstream one, moved.
    expect(
      source.includes(
        'if ( -- program.usedTimes === 0 ) {\n\n\t\t\tretainedPrograms.push( program );\n\n\t\t\tif ( retainedPrograms.length > RETAINED_PROGRAM_LIMIT ) destroyProgram( retainedPrograms.shift() );',
      ),
      'the release arm no longer parks the program under the bound; re-run pnpm install',
    ).toBe(true);
    // The acquire arm un-parks: without the splice a re-acquired program
    // would still sit in the FIFO and be destroyed under a live material at
    // eviction, which is worse than the upstream behavior.
    expect(
      source.includes(
        'if ( program.usedTimes === 0 ) {\n\n\t\t\t\tconst r = retainedPrograms.indexOf( program );\n\t\t\t\tif ( r !== - 1 ) retainedPrograms.splice( r, 1 );',
      ),
      'the acquire arm no longer un-parks a retained program; re-run pnpm install',
    ).toBe(true);
    // The upstream immediate-destroy spelling must be GONE from the release
    // arm. Positive control: the unpatched three.cjs still carries it once.
    const immediate = 'if ( -- program.usedTimes === 0 ) {\n\n\t\t\t// Remove from unordered set';
    expect(
      source.includes(immediate),
      'the upstream immediate destroy is back beside the retention; re-run pnpm install',
    ).toBe(false);
    const unpatchedSibling = readFileSync(
      new URL('../node_modules/three/build/three.cjs', import.meta.url),
      'utf8',
    );
    expect(
      unpatchedSibling.split(immediate).length - 1,
      'the three.cjs control no longer matches the immediate-destroy needle; the GONE pin may be vacuous',
    ).toBe(1);
  });

  it('destroys an evicted program out of BOTH the list and the key map', () => {
    // The worst failure mode of the hunk: a re-rolled patch that dropped the
    // map delete would let acquireProgram hand back a DESTROYED program under
    // a known key. The destroy body is upstream's, moved whole.
    expect(
      source.includes(
        'function destroyProgram( program ) {\n\n\t\t// Remove from unordered set\n\t\tconst i = programs.indexOf( program );\n\t\tprograms[ i ] = programs[ programs.length - 1 ];\n\t\tprograms.pop();\n\n\t\t// Remove from map\n\t\tprogramsMap.delete( program.cacheKey );\n\n\t\t// Free WebGL resources\n\t\tprogram.destroy();',
      ),
      'destroyProgram no longer removes from the list, the map and the GL context together; re-run pnpm install',
    ).toBe(true);
  });

  it('exposes the retained list for monitoring beside info.programs', () => {
    expect(
      source.includes('retainedPrograms: retainedPrograms,'),
      'WebGLPrograms no longer returns its retained list; re-run pnpm install',
    ).toBe(true);
    expect(
      source.includes('info.retainedPrograms = programCache.retainedPrograms;'),
      'renderer.info.retainedPrograms is missing; re-run pnpm install',
    ).toBe(true);
  });
});

describe('three degenerate normal guard patch', () => {
  // The one SHADER hunk of the same patch file, pinned here beside the
  // compileAsync hunks because they share one .patch and one scope note: the
  // patch covers build/three.module.js only, and the bundle-scope guard below
  // is what proves nothing in this tree consumes an unpatched sibling.
  //
  // three's stock normal_fragment_begin runs normalize() on an interpolated
  // vertex normal whose length underflows to zero on grass tufts and grazing
  // building edges, which yields NaN. That NaN poisons both cube_uv IBL inputs
  // (the sample direction through geometryNormal, and material.roughness
  // through geometryRoughness = dFdx/dFdy of nonPerturbedNormal) and the bloom
  // blur smears it frame wide, so OutputGradePass tonemapped the whole frame to
  // black on Linux + NVIDIA + Chrome (ANGLE-GL). The guard resets the normal to
  // a valid unit vector when its squared length is zero; it is a no-op for
  // finite normals.
  it('keeps the guard applied on both normal_fragment_begin arms', () => {
    const source = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );
    // The smooth arm, pinned TOGETHER with the #ifdef DOUBLE_SIDED that follows
    // it: the guard has to sit BEFORE the faceDirection flip, so the fallback
    // normal is flipped too. Guarding after the flip would still catch the NaN
    // (dot(NaN,NaN) > 0.0 is false) but would hand a back face a front-facing
    // fallback, so the order is the assertion, not just the presence.
    expect(
      source.includes(
        'vec3 normal = normalize( vNormal ); normal = dot( normal, normal ) > 0.0 ' +
          '? normal : vec3( 0.0, 0.0, 1.0 );\\n\\t#ifdef DOUBLE_SIDED\\n\\t\\tnormal *= faceDirection;',
      ),
      'the degenerate-normal guard is missing on the smooth arm, or no longer precedes the DOUBLE_SIDED flip; re-run pnpm install',
    ).toBe(true);
    // The FLAT_SHADED arm, anchored on the #else that closes it: dFdx/dFdy of
    // vViewPosition degenerates the same way on a zero-area fragment quad.
    expect(
      source.includes(
        'vec3 normal = normalize( cross( fdx, fdy ) ); normal = dot( normal, normal ) > 0.0 ' +
          '? normal : vec3( 0.0, 0.0, 1.0 );\\n#else',
      ),
      'the degenerate-normal guard is missing on the FLAT_SHADED arm; re-run pnpm install',
    ).toBe(true);
  });

  it('leaves no unguarded normalize spelling behind on either arm', () => {
    // The patch REPLACES the stock chunk string, it does not add a second one:
    // both stock spellings must be gone, or a build is still compiling the
    // unguarded chunk. Positive control: the deliberately unpatched three.cjs
    // carries each spelling exactly once, so both GONE needles are proven
    // matchable rather than vacuously absent.
    const source = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );
    const unpatchedSibling = readFileSync(
      new URL('../node_modules/three/build/three.cjs', import.meta.url),
      'utf8',
    );
    const stockSmooth = 'normalize( vNormal );\\n\\t#ifdef DOUBLE_SIDED';
    const stockFlat = 'normalize( cross( fdx, fdy ) );\\n#else';
    expect(
      source.includes(stockSmooth),
      'the unguarded normalize( vNormal ) spelling is back; the normal guard no longer replaces it',
    ).toBe(false);
    expect(
      source.includes(stockFlat),
      'the unguarded FLAT_SHADED normalize spelling is back; the normal guard no longer replaces it',
    ).toBe(false);
    expect(
      unpatchedSibling.split(stockSmooth).length - 1,
      'the unpatched three.cjs control no longer matches the smooth-arm needle; the GONE pin above may be vacuous',
    ).toBe(1);
    expect(
      unpatchedSibling.split(stockFlat).length - 1,
      'the unpatched three.cjs control no longer matches the FLAT_SHADED needle; the GONE pin above may be vacuous',
    ).toBe(1);
  });
});

describe('three low-tier NaN output scrub patch', () => {
  // Sixth patch hunk (opaque_fragment): the degenerate-normal guard above
  // closes the one KNOWN NaN source on this driver family, but it is only
  // proven for the composer/gradePass path (medium tier and up), which also
  // carries OutputGradePass's own sanitizeFinite scrub as defense in depth
  // (src/render/post_output_grade.ts). Low tier (GfxTier 'low') builds no
  // composer at all (renderer.ts: "low renders direct", a bare
  // webgl.render(scene, camera) straight to the canvas backbuffer) and so has
  // ZERO NaN defense of any kind: any other NaN source on an ANGLE-adjacent
  // driver reaches gl_FragColor unscrubbed and paints black, with no
  // composer stage downstream to catch it. opaque_fragment is the one
  // fragment-shader chunk EVERY lit material includes right before writing
  // gl_FragColor (MeshLambertMaterial and MeshStandardMaterial/Physical
  // alike), so guarding it there closes the gap for every tier and every
  // material kind in one place, the same per-component NaN-to-zero technique
  // OutputGradePass already uses, applied one stage earlier and universally
  // instead of tier-gated.
  it('keeps the guard applied, scrubbing outgoingLight before gl_FragColor', () => {
    const source = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );
    // Anchored on the gl_FragColor assignment that immediately follows it, so
    // the guard's POSITION is asserted, not just its presence: scrubbing
    // after this point would be too late, and scrubbing earlier (before
    // USE_TRANSMISSION's alpha multiply) would miss nothing here since alpha
    // is a separate channel, but keeping it last is what makes it the final
    // word on outgoingLight before the write.
    expect(
      source.includes(
        'outgoingLight.x = ( outgoingLight.x < 0.0 || outgoingLight.x >= 0.0 ) ? outgoingLight.x : 0.0;\\n' +
          'outgoingLight.y = ( outgoingLight.y < 0.0 || outgoingLight.y >= 0.0 ) ? outgoingLight.y : 0.0;\\n' +
          'outgoingLight.z = ( outgoingLight.z < 0.0 || outgoingLight.z >= 0.0 ) ? outgoingLight.z : 0.0;\\n' +
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      ),
      'the low-tier NaN output scrub is missing, or no longer immediately precedes gl_FragColor; re-run pnpm install',
    ).toBe(true);
  });

  it('leaves no unguarded opaque_fragment spelling behind', () => {
    // The patch REPLACES the stock chunk string, it does not add a second
    // one: the stock spelling must be gone, or a build is still compiling
    // the unguarded chunk. Positive control: the deliberately unpatched
    // three.cjs carries the stock spelling exactly once, so the GONE needle
    // is proven matchable rather than vacuously absent.
    const source = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );
    const unpatchedSibling = readFileSync(
      new URL('../node_modules/three/build/three.cjs', import.meta.url),
      'utf8',
    );
    const stock = '#endif\\ngl_FragColor = vec4( outgoingLight, diffuseColor.a );';
    expect(
      source.includes(stock),
      'the unguarded opaque_fragment spelling is back; the NaN scrub no longer replaces it',
    ).toBe(false);
    expect(
      unpatchedSibling.split(stock).length - 1,
      'the unpatched three.cjs control no longer matches the stock needle; the GONE pin above may be vacuous',
    ).toBe(1);
  });

  it('records the hunk in the checked-in patch file', () => {
    // node_modules is reinstalled from patches/three@0.185.1.patch, so the
    // shipped artifact carries the hunk too, as an ADDED line rather than
    // anywhere in its context.
    const patch = readFileSync(new URL('../patches/three@0.185.1.patch', import.meta.url), 'utf8');
    expect(
      patch.includes(
        '+var opaque_fragment = "#ifdef OPAQUE\\ndiffuseColor.a = 1.0;\\n#endif\\n#ifdef USE_TRANSMISSION\\n' +
          'diffuseColor.a *= material.transmissionAlpha;\\n#endif\\noutgoingLight.x = ( outgoingLight.x < 0.0',
      ),
      'the low-tier NaN output scrub is missing from patches/three@0.185.1.patch',
    ).toBe(true);
  });
});

describe('three empty instanced draw skip patch', () => {
  // Fifth patch hunk (WebGLRenderer.projectObject): an InstancedMesh whose
  // count is 0 draws nothing, yet upstream still pushes it into the render
  // list, and renderBufferDirect reaches setProgram (acquiring and, when cold,
  // LINKING the material's program) before renderInstances returns on
  // primcount 0. Measured in this repo: the props far bakes sit at count 0 in
  // near mode (shadow-only casters, restored to count 1 by the app's
  // onBeforeShadow hook) and paid 2.3 s of cold color-program links for zero
  // pixels in the first seconds after the loading curtain on an Intel iGPU
  // (bench batch 17). The SHADOW pass is unaffected by design: WebGLShadowMap
  // traverses the scene itself rather than the render list, and onBeforeShadow
  // has restored count 1 by the time it draws. Known limit: a count 0
  // InstancedMesh no longer receives onBeforeRender or onAfterRender from the
  // color pass.
  const source = readFileSync(
    new URL('../node_modules/three/build/three.module.js', import.meta.url),
    'utf8',
  );
  const stock =
    '\n\t\t\t\t\tif ( ! object.frustumCulled || _frustum.intersectsObject( object ) ) {';

  it('keeps the count 0 skip applied inside projectObject', () => {
    expect(
      source.includes(
        'const drawsNothing = object.isInstancedMesh === true && object.count === 0;',
      ),
      'the empty-instanced skip is not applied; re-run pnpm install',
    ).toBe(true);
    // The flag alone proves nothing: the assertion is that it GATES the push,
    // as the first condition of the mesh branch's frustum test, so a count 0
    // instanced mesh never reaches the render list even while on screen.
    expect(
      source.includes(
        'if ( drawsNothing === false && ( ! object.frustumCulled || ' +
          '_frustum.intersectsObject( object ) ) ) {',
      ),
      'the count 0 flag no longer gates the render-list push; re-run pnpm install',
    ).toBe(true);
  });

  it('leaves no ungated mesh-branch frustum test behind', () => {
    // The patch REPLACES the mesh-branch test, it does not add a second one:
    // the ungated spelling must be gone, or a build still pushes count 0
    // instanced meshes. Positive control: the deliberately unpatched sibling
    // bundle carries the spelling exactly once and carries no skip of its own,
    // so the GONE pin is proven matchable rather than vacuously absent.
    expect(
      source.includes(stock),
      'the ungated mesh-branch frustum test is back; the count 0 skip no longer replaces it',
    ).toBe(false);
    const unpatchedSibling = readFileSync(
      new URL('../node_modules/three/build/three.cjs', import.meta.url),
      'utf8',
    );
    expect(
      unpatchedSibling.split(stock).length - 1,
      'the unpatched three.cjs control no longer matches the ungated needle; the GONE pin may be vacuous',
    ).toBe(1);
    expect(
      unpatchedSibling.includes('object.isInstancedMesh === true && object.count === 0'),
      'the unpatched three.cjs control already carries the skip; the pins above prove nothing',
    ).toBe(false);
  });

  it('records the hunk in the checked-in patch file', () => {
    // node_modules is reinstalled from patches/three@0.185.1.patch, so the
    // shipped artifact carries the hunk too, as an ADDED line rather than
    // anywhere in its context.
    const patch = readFileSync(new URL('../patches/three@0.185.1.patch', import.meta.url), 'utf8');
    expect(
      patch.includes(
        '+\t\t\t\t\tconst drawsNothing = object.isInstancedMesh === true && object.count === 0;',
      ),
      'the empty-instanced skip is missing from patches/three@0.185.1.patch',
    ).toBe(true);
  });
});

// The scan half of the scope note above, so the note is enforced rather than
// trusted: the day a module consumes build/three.cjs (via a bare CommonJS
// require), names any unpatched bundle (three.module.min.js and the r185
// core/webgpu/tsl family), or imports the three/webgpu or three/tsl export
// subpaths that resolve to them, this fails and names the file, with the
// .patch file untouched and its pnpm-lock content-hash pin intact.

/** Roots holding every module this repo runs, tests, or executes as a script. */
const SCAN_ROOTS = ['src', 'server', 'scripts', 'headless', 'electron', 'tests'];

/** node_modules is where the patched package itself lives, and dist is bundled
 *  output rather than a consumption decision made in this tree. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist']);

const REQUIRE_REASON =
  'requires the bare three specifier, which resolves to the unpatched build/three.cjs';
const BUNDLE_REASON = 'names an unpatched three bundle directly';
const SUBPATH_REASON =
  'imports a three export subpath (webgpu/tsl) that resolves to an unpatched bundle';

/** The three spellings that reach an UNPATCHED three bundle. Each needle is
 *  call-shaped or quote-anchored, so this guard's own regex literals (tests/
 *  is a scanned root) cannot match themselves: a regex literal's escapes keep
 *  its source text out of its own language, the same self-match reasoning as
 *  helpers/scan_guard_self_audit.ts. */
const UNPATCHED_CONSUMERS = [
  // A CommonJS require of the bare specifier resolves the package's "require"
  // export condition to build/three.cjs.
  { needle: /require\s*\(\s*['"]three['"]\s*\)/g, reason: REQUIRE_REASON },
  // Any unpatched bundle named directly, in any module syntax (static import,
  // dynamic import(), require, vi.mock): the specifier is always quoted, so
  // the needle anchors on the quotes. r185 split the build, so beyond
  // three.cjs and three.module.min.js this names the core, webgpu (plus
  // .nodes) and tsl bundles and their .min siblings.
  {
    needle:
      /['"]three\/build\/three\.(?:cjs|module\.min\.js|core(?:\.min)?\.js|webgpu(?:\.nodes)?(?:\.min)?\.js|tsl(?:\.min)?\.js)['"]/g,
    reason: BUNDLE_REASON,
  },
  // The "./webgpu" and "./tsl" export subpaths reach three.webgpu.js and
  // three.tsl.js without ever naming a bundle; the closing-quote anchor keeps
  // three/addons/* and three/src/* imports out of the match.
  { needle: /['"]three\/(?:webgpu|tsl)['"]/g, reason: SUBPATH_REASON },
] as const;

/** Strip block and line comments so prose about a require (the scope note
 *  above included) cannot flag. The line arm keeps a `://` in a URL from
 *  eating the rest of its line (#2499); same spelling as the
 *  shader_pow_domain guard's stripper. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface ThreeBundleScan {
  /** How many source files the walk visited, the vacuity pin for an all-clear. */
  filesScanned: number;
  /** One `file:line reason` row per consuming site, empty on a clean tree. */
  offenders: string[];
}

// The corpus is read through helpers/source_files_under.ts, never a walk of
// this guard's own: a consumer can land in any module extension (.ts here,
// .mjs in scripts/, .cjs in electron/), and the recursion is what keeps a file
// that moves down a level inside the scan (#2485, #2489). The mkdtemp fixture
// below drives THIS producer per tests/CLAUDE.md, and the self-audit pins that
// no second, hand-rolled read sits beside it.
function scanForUnpatchedBundleUse(roots: string[], base: string): ThreeBundleScan {
  let filesScanned = 0;
  const offenders: string[] = [];
  for (const root of roots) {
    for (const entry of sourceFilesUnder(join(base, root), { skipDirectories: SKIPPED_DIRS })) {
      filesScanned++;
      const raw = readFileSync(entry.full, 'utf8');
      if (!raw.includes('three')) continue;
      const source = withoutComments(raw);
      for (const { needle, reason } of UNPATCHED_CONSUMERS) {
        needle.lastIndex = 0;
        let match = needle.exec(source);
        while (match !== null) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${root}/${entry.file}:${line} ${reason}`);
          match = needle.exec(source);
        }
      }
    }
  }
  return { filesScanned, offenders };
}

describe('the unpatched three bundles stay unconsumed', () => {
  const scan = scanForUnpatchedBundleUse(SCAN_ROOTS, repoRoot);

  it('finds no bare require of three, no unpatched bundle import, no webgpu/tsl subpath', () => {
    expect(
      scan.offenders,
      'a module reaches a three bundle the compileAsync patch does not cover: extend ' +
        'patches/three@0.185.1.patch to that bundle (and update the scope note in this file) ' +
        'before consuming it',
    ).toEqual([]);
  });

  it('scanned a corpus near the real tree size, so the all-clear is not vacuous', () => {
    // The expected offender set is EMPTY, so a walk that silently collapsed (a
    // renamed root, a broken walker) is indistinguishable from a clean tree in
    // the assertion above. Per tests/CLAUDE.md the floor sits just under the
    // real count: the six roots hold over five thousand source files today,
    // and a floor parked far below that is what would let a whole root leave
    // the scan unnoticed.
    expect(scan.filesScanned).toBeGreaterThan(4500);
  });

  it('reads the tree only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['source_files_under']);
  });

  describe('the producer itself', () => {
    // tests/CLAUDE.md: pin the recursion with a mkdtemp fixture driving this
    // guard's OWN producer. The planted spellings are assembled at runtime (a
    // quote helper, split bundle names) so the real scan of THIS file, which
    // sits inside the tests/ root it scans, cannot match the plants.
    const fixture = mkdtempSync(join(tmpdir(), 'three-bundle-scope-'));
    afterAll(() => rmSync(fixture, { recursive: true, force: true }));

    const single = (text: string) => `'${text}'`;
    const double = (text: string) => `"${text}"`;
    const bareRequire = `require(${single('three')})`;
    const cjsBundle = single('three/build/' + 'three.cjs');
    const minBundle = double('three/build/' + 'three.module.min.js');
    const coreBundle = single('three/build/' + 'three.core.js');
    const webgpuSubpath = double('three/' + 'webgpu');

    mkdirSync(join(fixture, 'root', 'nested', 'deeper'), { recursive: true });
    mkdirSync(join(fixture, 'root', 'node_modules'), { recursive: true });
    mkdirSync(join(fixture, 'root', 'dist'), { recursive: true });
    // The sanctioned spelling: a bare ESM import resolves the "import"
    // condition to the PATCHED three.module.js, so it must not flag.
    writeFileSync(
      join(fixture, 'root', 'clean.ts'),
      `import * as THREE from ${single('three')};\n`,
    );
    writeFileSync(
      join(fixture, 'root', 'spaced.cjs'),
      `const t = require( ${double('three')} );\n`,
    );
    // A URL ahead of the site: the comment stripper must not let its `//` eat
    // the require off the end of the line (#2499).
    writeFileSync(
      join(fixture, 'root', 'nested', 'cjs_require.ts'),
      `const url = ${single('https://x.dev/y')}; const three = ${bareRequire};\n`,
    );
    writeFileSync(
      join(fixture, 'root', 'nested', 'cjs_bundle.js'),
      `const t = await import(${cjsBundle});\n`,
    );
    writeFileSync(
      join(fixture, 'root', 'nested', 'deeper', 'min_import.mjs'),
      `import ${minBundle};\n`,
    );
    // The r185 additions: a split-out core bundle named directly, and the
    // webgpu export subpath that reaches its bundle without naming it.
    writeFileSync(join(fixture, 'root', 'nested', 'core_bundle.ts'), `import ${coreBundle};\n`);
    writeFileSync(
      join(fixture, 'root', 'nested', 'webgpu_subpath.ts'),
      `import ${webgpuSubpath};\n`,
    );
    // The addons subpath is sanctioned (examples/jsm never reaches
    // WebGLRenderer's compileAsync); the closing-quote anchor must leave it be.
    writeFileSync(
      join(fixture, 'root', 'nested', 'addons_clean.ts'),
      `import ${single('three/addons/' + 'controls/OrbitControls.js')};\n`,
    );
    writeFileSync(
      join(fixture, 'root', 'nested', 'commented.ts'),
      `// prose about ${bareRequire} stays legal\nexport {};\n`,
    );
    writeFileSync(join(fixture, 'root', 'nested', 'notes.txt'), `${bareRequire}\n`);
    writeFileSync(
      join(fixture, 'root', 'node_modules', 'dep.js'),
      `module.exports = ${bareRequire};\n`,
    );
    writeFileSync(join(fixture, 'root', 'dist', 'bundle.js'), `module.exports = ${bareRequire};\n`);

    const found = scanForUnpatchedBundleUse(['root'], fixture);

    it('flags each planted consumer, at depth, across module extensions and quote styles', () => {
      expect([...found.offenders].sort()).toEqual([
        `root/nested/cjs_bundle.js:1 ${BUNDLE_REASON}`,
        `root/nested/cjs_require.ts:1 ${REQUIRE_REASON}`,
        `root/nested/core_bundle.ts:1 ${BUNDLE_REASON}`,
        `root/nested/deeper/min_import.mjs:1 ${BUNDLE_REASON}`,
        `root/nested/webgpu_subpath.ts:1 ${SUBPATH_REASON}`,
        `root/spaced.cjs:1 ${REQUIRE_REASON}`,
      ]);
    });

    it('leaves the bare ESM import, prose, addons, non-source files, node_modules and dist alone', () => {
      // Per-dimension negatives: each clean plant holds the exemption for
      // exactly its own case. The corpus count pins that the two skipped
      // DIRECTORIES never entered the walk while the nine clean and planted
      // FILES all did (notes.txt is not a source extension).
      expect(found.offenders.some((row) => row.includes('clean.ts'))).toBe(false);
      expect(found.offenders.some((row) => row.includes('commented.ts'))).toBe(false);
      expect(found.offenders.some((row) => row.includes('addons_clean.ts'))).toBe(false);
      expect(found.filesScanned).toBe(9);
    });
  });
});
