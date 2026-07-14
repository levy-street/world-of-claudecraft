// Pure couch co-op pad-slot core: which physical gamepad drives which local
// player (P2-P4), the Start join gesture, the hold-Start leave gesture, and
// the per-frame move/action extraction for each assigned pad. No DOM and no
// `navigator` (the thin consumer in coop_manager.ts polls getGamepads()), so
// every rule here unit-tests with synthetic pad snapshots — the same pure-core
// split as gamepad_map.ts.
//
// Player 1 is NOT modeled here: their pad stays with the existing
// GamepadManager (full bindings, camera on the right stick, UI cursor). Co-op
// pads get the fixed console-MMO subset below; the shared camera is Player
// 1's, so a co-op right stick does nothing in v1.

import { applyRadialDeadzone, GP, risingEdges } from './gamepad_map';

/** A minimal, host-agnostic picture of one physical pad for one frame. */
export interface CoopPadSnapshot {
  index: number;
  connected: boolean;
  buttons: readonly boolean[];
  axes: readonly number[];
}

export type CoopSlotNumber = 2 | 3 | 4;
export const COOP_SLOT_NUMBERS: readonly CoopSlotNumber[] = [2, 3, 4] as const;
/** Player 1 plus up to three co-op pads. */
export const COOP_MAX_LOCAL_PLAYERS = 4;
/** Hold Start this long to leave (a tap must never eject a player mid-fight). */
export const COOP_LEAVE_HOLD_MS = 2000;

// Fixed in-world button layout for co-op pads. Action ids reuse the keybind
// registry ids exactly like DEFAULT_GAMEPAD_BINDINGS, so the host dispatches
// them through the per-player command path with no new vocabulary. A (jump)
// rides the move flags; Start is reserved for join/leave; Back/View pauses the
// shared game (routed to the game menu, not a per-player command); L3/R3 stay
// unbound (autorun and friendly-target remain Player 1 concerns).
export const COOP_PAD_ACTIONS: Record<number, string> = {
  [GP.B]: 'interact',
  [GP.X]: 'slot0', // Attack
  [GP.Y]: 'target',
  [GP.RB]: 'slot1',
  [GP.LB]: 'slot2',
  [GP.RT]: 'slot3',
  [GP.LT]: 'slot4',
  [GP.DPAD_UP]: 'slot5',
  [GP.DPAD_RIGHT]: 'slot6',
  [GP.DPAD_DOWN]: 'slot7',
  [GP.DPAD_LEFT]: 'slot8',
  [GP.BACK]: 'pause', // View/Select/Share: any co-op player can pause the game
};

/** 'joining': the pad owns a join-overlay session; 'active': driving a player. */
export type CoopSlotPhase = 'joining' | 'active';

export interface CoopSlotFrame {
  slot: CoopSlotNumber;
  padIndex: number;
  phase: CoopSlotPhase;
  /**
   * Left-stick travel direction this frame, relative to the shared camera:
   * the world facing is `camYaw - moveAngle` (sim convention: travel along
   * (sin f, cos f), screen-right decreases facing). Null inside the deadzone.
   */
  moveAngle: number | null;
  /** Deadzone-rescaled stick magnitude, 0..1. */
  moveStrength: number;
  jump: boolean;
  /** Rising-edge action ids (active phase only). */
  actions: string[];
  /** Raw rising-edge button indices (joining phase only, for the overlay). */
  menuEdges: number[];
  /** Pad vanished or Start was held past COOP_LEAVE_HOLD_MS: release me. */
  leave: boolean;
}

export interface CoopSlotsFrame {
  /** Pad indices whose Start rising edge asks to join (unassigned pads only). */
  joinRequests: number[];
  slots: CoopSlotFrame[];
}

interface SlotState {
  padIndex: number;
  phase: CoopSlotPhase;
  prevButtons: boolean[];
  startHeldMs: number;
  leaveFired: boolean;
}

export class CoopSlots {
  private slots = new Map<CoopSlotNumber, SlotState>();
  // Previous button snapshot per UNASSIGNED pad, for the join rising edge.
  private prevUnassigned = new Map<number, boolean[]>();
  private deadzone = 0.18;

