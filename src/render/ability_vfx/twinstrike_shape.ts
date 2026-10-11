import * as THREE from 'three';

/** A torn blood blade with three short, irregular films behind the cut.
 * The open crescent is built once. Its two casts use opposing blade planes. */
export function buildTwinstrikeShape(): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const columns = 48,
    rows = 6;
  for (let layer = 0; layer < 4; layer++) {
    const base = positions.length / 3;
    const start = [0, 0.04, 0.43, 0.76][layer];
    const end = [1, 0.34, 0.72, 0.98][layer];
    for (let i = 0; i <= columns; i++) {
      const u = i / columns;
      const along = start + (end - start) * u;
      const angle = (along - 0.5) * 2.8;
      const envelope = Math.sin(u * Math.PI) ** 0.75;
      const width = envelope * (layer === 0 ? 1.02 : 0.28);
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const tear = 0.76 + 0.15 * Math.sin(u * 43 + layer) + 0.09 * Math.sin(u * 97);
        const bow = Math.cos(angle) - 1;
        positions.push(
          Math.sin(angle) * 3.1,
          bow * 0.5 - width * v * tear - layer * 0.14,
          bow * 1.15 + width * v * 0.25 + layer * 0.06,
        );
        // Encode the fold index without another per-vertex attribute or draw.
        uvs.push(along, v + layer * 2);
        if (i < columns && j < rows) {
          const n = base + i * (rows + 1) + j;
          indices.push(n, n + rows + 1, n + 1, n + 1, n + rows + 1, n + rows + 2);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export const TWINSTRIKE_VERTEX = `
if(uKind>25.5&&uKind<26.5){
  float age=mix(0.32,uAge,uMotion);
  float foldV=mod(uv.y,2.0);
  float release=smoothstep(0.18,1.0,age);
  p=position;
  p.z+=release*0.6;
  p.y-=release*release*foldV*0.48;
}`;

export const TWINSTRIKE_FRAGMENT = `
if(uKind>25.5&&uKind<26.5){
  float age=mix(0.32,uAge,uMotion);
  warriorBloodFilm(vec2(vUv.x,mod(vUv.y,2.0)),vLocal.z,age,colour,alpha);
}`;
