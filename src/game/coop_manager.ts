// Couch co-op orchestrator: the per-frame glue that turns the pad-slot core
// (coop_slots) into live co-op players (coop_player), runs each player's death
// scheduler (coop_respawn), and produces the shared framing camera pose
// (coop_camera) for the renderer. It is DOM-free and talks to the outside world
// only through an injected `CoopHost`, so the whole loop unit-tests with a fake
// host and fake player handles.
//
// The join flow is deliberately handed to the host: when an unassigned pad asks
// to join, the manager reserves the slot and calls `host.beginJoin`; the host
// drives its own class-pick (and, online, the account/login step) overlay and
// calls back `attachPlayer` on confirm or `cancelJoin` on abort. Menu edges from
// the joining pad are forwarded to `host.overlayInput` so the overlay is fully
// pad-navigable.

import { wrapAngle } from './camera_follow';
import type { CoopCameraFrame } from './coop_camera';
import { coopCameraFrame, coopCentroid, coopMoveAllowed } from './coop_camera';
import type { CoopPlayer } from './coop_player';
import { CoopRespawnTimer } from './coop_respawn';
import {
  COOP_PAD_ACTIONS,
  type CoopPadSnapshot,
  type CoopSlotNumber,
  CoopSlots,
} from './coop_slots';

export interface CoopCameraParams {
  fovYDeg: number;
  aspect: number;
  /** Player 1's currently chosen zoom (the co-op camera never zooms in past it). */
  baseDist: number;
}

export interface CoopHost {
  /** Every connected pad this frame (Player 1's included; it is filtered out). */
  pads(): CoopPadSnapshot[];
  /** Player 1's pad index, which never joins co-op. */
  primaryPadIndex(): number | null;
  /** The shared camera yaw (Player 1 owns it). */
  camYaw(): number;
  cameraParams(): CoopCameraParams;
  /** Player 1's body, for the camera centroid and the leash. */
  primaryEntity(): { x: number; y: number; z: number } | null;
  /**
   * A pad asked to join and the manager reserved `slot`. The host opens its
   * join overlay and later calls `attachPlayer(slot, handle)` or
   * `cancelJoin(slot)`. `padIndex` identifies the joining controller.
   */
  beginJoin(slot: CoopSlotNumber, padIndex: number): void;
  /** Forward a joining pad's menu button edges to the open overlay. */
  overlayInput(slot: CoopSlotNumber, buttonEdges: number[]): void;
  /** A slot's join was aborted because its pad vanished mid-overlay. */
  onJoinAborted?(slot: CoopSlotNumber): void;
  /** A co-op player pressed the pause button (toggle the shared game menu). */
  onPause?(): void;
}

interface ActiveSlot {
  handle: CoopPlayer;
  respawn: CoopRespawnTimer;
}

export class CoopManager {
  private readonly slots = new CoopSlots();
  private readonly active = new Map<CoopSlotNumber, ActiveSlot>();
  private readonly joining = new Set<CoopSlotNumber>();

  constructor(private readonly host: CoopHost) {}

  /**
   * Request a co-op join from the keyboard (no physical pad required).
   * Claims the lowest free slot and hands it to the host's overlay. Useful
   * for testing without controllers and for keyboard/mouse Player 2-4 joins.
   */
  requestKeyboardJoin(): boolean {
    if (this.slots.assignedCount() + this.joining.size >= 3) return false;
    const freeSlot = ([2, 3, 4] as const).find(
      (s) => !this.slots.hasSlot(s) && !this.joining.has(s),
    );
    if (freeSlot === undefined) return false;
    // Claim the slot in the pad-slot table (with a sentinel pad index -1) so
    // assignedCount() and hasSlot() see it for subsequent joins. Without this,
    // every keyboard join lands on slot 2 because the earlier slot was never
    // recorded in CoopSlots.
    this.slots.claimKeyboard(freeSlot);
    this.joining.add(freeSlot);
    this.host.beginJoin(freeSlot, -1);
    return true;
  }

  /** True while at least one co-op player is in the world (P2-P4). */
  get hasCoopPlayers(): boolean {
    return this.active.size > 0;
  }

  /** Number of local players including Player 1 (1..4). */
  get localPlayerCount(): number {
    return 1 + this.active.size;
  }

  /** Slot/pad assignments for the UI. */
  slotInfo(): { slot: CoopSlotNumber; padIndex: number; active: boolean }[] {
    return this.slots.slotList().map((s) => ({
      slot: s.slot,
      padIndex: s.padIndex,
      active: this.active.has(s.slot),
    }));
  }

  /** Per-slot bindings for the UI. */
  getSlotBindings(slot: CoopSlotNumber): Record<number, string> {
    return this.slots.getSlotBindings(slot);
  }

  /** Set per-slot bindings from the UI. */
  setSlotBindings(slot: CoopSlotNumber, bindings: Record<number, string>): void {
    this.slots.setSlotBindings(slot, bindings);
  }

