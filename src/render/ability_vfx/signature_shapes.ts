import * as THREE from 'three';
import { buildFuryCutShape } from './fury_shapes';
import { buildHarvestShape } from './harvest_shapes';
import { buildIronguardShape, type IronguardShape } from './ironguard_shapes';
import { buildRitualSculpture } from './ritual_sculptures';
import type { Substance } from './signature_core';
import { buildWarriorArea, type WarriorAreaShape } from './warrior_area_shapes';
import { warriorAvatarRuptureShape } from './warrior_avatar_rupture';
import { buildWarriorBlade } from './warrior_blade_shape';
import { warriorGyreShape } from './warrior_gyre_shape';
import { buildWarriorHeavyShape, type WarriorHeavyShape } from './warrior_heavy_shapes';
import { warriorLeapShape } from './warrior_leap_shape';
import { buildWarriorShield } from './warrior_shield_shape';
import {
  buildWarriorPressure,
  WARRIOR_PRESSURE_KINDS,
  type WarriorPressureKind,
} from './warrior_shout_shapes';
export type CrestKind =
  | Substance
  | 'bone'
  | 'ward'
  | 'feather'
  | 'hook'
  | 'chain'
  | 'blood_cut'
  | 'harvest_cut'
  | 'harvest_eruption'
  | 'shield_contact'
  | 'steel_cut'
  | WarriorHeavyShape
  | 'avatar_rupture'
  | 'blood_gyre'
  | 'leap_rupture'
  | WarriorAreaShape
  | IronguardShape
  | WarriorPressureKind;

/** Open, directional surfaces with genuinely different topology. Generated once
 * during preparation; all animation deforms these existing vertices. */
