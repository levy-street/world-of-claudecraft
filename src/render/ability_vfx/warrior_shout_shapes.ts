import * as THREE from 'three';

export const WARRIOR_PRESSURE_KINDS = [
  'rally_pressure',
  'dread_pressure',
  'challenge_pressure',
  'battle_pressure',
  'embolden_pressure',
  'fear_pressure',
  'piercing_pressure',
] as const;
export type WarriorPressureKind = (typeof WARRIOR_PRESSURE_KINDS)[number];
export const warriorPressureLayers = (kind: WarriorPressureKind) =>
  kind === 'fear_pressure' ? 5 : 3;

/** Voice travels along a purpose-specific shape: lifting standards, a sheltering
 * vault, aggressive points, hooked challenge, oppressive weight or ankle rakes. */
export function warriorPressurePoint(
  kind: WarriorPressureKind,
  layer: number,
  u: number,
  v: number,
  out: { x: number; y: number; z: number },
): void {
  const across = v * 2 - 1,
    swell = Math.sin(u * Math.PI),
    band = layer - 1;
  out.z = u * 9.2;
  if (kind === 'rally_pressure') {
    out.x = across * (0.2 + u * 5.8);
    out.y = swell * (1.1 + Math.sin(v * Math.PI) * (3.5 + layer * 0.5));
    out.z -= Math.abs(across) * swell * 0.8;
  } else if (kind === 'dread_pressure') {
    out.x = across * (0.2 + u * 5.8);
    out.y = (1 - u) * (1.2 + layer * 0.6) + swell * 0.25 - u * Math.abs(across) * 0.2;
    out.z += swell * Math.abs(across) * (0.3 + layer * 0.4);
  } else if (kind === 'battle_pressure') {
    out.x = band * 5.6 * u + across * swell * 0.85;
    out.y = u * (4.8 - Math.abs(band)) + (v - 0.5) * swell * 1.8;
    out.z += swell * across * 0.3;
  } else if (kind === 'embolden_pressure') {
    out.x = band * 5.6 * u + across * swell * (1.1 - u * 0.4);
    out.y = u * (2.8 + (layer % 2) * 2.2) + across * swell * 1.2;
    out.z -= Math.abs(band) * swell * 1.2;
  } else if (kind === 'fear_pressure') {
    out.x = (layer - 2) * 2.8 * u + across * swell;
    out.y = u * (2.6 + (layer % 2) * 1.4) + swell * (0.8 + across * 0.65);
    out.z -= (layer % 2) * u * 0.8;
  } else if (kind === 'piercing_pressure') {
    out.x = band * 5.3 * u + across * swell * 1.4;
    out.y = 0.12 + swell * (0.25 + Math.sin(v * Math.PI) * 0.7);
    out.z += across * Math.sin(u * Math.PI * 4) * swell * 0.2;
  } else {
    out.x = band * (5.6 * u + swell * 0.55) + across * swell * 0.95;
    out.y = swell * (2.4 + band * across * 0.7) + u * 0.2;
    out.z += swell * (0.5 - u * 1.5);
  }
}

/** Fixed, prepared sheets retain painted pressure detail and open negative space. */
export function buildWarriorPressure(kind: WarriorPressureKind): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const columns = 24,
    rows = 8;
  const point = { x: 0, y: 0, z: 0 };
  for (let layer = 0; layer < warriorPressureLayers(kind); layer++) {
    const base = positions.length / 3;
    for (let column = 0; column <= columns; column++)
      for (let row = 0; row <= rows; row++) {
        const u = column / columns,
          v = row / rows;
        warriorPressurePoint(kind, layer, u, v, point);
        positions.push(point.x, point.y, point.z);
        uvs.push(u, v);
        if (column < columns && row < rows) {
          const i = base + column * (rows + 1) + row;
          indices.push(i, i + rows + 1, i + 1, i + 1, i + rows + 1, i + rows + 2);
        }
      }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
