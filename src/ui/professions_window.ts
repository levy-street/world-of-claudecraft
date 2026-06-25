// Thin DOM consumer for the professions window.
//
// The consumer half of the pure-core + thin-consumer split (the Vendor window
// is the reference: vendor_view.ts + vendor_window.ts). It paints the panel
// from the structured ProfessionsView (professions_view.ts) and wires the
// learn / abandon / train / craft / close actions. It owns no state: the
// cross-window orchestration (which windows to close, mobile teardown) stays in
// Hud, which keeps its private state; this module only renders one panel and
// reports clicks back through the injected callbacks.
//
// It imports t/esc/formatters directly but takes Hud's shared painters
// (itemIcon, itemName, itemTooltip, attachTooltip, hideTooltip, moneyHtml) and
// the action callbacks as an injected `deps` object. It never imports Hud or a
// concrete world, and it does NOT import sim/data.

import { esc } from './esc';
import { formatNumber, t, type TranslationKey } from './i18n';
import type { ItemDef, ProfessionColor, ProfessionId } from '../sim/types';
import type { ProfessionsView, RecipeRow } from './professions_view';

/**
 * Hud-supplied glue. The icon/name/money/tooltip painters live on Hud (shared
 * with every other window); the action callbacks let Hud keep learn/abandon/
 * train/craft dispatch and re-render scheduling. The module never reaches into
 * Hud directly.
 */
export interface ProfessionsWindowDeps {
  /** Returns <img> (or equivalent) HTML for an item icon at the given size. */
  itemIcon(itemId: string, size?: number): string;
  /** Localized display name for an item. */
  itemName(itemId: string): string;
  /** Tooltip HTML for a full item def (for hover). */
  itemTooltip(item: ItemDef): string;
  attachTooltip(el: HTMLElement, html: () => string): void;
  hideTooltip(): void;
  moneyHtml(copper: number): string;
  onLearn(id: ProfessionId): void;
  onAbandon(id: ProfessionId): void;
  onAdvanceRank(id: ProfessionId): void;
  onCraft(recipeId: string, count: number): void;
  onClose(): void;
}

// Classic skill-up difficulty colours (orange best -> grey no gain). Inline so
// the consumer needs no shared CSS for the recipe difficulty dot.
const DIFFICULTY_HEX: Record<ProfessionColor, string> = {
  orange: '#ff8040',
  yellow: '#ffff00',
  green: '#40c040',
  grey: '#9d9d9d',
};

// Profession / rank display names resolve by id through hudChrome.professions.*
// (the consumer owns this mapping; the pure view carries only the ids).
const PROFESSION_NAME_KEYS: Record<ProfessionId, TranslationKey> = {
  mining: 'hudChrome.professions.names.mining',
  herbalism: 'hudChrome.professions.names.herbalism',
  blacksmithing: 'hudChrome.professions.names.blacksmithing',
  alchemy: 'hudChrome.professions.names.alchemy',
};
const PROFESSION_RANK_KEYS: Record<string, TranslationKey> = {
  apprentice: 'hudChrome.professions.ranks.apprentice',
  journeyman: 'hudChrome.professions.ranks.journeyman',
  expert: 'hudChrome.professions.ranks.expert',
};

function professionName(id: ProfessionId): string {
  return t(PROFESSION_NAME_KEYS[id]);
}
function rankName(rankId: string): string {
  const key = PROFESSION_RANK_KEYS[rankId];
  return key ? t(key) : rankId;
}

