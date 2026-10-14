// The authored-map (Studio) world hooks the game client installs on the HUD:
// the Deepglass steward's passage, the marshal's fixture rows, Baldemar's
// portal gate and the arena's control hint keys. Moved out of main.ts's
// startGame (main.ts is a firewall, root CLAUDE.md): the client keeps one
// install call plus the per-frame tick this returns.
//
// Every hook here is reached only from a gossip row on an authored-map NPC
// (the steward, the marshal, a self of Baldemar), so the built-in world never
// runs any of it; the tick is a no-op until a gate is being cast.

import { isPortalWizardTemplate } from '../render/characters/npc_looks';
import { retirePageAndReplace } from '../render/context_release';
import type { WizardGate } from '../render/wizard_gate';
import { DEEPGLASS_DEFAULT_PER_SIDE, startDeepglassMatch } from '../sim/deepglass/match';
import { DEEPGLASS_MAP_ENTRY } from '../sim/deepglass/world';
import { DEEPGLASS_PORTAL_WIZARD_NPC_ID } from '../sim/portal_wizard';
import type { Sim } from '../sim/sim';
import { setDeepglassHintKeys } from '../ui/deepglass_hud';
import type { StudioGossipHooks } from '../ui/hud/quest/studio_gossip_hooks';
import { t } from '../ui/i18n';
import type { IWorld } from '../world_api';
import { type Keybinds, keyLabel } from './keybinds';
import { deepglassTravelUrl, overworldTravelUrl, writePortalHandoff } from './portal_travel';
import {
  beginPortalCast,
  PORTAL_CAST_SECONDS,
  type PortalState,
  portalSpotBeside,
  shouldEnterPortal,
  tickPortal,
} from './portal_travel_core';
import { sfx } from './sfx';
import { portalArrivalOrigin } from './studio_boot';

/** The looping hum id of Baldemar's open gate (sfx.loop cross-fade key). */
export const WIZARD_PORTAL_LOOP_ID = 'wizard-portal';

export interface StudioWorldHookDeps {
  hud: {
    studioGossip: StudioGossipHooks;
    closeQuestDialog(): void;
    log(text: string): void;
  };
  world: IWorld;
  offlineSim: Sim | null;
  /** Read at call time: the renderer is the coordinator's, never captured. */
  renderer(): Pick<WizardGate, 'playWizardCast' | 'openWizardPortal' | 'closeWizardPortal'>;
  keybinds: Keybinds;
  setGameInputReady(ready: boolean): void;
  showLoadingScreen(text: string): void;
  nextPaint(): Promise<void>;
}

