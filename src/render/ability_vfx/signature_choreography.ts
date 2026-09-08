import type { AbilityVfxFullSpec } from '../ability_vfx_core';
import { catalogueMaterialResponse } from './catalogue_materials';
import type { SeqPoint, SequencerHost } from './sequencer';
import { SIGNATURE_ABILITIES, signatureStrength, substanceOf } from './signature_core';
import { signatureMaterialResponse } from './signature_material_response';

/** Authored silhouettes at the actual release/arrival hooks. Delayed details own their
 * short local lifetime in the prepared pool; there are no timers or changes to combat. */
export function signatureMoment(
  host: SequencerHost,
  id: string,
  spec: AbilityVfxFullSpec,
  at: SeqPoint,
  color: number,
  accent: number,
  tier: number,
  phase: 'release' | 'impact',
  dx = 0,
  dz = 0,
): number {
  const strength = signatureStrength(id, spec, tier);
  if (phase === 'impact' && !SIGNATURE_ABILITIES[id])
    return catalogueMaterialResponse(host, id, spec, at, color, accent, tier, dx, dz);
  if (strength === 0) return 0;
  const hero = SIGNATURE_ABILITIES[id];
  const substance = substanceOf(spec);
  const size = Math.min(1.6, Math.max(0.5, spec.power ?? 1));
  const x = at.x,
    y = at.y,
    z = at.z;
  const gy = host.groundYAt(x, z) + 0.08;
  const facing = Math.atan2(dx, dz);
  let count = 0;
  if (phase === 'release') {
    if (!hero) return 0;
    // One compact cast-off veil lets the contact own the brightest moment.
    host.detailAt?.(x, y, z, 1.2 * size, color, accent, substance, 0, 0.65);
    return 1;
  }
  if (tier === 0) {
    host.detailAt?.(
      x,
      y + 0.2,
      z,
      (hero ? 1.15 : 1.5) * size,
      color,
      accent,
      substance,
      0.035,
      0.85,
    );
    count++;
    if (hero) {
      count += signatureMaterialResponse(host, hero, at, size, color, accent, dx, dz);
    } else if (strength >= 0.7) {
      host.bakedAt?.('shockwave', x, gy, z, 2.6 * size, color, accent, 0.7, 0, 0.1, facing);
      count++;
    }
  }
  if (!hero) return count;
  if (tier === 0) {
    if (
      substance === 'fire' ||
      substance === 'earth' ||
      substance === 'water' ||
      substance === 'ice'
    ) {
      host.residueAt?.(
        x,
        z,
        1.45,
        substance === 'fire' || substance === 'earth'
          ? 0x251e1a
          : substance === 'water'
            ? 0x1b6875
            : 0x92c6d2,
        substance,
      );
    }
    host.worldLightAt?.(
      x,
      gy,
      z,
      spec.palette,
      hero === 'tide' || hero === 'wolf' ? 1.6 : 3.4,
      0.65,
    );
  }
  const paths = tier === 0 ? 3 : 1;
  // The articulated sculpture owns the primary silhouette on capable hosts.
  // Older minimal hosts retain the original ribbon/crest signature below.
  if (tier === 0 && host.elementalImpact) return count;
  switch (hero) {
    case 'pyre':
      host.crestAt?.(x, gy, z, 1.65 * size, 1.1, color, accent, 'fire', facing);
      if (tier === 0) host.decalXZ(x, z, 1.9, color, 'char', 4.2);
      for (let k = 0; k < paths; k++) {
        const angle = (k * Math.PI * 2) / paths + 0.3;
        host.pathRibbon(color, 0.075, 0.75, (points) => {
          for (let i = 0; i < 12; i++) {
            const t = i / 11,
              r = 0.4 + t * 2.4;
            points[i].set(
              x + Math.cos(angle) * r,
              gy + Math.sin(t * Math.PI) * 1.8,
              z + Math.sin(angle) * r,
            );
          }
          return 12;
        });
      }
      return count + paths + 2;
    case 'glacier':
      // Local ice crown is decoration; the live eight-yard freeze boundary stays unchanged.
      if (tier === 0) host.decalXZ(x, z, 2.1, color, 'rime', 3.1);
      return count + 1;
    case 'thunder':
      for (let k = 0; k < paths; k++) {
        const a = facing + k * 2.399;
        host.boltPoints(
          x + Math.cos(a) * 1.8,
          y + 2.4 + k * 0.3,
          z + Math.sin(a) * 1.8,
          x,
          y,
          z,
          accent,
          0.12,
          0.065,
          1.4,
        );
      }
      if (tier === 0) host.decalXZ(x, z, 1.2, color, 'char', 1.6);
      return count + paths + 1;
    case 'tide':
      host.crestAt?.(x, gy, z, 1.25, 0.7, color, accent, 'water', facing);
      // The existing chain water volumes still join real recipients, never invented neighbours.
      return count + 1;
    case 'wolf':
    case 'rift':
      for (let k = 0; k < paths; k++) {
        host.pathRibbon(
          k === 1 ? accent : color,
          hero === 'rift' ? 0.09 : 0.045,
          0.95,
          (points) => {
            for (let i = 0; i < 12; i++) {
              const t = i / 11,
                a = k * 2.094 + t * Math.PI * 1.8;
              const r = hero === 'rift' ? 1.8 * (1 - t) + 0.25 : 0.35 + Math.sin(t * Math.PI) * 0.9;
              points[i].set(
                x + Math.cos(a) * r,
                gy + t * (hero === 'rift' ? 2.6 : 1.9),
                z + Math.sin(a) * r,
              );
            }
            return 12;
          },
        );
      }
      if (hero === 'rift') host.crestAt?.(x, gy, z, 1.6, 2.3, color, accent, 'shadow', facing);
      return count + paths;
    case 'judgement':
      // Three pointed, open arches hold an ordered silhouette around the impact.
      for (let k = 0; k < paths; k++) {
        const a = facing + (k * Math.PI) / paths;
        host.pathRibbon(accent, 0.055, 0.8, (points) => {
          for (let i = 0; i < 12; i++) {
            const t = i / 11,
              r = (t - 0.5) * 2.6;
            points[i].set(
              x + Math.cos(a) * r,
              gy + (1 - Math.abs(t * 2 - 1)) * 3.0,
              z + Math.sin(a) * r,
            );
          }
          return 12;
        });
      }
      host.crestAt?.(x, gy, z, 1.3, 0.9, color, accent, 'light', facing);
      return count + paths + 1;
    case 'execution':
      host.slashStyled(at, accent, 'overhead', 1.25);
      if (tier > 0) host.burstAt(x, gy + 0.1, z, 0x796452, 4, 0.65, 'debris');
      if (tier === 0) host.decalXZ(x, z, 1.2, 0x705144, 'crack', 2.2);
      return count + 3;
  }
}