/** Paint the professions panel from a prepared view. */
export function renderProfessionsWindow(
  el: HTMLElement,
  view: ProfessionsView,
  deps: ProfessionsWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires) and
  // collapses the scrolled list, so drop the tooltip and restore the scroll.
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  el.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'panel-title';
  header.innerHTML =
    `<span>${esc(t('hudChrome.professions.title'))}</span>` +
    `<span class="prof-slots">${esc(
      t('hudChrome.professions.slotsUsed', {
        count: formatNumber(view.slotsUsed),
        cap: formatNumber(view.slotCap),
      }),
    )}</span>` +
    `<button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.vendor.close'))}">${esc(
      t('itemUi.vendor.close'),
    )}</button>`;
  el.appendChild(header);

  if (view.learned.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'prof-empty';
    empty.textContent = t('hudChrome.professions.empty');
    el.appendChild(empty);
  }

  for (const prof of view.learned) {
    const section = document.createElement('div');
    section.className = 'prof-section';

    // --- Profession header: name + rank badge + train/abandon controls ------
    const head = document.createElement('div');
    head.className = 'prof-head';
    head.innerHTML =
      `<span class="prof-name">${esc(professionName(prof.id))}</span>` +
      `<span class="prof-rank" style="color:${DIFFICULTY_HEX.orange}">${esc(
        t('hudChrome.professions.rankLabel', { rank: rankName(prof.rankId) }),
      )}</span>`;
    section.appendChild(head);

    // --- Skill bar ----------------------------------------------------------
    const skillBar = document.createElement('div');
    skillBar.className = 'prof-skill';
    const pct = prof.cap > 0 ? Math.max(0, Math.min(100, (prof.skill / prof.cap) * 100)) : 0;
    skillBar.innerHTML =
      `<div class="prof-skill-fill" style="width:${pct}%"></div>` +
      `<span class="prof-skill-label">${esc(
        t('hudChrome.professions.skill', {
          skill: formatNumber(prof.skill),
          cap: formatNumber(prof.cap),
        }),
      )}</span>`;
    section.appendChild(skillBar);

    // --- Train + Abandon buttons -------------------------------------------
    const actions = document.createElement('div');
    actions.className = 'prof-actions';

    const train = document.createElement('button');
    train.type = 'button';
    train.className = 'prof-train';
    if (prof.nextRank) {
      const next = prof.nextRank;
      train.disabled = !next.reachable || !next.affordable;
      train.innerHTML = t('hudChrome.professions.train', {
        rank: esc(rankName(next.rankId)),
        cost: deps.moneyHtml(next.cost),
      });
      if (!next.reachable) {
        train.disabled = true;
        train.textContent = t('hudChrome.professions.trainMaxed', {
          cap: formatNumber(prof.cap),
        });
      }
      train.addEventListener('click', () => {
        if (!train.disabled) deps.onAdvanceRank(prof.id);
      });
    } else {
      train.disabled = true;
      train.textContent = t('hudChrome.professions.trainTopRank');
    }
    actions.appendChild(train);

    const abandon = document.createElement('button');
    abandon.type = 'button';
    abandon.className = 'prof-abandon';
    abandon.textContent = t('hudChrome.professions.abandon');
    abandon.setAttribute(
      'aria-label',
      t('hudChrome.professions.abandonConfirm', { prof: professionName(prof.id) }),
    );
    abandon.addEventListener('click', () => deps.onAbandon(prof.id));
    actions.appendChild(abandon);
    section.appendChild(actions);

    // --- Gathering hint OR recipe list -------------------------------------
    if (prof.kind === 'gathering' && prof.recipes.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'prof-gather-hint';
      hint.textContent = t('hudChrome.professions.gatheringHint');
      section.appendChild(hint);
    } else {
      if (prof.feedsFrom) {
        const feeds = document.createElement('div');
        feeds.className = 'prof-feeds';
        feeds.textContent = t('hudChrome.professions.feedsFrom', {
          prof: professionName(prof.feedsFrom),
        });
        section.appendChild(feeds);
      }

      const recipesHead = document.createElement('div');
      recipesHead.className = 'prof-recipes-head';
      recipesHead.textContent = t('hudChrome.professions.recipesHeading');
      section.appendChild(recipesHead);

      if (prof.recipes.length === 0) {
        const none = document.createElement('div');
        none.className = 'prof-no-recipes';
        none.textContent = t('hudChrome.professions.noRecipes');
        section.appendChild(none);
      }
      for (const recipe of prof.recipes) {
        section.appendChild(renderRecipeRow(recipe, deps));
      }
    }

    el.appendChild(section);
  }

  // --- Available to learn ---------------------------------------------------
  if (view.available.length > 0) {
    const availHead = document.createElement('div');
    availHead.className = 'prof-avail-head';
    availHead.textContent = t('hudChrome.professions.availableHeading');
    el.appendChild(availHead);

    for (const avail of view.available) {
      const row = document.createElement('div');
      row.className = 'prof-avail-row';
      const label = document.createElement('span');
      label.className = 'prof-avail-name';
      label.textContent = avail.feedsFrom
        ? `${professionName(avail.id)} (${t('hudChrome.professions.feedsFrom', {
            prof: professionName(avail.feedsFrom),
          })})`
        : professionName(avail.id);
      row.appendChild(label);

      const learn = document.createElement('button');
      learn.type = 'button';
      learn.className = 'prof-learn';
      learn.textContent = t('hudChrome.professions.learn');
      learn.setAttribute(
        'aria-label',
        `${t('hudChrome.professions.learn')} ${professionName(avail.id)}`,
      );
      learn.addEventListener('click', () => deps.onLearn(avail.id));
      row.appendChild(learn);
      el.appendChild(row);
    }
  }

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}

