// Mobile Armory regression coverage. The live game is landscape-only on touch:
// cards must fit within the store scrollport, and the inspect action row must
// remain visible beside the preview instead of being clipped below it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { svgIcon } from '../../src/ui/ui_icons';
import { cleanup, host } from './_harness';

const EPSILON = 1;

beforeEach(async () => {
  await page.viewport(844, 390);
  document.body.className = 'mobile-touch game-active';
  document.documentElement.style.setProperty('--app-vw', '844px');
  document.documentElement.style.setProperty('--app-vh', '390px');
  document.documentElement.style.setProperty('--ui-scale', '1');
});

afterEach(() => {
  cleanup();
  document.body.className = '';
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
  document.documentElement.style.removeProperty('--ui-scale');
});

function armoryCard(index: number): string {
  return (
    '<article class="armory-card rarity-rare">' +
    `<button type="button" aria-label="Inspect test skin ${index}">` +
    '<span class="armory-card-art"><img alt=""></span>' +
    '<span class="armory-card-copy"><span class="armory-card-type">Sword</span>' +
    `<h4>Test skin ${index}</h4><span class="armory-cost">500</span></span>` +
    '</button></article>'
  );
}

describe('mobile Armory landscape layout', () => {
  it('keeps a complete cosmetic card within the store body height', () => {
    const store = host('daily-rewards-window');
    store.classList.add('store-active');
    store.innerHTML =
      '<div class="panel-title"><span>WOC Store</span>' +
      `<button type="button" class="x-btn" data-close aria-label="Close WOC Store">${svgIcon('close')}</button></div>` +
      '<div class="woc-store-tabs"><button>Store</button><button>Daily Rewards</button></div>' +
      '<div class="dr-body woc-store-body">' +
      '<section class="armory-section rarity-rare"><header><div><span>Rare</span>' +
      '<h3>Test Collection</h3></div><span class="armory-section-price">500</span></header>' +
      `<div class="armory-grid">${[1, 2, 3, 4].map(armoryCard).join('')}</div>` +
      '</section></div>';

    const body = store.querySelector<HTMLElement>('.woc-store-body');
    const card = store.querySelector<HTMLElement>('.armory-card');
    expect(body).not.toBeNull();
    expect(card).not.toBeNull();

    const storeRect = store.getBoundingClientRect();
    const bodyRect = body?.getBoundingClientRect();
    const cardRect = card?.getBoundingClientRect();
    const visibleBodyTop = Math.max(0, storeRect.top, bodyRect?.top ?? 0);
    const visibleBodyBottom = Math.min(
      window.innerHeight,
      storeRect.bottom,
      bodyRect?.bottom ?? Number.POSITIVE_INFINITY,
    );
    expect(visibleBodyBottom).toBeGreaterThan(visibleBodyTop);
    expect(cardRect?.width ?? 0).toBeGreaterThan(0);
    expect(cardRect?.height ?? 0).toBeGreaterThan(0);
    expect(cardRect?.top ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
      visibleBodyTop - EPSILON,
    );
    expect(cardRect?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      visibleBodyBottom + EPSILON,
    );
  });

  it('keeps the inspect action row visible beside the preview', async () => {
    await page.viewport(667, 375);
    document.documentElement.style.setProperty('--app-vw', '667px');
    document.documentElement.style.setProperty('--app-vh', '375px');
    const overlay = document.createElement('div');
    overlay.className = 'armory-inspect-overlay open';
    overlay.innerHTML =
      '<div class="armory-inspect rarity-rare" role="dialog">' +
      `<button type="button" class="x-btn armory-inspect-close" data-armory-close aria-label="Close WOC Store">${svgIcon('close')}</button>` +
      '<div class="armory-inspect-stage"><canvas></canvas><div class="armory-inspect-controls">' +
      '<div class="armory-mode-toggle"><button>Try On</button><button>Weapon</button></div>' +
      '<div class="armory-scene-toggle"><button>Day</button><button>Dusk</button><button>Night</button></div>' +
      '</div></div>' +
      '<div class="armory-inspect-panel"><div class="armory-inspect-details">' +
      '<div class="armory-inspect-head">Rare collection</div>' +
      '<h2>Test skin</h2><p class="armory-type-line">Sword</p>' +
      '<p class="armory-look">A detailed weapon appearance for the character preview.</p>' +
      '<div class="armory-lore"><h3>Lore</h3><p>' +
      'A long description that remains scrollable without pushing the purchase controls ' +
      'below the landscape viewport. '.repeat(20) +
      '</p></div></div>' +
      '<div class="armory-inspect-actions"><span class="armory-price">500</span>' +
      '<button type="button">Buy skin</button></div></div></div>';
    document.body.appendChild(overlay);

    const dialog = overlay.querySelector<HTMLElement>('.armory-inspect');
    const stage = overlay.querySelector<HTMLElement>('.armory-inspect-stage');
    const panel = overlay.querySelector<HTMLElement>('.armory-inspect-panel');
    const details = overlay.querySelector<HTMLElement>('.armory-inspect-details');
    const head = overlay.querySelector<HTMLElement>('.armory-inspect-head');
    const close = overlay.querySelector<HTMLElement>('.armory-inspect-close');
    const actions = overlay.querySelector<HTMLElement>('.armory-inspect-actions');
    expect(dialog).not.toBeNull();
    expect(stage).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(details).not.toBeNull();
    expect(head).not.toBeNull();
    expect(close).not.toBeNull();
    expect(actions).not.toBeNull();

    const dialogRect = dialog?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const headRect = head?.getBoundingClientRect();
    const closeRect = close?.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();
    expect(panelRect?.left ?? 0).toBeGreaterThan((stageRect?.left ?? 0) + EPSILON);
    expect(closeRect?.left ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
      (headRect?.right ?? Number.POSITIVE_INFINITY) - EPSILON,
    );
    expect(details?.scrollHeight ?? 0).toBeGreaterThan(details?.clientHeight ?? 0);
    expect(['auto', 'scroll']).toContain(getComputedStyle(details as HTMLElement).overflowY);
    expect(actionsRect?.width ?? 0).toBeGreaterThan(0);
    expect(actionsRect?.height ?? 0).toBeGreaterThan(0);
    expect(actionsRect?.top ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
      (panelRect?.top ?? 0) - EPSILON,
    );
    expect(actionsRect?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      (panelRect?.bottom ?? 0) + EPSILON,
    );
    expect(panelRect?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      (dialogRect?.bottom ?? 0) + EPSILON,
    );
    if (details) details.scrollTop = 20;
    expect(details?.scrollTop ?? 0).toBeGreaterThan(0);
    const scrolledActionsRect = actions?.getBoundingClientRect();
    expect(
      Math.abs((scrolledActionsRect?.top ?? Number.POSITIVE_INFINITY) - (actionsRect?.top ?? 0)),
    ).toBeLessThanOrEqual(EPSILON);
  });
});
