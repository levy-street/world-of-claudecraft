// The Guardian of the Heat's own skin, dimmed to cold coal or blazing
// white-hot (its model's emissive and colour, from the values it was authored
// with): the entrance's cold hearth (heat_entrance_fx.ts) and the death's
// cooling (heat_death_fx.ts) both write it, one at a time (the entrance only
// while its scene runs, the death only while the guardian lies dead or a
// replay plays), and each gives the authored values back the moment it lets
// go. One guardian at a time; the materials are the view's, never a program
// change (two scalar uniforms per material).

import type * as THREE from 'three';
import { heatBodySockets } from './heat_body_sockets';

/** The model's authored look, kept per material while a scene writes it. */
interface CoalMaterial {
  mat: THREE.Material & { emissiveIntensity?: number; color?: THREE.Color };
  emissive: number;
  r: number;
  g: number;
  b: number;
}

export class HeatCoalSkin {
  private coal: CoalMaterial[] = [];
  private root: THREE.Object3D | null = null;

  /** Write the skin: `glow` the emissive's share of the authored (past 1
   *  white-hot), `coal` the colour's share (cold coal is dark and grey; past
   *  1 it whitens toward white-hot). */
  apply(glow: number, coal: number): void {
    const set = heatBodySockets();
    const root = set?.root ?? null;
    if (root !== this.root) {
      this.restore();
      this.root = root;
      if (root) {
        const seen = new Set<THREE.Material>();
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const mm = m as CoalMaterial['mat'];
            // Only the guardian's own skin (never a prop or a weapon on the rig).
            if (!/heat_guardian/.test(mm.name)) continue;
            if (seen.has(mm) || mm.emissiveIntensity === undefined || !mm.color) continue;
            seen.add(mm);
            this.coal.push({
              mat: mm,
              emissive: mm.emissiveIntensity,
              r: mm.color.r,
              g: mm.color.g,
              b: mm.color.b,
            });
          }
        });
      }
    }
    for (const c of this.coal) {
      c.mat.emissiveIntensity = c.emissive * glow;
      if (coal <= 1) {
        // Cold coal is grey, its painted lava gone dull: a cool tint over the
        // dim (none left once it burns).
        const cool = 1 - coal;
        c.mat.color?.setRGB(
          c.r * coal * (1 - 0.45 * cool),
          c.g * coal * (1 - 0.3 * cool),
          c.b * coal * (1 - 0.1 * cool),
        );
      } else {
        // White-hot: the colour lifted and whitened.
        const w = Math.min(1, coal - 1);
        c.mat.color?.setRGB(c.r * coal + w * 1.2, c.g * coal + w * 0.85, c.b * coal + w * 0.5);
      }
    }
  }

  /** Give the authored values back. */
  restore(): void {
    for (const c of this.coal) {
      c.mat.emissiveIntensity = c.emissive;
      c.mat.color?.setRGB(c.r, c.g, c.b);
    }
    this.coal = [];
    this.root = null;
  }

  /** Is the skin written now? */
  get holding(): boolean {
    return this.coal.length > 0;
  }
}
