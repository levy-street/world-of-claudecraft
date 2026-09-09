import * as THREE from 'three';
import { warriorBloodTexture } from '../ability_vfx/production_assets';
import type { FarBakeGate } from './visual';

/** Project the detailed blood sheet along the actual weapon, independent of
 * its skin-atlas UVs. Positions and the original cached geometry stay intact. */
export function sanguineWeaponGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.clone();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const position = geometry.getAttribute('position');
  if (!box || !position) return geometry;
  const extent = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const axes = [0, 1, 2].sort((a, b) => extent[b] - extent[a]);
  const minimum = [box.min.x, box.min.y, box.min.z];
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    // The artwork's long horizontal edge follows the weapon's longest axis.
    uv[i * 2] =
      (position.getComponent(i, axes[0]) - minimum[axes[0]]) / Math.max(0.001, extent[axes[0]]);
    uv[i * 2 + 1] =
      0.15 +
      (0.7 * (position.getComponent(i, axes[1]) - minimum[axes[1]])) /
        Math.max(0.001, extent[axes[1]]);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

interface PendingSheath {
  aura: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  geometry: THREE.BufferGeometry;
}

/** Owns only uncommitted upgrades. The visual remains the sole owner of live
 * weapon overlays. A settled fallback gate is not proof of GPU preparation. */
export class SanguineWeaponSheath {
  private readonly pending = new Set<PendingSheath>();
  private gate: FarBakeGate | null = null;

  setGate(gate: FarBakeGate | null): void {
    this.clear();
    this.gate = gate;
  }

  stage(aura: THREE.Mesh): void {
    const texture = warriorBloodTexture();
    if (!texture || !this.gate) return;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffbcb0,
      emissiveMap: texture,
      emissive: 0xe81b1f,
      emissiveIntensity: 0.7,
      roughness: 0.42,
      metalness: 0.25,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    // The production sheet is RGB on black. Derive coverage after sampling,
    // retaining the real weapon through its gaps rather than painting black.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n diffuseColor.a *= smoothstep(0.025, 0.24, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));',
      );
    };
    material.customProgramCacheKey = () => 'warrior-sanguine-sheath-v25-v1';
    const geometry = sanguineWeaponGeometry(aura.geometry);
    const pending = { aura, material, geometry };
    this.pending.add(pending);
    // Same plain-Mesh kind and material instance as the eventual visible draw.
    const target = new THREE.Mesh(geometry, material);
    target.name = 'sanguine-weapon-sheath';
    this.gate(target, (prepared) => {
      if (!this.pending.delete(pending)) {
        // A queued compile can acquire resources after clear() disposed them.
        // Release those too; a stale completion never mounts its result.
        material.dispose();
        geometry.dispose();
        return;
      }
      if (prepared !== true || !aura.parent) {
        material.dispose();
        geometry.dispose();
        return;
      }
      const old = aura.material;
      if (Array.isArray(old)) for (const entry of old) entry.dispose();
      else old.dispose();
      if (aura.userData.ownsAuraGeometry) aura.geometry.dispose();
      aura.geometry = geometry;
      aura.material = material;
      aura.userData.ownsAuraGeometry = true;
    });
  }

  clear(): void {
    for (const pending of this.pending) {
      pending.material.dispose();
      pending.geometry.dispose();
    }
    this.pending.clear();
  }
}
