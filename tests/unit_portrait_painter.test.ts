import { beforeEach, describe, expect, it, vi } from 'vitest';

const crestCanvas = {} as HTMLCanvasElement;
vi.mock('../src/ui/icons', () => ({ iconCanvas: vi.fn(() => crestCanvas) }));
vi.mock('../src/render/characters/portrait', () => ({
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

import { visualPortraitDataUrl } from '../src/render/characters/portrait';
import { CREST_OVERSCAN, overscanRect, PORTRAIT_CSS_SIZE } from '../src/ui/unit_portrait';
import { UnitPortraitPainter } from '../src/ui/unit_portrait_painter';

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
    vi.mocked(visualPortraitDataUrl).mockReset();
  });

  it('invokes the current portrait fallback when a headshot fails to load', () => {
    const { canvas, context } = fakeCanvas();
    const fallback = vi.fn(() => painter.drawCrest(canvas, 'undead'));
    const painter = new UnitPortraitPainter(() => 1);

    painter.drawHeadshot(canvas, '/missing.webp', fallback);
    FakeImage.instances[0].dispatch('error');

    expect(fallback).toHaveBeenCalledOnce();
    expect(canvas.dataset.portrait).toBe('');
    const rect = overscanRect(PORTRAIT_CSS_SIZE, CREST_OVERSCAN);
    expect(context.drawImage).toHaveBeenCalledWith(crestCanvas, rect.dx, rect.dy, rect.dw, rect.dh);
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

    expect(context.drawImage).toHaveBeenCalledWith(
      FakeImage.instances[0],
      0,
      0,
      PORTRAIT_CSS_SIZE,
      PORTRAIT_CSS_SIZE,
    );
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

  it('paints contextual form and mech visuals through the shared headshot path', () => {
    const { canvas } = fakeCanvas();
    const painter = new UnitPortraitPainter(() => 1);
    vi.mocked(visualPortraitDataUrl).mockReturnValue('/form-bear.png');

    painter.drawVisual(canvas, 'form_bear', 0, 'druid');

    expect(visualPortraitDataUrl).toHaveBeenCalledWith('form_bear', 0);
    expect(canvas.dataset.portrait).toBe('/form-bear.png');
  });
});
