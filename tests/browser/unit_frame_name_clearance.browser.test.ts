// Real-browser layout pin for the unit-frame name row against its portrait.
//
// The portrait medallion overlaps the bar stack on purpose (the classic
// joint), and the `.ui-ribbon` name header carries a 30px inset on the
// portrait side so the name starts clear of the disc and its heraldry seal.
// A Deed Heraldry border (data-border set on the header) restyles the row as
// a plaque; that restyle must keep the portrait-side clearance. The bug this
// pins: the bordered plaque collapsed the inset to 6px, so the first letter of
// the hero's name rendered UNDER the portrait (issue report: "player name is
// partially hidden behind the portrait").
//
// Measured, not asserted from CSS text: the shipped index.html markup mounts
// under the real style barrel, the border tokens are applied the way the
// unit_frame painter applies them, and the name's text rectangle is compared
// to the portrait's box.
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '../../src/styles/index.css';
import { borderAccent, deedHeraldryStyle } from '../../src/ui/deed_border_view';
import { cleanup } from './_harness';

/** The shipped #player-frame, mirroring index.html (portrait LEFT of the bars). */
const PLAYER_FRAME_MARKUP = `
  <div id="player-frame" class="unitframe" role="group" tabindex="0" aria-label="Your Hero">
    <div class="portrait-wrap ui-portrait-wrap" id="pf-portrait-wrap">
      <div class="portrait ui-portrait"><canvas id="pf-portrait" width="54" height="54"></canvas></div>
      <span class="deed-heraldry-seal" aria-hidden="true">
        <svg class="deed-heraldry-seal-art" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path id="pf-heraldry-seal-motif"></path>
        </svg>
      </span>
      <div class="level-chip ui-medal" id="pf-level">1</div>
    </div>
    <div class="uf-bars">
      <div class="uf-name-header deed-heraldry-plaque ui-ribbon" id="pf-name-header">
        <svg class="deed-heraldry-pattern" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path id="pf-heraldry-pattern-motif"></path>
        </svg>
        <div class="uf-name" id="pf-name">Snipercup</div>
      </div>
      <div class="bar hp ui-bevel"><div class="bar-fill ui-bevel-fill" id="pf-hp"></div><div class="bar-text ui-bevel-text" id="pf-hp-text"></div></div>
      <div class="bar mana ui-bevel ui-bevel--res" id="pf-resource"><div class="bar-fill ui-bevel-fill" id="pf-res"></div><div class="bar-text ui-bevel-text" id="pf-res-text"></div></div>
    </div>
  </div>`;

/** The shipped #target-frame name row and portrait (portrait RIGHT of the bars). */
const TARGET_FRAME_MARKUP = `
  <div id="target-frame" class="unitframe" role="group" tabindex="0" aria-label="Target">
    <div class="uf-bars">
      <div class="uf-name-header deed-heraldry-plaque deed-heraldry-plaque-mirror ui-ribbon ui-ribbon--mirror" id="tf-name-header">
        <svg class="deed-heraldry-pattern" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path id="tf-heraldry-pattern-motif"></path>
        </svg>
        <div class="uf-name" id="tf-name">Snipercup</div>
      </div>
      <div class="bar hp ui-bevel"><div class="bar-fill ui-bevel-fill" id="tf-hp"></div><div class="bar-text ui-bevel-text" id="tf-hp-text"></div></div>
    </div>
    <div class="portrait-wrap ui-portrait-wrap" id="tf-portrait-wrap">
      <div class="portrait ui-portrait"><canvas id="tf-portrait" width="54" height="54"></canvas></div>
      <span class="deed-heraldry-seal" aria-hidden="true">
        <svg class="deed-heraldry-seal-art" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path id="tf-heraldry-seal-motif"></path>
        </svg>
      </span>
      <div class="level-chip ui-medal" id="tf-level">1</div>
    </div>
  </div>`;

function mount(markup: string): HTMLElement {
  const ui = document.createElement('div');
  ui.id = 'ui';
  ui.innerHTML = `<div id="bottom-bar"><div id="actionbar-row"><div id="actionbar-stack">${markup}</div></div></div>`;
  document.body.appendChild(ui);
  return ui;
}

/** Apply a border the way UnitFramePainter.paintHeraldryTokens does: the slug
 *  attribute plus the shared accent tokens, on both the portrait and the row. */
function applyBorder(ui: HTMLElement, prefix: 'pf' | 'tf', slug: string): void {
  const accent = borderAccent(slug);
  if (!accent) throw new Error(`unknown border slug ${slug}`);
  for (const id of [`${prefix}-portrait-wrap`, `${prefix}-name-header`]) {
    const host = ui.querySelector<HTMLElement>(`#${id}`);
    if (!host) throw new Error(`missing #${id}`);
    host.setAttribute('data-border', slug);
    host.setAttribute('style', deedHeraldryStyle(accent));
  }
}

function textRect(el: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect();
}

describe('unit-frame name clearance from the portrait', () => {
  afterEach(cleanup);

  it('keeps the player name clear of the portrait with and without a deed border', async () => {
    await page.viewport(1280, 720);
    document.body.className = 'game-active';
    const ui = mount(PLAYER_FRAME_MARKUP);
    const name = ui.querySelector('#pf-name') as HTMLElement;
    const disc = ui.querySelector('#pf-portrait-wrap .portrait') as HTMLElement;
    const seal = ui.querySelector('#pf-portrait-wrap .deed-heraldry-seal') as HTMLElement;

    const bare = textRect(name);
    expect(bare.width, 'name renders').toBeGreaterThan(0);
    expect(bare.left).toBeGreaterThanOrEqual(disc.getBoundingClientRect().right);

    applyBorder(ui, 'pf', 'prestige_laurels');
    expect(getComputedStyle(seal).display).not.toBe('none');
    const bordered = textRect(name);
    expect(bordered.width, 'name still renders').toBeGreaterThan(0);
    // The first letter must clear the disc AND the joint seal that sits over it.
    expect(bordered.left).toBeGreaterThanOrEqual(disc.getBoundingClientRect().right);
    expect(bordered.left).toBeGreaterThanOrEqual(seal.getBoundingClientRect().right);
  });

  it('keeps the target name clear of the mirrored portrait with a deed border', async () => {
    await page.viewport(1280, 720);
    document.body.className = 'game-active';
    const ui = mount(TARGET_FRAME_MARKUP);
    // The target frame is display:none until the painter flips it for a live
    // target; the fixture flips it the same way so the seat under test renders.
    (ui.querySelector('#target-frame') as HTMLElement).style.display = 'flex';
    const name = ui.querySelector('#tf-name') as HTMLElement;
    const disc = ui.querySelector('#tf-portrait-wrap .portrait') as HTMLElement;
    const seal = ui.querySelector('#tf-portrait-wrap .deed-heraldry-seal') as HTMLElement;

    const bare = textRect(name);
    expect(bare.width, 'name renders').toBeGreaterThan(0);
    expect(bare.right).toBeLessThanOrEqual(disc.getBoundingClientRect().left);

    applyBorder(ui, 'tf', 'prestige_laurels');
    const bordered = textRect(name);
    expect(bordered.width, 'name still renders').toBeGreaterThan(0);
    expect(bordered.right).toBeLessThanOrEqual(disc.getBoundingClientRect().left);
    expect(bordered.right).toBeLessThanOrEqual(seal.getBoundingClientRect().left);
  });
});
