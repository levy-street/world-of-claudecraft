// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { LoadingBackdropController } from '../src/ui/loading_backdrop';
import { LOADING_BACKDROP_PATHS } from '../src/ui/loading_backdrop_core';

describe('LoadingBackdropController', () => {
  it('preloads one image at a time and prepares the next cycle before the curtain returns', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="loading-screen"></div>';
    const imageConstructor = vi.fn();
    vi.stubGlobal('Image', imageConstructor);
    const curtain = document.querySelector<HTMLElement>('#loading-screen');
    if (!curtain) throw new Error('loading-screen fixture is missing');

    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.999_999);
    const controller = new LoadingBackdropController(curtain, (path) => `/media${path}`, random);

    controller.prepareInitial();
    const preload = document.head.querySelector<HTMLLinkElement>(
      'link[data-loading-backdrop-preload]',
    );
    expect(preload).not.toBeNull();
    expect(document.head.querySelectorAll('link[data-loading-backdrop-preload]')).toHaveLength(1);
    expect(document.head.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(1);
    expect(imageConstructor).not.toHaveBeenCalled();
    expect(preload?.getAttribute('rel')).toBe('preload');
    expect(preload?.getAttribute('as')).toBe('image');
    expect(preload?.getAttribute('type')).toBe('image/webp');
    expect(preload?.getAttribute('fetchpriority')).toBe('high');
    expect(preload?.getAttribute('href')).toBe(`/media${LOADING_BACKDROP_PATHS[0]}`);
    expect(curtain.style.getPropertyValue('--loading-backdrop-image')).toBe(
      `url("/media${LOADING_BACKDROP_PATHS[0]}")`,
    );

    controller.enterNewCycle();
    expect(random).toHaveBeenCalledTimes(1);
    expect(preload?.getAttribute('href')).toBe(`/media${LOADING_BACKDROP_PATHS[0]}`);

    controller.prepareNextCycle();
    expect(random).toHaveBeenCalledTimes(2);
    expect(preload?.getAttribute('fetchpriority')).toBe('low');
    expect(preload?.getAttribute('href')).toBe(`/media${LOADING_BACKDROP_PATHS.at(-1)}`);
    expect(curtain.style.getPropertyValue('--loading-backdrop-image')).toBe(
      `url("/media${LOADING_BACKDROP_PATHS[0]}")`,
    );

    controller.enterNewCycle();
    expect(random).toHaveBeenCalledTimes(2);
    expect(document.head.querySelectorAll('link[data-loading-backdrop-preload]')).toHaveLength(1);
    expect(document.head.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(1);
    expect(imageConstructor).not.toHaveBeenCalled();
    expect(preload?.getAttribute('fetchpriority')).toBe('high');
    expect(preload?.getAttribute('href')).toBe(`/media${LOADING_BACKDROP_PATHS.at(-1)}`);
    expect(curtain.style.getPropertyValue('--loading-backdrop-image')).toBe(
      `url("/media${LOADING_BACKDROP_PATHS.at(-1)}")`,
    );
    vi.unstubAllGlobals();
  });

  it('skips the speculative next-cycle fetch under Data Saver', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="loading-screen"></div>';
    const curtain = document.querySelector<HTMLElement>('#loading-screen');
    if (!curtain) throw new Error('loading-screen fixture is missing');

    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.999_999);
    const controller = new LoadingBackdropController(
      curtain,
      (path) => `/media${path}`,
      random,
      () => true,
    );

    controller.prepareInitial();
    const preload = document.head.querySelector<HTMLLinkElement>(
      'link[data-loading-backdrop-preload]',
    );
    expect(preload?.getAttribute('href')).toBe(`/media${LOADING_BACKDROP_PATHS[0]}`);

    // No speculative fetch: the preload link is untouched and no path was drawn.
    controller.enterNewCycle();
    controller.prepareNextCycle();
    expect(random).toHaveBeenCalledTimes(1);
    expect(preload?.getAttribute('fetchpriority')).toBe('high');
    expect(preload?.getAttribute('href')).toBe(`/media${LOADING_BACKDROP_PATHS[0]}`);

    // The next cycle still rotates, fetching on demand when it actually starts.
    controller.enterNewCycle();
    expect(random).toHaveBeenCalledTimes(2);
    expect(preload?.getAttribute('href')).toBe(`/media${LOADING_BACKDROP_PATHS.at(-1)}`);
    expect(curtain.style.getPropertyValue('--loading-backdrop-image')).toBe(
      `url("/media${LOADING_BACKDROP_PATHS.at(-1)}")`,
    );
  });
});
