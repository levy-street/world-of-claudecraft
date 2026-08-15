// The Frostveil's aurora: long translucent ribbons hung high over the Reach,
// drawn with soft canvas gradients and additive blending so they bloom gently
// on composer tiers. Render-only; update(time) drives a slow shimmer (drift,
// waving opacity) with no per-frame allocation.
import * as THREE from 'three';
import { buildFrostIceFields } from './frost_ice_fields';
import { auroraFadeBand } from './frost_sky_fade_core';

export interface FrostSkyView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  update(time: number, camX: number, camZ: number): void;
}

const RIBBONS = [
  { x: -60, z: 1660, y: 130, len: 420, h: 46, rot: 0.5, tint: 0x62f2b2, phase: 0 },
  { x: 40, z: 1740, y: 150, len: 470, h: 56, rot: -0.35, tint: 0x52e8d8, phase: 2.1 },
  { x: -10, z: 1580, y: 118, len: 360, h: 36, rot: 0.15, tint: 0x96f2da, phase: 4.2 },
  { x: 90, z: 1830, y: 142, len: 340, h: 42, rot: -0.7, tint: 0x72e8a2, phase: 1.3 },
  { x: -90, z: 1800, y: 158, len: 380, h: 40, rot: 0.9, tint: 0x58e8c0, phase: 3.2 },
  { x: 30, z: 1900, y: 136, len: 320, h: 34, rot: -0.15, tint: 0x7af2c8, phase: 5.1 },
] as const;

// Real aurora anatomy: a sharp bright LOWER border that fades upward into
// long ray columns of varying width and strength (the canvas y axis maps to
// curtain height; y=64 is the bottom edge).
function auroraTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // body: brightest just above the lower border, long fade to the top
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.82, 'rgba(255,255,255,0.42)');
  grad.addColorStop(0.93, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 128);
  // ray columns: tall streaks rising from the bright border, uneven
  for (let i = 0; i < 46; i++) {
    const sx = (i * 89 + ((i * i * 31) % 40)) % 512;
    const w = 2 + ((i * 13) % 12);
    const a = 0.08 + ((i * 29) % 12) / 34;
    const top = ((i * 41) % 50) / 100; // rays reach different heights
    const ray = ctx.createLinearGradient(0, 0, 0, 128);
    ray.addColorStop(Math.max(0, top), 'rgba(255,255,255,0)');
    ray.addColorStop(0.88, `rgba(255,255,255,${a})`);
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = ray;
    ctx.fillRect(sx, 0, w, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function buildFrostSky(seed = 0): FrostSkyView {
  const group = new THREE.Group();
  group.name = 'frost-sky';
  const glowLights: THREE.PointLight[] = [];
  group.add(buildFrostIceFields(seed));
  const tex = auroraTexture();
  const ribbons: {
    mat: THREE.MeshBasicMaterial;
    mesh: THREE.Mesh;
    base: number;
    phase: number;
    drift: number;
  }[] = [];

  if (tex) {
    const curtain = (
      r: (typeof RIBBONS)[number],
      tint: number,
      base: number,
      lift: number,
      drift: number,
    ) => {
      const mat = new THREE.MeshBasicMaterial({
        map: tex.clone(),
        color: tint,
        transparent: true,
        opacity: base,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      });
      // gentle S-curve: a few segments with a sine offset baked into the verts
      const geo = new THREE.PlaneGeometry(r.len, r.h * (1 + lift * 0.5), 24, 1);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        pos.setZ(i, Math.sin((px / r.len) * Math.PI * 2 + r.phase + lift * 0.8) * 16);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(r.x, r.y + lift * r.h * 0.55, r.z - lift * 6);
      mesh.rotation.y = r.rot;
      mesh.rotation.x = 0.18; // lean the curtain slightly overhead
      mesh.renderOrder = 2;
      group.add(mesh);
      ribbons.push({ mat, mesh, base, phase: r.phase + lift * 2.4, drift });
    };
    for (const r of RIBBONS) {
      // the main green curtain, and a taller fainter violet veil behind it
      // (real displays crown red-violet above the green border)
      curtain(r, r.tint, 0.8, 0, 0.008);
      curtain(r, 0xa06ae8, 0.3, 1, -0.005);
    }
  }

  return {
    group,
    glowLights,
    update(time: number, camX: number, camZ: number): void {
      // The aurora belongs to the Reach: the curtains hang far above the
      // fog (fog: false, additive), so without this gate every neighboring
      // realm sees them over its horizon. Fade with the CAMERA across the
      // frost rect's edges: its z band, and (now that the Reach is the
      // center strip with realms on both sides) both x borders, so the
      // aurora never shows over the Drakelands east of x 180 nor the
      // Amberfall west of x -180. The boundary math is the pure core
      // frost_sky_fade_core.ts, so its zone-edge value stays testable
      // without a canvas/document.
      const band = auroraFadeBand(camX, camZ);
      for (const r of ribbons) {
        r.mesh.visible = band > 0.001;
        if (!r.mesh.visible) continue;
        // slow curtain shimmer: opacity waves and the ray columns drift
        // (layers drift in opposite directions, which is what sells the
        // depth of a real display)
        r.mat.opacity = r.base * (0.75 + 0.25 * Math.sin(time * 0.21 + r.phase)) * band;
        if (r.mat.map) r.mat.map.offset.x = (time * r.drift + r.phase) % 1;
      }
    },
  };
}
