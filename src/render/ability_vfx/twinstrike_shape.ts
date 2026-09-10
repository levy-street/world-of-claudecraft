import * as THREE from 'three';

/** A pulled steel edge with three staggered blood pennants behind the cut.
 * The open crescent is built once. Its two casts use opposing blade planes. */
export function buildTwinstrikeShape(): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const columns = 48,
    rows = 6;
  for (let layer = 0; layer < 4; layer++) {
    const base = positions.length / 3;
    for (let i = 0; i <= columns; i++) {
      const u = i / columns;
      const angle = (u - 0.5) * (2.8 - layer * 0.27) + layer * 0.13;
      const envelope = Math.sin(u * Math.PI) ** 0.75;
      const width = envelope * (layer === 0 ? 1.02 : 0.42);
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const tear = layer === 0 ? 1 : 0.72 + 0.17 * Math.sin(u * 41 + layer * 2.7);
        positions.push(
          Math.sin(angle) * (2.75 - layer * 0.13) - layer * 0.12,
          (Math.cos(angle) - 0.3) * 0.95 - width * v * tear - layer * 0.2,
          (Math.cos(angle) - 0.3) * 1.25 + width * Math.sin(v * 4.6 + u * 3) * 0.4 + layer * 0.17,
        );
        // Encode the fold index without another per-vertex attribute or draw.
        uvs.push(u, v + layer * 2);
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
  float age=mix(0.34,uAge,uMotion);
  float foldV=mod(uv.y,2.0);
  p.z+=smoothstep(0.28,1.0,age)*foldV*0.6;
  p.y-=smoothstep(0.4,1.0,age)*foldV*0.55;
}`;

export const TWINSTRIKE_FRAGMENT = `
if(uKind>25.5&&uKind<26.5){
  float age=mix(0.34,uAge,uMotion);
  float layer=floor(vUv.y/2.0);
  float v=mod(vUv.y,2.0);
  float head=clamp(age/0.28,0.0,1.0)*1.15;
  float reveal=1.0-smoothstep(head-0.07,head+0.015,vUv.x);
  float edge=(1.0-smoothstep(0.025,0.095,v))*(1.0-step(.5,layer));
  float fibre=texture2D(uBloodMap,vec2(fract(vUv.x-age*.16+layer*.17),v*.7+.1)).r;
  float fold=.5+.5*sin(v*14.0+vUv.x*7.0+fibre*2.0+layer*1.8);
  float ridge=smoothstep(.72,.94,fold);
  colour=mix(uTint*.9,uAccent,fold*.64+fibre*.13);
  colour+=uAccent*ridge*.22;
  colour=mix(colour,vec3(.85,.92,.96),edge*.84);
  float hot=1.0-smoothstep(.02,.11,abs(vUv.x-head));
  colour+=vec3(.95,.84,.81)*hot*edge;
  float rag=.78+.12*sin(vUv.x*39.0)+.07*sin(vUv.x*83.0);
  float boundary=1.0-smoothstep(rag-.04,rag+.02,v);
  float tear=sin(vUv.x*59.0-v*23.0+layer*2.4)+fibre;
  float decay=smoothstep(.52,.98,age);
  float holes=mix(1.0,smoothstep(-.65+decay*1.8,-.2+decay*1.8,tear),decay);
  alpha=reveal*boundary*holes*(.52+edge*.35)*(1.0-smoothstep(.74,1.0,uAge));
}`;
