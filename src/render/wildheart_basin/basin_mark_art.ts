// The hunt marks' art (Stalked, the Prey): the sigil over the marked player's
// head and the ring of claw rakes under their feet. Painted once on canvases
// (white with a dark outline, tinted per mark by its material), so the jade of
// Zulgar's prey and the red of the jaguar's quarry share one picture.
//
// The marks are ACTIONABLE (who is hunted): basin_boss_fx.ts draws them on
// every tier; this module only paints the textures and builds the ring's
// material.

import * as THREE from 'three';

/** The head sigil: a jaguar's fang crossed over three claw rakes, inside a
 *  broken ring of hunt runes, a soft glow behind. 256 px. */
export function huntSigilTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const m = size / 2;
    const g = ctx.createRadialGradient(m, m, 10, m, m, m - 2);
    g.addColorStop(0, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The broken rune ring.
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass === 0 ? 'rgba(18,6,6,0.9)' : 'rgba(255,255,255,1)';
      ctx.lineWidth = pass === 0 ? 11 : 5;
      for (let k = 0; k < 8; k++) {
        const a0 = (k / 8) * Math.PI * 2 + 0.12;
        ctx.beginPath();
        ctx.arc(m, m, 104, a0, a0 + 0.55);
        ctx.stroke();
      }
      // Notches between the arcs (the runes).
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.05;
        ctx.beginPath();
        ctx.moveTo(m + Math.cos(a) * 92, m + Math.sin(a) * 92);
        ctx.lineTo(m + Math.cos(a) * 116, m + Math.sin(a) * 116);
        ctx.stroke();
      }
    }
    // Three claw rakes, curving down and to the right.
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass === 0 ? 'rgba(18,6,6,0.9)' : 'rgba(255,255,255,1)';
      for (let k = 0; k < 3; k++) {
        const ox = 78 + k * 36;
        ctx.lineWidth = pass === 0 ? 22 - k * 2 : 12 - k * 2;
        ctx.beginPath();
        ctx.moveTo(ox - 14, 58);
        ctx.quadraticCurveTo(ox + 22, 124, ox - 2, 196);
        ctx.stroke();
      }
    }
    // The fang across them: a curved tooth, broad at the root.
    const fang = (fill: string, grow: number) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(60 - grow, 84 - grow);
      ctx.quadraticCurveTo(150, 92, 206 + grow, 176 + grow);
      ctx.quadraticCurveTo(130, 128, 54 - grow, 112 + grow);
      ctx.closePath();
      ctx.fill();
    };
    fang('rgba(18,6,6,0.9)', 6);
    fang('rgba(255,255,255,1)', 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const RING_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The ring under the hunted: a band of claw rakes turning slowly, a hot rim. */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vLocal;
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float a = atan(vLocal.y, vLocal.x) + uTime * 0.6;
  float rim = smoothstep(0.86, 0.93, r) * (1.0 - smoothstep(0.95, 1.0, r));
  // Rakes: slanted triple slashes round the band.
  float k = fract(a * 1.909859);
  float slash = 0.0;
  for (int i = 0; i < 3; i++) {
    float c = 0.2 + float(i) * 0.14;
    slash += 1.0 - smoothstep(0.0, 0.035, abs(k - c - (r - 0.68) * 0.5));
  }
  slash *= smoothstep(0.5, 0.56, r) * (1.0 - smoothstep(0.8, 0.86, r));
  float core = (1.0 - smoothstep(0.0, 0.5, r)) * 0.18;
  float a1 = (rim * 0.95 + slash * 0.75 + core) * uAlpha;
  gl_FragColor = vec4(uColor * (1.0 + rim * 0.6), a1);
}
`;

/** One hunted player's floor ring material (its own colour and beat). */
export function huntRingMaterial(uTime: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'wildheartHuntRing',
    uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
