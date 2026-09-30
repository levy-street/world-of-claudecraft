// @vitest-environment happy-dom
// The Fire and Fly weapon sockets as the seat mounts them: keys 1 and 2 (the bar slots)
// and the sockets themselves reach the weapons, a socket press never leaks to the ground
// behind it, the keycaps follow the input in hand, and the row leaves with the run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession, VehicleSession } from '../src/sim/types';
import { TURRET_WEAPONS_ID } from '../src/ui/hud/vehicle/turret_weapon_bar_painter';
import { VehicleActionBarController } from '../src/ui/hud/vehicle/vehicle_action_bar_controller';
import { setLanguage } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { TurretSessionView } from '../src/world_api/vehicles';

vi.mock('../src/ui/icons', () => ({ iconDataUrl: (_kind: string, key: string) => `/${key}.webp` }));
vi.mock('../src/game/sfx', () => ({
  sfx: {
    preload: vi.fn(),
    playUi: vi.fn(),
    playAt: vi.fn(() => true),
    hasVariants: () => false,
  },
}));

// The seat HUD's aim marks on the page's one own-shot ledger: each test takes a seat of
// its own start tick, which the ledger reads as a new seat.
let START = 400;

beforeEach(() => {
  START += 1000;
  setLanguage('en');
  document.body.innerHTML = '<div id="ui"></div>';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.className = '';
});

function seat(phase: 'intro' | 'wave' | 'won' = 'wave'): TurretSession {
  const session: TurretSession = {
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(resolveTurretPlan(), { x: 0, z: 0 }, 5, START),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
    feedback: [],
    nextFeedbackSeq: 1,
  };
  session.defense.phase = phase;
  session.defense.rev++;
  return session;
}

function rig(peek = false) {
  const world = {
    vehicleSession: null as VehicleSession | null,
    turretSession: null as TurretSessionView | null,
    turretClock: null as number | null,
    enterVehicle: vi.fn(),
    useVehicleAction: vi.fn(),
    leaveVehicle: vi.fn(),
  };
  const tooltips = new Map<HTMLElement, () => string>();
  const bar = new VehicleActionBarController({
    world,
    writers: makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => {},
      () => {},
    ),
    keyLabel: (slot) => String(slot + 1),
    consumePeek: () => peek,
    cancelOnEnter: [],
    attachTooltip: (element, html) => tooltips.set(element, html),
    padKind: () => 'xbox',
  });
  const seatIn = (session: TurretSession) => {
    world.turretSession = turretSessionView(session);
    world.turretClock = START;
    bar.update();
  };
  return { world, bar, tooltips, seatIn };
}

const row = () => document.getElementById(TURRET_WEAPONS_ID)!;
const sockets = () => [...row().querySelectorAll<HTMLButtonElement>('.turret-weapon')];

it('mounts two sockets of the vehicle bar family, named, with keycaps and charges', () => {
  const { seatIn } = rig();
  expect(row().style.display).toBe('none');
  seatIn(seat());
  expect(row().style.display).toBe('');
  expect(row().getAttribute('role')).toBe('group');
  expect(row().getAttribute('aria-label')).toBe('Tower weapons');
  const [shock, frag] = sockets();
  expect([shock, frag].map((b) => b.classList.contains('ui-socket'))).toEqual([true, true]);
  expect([shock, frag].map((b) => b.type)).toEqual(['button', 'button']);
  expect(shock.getAttribute('aria-label')).toBe('Shockwave');
  expect(frag.getAttribute('aria-label')).toBe('Fragmentation Shell');
  expect(shock.querySelector('.keybind')!.textContent).toBe('1');
  expect(frag.querySelector('.keybind')!.textContent).toBe('2');
  expect(shock.querySelector('.item-count')!.textContent).toBe('2');
  expect(frag.querySelector('.item-count')!.textContent).toBe('3');
  expect(shock.querySelector('.item-count')!.classList.contains('charge-count')).toBe(true);
});

it('routes key 1 to the Shockwave and key 2 to arming, then the click fires the armed shell', () => {
  const { world, bar, seatIn } = rig();
  seatIn(seat());
  bar.chooseSlot(0);
  expect(world.useVehicleAction).toHaveBeenLastCalledWith('turret_shockwave', { x: 0, z: 0 });
  bar.chooseSlot(1);
  bar.update();
  expect(sockets()[1].classList.contains('aiming')).toBe(true);
  expect(sockets()[1].getAttribute('aria-pressed')).toBe('true');
  expect(bar.aim.cancel()).toBe(true);
  bar.update();
  expect(sockets()[1].classList.contains('aiming')).toBe(false);
  bar.chooseSlot(1);
  bar.aim.commitAt({ x: 20, z: 0 });
  expect(world.useVehicleAction).toHaveBeenLastCalledWith('turret_frag', { x: 20, z: 0 });
});

