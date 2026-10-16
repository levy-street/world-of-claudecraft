// The trash engine's two painted glyphs (canvas textures, built once at the
// coordinator's construction so its gated attach uploads them before the
// first draw), and the billboard shader that floats them:
//  - the USE glyph over a usable body (a boot kicking, in a badge): an
//    opportunity, so it is mint and white, never a threat colour;
//  - the BRAND on a branded player's chest (a red-hot branding mark).
// Null without a DOM (headless tests): the painters then draw nothing for
// them and every other piece still runs.

import * as THREE from 'three';

const SIZE = 128;

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  return ctx ? [c, ctx] : null;
}

function texture(c: HTMLCanvasElement, name: string): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.name = name;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The use glyph: a dark badge, a mint rim, a boot mid-kick with its swoosh. */
export function useGlyphTexture(): THREE.CanvasTexture | null {
  const made = canvas();
  if (!made) return null;
  const [c, ctx] = made;
  const m = SIZE / 2;
  const glow = ctx.createRadialGradient(m, m, 30, m, m, 64);
  glow.addColorStop(0, 'rgba(120,255,200,0.35)');
  glow.addColorStop(1, 'rgba(120,255,200,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.beginPath();
  ctx.arc(m, m, 44, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,26,24,0.82)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(157,255,207,1)';
  ctx.stroke();
  // The boot: a shaft, a heel and a toe swung forward.
  ctx.save();
  ctx.translate(m + 4, m + 2);
  ctx.rotate(-0.42);
  ctx.beginPath();
  ctx.moveTo(-12, -30);
  ctx.lineTo(6, -30);
  ctx.lineTo(8, 4);
  ctx.quadraticCurveTo(26, 6, 30, 16);
  ctx.lineTo(30, 22);
  ctx.lineTo(-14, 22);
  ctx.lineTo(-14, 12);
  ctx.closePath();
  ctx.fillStyle = '#f2fff8';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(30,90,70,1)';
  ctx.stroke();
  ctx.restore();
  // The swoosh of the kick behind it.
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(157,255,207,0.95)';
  for (let i = 0; i < 3; i++) {
    ctx.lineWidth = 4 - i;
    ctx.beginPath();
    ctx.arc(m + 6, m + 6, 24 + i * 7, Math.PI * 0.62, Math.PI * 0.95);
    ctx.stroke();
  }
  return texture(c, 'trashEngineUseGlyph');
}

/** The brand: a red-hot mark burned in, a ring round a forked iron. */
export function brandGlyphTexture(): THREE.CanvasTexture | null {
  const made = canvas();
  if (!made) return null;
  const [c, ctx] = made;
  const m = SIZE / 2;
  const glow = ctx.createRadialGradient(m, m, 6, m, m, 62);
  glow.addColorStop(0, 'rgba(255,200,120,0.9)');
  glow.addColorStop(0.45, 'rgba(255,90,30,0.45)');
  glow.addColorStop(1, 'rgba(255,40,10,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (w: number, style: string) => {
    ctx.lineWidth = w;
    ctx.strokeStyle = style;
    ctx.beginPath();
    ctx.arc(m, m, 34, 0, Math.PI * 2);
    ctx.moveTo(m, m + 26);
    ctx.lineTo(m, m - 22);
    ctx.moveTo(m - 16, m - 8);
    ctx.lineTo(m - 16, m - 22);
    ctx.moveTo(m + 16, m - 8);
    ctx.lineTo(m + 16, m - 22);
    ctx.moveTo(m - 16, m - 8);
    ctx.quadraticCurveTo(m, m + 6, m + 16, m - 8);
    ctx.stroke();
  };
  stroke(13, 'rgba(120,20,6,0.85)');
  stroke(8, 'rgba(255,110,40,1)');
  stroke(3.5, 'rgba(255,240,200,1)');
  return texture(c, 'trashEngineBrandGlyph');
}

/** A camera-facing quad at its object's spot, `uSize` yards across, pulled
 *  `uPull` yards toward the camera (so a chest mark sits in front of the
 *  body it marks instead of inside it). */
export const BILLBOARD_VERT = /* glsl */ `
uniform float uSize;
uniform float uPull;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  mv.xyz += normalize(-mv.xyz) * uPull;
  gl_Position = projectionMatrix * mv;
}
`;

export const BILLBOARD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(t.rgb * uTint, t.a * uAlpha);
}
`;

/** A billboard material on a glyph (normal blending, no depth write). */
export function billboardMaterial(
  name: string,
  map: THREE.Texture | null,
  pull: number,
  additive: boolean,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      uMap: { value: map },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uAlpha: { value: 1 },
      uSize: { value: 1 },
      uPull: { value: pull },
    },
    vertexShader: BILLBOARD_VERT,
    fragmentShader: BILLBOARD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}
