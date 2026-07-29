import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { streetlampEmissiveInternalsForTest } from '../src/render/streetlamp_emissive';
import {
  attachStreetlampFlame,
  streetlampFlameInternalsForTest,
} from '../src/render/streetlamp_flame';

/** The chunks three's standard material gives us to splice into. */
function fakeShader() {
  return {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: ['#include <common>', '#include <begin_vertex>'].join('\n'),
    fragmentShader: ['#include <common>', '#include <emissivemap_fragment>'].join('\n'),
  };
}

function compile(material: THREE.Material, shader: ReturnType<typeof fakeShader>) {
  (material.onBeforeCompile as unknown as (s: typeof shader, r: unknown) => void)(shader, {});
}

describe('streetlamp flame animation', () => {
  it('drives the flame off the shared clock and its own measured height', () => {
    const material = new THREE.MeshStandardMaterial();
    attachStreetlampFlame(material, { baseY: 4.2, height: 0.5 });
    const shader = fakeShader();
    compile(material, shader);

    expect(shader.uniforms.uTime).toBeDefined();
    expect(shader.uniforms.uFlameBase.value).toBe(4.2);
    expect(shader.uniforms.uFlameHeight.value).toBe(0.5);
    expect(material.customProgramCacheKey()).toContain(
      streetlampFlameInternalsForTest.programCacheKey,
    );
  });

  it('moves the tip and pins the base, so a flame stays seated in its bowl', () => {
    const material = new THREE.MeshStandardMaterial();
    attachStreetlampFlame(material, { baseY: 0, height: 1 });
    const shader = fakeShader();
    compile(material, shader);

    // Displacement lands AFTER begin_vertex (so `transformed` exists) and the
    // taper is quadratic in height, which is what holds the base still.
    expect(shader.vertexShader).toContain('#include <begin_vertex>');
    expect(shader.vertexShader).toContain('float lick = flameH * flameH;');
    expect(shader.vertexShader).toContain('transformed.x +=');
    expect(shader.vertexShader).toContain('transformed.z +=');
    expect(shader.vertexShader).toContain('transformed.y +=');
    // every displacement is scaled by lick, so height 0 is exactly unmoved
    for (const line of shader.vertexShader.split('\n')) {
      if (line.includes('transformed.') && line.includes('+=')) {
        const stanza = shader.vertexShader.slice(shader.vertexShader.indexOf(line));
        expect(stanza.slice(0, 220), line.trim()).toContain('lick');
      }
    }
  });

  it('varies phase per instance so neighbouring lamps never flicker in step', () => {
    const material = new THREE.MeshStandardMaterial();
    attachStreetlampFlame(material, { baseY: 0, height: 1 });
    const shader = fakeShader();
    compile(material, shader);
    // One material and one program serve every lamp of a style, so the only
    // available per-fixture signal is the instance's own transform.
    expect(shader.vertexShader).toContain('#ifdef USE_INSTANCING');
    expect(shader.vertexShader).toContain('instanceMatrix[3].xyz');
    expect(shader.fragmentShader).toContain('vFlamePhase');
  });

  it('guttering never extinguishes the flame and tints the tip deeper', () => {
    const { flickerFloor } = streetlampFlameInternalsForTest;
    expect(flickerFloor).toBeGreaterThan(0.5);
    expect(flickerFloor).toBeLessThan(1);
    const material = new THREE.MeshStandardMaterial();
    attachStreetlampFlame(material, { baseY: 0, height: 1 });
    const shader = fakeShader();
    compile(material, shader);
    expect(shader.fragmentShader).toContain('#include <emissivemap_fragment>');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance = mix(');
    // the tip multiplier must fall off in green and blue, or it reads as a
    // dimmer of the same colour rather than as fire cooling toward its tip
    const tip = shader.fragmentShader.match(/vec3\(1\.0,\s*([\d.]+),\s*([\d.]+)\)/);
    if (!tip) throw new Error('flame tip tint missing');
    expect(Number(tip[1])).toBeLessThan(1);
    expect(Number(tip[2])).toBeLessThan(Number(tip[1]));
  });

  it('chains onto an existing onBeforeCompile and attaches only once', () => {
    const material = new THREE.MeshStandardMaterial();
    let priorCalls = 0;
    material.onBeforeCompile = () => {
      priorCalls++;
    };
    attachStreetlampFlame(material, { baseY: 0, height: 1 });
    attachStreetlampFlame(material, { baseY: 9, height: 9 });
    const shader = fakeShader();
    compile(material, shader);
    expect(priorCalls).toBe(1);
    // the second attach was a no-op, so the first shape is still in force
    expect(shader.uniforms.uFlameHeight.value).toBe(1);
  });

  it('keeps the emitter above the bloom knee but inside the ACES hue window', () => {
    // The calibration that matters: BLOOM_THRESHOLD is 1.32 luma in linear HDR
    // and the tonemap is ACES, which desaturates as it compresses. The emitter
    // must clear the knee (or it never blooms) while staying far enough under
    // it that red, green and blue do not all saturate (or the warm flame
    // renders white). A pass that drove gain 7.5 did exactly that.
    const { roleGain } = streetlampEmissiveInternalsForTest;
    const authored = 0.46; // the one luminance every emitter is authored at
    const emitterLuma = authored * roleGain.source;
    expect(emitterLuma).toBeGreaterThan(1.32);
    expect(emitterLuma).toBeLessThan(3.0);
    // and the pane stays under the knee so the housing never washes out
    expect(authored * roleGain.glass).toBeLessThan(1.32);
  });
});