// The shot paths themselves fire only for a press ON the canvas (Input's mouseup and the
// touch canvas's pointerup), so what really keeps a socket tap off the ground is the socket
// taking the pointer, pinned in CSS by vehicle_seat_click_through; this pins the listeners.
it('fires from a socket press, and the press never reaches the ground behind it', () => {
  const { world, seatIn } = rig();
  seatIn(seat());
  const behind = vi.fn();
  document.addEventListener('pointerdown', behind);
  document.addEventListener('click', behind);
  sockets()[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
  sockets()[0].click();
  expect(world.useVehicleAction).toHaveBeenCalledWith('turret_shockwave', { x: 0, z: 0 });
  expect(behind).not.toHaveBeenCalled();
});

it('ignores a socket tap that only peeked at its tooltip, and keeps the peek open', () => {
  const { world, seatIn } = rig(true);
  seatIn(seat());
  sockets()[0].focus();
  sockets()[0].click();
  expect(world.useVehicleAction).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(sockets()[0]);
});

/** A pointer press: the click a tap or a mouse makes carries a non-zero detail. */
const tap = (button: HTMLElement) =>
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
/** Enter or Space on a focused button: the click it activates carries detail 0. */
const keyPress = (button: HTMLElement) =>
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

it('lets go of the focus a press gave the socket, so its tooltip never stays over the field', () => {
  const { world, seatIn } = rig();
  seatIn(seat());
  const lost = vi.fn();
  sockets()[1].addEventListener('focusout', lost);
  // A tap focuses the button before its click, and a focused socket shows its tooltip.
  sockets()[1].focus();
  tap(sockets()[1]);
  expect(document.activeElement).not.toBe(sockets()[1]);
  expect(lost).toHaveBeenCalledTimes(1);
  sockets()[0].focus();
  tap(sockets()[0]);
  expect(world.useVehicleAction).toHaveBeenCalledWith('turret_shockwave', { x: 0, z: 0 });
  expect(document.activeElement).not.toBe(sockets()[0]);
});

it('keeps the focus a keyboard press activates the socket from', () => {
  const { world, seatIn } = rig();
  seatIn(seat());
  sockets()[0].focus();
  keyPress(sockets()[0]);
  expect(world.useVehicleAction).toHaveBeenCalledWith('turret_shockwave', { x: 0, z: 0 });
  expect(document.activeElement).toBe(sockets()[0]);
});

it('reads both sockets as not ready in the intro', () => {
  const { seatIn } = rig();
  seatIn(seat('intro'));
  expect(sockets().map((b) => b.classList.contains('unusable'))).toEqual([true, true]);
});

it('shows the pad buttons that reach the weapons while the pad is in hand', () => {
  const { bar, seatIn } = rig();
  document.body.classList.add('pad-active');
  seatIn(seat());
  bar.update();
  expect(sockets().map((b) => b.querySelector('.keybind')!.textContent)).toEqual(['Y', 'LB']);
});

it('attaches each tooltip with the charges left as the player sees them', () => {
  const { bar, tooltips, seatIn } = rig();
  seatIn(seat());
  bar.chooseSlot(0);
  const html = tooltips.get(sockets()[0])!();
  expect(html).toContain('Shockwave');
  expect(html).toContain('Charges left: 1');
  expect(tooltips.get(sockets()[1])!()).toContain('Charges left: 3');
});

it('leaves with the run: hidden on the result card and off the seat', () => {
  const { world, bar, seatIn } = rig();
  seatIn(seat());
  seatIn(seat('won'));
  expect(row().style.display).toBe('none');
  world.turretSession = null;
  world.turretClock = null;
  bar.update();
  expect(row().style.display).toBe('none');
});

it('turret_weapon_bar_painter carries no literal colour or px value: tokens and classes only', () => {
  const code = readFileSync(
    join(process.cwd(), 'src/ui/hud/vehicle/turret_weapon_bar_painter.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  expect(code.match(/\b(?:rgba?|hsla?|oklch)\s*\(/g) ?? []).toEqual([]);
  expect(code.match(/\b\d+(?:\.\d+)?px\b/g) ?? []).toEqual([]);
});
