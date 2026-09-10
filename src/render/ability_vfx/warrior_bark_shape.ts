import * as THREE from 'three';

/** A short, forked pressure plume above the ground. The existing authored
 * pressure texture supplies its fine air filaments instead of soil particles. */
export function buildWarriorBark(): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const cols = 24,
    rows = 8;
  for (let i = 0; i <= cols; i++)
    for (let j = 0; j <= rows; j++) {
      const u = i / cols,
        v = j / rows;
      positions.push((v - 0.5) * 4.4, Math.sin(v * Math.PI) * 0.3 + u * 0.16, u * 6.4);
      uvs.push(u, v);
      if (i < cols && j < rows) {
        const n = i * (rows + 1) + j;
        indices.push(n, n + rows + 1, n + 1, n + 1, n + rows + 1, n + rows + 2);
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

export const WARRIOR_BARK_VERTEX = `
if(uKind>27.5&&uKind<28.5){
  float age=mix(.3,uAge,uMotion);
  p.z*=.45+.55*min(1.,age*3.0);
  p.x*=.75+.25*min(1.,age*3.0);
}`;

export const WARRIOR_BARK_FRAGMENT = `
if(uKind>27.5&&uKind<28.5){
  float age=uAge;
  float air=texture2D(uPressureMap,vUv).r;
  float head=min(1.05,mix(.3,age,uMotion)*4.0);
  float reveal=1.-smoothstep(head-.08,head+.015,vUv.x);
  float fleck=.82+.18*sin(vUv.x*217.+vUv.y*179.);
  colour=mix(uTint,uAccent,smoothstep(.15,.8,air));
  alpha=smoothstep(.025,.75,air)*reveal*fleck*.72*(1.-smoothstep(.28,.95,age));
}`;
