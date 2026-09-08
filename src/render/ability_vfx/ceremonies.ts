import type { AbilityVfxFullSpec } from '../ability_vfx_core';
import type { SeqPoint, SequencerHost } from './sequencer';

/** Brief, open silhouettes keep the recipient readable. All paths use the
 * prepared pools and end before the live aura's own persistent presentation. */
export function drawBuffCeremony(
  host: SequencerHost,
  at: SeqPoint,
  spec: AbilityVfxFullSpec,
  color: number,
  accent: number,
  lite: boolean,
): number {
  const style = spec.buff?.ceremony;
  if (!style) return 0;
  const count = lite ? 1 : 3;
  for (let k = 0; k < count; k++) {
    host.pathRibbon(k % 2 ? accent : color, k === 1 ? 0.055 : 0.075, 0.55 + k * 0.1, (points) => {
      for (let i = 0; i < 12; i++) {
        const u = i / 11;
        const phase = (k * Math.PI * 2) / count;
        const a = phase + u * (style === 'spiritCoils' ? Math.PI * 1.7 : 0.6);
        const r = style === 'spiritCoils' ? 1.3 - u * 0.4 : 0.65 + Math.sin(u * Math.PI) * 0.5;
        points[i].set(at.x + Math.cos(a) * r, at.y - 0.6 + u * 1.6, at.z + Math.sin(a) * r);
      }
      return 12;
    });
  }
  return count;
}

export function drawHealingCeremony(
  host: SequencerHost,
  at: SeqPoint,
  spec: AbilityVfxFullSpec,
  color: number,
  accent: number,
  lite: boolean,
): number {
  const style = spec.healStyle;
  if (!style) return 0;
  const count = lite ? 1 : 3;
  const power = Math.min(1.5, Math.max(0.5, spec.power ?? 1));
  for (let k = 0; k < count; k++) {
    const phase = (k * Math.PI * 2) / count;
    if (style === 'water' && host.waterVolume) {
      host.waterVolume(
        { x: at.x + Math.cos(phase) * 1.5, y: at.y - 0.55, z: at.z + Math.sin(phase) * 1.5 },
        { x: at.x, y: at.y + 0.45, z: at.z },
        color,
        accent,
        0.14 * power,
        0.85 + k * 0.08,
      );
      continue;
    }
    host.pathRibbon(
      k === 1 ? accent : color,
      style === 'bloom' ? 0.085 : 0.045,
      0.7 + k * 0.12,
      (points) => {
        for (let i = 0; i < 12; i++) {
          const u = i / 11;
          let a = phase,
            r = 0,
            y = 0;
          if (style === 'bloom') {
            // Three leaves open upward, with a pointed crown and clear torso.
            a += Math.sin(u * Math.PI) * 0.55;
            r = 0.35 + Math.sin(u * Math.PI) * 0.95;
            y = -0.6 + u * 2.1;
          } else if (style === 'rewind') {
            a -= u * Math.PI * 2.2;
            r = 1.2 - u * 0.6;
            y = 0.7 - u * 1.1;
          } else {
            // Light falls through three pointed arches, not a solid column.
            r = Math.sin(u * Math.PI) * 1.05;
            y = 2.5 * (1 - u) - 0.4;
          }
          points[i].set(at.x + Math.cos(a) * r, at.y + y * power, at.z + Math.sin(a) * r);
        }
        return 12;
      },
    );
  }
  return count;
}
