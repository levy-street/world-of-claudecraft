// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { imageCaption, markZoomable, mountImageViewer } from '../mediawiki/reader/image_viewer.js';

it('opens a clicked wiki picture larger with the attack name as its caption', () => {
  const view = document.createElement('main');
  view.innerHTML =
    '<article class="wiki-prose"><ul><li class="mechanic-card"><img class="attack-shot" src="/encyclopedia-attacks/a.webp"><div><strong class="mechanic-name">Maul Arc</strong></div></li></ul></article>' +
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
  expect(dialog.querySelector('figure img').getAttribute('src')).toContain('a.webp');
  expect(dialog.querySelector('figcaption').textContent).toBe('Maul Arc');
  expect(imageCaption(view.querySelector('.wiki-box-art img'), 'Korgath')).toBe('Korgath');
  view.remove();
  dialog.remove();
});