export function buildSignatureShapes(): Map<CrestKind, THREE.BufferGeometry> {
  const shapes = new Map<CrestKind, THREE.BufferGeometry>();
  shapes.set('blood_cut', buildFuryCutShape());
  shapes.set('harvest_cut', buildHarvestShape(false));
  shapes.set('harvest_eruption', buildHarvestShape(true));
  shapes.set('shield_contact', buildWarriorShield());
  shapes.set('steel_cut', buildWarriorBlade());
  for (const kind of ['steel_chop', 'steel_counter', 'steel_execution'] as const)
    shapes.set(kind, buildWarriorHeavyShape(kind));
  shapes.set('avatar_rupture', warriorAvatarRuptureShape());
  shapes.set('blood_gyre', warriorGyreShape());
  shapes.set('leap_rupture', warriorLeapShape());
  shapes.set('steel_storm', buildWarriorArea('steel_storm'));
  shapes.set('steel_reap', buildWarriorArea('steel_reap'));
  for (const kind of ['iron_counter', 'iron_quake', 'iron_fault', 'breach_wedge'] as const)
    shapes.set(kind, buildIronguardShape(kind));
  for (const kind of WARRIOR_PRESSURE_KINDS) shapes.set(kind, buildWarriorPressure(kind));
  for (const kind of ['ice', 'water', 'fire', 'shadow', 'light', 'nature', 'arcane'] as const) {
    const positions: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    if (kind === 'ice' || kind === 'light') {
      const count = kind === 'ice' ? 9 : 5;
      for (let k = 0; k < count; k++) {
        const a = (k * Math.PI * 2) / count,
          r = 0.62 + 0.13 * (k % 3),
          h = 0.65 + (k % 3) * 0.19,
          w = kind === 'ice' ? 0.17 : 0.07;
        const tip = [Math.cos(a) * (r + 0.3), h, Math.sin(a) * (r + 0.3)],
          base = [Math.cos(a) * r, 0, Math.sin(a) * r];
        const ring = [
          [base[0] - w, 0, base[2] - w],
          [base[0] + w, 0, base[2] - w],
          [base[0] + w, 0, base[2] + w],
          [base[0] - w, 0, base[2] + w],
        ];
        for (let f = 0; f < 4; f++) {
          const offset = positions.length / 3;
          positions.push(...ring[f], ...ring[(f + 1) % 4], ...tip);
          uvs.push(k / count, 0, (k + 0.5) / count, 0, (k + 0.25) / count, 1);
          indices.push(offset, offset + 1, offset + 2);
        }
      }
    } else {
      const bands = kind === 'water' ? 1 : kind === 'arcane' ? 3 : kind === 'fire' ? 4 : 5,
        cols = kind === 'water' || kind === 'arcane' ? 40 : 8,
        rows = kind === 'arcane' ? 2 : 14;
      for (let band = 0; band < bands; band++) {
        const base = positions.length / 3;
        for (let j = 0; j <= rows; j++)
          for (let i = 0; i <= cols; i++) {
            const u = i / cols,
              v = j / rows;
            let a: number, r: number, y: number;
            if (kind === 'water') {
              a = (u - 0.5) * Math.PI * 1.45;
              r = 0.5 + v * 0.7 + Math.sin(v * Math.PI) * 0.23 - Math.max(0, v - 0.72) * 1.1;
              y = v * (0.58 + 0.42 * Math.sin(u * Math.PI));
            } else if (kind === 'fire') {
              a = band * Math.PI * 0.5 + (u - 0.5) * (0.85 - v * 0.58) + v * 1.05;
              r = 0.38 + (1 - v) * 0.55;
              y = v * (0.76 + 0.24 * Math.sin(u * Math.PI));
            } else if (kind === 'nature') {
              a = band * Math.PI * 0.4 + (u - 0.5) * Math.sin(v * Math.PI) * 0.9;
              r = 0.18 + Math.sin(v * Math.PI * 0.7) * 0.95;
              y = v * 1.25 + Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.1;
            } else if (kind === 'arcane') {
              a = (u - 0.5) * Math.PI * 1.55 + band * 2.094;
              r = 0.8 + v * 0.065;
              y = 0.22 + Math.sin(u * Math.PI) * 0.55 + band * 0.14;
            } else {
              a = band * Math.PI * 0.4 + (u - 0.5) * (0.5 + v * 0.5) + v * 1.5;
              r = 1 - v * 0.63;
              y = v * (0.8 + 0.2 * Math.sin(u * 9 + band));
            }
            positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
            uvs.push(u, v);
            if (i < cols && j < rows) {
              const n = base + j * (cols + 1) + i;
              indices.push(n, n + 1, n + cols + 1, n + 1, n + cols + 2, n + cols + 1);
            }
          }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    // Sequencer facing is measured from local +Z; the curled sheet opens forward.
    if (kind === 'water') geometry.rotateY(-Math.PI / 2);
    shapes.set(kind, geometry);
  }
  for (const kind of ['bone', 'ward', 'feather'] as const)
    shapes.set(kind, buildRitualSculpture(kind));
  const hook = new THREE.Shape();
  hook.moveTo(-0.08, 0.7);
  hook.lineTo(0.12, 0.7);
  hook.lineTo(0.12, 0.03);
  hook.bezierCurveTo(0.12, -0.36, 0.58, -0.34, 0.52, 0.13);
  hook.lineTo(0.35, 0.02);
  hook.lineTo(0.49, 0.47);
  hook.lineTo(0.73, 0.13);
  hook.bezierCurveTo(0.84, -0.62, -0.08, -0.68, -0.08, 0.03);
  hook.closePath();
  const grapnel = new THREE.ExtrudeGeometry(hook, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.025,
    bevelSegments: 2,
    curveSegments: 12,
    steps: 1,
  });
  grapnel.translate(-0.25, 0, -0.06);
  shapes.set('hook', grapnel);
  // Twelve interlocked, alternating steel links: one prepared draw, no glowing
  // ribbon masquerading as a chain. Local Z spans one unit of tether length.
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let link = 0; link < 12; link++) {
    const base = positions.length / 3;
    for (let i = 0; i <= 16; i++)
      for (let j = 0; j <= 5; j++) {
        const a = (i / 16) * Math.PI * 2,
          b = (j / 5) * Math.PI * 2;
        const side = Math.cos(a) * (0.075 + Math.cos(b) * 0.022);
        const depth = Math.sin(b) * 0.022;
        const z = (link + 0.5 + Math.sin(a) * (0.6 + Math.cos(b) * 0.13)) / 12;
        positions.push(link % 2 ? depth : side, link % 2 ? side : depth, z);
        uvs.push(i / 16, j / 5);
        if (i < 16 && j < 5) {
          const n = base + i * 6 + j;
          indices.push(n, n + 1, n + 6, n + 1, n + 7, n + 6);
        }
      }
  }
  const chain = new THREE.BufferGeometry();
  chain.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  chain.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  chain.setIndex(indices);
  chain.computeVertexNormals();
  shapes.set('chain', chain);
  return shapes;
}
