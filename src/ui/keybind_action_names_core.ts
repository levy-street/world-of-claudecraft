// Localized display names for the key-binding actions (src/game/keybinds.ts
// BIND_ACTIONS), a pure core (tests/architecture.test.ts UI_PURE_CORES; it
// imports only the i18n surface): the category headers and the per-action row labels the Key
// Bindings panel paints, and the same names the keyboard overview and the
// on-bar rebind mode's prompts speak (action_bar_bind_controller.ts, through
// the actionName dep hud.ts supplies). One table so the surfaces can never
// name an action differently. Slot actions resolve to what sits in the slot
// (the caller's slotActionName, an ability or item name) and fall back to the
// numbered slot label; slot 0 is always Attack.

import { type TranslationKey, t } from './i18n';

// Localized labels for the keybind category headers + action rows.
export const BIND_CATEGORY_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  Movement: 'hud.keybinds.categories.movement',
  Targeting: 'hud.keybinds.categories.targeting',
  Interface: 'hud.keybinds.categories.interface',
  'Action Bar': 'hud.keybinds.categories.actionBar',
  Pet: 'hudChrome.keybinds.categoryPet',
};
export const BIND_ACTION_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  forward: 'hud.keybinds.actions.forward',
  back: 'hud.keybinds.actions.back',
  turnLeft: 'hud.keybinds.actions.turnLeft',
  turnRight: 'hud.keybinds.actions.turnRight',
  strafeLeft: 'hud.keybinds.actions.strafeLeft',
  strafeRight: 'hud.keybinds.actions.strafeRight',
  jump: 'hud.keybinds.actions.jump',
  // English-only chrome key, like every keybind row added since the `hud`
  // domain was tsc-locked to inline per-locale blocks.
  dive: 'hudChrome.keybinds.dive',
  autorun: 'hud.keybinds.actions.autorun',
  target: 'hud.keybinds.actions.target',
  attackMove: 'hud.keybinds.actions.attackMove',
  interact: 'hud.keybinds.actions.interact',
  char: 'hud.keybinds.actions.char',
  spellbook: 'hud.keybinds.actions.spellbook',
  questlog: 'hud.keybinds.actions.questlog',
  map: 'hud.keybinds.actions.map',
  bags: 'hud.keybinds.actions.bags',
  nameplates: 'hud.keybinds.actions.nameplates',
  meters: 'hud.keybinds.actions.meters',
  targetAuras: 'hudChrome.targetAuras.keybindLabel',
  social: 'hud.keybinds.actions.social',
  arena: 'hud.keybinds.actions.arena',
  dungeonFinder: 'hudChrome.finder.title',
  chat: 'hud.keybinds.actions.chat',
  // Combat/social target + emote-wheel actions. English-only chrome keys (the
  // `hud` catalog domain is tsc-locked to inline per-locale blocks).
  emoteWheel: 'hudChrome.keybinds.emoteWheel',
  targetFriendly: 'hudChrome.keybinds.targetFriendly',
  targetFriendlyNext: 'hudChrome.keybinds.targetFriendlyNext',
  targetPrev: 'hudChrome.keybinds.targetPrev',
  discord: 'hudChrome.keybinds.discord',
  bgFlag: 'hudChrome.keybinds.bgFlag',
  sheathe: 'hudChrome.keybinds.sheathe',
  petAttack: 'hudChrome.keybinds.petAttack',
  petStop: 'hudChrome.keybinds.petStop',
  petTaunt: 'hudChrome.keybinds.petTaunt',
  petDefensive: 'hudChrome.keybinds.petDefensive',
  petAggressive: 'hudChrome.keybinds.petAggressive',
  targetPet: 'hudChrome.keybinds.targetPet',

  // Reuse the existing window/feature names so these labels localize everywhere
  // without duplicating strings (these two ids were previously absent from the
  // map and fell back to the raw English BIND_ACTIONS labels).
  talents: 'game.talents.title',
  leaderboard: 'game.leaderboard.title',
  calendar: 'hudChrome.calendar.keybindLabel',
  crafting: 'hudChrome.crafting.title',
  mount: 'hudChrome.keybinds.mount',
  deeds: 'hudChrome.deeds.title',
  professions: 'hudChrome.professions.title',
  reliquary: 'hudChrome.reliquary.title',
  cosmetics: 'hudChrome.cosmetics.title',
  harvestJournal: 'hudChrome.harvestJournal.title',
  perfecting: 'hudChrome.perfecting.title',
  lootExplorer: 'hudChrome.lootExplorer.title',
};

/** The localized name of a bind action for prompts and rows. `fallback` is the
 *  registry's English label (Keybinds' bindActionLabel), used for an action the
 *  table does not know; the id itself is the last resort. */
export function bindActionDisplayName(
  actionId: string,
  fallback: string | undefined,
  slotActionName: (slot: number) => string | null,
): string {
  if (!actionId.startsWith('slot')) {
    const key = BIND_ACTION_LABEL_KEYS[actionId];
    return key ? t(key) : (fallback ?? actionId);
  }
  const slot = Number(actionId.slice(4));
  if (slot === 0) return t('hud.keybinds.actions.attack');
  return slotActionName(slot) ?? t('hud.keybinds.actions.actionBarSlot', { slot: slot + 1 });
}
