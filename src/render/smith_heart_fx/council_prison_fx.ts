// The Hammer Council's Stone Prison (encounters/smith_heart/council_prison.ts), a part
// of CouncilFx: a block of granite plates with gold cracks round each prisoner, over
// the bodyless target the raid strikes, shrinking a little as it is broken
// (prisonBlockScale); broken or spent, it bursts into rock. It marks what the raid
// must attack, so every tier draws it. Built in the constructor under the host's
// root (one gated attach), fixed pieces, no light, no per-frame allocation; the blocks
// are found at the host's scan pace.

import * as THREE from 'three';
import { COUNCIL_PRISON } from '../../sim/encounters/smith_heart/council_ids';
import type { Entity } from '../../sim/types';
import { prisonBlockScale } from './council_fx_core';
import type { CouncilFxHost } from './council_pillars_fx';
import { KIT_UV_VERT, SHELL_FRAG } from './final_kit_glsl';
import { shellStone } from './final_kit_shapes';

/** The most blocks at once (Mythic's prisoners, and a spare). */
const BLOCKS = 4;
const BURST_PIECES = 12;

interface Block {
  mesh: THREE.Mesh;
  id: number;
  seen: boolean;
}

export class CouncilPrisonFx {
  private readonly blocks: Block[] = [];

  constructor(private readonly h: CouncilFxHost) {
    const geo = shellStone();
    h.geometries.push(geo);
    const mat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilPrison',
      uniforms: {
        uTime: h.uTime,
        uStone: { value: new THREE.Color(0x5a5048) },
        uGold: { value: new THREE.Color(1.0, 0.78, 0.36) },
      },
      vertexShader: KIT_UV_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
    });
    h.materials.push(mat);
    for (let i = 0; i < BLOCKS; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'smithHeartCouncilPrison';
      mesh.visible = false;
      mesh.frustumCulled = false;
      h.root.add(mesh);
      this.blocks.push({ mesh, id: -1, seen: false });
    }
  }

  beginScan(): void {
    for (const b of this.blocks) b.seen = false;
  }

  /** A mob the host's scan found: a living block takes a piece. */
  see(e: Entity): void {
    if (e.templateId !== COUNCIL_PRISON || e.dead) return;
    const have = this.blocks.find((b) => b.id === e.id);
    if (have) {
      have.seen = true;
      return;
    }
    const free = this.blocks.find((b) => b.id < 0);
    if (!free) return;
    free.id = e.id;
    free.seen = true;
  }

  endScan(): void {
    for (const b of this.blocks) if (b.id >= 0 && !b.seen) this.burst(b);
  }

  update(): void {
    for (const b of this.blocks) {
      if (b.id < 0) continue;
      const e = this.h.entity(b.id);
      if (!e || e.dead) {
        this.burst(b);
        continue;
      }
      b.mesh.position.set(e.pos.x, this.h.groundY(e.pos.x, e.pos.z), e.pos.z);
      b.mesh.scale.setScalar(prisonBlockScale(e.hp / Math.max(1, e.maxHp)));
      b.mesh.visible = true;
    }
  }

  private burst(b: Block): void {
    const { x, y, z } = b.mesh.position;
    if (b.mesh.visible) {
      const n = Math.ceil(BURST_PIECES * this.h.density);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const sp = 3 + this.h.rand() * 4;
        this.h.debris.throw(
          x + Math.sin(a),
          y + 1 + this.h.rand() * 1.5,
          z + Math.cos(a),
          Math.sin(a) * sp,
          3 + this.h.rand() * 5,
          Math.cos(a) * sp,
          0.3 + this.h.rand() * 0.5,
        );
      }
    }
    b.id = -1;
    b.mesh.visible = false;
  }
}
