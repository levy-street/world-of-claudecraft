import type { TemporalHourglassDisposition } from '../world_api/combat';

export const HOURGLASS_FIELD_STYLES = {
  protective: { color: 0x8ff7ff, spires: 4, height: 0.22, turn: Math.PI },
  hostile: { color: 0xff7d9b, spires: 12, height: 0.5, turn: 0 },
  unknown: { color: 0xd4bc83, spires: 0, height: 0, turn: 0 },
} as const;

/** The long clock ticks sit on the actual capture edge in every mode. */
export function hourglassTickRadius(
  radius: number,
  part: number,
  mode: TemporalHourglassDisposition,
): number {
  if (part === 0) return radius;
  return radius - (mode === 'protective' ? 0.24 : mode === 'hostile' ? 0.1 : 0.15);
}

export function hourglassSandFraction(value: number): number {
  return Math.max(0.03, Math.min(1, Number.isFinite(value) ? value : 1));
}
