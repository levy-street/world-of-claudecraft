// Engraved floor marks on the Hollow Crypt's terraces: the rite circle cut
// into the Rite Ring (concentric bands of the Gravecallers' glyphs, a faint
// soul-green breath in the grooves), and a worn ossuary rosette on the
// cloister floor round the monument. World marks on the `ground` rung of the
// floor ladder: dark, flat and dim, so every telegraph paints over them, and
// no wedge or grave-sized ring that could be mistaken for one.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { RITE_RING } from './crypt_plan_core';

function glyphCanvas(size: number, rings: number[], seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('floor mark canvas unavailable');
  let s = seed;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const mid = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.fillStyle = 'rgba(255,255,255,1)';
  for (const r of rings) {
    ctx.lineWidth = size * 0.006;
    ctx.beginPath();
    ctx.arc(mid, mid, r * mid, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Glyph bands between the rings: short strokes, hooks and dots.
  for (let b = 0; b + 1 < rings.length; b += 2) {
    const r0 = rings[b] * mid;
    const r1 = rings[b + 1] * mid;
    const band = (r0 + r1) / 2;
    const count = Math.round(band / (size * 0.02));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const len = (r1 - r0) * (0.35 + rnd() * 0.4);
      ctx.save();
      ctx.translate(mid + Math.cos(a) * band, mid + Math.sin(a) * band);
      ctx.rotate(a + Math.PI / 2);
      ctx.lineWidth = size * 0.004;
      ctx.beginPath();
      ctx.moveTo(0, -len / 2);
      ctx.lineTo(0, len / 2);
      if (rnd() < 0.5) ctx.lineTo(len * 0.3, len / 2 - len * 0.25);
      if (rnd() < 0.4) {
        ctx.moveTo(-len * 0.25, 0);
        ctx.lineTo(len * 0.25, 0);
      }
      ctx.stroke();
      if (rnd() < 0.3) {
        ctx.beginPath();
        ctx.arc(len * 0.35, -len * 0.3, size * 0.003, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  // Four spokes to the Remembrance Candles.
  ctx.lineWidth = size * 0.005;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(mid + Math.cos(a) * rings[1] * mid, mid + Math.sin(a) * rings[1] * mid);
    ctx.lineTo(
      mid + Math.cos(a) * rings[rings.length - 1] * mid,
      mid + Math.sin(a) * rings[rings.length - 1] * mid,
    );
    ctx.stroke();
  }
  return c;
}

function markMaterial(canvas: HTMLCanvasElement, glow: number): THREE.ShaderMaterial {
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return new THREE.ShaderMaterial({
    name: 'hollowCryptFloorMark',
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uMap;
      uniform float uTime;
      uniform float uGlow;
      #include <fog_pars_fragment>
      void main() {
        float line = texture2D(uMap, vUv).a;
        float r = length(vUv - 0.5) * 2.0;
        float breath = 0.55 + 0.45 * sin(uTime * 0.8 - r * 6.0);
        // Engraved: the groove darkens the stone and a soul-green ember
        // breathes in it (dim, well under any telegraph's brightness).
        vec3 col = vec3(0.25, 0.85, 0.6) * uGlow * (0.45 + 0.55 * breath);
        gl_FragColor = vec4(col, line * 0.8);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }
    `,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uMap: { value: tex },
      uTime: sharedUniforms.uTime,
      uGlow: { value: glow },
    },
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
}

/** The engraved marks of the necropolis floors (instance-local). */
export function buildCryptFloorMarks(ground: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hollowCryptFloorMarks';
  const rite = new THREE.Mesh(
    new THREE.PlaneGeometry(RITE_RING.r * 1.9, RITE_RING.r * 1.9).rotateX(-Math.PI / 2),
    markMaterial(glyphCanvas(1024, [0.16, 0.22, 0.46, 0.56, 0.86, 0.96], 7), 0.42),
  );
  // Above the terrain's layer lift (every later surface floats a hair higher).
  rite.position.set(RITE_RING.x, RITE_RING.h + 0.2, RITE_RING.z);
  rite.renderOrder = floorVfxRenderOrder('ground', 0);
  group.add(rite);
  const rosette = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2),
    markMaterial(glyphCanvas(512, [0.38, 0.46, 0.8, 0.9], 3), 0.15),
  );
  rosette.position.set(0, ground(0, -30) + 0.2, -30);
  rosette.renderOrder = floorVfxRenderOrder('ground', 0);
  group.add(rosette);
  return group;
}
