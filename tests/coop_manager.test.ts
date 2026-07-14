import { describe, expect, it } from 'vitest';
import { COOP_LEASH_YD } from '../src/game/coop_camera';
import { type CoopHost, CoopManager, routeAction } from '../src/game/coop_manager';
import type { CoopEntitySnapshot, CoopPlayer } from '../src/game/coop_player';
import { COOP_LEAVE_HOLD_MS } from '../src/game/coop_slots';
import { GP, STANDARD_BUTTON_COUNT } from '../src/game/gamepad_map';
import type { PlayerClass } from '../src/sim/types';

function pad(
  index: number,
  opts: { buttons?: Partial<Record<number, boolean>>; axes?: number[] } = {},
) {
  const buttons = new Array(STANDARD_BUTTON_COUNT).fill(false);
  for (const [k, v] of Object.entries(opts.buttons ?? {})) buttons[Number(k)] = v === true;
  return { index, connected: true, buttons, axes: opts.axes ?? [0, 0, 0, 0] };
}

class FakePlayer implements CoopPlayer {
  cls: PlayerClass = 'mage';
  pos = { x: 0, y: 0, z: 0 };
  dead = false;
  ghost = false;
  removed = false;
  lastFacing: number | null = null;
  jump = false;
  casts: number[] = [];
  targets = 0;
  interacts = 0;
  released = 0;
  resurrects = 0;
  regroups = 0;

  entity(): CoopEntitySnapshot | null {
    if (this.removed) return null;
    return { ...this.pos, dead: this.dead, ghost: this.ghost };
  }
  applyMove(worldFacing: number | null, jump: boolean): void {
    this.lastFacing = worldFacing;
    this.jump = jump;
  }
  castSlot(slot: number): void {
    this.casts.push(slot);
  }
  tabTarget(): void {
    this.targets++;
  }
  interact(): void {
    this.interacts++;
  }
  releaseSpirit(): void {
    this.released++;
  }
  resurrectAtSpiritHealer(): void {
    this.resurrects++;
  }
  regroup(): void {
    this.regroups++;
  }
  remove(): void {
    this.removed = true;
  }
}

class FakeHost implements CoopHost {
  padList: ReturnType<typeof pad>[] = [];
  primaryPad: number | null = 0;
  yaw = 0;
  primary: { x: number; y: number; z: number } | null = { x: 0, y: 0, z: 0 };
  joins: { slot: number; padIndex: number }[] = [];
  overlayInputs: { slot: number; edges: number[] }[] = [];
  aborted: number[] = [];

  pads() {
    return this.padList;
  }
  primaryPadIndex() {
    return this.primaryPad;
  }
  camYaw() {
    return this.yaw;
  }
  cameraParams() {
    return { fovYDeg: 60, aspect: 16 / 9, baseDist: 12 };
  }
  primaryEntity() {
    return this.primary;
  }
  beginJoin(slot: number, padIndex: number) {
    this.joins.push({ slot, padIndex });
  }
  overlayInput(slot: number, edges: number[]) {
    this.overlayInputs.push({ slot, edges });
  }
  onJoinAborted(slot: number) {
    this.aborted.push(slot);
  }
  pauses = 0;
  onPause() {
    this.pauses++;
  }
}

/** Drive a pad Start-press join, then attach a fake player as the overlay would. */
function joinPlayer(mgr: CoopManager, host: FakeHost, padIndex: number): FakePlayer {
  host.padList = [pad(padIndex, { buttons: { [GP.START]: true } })];
  mgr.frame(16); // rising edge -> join request -> beginJoin
  const last = host.joins[host.joins.length - 1];
  expect(last?.padIndex).toBe(padIndex);
  const player = new FakePlayer();
  mgr.attachPlayer(last.slot as 2 | 3 | 4, player);
  host.padList = [pad(padIndex)]; // release Start
  return player;
}

describe('CoopManager join lifecycle', () => {
  it('reserves a slot on a join request and activates on attach', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    expect(mgr.hasCoopPlayers).toBe(false);
    joinPlayer(mgr, host, 1);
    expect(mgr.hasCoopPlayers).toBe(true);
    expect(mgr.localPlayerCount).toBe(2);
  });

  it('forwards a joining pad button edge to the overlay, not to a player', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    // Start the join but do NOT attach yet.
    host.padList = [pad(1, { buttons: { [GP.START]: true } })];
    mgr.frame(16);
    host.padList = [pad(1)];
    mgr.frame(16); // settle
    host.padList = [pad(1, { buttons: { [GP.DPAD_RIGHT]: true } })];
    mgr.frame(16);
    expect(host.overlayInputs.some((o) => o.edges.includes(GP.DPAD_RIGHT))).toBe(true);
  });

  it('aborts a join when the pad disconnects mid-overlay', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    host.padList = [pad(1, { buttons: { [GP.START]: true } })];
    mgr.frame(16);
    host.padList = []; // pad gone
    mgr.frame(16);
    expect(host.aborted.length).toBe(1);
    // The slot is free again for a new controller.
    expect(mgr.hasCoopPlayers).toBe(false);
  });

  it('removeAll tears down every co-op player', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    const p1 = joinPlayer(mgr, host, 1);
    const p2 = joinPlayer(mgr, host, 2);
    mgr.removeAll();
    expect(p1.removed).toBe(true);
    expect(p2.removed).toBe(true);
    expect(mgr.hasCoopPlayers).toBe(false);
  });
});

