// A spike of ice for the Guardian of the Quench's effects: a six-sided blade
// tapering to its tip, deep at the root and pale at the tip (the kit's ice
// material reads the vertex colour). Shared by QuenchFx (Tempering Strike's
// and the breath's spikes) and QuenchWakeThrow (the Blades Wake's throw).
// Built once by each owner in its constructor (it owns and disposes it).

import * as THREE from 'three';
import { QUENCH_FX_COLORS as C } from './quench_fx_core';

export function quenchSpikeGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.32, 1, 6, 2).translate(0, 0.5, 0);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const deep = new THREE.Color().setRGB(...C.iceDeep);
  const pale = new THREE.Color().setRGB(...C.ice);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Flatten it to a blade a little, so it reads as a shard, not a cone.
    pos.setZ(i, pos.getZ(i) * 0.55);
    c.copy(deep).lerp(pale, Math.min(1, pos.getY(i) * 1.2));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
