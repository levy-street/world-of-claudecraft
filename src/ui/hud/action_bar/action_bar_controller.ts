import { SPORT_ABILITIES } from '../../../sim/content/vale_cup';
import { ABILITIES, ITEMS } from '../../../sim/data';
import type { PlayerClass } from '../../../sim/types';
import { WARRIOR_STANCE_GROUP } from '../../stance_bar_view';
import { ACTION_BAR_ABILITY_SLOTS } from './action_bar_layout_core';
import {
  actionForAttackSlot,
  attackSlotStorageKey,
  buildDefaultFormBar,
  clearHotbarSlot,
  type HotbarAction,
  isAbilityActionBarEligible,
  parseHotbarActions,
  placeAbilityOnSlot,
  classHasFormBars as playerClassHasFormBars,
  loadAttackSlotAction as readAttackSlotAction,
  sanitizeHotbarAction,
  sanitizeHotbarActions,
  shouldSeedFormBar,
  storedHotbarHasIneligibleAbility,
  syncHotbarActions,
  saveAttackSlotAction as writeAttackSlotAction,
} from './hotbar';

export { ACTION_BAR_ABILITY_SLOTS } from './action_bar_layout_core';

export type HotbarForm = 'normal' | 'bear' | 'cat' | 'cat_stealth' | 'stealth' | 'sport';

const FORM_TOGGLE_IDS = new Set(['bear_form', 'cat_form', 'travel_form']);

export interface ActionBarControllerDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  playerClass: PlayerClass;
  playerName: string;
  knownAbilityIds(): readonly string[];
  hasAura(kind: string): boolean;
  isInSportMatch(): boolean;
  showAttackButton(): boolean;
}

/** Owns action-bar pages, migrations, persistence, and attack-slot assignment. */
export class ActionBarController {
  private activeFormState: HotbarForm = 'normal';
  private actionState: HotbarAction[] = Array.from(
    { length: ACTION_BAR_ABILITY_SLOTS },
    () => null,
  );
  private loadedFromStorage = false;
  private knownAbilityIdsAtLastSync: Set<string> | null = null;
  private attackActionState: HotbarAction = null;

  constructor(private readonly deps: ActionBarControllerDeps) {}

  init(): void {
    this.loadActions();
    this.loadAttackAction();
  }

  get activeForm(): HotbarForm {
    return this.activeFormState;
  }

  get actions(): HotbarAction[] {
    return this.actionState;
  }

  replaceActions(actions: HotbarAction[]): void {
    this.actionState = sanitizeHotbarActions(actions, (id) => this.isAbilityPlacementAllowed(id));
  }

  get attackAction(): HotbarAction {
    return this.attackActionState;
  }

  replaceAttackAction(action: HotbarAction): void {
    this.attackActionState = sanitizeHotbarAction(action, (id) =>
      this.isAbilityPlacementAllowed(id),
    );
  }

  resolveActiveForm(): HotbarForm {
    if (this.deps.isInSportMatch()) return 'sport';
    if (this.deps.playerClass === 'druid') {
      if (this.deps.hasAura('form_bear')) return 'bear';
      if (this.deps.hasAura('form_cat')) {
        if (this.deps.hasAura('stealth')) return 'cat_stealth';
        return 'cat';
      }
    }
    if (this.deps.playerClass === 'rogue' && this.deps.hasAura('stealth')) return 'stealth';
    return 'normal';
  }

  syncActiveForm(): boolean {
    const next = this.resolveActiveForm();
    if (next === this.activeFormState) return false;
    this.saveActions();
    this.saveAttackAction();
    this.activeFormState = next;
    this.loadActions();
    this.loadAttackAction();
    return true;
  }

