import { describe, expect, it } from 'vitest';
import {
  patchFogFragmentNanGuard,
  patchOpaqueFragmentNanGuard,
} from '../src/render/final_color_nan_guard_core';

const OPAQUE_WRITE = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
const FOG_WRITE = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );';

// A faithful stand-in for three's real opaque_fragment.glsl.js and
// fog_fragment.glsl.js (r185), reproduced here as literal constants rather
// than read from THREE.ShaderChunk: this file must stay a PURE unit test of
// the string transform, independent of whether some other module in the
// same test run has already patched the live, shared THREE.ShaderChunk
// object (final_color_nan_guard.ts installs itself as an import side
// effect, so any test file that imports it, even transitively, would see
// an already-patched chunk here otherwise).
const SOURCE_OPAQUE_FRAGMENT = `
#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif

#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif

${OPAQUE_WRITE}
`;

const SOURCE_FOG_FRAGMENT = `
#ifdef USE_FOG

	#ifdef FOG_EXP2

		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

	#else

		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );

	#endif

	${FOG_WRITE}

#endif
`;

describe('final color NaN guard core', () => {
  it('scrubs diffuseColor.a unconditionally, immediately before opaque_fragment writes gl_FragColor', () => {
    const patched = patchOpaqueFragmentNanGuard(SOURCE_OPAQUE_FRAGMENT);
    expect(patched).not.toBe(SOURCE_OPAQUE_FRAGMENT);
    const marker = patched.indexOf('// WOC_OPAQUE_NAN_GUARD');
    const alphaScrub = patched.indexOf('diffuseColor.a = ( diffuseColor.a < 0.0');
    const write = patched.indexOf(OPAQUE_WRITE);
    expect(marker).toBeGreaterThan(-1);
    expect(alphaScrub).toBeGreaterThan(marker);
    expect(write).toBeGreaterThan(alphaScrub);
    // After both stock #ifdef blocks that can still change diffuseColor.a
    // (OPAQUE forces 1.0, USE_TRANSMISSION multiplies it): the guard has to
    // be the LAST word on the value, not overwritten again afterward.
    const opaqueBlockEnd = patched.indexOf('#endif', patched.indexOf('#ifdef OPAQUE'));
    const transmissionBlockEnd = patched.indexOf(
      '#endif',
      patched.indexOf('#ifdef USE_TRANSMISSION'),
    );
    expect(alphaScrub).toBeGreaterThan(opaqueBlockEnd);
    expect(alphaScrub).toBeGreaterThan(transmissionBlockEnd);
  });

  it('scrubs outgoingLight (rgb) unconditionally before opaque_fragment writes gl_FragColor', () => {
    const patched = patchOpaqueFragmentNanGuard(SOURCE_OPAQUE_FRAGMENT);
    const alphaScrub = patched.indexOf('diffuseColor.a = ( diffuseColor.a < 0.0');
    const scrubStart = patched.indexOf('outgoingLight.x = ( outgoingLight.x < 0.0');
    const zScrub =
      'outgoingLight.z = ( outgoingLight.z < 0.0 || outgoingLight.z >= 0.0 )' +
      ' ? outgoingLight.z : 0.0;\n';
    const zScrubStart = patched.indexOf(zScrub);
    const scrubEnd = zScrubStart + zScrub.length;
    const write = patched.indexOf(OPAQUE_WRITE);
    expect(scrubStart).toBeGreaterThan(alphaScrub);
    expect(zScrubStart).toBeGreaterThan(scrubStart);
    expect(write).toBeGreaterThan(scrubStart);
    expect(patched.slice(scrubEnd, write).trim()).toBe('');
    expect(patched).not.toContain('#ifndef USE_FOG');
  });

  it('is idempotent on opaque_fragment', () => {
    const once = patchOpaqueFragmentNanGuard(SOURCE_OPAQUE_FRAGMENT);
    const twice = patchOpaqueFragmentNanGuard(once);
    expect(twice).toBe(once);
  });

  it('throws if the opaque_fragment anchor changes', () => {
    expect(() => patchOpaqueFragmentNanGuard('gl_FragColor = vec4( 1.0 );')).toThrow();
  });

  it('scrubs fog_fragment gl_FragColor.rgb after the fog mix, via a local copy', () => {
    const patched = patchFogFragmentNanGuard(SOURCE_FOG_FRAGMENT);
    expect(patched).not.toBe(SOURCE_FOG_FRAGMENT);
    const write = patched.indexOf(FOG_WRITE);
    const localCopy = patched.indexOf('vec3 wocFogNanGuard = gl_FragColor.rgb;');
    const finalWrite = patched.lastIndexOf('gl_FragColor.rgb = wocFogNanGuard;');
    expect(write).toBeGreaterThan(-1);
    expect(localCopy).toBeGreaterThan(write);
    expect(finalWrite).toBeGreaterThan(localCopy);
    // Still inside the #ifdef USE_FOG block the chunk opens with.
    expect(patched.slice(finalWrite)).toContain('#endif');
  });

  it('is idempotent on fog_fragment', () => {
    const once = patchFogFragmentNanGuard(SOURCE_FOG_FRAGMENT);
    const twice = patchFogFragmentNanGuard(once);
    expect(twice).toBe(once);
  });

  it('throws if the fog_fragment anchor changes', () => {
    expect(() => patchFogFragmentNanGuard('gl_FragColor = fogColor;')).toThrow();
  });
});
