import * as THREE from 'three';

/** One wound-centred incision pulls a ragged blood film along the blade exit.
 * The leading edge stays on the cut while its irregular tail stretches away. */
export function buildBloodlettingShape(): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const cols = 48,
    rows = 12;
  for (let i = 0; i <= cols; i++) {
    const u = i / cols;
    const taper = Math.sin(Math.PI * u) ** 0.65;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const rag = Math.sin(u * 43) * 0.14 + Math.sin(u * 97) * 0.08;
      const bow = Math.cos((u - 0.5) * 2.4) - 1;
      positions.push(
        (u - 0.5) * 6.4 + v * v * taper * 0.65,
        bow * 0.35 - taper * v * (1.6 + rag),
        bow * 0.6 + taper * v * (0.42 + 0.18 * u),
      );
      uvs.push(u, v);
      if (i < cols && j < rows) {
        const n = i * (rows + 1) + j;
        indices.push(n, n + rows + 1, n + 1, n + 1, n + rows + 1, n + rows + 2);
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

export const BLOODLETTING_VERTEX = `
if(uKind>26.5&&uKind<27.5){
  float age=mix(0.32,uAge,uMotion);
  float pull=smoothstep(0.18,1.0,age)*uv.y*uv.y;
  p=position;
  p.x+=pull*0.75;
  p.z+=pull*0.45;
  p.y-=pull*pull*0.38;
}`;

export const BLOODLETTING_FRAGMENT = `
if(uKind>26.5&&uKind<27.5){
  float age=mix(0.32,uAge,uMotion);
  warriorBloodFilm(vUv,vLocal.z,age,colour,alpha);
}`;
