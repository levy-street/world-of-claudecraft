export type HotbarAction = { type: 'ability'; id: string } | { type: 'item'; id: string } | null;

export const HOTBAR_ACTION_MIME = 'application/x-woc-hotbar-action';

export function encodeHotbarAction(action: Exclude<HotbarAction, null>): string {
  return JSON.stringify(action);
}

export function parseHotbarAction(
  value: unknown,
  abilityExists: (id: string) => boolean,
  itemExists: (id: string) => boolean,
): Exclude<HotbarAction, null> | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as { type?: unknown; id?: unknown };
  if (typeof action.id !== 'string') return null;
  if (action.type === 'ability' && abilityExists(action.id))
    return { type: 'ability', id: action.id };
  if (action.type === 'item' && itemExists(action.id)) return { type: 'item', id: action.id };
  return null;
}

export function parseHotbarActions(
  value: unknown,
  slots: number,
  abilityExists: (id: string) => boolean,
  itemExists: (id: string) => boolean,
): HotbarAction[] {
  const seenAbilities = new Set<string>();
  return Array.from({ length: slots }, (_, i) => {
    const raw = Array.isArray(value) ? value[i] : null;
    const action =
      typeof raw === 'string'
        ? abilityExists(raw)
          ? { type: 'ability' as const, id: raw }
          : null
        : parseHotbarAction(raw, abilityExists, itemExists);
    if (action?.type === 'ability') {
      if (seenAbilities.has(action.id)) return null;
      seenAbilities.add(action.id);
    }
    return action;
  });
}

export function placeAbilityOnSlot(
  actions: readonly HotbarAction[],
  abilityId: string,
  targetIndex: number,
): HotbarAction[] {
  const next = actions.slice();
  if (targetIndex < 0 || targetIndex >= next.length) return next;
  const sourceIndex = next.findIndex(
    (action) => action?.type === 'ability' && action.id === abilityId,
  );
  if (sourceIndex === targetIndex) return next;
  if (sourceIndex !== -1) {
    [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
    return next;
  }
  next[targetIndex] = { type: 'ability', id: abilityId };
  return next;
}

export function clearHotbarSlot(
  actions: readonly HotbarAction[],
  targetIndex: number,
): HotbarAction[] {
  if (targetIndex < 0 || targetIndex >= actions.length) return [...actions];
  return actions.map((action, index) => (index === targetIndex ? null : action));
}

export function placeItemOnSlot(
  actions: readonly HotbarAction[],
  itemId: string,
  targetIndex: number,
): HotbarAction[] {
  const next = actions.slice();
  if (targetIndex < 0 || targetIndex >= next.length) return next;
  next[targetIndex] = { type: 'item', id: itemId };
  return next;
}

// Given a completed touch drag (mobile long-press pick-up + drag-to-slot), decide
// whether it resolves to a swap. `targetIndex` is null when the pointer released
// outside any slot (cancel); releasing back on the source slot is also a no-op
// cancel, not a swap-with-itself. Pure so hud.ts's pointer-event finish handler
// stays a thin call site instead of inlining this branch.
export function resolveMobileHotbarDrop(
  sourceIndex: number,
  targetIndex: number | null,
): number | null {
  if (targetIndex === null || targetIndex === sourceIndex) return null;
  return targetIndex;
}

export function swapHotbarSlots(
  actions: readonly HotbarAction[],
  sourceIndex: number,
  targetIndex: number,
): HotbarAction[] {
  const next = actions.slice();
  if (
    sourceIndex < 0 ||
    sourceIndex >= next.length ||
    targetIndex < 0 ||
    targetIndex >= next.length ||
    sourceIndex === targetIndex
  )
    return next;
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
  return next;
}

// Build a default bar layout from an ordered list of ability ids: place them
// from the first slot, dropping duplicates and any overflow past `slots`, then
// pad to `slots` with empty slots. Used to seed/reset a form's action bar.
export function buildDefaultFormBar(
  kitAbilityIds: readonly string[],
  slots: number,
): HotbarAction[] {
  const next: HotbarAction[] = Array.from({ length: slots }, () => null);
  const seen = new Set<string>();
  let i = 0;
  for (const id of kitAbilityIds) {
    if (i >= slots) break;
    if (seen.has(id)) continue;
    seen.add(id);
    next[i++] = { type: 'ability', id };
  }
  return next;
}

// Slot-by-slot value equality of two layouts (used to detect a form bar that is
// just an un-customized clone of the caster bar).
export function hotbarActionsEqual(
  a: readonly HotbarAction[],
  b: readonly HotbarAction[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((action, i) => {
    const other = b[i];
    if (action === null || other === null) return action === other;
    return action.type === other.type && action.id === other.id;
  });
}

// Whether a class has per-form action bars at all (today: druid bear/cat). The
// single source of truth for gating form-bar-only UI (e.g. the spellbook "Reset
// bar" button) so it never leaks onto single-bar classes.
export function classHasFormBars(playerClass: string): boolean {
  return playerClass === 'druid';
}

// Decide whether a druid form bar should be (re)seeded with its form kit. Seeds
// once (when not yet marked) if the bar is empty or a byte-identical clone of the
// caster bar (the legacy auto-clone), but never touches a deliberately
// customized bar or a bar already processed by this migration.
export function shouldSeedFormBar(
  parsedForm: readonly HotbarAction[],
  parsedNormal: readonly HotbarAction[],
  alreadySeeded: boolean,
): boolean {
  if (alreadySeeded) return false;
  if (parsedForm.every((action) => action === null)) return true;
  return hotbarActionsEqual(parsedForm, parsedNormal);
}

export function syncHotbarActions(
  actions: readonly HotbarAction[],
  knownAbilityIds: readonly string[],
  autoPlaceAbilityIds: ReadonlySet<string>,
): { actions: HotbarAction[]; changed: boolean } {
  const known = new Set(knownAbilityIds);
  const next = actions.map((action) =>
    action?.type === 'ability' && !known.has(action.id) ? null : action,
  );
  let changed = next.some((action, i) => action !== actions[i]);
  for (const id of knownAbilityIds) {
    if (next.some((action) => action?.type === 'ability' && action.id === id)) continue;
    if (!autoPlaceAbilityIds.has(id)) continue;
    const empty = next.indexOf(null);
    if (empty === -1) continue;
    next[empty] = { type: 'ability', id };
    changed = true;
  }
  return { actions: next, changed };
}
