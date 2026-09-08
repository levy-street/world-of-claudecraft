import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surfaceMat } from './gfx';
import { markSharedGeometry } from './shared_resource';

let jaw: THREE.BufferGeometry | null = null;
let plate: THREE.BufferGeometry | null = null;

function piece(
  geometry: THREE.BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  geometry.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);
  const tint = new THREE.Color(color);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    const wear = 0.88 + ((i * 13) % 17) / 100;
    colors[i] = tint.r * wear;
    colors[i + 1] = tint.g * wear;
    colors[i + 2] = tint.b * wear;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const result = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!result) throw new Error('Hunter trap geometry attributes diverged');
  return markSharedGeometry(result);
}

/** One forged, toothed half-jaw. Its hinge runs along local X at Z=0. */
export function hunterJawGeometry(): THREE.BufferGeometry {
  if (jaw) return jaw;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 13; i++) {
    const a = 0.08 + (i / 12) * (Math.PI - 0.16);
    const x = Math.cos(a) * 0.93,
      z = Math.sin(a) * 0.68;
    parts.push(
      piece(new THREE.BoxGeometry(0.26, 0.12, 0.14), 0x536974, x, 0.1, z, 0, -a + Math.PI / 2),
    );
    parts.push(
      piece(new THREE.BoxGeometry(0.19, 0.027, 0.16), 0xa8b8af, x, 0.17, z, 0, -a + Math.PI / 2),
    );
    // The cutting teeth lean toward the pressure plate; shorter rime splinters
    // break the pristine metal outline without hiding the mechanical shape.
    parts.push(
      piece(
        new THREE.ConeGeometry(0.065, 0.3 + (i % 3) * 0.035, 4),
        0xbde5df,
        x * 0.91,
        0.28,
        z * 0.91,
        -0.24,
        0,
        Math.cos(a) * 0.2,
      ),
    );
    if (i % 2 === 0)
      parts.push(
        piece(
          new THREE.ConeGeometry(0.035, 0.16, 3),
          0x4a9ca7,
          x * 1.04,
          0.2,
          z * 1.05,
          0.3,
          a,
          0.15,
        ),
      );
  }
  for (const x of [-0.91, 0.91]) {
    parts.push(
      piece(
        new THREE.CylinderGeometry(0.14, 0.14, 0.24, 8),
        0x9d8661,
        x,
        0.11,
        0,
        0,
        0,
        Math.PI / 2,
      ),
    );
    parts.push(
      piece(
        new THREE.CylinderGeometry(0.065, 0.065, 0.27, 6),
        0x273b44,
        x,
        0.11,
        0,
        0,
        0,
        Math.PI / 2,
      ),
    );
  }
  jaw = merged(parts);
  return jaw;
}

export function hunterPressurePlateGeometry(): THREE.BufferGeometry {
  if (plate) return plate;
  const parts = [
    piece(new THREE.BoxGeometry(1.85, 0.065, 0.18), 0x283d42, 0, 0.035, 0),
    piece(new THREE.CylinderGeometry(0.32, 0.36, 0.09, 8), 0x7f8e87, 0, 0.1, 0),
    piece(new THREE.CylinderGeometry(0.24, 0.25, 0.022, 8), 0x324d53, 0, 0.158, 0),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    parts.push(
      piece(
        new THREE.BoxGeometry(0.1, 0.025, 0.035),
        0xbddbd0,
        Math.cos(a) * 0.12,
        0.174,
        Math.sin(a) * 0.12,
        0,
        -a,
      ),
    );
  }
  plate = merged(parts);
  return plate;
}

export function hunterTrapMaterial(): THREE.Material {
  return surfaceMat({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.58,
    emissive: 0x14353c,
    emissiveIntensity: 0.45,
  });
}
