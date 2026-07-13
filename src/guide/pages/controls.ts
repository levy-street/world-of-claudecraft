// Controls reference. Default desktop keys (from the game's keybind defaults) paired
// with action labels; most labels reuse the shared controls.* catalog. Key glyphs are
// literal keyboard identifiers, not localized text. A note covers mobile touch controls.

import { esc } from '../../ui/esc';
import { type TranslationKey, t } from '../../ui/i18n';
import type { GuidePage } from './types';
import { lead } from './ui';

interface Row {
  keys: string[];
  label: TranslationKey;
}
interface Group {
  heading: TranslationKey;
  rows: Row[];
}

const GROUPS: Group[] = [
  {
    heading: 'guide.controls.groupMovement',
    rows: [
      { keys: ['W', 'A', 'S', 'D'], label: 'controls.moveTurn' },
      { keys: ['Q', 'E'], label: 'controls.strafe' },
      { keys: ['Space'], label: 'controls.jump' },
      { keys: ['R'], label: 'controls.autorun' },
    ],
  },
  {
    heading: 'guide.controls.groupCombat',
    rows: [
      { keys: ['Tab'], label: 'controls.target' },
      { keys: ['H'], label: 'guide.controls.targetFriendly' },
      { keys: ['J'], label: 'guide.controls.cycleFriendly' },
      { keys: ['F'], label: 'controls.interact' },
      { keys: ['1', '0'], label: 'guide.controls.abilities' },
    ],
  },
  {
    heading: 'guide.controls.groupInterface',
    rows: [
      { keys: ['Esc'], label: 'guide.controls.gameMenu' },
      { keys: ['C'], label: 'controls.charPane' },
      { keys: ['P'], label: 'controls.spellbook' },
      { keys: ['L'], label: 'controls.questLog' },
      { keys: ['M'], label: 'controls.worldMap' },
      { keys: ['B'], label: 'controls.bags' },
      { keys: ['N'], label: 'guide.controls.talents' },
      { keys: ['Shift+Z'], label: 'guide.controls.deeds' },
      { keys: ['T'], label: 'guide.controls.crafting' },
      { keys: ['O'], label: 'controls.friends' },
      { keys: ['G'], label: 'guide.controls.arena' },
      { keys: ['Y'], label: 'guide.controls.valeCup' },
      { keys: ['K'], label: 'guide.controls.leaderboard' },
      { keys: ['I'], label: 'guide.controls.calendar' },
      { keys: ['U'], label: 'guide.controls.discord' },
      { keys: ['V'], label: 'controls.nameplates' },
      { keys: ['X'], label: 'controls.emoteWheel' },
      { keys: ['Enter', 'NumEnter'], label: 'controls.chat' },
    ],
  },
  {
    heading: 'guide.controls.groupPet',
    rows: [{ keys: ['Ctrl+1', 'Ctrl+5'], label: 'guide.controls.petBar' }],
  },
  {
    heading: 'guide.controls.groupCamera',
    rows: [
      { keys: ['controls.rightDrag'], label: 'controls.mouselook' },
      { keys: ['controls.leftDrag'], label: 'controls.orbit' },
      { keys: ['guide.controls.bothMouse'], label: 'guide.controls.runForward' },
      { keys: ['controls.mouseWheel'], label: 'controls.zoom' },
    ],
  },
];

// Camera "keys" are descriptive (Right-Drag, Wheel) and live in controls.*; everything
// else is a literal keyboard glyph.
function kbd(key: string): string {
  const text = key.includes('.') ? t(key as TranslationKey) : key;
  return `<kbd>${esc(text)}</kbd>`;
}

export const controls: GuidePage = {
  titleKey: 'guide.nav.controls',
  render() {
    const groups = GROUPS.map((g) => {
      const rows = g.rows
        .map(
          (r) =>
            `<tr><td class="guide-keys">${r.keys.map(kbd).join(' ')}</td><td>${esc(t(r.label))}</td></tr>`,
        )
        .join('');
      return `
          <section class="guide-block">
            <h2>${esc(t(g.heading))}</h2>
            <div class="guide-table-scroll">
              <table class="guide-keytable">
                <thead><tr><th>${esc(t('guide.controls.keyHeader'))}</th><th>${esc(t('guide.controls.actionHeader'))}</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </section>`;
    }).join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.controls'))}</h1>
        ${lead('guide.controls.intro')}
        ${groups}
        <p>${esc(t('guide.controls.attackMoveNote'))}</p>
        <section class="guide-block">
          <h2>${esc(t('guide.controls.mobileHeading'))}</h2>
          <p>${esc(t('guide.controls.mobileBody'))}</p>
        </section>
        <section class="guide-block">
          <h2>${esc(t('guide.controls.controllerHeading'))}</h2>
          <p>${esc(t('guide.controls.controllerBody'))}</p>
        </section>
      </article>`;
  },
};
