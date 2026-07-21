import { describe, expect, it } from 'vitest';
import {
  getTouchOwner,
  isCameraDragAllowedAt,
  isInteractiveHudElement,
  TouchOwnerLedger,
  type TouchRouterContext,
  type TouchRouterTarget,
} from '../src/game/touch_router';

/** Minimal fake element mirroring the `closest()` contract this module needs,
 *  same style as `tests/mobile_controls.test.ts`'s FakeElement (never jsdom). */
class FakeTarget implements TouchRouterTarget {
  constructor(private selectors: string[] = []) {}

  closest(selector: string): TouchRouterTarget | null {
    return this.selectors.includes(selector) ? this : null;
  }

  matches(selector: string): boolean {
    return this.selectors.includes(selector);
  }
}

const canvas = new FakeTarget();
const moveZoneTarget = new FakeTarget();
const combatButton = new FakeTarget(['.mobile-btn']);
const actionBtn = new FakeTarget(['.action-btn']);
const ringSlot = new FakeTarget(['.mobile-action-slot', '#mobile-action-ring']);
const ringContainer = new FakeTarget(['#mobile-action-ring']);
const windowChrome = new FakeTarget(['.window']);
const panelChrome = new FakeTarget(['.panel']);
const minimapChrome = new FakeTarget(['#minimap-wrap']);
const dailyChestChrome = new FakeTarget(['#side-buttons']);
const chatlogChrome = new FakeTarget(['#chatlog-wrap']);
const plainCanvasChild = new FakeTarget();

function baseCtx(overrides: Partial<TouchRouterContext> = {}): TouchRouterContext {
  return {
    menuOpen: false,
    isMovementZone: (t) => t === moveZoneTarget,
    isCombatButton: (t) => isInteractiveHudElement(t),
    isCameraSurface: (t) => t === canvas || t === plainCanvasChild,
    ...overrides,
  };
}

describe('isInteractiveHudElement', () => {
  it('matches known interactive HUD chrome selectors', () => {
    expect(isInteractiveHudElement(combatButton)).toBe(true);
    expect(isInteractiveHudElement(actionBtn)).toBe(true);
    expect(isInteractiveHudElement(ringSlot)).toBe(true);
    expect(isInteractiveHudElement(ringContainer)).toBe(true);
    expect(isInteractiveHudElement(windowChrome)).toBe(true);
    expect(isInteractiveHudElement(panelChrome)).toBe(true);
  });

  it('matches the minimap, daily-chest, and chat-log widgets (Phase 5: none of these are .window/.panel/.mobile-btn, so a swipe starting on them must not fall through to a camera drag)', () => {
    expect(isInteractiveHudElement(minimapChrome)).toBe(true);
    expect(isInteractiveHudElement(dailyChestChrome)).toBe(true);
    expect(isInteractiveHudElement(chatlogChrome)).toBe(true);
  });

  it('returns false for a plain non-interactive target', () => {
    expect(isInteractiveHudElement(plainCanvasChild)).toBe(false);
    expect(isInteractiveHudElement(canvas)).toBe(false);
  });

  it('returns false for a null target', () => {
    expect(isInteractiveHudElement(null)).toBe(false);
  });
});

describe('isCameraDragAllowedAt', () => {
  it('allows a drag on open gameplay space with no menu open', () => {
    expect(isCameraDragAllowedAt(canvas, false)).toBe(true);
  });

  it('blocks a drag over interactive HUD chrome', () => {
    expect(isCameraDragAllowedAt(combatButton, false)).toBe(false);
    expect(isCameraDragAllowedAt(ringSlot, false)).toBe(false);
    expect(isCameraDragAllowedAt(windowChrome, false)).toBe(false);
  });

  it('blocks a drag whenever a menu/window is open, even on open canvas', () => {
    expect(isCameraDragAllowedAt(canvas, true)).toBe(false);
  });
});

