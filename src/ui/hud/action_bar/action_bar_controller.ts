import { ABILITIES, ITEMS } from '../../../sim/data';
import type { PlayerClass } from '../../../sim/types';
import {
  ACTION_BAR_LAYOUT_LEGACY_PROFILE,
  type ActionBarLayout,
  type ActionBarLayoutProfile,
  type ActionBarLayoutRestore,
  actionBarLayoutIsEmpty,
} from '../../../world_api/action_bar';
import { knownItemDef } from '../../known_item';
import { isStanceBarAbilityGroup } from '../../stance_bar_view';
import { ACTION_BAR_ABILITY_SLOTS } from './action_bar_layout_core';
import {
  actionBarFormSeededKey,
  actionBarSlotMapKey,
  actionBarStealthInitializedKey,
  applyActionBarLayout,
  captureActionBarLayout,
  planActionBarRestore,
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

export type HotbarForm = 'normal' | 'bear' | 'cat' | 'cat_stealth' | 'stealth';

const FORM_TOGGLE_IDS = new Set(['bear_form', 'cat_form', 'travel_form']);

export interface ActionBarControllerDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  playerClass: PlayerClass;
  playerName: string;
  playerLevel(): number;
  talentSpec(): string | null;
  knownAbilityIds(): readonly string[];
  hasAura(kind: string): boolean;
  showAttackButton(): boolean;
  // The input-surface profile this controller arranges (the desktop keyboard
  // row or the touch ring), read LIVE like every sibling dep because the
  // Interface Mode setting can flip the surface mid-session (syncProfile follows
  // it). It scopes every localStorage key and every upload, so a phone's
  // arrangement never overwrites a PC's. Absent means the legacy (desktop) keys,
  // which is what every pre-profile device already holds.
  profile?(): ActionBarLayoutProfile;
  // The persistence seam: called after a user-driven layout change (never during
  // initial load) with the profile and its FULL captured layout. Offline it is a
  // no-op (localStorage is the store); online the ClientWorld debounces a wire
  // save. Optional so an offline/test controller with no server persistence just
  // skips it and keeps its byte-identical localStorage behavior.
  persistLayout?(profile: ActionBarLayoutProfile, layout: ActionBarLayout): void;
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
  // The profile whose keys are loaded; every key and upload uses it, and
  // syncProfile moves it when the live surface changes.
  private activeProfile: ActionBarLayoutProfile;
  // The world-entry restore signal, kept so a profile activated for the first
  // time mid-session reconciles against the same login document.
  private loginRestore: ActionBarLayoutRestore | null = null;
  // Profiles already reconciled with the login document this session. The
  // FIRST activation of a profile reconciles it (its server copy as of login
  // beats stale local keys from an older session); later activations keep local
  // precedence, since only this device edits the character during the session.
  private readonly reconciledProfiles = new Set<ActionBarLayoutProfile>();
  // True while the in-memory bar or attack slot differs from storage (a
  // replace* call not yet followed by a save). A surface switch uploads the
  // outgoing profile only then, so an untouched fallback never becomes a server
  // profile of its own (every ordinary edit already uploaded when it saved).
  private unsavedChanges = false;

  constructor(private readonly deps: ActionBarControllerDeps) {
    this.activeProfile = this.resolveProfile();
  }

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
    this.unsavedChanges = false;
    this.ready = true;
  }

  /** World-entry reconciliation of this profile's local mirror with the server
   *  restore signal (planActionBarRestore owns the rule). A server copy or a
   *  fallback seed is written into the mirror and the bars re-seed from it;
   *  a first server copy is uploaded through the persistence seam. Returns true
   *  when the bars were re-seeded, so the caller can refresh any slot views. */
  restoreLayout(restore: ActionBarLayoutRestore): boolean {
    this.loginRestore = restore;
    this.reconciledProfiles.add(this.profile);
    if (!this.reconcile(this.profile, null)) return false;
    this.reload();
    return true;
  }

  /** Reconcile `profile`'s local keys with the login document
   *  (planActionBarRestore owns the rule) and write the outcome into storage.
   *  `inView` is the bar the player is looking at during a surface flip: a
   *  fallback seed then copies it (it is at least as new as the login copy of
   *  that profile) and is never uploaded, since a flip is not an edit. Returns
   *  true when the keys were written, so the caller reloads the bars. */
  private reconcile(profile: ActionBarLayoutProfile, inView: ActionBarLayout | null): boolean {
    const plan = planActionBarRestore(this.loginRestore ?? undefined, profile, (target) =>
      this.captureLayout(target),
    );
    if (plan.action === 'none') {
      // No server copy, no local keys, no legacy seed: the profile would load
      // empty and the next ability sync would generate defaults. On a surface
      // flip the bar in view is still the right seed (a phone-first character
      // reaching a keyboard for the first time), so copy it, never uploaded.
      if (inView === null || actionBarLayoutIsEmpty(inView)) return false;
      if (!actionBarLayoutIsEmpty(this.captureLayout(profile))) return false;
      applyActionBarLayout(
        this.deps.storage,
        this.deps.playerClass,
        this.deps.playerName,
        profile,
        inView,
      );
      return true;
    }
    if (plan.action === 'seed-local') {
      // persist() re-captures the same keys the plan just read, so it uploads
      // exactly plan.layout under this profile.
      this.persist();
      return false;
    }
    const fromView =
      plan.action === 'seed-profile' && inView !== null && !actionBarLayoutIsEmpty(inView);
    applyActionBarLayout(
      this.deps.storage,
      this.deps.playerClass,
      this.deps.playerName,
      profile,
      fromView ? inView : plan.layout,
    );
    if (plan.action === 'seed-profile' && plan.upload && !fromView) this.persist();
    return true;
  }

  get profile(): ActionBarLayoutProfile {
    return this.activeProfile;
  }

  /** Per-frame: follow a mid-session surface flip (the Interface Mode setting)
   *  onto that profile's keys. The outgoing profile is written to storage first
   *  (and uploaded only if it holds unsaved in-memory changes). The first
   *  activation of a profile this session reconciles it with the login
   *  document: its server copy as of login wins, else it starts as a copy of
   *  the bar in view, never uploaded (the "follow until edited" rule). Later
   *  activations reload the profile's own keys. Returns true on a switch. */
  syncProfile(): boolean {
    const next = this.resolveProfile();
    if (next === this.activeProfile) return false;
    // Flush the outgoing profile to storage, as a form swap does, so an
    // in-memory bar (a loadout swap resolved this frame) is never stranded.
    this.writeActions();
    this.writeAttackAction();
    if (this.unsavedChanges) {
      this.persist();
      this.unsavedChanges = false;
    }
    const previous = this.activeProfile;
    this.activeProfile = next;
    if (!this.reconciledProfiles.has(next)) {
      this.reconciledProfiles.add(next);
      this.reconcile(next, this.captureLayout(previous));
    }
    this.reload();
    return true;
  }

  private resolveProfile(): ActionBarLayoutProfile {
    return this.deps.profile?.() ?? ACTION_BAR_LAYOUT_LEGACY_PROFILE;
  }

  private captureLayout(profile: ActionBarLayoutProfile): ActionBarLayout {
    return captureActionBarLayout(
      this.deps.storage,
      this.deps.playerClass,
      this.deps.playerName,
      profile,
    );
  }

  private persist(): void {
    if (!this.ready || !this.deps.persistLayout) return;
    this.deps.persistLayout(this.profile, this.captureLayout(this.profile));
  }

  get activeForm(): HotbarForm {
    return this.activeFormState;
  }

  get actions(): HotbarAction[] {
    return this.actionState;
  }

  replaceActions(actions: HotbarAction[]): void {
    this.actionState = sanitizeHotbarActions(actions, (id) => this.isAbilityPlacementAllowed(id));
    this.unsavedChanges = true;
  }

  replaceActionsForLoadout(
    actions: HotbarAction[],
    targetKnownAbilityIds: ReadonlySet<string>,
  ): void {
    this.actionState = sanitizeHotbarActions(actions, (id) => this.isAbilityPlacementAllowed(id));
    this.unsavedChanges = true;
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
    this.unsavedChanges = true;
  }

  resolveActiveForm(): HotbarForm {
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
    this.writeActions();
    this.persist();
    this.unsavedChanges = false;
  }

  saveAttackAction(): void {
    this.writeAttackAction();
    this.persist();
    this.unsavedChanges = false;
  }

  private writeActions(): void {
    try {
      this.deps.storage.setItem(this.slotMapKey(), JSON.stringify(this.actionState));
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private writeAttackAction(): void {
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
    return actionBarSlotMapKey(this.deps.playerClass, this.deps.playerName, this.profile, form);
  }

  private shouldAutoPlaceOnForm(id: string, form: HotbarForm): boolean {
    // Passives never castable: keep them off every seeded/form kit bar too.
    if (!this.isAbilityPlacementAllowed(id)) return false;
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
    return ABILITIES[id];
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

  private isAttackSlotStoredAbilityEligible(id: string): boolean {
    const ability = this.abilityDef(id);
    if (ability === undefined) return this.deps.knownAbilityIds().includes(id);
    return isAbilityActionBarEligible(ability);
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
      (id) => !!ABILITIES[id],
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
      // The freed attack slot is not scoped to any one build (unlike the 33
      // configurable slots, a SavedLoadout never captures it), so its
      // eligibility check must not require the ability to be granted by the
      // CURRENTLY active build: only that it is a real, placeable ability.
      // Requiring current-known-ness here (like isAssignableAction's strict
      // placement gate) meant switching to a build that does not grant the
      // assigned ability read the stored value back as garbage and deleted
      // it outright, so switching back to the granting build could never
      // restore it. Unknown host-provided ids are still allowed only when the
      // current host says they are known; stale/corrupt unknown ids are dropped.
      this.attackActionState = readAttackSlotAction(
        this.deps.storage,
        key,
        (id) => this.isAttackSlotStoredAbilityEligible(id),
        (id) => this.keepsStoredItemId(id),
      );
      if (storedRaw !== null && this.attackActionState === null) this.deps.storage.removeItem(key);
    } catch {
      this.attackActionState = null;
    }
  }
}
