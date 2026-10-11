// The Cooldown Manager's per-frame core: for each spell the player tracks, is it
// known, is it ready, has its button transformed (Gorebite into Redharvest), how
// much cooldown is left, and did it just become ready (the alert cue edge).
//
// It does NOT re-derive readiness. It composes the action bar's own pure core
// (createActionBarView) over a descriptor whose slots are the tracked spells, so
// cost, charges, stacks, kill windows, form pools, free-cast procs and the
// aura-driven button replacement are the exact rules the hotbar paints and the
// sim's cast gate checks. A second readiness rule here would drift the day a new
// resource or proc lands; this way it cannot.
//
// Pure and DOM-free (registered in UI_PURE_CORES). The state object, the button
// array, every button state and the cue array are allocated once per tracked-list
// change and mutated in place each tick, so a steady frame allocates nothing.

import {
  type ActionBarAbility,
  type ActionBarSlotState,
  type ActionBarView,
  type ActionBarWorldInput,
  createActionBarView,
} from '../action_bar/action_bar_view';
import type { CooldownSpellConfig } from './cooldown_manager_config';

/** One tracked spell as the painter sees it. Mutated in place every tick. */
export interface CooldownButtonState {
  /** The id the player picked (the learned base id, e.g. `gorebite`). */
  readonly baseId: string;
  /** The id the button resolves to right now (`redharvest` while armed), or
   *  null when the player does not currently know the spell. */
  abilityId: string | null;
  /** Stable icon identity (`ability:<id>`), '' when unknown: the painter
   *  re-resolves the icon only when this changes. */
  iconKey: string;
  visible: boolean;
  /** Pressable now: known, affordable, off cooldown (the GCD is ignored). */
  ready: boolean;
  /** The button currently casts a different spell than the one picked. */
  transformed: boolean;
  /** A transform or an authored class proc is lighting this spell. */
  proc: boolean;
  /** Ready AND the player asked for the ready glow. */
  glow: boolean;
  /** Ready AND the player asked for the action-bar glow on this spell. */
  hotbarGlow: boolean;
  /** Known, but cannot be afforded or used right now. */
  unusable: boolean;
  outOfRange: boolean;
  cooldownPercent: number;
  cdText: string;
  /** Charges left on a charge-pool spell, '' otherwise. */
  count: string;
}

export interface CooldownCue {
  soundId: string;
  volume: number;
}

export interface CooldownManagerState {
  buttons: CooldownButtonState[];
  /** Cues to play THIS frame. Reused: read it during the call, never retain. */
  cues: CooldownCue[];
}

export interface CooldownManagerTickOpts {
  /** False while the player muted ready sounds for this frame (the manager is
   *  off, or the in-combat-only gate is closed). Edges are still recorded, so
   *  lifting the gate never replays a stale edge. */
  soundsAllowed: boolean;
  /** Placement preview (Options > Cooldown Manager is open): every known
   *  tracked spell shows, even one set to appear only when ready. */
  preview: boolean;
}

export interface CooldownManagerViewDeps {
  /** The player's live resolved ability for a base id (IWorld.resolvedAbility:
   *  replacement, spec resolvers and talent mods folded in), or null. */
  resolve(baseId: string): ActionBarAbility | null;
  formatCount(n: number): string;
}

export interface CooldownManagerTrackedSpell {
  id: string;
  config: CooldownSpellConfig;
  /** The cue id to play on a ready edge, or null for silence. Resolved by the
   *  caller so this core never imports the cue catalog (src/game). */
  cue: string | null;
  /** Set for an AURA entry (an engine, a proc, a buff): how a live aura on the
   *  player matches it, and its precomputed icon key. Absent for a spell. */
  aura?: { match: 'id' | 'kind'; value: string; iconKey: string };
}

/** The aura fields an aura entry reads. Both worlds mirror them on the player. */
interface TrackedAuraInput {
  id?: string;
  kind: string;
  stacks?: number;
  remaining?: number;
}

/** Remaining seconds past this read as a mode, not a timer (a form, a stance). */
const AURA_TIMER_CEILING_SEC = 600;

export interface CooldownManagerView {
  /** Rebuild for a new tracked list or changed per-spell settings (cold path). */
  setTracked(spells: readonly CooldownManagerTrackedSpell[]): void;
  tick(world: ActionBarWorldInput, opts: CooldownManagerTickOpts): CooldownManagerState;
}