describe('getTouchOwner: ownership per start zone', () => {
  it('classifies a movement-zone start as movement', () => {
    expect(getTouchOwner({ target: moveZoneTarget }, baseCtx())).toBe('movement');
  });

  it('classifies a combat/ring button start as combatButton', () => {
    expect(getTouchOwner({ target: combatButton }, baseCtx())).toBe('combatButton');
    expect(getTouchOwner({ target: ringSlot }, baseCtx())).toBe('combatButton');
  });

  it('classifies a window/panel start as menu when menuOpen is true', () => {
    expect(getTouchOwner({ target: windowChrome }, baseCtx({ menuOpen: true }))).toBe('menu');
  });

  it('classifies an open-canvas start as camera', () => {
    expect(getTouchOwner({ target: canvas }, baseCtx())).toBe('camera');
  });

  it('classifies an unmatched target as ignored', () => {
    const bystander = new FakeTarget();
    const ctx = baseCtx({ isCameraSurface: () => false });
    expect(getTouchOwner({ target: bystander }, ctx)).toBe('ignored');
  });
});

describe('getTouchOwner: priority order', () => {
  it('menuOpen wins over every other classification', () => {
    // moveZoneTarget would otherwise resolve to movement; menuOpen must override it.
    expect(getTouchOwner({ target: moveZoneTarget }, baseCtx({ menuOpen: true }))).toBe('menu');
    expect(getTouchOwner({ target: combatButton }, baseCtx({ menuOpen: true }))).toBe('menu');
    expect(getTouchOwner({ target: canvas }, baseCtx({ menuOpen: true }))).toBe('menu');
  });

  it('movement zone wins over combat button when a target nominally overlaps both', () => {
    const overlap = new FakeTarget(['.mobile-btn']);
    const ctx = baseCtx({ isMovementZone: (t) => t === overlap });
    expect(getTouchOwner({ target: overlap }, ctx)).toBe('movement');
  });

  it('combat button wins over camera when a target nominally overlaps both', () => {
    const overlap = new FakeTarget(['.action-btn']);
    const ctx = baseCtx({ isCameraSurface: (t) => t === overlap });
    expect(getTouchOwner({ target: overlap }, ctx)).toBe('combatButton');
  });
});

describe('camera blocked over interactive elements and when menuOpen', () => {
  it('never resolves camera for a target classified as interactive HUD chrome', () => {
    const ctx = baseCtx({ isCameraSurface: (t) => t === ringSlot });
    // isCameraSurface says yes, but isCombatButton takes priority first.
    expect(getTouchOwner({ target: ringSlot }, ctx)).toBe('combatButton');
  });

  it('never resolves camera while a menu is open even if isCameraSurface says yes', () => {
    expect(getTouchOwner({ target: canvas }, baseCtx({ menuOpen: true }))).toBe('menu');
  });
});

describe('TouchOwnerLedger lifecycle', () => {
  it('down -> move keeps the recorded owner', () => {
    const ledger = new TouchOwnerLedger();
    ledger.set(1, 'camera');
    expect(ledger.get(1)).toBe('camera');
    expect(ledger.isOwnedBy(1, 'camera')).toBe(true);
    // simulate a pointermove read: owner is unchanged without another set()
    expect(ledger.get(1)).toBe('camera');
  });

  it('up releases the pointer', () => {
    const ledger = new TouchOwnerLedger();
    ledger.set(2, 'movement');
    ledger.release(2);
    expect(ledger.get(2)).toBeUndefined();
  });

  it('cancel releases the pointer', () => {
    const ledger = new TouchOwnerLedger();
    ledger.set(3, 'combatButton');
    ledger.release(3);
    expect(ledger.get(3)).toBeUndefined();
  });

  it('a button-start touch never becomes camera: drifting over the canvas does not change the ledger', () => {
    const ledger = new TouchOwnerLedger();
    const ctx = baseCtx();
    const owner = getTouchOwner({ target: combatButton }, ctx);
    ledger.set(4, owner);
    // the finger drifts onto the canvas mid-drag; re-classifying the CURRENT
    // target is irrelevant because the consumer must consult the ledger, not
    // re-run getTouchOwner, once a pointer is down.
    expect(ledger.get(4)).toBe('combatButton');
    expect(ledger.isOwnedBy(4, 'camera')).toBe(false);
    ledger.release(4);
    expect(ledger.get(4)).toBeUndefined();
  });

  it('tracks independent pointers concurrently and reports size', () => {
    const ledger = new TouchOwnerLedger();
    ledger.set(1, 'movement');
    ledger.set(2, 'camera');
    expect(ledger.size).toBe(2);
    ledger.release(1);
    expect(ledger.size).toBe(1);
    expect(ledger.get(2)).toBe('camera');
    ledger.releaseAll();
    expect(ledger.size).toBe(0);
  });
});
