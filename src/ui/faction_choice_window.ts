// The Envoys' Hall faction-and-race choice window: the one place a character
// swears their permanent faction (via one of its four races). Opened by the Hud
// when an unsworn player talks to an Envoy (src/game/interactions.ts routes it,
// src/sim/envoys.ts enforces every rule server-side); the same race-picker CSS
// the old creation panel used dresses it, so the look is already shipped.
//
// Self-contained window module the Hud composes (src/ui/CLAUDE.md): renders on
// demand into its pre-existing root, wires its own buttons through injected
// deps, and never imports Hud. Not per-frame: no painter/write-elision needed.

import { FACTION_LIST, RACE_LIST, RACES } from '../sim/content/races';
import type { PlayerFaction, PlayerRace } from '../sim/types';
import { esc } from './esc';
import { t } from './i18n';
import { raceDisplayName, racialTraitDesc, racialTraitName } from './race_display';
import { svgIcon } from './ui_icons';

export interface FactionChoiceDeps {
  root(): HTMLElement;
  /** Fires on the confirmed choice; the caller sends the chooseRace command. */
  onChoose(race: PlayerRace): void;
  onClose(): void;
}

const FACTION_LABEL_KEYS: Record<PlayerFaction, string> = {
  kael: 'races.factionKael',
  veth: 'races.factionVeth',
  ossara: 'races.factionOssara',
};

/** Render (or re-render) the choice window into its root. Selection is local
 *  UI state; the confirm button stays disabled until a race is picked. */
export function renderFactionChoice(deps: FactionChoiceDeps): void {
  const el = deps.root();
  let selected: PlayerRace | null = null;

  const factionsHtml = FACTION_LIST.map((faction) => {
    const races = RACE_LIST.filter((id) => RACES[id].faction === faction);
    const buttons = races
      .map(
        (id) =>
          `<button type="button" class="mini-race" data-race="${esc(id)}" aria-pressed="false">${esc(raceDisplayName(id))}</button>`,
      )
      .join('');
    return `<div class="race-faction" data-faction="${esc(faction)}">
      <div class="race-faction-label">${esc(t(FACTION_LABEL_KEYS[faction] as Parameters<typeof t>[0]))}</div>
      <div class="mini-race-row">${buttons}</div>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="panel-title"><span id="envoys-title">${esc(t('hudChrome.envoys.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.options.returnToGame'))}">${svgIcon('close')}</button></div>
    <div class="envoys-prompt">${esc(t('hudChrome.envoys.prompt'))}</div>
    <div class="race-picker" id="envoys-race-picker">${factionsHtml}
      <div class="race-racial-info" aria-live="polite"></div>
    </div>
    <div class="envoys-warning">${esc(t('hudChrome.envoys.permanent'))}</div>
    <div class="auth-actions"><button type="button" class="btn btn-primary" data-act="swear" disabled>${esc(t('hudChrome.envoys.confirm'))}</button></div>`;

  const infoEl = el.querySelector('.race-racial-info');
  const swearBtn = el.querySelector<HTMLButtonElement>('[data-act="swear"]')!;
  const showRacial = (race: PlayerRace) => {
    if (infoEl) infoEl.textContent = `${racialTraitName(race)}: ${racialTraitDesc(race)}`;
  };

  for (const btn of el.querySelectorAll<HTMLElement>('.mini-race')) {
    const race = btn.dataset.race as PlayerRace;
    btn.addEventListener('click', () => {
      for (const x of el.querySelectorAll('.mini-race')) {
        x.classList.remove('sel');
        x.setAttribute('aria-pressed', 'false');
      }
      btn.classList.add('sel');
      btn.setAttribute('aria-pressed', 'true');
      selected = race;
      showRacial(race);
      swearBtn.disabled = false;
    });
    btn.addEventListener('mouseenter', () => showRacial(race));
    btn.addEventListener('focus', () => showRacial(race));
    const restore = () => selected && showRacial(selected);
    btn.addEventListener('mouseleave', restore);
    btn.addEventListener('blur', restore);
  }

  swearBtn.addEventListener('click', () => {
    if (selected) deps.onChoose(selected);
  });
  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
}
