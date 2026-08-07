import { hash2 } from '../sim/rng';

const ICE_FIELDS = [
  { x: 30, z: 1745, radius: 26, count: 12 },
  { x: 52, z: 1638, radius: 20, count: 8 },
  { x: 96, z: 1816, radius: 22, count: 9 },
  { x: -84, z: 1738, radius: 18, count: 6 },
  { x: -10, z: 1660, radius: 40, count: 8 },
] as const;

export const FROST_ICE_TINTS = [0xbfe8ff, 0x9fd4f2, 0xd8f2ff] as const;

export interface FrostIceSpireSite {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  tilt: number;
  tiltAxisYaw: number;
  tint: number;
  variant: 0 | 1 | 2;
  fieldIndex: number;
}

export function planFrostIceSpireSites(
  groundAt: (x: number, z: number) => number,
): FrostIceSpireSite[] {
  const sites: FrostIceSpireSite[] = [];
  let ordinal = 0;
  ICE_FIELDS.forEach((field, fieldIndex) => {
    for (let k = 0; k < field.count; k++, ordinal++) {
      const angle = hash2(k + fieldIndex * 17, 5, 4021) * Math.PI * 2;
      const distance = Math.sqrt(hash2(k, fieldIndex + 9, 4031)) * field.radius;
      const x = field.x + Math.sin(angle) * distance;
      const z = field.z + Math.cos(angle) * distance;
      const y = groundAt(x, z);
      if (y < -3) continue;
      sites.push({
        x,
        y,
        z,
        scale: 0.75 + hash2(k, fieldIndex, 4041) * 1.4,
        yaw: hash2(fieldIndex, k, 4051) * Math.PI * 2,
        tilt: (hash2(ordinal, 7, 4071) - 0.5) * 0.5,
        tiltAxisYaw: hash2(ordinal, fieldIndex, 4081) * Math.PI * 2,
        tint: FROST_ICE_TINTS[Math.floor(hash2(k + fieldIndex, 3, 4061) * FROST_ICE_TINTS.length)],
        variant: ((k + fieldIndex) % 3) as 0 | 1 | 2,
        fieldIndex,
      });
    }
  });
  return sites;
}
