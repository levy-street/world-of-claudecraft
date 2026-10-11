import { afterEach, describe, expect, it } from 'vitest';
import { createWebsiteViewNavigation } from '../../src/game/website_view_navigation';
import '../../src/styles/index.css';

// Exercise computed visibility with the shipped CSS, including hidden-view opacity.
function fixture() {
  document.body.innerHTML = `
    <div id="start-screen-backdrop"></div>
    <button class="nav-link" id="nav-btn-play">Play</button>
    <button class="nav-link" id="nav-btn-news">News</button>
    <section id="hero-view" class="view-section"><button id="play-action">Play</button></section>
    <section id="news-view" class="view-section" hidden>News</section>`;
  const navigate = createWebsiteViewNavigation(() => {});
  document.getElementById('nav-btn-play')?.addEventListener('click', () => navigate('#hero-view'));
  document.getElementById('nav-btn-news')?.addEventListener('click', () => navigate('#news-view'));
}
function click(id: string) {
  document.getElementById(id)?.click();
}
function visibleHero() {
  const hero = document.getElementById('hero-view');
  return (
    !!hero &&
    !hero.hidden &&
    getComputedStyle(hero).display !== 'none' &&
    Number(getComputedStyle(hero).opacity) === 1
  );
}
afterEach(() => {
  document.body.innerHTML = '';
});
describe('website navigation visibility', () => {
  it('returns to a fully visible Play page after browsing News', async () => {
    fixture();
    click('nav-btn-news');
    await expect.poll(() => document.getElementById('hero-view')?.hidden).toBe(true);
    click('nav-btn-play');
    await expect.poll(visibleHero).toBe(true);
    expect(document.getElementById('news-view')?.hidden).toBe(true);
  });
  it('cancels an outgoing transition when the player immediately returns to Play', async () => {
    fixture();
    click('nav-btn-news');
    click('nav-btn-play');
    // Let the old transition deadline pass; it must not hide Play afterward.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(visibleHero()).toBe(true);
    expect(document.getElementById('news-view')?.hidden).toBe(true);
  });
});