const MAX_PERCENT = 100;

function makeButton(baseId: string): CooldownButtonState {
  return {
    baseId,
    abilityId: null,
    iconKey: '',
    visible: false,
    ready: false,
    transformed: false,
    proc: false,
    glow: false,
    hotbarGlow: false,
    unusable: false,
    outOfRange: false,
    cooldownPercent: 0,
    cdText: '',
    count: '',
  };
}

/** Ready means the button would cast if pressed now, ignoring only the GCD. A
 *  charge-pool spell is ready while any charge is stored (the action bar folds
 *  that into `usable`); every other spell also needs its cooldown finished. */
export function cooldownSlotReady(slot: ActionBarSlotState, dead: boolean): boolean {
  if (dead || slot.kind !== 'ability') return false;
  return slot.usable && (slot.isCharges || slot.cooldownRemaining <= 0);
}

/**
 * Whether this frame's ready key announces itself. `previous` undefined means
 * the spell has never been observed (first frame after login or after picking
 * it): that frame only records, so a spell that is simply already ready never
 * chimes. After that a cue fires when the spell BECOMES ready, or when it
 * transforms into a different spell while ready (Gorebite into Redharvest). A
 * transform reverting to the base spell does not announce.
 */
export function cooldownCueFires(
  baseId: string,
  previous: string | null | undefined,
  current: string | null,
): boolean {
  if (current === null || previous === undefined || previous === current) return false;
  if (previous === null) return true;
  return current !== baseId;
}

export function createCooldownManagerView(deps: CooldownManagerViewDeps): CooldownManagerView {
  const state: CooldownManagerState = { buttons: [], cues: [] };
  let configs: CooldownSpellConfig[] = [];
  let cues: (string | null)[] = [];
  let auraRules: (CooldownManagerTrackedSpell['aura'] | undefined)[] = [];
  /** Per tracked entry: its slot in the inner action-bar view, -1 for an aura. */
  let barIndex: number[] = [];
  let bar: ActionBarView | null = null;
  // Last ready key per base id (the resolved id while ready, else null). Kept
  // across setTracked so re-ordering or re-tuning a spell never replays an edge.
  const edges = new Map<string, string | null>();
  const cuePool: CooldownCue[] = [];

  return {
    setTracked(spells) {
      const ids = new Set(spells.map((spell) => spell.id));
      for (const id of edges.keys()) if (!ids.has(id)) edges.delete(id);
      const previous = new Map(state.buttons.map((button) => [button.baseId, button] as const));
      state.buttons = spells.map((spell) => previous.get(spell.id) ?? makeButton(spell.id));
      configs = spells.map((spell) => spell.config);
      cues = spells.map((spell) => spell.cue);
      auraRules = spells.map((spell) => spell.aura);
      const spellEntries = spells.filter((spell) => !spell.aura);
      let next = 0;
      barIndex = spells.map((spell) => (spell.aura ? -1 : next++));
      bar =
        spellEntries.length === 0
          ? null
          : createActionBarView(
              {
                slots: spellEntries.map((spell, slotIndex) => ({
                  slotIndex,
                  isAttack: () => false,
                  hasAction: () => true,
                  ability: () => deps.resolve(spell.id),
                  item: () => null,
                  keybindLabel: () => '',
                })),
              },
              {
                // The buttons are aria-hidden readouts, so the bar core's per-frame
                // aria string is never shown: a constant keeps it allocation-free.
                t: () => '',
                abilityName: () => '',
                itemName: () => '',
                slotLabel: () => '',
                formatCount: deps.formatCount,
              },
            );
    },

    tick(world, opts) {
      state.cues.length = 0;
      if (state.buttons.length === 0) return state;
      const slots = bar ? bar.tick(world).slots : null;
      const dead = world.player.dead;
      const auras = world.player.auras as readonly TrackedAuraInput[];
      for (let i = 0; i < state.buttons.length; i++) {
        const button = state.buttons[i];
        const config = configs[i];
        const rule = auraRules[i];
        let current: string | null;
        if (rule) {
          current = tickAura(button, rule, config, auras, dead, opts.preview, deps.formatCount);
        } else {
          const slot = slots?.[barIndex[i]];
          if (!slot) continue;
          current = tickSpell(button, slot, config, dead, opts.preview);
        }

        // Death forgets every edge, and so does a spell the current build does
        // not know, so the first frame back only records: otherwise resurrecting,
        // or a spec swap, respec or level-up that teaches several spells already
        // off cooldown, would chime every one of them at once.
        if (dead || (!rule && button.abilityId === null)) {
          edges.delete(button.baseId);
          continue;
        }
        const previous = edges.get(button.baseId);
        edges.set(button.baseId, current);
        const cueId = cues[i];
        if (
          opts.soundsAllowed &&
          cueId !== null &&
          cooldownCueFires(button.baseId, previous, current)
        ) {
          const index = state.cues.length;
          if (index >= cuePool.length) cuePool.push({ soundId: '', volume: 0 });
          const cue = cuePool[index];
          cue.soundId = cueId;
          cue.volume = config.soundVolume;
          state.cues.push(cue);
        }
      }
      return state;
    },
  };
}

