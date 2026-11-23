// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBuddyMenu } from '../src/ui/hud/buddy_menu';
import type { InputDialogOpts } from '../src/ui/input_controller';
import type { IWorld } from '../src/world_api';

afterEach(() => {
  document.body.innerHTML = '';
});
describe('buddy rename menu', () => {
  it('opens a prefilled dialog and sends the originally selected buddy id', () => {
    document.body.innerHTML = '<div id="ctx-menu"></div>';
    let activate: (act: string) => void = () => {};
    let dialog: InputDialogOpts | undefined;
    const world = {
      playerId: 1,
      entities: new Map([[1, { buddyAutoloot: false }]]),
      renameBuddy: vi.fn(),
      setBuddyAutoloot: vi.fn(),
    };
    const host = {
      placePopupAt: vi.fn(),
      keepPopupOnScreen: vi.fn(),
      bindContextMenuActions: (fn: typeof activate) => {
        activate = fn;
      },
    };
    openBuddyMenu(host, world as unknown as IWorld, 27, 'Sir Oats', 10, 10, (opts) => {
      dialog = opts;
    });
    expect(document.querySelector('[data-act="rename"]')?.textContent).toBe('Rename Buddy');
    activate('rename');
    expect(dialog?.value).toBe('Sir Oats');
    expect(world.renameBuddy).not.toHaveBeenCalled();
    dialog?.onOk?.('New Oats');
    expect(world.renameBuddy).toHaveBeenCalledWith(27, 'New Oats');
    activate('autoloot');
    expect(world.setBuddyAutoloot).toHaveBeenCalledWith(true);
  });
});
