// The seam that binds the DOM-free CoopManager/CoopOverlay to the live game:
// polls the real gamepads into pad snapshots, feeds Player 1's camera yaw and
// body in, drives the join overlay, builds each co-op player handle (a Sim pid
// offline, a secondary ClientWorld online), and writes the smoothed shared
// camera anchor + distance onto the renderer each frame.
//
// main.ts creates ONE of these per world entry (offline or online) and calls
// frame(dtMs) inside its existing loop; teardown() on leaving the world. All
// the tricky per-frame logic lives in the pure CoopManager (unit-tested); this
// file is the thin, DOM-touching adapter.

import type { PlayerClass } from '../sim/types';
import { coopSmooth, type CoopCameraFrame } from './coop_camera';
import { CoopManager, type CoopHost } from './coop_manager';
import {
  OfflineCoopPlayer,
  OnlineCoopPlayer,
  type CoopOfflineSim,
  type CoopOnlineSession,
  type CoopPlayer,
} from './coop_player';
import type { CoopPadSnapshot, CoopSlotNumber } from './coop_slots';
import { CoopOverlay, type CoopCharacterRef, type CoopJoinChoice } from '../ui/coop_overlay';

interface RendererCoopCamera {
  coopCameraAnchor: { x: number; y: number; z: number } | null;
  coopCameraDist: number | null;
  camDist: number;
}

export interface CoopControllerDeps {
  mode: 'offline' | 'online';
  renderer: RendererCoopCamera;
  // Player 1's live camera yaw (main.ts keeps input.camYaw authoritative).
  camYaw: () => number;
  // The pad index Player 1 owns (GamepadManager.activePadIndex()), or null when
  // Player 1 is on keyboard/mouse. That pad is excluded from the co-op join
  // pool; null means every connected pad may join (keyboard-P1 + controllers).
  primaryPadIndex: () => number | null;
  // Player 1's live body, for the framing centroid and the leash.
  primaryEntity: () => { x: number; y: number; z: number } | null;
  // Viewport aspect (width / height) for the fit-distance math.
  aspect: () => number;
  fovYDeg: number;
  classes: readonly PlayerClass[];
  classLabel: (cls: PlayerClass) => string;
  padDeadzone?: number;
  // A co-op player pressed pause (Back/View): toggle the shared game menu.
  pause?: () => void;

  // Offline: the shared Sim and how to add a local player near Player 1.
  offline?: {
    sim: CoopOfflineSim;
    primaryPid: () => number;
    addLocalPlayer: (cls: PlayerClass, name: string) => number;
  };
  // Online: how to open a secondary session and enumerate characters.
  online?: {
    sameAccountCharacters: () => CoopCharacterRef[];
    loginSeparate: (
      username: string,
      password: string,
    ) => Promise<{ token: string; base: string; characters: CoopCharacterRef[] }>;
    // Build a secondary ClientWorld for `character` (coop-flagged); `token`/
    // `base` are null for the same-account flow (reuse Player 1's).
    openSession: (
      character: CoopCharacterRef,
      token: string | null,
      base: string | null,
    ) => CoopOnlineSession;
    // Create a new character (on Player 1's account when token is null, else on
    // the signed-in separate account) and resolve its ref.
    createCharacter: (
      name: string,
      cls: PlayerClass,
      token: string | null,
      base: string | null,
    ) => Promise<CoopCharacterRef>;
  };
}

const CAMERA_SMOOTH_RATE = 6; // exp approach for the shared anchor + distance

export class CoopController {
  private readonly manager: CoopManager;
  private readonly overlay: CoopOverlay;
  // Smoothed camera state, so a join or a leash sprint glides instead of snapping.
  private smoothAnchor: { x: number; y: number; z: number } | null = null;
  private smoothDist = 0;

  constructor(private readonly deps: CoopControllerDeps) {
    const host: CoopHost = {
      pads: () => readPadSnapshots(),
      primaryPadIndex: () => deps.primaryPadIndex(),
      camYaw: () => deps.camYaw(),
      cameraParams: () => ({
        fovYDeg: deps.fovYDeg,
        aspect: deps.aspect(),
        baseDist: deps.renderer.camDist,
      }),
      primaryEntity: () => deps.primaryEntity(),
      beginJoin: (slot, _padIndex) => this.beginJoin(slot),
      overlayInput: (slot, edges) => {
        if (this.overlay.openSlot === slot) this.overlay.padInput(edges);
      },
      onJoinAborted: () => this.overlay.close(),
      onPause: () => this.deps.pause?.(),
    };
    this.manager = new CoopManager(host);
    if (deps.padDeadzone !== undefined) this.manager.setDeadzone(deps.padDeadzone);
    this.overlay = new CoopOverlay({
      mode: deps.mode,
      classes: deps.classes,
      classLabel: deps.classLabel,
      sameAccountCharacters: deps.online?.sameAccountCharacters,
      loginSeparate: deps.online?.loginSeparate,
      createCharacter: deps.online?.createCharacter,
    });
  }