  setDeadzone(dz: number): void {
    this.deadzone = Math.min(0.9, Math.max(0.02, dz));
  }

  // Per-slot action bindings (default to COOP_PAD_ACTIONS).
  private slotBindings = new Map<CoopSlotNumber, Record<number, string>>();

  /** Set the action bindings for one co-op slot. */
  setSlotBindings(slot: CoopSlotNumber, bindings: Record<number, string>): void {
    this.slotBindings.set(slot, { ...bindings });
  }

  /** Get the effective bindings for a slot (custom or default). */
  getSlotBindings(slot: CoopSlotNumber): Record<number, string> {
    return this.slotBindings.get(slot) ?? COOP_PAD_ACTIONS;
  }

  /** All slots and their pad assignments, for the UI. */
  slotList(): { slot: CoopSlotNumber; padIndex: number; phase: CoopSlotPhase }[] {
    const out: { slot: CoopSlotNumber; padIndex: number; phase: CoopSlotPhase }[] = [];
    for (const [slot, s] of this.slots) {
      out.push({ slot, padIndex: s.padIndex, phase: s.phase });
    }
    return out;
  }

  /** Reassign a slot to a different physical pad. Returns true on success. */
  reassignPad(slot: CoopSlotNumber, newPadIndex: number): boolean {
    const s = this.slots.get(slot);
    if (!s) return false;
    // Check the new pad isn't already claimed by another slot.
    for (const [otherSlot, other] of this.slots) {
      if (otherSlot !== slot && other.padIndex === newPadIndex) return false;
    }
    s.padIndex = newPadIndex;
    return true;
  }

  slotForPad(padIndex: number): CoopSlotNumber | null {
    for (const [slot, s] of this.slots) {
      if (s.padIndex === padIndex) return slot;
    }
    return null;
  }

  assignedCount(): number {
    return this.slots.size;
  }
hasSlot(slot: CoopSlotNumber): boolean {
    return this.slots.has(slot);
  }

  /**
   * Claim a slot for a keyboard join (no physical pad). Stores a sentinel
   * entry so assignedCount() and hasSlot() see it, but pad-driven frame
   * polling skips it (padIndex -1 never matches a real controller).
   */
  claimKeyboard(slot: CoopSlotNumber): void {
    this.slots.set(slot, {
      padIndex: -1,
      phase: "joining",
      prevButtons: [],
      startHeldMs: 0,
      leaveFired: false,
    });
  }

  phaseOf(slot: CoopSlotNumber): CoopSlotPhase | null {
    return this.slots.get(slot)?.phase ?? null;
  }

  /**
   * Reserve the lowest free slot for a pad and enter the joining phase.
   * Returns null when the pad is already assigned or the table is full.
   * The pad's current buttons seed the edge detector, so the Start press
   * that opened the join flow never leaks into the overlay as an edge.
   */
  claim(pad: CoopPadSnapshot): CoopSlotNumber | null {
    if (this.slotForPad(pad.index) !== null) return null;
    for (const slot of COOP_SLOT_NUMBERS) {
      if (!this.slots.has(slot)) {
        this.slots.set(slot, {
          padIndex: pad.index,
          phase: 'joining',
          prevButtons: [...pad.buttons],
          startHeldMs: 0,
          leaveFired: false,
        });
        this.prevUnassigned.delete(pad.index);
        return slot;
      }
    }
    return null;
  }

  /** The join flow finished: the pad now drives a player. */
  activate(slot: CoopSlotNumber): void {
    const s = this.slots.get(slot);
    if (s) s.phase = 'active';
  }

  /** Free the slot (join cancelled, player left, or pad disconnected). */
  release(slot: CoopSlotNumber): void {
    this.slots.delete(slot);
  }

