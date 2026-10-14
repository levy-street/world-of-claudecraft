import type { QuestDialogControllerDeps } from './quest_dialog_controller';

/**
 * The authored-map gossip rows the game client wires (src/game/studio_world_hooks.ts):
 * the Deepglass steward's passage, the marshal's fixture rows and Baldemar the
 * Bald's gate. None of them opens a window: each one is a world action the HUD
 * has no handle on (a world boot, a call into the offline Sim, a portal cast),
 * so the HUD only forwards the row. Unset on any world that never wires them.
 */
export interface StudioGossipHooks {
  /** The steward's passage row: main boots the arena's ?map= world. */
  travelToDeepglass?: () => void;
  /** The marshal's fixture rows: a bout of `perSide` a side, offline only. */
  startDeepglassBout?: (perSide: number) => void;
  /** Baldemar's gate row, with the wizard's entity id. */
  summonWizardPortal?: (npcId: number) => void;
}

type StudioGossipDeps = Pick<
  QuestDialogControllerDeps,
  'travelToDeepglass' | 'startDeepglassBout' | 'summonWizardPortal'
>;

/** The quest dialog's three studio-row deps, each read through `hooks` at click
 *  time so a hook wired after the dialog was built still answers. */
export function studioGossipDeps(hooks: StudioGossipHooks): StudioGossipDeps {
  return {
    travelToDeepglass: () => hooks.travelToDeepglass?.(),
    startDeepglassBout: (perSide) => hooks.startDeepglassBout?.(perSide),
    summonWizardPortal: (npcId) => hooks.summonWizardPortal?.(npcId),
  };
}
