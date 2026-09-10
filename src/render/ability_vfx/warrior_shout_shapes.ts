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

/** Successive acoustic fronts across the surroundings. Their broken segments
 * carry compression edges while the centre and the gaps remain empty air. */
export function warriorPressurePoint(
  kind: WarriorPressureKind,
  layer: number,
  u: number,
  v: number,
  out: { x: number; y: number; z: number },
  fallback = false,
): void {
  const phase = layer / (warriorPressureLayers(kind) - 1);
  const angle = (u - 0.5) * (fallback ? 2.95 : Math.PI * 2);
  const crown = fallback ? Math.sin(u * Math.PI) : Math.abs(Math.cos(angle));
  const harsh = kind === 'fear_pressure' || kind === 'challenge_pressure';
  const tooth = harsh
    ? Math.abs(Math.sin(u * Math.PI * (kind === 'fear_pressure' ? 7 : 3))) * 0.28
    : 0;
  const radius =
    (fallback ? 2.2 + phase * 7.8 : 7.6 + phase * 2.4) -
    v * (fallback ? 0.3 + crown * 0.35 : 0.85 + crown * 0.22) +
    tooth;
  out.x = Math.sin(angle) * radius;
  out.z = Math.cos(angle) * radius;
  const lift =
    kind === 'rally_pressure'
      ? 2.5
      : kind === 'embolden_pressure'
        ? 1.9
        : kind === 'battle_pressure'
          ? 1.6
          : 1.05;
  out.y = 0.1 + crown * lift + v * 0.12;
  if (kind === 'dread_pressure') out.y = 1.35 - crown * 1.05 - phase * 0.18;
  if (kind === 'piercing_pressure') out.y = 0.12 + crown * 1.05 + Math.sin(u * Math.PI * 8) * 0.12;
}

/** Physical breaks between segments prevent the contour becoming a solid
 * circular wall, even before the material's finer grain and dissolution. */
export function buildWarriorPressure(kind: WarriorPressureKind): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const segments = 12,
    columns = 4,
    rows = 3;
  const point = { x: 0, y: 0, z: 0 };
  for (let layer = 0; layer < warriorPressureLayers(kind); layer++) {
    for (let segment = 0; segment < segments; segment++) {
      const base = positions.length / 3;
      for (let column = 0; column <= columns; column++)
        for (let row = 0; row <= rows; row++) {
          const u = (segment + 0.055 + (column / columns) * 0.79) / segments,
            v = row / rows;
          warriorPressurePoint(kind, layer, u, v, point);
          positions.push(point.x, point.y, point.z);
          uvs.push(u, v + layer * 2);
          if (column < columns && row < rows) {
            const i = base + column * (rows + 1) + row;
            indices.push(i, i + rows + 1, i + 1, i + 1, i + rows + 1, i + rows + 2);
          }
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
