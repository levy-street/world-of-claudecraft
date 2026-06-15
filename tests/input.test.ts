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
    onTargetFriendly: vi.fn(),
    onCycleFriendly: vi.fn(),
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
