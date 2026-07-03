// Player housing: the Homestead Glens. A new system module behind SimContext
// (the market.ts shape): this class OWNS the slot occupancy and the Land
// Steward entity ids; the deed flag lives on PlayerMeta (persisted in the
// character JSONB) and the world objects (exit gate, plot mailbox) are spawned
// by the Sim ctor like every other world object.
//
// Travel is teleport-only: the Steward in Eastbrook sends an owner to a free
// plot slot in the far-west Glens band (data.ts homesteadOrigin), and the gate
// at the plot sends them back. Slots are per-visit (any free slot serves; all
// plots share one blueprint), released as soon as the visitor leaves the band,
// so the Glens scale like dungeon instance slots.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/
// Date.now (enforced by tests/architecture.test.ts). Housing draws NO rng.

import { HOMESTEAD_ARRIVAL, HOMESTEAD_ARRIVAL_FACING, HOMESTEAD_DEED_COPPER, LAND_STEWARD } from '../content/housing';
import { HOMESTEAD_SLOT_COUNT, homesteadOrigin, isHomesteadPos } from '../data';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, type HousingResultCode, INTERACT_RANGE } from '../types';

const STEWARD_RANGE = INTERACT_RANGE + 2; // deal with the Steward face to face

export class Homestead {
  // slot index -> visiting pid (null = free). Per-visit occupancy, never persisted.
  slots: (number | null)[] = new Array(HOMESTEAD_SLOT_COUNT).fill(null);
  // Entity ids of every housing NPC (the Land Steward), assigned by the Sim
  // ctor during NPC placement.
  stewardIds: number[] = [];

  constructor(private readonly ctx: SimContext) {}

  private result(pid: number, code: HousingResultCode): void {
    this.ctx.emit({ type: 'housingResult', code, pid });
  }

  private nearSteward(e: Entity): boolean {
    for (const id of this.stewardIds) {
      const npc = this.ctx.entities.get(id);
      if (npc && npc.kind === 'npc' && dist2d(e.pos, npc.pos) <= STEWARD_RANGE) return true;
    }
    return false;
  }

  /** Where leaving the Glens drops you: beside the Land Steward in Eastbrook. */
  townReturnPos(): { x: number; z: number } {
    return { x: LAND_STEWARD.pos.x + 2.5, z: LAND_STEWARD.pos.z + 2.5 };
  }

  homesteadBuy(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return;
    if (!this.nearSteward(p)) {
      this.result(meta.entityId, 'tooFar');
      return;
    }
    if (meta.homesteadOwned) {
      this.result(meta.entityId, 'alreadyOwned');
      return;
    }
    if (meta.copper < HOMESTEAD_DEED_COPPER) {
      this.result(meta.entityId, 'cantAfford');
      return;
    }
    meta.copper -= HOMESTEAD_DEED_COPPER;
    meta.homesteadOwned = true;
    this.result(meta.entityId, 'purchased');
  }

  homesteadTravel(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return;
    if (!meta.homesteadOwned) {
      this.result(meta.entityId, 'notOwned');
      return;
    }
    if (isHomesteadPos(p.pos.x)) return; // already home
    if (!this.nearSteward(p)) {
      this.result(meta.entityId, 'tooFar');
      return;
    }
    let slot = this.slots.indexOf(meta.entityId);
    if (slot < 0) slot = this.slots.indexOf(null);
    if (slot < 0) {
      this.result(meta.entityId, 'glensFull');
      return;
    }
    this.slots[slot] = meta.entityId;
    const origin = homesteadOrigin(slot);
    p.pos = this.ctx.groundPos(origin.x + HOMESTEAD_ARRIVAL.x, origin.z + HOMESTEAD_ARRIVAL.z);
    p.prevPos = { ...p.pos };
    p.facing = HOMESTEAD_ARRIVAL_FACING;
    p.prevFacing = p.facing;
    this.ctx.rebucket(p);
    this.result(meta.entityId, 'traveledHome');
  }

  homesteadLeave(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (!isHomesteadPos(p.pos.x)) {
      this.result(meta.entityId, 'notHome');
      return;
    }
    const back = this.townReturnPos();
    p.pos = this.ctx.groundPos(back.x, back.z);
    p.prevPos = { ...p.pos };
    this.ctx.rebucket(p);
    const slot = this.slots.indexOf(meta.entityId);
    if (slot >= 0) this.slots[slot] = null;
    this.result(meta.entityId, 'leftHome');
  }

  // Public tick entry (end-of-tick system block, once a second): release the
  // slot of any visitor who is gone or no longer inside the Glens (logout,
  // death release, a dev teleport), so plots never leak.
  update(): void {
    if (this.ctx.tickCount % 20 !== 0) return;
    for (let i = 0; i < this.slots.length; i++) {
      const pid = this.slots[i];
      if (pid === null) continue;
      const e = this.ctx.entities.get(pid);
      if (!e || !isHomesteadPos(e.pos.x)) this.slots[i] = null;
    }
  }
}
