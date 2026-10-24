import * as THREE from 'three';
import { getActiveWorldContent, STRIP_MAX_X, STRIP_MIN_X, zoneAt } from '../../sim/data';
import {
  buildWaterCharacterField,
  WATER_CHARACTERS,
  WATER_FIELD_LAYERS,
  waterCharacterFor,
  waterCharacterTexels,
  waterFieldLayout,
} from './water_character_core';

// The water character field as a texture: one small three-layer array texture
// over the active map (water_character_core.ts holds the table and the bake),
// and the shared uniforms every water surface reads it through. The uniform
// OBJECTS live for the page, so materials keep them by reference; the texture
// behind them is rebaked whenever the water itself is rebuilt (a map switch,
// an editor rebuild), so a realm's water follows the map that is loaded.
// Half floats, so the sampler filters it on every WebGL2 device.

interface FieldUniforms {
  uWaterChar: THREE.IUniform<THREE.DataArrayTexture>;
  /** x, z of the field's min corner, then 1 / its world width and depth. */
  uWaterCharRect: THREE.IUniform<THREE.Vector4>;
}

let uniforms: FieldUniforms | null = null;

function arrayTexture(data: Float32Array, width: number, height: number): THREE.DataArrayTexture {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE.DataArrayTexture(half, width, height, WATER_FIELD_LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'ocean-water-character';
  return tex;
}

/** The shared field uniforms; the first call bakes the field for the active map. */
export function waterCharacterUniforms(): FieldUniforms {
  if (!uniforms) {
    uniforms = {
      uWaterChar: { value: arrayTexture(waterCharacterTexels(WATER_CHARACTERS.vale), 1, 1) },
      uWaterCharRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    };
    rebakeWaterCharacterField();
  }
  return uniforms;
}

/** Rebake the field for the map that is active now (the water's own rebuild calls this). */
export function rebakeWaterCharacterField(): void {
  const target = uniforms ?? waterCharacterUniforms();
  const layout = waterFieldLayout(getActiveWorldContent().zones, STRIP_MIN_X, STRIP_MAX_X);
  const data = buildWaterCharacterField(layout, (x, z) => {
    const zone = zoneAt(x, z);
    return waterCharacterFor(zone.id, zone.biome);
  });
  const previous = target.uWaterChar.value;
  target.uWaterChar.value = arrayTexture(data, layout.width, layout.height);
  target.uWaterCharRect.value.set(
    layout.minX,
    layout.minZ,
    1 / (layout.width * layout.cell),
    1 / (layout.height * layout.cell),
  );
  previous.dispose();
}
