import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const indexHtml = read('index.html');
const playHtml = read('play.html');
const componentsCss = read('src/styles/components.css');
const mobileCss = read('src/styles/hud.mobile.css');
const hudCss = read('src/styles/hud.css');
const hudTs = read('src/ui/hud.ts');
const controlsTs = read('src/ui/mount_race_controls.ts');
const stripTs = read('src/ui/mount_race_strip.ts');

describe('show-jumping race UI wiring', () => {
  it('ships the start, timer, and countdown controls in both game entries', () => {
    for (const entry of [indexHtml, playHtml]) {
      expect(entry).toContain('id="mount-race-strip"');
      expect(entry).toContain('id="race-start-btn"');
      expect(entry).toContain('id="race-countdown"');
    }
  });

  it('uses a larger timer strip positioned higher on desktop and touch layouts', () => {
    const strip = componentsCss.match(/#mount-race-strip \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
    const timer =
      componentsCss.match(/#mount-race-strip \.mr-timer \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
    expect(strip).toContain('bottom: 210px');
    expect(strip).toContain('font-size: 18px');
    expect(timer).toContain('width: 150px');
    expect(timer).toContain('height: 10px');
    expect(mobileCss).toContain('body.mobile-touch #mount-race-strip,');
    expect(mobileCss).toContain('body.mobile-touch #race-start-btn {');
    expect(mobileCss).toContain('bottom: max(34vh');
  });

  it('places Start/Cancel above the player frame and hides Cancel after GO', () => {
    const button = componentsCss.match(/#race-start-btn \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
    expect(button).toContain('left: 50%');
    expect(button).toContain('bottom: 210px');
    expect(button).toContain('translateX(-50%)');
    expect(controlsTs).toContain('this.deps.cancelRace()');
    expect(controlsTs).toContain("view?.phase === 'countdown'");
    expect(controlsTs).toContain('hudChrome.mountRace.cancelButton');
  });

  it('keeps lesson instructions clear of the countdown and GO flash', () => {
    expect(hudTs).toContain('this.hideBannerImmediately()');
    expect(hudTs).toContain('this.mountRaceInstructionTimer = window.setTimeout');
    expect(hudTs).toContain("this.showBanner(t('hudChrome.mountRace.start'))");
  });

  it('keeps the timer to the loader bar and seconds remaining', () => {
    expect(stripTs).toContain('mr-timer-bar');
    expect(stripTs).toContain('mr-secs');
    expect(stripTs).not.toContain('mr-progress');
  });

  it('starts the lesson from the shared platform instead of a Marla gossip button', () => {
    expect(hudTs).toContain('isOnMountRaceStartPlatform(this.sim.player.pos)');
    expect(hudTs).not.toContain('data-mount-training');
  });

  it('shows the lesson completion prompt as localized subtext and clears it for later banners', () => {
    expect(hudTs).toContain("t('hudChrome.mountTraining.returnToMarla'), 6000");
    expect(hudTs).toContain("this.bannerEl.classList.toggle('has-subtext', !!subtext)");
    expect(hudTs).toContain('this.bannerEl.replaceChildren()');
    expect(hudCss).toContain('#banner .banner-subtext');
  });

  it('shows the live mount key after the riding lesson quest is turned in', () => {
    expect(hudTs).toContain("ev.questId === 'q_riding_lessons'");
    expect(hudTs).toContain("t('hudChrome.mountTraining.ownedMountPrompt'");
    expect(hudTs).toContain('key: this.mountKey()');
    expect(hudTs).toContain("this.keybinds.primaryLabel('mount') || t('hud.options.unbound')");
    expect(hudTs).not.toContain("this.keybinds.primaryLabel('mount') || 'Z'");
  });

  it('wraps long race banners within the viewport', () => {
    const banner = hudCss.match(/#banner \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
    expect(banner).toContain('max-width: calc(100vw - 48px)');
    expect(banner).toContain('white-space: normal');
    expect(banner).toContain('overflow-wrap: anywhere');
    expect(banner).toContain('text-align: center');
  });
});
