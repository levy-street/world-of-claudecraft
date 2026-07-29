import type { PlayerClass } from '../sim/types';

export type StartSkinPortraitUrl = (cls: PlayerClass, skin: number) => string | null;

const PICKERS = [
  {
    row: '#offline-skin-row',
    selectedClass: '#offline-select .mini-class.sel',
  },
  {
    row: '#online-skin-row',
    selectedClass: '#charcreate-panel .mini-class.sel',
  },
] as const;

/** Replace the numbered fallback for an on-demand start-screen skin portrait.
 * The document and portrait seam are injected so main.ts only coordinates the
 * global readiness subscription and this DOM behavior remains directly testable. */
export function refreshStartSkinPickerPortraits(
  document: Document,
  visualKey: string,
  skin: number,
  portraitUrl: StartSkinPortraitUrl,
): void {
  if (!visualKey.startsWith('player_')) return;
  const cls = visualKey.slice('player_'.length) as PlayerClass;
  const url = portraitUrl(cls, skin);
  if (!url) return;
  for (const picker of PICKERS) {
    const row = document.querySelector<HTMLElement>(picker.row);
    const selectedClass = document.querySelector<HTMLElement>(picker.selectedClass);
    if (!row || selectedClass?.dataset.class !== cls) continue;
    const swatch = row.querySelector<HTMLElement>(`.skin-swatch[data-skin="${skin}"]`);
    if (!swatch || swatch.querySelector('.skin-swatch-img')) continue;
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.className = 'skin-swatch-img';
    swatch.textContent = '';
    swatch.appendChild(img);
  }
}
