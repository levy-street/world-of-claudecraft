import { OVERLAY_CELL } from './fx_textures';
import type { OverlaySprites } from './overlay_sprites';
import { classCastPoint } from './ritual_choreography_core';
import type { SeqSlot, SequencerHost } from './sequencer';

const point = { x: 0, y: 0, z: 0 };
const anchor = { x: 0, y: 0, z: 0 };
export function hasClassCast(style: string): boolean {
  return (
    style === 'spring' ||
    style === 'psionic' ||
    style === 'lunar' ||
    style === 'quiver' ||
    style === 'scripture' ||
    style === 'conduction' ||
    style === 'bough' ||
    style === 'solar' ||
    style === 'occult'
  );
}
export function drawClassCast(
  overlay: OverlaySprites,
  style: string,
  at: { x: number; y: number; z: number },
  facing: number,
  color: number,
  accent: number,
  progress: number,
  quality: number,
): void {
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  for (let strand = 0; strand < 3; strand++) {
    for (let node = 0; node < 4; node++) {
      classCastPoint(style, (node + progress * 0.7) / 4, strand, progress, point);
      overlay.push(
        at.x + dz * point.x + dx * point.z,
        at.y + point.y,
        at.z - dx * point.x + dz * point.z,
        node === 3 ? accent : color,
        (style === 'scripture' ? 0.16 : 0.105) * quality,
        style === 'scripture' ? OVERLAY_CELL.rune : OVERLAY_CELL.spark,
        0.45 + progress * 0.4,
        1.8,
      );
    }
  }
}

/** Replaces the universal caster shock halo with that class's open signature. */
export function classRelease(host: SequencerHost, slot: SeqSlot): number {
  const style = slot.spec.castIdentity;
  if (!style || !hasClassCast(style)) return 0;
  const at = host.anchorOf(slot.casterId, 0, anchor);
  if (!at) return 0;
  const x = at.x,
    y = at.y,
    z = at.z;
  const facing = host.facingAt?.(slot.casterId) ?? 0,
    dx = Math.sin(facing),
    dz = Math.cos(facing);
  const count = slot.tier > 0 ? 1 : 3;
  for (let strand = 0; strand < count; strand++) {
    host.pathRibbon(
      strand === 1 ? slot.accent : slot.color,
      (style === 'quiver' ? 0.06 : 0.095) * slot.power,
      0.23,
      (pts) => {
        for (let j = 0; j < pts.length; j++) {
          classCastPoint(style, j / (pts.length - 1), strand, 1, point);
          pts[j].set(x + dz * point.x + dx * point.z, y + point.y, z - dx * point.x + dz * point.z);
        }
        return pts.length;
      },
      style === 'quiver',
    );
  }
  return count;
}