/** One SPELL entry from its action-bar slot; returns its ready key. */
function tickSpell(
  button: CooldownButtonState,
  slot: ActionBarSlotState,
  config: CooldownSpellConfig,
  dead: boolean,
  preview: boolean,
): string | null {
  const known = slot.kind === 'ability' && slot.abilityId !== null;
  const ready = known && cooldownSlotReady(slot, dead);
  const abilityId = known ? slot.abilityId : null;
  button.abilityId = abilityId;
  button.iconKey = abilityId === null ? '' : slot.iconKey;
  button.ready = ready;
  button.transformed = abilityId !== null && abilityId !== button.baseId;
  button.proc = known && (button.transformed || slot.procGlow);
  button.glow = ready && config.glowWhenReady;
  button.hotbarGlow = ready && config.hotbarGlow;
  button.unusable = known && !slot.usable;
  button.outOfRange = known && slot.outOfRange;
  // The spell's own cooldown only: the bar's sweep also runs the GCD, which
  // would paint a sweep over a button this core calls ready.
  button.cooldownPercent =
    known && slot.cooldownRemaining > 0 && slot.cooldownTotal > 0
      ? Math.min(MAX_PERCENT, (slot.cooldownRemaining / slot.cooldownTotal) * MAX_PERCENT)
      : 0;
  button.cdText = known ? slot.cdText : '';
  button.count = known && slot.isCharges ? slot.count : '';
  button.visible = known && (preview || !config.onlyWhenReady || ready);
  return ready ? abilityId : null;
}

/**
 * One AURA entry (an engine bank, a proc, a buff) from the player's live auras.
 * It is "up" (ready: lit, and the cue edge) once the aura is on the player with
 * at least `alertStacks` stacks (0 means as soon as it appears); reaching a
 * stack goal above 1 also pulses it, the way a transform does. The button shows
 * the stack count and the seconds left; an absent aura is dimmed like a spell
 * the player cannot cast. Returns its ready key.
 */
function tickAura(
  button: CooldownButtonState,
  rule: NonNullable<CooldownManagerTrackedSpell['aura']>,
  config: CooldownSpellConfig,
  auras: readonly TrackedAuraInput[],
  dead: boolean,
  preview: boolean,
  formatCount: (n: number) => string,
): string | null {
  let aura: TrackedAuraInput | undefined;
  for (const candidate of auras) {
    if (rule.match === 'id' ? candidate.id === rule.value : candidate.kind === rule.value) {
      aura = candidate;
      break;
    }
  }
  const present = aura !== undefined && !dead;
  const stacks = aura?.stacks ?? 1;
  const goal = Math.max(1, config.alertStacks);
  const ready = present && stacks >= goal;
  button.abilityId = null;
  button.iconKey = rule.iconKey;
  button.ready = ready;
  button.transformed = false;
  button.proc = ready && config.alertStacks > 1;
  button.glow = ready && config.glowWhenReady;
  button.hotbarGlow = false;
  button.unusable = !present;
  button.outOfRange = false;
  button.cooldownPercent = 0;
  const remaining = present ? (aura?.remaining ?? 0) : 0;
  button.cdText =
    remaining > 1 && remaining < AURA_TIMER_CEILING_SEC ? formatCount(Math.ceil(remaining)) : '';
  button.count = present && stacks > 1 ? formatCount(stacks) : '';
  button.visible = preview || !config.onlyWhenReady || ready;
  return ready ? button.baseId : null;
}
