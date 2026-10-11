import { beforeEach, describe, expect, it, vi } from 'vitest';

const crestCanvas = {} as HTMLCanvasElement;
// Additive, never bare (the reliquary_window_behavior lesson): only iconCanvas
// stays stubbed; the module's other exports pass through.
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconCanvas: vi.fn(() => crestCanvas),
}));
vi.mock('../src/render/characters/portrait', () => ({
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
  modularPortraitDataUrl: vi.fn(),
  cachedPortraitDataUrl: vi.fn(),
}));

import type { ModularLook } from '../src/render/characters/modular';
import {
  cachedPortraitDataUrl,
  modularPortraitDataUrl,
  playerPortraitDataUrl,
  visualPortraitDataUrl,
} from '../src/render/characters/portrait';
import { UnitPortraitPainter } from '../src/ui/unit_portrait_painter';

const LOOK = { app: {}, worn: {} } as unknown as ModularLook;

type ImageListener = () => void;

class FakeImage {
  static instances: FakeImage[] = [];
  complete = false;
  naturalWidth = 0;
  private listeners = new Map<string, ImageListener>();

  constructor() {
    FakeImage.instances.push(this);
  }

  addEventListener(type: string, listener: ImageListener): void {
    this.listeners.set(type, listener);
  }

  set src(_url: string) {}

  dispatch(type: 'load' | 'error'): void {
    this.listeners.get(type)?.();
  }
}

