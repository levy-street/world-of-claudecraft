// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import {
  fullSizeUrl,
  imageCaption,
  markZoomable,
  mountImageViewer,
} from '../mediawiki/reader/image_viewer.js';

it('opens an attack snapshot at its full-size frame and leaves other pictures as they are', () => {
  expect(fullSizeUrl('http://x/encyclopedia-attacks/korgath__strain.webp')).toBe(
    'http://x/encyclopedia-attacks/full/korgath__strain.webp',
  );
  expect(fullSizeUrl('/encyclopedia-attacks/full/korgath__strain.webp')).toBeNull();
  expect(fullSizeUrl('/encyclopedia-stills/npc__smith_haldren.webp')).toBeNull();
  expect(fullSizeUrl('data:image/webp;base64,AAAA')).toBeNull();
});

it('opens a clicked wiki picture larger with the attack name as its caption', () => {
  const view = document.createElement('main');
  view.innerHTML =
    '<article class="wiki-prose"><ul><li class="mechanic-card"><img class="attack-shot" src="/encyclopedia-attacks/a.webp"><div><strong class="mechanic-name">Maul Arc <span class="mechanic-flag">Important</span></strong></div></li></ul></article>' +
    '<div class="wiki-box-art"><img class="article-art model" src="/encyclopedia-stills/b.webp"></div><p><img class="plain" src="/x.webp"></p>';
  document.body.append(view);
  HTMLDialogElement.prototype.showModal ??= function showModal() {
    this.open = true;
  };
  mountImageViewer(view, () => 'Korgath');
  markZoomable(view);
  const shot = view.querySelector('.attack-shot');
  expect(shot.tabIndex).toBe(0);
  expect(view.querySelector('img.plain').tabIndex).not.toBe(0);
  shot.click();
  const dialog = document.querySelector('dialog.image-viewer');
  expect(dialog.open).toBe(true);
  expect(dialog.querySelector('figure img').getAttribute('src')).toContain(
    '/encyclopedia-attacks/full/a.webp',
  );
  expect(dialog.querySelector('figcaption').textContent).toBe('Maul Arc');
  expect(imageCaption(view.querySelector('.wiki-box-art img'), 'Korgath')).toBe('Korgath');
  view.remove();
  dialog.remove();
});
