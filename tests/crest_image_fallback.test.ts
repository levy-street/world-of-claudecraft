import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const iconMocks = vi.hoisted(() => ({
  cached: vi.fn<(kind: string, id: string, size: number) => string | null>(() => null),
  painted: vi.fn((_kind: string, id: string) => `/ui/classes/${id}.webp`),
  procedural: vi.fn((_kind: string, id: string) => `data:image/png;base64,${id}`),
}));

vi.mock('../src/ui/icons', () => ({
  cachedProceduralIconDataUrl: iconMocks.cached,
  iconDataUrl: iconMocks.painted,
  proceduralIconDataUrl: iconMocks.procedural,
}));

import {
  clearCrestImageFallback,
  crestImageFallbackAttributes,
  hydrateCrestImageFallbacks,
  setCrestImageWithFallback,
} from '../src/ui/crest_image_fallback';

interface FakeImageHarness {
  image: HTMLImageElement;
  attrs: Map<string, string>;
  classes: Set<string>;
  errorListenerCount(): number;
  emitError(): void;
}

function fakeImage(): FakeImageHarness {
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const errors: (() => void)[] = [];
  const style = {
    backgroundImage: '',
    removeProperty(property: string) {
      if (property === 'background-image') this.backgroundImage = '';
    },
  };
  const image = {
    src: '',
    complete: false,
    naturalWidth: 0,
    style,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    getAttribute: (name: string) => attrs.get(name) ?? null,
    removeAttribute: (name: string) => attrs.delete(name),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'error') errors.push(listener);
    },
  } as unknown as HTMLImageElement;
  return {
    image,
    attrs,
    classes,
    errorListenerCount: () => errors.length,
    emitError: () => {
      for (const listener of errors) listener();
    },
  };
}

function fakeRoot(...images: HTMLImageElement[]): ParentNode {
  return {
    querySelectorAll: () => images,
  } as unknown as ParentNode;
}