function fakeCanvas() {
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  };
  const canvas = {
    dataset: {},
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

describe('UnitPortraitPainter', () => {
  beforeEach(() => {
    FakeImage.instances = [];
    vi.stubGlobal('Image', FakeImage);
  });

  it('invokes the current portrait fallback when a headshot fails to load', () => {
    const { canvas, context } = fakeCanvas();
    const fallback = vi.fn(() => painter.drawCrest(canvas, 'undead'));
    const painter = new UnitPortraitPainter(() => 1);

    painter.drawHeadshot(canvas, '/missing.webp', fallback);
    FakeImage.instances[0].dispatch('error');

    expect(fallback).toHaveBeenCalledOnce();
    expect(canvas.dataset.portrait).toBe('');
    expect(context.drawImage).toHaveBeenCalledWith(
      crestCanvas,
      -4.859999999999999,
      -4.859999999999999,
      63.72,
      63.72,
    );
  });

  it('ignores a late error after the canvas has been assigned another portrait', () => {
    const { canvas } = fakeCanvas();
    const fallback = vi.fn();
    const painter = new UnitPortraitPainter(() => 1);

    painter.drawHeadshot(canvas, '/old.webp', fallback);
    painter.drawHeadshot(canvas, '/new.webp');
    FakeImage.instances[0].dispatch('error');

    expect(fallback).not.toHaveBeenCalled();
    expect(canvas.dataset.portrait).toBe('/new.webp');
  });

  it('draws a successfully decoded headshot into the current canvas', () => {
    const { canvas, context } = fakeCanvas();
    const painter = new UnitPortraitPainter(() => 1);

    painter.drawHeadshot(canvas, '/mob.webp');
    FakeImage.instances[0].complete = true;
    FakeImage.instances[0].naturalWidth = 128;
    FakeImage.instances[0].dispatch('load');

    expect(context.drawImage).toHaveBeenCalledWith(FakeImage.instances[0], 0, 0, 54, 54);
  });

  it('shows a synchronous crest fallback until its painted replacement decodes', () => {
    const { canvas, context } = fakeCanvas();
    const painter = new UnitPortraitPainter(() => 1);

    painter.drawCrest(canvas, 'status_npc');

    expect(context.drawImage).toHaveBeenCalledWith(
      crestCanvas,
      -4.859999999999999,
      -4.859999999999999,
      63.72,
      63.72,
    );
    expect(canvas.dataset.portrait).toBe('/ui/crests/status/npc.webp');
    expect(FakeImage.instances).toHaveLength(1);

    FakeImage.instances[0].complete = true;
    FakeImage.instances[0].naturalWidth = 256;
    FakeImage.instances[0].dispatch('load');

    expect(context.drawImage).toHaveBeenLastCalledWith(
      FakeImage.instances[0],
      -4.859999999999999,
      -4.859999999999999,
      63.72,
      63.72,
    );
  });

  it('ignores a painted crest that decodes after the framed unit changes', () => {
    const { canvas, context } = fakeCanvas();
    const painter = new UnitPortraitPainter(() => 1);

    painter.drawCrest(canvas, 'status_npc');
    const staleImage = FakeImage.instances[0];
    painter.drawCrest(canvas, 'family_humanoid');
    const currentImage = FakeImage.instances[1];
    const drawCountBeforeDecode = context.drawImage.mock.calls.length;

    staleImage.complete = true;
    staleImage.naturalWidth = 256;
    staleImage.dispatch('load');

    expect(context.drawImage).toHaveBeenCalledTimes(drawCountBeforeDecode);
    expect(canvas.dataset.portrait).toBe('/ui/crests/families/humanoid.webp');

    currentImage.complete = true;
    currentImage.naturalWidth = 256;
    currentImage.dispatch('load');

    expect(context.drawImage).toHaveBeenLastCalledWith(
      currentImage,
      -4.859999999999999,
      -4.859999999999999,
      63.72,
      63.72,
    );
  });

  it('reuses a decoded painted crest without losing crest overscan', () => {
    const { canvas, context } = fakeCanvas();
    const painter = new UnitPortraitPainter(() => 1);

    painter.drawCrest(canvas, 'status_npc');
    const decodedImage = FakeImage.instances[0];
    decodedImage.complete = true;
    decodedImage.naturalWidth = 256;
    decodedImage.dispatch('load');
    context.drawImage.mockClear();

    painter.drawCrest(canvas, 'status_npc');

    expect(FakeImage.instances).toHaveLength(1);
    expect(context.drawImage.mock.calls).toEqual([
      [crestCanvas, -4.859999999999999, -4.859999999999999, 63.72, 63.72],
      [decodedImage, -4.859999999999999, -4.859999999999999, 63.72, 63.72],
    ]);
  });

  it('bounds decoded headshot retention with least-recently-used eviction', () => {
    const { canvas } = fakeCanvas();
    const painter = new UnitPortraitPainter(() => 1);

    for (let index = 0; index < 33; index++) {
      painter.drawHeadshot(canvas, `/mob-${index}.webp`);
    }
    painter.drawHeadshot(canvas, '/mob-0.webp');

    expect(FakeImage.instances).toHaveLength(34);
  });

  describe('a composed subject', () => {
    beforeEach(() => {
      for (const fn of [
        playerPortraitDataUrl,
        visualPortraitDataUrl,
        modularPortraitDataUrl,
        cachedPortraitDataUrl,
      ]) {
        vi.mocked(fn).mockReset();
      }
    });

    it('never kicks a class capture while its own runs: peeks the stock face, else the crest', () => {
      const { canvas, context } = fakeCanvas();
      const painter = new UnitPortraitPainter(() => 1);
      vi.mocked(modularPortraitDataUrl).mockReturnValue(null);
      vi.mocked(cachedPortraitDataUrl).mockReturnValue(null);

      painter.drawModularPlayer(canvas, 'player_warrior_modular', LOOK, 'warrior', 2);

      // The live class getter would start a second offscreen capture of a face
      // the composed capture replaces; the peek asks the cache only.
      expect(playerPortraitDataUrl).not.toHaveBeenCalled();
      expect(cachedPortraitDataUrl).toHaveBeenCalledWith('player_warrior', 2);
      expect(context.drawImage.mock.calls[0][0]).toBe(crestCanvas);

      vi.mocked(cachedPortraitDataUrl).mockReturnValue('/stock.png');
      painter.drawModularPlayer(canvas, 'player_warrior_modular', LOOK, 'warrior', 2);
      expect(canvas.dataset.portrait).toBe('/stock.png');

      vi.mocked(modularPortraitDataUrl).mockReturnValue('/composed.png');
      painter.drawModularPlayer(canvas, 'player_warrior_modular', LOOK, 'warrior', 2);
      expect(canvas.dataset.portrait).toBe('/composed.png');
      expect(playerPortraitDataUrl).not.toHaveBeenCalled();
    });

    it('routes each subject kind of drawPlayer to its body', () => {
      const { canvas } = fakeCanvas();
      const painter = new UnitPortraitPainter(() => 1);
      vi.mocked(visualPortraitDataUrl).mockReturnValue('/mech.png');
      vi.mocked(modularPortraitDataUrl).mockReturnValue('/composed.png');
      vi.mocked(playerPortraitDataUrl).mockReturnValue('/class.png');

      painter.drawPlayer(canvas, { kind: 'mech', cls: 'warrior', chroma: 3 });
      expect(visualPortraitDataUrl).toHaveBeenCalledWith('player_mech', 3);
      expect(canvas.dataset.portrait).toBe('/mech.png');

      painter.drawPlayer(canvas, {
        kind: 'composed',
        cls: 'warrior',
        skin: 2,
        visualKey: 'player_warrior_modular',
        look: LOOK,
      });
      expect(modularPortraitDataUrl).toHaveBeenCalledWith('player_warrior_modular', LOOK);
      expect(canvas.dataset.portrait).toBe('/composed.png');

      painter.drawPlayer(canvas, { kind: 'class', cls: 'mage', skin: 1 });
      expect(playerPortraitDataUrl).toHaveBeenCalledWith('mage', 1);
      expect(canvas.dataset.portrait).toBe('/class.png');
    });
  });
});
