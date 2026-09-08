import { HUNTER_CLAP_RADIUS, type HunterPetComponent } from '../hunter_pet_component_core';
import type { AbilityVfxFx } from './fx';

/** Ground compression belongs to the pet; claw wounds belong to actual
 * victims. Neither draws a magical ring or a new pet-to-target attack. */
export class HunterPetContact {
  private source = { x: 0, y: 0, z: 0 };
  private target = { x: 0, y: 0, z: 0 };

  draw(
    host: AbilityVfxFx,
    kind: HunterPetComponent,
    sourceId: number,
    targetId: number,
    amount: number,
    firstClap: boolean,
    tier: number,
  ): number {
    let count = 0;
    const from = host.anchorOf(sourceId, 0, this.source);
    if (kind === 'clap' && firstClap && from && HUNTER_CLAP_RADIUS > 0) {
      const x = from.x,
        z = from.z,
        gy = host.groundYAt(x, z);
      const facing = host.facingAt(sourceId) ?? 0;
      const spokes = tier >= 2 ? 0 : tier === 1 ? 5 : 7;
      // Broken, unequal ridges radiate across the actual six-yard clap.
      // This is its short landed shock, not a persistent danger telegraph.
      for (let k = 0; k < spokes; k++) {
        const angle = facing + (k * Math.PI * 2) / spokes + Math.sin(k * 3.7) * 0.13;
        const dx = Math.sin(angle),
          dz = Math.cos(angle);
        const admitted = host.pathRibbon(
          k % 2 ? 0xf3dba7 : 0x9b7852,
          tier >= 2 ? 0.09 : 0.17,
          0.28,
          (points) => {
            for (let j = 0; j < points.length; j++) {
              const u = j / (points.length - 1);
              const r = 0.3 + u * (HUNTER_CLAP_RADIUS - 0.5);
              const bend = Math.sin(u * 12 + k) * u * 0.22;
              const px = x + dx * r + dz * bend,
                pz = z + dz * r - dx * bend;
              points[j].set(px, host.groundYAt(px, pz) + 0.07 + Math.sin(u * Math.PI) * 0.12, pz);
            }
            return points.length;
          },
          true,
          null,
          true,
        );
        if (admitted) count++;
        if (tier === 0) {
          count++;
          host.fragmentsAt(
            'stone_chip',
            x + dx * 0.5,
            gy + 0.08,
            z + dz * 0.5,
            0x8b755d,
            2,
            0.8,
            dx,
            dz,
            0.42,
          );
        }
      }
      host.burstAt(x, gy + 0.15, z, 0xb69b79, tier >= 2 ? 5 : 12, 1.25, 'smoke', 0.32);
      host.shakeAt(x, gy, z, 0.13);
      count++;
    }
    const at = host.anchorOf(targetId, 0.53, this.target);
    if (!at) return count;
    const weight = Math.min(1.5, 0.75 + Math.sqrt(amount) * 0.035);
    if (tier >= 2) {
      host.burstAt(at.x, at.y, at.z, kind === 'clap' ? 0xe4c799 : 0xe2b399, 3, 0.6, 'sparks', 0.16);
      return count + 1;
    }
    host.flipbookAt(
      at.x,
      at.y,
      at.z,
      (kind === 'clap' ? 1.65 : 1.35) * weight,
      kind === 'clap' ? 0xebd2a8 : 0xd8b095,
      kind === 'clap' ? 'contact_crush' : 'contact_cut',
      1.9,
      0.23,
      targetId % 2 ? -0.55 : 0.45,
      kind === 'clap' ? 1 : 1.2,
    );
    if (kind === 'cleave') {
      // Short paired cuts stay ON the secondary victim even when the pet is
      // far away. Frenzy selects targets near Fell Shot's primary target.
      for (let k = 0; k < 2; k++) {
        const admitted = host.pathRibbon(
          0xf0d2b3,
          0.07 * weight,
          0.19,
          (points) => {
            for (let j = 0; j < points.length; j++) {
              const u = j / (points.length - 1);
              points[j].set(
                at.x + (u - 0.5) * 1.1 * weight,
                at.y + (0.5 - u) * 0.7 + k * 0.16,
                at.z + Math.sin(u * Math.PI) * 0.15,
              );
            }
            return points.length;
          },
          true,
          null,
          true,
        );
        if (admitted) count++;
      }
    }
    return count + 1;
  }
}