/** Install the authored-map gossip hooks; returns the per-frame portal tick. */
export function installStudioWorldHooks(deps: StudioWorldHookDeps): (dt: number) => void {
  const { hud, world, offlineSim, keybinds } = deps;
  // The steward's passage. The Deepglass is its own world rather than a corner
  // of this one, so "teleport me there" is a world BOOT: hand the arena slug and
  // a bout size to the same ?map= path the dev URL uses, and the arrival hook
  // below calls the whistle as soon as the player is in the water.
  hud.studioGossip.travelToDeepglass = () => {
    // No range check here: the row only exists inside HER open dialog, and
    // opening a dialog already required standing next to her.
    hud.closeQuestDialog();
    const url = new URL(window.location.href);
    url.searchParams.set('map', DEEPGLASS_MAP_ENTRY.slug);
    url.searchParams.set('bout', String(DEEPGLASS_DEFAULT_PER_SIDE));
    // retirePageAndReplace, not location.assign: the departing overworld
    // document is huge, and a plain assign leaves it bfcache-eligible with its
    // map, decoded models and JS heap retained behind the arena.
    retirePageAndReplace(url.toString());
  };
  // Baldemar's gate (src/game/portal_travel_core.ts owns the machine; the
  // renderer owns the prop). The gossip row starts the cast; the frame loop
  // ticks it open, watches for the walk-in, and swaps the world.
  let wizardPortalState: PortalState | null = null;
  hud.studioGossip.summonWizardPortal = (npcId) => {
    hud.closeQuestDialog();
    const wizard = world.entities.get(npcId);
    if (wizard?.kind !== 'npc' || !isPortalWizardTemplate(wizard.templateId)) return;
    const dest = wizard.templateId === DEEPGLASS_PORTAL_WIZARD_NPC_ID ? 'overworld' : 'deepglass';
    // The round trip's memory: leaving a town remembers that town; leaving
    // the bell aims at wherever the outbound leg began (null = world start).
    const originStopId = dest === 'deepglass' ? wizard.templateId : portalArrivalOrigin();
    const spot = portalSpotBeside(wizard.pos.x, wizard.pos.z, wizard.facing);
    wizardPortalState = beginPortalCast(spot, dest, originStopId);
    deps.renderer().playWizardCast(npcId, PORTAL_CAST_SECONDS, spot.x, spot.z);
    sfx.playAt('cast_arcane', wizard.pos.x, wizard.pos.y, wizard.pos.z);
  };
  const beginPortalTravel = (state: PortalState): void => {
    // The curtain first, then the swap on the next paint: the walk-in must
    // read as "stepped through" rather than a frozen frame of town.
    deps.setGameInputReady(false);
    sfx.unloop(WIZARD_PORTAL_LOOP_ID);
    sfx.playAt('blink', state.spot.x, world.player.pos.y, state.spot.z);
    deps.showLoadingScreen(t('loading.world'));
    writePortalHandoff({
      v: 1,
      dest: state.dest,
      cls: world.cfg.playerClass,
      name: world.player.name,
      originStopId: state.originStopId,
    });
    void deps.nextPaint().then(() => {
      retirePageAndReplace(
        state.dest === 'deepglass'
          ? deepglassTravelUrl(window.location.href)
          : overworldTravelUrl(window.location.href),
      );
    });
  };
  const tickWizardPortal = (dt: number): void => {
    if (!wizardPortalState) return;
    const renderer = deps.renderer();
    const tick = tickPortal(wizardPortalState, dt);
    wizardPortalState = tick.state;
    if (tick.justOpened && tick.state) {
      const { spot } = tick.state;
      const y = world.player.pos.y;
      renderer.openWizardPortal(spot.x, spot.z, spot.facing);
      sfx.playAt('blink', spot.x, y, spot.z);
      // The open gate hums: the dungeon ambience bed is the one shipped
      // magical loop, quiet and close-range so it reads as the portal's own.
      sfx.loop(WIZARD_PORTAL_LOOP_ID, 'amb_dungeon', 0.5, spot.x, y, spot.z, 22, false, 3);
      hud.log(t('hudChrome.portalWizard.portalOpen'));
    }
    if (tick.expired) {
      renderer.closeWizardPortal();
      sfx.unloop(WIZARD_PORTAL_LOOP_ID);
    }
    if (
      tick.state &&
      shouldEnterPortal(tick.state, world.player.pos.x, world.player.pos.z) &&
      !world.player.dead
    ) {
      wizardPortalState = null;
      renderer.closeWizardPortal();
      beginPortalTravel(tick.state);
    }
  };
  // The marshal's fixture card. Straight into the match driver rather than
  // through `/deepglass N`: that command lives behind `ctx.devCommands`
  // (import.meta.env.DEV), so in a shipped build it does nothing at all, which
  // is exactly why the steward's row boots a URL instead of typing it. The
  // arena is offline-only (it boots through startOffline), so offlineSim is
  // always there; the guard is for the type, not for a case that happens.
  hud.studioGossip.startDeepglassBout = (perSide) => {
    hud.closeQuestDialog();
    if (offlineSim) startDeepglassMatch(offlineSim.ctx, offlineSim.playerId, perSide);
  };
  // The arena's control hint reads the player's OWN bindings through this, so
  // rebinding the burners (or the ball camera) renames the key on the strip
  // instead of leaving it advertising a default nobody is pressing.
  setDeepglassHintKeys(() => ({
    boost: keyLabel(keybinds.codeAt('boost', 0)),
    up: keyLabel(keybinds.codeAt('jump', 0)),
    down: keyLabel(keybinds.codeAt('dive', 0)),
    // The air brake is not its own action: it is "back with no forward" in the
    // flight pass, so the key to advertise is Move Backward's.
    brake: keyLabel(keybinds.codeAt('back', 0)),
  }));
  return tickWizardPortal;
}
