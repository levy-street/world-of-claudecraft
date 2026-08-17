import { SPORT_ABILITIES } from '../../../sim/content/vale_cup';
import { ABILITIES, ITEMS } from '../../../sim/data';
import type { PlayerClass } from '../../../sim/types';
import type { ActionBarLayout } from '../../../world_api/action_bar';
import { knownItemDef } from '../../known_item';
import { isStanceBarAbilityGroup } from '../../stance_bar_view';
import { ACTION_BAR_ABILITY_SLOTS } from './action_bar_layout_core';
import {
  actionBarFormSeededKey,
  actionBarSlotMapKey,
  actionBarStealthInitializedKey,
  captureActionBarLayout,
} from './action_bar_layout_sync';
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
import {
  ownedClassSpecDefaultAbilityIds,
  ownedDruidFormDefaultAbilityIds,
  shouldSeedOwnedSpecDefault,
} from './owned_class_spec_defaults';

export { ACTION_BAR_ABILITY_SLOTS } from './action_bar_layout_core';

export type HotbarForm = 'normal' | 'bear' | 'cat' | 'cat_stealth' | 'stealth' | 'sport';

const FORM_TOGGLE_IDS = new Set(['bear_form', 'cat_form', 'travel_form']);

export interface ActionBarControllerDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  playerClass: PlayerClass;
  playerName: string;
  playerLevel(): number;
  talentSpec(): string | null;
  knownAbilityIds(): readonly string[];
  hasAura(kind: string): boolean;
  isInSportMatch(): boolean;
  showAttackButton(): boolean;
  // The persistence seam: called after a user-driven layout change (never during
  // initial load) with the FULL captured layout. Offline it is a no-op
  // (localStorage is the store); online the ClientWorld debounces a wire save.
  // Optional so an offline/test controller with no server persistence just skips
  // it and keeps its byte-identical localStorage behavior.
  persistLayout?(layout: ActionBarLayout): void;
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
  private talentSpecAtLastSync: string | null | undefined;
  private playerLevelAtLastSync: number | null = null;
  private pendingLoadoutKnownAbilityIds: Set<string> | null = null;
  private attackActionState: HotbarAction = null;
  // Suppresses the persistence seam while the controller is loading/seeding from
  // storage: only user-driven changes after init should upload. Flipped true at
  // the end of init()/reload().
  private ready = false;

  constructor(private readonly deps: ActionBarControllerDeps) {}

  init(): void {
    this.loadActions();
    this.loadAttackAction();
    this.ready = true;
  }

  /** Re-seed every bar/attack slot from storage (after the server layout has
   *  overwritten the local mirror at login). Persistence stays suppressed while
   *  reloading so restoring a server copy never bounces straight back up. */
  reload(): void {
    this.ready = false;
    this.loadActions();
    this.loadAttackAction();
    this.ready = true;
  }

  private persist(): void {
    if (!this.ready || !this.deps.persistLayout) return;
    this.deps.persistLayout(
      captureActionBarLayout(this.deps.storage, this.deps.playerClass, this.deps.playerName),
    );
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

  replaceActionsForLoadout(
    actions: HotbarAction[],
    targetKnownAbilityIds: ReadonlySet<string>,
  ): void {
    this.actionState = sanitizeHotbarActions(actions, (id) => this.isAbilityPlacementAllowed(id));
    this.pendingLoadoutKnownAbilityIds = new Set(targetKnownAbilityIds);
    this.knownAbilityIdsAtLastSync = new Set([
      ...this.deps.knownAbilityIds(),
      ...targetKnownAbilityIds,
    ]);
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
    const liveKnownAbilityIds = [...this.deps.knownAbilityIds()];
    if (
      this.pendingLoadoutKnownAbilityIds &&
      [...this.pendingLoadoutKnownAbilityIds].every((id) => liveKnownAbilityIds.includes(id))
    ) {
      this.pendingLoadoutKnownAbilityIds = null;
    }
    const knownAbilityIds = this.pendingLoadoutKnownAbilityIds
      ? [...new Set([...liveKnownAbilityIds, ...this.pendingLoadoutKnownAbilityIds])]
      : liveKnownAbilityIds;
    const talentSpec = this.deps.talentSpec();
    const playerLevel = this.deps.playerLevel();
    if (this.trySeedOwnedSpecDefault(knownAbilityIds, talentSpec, playerLevel)) {
      this.knownAbilityIdsAtLastSync = new Set(knownAbilityIds);
      this.talentSpecAtLastSync = talentSpec;
      this.playerLevelAtLastSync = playerLevel;
      return;
    }
    const knownAbilityIdSet = new Set(knownAbilityIds);
    const autoPlaceAbilityIds = new Set<string>();
    const consider = (id: string): void => {
      // A passive (Measured Fury) is known but never castable, so it never
      // auto-places on the action bar (a manual drag would be a dead slot too).
      if (!this.isAbilityPlacementAllowed(id)) return;
      // Warrior stances and Paladin auras live on the dedicated #stancebar,
      // never the action bar, so learning one must not consume an action slot.
      if (isStanceBarAbilityGroup(ABILITIES[id]?.exclusiveGroup)) return;
      if (this.shouldAutoPlaceOnForm(id, this.activeFormState)) autoPlaceAbilityIds.add(id);
    };
    if (this.knownAbilityIdsAtLastSync === null) {
      const loadedWarlockBarNeedsOverhaulRepair =
        this.loadedFromStorage &&
        this.deps.playerClass === 'warlock' &&
        this.actionState.some(
          (action) =>
            action?.type === 'ability' &&
            ABILITIES[action.id]?.class === 'warlock' &&
            !knownAbilityIdSet.has(action.id),
        );
      if (!this.loadedFromStorage || loadedWarlockBarNeedsOverhaulRepair) {
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
    this.knownAbilityIdsAtLastSync = knownAbilityIdSet;
    this.talentSpecAtLastSync = talentSpec;
    this.playerLevelAtLastSync = playerLevel;
  }

  private trySeedOwnedSpecDefault(
    knownAbilityIds: readonly string[],
    talentSpec: string | null,
    playerLevel: number,
  ): boolean {
    if (this.activeFormState !== 'normal') return false;
    const currentIds = ownedClassSpecDefaultAbilityIds(
      this.deps.playerClass,
      talentSpec,
      playerLevel,
      new Set(knownAbilityIds),
    );
    if (!currentIds) return false;

    const firstSync = this.talentSpecAtLastSync === undefined;
    const specChanged = !firstSync && this.talentSpecAtLastSync !== talentSpec;
    const reachedLevel20 =
      !firstSync && (this.playerLevelAtLastSync ?? playerLevel) < 20 && playerLevel >= 20;
    if (!firstSync && !specChanged && !reachedLevel20) return false;

    let previousGenerated: HotbarAction[] | null = null;
    if (!firstSync && this.knownAbilityIdsAtLastSync) {
      const previousIds = ownedClassSpecDefaultAbilityIds(
        this.deps.playerClass,
        this.talentSpecAtLastSync ?? null,
        this.playerLevelAtLastSync ?? playerLevel,
        this.knownAbilityIdsAtLastSync,
      );
      const fallbackIds = [...this.knownAbilityIdsAtLastSync].filter((id) =>
        this.shouldAutoPlaceOnForm(id, 'normal'),
      );
      previousGenerated = buildDefaultFormBar(previousIds ?? fallbackIds, ACTION_BAR_ABILITY_SLOTS);
    }
    if (!shouldSeedOwnedSpecDefault(this.actionState, previousGenerated, this.loadedFromStorage)) {
      return false;
    }

    this.actionState = buildDefaultFormBar(currentIds, ACTION_BAR_ABILITY_SLOTS);
    this.saveActions();
    return true;
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
    const knownAbilityIds = [...this.deps.knownAbilityIds()];
    const ownedSpecDefault =
      this.activeFormState === 'normal'
        ? ownedClassSpecDefaultAbilityIds(
            this.deps.playerClass,
            this.deps.talentSpec(),
            this.deps.playerLevel(),
            new Set(knownAbilityIds),
          )
        : null;
    this.actionState = buildDefaultFormBar(
      ownedSpecDefault ?? this.formKitAbilityIds(this.activeFormState),
      ACTION_BAR_ABILITY_SLOTS,
    );
    this.knownAbilityIdsAtLastSync = new Set(knownAbilityIds);
    this.markFormBarSeeded();
    this.saveActions();
  }

  formKitAbilityIds(form: HotbarForm): string[] {
    const known = this.deps.knownAbilityIds();
    const curated = ownedDruidFormDefaultAbilityIds(this.deps.playerClass, form, new Set(known));
    return curated ?? known.filter((id) => this.shouldAutoPlaceOnForm(id, form));
  }

  classHasFormBars(): boolean {
    return playerClassHasFormBars(this.deps.playerClass);
  }

  isHotbarItemId(itemId: string): boolean {
    // Gathering implements (#2343): the simple pole (use.type 'fishing') and
    // every gatherTool (picks, axes, sickles, tiered rods) are placeable, so
    // a keybound press works the tool exactly like the bags click.
    // Reins: the mounts-as-items pivot routes kind 'mount' through the same
    // useItem dispatch a potion rides (src/sim/items.ts -> summonMountItem), so
    // reins are placeable for the same reason a potion is. Without this arm the
    // bag drag never writes a hotbar payload and the bar cannot accept them.
    const item = ITEMS[itemId];
    return (
      item?.kind === 'food' ||
      item?.kind === 'drink' ||
      item?.kind === 'potion' ||
      item?.kind === 'mount' ||
      item?.use?.type === 'fishing' ||
      item?.use?.type === 'gatherTool'
    );
  }

  /**
   * The STORED-layout keep predicate (stale-client guard, R34), distinct from
   * isAssignableAction's strict placement gate: the layout is per-character
   * SERVER state and the save path is a wholesale overwrite, so an id this
   * bundle predates must ride through parse and save as an INERT slot (its
   * press arms already no-op on an unresolvable def) rather than be nulled
   * and silently destroyed for every other device. Known-but-ineligible ids
   * (a kind that stopped being placeable) keep today's strip.
   */
  keepsStoredItemId(itemId: string): boolean {
    return this.isHotbarItemId(itemId) || knownItemDef(ITEMS, itemId) === undefined;
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
    this.persist();
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
    this.persist();
  }

  private slotMapKey(form: HotbarForm = this.activeFormState): string {
    return actionBarSlotMapKey(this.deps.playerClass, this.deps.playerName, form);
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
    return actionBarFormSeededKey(this.slotMapKey(form));
  }

  private markFormBarSeeded(form: HotbarForm = this.activeFormState): void {
    try {
      this.deps.storage.setItem(this.formBarSeededKey(form), '1');
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private stealthBarInitializedKey(form: HotbarForm = this.activeFormState): string {
    return actionBarStealthInitializedKey(this.slotMapKey(form));
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
      // The stored-layout keep predicate here too: a normal bar holding an
      // unknown-id slot must still read as occupied, or the seeding decision
      // treats it as emptier than it is.
      (id) => this.keepsStoredItemId(id),
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
      (id) => this.keepsStoredItemId(id),
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
        (id) => this.keepsStoredItemId(id),
      );
      if (storedRaw !== null && this.attackActionState === null) this.deps.storage.removeItem(key);
    } catch {
      this.attackActionState = null;
    }
  }
}
