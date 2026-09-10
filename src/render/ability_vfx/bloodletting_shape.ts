import * as THREE from 'three';

/** One broad incision pulled into a folded, forked exit. The central material
 * compresses at contact; its exit peels away instead of drawing another slash. */
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
      const ribs = Math.sin(u * 23 + v * 6) * 0.12 + Math.sin(u * 53) * 0.05;
      positions.push(
        (u - 0.5) * 5.1 + v * v * taper * 0.48,
        Math.sin(u * Math.PI) * 0.65 - 0.25 - taper * v * (1.55 + ribs),
        taper * 0.25 + Math.sin(v * Math.PI * 1.7 + u * 5) * v * taper * 0.54,
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
  float age=mix(.3,uAge,uMotion);
  float pull=smoothstep(.15,.85,age)*uv.y*uv.y;
  p.x+=pull*.85;
  p.z-=pull*.9;
  p.y-=pull*.4;
}`;

export const BLOODLETTING_FRAGMENT = `
if(uKind>26.5&&uKind<27.5){
  float age=mix(.3,uAge,uMotion);
  float fibre=texture2D(uBloodMap,vec2(fract(vUv.x-age*.1),vUv.y)).r;
  float folds=.5+.5*sin(vUv.y*16.0+vUv.x*11.0+fibre*3.0);
  float edge=1.0-smoothstep(.018,.065,vUv.y);
  colour=mix(uTint,uAccent,folds*.75+fibre*.15);
  colour+=uAccent*smoothstep(.87,.99,folds)*.3;
  colour=mix(colour,vec3(.86,.91,.95),edge*.9);
  float head=min(1.12,age*6.0);
  float reveal=1.0-smoothstep(head-.06,head+.02,vUv.x);
  float edgeShape=.68+.2*sin(vUv.x*29.0)+.09*sin(vUv.x*67.0);
  float body=1.0-smoothstep(edgeShape-.03,edgeShape+.025,vUv.y);
  float decay=smoothstep(.4,.96,age);
  float breakup=mix(1.0,smoothstep(-.25+decay*1.3,.1+decay*1.3,fibre+sin(vUv.x*51.0-vUv.y*17.0)),decay);
  alpha=reveal*body*breakup*(.72+edge*.2)*(1.0-smoothstep(.7,1.0,uAge));
}`;