describe('crest image fallback', () => {
  beforeEach(() => {
    iconMocks.cached.mockReset();
    iconMocks.cached.mockReturnValue(null);
    iconMocks.painted.mockClear();
    iconMocks.procedural.mockClear();
  });

  it('uses a warmed procedural background without synchronously composing one', () => {
    iconMocks.cached.mockReturnValue('data:image/png;base64,warmed');
    const { image, classes } = fakeImage();

    setCrestImageWithFallback(image, 'class_mage', 96);

    expect(image.style.backgroundImage).toContain('data:image/png;base64,warmed');
    expect(classes.has('crest-image-fallback')).toBe(true);
    expect(iconMocks.procedural).not.toHaveBeenCalled();
  });

  it('removes a stale warmed background when a reused image is re-armed cold', () => {
    iconMocks.cached.mockReturnValue('data:image/png;base64,warmed');
    const { image, classes } = fakeImage();
    setCrestImageWithFallback(image, 'class_mage', 96);
    expect(classes.has('crest-image-fallback')).toBe(true);

    iconMocks.cached.mockReturnValue(null);
    setCrestImageWithFallback(image, 'class_rogue', 96);

    expect(classes.has('crest-image-fallback')).toBe(false);
    expect(image.style.backgroundImage).toBe('');
    expect(iconMocks.procedural).not.toHaveBeenCalled();
  });

  it('swaps a failed static WebP to the current procedural crest on a reused image', () => {
    const { image, emitError } = fakeImage();
    setCrestImageWithFallback(image, 'class_mage', 96);
    setCrestImageWithFallback(image, 'class_rogue', 96);

    emitError();

    expect(iconMocks.procedural).toHaveBeenCalledTimes(1);
    expect(iconMocks.procedural).toHaveBeenCalledWith('crest', 'class_rogue', 96);
    expect(image.src).toBe('data:image/png;base64,class_rogue');
  });

  it('immediately replaces a complete broken marked image during hydration', () => {
    const { image } = fakeImage();
    image.setAttribute('data-crest-fallback-id', 'status_npc');
    image.setAttribute('data-crest-fallback-size', '48');
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 0 },
    });

    hydrateCrestImageFallbacks(fakeRoot(image));

    expect(iconMocks.procedural).toHaveBeenCalledTimes(1);
    expect(iconMocks.procedural).toHaveBeenCalledWith('crest', 'status_npc', 48);
    expect(image.src).toBe('data:image/png;base64,status_npc');
  });

  it('arms one error listener when the same subtree is hydrated repeatedly', () => {
    const { image, errorListenerCount, emitError } = fakeImage();
    image.setAttribute('data-crest-fallback-id', 'family_beast');
    image.setAttribute('data-crest-fallback-size', '64');
    const root = fakeRoot(image);

    hydrateCrestImageFallbacks(root);
    hydrateCrestImageFallbacks(root);
    emitError();

    expect(errorListenerCount()).toBe(1);
    expect(iconMocks.procedural).toHaveBeenCalledTimes(1);
    expect(iconMocks.procedural).toHaveBeenCalledWith('crest', 'family_beast', 64);
  });

  it('clears hydrated fallback state before a real portrait replaces the crest', () => {
    iconMocks.cached.mockReturnValue('data:image/png;base64,warmed');
    const { image, attrs, classes, emitError } = fakeImage();
    image.setAttribute('data-crest-fallback-id', 'class_druid');
    image.setAttribute('data-crest-fallback-size', '96');
    hydrateCrestImageFallbacks(fakeRoot(image));
    clearCrestImageFallback(image);
    image.src = 'data:image/png;base64,transparent-portrait';

    emitError();

    expect(attrs.has('data-crest-fallback-id')).toBe(false);
    expect(attrs.has('data-crest-fallback-size')).toBe(false);
    expect(classes.has('crest-image-fallback')).toBe(false);
    expect(image.style.backgroundImage).toBe('');
    expect(iconMocks.procedural).not.toHaveBeenCalled();
    expect(image.src).toBe('data:image/png;base64,transparent-portrait');
  });

  it('emits the trusted hydration attributes expected by mounted image consumers', () => {
    expect(crestImageFallbackAttributes('class_mage', 96)).toBe(
      'data-crest-fallback-id="class_mage" data-crest-fallback-size="96"',
    );
    expect(() => crestImageFallbackAttributes('../mage', 96)).toThrow('unsafe crest fallback id');
    expect(() => crestImageFallbackAttributes('class_mage', 0)).toThrow(
      'invalid crest fallback size',
    );
  });

  it('keeps Guide, HUD, Fiesta, and portrait-chip consumers wired to mounted fallbacks', () => {
    const guide = readFileSync(new URL('../src/guide/app.ts', import.meta.url), 'utf8');
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const fiesta = readFileSync(
      new URL('../src/ui/hud/fiesta/fiesta_controller.ts', import.meta.url),
      'utf8',
    );
    const portraitChip = readFileSync(
      new URL('../src/ui/portrait_chip.ts', import.meta.url),
      'utf8',
    );

    const guideHydration = guide.indexOf('hydrateCrestImageFallbacks(this.chrome.mainEl);');
    expect(guideHydration).toBeGreaterThan(guide.lastIndexOf('this.chrome.mainEl.innerHTML'));

    const hudClass = hud.slice(hud.indexOf('export class Hud'));
    expect(hudClass).toMatch(
      /constructor\([\s\S]*?\) \{\s*hydrateCrestImageFallbacks\(document\);/,
    );

    expect(fiesta).toContain('crestImageFallbackAttributes(crestId, 96)');
    const fiestaHydration = fiesta.indexOf('hydrateCrestImageFallbacks(element);');
    expect(fiestaHydration).toBeGreaterThan(fiesta.indexOf('element.innerHTML ='));

    expect(portraitChip).toContain('crestImageFallbackAttributes(crestId, 96)');
    const portraitHydration = portraitChip.indexOf('hydrateCrestImageFallbacks(root);');
    expect(portraitHydration).toBeGreaterThan(
      portraitChip.indexOf('export function hydratePortraits('),
    );
    expect(portraitHydration).toBeLessThan(portraitChip.indexOf('if (!portraitsReady()) return;'));
    expect(portraitChip).toContain('clearCrestImageFallback(img);');
  });
});