  /**
   * One frame: derive join requests from unassigned pads and a CoopSlotFrame
   * per assigned pad. `excludePadIndex` is Player 1's pad (GamepadManager's),
   * which never joins co-op.
   */
  frame(
    pads: readonly CoopPadSnapshot[],
    excludePadIndex: number | null,
    dtMs: number,
  ): CoopSlotsFrame {
    const byIndex = new Map<number, CoopPadSnapshot>();
    for (const pad of pads) {
      if (pad.connected) byIndex.set(pad.index, pad);
    }

    const joinRequests: number[] = [];
    const slotFrames: CoopSlotFrame[] = [];

    // Assigned slots first, so a full table blocks join requests this frame.
    for (const slot of COOP_SLOT_NUMBERS) {
      const s = this.slots.get(slot);
      if (!s) continue;
      const pad = byIndex.get(s.padIndex);
      if (!pad) {
        if (s.padIndex >= 0) {
          // Real pad disconnected: emit one leave frame; the host releases the slot.
          slotFrames.push(emptyFrame(slot, s.padIndex, s.phase, true));
        } else {
          // Keyboard-claimed slot (padIndex -1): no physical pad, just emit
          // a stub frame so the manager sees it is still joining.
          slotFrames.push({
            slot,
            padIndex: s.padIndex,
            phase: s.phase,
            moveAngle: null,
            moveStrength: 0,
            jump: false,
            actions: [],
            menuEdges: [],
            leave: false,
          });
        }
        continue;
      }
      const startDown = pad.buttons[GP.START] === true;
      s.startHeldMs = startDown ? s.startHeldMs + Math.max(0, dtMs) : 0;
      if (!startDown) s.leaveFired = false;
      let leave = false;
      if (s.startHeldMs >= COOP_LEAVE_HOLD_MS && !s.leaveFired) {
        s.leaveFired = true;
        leave = true;
      }

      const edges = risingEdges(s.prevButtons, pad.buttons);
      s.prevButtons = [...pad.buttons];

      const sx = pad.axes[0] ?? 0;
      const sy = pad.axes[1] ?? 0;
      const v = applyRadialDeadzone(sx, sy, this.deadzone);
      const strength = Math.min(1, Math.hypot(v.x, v.y));
      const moveAngle = strength > 0 ? Math.atan2(v.x, -v.y) : null;

      const actions: string[] = [];
      const menuEdges: number[] = [];
      for (const b of edges) {
        if (b === GP.START) continue; // reserved for join/leave
        if (s.phase === 'joining') menuEdges.push(b);
        else { const bindings = this.getSlotBindings(slot); if (bindings[b]) actions.push(bindings[b]); }
      }

      slotFrames.push({
        slot,
        padIndex: s.padIndex,
        phase: s.phase,
        moveAngle: s.phase === 'active' ? moveAngle : null,
        moveStrength: s.phase === 'active' ? strength : 0,
        jump: s.phase === 'active' && pad.buttons[GP.A] === true,
        actions,
        menuEdges,
        leave,
      });
    }

    // Unassigned pads: a Start rising edge is a join request (when room remains).
    const roomLeft = this.slots.size < COOP_SLOT_NUMBERS.length;
    for (const pad of byIndex.values()) {
      if (pad.index === excludePadIndex) continue;
      if (this.slotForPad(pad.index) !== null) continue;
      const prev = this.prevUnassigned.get(pad.index) ?? [];
      const startEdge = pad.buttons[GP.START] === true && prev[GP.START] !== true;
      this.prevUnassigned.set(pad.index, [...pad.buttons]);
      if (startEdge && roomLeft) joinRequests.push(pad.index);
    }
    // Forget pads that are gone, so a reconnect starts with a clean edge state.
    for (const idx of [...this.prevUnassigned.keys()]) {
      if (!byIndex.has(idx)) this.prevUnassigned.delete(idx);
    }

    return { joinRequests, slots: slotFrames };
  }
}

function emptyFrame(
  slot: CoopSlotNumber,
  padIndex: number,
  phase: CoopSlotPhase,
  leave: boolean,
): CoopSlotFrame {
  return {
    slot,
    padIndex,
    phase,
    moveAngle: null,
    moveStrength: 0,
    jump: false,
    actions: [],
    menuEdges: [],
    leave,
  };
}
