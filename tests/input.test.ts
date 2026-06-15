import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/game/input';
import { Keybinds } from '../src/game/keybinds';

function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

function makeInput() {
  const canvasListeners = new Map<string, (event: any) => void>();
  const windowListeners = new Map<string, (event: any) => void>();
  const documentListeners = new Map<string, (event: any) => void>();
  const requestPointerLock = vi.fn();
  const exitPointerLock = vi.fn();
  const canvas = {
    style: { cursor: '' },
    addEventListener: vi.fn((type: string, cb: (event: any) => void) => {
      canvasListeners.set(type, cb);
    }),
    requestPointerLock,
  };
  (globalThis as any).window = {
    addEventListener: vi.fn((type: string, cb: (event: any) => void) => {
      windowListeners.set(type, cb);
    }),
  };
  (globalThis as any).document = {
    activeElement: null,
    pointerLockElement: null,
    hidden: false,
    addEventListener: vi.fn((type: string, cb: (event: any) => void) => {
      documentListeners.set(type, cb);
    }),
    exitPointerLock,
  };
  const cb = {
    onTab: vi.fn(),
    onAbility: vi.fn(),
    onUiKey: vi.fn(),
    onClickPick: vi.fn(),
  };
  const input = new Input(canvas as any, cb, new Keybinds());
  return { canvas, canvasListeners, windowListeners, documentListeners, cb, input };
}

beforeEach(() => {
  installStorage();
});

describe('Input pointer lock', () => {
  it('does not request pointer lock for a plain right click', () => {
    const { canvas, canvasListeners } = makeInput();

    canvasListeners.get('mousedown')!({ button: 2 });

    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('requests pointer lock when mouse movement becomes a drag', () => {
    const { canvas, canvasListeners, windowListeners } = makeInput();

    canvasListeners.get('mousedown')!({ button: 2 });
    windowListeners.get('mousemove')!({ movementX: 4, movementY: 3 });

    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });
});

describe('Input movement is not cancelled by a camera drag', () => {
  // Discord regression: walking with W (or any held key) then right/left-drag to
  // look around and releasing the button stopped movement, because exiting
  // pointer lock cleared the held keyboard keys.
  function walkAndDrag(button: number, windowListeners: Map<string, (e: any) => void>, canvasListeners: Map<string, (e: any) => void>, documentListeners: Map<string, (e: any) => void>) {
    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false });        // hold forward
    canvasListeners.get('mousedown')!({ button });                           // press camera button
    windowListeners.get('mousemove')!({ movementX: 6, movementY: 2 });       // drag → pointer lock
    (globalThis as any).document.pointerLockElement = (globalThis as any).document; // lock engaged
    windowListeners.get('mouseup')!({ button });                             // release → exitPointerLock
    (globalThis as any).document.pointerLockElement = null;                  // lock ends
    documentListeners.get('pointerlockchange')!({});                         // browser fires change
  }

  it('keeps walking forward after a right-drag ends', () => {
    const { input, windowListeners, canvasListeners, documentListeners } = makeInput();
    walkAndDrag(2, windowListeners, canvasListeners, documentListeners);
    expect(input.readMoveInput().forward).toBe(true);
  });

  it('keeps walking forward after a left-drag ends', () => {
    const { input, windowListeners, canvasListeners, documentListeners } = makeInput();
    walkAndDrag(0, windowListeners, canvasListeners, documentListeners);
    expect(input.readMoveInput().forward).toBe(true);
  });

  it('still forgets held keys on focus loss so movement cannot stick', () => {
    const { input, windowListeners } = makeInput();
    windowListeners.get('keydown')!({ code: 'KeyW', repeat: false });
    windowListeners.get('blur')!({});
    expect(input.readMoveInput().forward).toBe(false);
  });
});
