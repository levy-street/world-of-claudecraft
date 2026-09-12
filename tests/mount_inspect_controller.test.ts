// @vitest-environment jsdom
//
// The mount-skin inspect panel's DOM lifecycle (src/ui/mount_inspect_controller.ts)
// against fake deps and a recorded fake preview handle: one overlay and one
// preview per open, every action crossing the seam exactly once, the mode and
// scene toggles reaching the stage, and close disposing the GL context (the
// one place this panel differs from the parked Armory panel) while handing
// focus back to the opener.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewAppearance } from '../src/render/characters/preview_appearance';
import { createMountPreview } from '../src/render/mount_preview';
import { MOUNT_SKIN_IDS } from '../src/sim/content/mount_skins';
import { MountInspect } from '../src/ui/mount_inspect_controller';
import { type MountInspectRow, mountInspectRow } from '../src/ui/mount_inspect_view';

const previews: FakePreview[] = [];

interface FakePreview {
  setActive: ReturnType<typeof vi.fn>;
  setAppearance: ReturnType<typeof vi.fn>;
  setMount: ReturnType<typeof vi.fn>;
  setMode: ReturnType<typeof vi.fn>;
  setScene: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

vi.mock('../src/render/mount_preview', () => ({
  createMountPreview: vi.fn(() => {
    const handle: FakePreview = {
      setActive: vi.fn(),
      setAppearance: vi.fn(),
      setMount: vi.fn(),
      setMode: vi.fn(),
      setScene: vi.fn(),
      dispose: vi.fn(),
    };
    previews.push(handle);
    return handle;
  }),
}));

const REINS = MOUNT_SKIN_IDS[0];
const OTHER = MOUNT_SKIN_IDS[1];

const APPEARANCE: PreviewAppearance = {
  cls: 'warrior',
  skin: 0,
  skinCatalog: 'class',
  mainhandItemId: 'worn_sword',
  offhandItemId: null,
  weaponSkinId: null,
};

interface State {
  owned: string[];
  worn: string | null;
  priced: boolean;
  ownsAnyMount: boolean;
}

function makeInspect(over: Partial<State> = {}) {
  const state: State = { owned: [], worn: null, priced: true, ownsAnyMount: true, ...over };
  const row = vi.fn((skinId: string): MountInspectRow | null =>
    mountInspectRow(
      skinId,
      state.priced ? { costClaudium: 1200, purchasable: true, owned: false } : null,
      {
        ownedMountSkinIds: state.owned,
        wornMountSkinId: state.worn,
        ownsAnyMount: state.ownsAnyMount,
      },
    ),
  );
  const deps = {
    appearance: vi.fn(() => APPEARANCE),
    row,
    requestBuy: vi.fn(),
    wear: vi.fn((skinId: string) => {
      state.worn = skinId;
    }),
    takeOff: vi.fn(() => {
      state.worn = null;
    }),
  };
  return { inspect: new MountInspect(deps), deps, state };
}

const overlays = () => document.querySelectorAll('.mount-inspect-overlay');
const overlay = () => document.querySelector<HTMLElement>('.mount-inspect-overlay');
const button = (selector: string) => overlay()?.querySelector<HTMLButtonElement>(selector) ?? null;

beforeEach(() => {
  document.body.innerHTML = '';
  previews.length = 0;
  vi.mocked(createMountPreview).mockClear();
});

describe('MountInspect', () => {
  it('opens one overlay, builds one preview staged on the skin, and focuses close', () => {
    const { inspect, deps } = makeInspect();
    inspect.open(REINS);
    expect(inspect.isOpen).toBe(true);
    expect(inspect.openSkinId).toBe(REINS);
    expect(overlays()).toHaveLength(1);
    expect(overlay()?.querySelector('[role="dialog"]')).toBeTruthy();
    expect(overlay()?.querySelector('[data-mount-canvas]')).toBeTruthy();
    expect(previews).toHaveLength(1);
    const preview = previews[0];
    expect(preview.setMount).toHaveBeenCalledTimes(1);
    expect(preview.setMount).toHaveBeenCalledWith(REINS);
    expect(preview.setAppearance).toHaveBeenCalledWith(APPEARANCE);
    expect(preview.setMode).toHaveBeenCalledWith('rider');
    expect(preview.setScene).toHaveBeenCalledWith('day');
    expect(preview.setActive).toHaveBeenLastCalledWith(true);
    expect(deps.appearance).toHaveBeenCalled();
    expect(document.activeElement).toBe(button('[data-mount-close]'));
  });

  it('does nothing for a skin the row projection does not carry', () => {
    const { inspect, deps } = makeInspect();
    inspect.open('not_a_skin');
    expect(deps.row).toHaveBeenCalledWith('not_a_skin');
    expect(inspect.isOpen).toBe(false);
    expect(overlays()).toHaveLength(0);
    expect(previews).toHaveLength(0);
  });

  it('routes Buy to requestBuy with the open skin id', () => {
    const { inspect, deps } = makeInspect();
    inspect.open(REINS);
    const buy = button('[data-mount-buy]');
    expect(buy).toBeTruthy();
    expect(buy?.disabled).toBe(false);
    buy?.click();
    expect(deps.requestBuy).toHaveBeenCalledTimes(1);
    expect(deps.requestBuy).toHaveBeenCalledWith(REINS);
    expect(deps.wear).not.toHaveBeenCalled();
  });

  it('routes Wear to wear, then re-reads the row so Take off replaces it', () => {
    const { inspect, deps } = makeInspect({ owned: [REINS] });
    inspect.open(REINS);
    expect(button('[data-mount-buy]')).toBeNull();
    const rowCalls = deps.row.mock.calls.length;
    button('[data-mount-wear]')?.click();
    expect(deps.wear).toHaveBeenCalledTimes(1);
    expect(deps.wear).toHaveBeenCalledWith(REINS);
    expect(deps.row.mock.calls.length).toBe(rowCalls + 1);
    expect(button('[data-mount-wear]')).toBeNull();
    expect(button('[data-mount-takeoff]')).toBeTruthy();
  });

  it('routes Take off to takeOff and repaints Wear', () => {
    const { inspect, deps } = makeInspect({ owned: [REINS], worn: REINS });
    inspect.open(REINS);
    button('[data-mount-takeoff]')?.click();
    expect(deps.takeOff).toHaveBeenCalledTimes(1);
    expect(button('[data-mount-takeoff]')).toBeNull();
    expect(button('[data-mount-wear]')).toBeTruthy();
  });

  it('switches the preview mode from the toggles and marks the pressed one', () => {
    const { inspect } = makeInspect();
    inspect.open(REINS);
    const rider = button('[data-mount-mode="rider"]');
    const mount = button('[data-mount-mode="mount"]');
    expect(rider?.getAttribute('aria-pressed')).toBe('true');
    expect(mount?.getAttribute('aria-pressed')).toBe('false');
    mount?.click();
    expect(previews[0].setMode).toHaveBeenLastCalledWith('mount');
    expect(mount?.getAttribute('aria-pressed')).toBe('true');
    expect(mount?.classList.contains('active')).toBe(true);
    expect(rider?.getAttribute('aria-pressed')).toBe('false');
    rider?.click();
    expect(previews[0].setMode).toHaveBeenLastCalledWith('rider');
    expect(rider?.getAttribute('aria-pressed')).toBe('true');
    expect(mount?.getAttribute('aria-pressed')).toBe('false');
  });

  it('switches the preview scene from the scene buttons', () => {
    const { inspect } = makeInspect();
    inspect.open(REINS);
    expect(button('[data-mount-scene="day"]')?.getAttribute('aria-pressed')).toBe('true');
    button('[data-mount-scene="night"]')?.click();
    expect(previews[0].setScene).toHaveBeenLastCalledWith('night');
    expect(button('[data-mount-scene="night"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('[data-mount-scene="day"]')?.getAttribute('aria-pressed')).toBe('false');
    button('[data-mount-scene="dusk"]')?.click();
    expect(previews[0].setScene).toHaveBeenLastCalledWith('dusk');
    expect(button('[data-mount-scene="dusk"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('closes on Escape', () => {
    const { inspect } = makeInspect();
    inspect.open(REINS);
    overlay()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(inspect.isOpen).toBe(false);
    expect(overlays()).toHaveLength(0);
    expect(previews[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('close removes the overlay, disposes the preview once, and restores the opener focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { inspect } = makeInspect();
    inspect.open(REINS);
    expect(document.activeElement).not.toBe(opener);
    inspect.close();
    expect(inspect.isOpen).toBe(false);
    expect(inspect.openSkinId).toBeNull();
    expect(overlays()).toHaveLength(0);
    expect(previews).toHaveLength(1);
    expect(previews[0].dispose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    // A second close is inert: nothing to dispose twice.
    inspect.close();
    expect(previews[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('re-targets an open panel on a second skin, keeping the stage and its context', () => {
    const { inspect } = makeInspect();
    inspect.open(REINS);
    inspect.open(OTHER);
    expect(overlays()).toHaveLength(1);
    expect(inspect.openSkinId).toBe(OTHER);
    // One construction across both opens: the stage is parked and re-slotted,
    // and only the staged mount swaps.
    expect(previews).toHaveLength(1);
    expect(vi.mocked(createMountPreview)).toHaveBeenCalledTimes(1);
    expect(previews[0].dispose).not.toHaveBeenCalled();
    expect(previews[0].setMount).toHaveBeenLastCalledWith(OTHER);
    expect(overlay()?.querySelectorAll('.armory-inspect-stage')).toHaveLength(1);
    inspect.close();
    expect(previews[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('still opens the codex side when no GL context can be made, with no stage', () => {
    vi.mocked(createMountPreview).mockReturnValueOnce(null);
    const { inspect } = makeInspect();
    inspect.open(REINS);
    expect(inspect.isOpen).toBe(true);
    expect(overlays()).toHaveLength(1);
    expect(overlay()?.querySelector('.armory-inspect-stage')).toBeNull();
    expect(overlay()?.querySelector('[data-mount-canvas]')).toBeNull();
    expect(button('[data-mount-buy]')).toBeTruthy();
    expect(previews).toHaveLength(0);
    inspect.close();
    expect(inspect.isOpen).toBe(false);
    expect(overlays()).toHaveLength(0);
  });

  it('keeps focus on close for a press inside the dialog, and closes on a backdrop press', () => {
    const { inspect } = makeInspect();
    inspect.open(REINS);
    const close = button('[data-mount-close]');
    const heading = overlay()?.querySelector<HTMLElement>('h2') as HTMLElement;
    heading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(inspect.isOpen).toBe(true);
    expect(document.activeElement).toBe(close);
    // A press on an action button keeps the default (the button takes focus).
    const buy = button('[data-mount-buy]') as HTMLButtonElement;
    const onButton = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    buy.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(false);
    expect(inspect.isOpen).toBe(true);
    overlay()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(inspect.isOpen).toBe(false);
    expect(overlays()).toHaveLength(0);
  });

  it('relocalize repaints the open dialog over the same stage, and is inert when closed', () => {
    const { inspect } = makeInspect();
    inspect.relocalize();
    expect(overlays()).toHaveLength(0);
    expect(previews).toHaveLength(0);
    inspect.open(REINS);
    button('[data-mount-mode="mount"]')?.click();
    const before = overlay();
    inspect.relocalize();
    expect(overlays()).toHaveLength(1);
    expect(overlay()).not.toBe(before);
    expect(inspect.openSkinId).toBe(REINS);
    expect(previews).toHaveLength(1);
    expect(vi.mocked(createMountPreview)).toHaveBeenCalledTimes(1);
    expect(previews[0].dispose).not.toHaveBeenCalled();
    expect(previews[0].setMount).toHaveBeenCalledTimes(2);
    expect(previews[0].setMount).toHaveBeenLastCalledWith(REINS);
    // The repainted toggles still reflect the live mode and drive the preview.
    expect(button('[data-mount-mode="mount"]')?.getAttribute('aria-pressed')).toBe('true');
    button('[data-mount-mode="rider"]')?.click();
    expect(previews[0].setMode).toHaveBeenLastCalledWith('rider');
    inspect.close();
    inspect.relocalize();
    expect(overlays()).toHaveLength(0);
    expect(previews[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('refresh repaints the actions when the row changes, and is inert when closed', () => {
    const { inspect, deps, state } = makeInspect();
    inspect.open(REINS);
    expect(button('[data-mount-buy]')).toBeTruthy();
    expect(button('[data-mount-wear]')).toBeNull();
    state.owned = [REINS];
    inspect.refresh();
    expect(button('[data-mount-buy]')).toBeNull();
    expect(button('[data-mount-wear]')).toBeTruthy();
    inspect.close();
    const rowCalls = deps.row.mock.calls.length;
    inspect.refresh();
    expect(deps.row.mock.calls.length).toBe(rowCalls);
    expect(overlays()).toHaveLength(0);
  });
});