  get hasCoopPlayers(): boolean {
    return this.manager.hasCoopPlayers;
  }

  get localPlayerCount(): number {
    return this.manager.localPlayerCount;
  }

  /** Open the join overlay from the keyboard (F2 or similar). */
  requestKeyboardJoin(): boolean {
    return this.manager.requestKeyboardJoin();
  }

  /** Slot/pad assignments for the options UI. */
  slotInfo(): { slot: number; padIndex: number; active: boolean }[] {
    return this.manager.slotInfo();
  }

  /** Per-slot action bindings for the UI. */
  getSlotBindings(slot: number): Record<number, string> {
    return this.manager.getSlotBindings(slot as any);
  }

  /** Set per-slot bindings from the UI. */
  setSlotBindings(slot: number, bindings: Record<number, string>): void {
    this.manager.setSlotBindings(slot as any, bindings);
  }

  /** Reassign a physical pad to a different slot. */
  reassignPad(slot: number, newPadIndex: number): boolean {
    return this.manager.reassignPad(slot as any, newPadIndex);
  }

  frame(dtMs: number): void {
    const camFrame = this.manager.frame(dtMs);
    this.applyCamera(camFrame, dtMs);
  }

  teardown(): void {
    this.overlay.close();
    this.manager.removeAll();
    this.deps.renderer.coopCameraAnchor = null;
    this.deps.renderer.coopCameraDist = null;
  }

  private applyCamera(camFrame: CoopCameraFrame | null, dtMs: number): void {
    if (!camFrame) {
      this.smoothAnchor = null;
      this.deps.renderer.coopCameraAnchor = null;
      this.deps.renderer.coopCameraDist = null;
      return;
    }
    const dt = Math.max(0, dtMs) / 1000;
    if (!this.smoothAnchor) {
      // First co-op frame: adopt the target outright (no glide from a stale pose).
      this.smoothAnchor = { ...camFrame.anchor };
      this.smoothDist = camFrame.dist;
    } else {
      this.smoothAnchor = {
        x: coopSmooth(this.smoothAnchor.x, camFrame.anchor.x, CAMERA_SMOOTH_RATE, dt),
        y: coopSmooth(this.smoothAnchor.y, camFrame.anchor.y, CAMERA_SMOOTH_RATE, dt),
        z: coopSmooth(this.smoothAnchor.z, camFrame.anchor.z, CAMERA_SMOOTH_RATE, dt),
      };
      this.smoothDist = coopSmooth(this.smoothDist, camFrame.dist, CAMERA_SMOOTH_RATE, dt);
    }
    this.deps.renderer.coopCameraAnchor = this.smoothAnchor;
    this.deps.renderer.coopCameraDist = this.smoothDist;
  }

  private beginJoin(slot: CoopSlotNumber): void {
    this.overlay.open(
      slot,
      (choice) => this.createPlayer(slot, choice),
      () => this.manager.cancelJoin(slot),
    );
  }

  private createPlayer(slot: CoopSlotNumber, choice: CoopJoinChoice): void {
    let handle: CoopPlayer | null = null;
    if (choice.kind === 'offline' && this.deps.offline) {
      const primary = this.deps.offline.primaryPid();
      const pid = this.deps.offline.addLocalPlayer(choice.cls, choice.name);
      // Auto-party the joiner onto Player 1 so party frames, teammate
      // healthbars, and split XP light up the instant they join — no manual
      // /invite dance on a shared screen.
      this.deps.offline.sim.partyInvite(pid, primary);
      this.deps.offline.sim.partyAccept(pid);
      handle = new OfflineCoopPlayer(this.deps.offline.sim, pid, choice.cls, primary);
    } else if (choice.kind === 'online' && this.deps.online) {
      const session = this.deps.online.openSession(choice.character, choice.token, choice.base);
      handle = new OnlineCoopPlayer(session, choice.character.cls, () => {});
    }
    if (handle) this.manager.attachPlayer(slot, handle);
    else this.manager.cancelJoin(slot);
  }
}

// --- gamepad polling ----------------------------------------------------------

function connectedPads(): (Gamepad | null)[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  return Array.from(navigator.getGamepads());
}

function readPadSnapshots(): CoopPadSnapshot[] {
  const out: CoopPadSnapshot[] = [];
  for (const pad of connectedPads()) {
    if (!pad?.connected) continue;
    out.push({
      index: pad.index,
      connected: true,
      buttons: pad.buttons.map((b) => b.pressed),
      axes: [...pad.axes],
    });
  }
  return out;
}
