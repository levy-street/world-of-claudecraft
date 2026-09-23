import type { SeqPoint, SequencerHost } from './ability_vfx/sequencer';
import { shamanCascadeArch, shamanCascadeLift } from './ability_vfx/shaman_water_material';
import { abilityHexColor } from './ability_vfx_core';
import { abilityVfxFullSpec } from './ability_vfx_registry';

type CascadeHost = Pick<SequencerHost, 'pathRibbon' | 'burstAt' | 'groundYAt'> & {
  waterVolume: NonNullable<SequencerHost['waterVolume']>;
};

/** One confirmed hop, with its actual endpoints supplied by the event owner.
 * A broad elevated river breaks into a steep receiving fall. Foam and splash
 * tails use existing pools; they never schedule a heal or another recipient. */
export function drawShamanCascade(
  host: CascadeHost,
  from: SeqPoint,
  to: SeqPoint,
  quality: number,
  reducedMotion: boolean,
): void {
  if (![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite)) return;
  const dx = to.x - from.x,
    dy = to.y - from.y,
    dz = to.z - from.z;
  const horizontal = Math.hypot(dx, dz);
  if (Math.hypot(horizontal, dy) < 0.001) return;
  const spec = abilityVfxFullSpec('chain_heal');
  if (!spec) return;
  const color = abilityHexColor(spec.tint ?? '#288d9d');
  const accent =
    typeof spec.accent === 'number' ? spec.accent : abilityHexColor(spec.accent ?? '#bdece0');
  const detail = quality >= 0.5;
  const sx = horizontal > 0.001 ? -dz / horizontal : 1;
  const sz = horizontal > 0.001 ? dx / horizontal : 0;
  const lift = shamanCascadeLift(horizontal);
  const crest = {
    x: from.x + dx * 0.6,
    y: from.y + dy * 0.6 + lift * shamanCascadeArch(0.6),
    z: from.z + dz * 0.6,
  };
  // One protected primary span leaves eight slots for actual recipient waves.
  // All heals have already resolved; only water and runoff continue moving.
  host.waterVolume(from, to, color, accent, 0.4, 1.15, 1, 4);
  for (let strand = 0; strand < (detail ? 2 : 1); strand++) {
    host.pathRibbon(
      strand ? color : accent,
      strand ? 0.035 : 0.065,
      0.38 + strand * 0.05,
      (points) => {
        for (let i = 0; i < 12; i++) {
          const u = i / 11,
            envelope = Math.sin(u * Math.PI);
          const braid = envelope * (strand ? -0.67 : 0.67) + envelope * Math.sin(u * 3.7) * 0.14;
          points[i].set(
            from.x + dx * u + sx * braid,
            from.y + dy * u + lift * shamanCascadeArch(u),
            from.z + dz * u + sz * braid,
          );
        }
        return 12;
      },
      false,
      null,
      true,
    );
  }
  if (reducedMotion) return;
  host.burstAt(crest.x, crest.y, crest.z, accent, detail ? 27 : 9, 0.65, 'shaman_runoff', 0.82);
  const terrain = host.groundYAt(to.x, to.z);
  const splashY = (Number.isFinite(terrain) ? terrain : to.y) + 0.18;
  // The heal already arrived with its authoritative receipt. These staggered
  // splashes are cosmetic runoff, not delayed healing or a predicted impact.
  for (let side = -1; side <= 1; side += 2) {
    const reach = side < 0 ? 0.52 : 0.88;
    host.burstAt(
      to.x + sx * reach * side,
      splashY,
      to.z + sz * reach * side,
      side < 0 ? accent : color,
      detail ? 28 : 10,
      side < 0 ? 1.65 : 1.1,
      'shaman_droplets',
      side < 0 ? 0.65 : 0.85,
      side < 0 ? 0.12 : 0.19,
    );
  }
}