/** One recipe row: output icon + name + count, difficulty dot, reagents, Craft. */
function renderRecipeRow(recipe: RecipeRow, deps: ProfessionsWindowDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = `prof-recipe${recipe.locked ? ' prof-recipe-locked' : ''}`;

  const out = document.createElement('div');
  out.className = 'prof-recipe-out';
  const outName = deps.itemName(recipe.outputItemId);
  const countSuffix = recipe.outputCount > 1 ? ` x${formatNumber(recipe.outputCount)}` : '';
  out.innerHTML =
    `<span class="prof-diff-dot" style="background:${DIFFICULTY_HEX[recipe.color]}" aria-hidden="true"></span>` +
    `${deps.itemIcon(recipe.outputItemId)}` +
    `<span class="prof-recipe-name">${esc(outName)}${esc(countSuffix)}</span>`;
  out.setAttribute('aria-label', t(`hudChrome.professions.color.${recipe.color}` as TranslationKey));
  row.appendChild(out);

  // --- Reagents -----------------------------------------------------------
  const reagentsWrap = document.createElement('div');
  reagentsWrap.className = 'prof-reagents';
  const reqLabel = document.createElement('span');
  reqLabel.className = 'prof-requires';
  reqLabel.textContent = t('hudChrome.professions.requires');
  reagentsWrap.appendChild(reqLabel);

  for (const reagent of recipe.reagents) {
    const chip = document.createElement('span');
    chip.className = `prof-reagent${reagent.enough ? '' : ' prof-reagent-short'}`;
    if (!reagent.enough) chip.style.color = DIFFICULTY_HEX.orange;
    chip.innerHTML =
      `${deps.itemIcon(reagent.itemId, 18)}` +
      `<span class="prof-reagent-name">${esc(deps.itemName(reagent.itemId))}</span>` +
      `<span class="prof-reagent-count">${esc(
        t('hudChrome.professions.have', {
          have: formatNumber(reagent.have),
          need: formatNumber(reagent.need),
        }),
      )}</span>`;
    reagentsWrap.appendChild(chip);
  }
  row.appendChild(reagentsWrap);

  // --- Craft buttons ------------------------------------------------------
  const craftWrap = document.createElement('div');
  craftWrap.className = 'prof-craft-wrap';

  const craft = document.createElement('button');
  craft.type = 'button';
  craft.className = 'prof-craft';
  craft.textContent = t('hudChrome.professions.craft');
  craft.disabled = !recipe.craftable;
  craft.addEventListener('click', () => {
    if (!craft.disabled) deps.onCraft(recipe.id, 1);
  });
  craftWrap.appendChild(craft);

  const craftMany = document.createElement('button');
  craftMany.type = 'button';
  craftMany.className = 'prof-craft-many';
  craftMany.textContent = t('hudChrome.professions.craftMany', { count: formatNumber(5) });
  craftMany.disabled = !recipe.craftable;
  craftMany.addEventListener('click', () => {
    if (!craftMany.disabled) deps.onCraft(recipe.id, 5);
  });
  craftWrap.appendChild(craftMany);
  row.appendChild(craftWrap);

  return row;
}