  /** Reassign a physical pad to a different slot. */
  reassignPad(slot: CoopSlotNumber, newPadIndex: number): boolean {
    return this.slots.reassignPad(slot, newPadIndex);
  }

  setDeadzone(dz: number): void {
    this.slots.setDeadzone(dz);
  }

  /** Host callback: the overlay confirmed a class (and account) for `slot`. */
  attachPlayer(slot: CoopSlotNumber, handle: CoopPlayer): void {
    if (!this.joining.has(slot)) return;
    this.joining.delete(slot);
    this.slots.activate(slot);
    this.active.set(slot, { handle, respawn: new CoopRespawnTimer() });
  }

  /** Host callback: the overlay was cancelled for `slot`. */
  cancelJoin(slot: CoopSlotNumber): void {
    this.joining.delete(slot);
    this.slots.release(slot);
  }

  /** Tear down every co-op player (leaving the world / returning to menu). */
  removeAll(): void {
    for (const [slot, rec] of this.active) {
      rec.handle.remove();
      this.slots.release(slot);
    }
    this.active.clear();
    for (const slot of this.joining) this.slots.release(slot);
    this.joining.clear();
  }

  /**
   * Advance one frame. Returns the shared camera pose when two or more local
   * players are present, else null (Player 1's normal chase camera stays).
   */
  frame(dtMs: number): CoopCameraFrame | null {
    const pads = this.host.pads();
    const f = this.slots.frame(pads, this.host.primaryPadIndex(), dtMs);

    // New join requests: reserve a slot and hand the overlay to the host.
    for (const padIndex of f.joinRequests) {
      const pad = pads.find((p) => p.index === padIndex);
      if (!pad) continue;
      const slot = this.slots.claim(pad);
      if (slot === null) continue;
      this.joining.add(slot);
      this.host.beginJoin(slot, padIndex);
    }

    const camYaw = this.host.camYaw();
    const centroid = this.currentCentroid();

    for (const sf of f.slots) {
      if (sf.phase === 'joining') {
        if (sf.leave) {
          // The pad disconnected while its overlay was open.
          this.cancelJoin(sf.slot);
          this.host.onJoinAborted?.(sf.slot);
        } else if (sf.menuEdges.length > 0) {
          this.host.overlayInput(sf.slot, sf.menuEdges);
        }
        continue;
      }
      const rec = this.active.get(sf.slot);
      if (!rec) continue;
      if (sf.leave) {
        rec.handle.remove();
        this.active.delete(sf.slot);
        this.slots.release(sf.slot);
        continue;
      }

      // Twin-stick movement: stick direction (relative to the shared camera)
      // becomes a world facing; the leash zeroes it when it points outward past
      // the leash radius (never inward, so a player is never trapped off-party).
      let worldFacing: number | null = null;
      if (sf.moveAngle !== null) {
        const wf = wrapAngle(camYaw - sf.moveAngle);
        const ent = rec.handle.entity();
        if (!ent || centroid === null || coopMoveAllowed(ent, centroid, wf)) {
          worldFacing = wf;
        }
      }
      rec.handle.applyMove(worldFacing, sf.jump);

      for (const action of sf.actions) {
        if (action === 'pause') this.host.onPause?.();
        else routeAction(rec.handle, action);
      }

      const ent = rec.handle.entity();
      if (ent) {
        const act = rec.respawn.step({ dead: ent.dead, ghost: ent.ghost }, dtMs);
        if (act === 'release') rec.handle.releaseSpirit();
        else if (act === 'resurrect') rec.handle.resurrectAtSpiritHealer();
        else if (act === 'regroup') rec.handle.regroup();
      }
    }

    return this.cameraFrameNow();
  }

  /** The live positions of every local player (Player 1 first), for framing. */
  private localPositions(): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    const p1 = this.host.primaryEntity();
    if (p1) out.push(p1);
    for (const rec of this.active.values()) {
      const e = rec.handle.entity();
      if (e) out.push({ x: e.x, y: e.y, z: e.z });
    }
    return out;
  }

  private currentCentroid(): { x: number; z: number } | null {
    const pts = this.localPositions();
    if (pts.length === 0) return null;
    const c = coopCentroid(pts);
    return { x: c.x, z: c.z };
  }

  private cameraFrameNow(): CoopCameraFrame | null {
    const params = this.host.cameraParams();
    return coopCameraFrame({
      players: this.localPositions(),
      baseDist: params.baseDist,
      fovYDeg: params.fovYDeg,
      aspect: params.aspect,
    });
  }
}

/** Map a co-op pad action id (COOP_PAD_ACTIONS values) to a handle call. */
export function routeAction(handle: CoopPlayer, action: string): void {
  if (action.startsWith('slot')) {
    const n = Number(action.slice(4));
    if (Number.isInteger(n)) handle.castSlot(n);
    return;
  }
  if (action === 'target') {
    handle.tabTarget();
    return;
  }
  if (action === 'interact') {
    handle.interact();
    return;
  }
}

// Re-export so main.ts and tests import the button->action table from one place.
export { COOP_PAD_ACTIONS };
