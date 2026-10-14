// The Cartographer's Ink map picker: using the ink asks which held treasure map
// to redraw instead of silently picking the read one. A thin DOM consumer of
// ink_map_picker_view.ts, mounted into #prompt-stack through the shared modal
// recipe (prompt_dialog.ts). The choice rides IWorld.useItem's `inkMap` target;
// the sim re-validates it, so a stale row is refused there, never applied.

import {
  CARTOGRAPHERS_INK_ITEM_ID,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_SITES_BY_ID,
} from '../../../sim/content/treasure_maps';
import { ITEMS } from '../../../sim/data';
import type { IWorld } from '../../../world_api';
import { itemDisplayName, zoneDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import { ownEntry } from '../../known_item';
import { installPromptDialog, type PromptDialogHandle } from '../../prompt_dialog';
import { type InkMapChoice, inkMapPickerModel } from './ink_map_picker_view';

type InkPickerWorld = Pick<IWorld, 'inventory' | 'treasureMap' | 'useItem'>;

export interface InkMapPickOptions {
  /** The bag copy the player clicked, forwarded so the sim spends from it. */
  slotIndex?: number;
  /** The window blocked behind the prompt (defaults to the action bar row). */
  inertRoot?: HTMLElement | null;
}

const NUM0 = { maximumFractionDigits: 0 } as const;

// One picker at a time: a second ink press while it is open just refocuses it.
let open: { el: HTMLElement; handle: PromptDialogHandle } | null = null;

function mapName(choice: InkMapChoice): string {
  const def = ownEntry(ITEMS, TREASURE_MAP_ITEM_IDS[choice.rarity]);
  return def ? itemDisplayName(def) : '';
}

function choiceNote(world: InkPickerWorld, choice: InkMapChoice): string {
  if (!choice.read) {
    return t('hudChrome.treasureMap.inkPickerUnread', { count: formatNumber(choice.count, NUM0) });
  }
  const site = world.treasureMap ? TREASURE_SITES_BY_ID[world.treasureMap.siteId] : undefined;
  return t('hudChrome.treasureMap.inkPickerRead', {
    zone: site ? zoneDisplayName(site.zoneId) : '',
  });
}

function choiceHtml(world: InkPickerWorld, choice: InkMapChoice, index: number): string {
  const cost = t('hudChrome.treasureMap.inkPickerCost', {
    inks: formatNumber(choice.inks, NUM0),
    rarity: t(`hudChrome.treasureMap.rarity.${choice.next}` as TranslationKey),
  });
  return (
    `<button type="button" class="tmap-ink-choice" data-rarity="${choice.rarity}" data-choice="${index}"${choice.affordable ? '' : ' aria-disabled="true"'}>` +
    `<span class="tmap-ink-name">${esc(mapName(choice))}</span>` +
    `<span class="tmap-ink-note">${esc(choiceNote(world, choice))}</span>` +
    `<span class="tmap-ink-cost">${esc(cost)}</span></button>`
  );
}

/**
 * Open the picker for an ink use. Returns true when the use was taken over (the
 * picker is showing, or was already), false when the item is not the ink or
 * there is no map to offer, in which case the caller sends the plain use and
 * the sim answers with its own refusal.
 */
export function pickInkMap(
  world: InkPickerWorld,
  itemId: string,
  opts: InkMapPickOptions = {},
): boolean {
  if (itemId !== CARTOGRAPHERS_INK_ITEM_ID) return false;
  if (open?.el.isConnected) {
    open.el.querySelector<HTMLElement>('button:not([aria-disabled])')?.focus();
    return true;
  }
  const stack = document.getElementById('prompt-stack');
  const model = inkMapPickerModel(world);
  if (!stack || model.choices.length === 0) return false;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const prompt = document.createElement('div');
  prompt.className = 'prompt panel ui-window tmap-ink-prompt';
  prompt.innerHTML =
    `<h3 class="prompt-text">${esc(t('hudChrome.treasureMap.inkPickerTitle'))}</h3>` +
    `<p class="tmap-ink-held">${esc(
      t('hudChrome.treasureMap.inkPickerHeld', { held: formatNumber(model.held, NUM0) }),
    )}</p>` +
    `<div class="tmap-ink-list">${model.choices.map((c, i) => choiceHtml(world, c, i)).join('')}</div>` +
    `<div class="tmap-ink-actions"><button type="button" class="btn tmap-ink-cancel">${esc(
      t('hudChrome.treasureMap.inkPickerCancel'),
    )}</button></div>`;
  const inertRoot =
    opts.inertRoot ?? document.getElementById('actionbar-row') ?? document.createElement('div');
  const handle = installPromptDialog(
    prompt,
    opener,
    () => {
      prompt.remove();
      if (open?.el === prompt) open = null;
    },
    { inertRoot, idPrefix: 'tmap-ink-title' },
  );
  // The recipe paints the first button as the red accept; every row is a
  // choice and none is the default, so the rows keep the plain button look.
  // A row the held ink cannot pay for is aria-disabled, not disabled, so a
  // keyboard or screen-reader user can still reach it and hear its cost.
  for (const button of prompt.querySelectorAll<HTMLButtonElement>('.tmap-ink-choice')) {
    button.classList.remove('ui-btn--red');
    button.addEventListener('click', () => {
      const choice = model.choices[Number(button.dataset.choice)];
      if (!choice?.affordable) return;
      handle.dismissAndReturn();
      world.useItem(itemId, {
        slotIndex: opts.slotIndex,
        inkMap: { rarity: choice.rarity, read: choice.read },
      });
    });
  }
  prompt
    .querySelector('.tmap-ink-cancel')
    ?.addEventListener('click', () => handle.dismissAndReturn());
  stack.append(prompt);
  open = { el: prompt, handle };
  (
    prompt.querySelector<HTMLElement>('.tmap-ink-choice:not([aria-disabled])') ??
    prompt.querySelector<HTMLElement>('.tmap-ink-cancel')
  )?.focus();
  return true;
}
