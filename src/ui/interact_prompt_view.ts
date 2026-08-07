// Pure view-core for the on-screen interact prompt: the two-line hint that sits
// just above the action bars naming whatever the interact key would act on
// right now ("Marshal Redbrook" / keyboard glyph + "Talk" + the bound keycap).
//
// DOM-free, Three-free, i18n-free and game-free (the UI_PURE_CORES contract in
// tests/architecture.test.ts): it takes an already-resolved target kind + display
// name + keycap label and decides only VISIBILITY and the VERB discriminator.
// interact_prompt_painter.ts localizes that discriminator through t(), the same
// split swing_timer.ts / swing_timer_painter.ts use.
//
// Desktop only, by design: the prompt names a KEYBOARD binding, and touch play
// interacts through the on-screen action ring instead, so a phone would be told
// to press a key it has no way to press.

/** What the interact key would act on, narrowed to the cases that read
 *  differently to a player. Resolved from the shared interaction scan by
 *  src/game/interact_prompt.ts. */
export type InteractPromptTargetKind =
  | 'corpse'
  | 'delveObject'
  | 'mailbox'
  | 'dungeonDoor'
  | 'dungeonExit'
  | 'pickup'
  | 'npc'
  | 'spiritHealer'
  | 'escort'
  | 'gatherNode';

/** The action word shown beside the keycap. The painter maps each to a t() key. */
export type InteractPromptVerb =
  | 'interact'
  | 'loot'
  | 'talk'
  | 'open'
  | 'take'
  | 'gather'
  | 'enter'
  | 'leave';

export interface InteractPromptInput {
  /** The player's Show Interact Prompt toggle. */
  enabled: boolean;
  /** True on the touch interface, where the prompt never shows (see header). */
  touch: boolean;
  /** The scanned target, or null when nothing is in interact range. */
  kind: InteractPromptTargetKind | null;
  /** Localized display name of the target; an empty name suppresses the prompt. */
  name: string;
  /** Keycap label for the bound interact action ('' when it is unbound). */
  keyLabel: string;
}

export interface InteractPromptState {
  visible: boolean;
  name: string;
  verb: InteractPromptVerb;
  keyLabel: string;
  /** True when the interact action has no binding; the painter shows the
   *  "Unbound" word in place of a keycap so the prompt never implies a key
   *  that does nothing. */
  unbound: boolean;
}

const VERB_BY_KIND: Record<InteractPromptTargetKind, InteractPromptVerb> = {
  corpse: 'loot',
  // Delve interactables are levers, valves, bells, shrines and chests: one
  // generic verb covers them without inventing a word per prop.
  delveObject: 'interact',
  mailbox: 'open',
  // A dungeon door and its exit are named for the PLACE ("Shadowfen Crypt",
  // "Shadowfen Crypt Exit"), so the verb has to be the travel word: you do not
  // open a crypt.
  dungeonDoor: 'enter',
  dungeonExit: 'leave',
  pickup: 'take',
  npc: 'talk',
  // The graveyard angel is only ever scanned for a ghost, where the press asks
  // to be revived rather than to chat.
  spiritHealer: 'interact',
  escort: 'talk',
  gatherNode: 'gather',
};

/** Build a reusable, preallocated state container (allocation-light per-frame
 *  core contract: the caller keeps one and passes it back every frame). */
export function makeInteractPromptState(): InteractPromptState {
  return { visible: false, name: '', verb: 'interact', keyLabel: '', unbound: true };
}

/** Resolve the prompt for one frame into `out`, which is returned. */
export function resolveInteractPrompt(
  input: InteractPromptInput,
  out: InteractPromptState,
): InteractPromptState {
  const visible = input.enabled && !input.touch && input.kind !== null && input.name !== '';
  out.visible = visible;
  out.name = visible ? input.name : '';
  out.verb = input.kind !== null ? VERB_BY_KIND[input.kind] : 'interact';
  out.keyLabel = visible ? input.keyLabel : '';
  out.unbound = input.keyLabel === '';
  return out;
}
