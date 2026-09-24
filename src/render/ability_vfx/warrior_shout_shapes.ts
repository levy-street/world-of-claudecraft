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

interface WarriorVoiceProfile {
  readonly duration: number;
  readonly gap: number;
  readonly decay: number;
  readonly index: number;
}
const VOICES: Readonly<Record<WarriorPressureKind, WarriorVoiceProfile>> = Object.freeze({
  rally_pressure: Object.freeze({ duration: 0.68, gap: 0.12, decay: 0.65, index: 0 }),
  dread_pressure: Object.freeze({ duration: 0.6, gap: 0.045, decay: 0.72, index: 1 }),
  challenge_pressure: Object.freeze({ duration: 0.52, gap: 0.035, decay: 0.45, index: 2 }),
  battle_pressure: Object.freeze({ duration: 0.5, gap: 0.025, decay: 0.42, index: 3 }),
  embolden_pressure: Object.freeze({ duration: 0.64, gap: 0.1, decay: 0.6, index: 4 }),
  fear_pressure: Object.freeze({ duration: 0.62, gap: 0.055, decay: 0.5, index: 5 }),
  piercing_pressure: Object.freeze({ duration: 0.44, gap: 0.022, decay: 0.36, index: 6 }),
});
export function warriorVoiceProfile(kind: string): WarriorVoiceProfile | undefined {
  return Object.hasOwn(VOICES, kind) ? VOICES[kind as WarriorPressureKind] : undefined;
}

/** Successive acoustic fronts across the surroundings. Their broken segments
 * carry compression edges while the centre and the gaps remain empty air. */
export function warriorPressurePoint(
  kind: WarriorPressureKind,
  layer: number,
  u: number,
  v: number,
  out: { x: number; y: number; z: number },
): void {
  const phase = layer / (warriorPressureLayers(kind) - 1);
  const angle = (u - 0.5) * Math.PI * 2;
  const harsh = kind === 'fear_pressure' || kind === 'challenge_pressure';
  const tooth = harsh
    ? (1 - Math.abs(2 * ((u * (kind === 'fear_pressure' ? 9 : 5)) % 1) - 1)) * 0.16
    : 0;
  const radius = 7.6 + phase * 2.4 - v * 0.72 + tooth;
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
  const height = kind === 'dread_pressure' ? 1 - phase : phase;
  out.y = 0.12 + height * lift + tooth * 0.35 + v * 0.035;
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
