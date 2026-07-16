// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusTrapHandle } from '../src/ui/focus_manager';
import { PlayerCardController } from '../src/ui/hud/player_card/player_card_controller';
import type { IWorld } from '../src/world_api';

const cardMocks = vi.hoisted(() => ({
  render: vi.fn(),
  toBlob: vi.fn(),
}));

vi.mock('../src/ui/hud/player_card/player_card', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/hud/player_card/player_card')>();
  return {
    ...actual,
    renderPlayerCardCanvas: cardMocks.render,
    cardCanvasToBlob: cardMocks.toBlob,
    cardCanvasToUploadBlob: cardMocks.toBlob,
  };
});

vi.mock('../src/ui/hud/player_card/player_card_share', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/ui/hud/player_card/player_card_share')>();
  return {
    ...actual,
    cardHostingAvailable: () => false,
    fetchReferralInfo: () => Promise.resolve(null),
    fetchStanding: () => Promise.resolve(null),
  };
});

vi.mock('../src/ui/wallet_balance', () => ({
  verifiedWocBalance: () => null,
  walletDisplayAvailable: () => false,
}));

function world(): IWorld {
  return {
    cfg: { playerClass: 'warrior' },
    player: {
      name: 'Card Tester',
      color: 0x123456,
      level: 20,
      stats: { str: 12, agi: 9, sta: 14, int: 5, spi: 6, armor: 80 },
      attackPower: 42,
      critChance: 0.125,
      dodgeChance: 0.075,
      devTier: 0,
      devMergedPrs: 0,
    },
    equipment: { mainhand: null, chest: null, legs: null, feet: null },
    arenaInfo: null,
    prestigeRank: 0,
    activeTitle: null,
    realm: 'Test Realm',
  } as unknown as IWorld;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  const ensurePreview = vi.fn();
  const captureCloseup = vi.fn(() => 'data:image/png;base64,preview');
  const focusFirst = vi.fn();
  const release = vi.fn();
  const trap: FocusTrapHandle = { focusFirst, release };
  const options = {
    refreshBalance: vi.fn(),
    showWallet: vi.fn(() => true),
    setShowWallet: vi.fn(),
    showDevBadges: vi.fn(() => false),
  };
  const controller = new PlayerCardController({
    document,
    world,
    ensurePreview,
    preview: () => ({ captureCloseup }),
    openFocusTrap: () => trap,
    options,
    slotName: (slot) => String(slot),
    click: vi.fn(),
  });
  return { controller, ensurePreview, captureCloseup, focusFirst, release, options };
}

describe('PlayerCardController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    cardMocks.render.mockReset();
    cardMocks.toBlob.mockReset();
    cardMocks.render.mockImplementation(async () => document.createElement('canvas'));
    cardMocks.toBlob.mockResolvedValue(new Blob(['card'], { type: 'image/png' }));
  });

  it('owns modal focus and keeps only the newest asynchronous composition', async () => {
    const test = harness();
    await test.controller.open();

    expect(test.controller.isOpen).toBe(true);
    expect(test.ensurePreview).toHaveBeenCalledTimes(1);
    expect(test.options.refreshBalance).toHaveBeenCalledTimes(1);
    expect(test.focusFirst).toHaveBeenCalledWith('[data-close]');
    expect(document.querySelector('.pc-preview canvas')).not.toBeNull();

    const older = deferred<HTMLCanvasElement>();
    const newer = deferred<HTMLCanvasElement>();
    const olderCanvas = document.createElement('canvas');
    const newerCanvas = document.createElement('canvas');
    cardMocks.render.mockImplementationOnce(() => older.promise);
    cardMocks.render.mockImplementationOnce(() => newer.promise);

    test.controller.refresh();
    test.controller.refresh();
    newer.resolve(newerCanvas);
    await vi.waitFor(() => expect(document.querySelector('.pc-preview canvas')).toBe(newerCanvas));
    older.resolve(olderCanvas);
    await Promise.resolve();
    expect(document.querySelector('.pc-preview canvas')).toBe(newerCanvas);

    test.controller.close();
    expect(test.controller.isOpen).toBe(false);
    expect(test.release).toHaveBeenCalledWith(true);
    expect(document.getElementById('player-card-modal')).toBeNull();
  });

  it('downloads the composed card from the action surface', async () => {
    const test = harness();
    const createObjectUrl = vi.fn(() => 'blob:player-card');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await test.controller.open();

    document.querySelector<HTMLButtonElement>('.pc-actions .btn')?.click();

    await vi.waitFor(() => expect(cardMocks.toBlob).toHaveBeenCalledTimes(1));
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.pc-status')?.textContent).not.toBe('');
    anchorClick.mockRestore();
  });
});