  syncKnownAbilities(): void {
    const knownAbilityIds = [...this.deps.knownAbilityIds()];
    const autoPlaceAbilityIds = new Set<string>();
    const consider = (id: string): void => {
      // A passive (Measured Fury) is known but never castable, so it never
      // auto-places on the action bar (a manual drag would be a dead slot too).
      if (!this.isAbilityPlacementAllowed(id)) return;
      // Warrior stances live on the dedicated #stancebar, never the action bar,
      // so learning one on level-up must not consume an action slot.
      if (ABILITIES[id]?.exclusiveGroup === WARRIOR_STANCE_GROUP) return;
      if (this.shouldAutoPlaceOnForm(id, this.activeFormState)) autoPlaceAbilityIds.add(id);
    };
    if (this.knownAbilityIdsAtLastSync === null) {
      if (!this.loadedFromStorage) {
        for (const id of knownAbilityIds) consider(id);
      }
    } else {
      for (const id of knownAbilityIds) {
        if (!this.knownAbilityIdsAtLastSync.has(id)) consider(id);
      }
    }
    const formToggle = this.formToggleAbilityId();
    if (formToggle && knownAbilityIds.includes(formToggle)) autoPlaceAbilityIds.add(formToggle);
    const synced = syncHotbarActions(
      this.actionState,
      knownAbilityIds,
      autoPlaceAbilityIds,
      (id) => !this.isAbilityPlacementAllowed(id),
    );
    this.actionState = synced.actions;
    if (synced.changed) this.saveActions();
    this.knownAbilityIdsAtLastSync = new Set(knownAbilityIds);
  }

  addAbility(abilityId: string): boolean {
    // A passive is never castable: reject a manual drag/spellbook add so it
    // cannot occupy a dead action slot (auto-place already skips passives).
    if (!this.isAbilityPlacementAllowed(abilityId)) return false;
    if (this.actionState.some((action) => action?.type === 'ability' && action.id === abilityId)) {
      return false;
    }
    const target = this.actionState.indexOf(null);
    if (target === -1) return false;
    this.actionState = placeAbilityOnSlot(this.actionState, abilityId, target);
    this.saveActions();
    return true;
  }

  hasFreeSlot(): boolean {
    return this.actionState.includes(null);
  }

  removeAbility(abilityId: string): boolean {
    const target = this.actionState.findIndex(
      (action) => action?.type === 'ability' && action.id === abilityId,
    );
    if (target === -1) return false;
    this.actionState = clearHotbarSlot(this.actionState, target);
    this.saveActions();
    return true;
  }

  resetActiveBar(): void {
    this.actionState = buildDefaultFormBar(
      this.formKitAbilityIds(this.activeFormState),
      ACTION_BAR_ABILITY_SLOTS,
    );
    this.knownAbilityIdsAtLastSync = new Set(this.deps.knownAbilityIds());
    this.markFormBarSeeded();
    this.saveActions();
  }

  formKitAbilityIds(form: HotbarForm): string[] {
    return this.deps.knownAbilityIds().filter((id) => this.shouldAutoPlaceOnForm(id, form));
  }

  classHasFormBars(): boolean {
    return playerClassHasFormBars(this.deps.playerClass);
  }

  isHotbarItemId(itemId: string): boolean {
    const item = ITEMS[itemId];
    return (
      item?.kind === 'food' ||
      item?.kind === 'drink' ||
      item?.kind === 'potion' ||
      item?.use?.type === 'fishing'
    );
  }

  isAssignableAction(action: Exclude<HotbarAction, null>): boolean {
    if (action.type === 'item') return this.isHotbarItemId(action.id);
    return (
      this.deps.knownAbilityIds().includes(action.id) && this.isAbilityPlacementAllowed(action.id)
    );
  }

  isAttackSlotFixed(): boolean {
    return this.deps.showAttackButton();
  }

  actionForSlot(barSlot: number): HotbarAction {
    if (barSlot === 0) {
      return actionForAttackSlot(this.isAttackSlotFixed(), this.attackActionState);
    }
    return this.actionState[barSlot - 1] ?? null;
  }

