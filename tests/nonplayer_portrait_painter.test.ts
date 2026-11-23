import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const crestCanvas = {} as HTMLCanvasElement;
// Additive, never bare: only iconCanvas is stubbed.
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

import type { NpcPortraitSource } from '../src/render/characters/manifest';
import { cachedPortraitDataUrl, visualPortraitDataUrl } from '../src/render/characters/portrait';
import type { NonPlayerPortraitSubject } from '../src/ui/nonplayer_portrait_core';
import { UnitPortraitPainter } from '../src/ui/unit_portrait_painter';

type Head = NpcPortraitSource['head'];
const HEAD = { gender: 'male', headHair: 'quiff' } as unknown as Head;
const FACE: NonPlayerPortraitSubject<Head> = {
  kind: 'face',
  crestId: 'status_npc',
  visualKey: 'player_warrior',
  head: HEAD,
};

class FakeImage {
  static instances: FakeImage[] = [];
  complete = false;
  naturalWidth = 0;
  private listeners = new Map<string, () => void>();
  constructor() {
    FakeImage.instances.push(this);
  }
  addEventListener(type: string, listener: () => void): void {
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

describe('UnitPortraitPainter.drawNonPlayer', () => {
  beforeEach(() => {
    FakeImage.instances = [];
    vi.stubGlobal('Image', FakeImage);
    vi.mocked(visualPortraitDataUrl).mockReset();
    vi.mocked(cachedPortraitDataUrl).mockReset();
  });

  it("draws a face as the live headshot of the character's own head on its body", () => {
    const { canvas } = fakeCanvas();
    vi.mocked(visualPortraitDataUrl).mockReturnValue('data:image/png;base64,TAM');
    new UnitPortraitPainter(() => 1).drawNonPlayer(canvas, FACE);
    expect(visualPortraitDataUrl).toHaveBeenCalledWith('player_warrior', 0, 'headshot', HEAD);
    expect(canvas.dataset.portrait).toBe('data:image/png;base64,TAM');
  });

  it('holds the crest while the capture runs, never the default face of the body', () => {
    const { canvas, context } = fakeCanvas();
    vi.mocked(visualPortraitDataUrl).mockReturnValue(null);
    vi.mocked(cachedPortraitDataUrl).mockReturnValue('/default-face.png');
    new UnitPortraitPainter(() => 1).drawNonPlayer(canvas, FACE);
    expect(context.drawImage.mock.calls[0][0]).toBe(crestCanvas);
    expect(canvas.dataset.portrait).toBe('/ui/crests/status/npc.webp');
    // the peeked stock face is a player's interim, and somebody else's face here
    expect(cachedPortraitDataUrl).not.toHaveBeenCalled();
  });

  it('falls back to the crest when the headshot fails to decode', () => {
    const { canvas, context } = fakeCanvas();
    vi.mocked(visualPortraitDataUrl).mockReturnValue('data:image/png;base64,BROKEN');
    new UnitPortraitPainter(() => 1).drawNonPlayer(canvas, FACE);
    expect(context.drawImage).not.toHaveBeenCalled();
    FakeImage.instances[0].dispatch('error');
    expect(context.drawImage.mock.calls[0][0]).toBe(crestCanvas);
    expect(canvas.dataset.portrait).toBe('/ui/crests/status/npc.webp');
  });

  it('draws committed art without asking the capture lane, and a bare crest as a crest', () => {
    const { canvas, context } = fakeCanvas();
    const painter = new UnitPortraitPainter(() => 1);
    painter.drawNonPlayer(canvas, {
      kind: 'art',
      crestId: 'family_beast',
      url: '/ui/mobs/forest_wolf.webp',
    });
    expect(canvas.dataset.portrait).toBe('/ui/mobs/forest_wolf.webp');
    painter.drawNonPlayer(canvas, { kind: 'crest', crestId: 'family_beast' });
    expect(context.drawImage.mock.calls[0][0]).toBe(crestCanvas);
    expect(canvas.dataset.portrait).toBe('/ui/crests/families/beast.webp');
    expect(visualPortraitDataUrl).not.toHaveBeenCalled();
  });
});

// The Hud side is two call sites inside a coordinator no unit test can build
// without the whole HUD and a WebGL rig, so it is pinned by source, the way
// composed_portrait_refresh.test.ts pins the player half.
describe('the Hud frames a non-player through the rule and repaints a landed face', () => {
  const hud = codeWithoutLineComments(
    readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8'),
  );

  it('draws every non-player frame from the one rule', () => {
    const draw = hud.slice(hud.indexOf('private drawNonPlayerPortrait('));
    expect(draw.slice(0, draw.indexOf('\n  }'))).toContain(
      'this.portraits.drawNonPlayer(canvas, nonPlayerPortraitSubject(entity, npcPortraitSourceFor));',
    );
  });

  it('matches a landed capture against the framed non-player and invalidates both target frames', () => {
    const handler = hud.slice(hud.indexOf('onPortraitUpdate((visualKey, skin, key) => {'));
    const body = handler.slice(0, handler.indexOf('\n    });')).replace(/\s+/g, ' ');
    expect(body).toContain(
      ': nonPlayerPortraitUpdateFrames( nonPlayerPortraitSubject(subject, npcPortraitSourceFor), update, )',
    );
    expect(body).toContain('const update = { visualKey, skin, key };');
    expect(body).toContain(
      'if (framed(this.targetPortraitSubject)) this.targetFramePainter.invalidatePortrait();',
    );
    expect(body).toContain(
      'if (framed(this.totPortraitSubject)) this.totFramePainter.invalidatePortrait();',
    );
  });
});
