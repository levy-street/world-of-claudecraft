// Character-sheet progression views: the specialization/Mastery summary and the
// post-cap Progression block (total XP, virtual level, prestige rank, milestone
// and deed-border badges, active title, Reliquary standing, and the Prestige
// button). Pure IWorld -> html string builders on the reliquary_sheet_view
// pattern, moved out of the hud.ts coordinator verbatim; the CharWindow deps
// consume them through thin closures and the data-act buttons keep their
// existing hud-side handlers.
import { DEED_ORDER, DEEDS } from '../sim/content/deeds';
import { talentsFor } from '../sim/content/talents';
import {
  canPrestige,
  MAX_LEVEL,
  MILESTONES,
  virtualLevel,
  xpUntilNextPrestige,
} from '../sim/types';
import type { IWorld } from '../world_api';
import { deedName, deedTitleText } from './deed_i18n';
import { esc } from './esc';
import { t } from './i18n';
import { buildReliquarySheetModel, reliquarySheetProgressionHtml } from './reliquary_sheet_view';
import { roleLabel, tTalent } from './talent_i18n';
import { formatXp } from './xp_bar';

function milestoneName(id: string): string {
  switch (id) {
    case 'veteran':
      return t('game.milestone.veteran');
    case 'champion':
      return t('game.milestone.champion');
    case 'paragon':
      return t('game.milestone.paragon');
    case 'mythic':
      return t('game.milestone.mythic');
    case 'eternal':
      return t('game.milestone.eternal');
    default:
      return id;
  }
}

// Character-sheet summary of the current specialization, role, and Mastery
// (FR-8.6). Reuses the progression-block styling.
export function talentSummaryHtml(sim: IWorld): string {
  const ct = talentsFor(sim.cfg.playerClass);
  if (!ct) return '';
  const sp = ct.specs.find((s) => s.id === sim.talentSpec);
  const specName = sp
    ? esc(tTalent({ kind: 'talentSpec', spec: sp, field: 'name' }))
    : t('game.talents.noSpec');
  let html = `<div class="char-progression"><div class="cp-title">${t('game.talents.specTab')}</div>`;
  html += `<div class="char-stats cp-stats"><span>${t('game.talents.specTab')}: <b>${specName}</b></span>`;
  if (sp) html += `<span>${t('game.talents.role')}: <b>${roleLabel(sp.role)}</b></span>`;
  html += `</div>`;
  if (sp)
    html += `<div class="cp-milestones"><span class="cp-ms-label">${t('game.talents.mastery')}:</span> <b style="color:var(--gold)">${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'name' }))}</b> <span class="cp-none">${esc(tTalent({ kind: 'talentMastery', spec: sp, field: 'description' }))}</span></div>`;
  return `${html}</div>`;
}

// The "Progression" group on the character sheet: total XP, virtual level,
// prestige rank (when prestiged), unlocked milestone badges, and, at the cap,
// the opt-in Prestige button.
export function progressionHtml(sim: IWorld, level: number): string {
  const vlevel = virtualLevel(sim.lifetimeXp);
  const unlocked = new Set(sim.unlockedMilestones);
  // Earned Book of Deeds border rewards join the badge row through the same
  // ms-badge plumbing. The row is now a WORN-state readout: borders render on
  // nameplates and unit-frame portraits, and the one the player wears carries
  // the worn word in its own label, so the state never rides colour alone.
  const borderBadges = DEED_ORDER.filter(
    (id) => DEEDS[id].reward?.kind === 'border' && sim.deedsEarned.has(id),
  )
    .map((id) => {
      const worn = id === sim.activeBorder;
      const name = deedName(id);
      const label = worn ? t('hudChrome.deeds.charBorderWorn', { name }) : name;
      return `<span class="ms-badge ms-deed-border${worn ? ' ms-active' : ''}">${esc(label)}</span>`;
    })
    .join('');
  const badges =
    MILESTONES.filter((m) => unlocked.has(m.id))
      .map((m) => `<span class="ms-badge ms-${m.kind}">${milestoneName(m.id)}</span>`)
      .join('') + borderBadges;
  let html = `<div class="cp-title">${t('game.progression.heading')}</div>`;
  html += `<div class="char-stats cp-stats">
      <span>${t('game.progression.totalXp')}: <b>${formatXp(sim.lifetimeXp)}</b></span>
      <span>${t('game.progression.virtualLevel')}: <b>${vlevel}</b></span>`;
  if (sim.prestigeRank > 0)
    html += `<span>${t('game.progression.prestigeRank')}: <b>★ ${sim.prestigeRank}</b></span>`;
  html += `</div>`;
  html += `<div class="cp-milestones"><span class="cp-ms-label">${t('game.progression.milestones')}:</span> ${badges || `<span class="cp-none">${t('game.progression.none')}</span>`}</div>`;
  // The active Book of Deeds title line; the button opens the Book (its
  // Titles section is one click away). Title text is deed content localized
  // through deed_i18n, never a raw id.
  const activeTitleText = sim.activeTitle ? deedTitleText(sim.activeTitle) : '';
  html += `<div class="cp-milestones"><span class="cp-ms-label">${t('hudChrome.deeds.charTitleLabel')}:</span> ${
    activeTitleText !== ''
      ? `<b class="cp-active-title">${esc(activeTitleText)}</b>`
      : `<span class="cp-none">${t('hudChrome.deeds.charTitleNone')}</span>`
  } <button type="button" class="btn cp-deeds-btn" data-act="open-deeds">${t('hudChrome.deeds.charOpenBook')}</button></div>`;
  // Labeled Reliquary completion pair + Curator rank (character-scoped;
  // pure core paints the chrome; open button wires through CharWindow).
  html += reliquarySheetProgressionHtml(buildReliquarySheetModel(sim));
  if (level >= MAX_LEVEL) {
    // The button reflects the server's authoritative prestige gate (post-cap
    // XP earned). It's disabled (and the requirement shown) until eligible;
    // the server re-checks regardless, so a forged click does nothing.
    const ready = canPrestige(level, sim.lifetimeXp, sim.prestigeRank);
    html += `<div class="cp-actions"><button class="btn" data-act="prestige"${ready ? '' : ' disabled'}>${t('game.prestige.action')}${sim.prestigeRank > 0 ? ` (★ ${sim.prestigeRank})` : ''}</button>`;
    if (!ready)
      html += `<span class="cp-hint">${formatXp(xpUntilNextPrestige(sim.lifetimeXp, sim.prestigeRank))} ${t('game.prestige.needXp')}</span>`;
    html += `</div>`;
  }
  return `<div class="char-progression">${html}</div>`;
}