  saveActions(): void {
    try {
      this.deps.storage.setItem(this.slotMapKey(), JSON.stringify(this.actionState));
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  saveAttackAction(): void {
    try {
      writeAttackSlotAction(
        this.deps.storage,
        attackSlotStorageKey(this.slotMapKey()),
        this.attackActionState,
      );
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private slotMapKey(form: HotbarForm = this.activeFormState): string {
    const base = `woc_hotbar_${this.deps.playerClass}_${this.deps.playerName}`;
    return form === 'normal' ? base : `${base}_${form}`;
  }

  private shouldAutoPlaceOnForm(id: string, form: HotbarForm): boolean {
    // Passives never castable: keep them off every seeded/form kit bar too.
    if (!this.isAbilityPlacementAllowed(id)) return false;
    if (form === 'sport') return !!SPORT_ABILITIES[id];
    if (SPORT_ABILITIES[id]) return false;
    if (this.isStealthForm(form)) return false;
    if (form === 'bear' || form === 'cat') {
      return ABILITIES[id]?.requiresForm === form || FORM_TOGGLE_IDS.has(id);
    }
    return !ABILITIES[id]?.requiresForm;
  }

  private isFormKitBar(form: HotbarForm = this.activeFormState): boolean {
    return this.deps.playerClass === 'druid' && (form === 'bear' || form === 'cat');
  }

  private isStealthForm(form: HotbarForm = this.activeFormState): boolean {
    return form === 'stealth' || form === 'cat_stealth';
  }

  private abilityDef(id: string) {
    return ABILITIES[id] ?? SPORT_ABILITIES[id];
  }

  private isAbilityPlacementAllowed(id: string): boolean {
    const ability = this.abilityDef(id);
    // Direct setter compatibility for host-provided known ids that are not in the
    // static client table; every real AbilityDef still follows the passive rule.
    return ability === undefined || isAbilityActionBarEligible(ability);
  }

  private isStoredAbilityEligible(id: string): boolean {
    return isAbilityActionBarEligible(this.abilityDef(id));
  }

  private formBarSeededKey(form: HotbarForm = this.activeFormState): string {
    return `${this.slotMapKey(form)}_seeded`;
  }

  private markFormBarSeeded(form: HotbarForm = this.activeFormState): void {
    try {
      this.deps.storage.setItem(this.formBarSeededKey(form), '1');
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private stealthBarInitializedKey(form: HotbarForm = this.activeFormState): string {
    return `${this.slotMapKey(form)}_blank_v1`;
  }

  private loadStealthActions(
    parsed: HotbarAction[],
    stored: boolean,
    storedRaw: string | null,
  ): void {
    let initialized = false;
    try {
      initialized = this.deps.storage.getItem(this.stealthBarInitializedKey()) === '1';
    } catch {
      // Storage can be unavailable in private browsing modes.
    }

    let actions = parsed;
    let shouldPersist = !stored;
    if (!initialized) {
      const parentForm: HotbarForm = this.activeFormState === 'cat_stealth' ? 'cat' : 'normal';
      let parentStoredRaw: string | null = null;
      try {
        parentStoredRaw = this.deps.storage.getItem(this.slotMapKey(parentForm));
      } catch {
        // Storage can be unavailable in private browsing modes.
      }
      if (!stored || (storedRaw !== null && storedRaw === parentStoredRaw)) {
        actions = Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, () => null);
        shouldPersist = true;
      }
    }

    this.loadedFromStorage = true;
    this.actionState = actions;
    this.knownAbilityIdsAtLastSync = null;
    try {
      if (shouldPersist) this.deps.storage.setItem(this.slotMapKey(), JSON.stringify(actions));
      if (!initialized) this.deps.storage.setItem(this.stealthBarInitializedKey(), '1');
    } catch {
      // Persisting the page must succeed before its migration marker is written.
    }
  }

  private seedFormBarIfNeeded(parsed: HotbarAction[]): boolean {
    let alreadySeeded = false;
    try {
      alreadySeeded = this.deps.storage.getItem(this.formBarSeededKey()) === '1';
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    if (alreadySeeded) return false;

    let normalRaw: unknown = null;
    try {
      normalRaw = JSON.parse(this.deps.storage.getItem(this.slotMapKey('normal')) ?? 'null');
    } catch {
      // Corrupt state is treated as an empty bar.
    }
    const normalActions = parseHotbarActions(
      normalRaw,
      ACTION_BAR_ABILITY_SLOTS,
      (id) => !!ABILITIES[id] || !!SPORT_ABILITIES[id],
      (id) => this.isHotbarItemId(id),
    );

    this.markFormBarSeeded();
    if (!shouldSeedFormBar(parsed, normalActions, false)) return false;

    this.actionState = buildDefaultFormBar(
      this.formKitAbilityIds(this.activeFormState),
      ACTION_BAR_ABILITY_SLOTS,
    );
    this.loadedFromStorage = true;
    this.knownAbilityIdsAtLastSync = null;
    this.saveActions();
    return true;
  }

  private loadActions(): void {
    let raw: unknown = null;
    let stored = false;
    let storedRaw: string | null = null;
    try {
      storedRaw = this.deps.storage.getItem(this.slotMapKey());
      raw = JSON.parse(storedRaw ?? 'null');
      stored = Array.isArray(raw);
    } catch {
      // Corrupt state is treated as an empty bar.
    }
    const parsed = parseHotbarActions(
      raw,
      ACTION_BAR_ABILITY_SLOTS,
      (id) => this.isStoredAbilityEligible(id),
      (id) => this.isHotbarItemId(id),
    );
    if (stored && storedHotbarHasIneligibleAbility(raw, (id) => this.isStoredAbilityEligible(id))) {
      try {
        this.deps.storage.setItem(this.slotMapKey(), JSON.stringify(parsed));
      } catch {
        // Storage can be unavailable in private browsing modes.
      }
    }
    if (this.activeFormState === 'sport') {
      if (parsed.every((action) => action === null)) {
        this.actionState = buildDefaultFormBar(
          this.formKitAbilityIds('sport'),
          ACTION_BAR_ABILITY_SLOTS,
        );
        this.loadedFromStorage = true;
        this.knownAbilityIdsAtLastSync = null;
        return;
      }
      this.loadedFromStorage = stored;
      this.actionState = parsed;
      this.knownAbilityIdsAtLastSync = null;
      return;
    }
    if (this.isStealthForm()) {
      this.loadStealthActions(parsed, stored, storedRaw);
      return;
    }
    if (this.isFormKitBar()) {
      if (this.seedFormBarIfNeeded(parsed)) return;
      this.loadedFromStorage = stored;
      this.actionState = parsed;
      this.knownAbilityIdsAtLastSync = null;
      return;
    }
    this.loadedFromStorage = stored;
    this.actionState = parsed;
    this.knownAbilityIdsAtLastSync = null;
  }

  private formToggleAbilityId(): string | null {
    if (this.activeFormState === 'bear') return 'bear_form';
    if (this.activeFormState === 'cat') return 'cat_form';
    return null;
  }

  private loadAttackAction(): void {
    const key = attackSlotStorageKey(this.slotMapKey());
    let storedRaw: string | null = null;
    try {
      storedRaw = this.deps.storage.getItem(key);
      this.attackActionState = readAttackSlotAction(
        this.deps.storage,
        key,
        (id) => this.deps.knownAbilityIds().includes(id) && this.isAbilityPlacementAllowed(id),
        (id) => this.isHotbarItemId(id),
      );
      if (storedRaw !== null && this.attackActionState === null) this.deps.storage.removeItem(key);
    } catch {
      this.attackActionState = null;
    }
  }
}
