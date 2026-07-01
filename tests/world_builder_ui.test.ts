// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IWorld } from '../src/world_api';
import { mountWorldBuilder } from '../src/ui/world_builder';

function stubWorld(): IWorld {
  // Only the members the dock touches need to be real; the rest are unused.
  const player = { id: 1, pos: { x: 10, y: 0, z: 20 }, facing: 0 };
  return {
    player,
    placeProp: vi.fn(),
    moveProp: vi.fn(),
    removeProp: vi.fn(),
    setPropMeta: vi.fn(),
  } as unknown as IWorld;
}

describe('World Builder dock', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('renders built-in palette props and places one in front of the player', () => {
    const world = stubWorld();
    mountWorldBuilder(world, root, { nativeKeys: ['barrel', 'lamp'] });
    const props = root.querySelectorAll<HTMLButtonElement>('.wb-prop');
    const labels = [...props].map((b) => b.textContent);
    expect(labels).toContain('barrel');
    expect(labels).toContain('lamp');

    const barrel = [...props].find((b) => b.textContent === 'barrel')!;
    barrel.click();
    // Placed 2 units ahead of the player (facing 0 => +z).
    expect(world.placeProp).toHaveBeenCalledWith('barrel', 10, 22, 0, 1);
  });

  it('save is disabled until a prop is selected, then saves capped fields', () => {
    const world = stubWorld();
    const handle = mountWorldBuilder(world, root);
    const saveBtn = root.querySelector<HTMLButtonElement>('[data-wb-savemeta]')!;
    // No selection: button is disabled and clicking is a no-op.
    expect(saveBtn.disabled).toBe(true);
    saveBtn.click();
    expect(world.setPropMeta).not.toHaveBeenCalled();

    // Select a prop, then save caps dialogue/music/voice.
    handle.select(42);
    expect(saveBtn.disabled).toBe(false);
    root.querySelector<HTMLInputElement>('[data-wb-dialogue]')!.value = 'x'.repeat(300);
    root.querySelector<HTMLInputElement>('[data-wb-music]')!.value = '/props/town.mp3';
    saveBtn.click();
    expect(world.setPropMeta).toHaveBeenCalledWith(42, {
      dialogue: 'x'.repeat(240),
      music: '/props/town.mp3',
      voice: '',
    });
  });

  it('collapse toggle hides the body', () => {
    mountWorldBuilder(stubWorld(), root);
    const dock = root.querySelector('.wb-dock')!;
    expect(dock.classList.contains('wb-collapsed')).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-wb-collapse]')!.click();
    expect(dock.classList.contains('wb-collapsed')).toBe(true);
  });

  it('destroy() removes the dock from the DOM', () => {
    const handle = mountWorldBuilder(stubWorld(), root);
    expect(root.querySelector('.wb-dock')).toBeTruthy();
    handle.destroy();
    expect(root.querySelector('.wb-dock')).toBeNull();
  });
});
