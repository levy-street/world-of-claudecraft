import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  THREE_CACHE_KEY_PARAMETERS,
  THREE_CACHE_KEY_TRAILERS,
} from '../scripts/profiler/gpu_hitch_metrics.mjs';

// The GPU hitch reflection attribution (scripts/profiler/gpu_hitch_metrics.mjs)
// classifies every ACTIVE_UNIFORMS query by what the program's link had already
// done. That classification is only meaningful while three r165 keeps the cycle
// below, so the cycle is pinned here rather than assumed.
//
// Same shape as tests/three_compile_async_patch.test.ts: plain includes over the
// installed build with an explicit message, because a toContain miss would dump
// the whole 1.28 MB bundle into the reporter.
const source = readFileSync(
  new URL('../node_modules/three/build/three.module.js', import.meta.url),
  'utf8',
);

function section(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `three r165 no longer contains ${startMarker}`).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end, `three r165 no longer contains ${endMarker} after ${startMarker}`).toBeGreaterThan(
    start,
  );
  return source.slice(start, end);
}

describe('three r165 program reflection contract', () => {
  it('is reading the revision every message in this file names', () => {
    // Every failure below says "r165". Nothing else here asserts the revision,
    // so a three bump that happens to keep these marker strings would leave the
    // whole file passing while its messages, and the reasoning behind the
    // analyzer's classification, silently referred to the wrong release.
    expect(THREE.REVISION).toBe('165');
  });

  it('resolves readiness through COMPLETION_STATUS_KHR without reflecting', () => {
    // isReady is the whole of what compileAsync waits on. If it ever populated
    // the uniform cache, "settled" would imply "reflected" and the
    // settled-first family in the analyzer would stop meaning anything.
    const isReady = section('this.isReady = function () {', 'this.destroy = function () {');
    expect(
      isReady.includes('gl.getProgramParameter( program, COMPLETION_STATUS_KHR )'),
      'three r165 isReady no longer queries COMPLETION_STATUS_KHR',
    ).toBe(true);
    for (const forbidden of ['onFirstUse', 'ACTIVE_UNIFORMS', 'cachedUniforms']) {
      expect(
        isReady.includes(forbidden),
        `three r165 isReady now touches ${forbidden}; compileAsync settling would imply reflection`,
      ).toBe(false);
    }
  });

  it('defers both reflection caches to the first use of the program', () => {
    const onFirstUse = section('function onFirstUse( self ) {', '// set up caching for uniform');
    expect(
      onFirstUse.includes('cachedUniforms = new WebGLUniforms( gl, program );'),
      'three r165 onFirstUse no longer builds the uniform cache',
    ).toBe(true);
    expect(
      onFirstUse.includes('cachedAttributes = fetchAttributeLocations( gl, program );'),
      'three r165 onFirstUse no longer builds the attribute cache',
    ).toBe(true);

    const getUniforms = section('this.getUniforms = function () {', 'this.getAttributes');
    expect(
      getUniforms.includes('if ( cachedUniforms === undefined ) {') &&
        getUniforms.includes('onFirstUse( this );'),
      'three r165 getUniforms no longer triggers onFirstUse on a cold cache',
    ).toBe(true);

    const getAttributes = section('this.getAttributes = function () {', 'let programReady');
    expect(
      getAttributes.includes('if ( cachedAttributes === undefined ) {') &&
        getAttributes.includes('onFirstUse( this );'),
      'three r165 getAttributes no longer triggers onFirstUse on a cold cache',
    ).toBe(true);
  });

  it('keeps ACTIVE_UNIFORMS and ACTIVE_ATTRIBUTES as the two probed reflection queries', () => {
    // These are the exact pnames scripts/profiler/gpu_hitch_probe.mjs wraps
    // (0x8B86 and 0x8B89). A third reflection query would leave a blind spot.
    expect(
      section('class WebGLUniforms {', 'setValue( gl, name, value').includes(
        'gl.getProgramParameter( program, gl.ACTIVE_UNIFORMS )',
      ),
      'three r165 WebGLUniforms no longer enumerates through ACTIVE_UNIFORMS',
    ).toBe(true);
    expect(
      section(
        'function fetchAttributeLocations( gl, program ) {',
        'function filterEmptyLine',
      ).includes('gl.getProgramParameter( program, gl.ACTIVE_ATTRIBUTES )'),
      'three r165 fetchAttributeLocations no longer enumerates through ACTIVE_ATTRIBUTES',
    ).toBe(true);
  });

  it('keeps the error-reporting queries behind checkShaderErrors, which the renderer disables', () => {
    // onFirstUse also issues getProgramInfoLog / getShaderInfoLog / LINK_STATUS,
    // each a synchronous round-trip that blocks on the link. They are gated, and
    // src/render/renderer.ts turns the gate off unless ?shaderdebug is present,
    // so they are not part of the shipping first-use cost the probe measures.
    const onFirstUse = section('function onFirstUse( self ) {', '// set up caching for uniform');
    expect(
      onFirstUse.includes('if ( renderer.debug.checkShaderErrors ) {'),
      'three r165 onFirstUse no longer gates its info-log queries on checkShaderErrors',
    ).toBe(true);
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(
      renderer.includes(
        "this.webgl.debug.checkShaderErrors = new URLSearchParams(location.search).has('shaderdebug');",
      ),
      'the renderer no longer disables checkShaderErrors by default',
    ).toBe(true);
  });

  it('keeps the cache-key parameter order the analyzer names positions from', () => {
    // variantDiffParameter counts BACKWARDS from the end of the parameter block,
    // because the defines section before it is variable length. Both the order
    // and the fixed trailers must hold or a reported parameter name is wrong.
    const parameters = section(
      'function getProgramCacheKeyParameters( array, parameters ) {',
      'function getProgramCacheKeyBooleans( array, parameters ) {',
    );
    const pushed = [...parameters.matchAll(/array\.push\( parameters\.([A-Za-z0-9_]+) \)/g)].map(
      (match) => match[1],
    );
    expect(pushed).toEqual([...THREE_CACHE_KEY_PARAMETERS]);

    const booleans = section(
      'function getProgramCacheKeyBooleans( array, parameters ) {',
      'function getUniforms( material ) {',
    );
    const booleanPushes = [...booleans.matchAll(/array\.push\( ([^)]+) \)/g)].map((m) => m[1]);
    // Two 32-bit layer sets, so two segments. Getting this wrong shifts every
    // reported parameter name by one.
    expect(booleanPushes, 'the boolean block no longer contributes two mask segments').toEqual([
      '_programLayers.mask',
      '_programLayers.mask',
    ]);
    expect(THREE_CACHE_KEY_TRAILERS).toEqual([
      'programLayersMask1',
      'programLayersMask2',
      'outputColorSpace',
    ]);

    const cacheKey = section(
      'function getProgramCacheKey( parameters ) {',
      'function getProgramCacheKeyParameters',
    );
    expect(
      cacheKey.includes('array.push( renderer.outputColorSpace );'),
      'the output colour space is no longer the segment after the boolean mask',
    ).toBe(true);
    expect(
      cacheKey.includes('array.push( parameters.customProgramCacheKey );') &&
        cacheKey.includes('return array.join();'),
      'the custom cache key is no longer the last comma-joined segment',
    ).toBe(true);
  });

  it('routes every shadow-map draw through renderBufferDirect with a null scene', () => {
    // The probe's shadowPass discriminator is this null, not a heuristic on the
    // material type, and its renderer hook is an instance-level override of
    // renderBufferDirect, so both call sites must keep going through it.
    expect(
      source.includes('renderer.renderBufferDirect( shadowCamera, null, geometry, depthMaterial'),
      'three r165 WebGLShadowMap no longer draws through renderBufferDirect with a null scene',
    ).toBe(true);
    expect(
      source.includes(
        '_this.renderBufferDirect( camera, scene, geometry, material, object, group );',
      ),
      'three r165 no longer dispatches the main pass through the renderer instance property',
    ).toBe(true);
  });
});
