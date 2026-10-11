// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebsiteViewNavigation } from '../src/game/website_view_navigation';

const views = ['hero', 'news', 'highscores', 'download', 'account'];
let reducedMotion = false;
beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () => ({ matches: reducedMotion }) as MediaQueryList,
  );
  document.body.innerHTML =
    '<div id="start-screen-backdrop"></div>' +
    views
      .map(
        (name) =>
          `<button class="nav-link" id="nav-btn-${name === 'hero' ? 'play' : name}"></button><section id="${name}-view" ${name === 'hero' ? '' : 'hidden'}></section>`,
      )
      .join('');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing fixture element: ${id}`);
  return el;
}
function expectView(name: string) {
  for (const view of views) expect(element(`${view}-view`).hidden).toBe(view !== name);
  const active = element(`${name}-view`);
  expect(active.style.opacity).not.toBe('0');
  expect(element(`nav-btn-${name === 'hero' ? 'play' : name}`).getAttribute('aria-pressed')).toBe(
    'true',
  );
}
describe('website view navigation', () => {
  it.each(['news', 'highscores', 'download', 'account'])('returns to Play from %s', (name) => {
    const navigate = createWebsiteViewNavigation(vi.fn());
    navigate(`#${name}-view`);
    vi.runAllTimers();
    expectView(name);
    navigate('#hero-view');
    navigate('#hero-view');
    vi.runAllTimers();
    expectView('hero');
  });
  it('keeps Play visible when clicked before the outgoing transition finishes', () => {
    const navigate = createWebsiteViewNavigation(vi.fn());
    navigate('#news-view');
    navigate('#hero-view');
    vi.runAllTimers();
    expectView('hero');
  });
  it('honors the last destination during rapid navigation', () => {
    const navigate = createWebsiteViewNavigation(vi.fn());
    navigate('#news-view');
    navigate('#download-view');
    navigate('#hero-view');
    vi.runAllTimers();
    expectView('hero');
  });
  it('restores visibility when reduced motion is enabled after leaving Play', () => {
    const navigate = createWebsiteViewNavigation(vi.fn());
    navigate('#news-view');
    vi.runAllTimers();
    reducedMotion = true;
    navigate('#hero-view');
    expectView('hero');
  });
});

describe('website character preview handoff', () => {
  it.each(['charselect-panel', 'charcreate-panel', 'offline-select'])(
    'restores the visible %s preview after returning from News',
    (id) => {
      document
        .getElementById('hero-view')
        ?.insertAdjacentHTML('beforeend', `<div id="${id}"></div>`);
      const preview = vi.fn();
      const navigate = createWebsiteViewNavigation(preview);
      navigate('#news-view');
      vi.runAllTimers();
      expect(preview).not.toHaveBeenCalled();
      navigate('#hero-view');
      vi.runAllTimers();
      expect(preview).toHaveBeenCalledExactlyOnceWith(`#${id}`);
    },
  );
  it('keeps the current page when a destination is missing from a sparse entry', () => {
    const preview = vi.fn();
    const navigate = createWebsiteViewNavigation(preview);
    navigate('#news-view');
    vi.runAllTimers();
    navigate('#absent-view');
    vi.runAllTimers();
    expectView('news');
    expect(preview).not.toHaveBeenCalled();
  });
});
