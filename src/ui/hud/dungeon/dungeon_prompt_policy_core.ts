// Which dungeon prompt may show, and which one holds the shared slot over the
// action bar: the pure, DOM-free policy the composer (dungeon_prompts.ts)
// consumes. Two decisions live here.
//
// 1. The player's "Dungeon mechanic hints" setting (settings.showDungeonHints).
//    It governs the ADVISORY prompts only: the encounter alerts whose panel is
//    text explaining a mechanic (the Sunken Bastion's crown alert, the
//    Wildheart Basin's, the Gravewyrm Sanctum's, the Hollow Crypt's, the
//    Drowned Temple's (soft readouts included) and the Smith's Heart's Hammer
//    Council's). None of them takes a press. The ACTION prompts are
//    never governed by it: the Iron Cage escape (the panel IS the escape
//    button), Gaoler Ossick's chain alert (a live gauge the player steers by:
//    the links left on the anchor and the shackle's reach used, with the
//    distance), the Smith's Heart's Guardian of the Quench cold bar (the
//    player's own gauge, steered by the whole fight), its Guardian of the
//    Heat's heat gauge (the raid's shared gauge and the player's own burn),
//    and the use prompt (the
//    panel is the interact press on a brazier or a candle).
//    It is a player-chosen interface preference, never a graphics-tier knob:
//    this module takes the setting's own boolean and reads no preset, effects
//    profile or governor (tests/dungeon_hints_setting.test.ts pins that).
//
// 2. The slot. The prompts share one slot, so the use prompt gives way to
//    every prompt above it that is SHOWING, except a soft Crypt readout and a
//    soft Wildheart alert (the ones that say "pull the spear"), which give the
//    slot to the use prompt instead. An advisory alert the setting hides is
//    not showing, so it never holds the slot: with the hints off the use
//    prompt takes the slot exactly as it does when no alert is up.

/** Every prompt DungeonPrompts composes, in slot order (the use prompt last). */
export type DungeonPromptId =
  | 'cage'
  | 'chain'
  | 'bastion'
  | 'wildheart'
  | 'sanctum'
  | 'crypt'
  | 'council'
  | 'quench'
  | 'heat'
  | 'temple'
  | 'kitUse';

/** Whether a prompt is ADVISORY (the hints setting governs it). A Record over
 *  the whole id union, so a new prompt cannot be added without classifying it. */
export const DUNGEON_PROMPT_ADVISORY: Readonly<Record<DungeonPromptId, boolean>> = {
  cage: false,
  chain: false,
  bastion: true,
  wildheart: true,
  sanctum: true,
  crypt: true,
  council: true,
  quench: false,
  heat: false,
  temple: true,
  kitUse: false,
};

/** Whether `id` may show under the hints setting: an action prompt always, an
 *  advisory alert only while the hints are on. */
export function dungeonPromptEnabled(id: DungeonPromptId, mechanicHints: boolean): boolean {
  return mechanicHints || !DUNGEON_PROMPT_ADVISORY[id];
}

/** The prompts above the use prompt, as painted this frame (a prompt the
 *  setting hides is false here). */
export interface DungeonPromptSlotState {
  cage: boolean;
  chain: boolean;
  bastion: boolean;
  wildheart: boolean;
  sanctum: boolean;
  crypt: boolean;
  /** The Smith's Heart's Hammer Council alert. */
  council: boolean;
  /** The Smith's Heart's Guardian of the Quench cold bar. */
  quench: boolean;
  /** The Smith's Heart's Guardian of the Heat heat gauge. */
  heat: boolean;
  temple: boolean;
  /** The showing Crypt alert is a SOFT readout (ignored while crypt is false). */
  cryptSoft: boolean;
  /** The showing Wildheart alert is a SOFT one (ignored while wildheart is
   *  false): it points at a Hunting Spear the use prompt can offer. */
  wildheartSoft: boolean;
}

/** Whether a prompt above the use prompt holds the shared slot (the use prompt
 *  is then not built). A soft Crypt readout or Wildheart alert does not hold it. */
export function usePromptYields(s: DungeonPromptSlotState): boolean {
  return (
    s.cage ||
    s.chain ||
    s.bastion ||
    (s.wildheart && !s.wildheartSoft) ||
    s.sanctum ||
    (s.crypt && !s.cryptSoft) ||
    s.temple ||
    s.council ||
    s.quench ||
    s.heat
  );
}