describe('CoopManager per-frame input', () => {
  it('turns stick direction into a camera-relative world facing', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    const p = joinPlayer(mgr, host, 1);
    host.yaw = Math.PI / 2;
    // Stick straight up (moveAngle 0): world facing == camYaw.
    host.padList = [pad(1, { axes: [0, -1, 0, 0] })];
    mgr.frame(16);
    expect(p.lastFacing).toBeCloseTo(Math.PI / 2, 6);
  });

  it('routes face-button edges to the right player actions', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    const p = joinPlayer(mgr, host, 1);
    host.padList = [pad(1)];
    mgr.frame(16); // settle edges
    host.padList = [pad(1, { buttons: { [GP.X]: true, [GP.Y]: true, [GP.B]: true } })];
    mgr.frame(16);
    expect(p.casts).toContain(0); // X -> slot0 (Attack)
    expect(p.targets).toBe(1); // Y -> target
    expect(p.interacts).toBe(1); // B -> interact
  });

  it('Back/View pauses the shared game instead of a per-player command', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    const p = joinPlayer(mgr, host, 1);
    host.padList = [pad(1)];
    mgr.frame(16); // settle edges
    host.padList = [pad(1, { buttons: { [GP.BACK]: true } })];
    mgr.frame(16);
    expect(host.pauses).toBe(1);
    // Pause is not routed as a player action.
    expect(p.casts).toEqual([]);
    expect(p.interacts).toBe(0);
  });

  it('the leash blocks outward movement past the radius but not inward', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    const p = joinPlayer(mgr, host, 1);
    host.primary = { x: 0, y: 0, z: 0 };
    host.yaw = 0;
    // Place P2 far enough out that even the P1/P2 midpoint centroid leaves P2
    // beyond the leash radius (its offset from the centroid must exceed the
    // leash). Push further out (+z, stick up = angle 0).
    p.pos = { x: 0, y: 0, z: COOP_LEASH_YD * 3 };
    host.padList = [pad(1, { axes: [0, -1, 0, 0] })];
    mgr.frame(16);
    expect(p.lastFacing).toBeNull(); // vetoed
    // Now push back inward (-z, stick down): allowed. Facing is +/-PI (same
    // heading), so compare via the direction vector rather than the raw angle.
    host.padList = [pad(1, { axes: [0, 1, 0, 0] })];
    mgr.frame(16);
    expect(p.lastFacing).not.toBeNull();
    expect(Math.sin(p.lastFacing!)).toBeCloseTo(0, 6);
    expect(Math.cos(p.lastFacing!)).toBeCloseTo(-1, 6);
  });
});

describe('CoopManager death handling', () => {
  it('drives release, resurrect, and regroup through the respawn timer', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    const p = joinPlayer(mgr, host, 1);
    host.padList = [pad(1)];
    p.dead = true;
    // Run the countdown to the release.
    for (let ms = 0; ms < 9000; ms += 500) mgr.frame(500);
    expect(p.released).toBe(1);
    // Become a ghost -> the manager asks for the spirit-healer resurrect.
    p.ghost = true;
    mgr.frame(16);
    expect(p.resurrects).toBeGreaterThanOrEqual(1);
    // Revive -> one regroup.
    p.dead = false;
    p.ghost = false;
    mgr.frame(16);
    expect(p.regroups).toBe(1);
  });
});

describe('CoopManager camera framing', () => {
  it('returns null with only Player 1, a pose once a co-op player joins', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    expect(mgr.frame(16)).toBeNull();
    const p = joinPlayer(mgr, host, 1);
    p.pos = { x: 30, y: 0, z: 0 };
    host.padList = [pad(1)];
    const frame = mgr.frame(16);
    expect(frame).not.toBeNull();
    expect(frame?.anchor.x).toBeCloseTo(15, 6); // between P1 (0) and P2 (30)
  });

  it('holding Start past the threshold makes the player leave', () => {
    const host = new FakeHost();
    const mgr = new CoopManager(host);
    const p = joinPlayer(mgr, host, 1);
    host.padList = [pad(1, { buttons: { [GP.START]: true } })];
    mgr.frame(COOP_LEAVE_HOLD_MS);
    expect(p.removed).toBe(true);
    expect(mgr.hasCoopPlayers).toBe(false);
  });
});

describe('routeAction', () => {
  it('maps slotN, target, and interact; ignores unknowns', () => {
    const p = new FakePlayer();
    routeAction(p, 'slot3');
    routeAction(p, 'target');
    routeAction(p, 'interact');
    routeAction(p, 'nonsense');
    expect(p.casts).toEqual([3]);
    expect(p.targets).toBe(1);
    expect(p.interacts).toBe(1);
  });
});
