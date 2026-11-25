// The dungeon encounter prompts the HUD composes as ONE member with ONE frame
// call: the Iron Cage escape (cage_escape_*), Gaoler Ossick's chain alert
// (gaol_chain_*), the Sunken Bastion's crown alert (bastion_alert_view.ts:
// Vael's scythe and Fog Veil), the Wildheart Basin's alert (wildheart_alert_view.ts on the
// shared encounter alert painter, encounter_alert_painter.ts: the Idol's
// Breath, the Prey, the Hunting Spear, the Stalk, the pollen, the sun glyphs,
// the Pack Bond readout) and the Gravewyrm Sanctum's
// (sanctum_alert_view.ts on the same family: the chains, the meltwater, the
// lake) and the Hollow Crypt's (crypt_alert_view.ts on the same family: the
// grave mark, the Frozen Embrace, the Bride's Lament, the Open Grave, the
// Burning Knell's half, Grasp of the Grave, the Reap, the Toll and Harmony
// readouts, the Rite's candles and the Bound Souls), the Drowned Temple's
// (temple_alert_view.ts on the same family: Choirmother Selthe's Score, its
// melody, its answer and her broken voice), the Smith's Heart's Guardian of
// the Quench's cold bar (quench_alert_view.ts:
// the player's own gauge, never advisory), plus the trash engine's
// use prompt (kit_use_prompt_view.ts on the same family: a Soul Brazier to kick
// over, a Remembrance Candle to relight, a Hunting Spear to pull out). It owns
// no DOM itself; it builds
// each view from the frame's inputs and hands it to that prompt's painter. The
// frame hands it the world (its entities and roster version, and the target
// command a use press needs): the prompts look bodies up by id, and the
// Sanctum, Crypt, Wildheart and Temple alerts and the use prompt keep their
// scenes off the roster (sanctum_alert_scene_core.ts, crypt_alert_scene_core.ts,
// wildheart_alert_scene_core.ts, temple_alert_scene_core.ts, KitUseSceneScan).
//
// Off the slot it paints the Smith's Heart's tank swap alert
// (tank_swap_alert_view.ts on the same family: Swap for the tank carrying a
// swap debuff at its count, its stacks; nobody else), small beside the
// target frame, on every tier and whatever the hints setting; it never holds
// the slot. Its mirror on the action bar's other side is the Live Coal chip
// (coal_alert_view.ts: its bearer's absorb left and fuse), the same rules.
//
// Beside the slot it paints the Masterless Strength's raid HUD, its phase
// readout at the top of the screen (heart_final_phase_view.ts and
// heart_final_phase_painter.ts: the switch mark and part 2's clocks; the
// Overload bars are the room's ring now), on every tier and whatever the
// hints setting.
//
// The prompts share one slot over the action bar, so the use prompt gives way
// to every encounter prompt above it (a strike to dodge or a cage to break
// outranks a brazier), except the Crypt alert's SOFT readouts (the Rite's
// candle count, a Bound Soul on its way) and the Wildheart alert's SOFT kinds
// (a Hunting Spear to pull), which give the slot to the use prompt when it
// has a body to offer (the relight prompt at a candle, the pull at a spear);
// the interact press itself still kicks the brazier
// whatever the slot shows (src/game/nearby_interaction_core.ts).
//
// The player's "Dungeon mechanic hints" setting hides the ADVISORY alerts (the
// five encounter alert family members) and nothing else; a hidden alert is not
// built and never holds the slot. Which prompt the setting governs and who
// holds the slot are both decided in dungeon_prompt_policy_core.ts.

import { BASTION_ALERT_KINDS, buildBastionAlertView } from './bastion_alert_view';
import { BreathWindBadge } from './breath_wind_painter';
import {
  type BreathWindBody,
  BreathWindScan,
  buildBreathWindView,
  makeBreathWindView,
} from './breath_wind_view';
import { type CageEscapeDeps, CageEscapePrompt } from './cage_escape_painter';
import { buildCageEscapeView } from './cage_escape_view';
import { buildCoalAlertView, COAL_ALERT_KINDS } from './coal_alert_view';
import { CryptAlertSceneScan, type CryptSceneEntity } from './crypt_alert_scene_core';
import {
  buildCryptAlertView,
  CRYPT_ALERT_KINDS,
  CRYPT_SOFT_ALERT_KINDS,
  type CryptAlertView,
} from './crypt_alert_view';
import {
  type DungeonPromptSlotState,
  dungeonPromptEnabled,
  usePromptYields,
} from './dungeon_prompt_policy_core';
import { EncounterAlert } from './encounter_alert_painter';
import { GaolChainAlert } from './gaol_chain_painter';
import { buildGaolChainView, type GaolChainEntity } from './gaol_chain_view';
import { HeartFinalPhasePanel } from './heart_final_phase_painter';
import {
  buildFinalPhaseView,
  type FinalPhaseBoss,
  HeartFinalScan,
  makeFinalPhaseView,
} from './heart_final_phase_view';
import {
  buildKitUsePromptView,
  KIT_USE_PROMPT_KINDS,
  type KitUseBody,
  KitUseSceneScan,
} from './kit_use_prompt_view';
import { buildKnotAlertView, KNOT_ALERT_KINDS } from './knot_alert_view';
import { buildQuenchAlertView, QUENCH_ALERT_KINDS } from './quench_alert_view';
import { QuenchIceBadge } from './quench_ice_painter';
import {
  buildQuenchIceView,
  makeQuenchIceView,
  type QuenchIceBody,
  QuenchIceScan,
} from './quench_ice_view';
import { SanctumAlertSceneScan, type SanctumSceneEntity } from './sanctum_alert_scene_core';
import { buildSanctumAlertView, SANCTUM_ALERT_KINDS } from './sanctum_alert_view';
import {
  buildTankSwapAlertView,
  TANK_SWAP_ALERT_KINDS,
  type TankSwapBody,
} from './tank_swap_alert_view';
import { TempleAlertSceneScan, type TempleSceneEntity } from './temple_alert_scene_core';
import { buildTempleAlertView, TEMPLE_ALERT_KINDS } from './temple_alert_view';
import { WildheartAlertSceneScan, type WildheartSceneEntity } from './wildheart_alert_scene_core';
import {
  buildWildheartAlertView,
  WILDHEART_ALERT_KINDS,
  WILDHEART_SOFT_ALERT_KINDS,
  type WildheartAlertView,
} from './wildheart_alert_view';

const KIT_USE_HIDDEN = { visible: false } as const;
/** An advisory alert the hints setting hides (never built that frame). */
const HINT_HIDDEN = { visible: false } as const;

export interface DungeonPromptsFrame {
  player: {
    id: number;
    pos: { x: number; z: number };
    /** Where the player faces (the wind badge turns to it). */
    facing?: number;
    auras: readonly {
      id: string;
      sourceId?: number;
      value2?: number;
      remaining?: number;
      duration?: number;
      stacks?: number;
      value?: number;
      value3?: number;
    }[];
    /** The player's target (an alert may read the boss being targeted). */
    targetId?: number | null;
    dead?: boolean;
    /** The player's own bar (the use prompt shows a running use's). */
    castingAbility?: string | null;
    castTargetId?: number | null;
    castRemaining?: number;
    castTotal?: number;
  };
  /** The world: every body by id, and the roster version (bumped when one
   *  comes or goes). */
  world: {
    entities: ReadonlyMap<
      number,
      GaolChainEntity &
        SanctumSceneEntity &
        CryptSceneEntity &
        WildheartSceneEntity &
        TempleSceneEntity &
        KitUseBody &
        FinalPhaseBoss &
        TankSwapBody &
        BreathWindBody &
        QuenchIceBody
    >;
    entityRosterVersion: number;
    /** Select a body (the use prompt's press targets the body, then interacts). */
    targetEntity(id: number | null): void;
  };
  party: readonly { pid: number }[] | null | undefined;
  /** The interact key's label ('' when unbound). */
  interactKey: string;
  touch: boolean;
  /** The player's "Dungeon mechanic hints" setting: false hides the advisory
   *  alerts only (dungeon_prompt_policy_core.ts), never a prompt to press. */
  mechanicHints: boolean;
}

export class DungeonPrompts {
  private readonly cage: CageEscapePrompt;
  private readonly chain: GaolChainAlert;
  private readonly bastion: EncounterAlert;
  private readonly wildheart: EncounterAlert;
  private readonly wildheartScene = new WildheartAlertSceneScan();
  private readonly sanctum: EncounterAlert;
  private readonly sanctumScene = new SanctumAlertSceneScan();
  private readonly crypt: EncounterAlert;
  private readonly quench: EncounterAlert;
  private readonly knot: EncounterAlert;
  private readonly tankSwap: EncounterAlert;
  private readonly liveCoal: EncounterAlert;
  private readonly finalPhase: HeartFinalPhasePanel;
  private readonly finalPhaseView = makeFinalPhaseView();
  private readonly finalScan = new HeartFinalScan();
  private readonly breathWind: BreathWindBadge;
  private readonly breathWindView = makeBreathWindView();
  private readonly breathWindScan = new BreathWindScan();
  private readonly quenchIce: QuenchIceBadge;
  private readonly quenchIceView = makeQuenchIceView();
  private readonly quenchIceScan = new QuenchIceScan();
  private readonly cryptScene = new CryptAlertSceneScan();
  private readonly temple: EncounterAlert;
  private readonly templeScene = new TempleAlertSceneScan();
  private readonly kitUse: EncounterAlert;
  private readonly kitUseScene = new KitUseSceneScan();
  /** The body a press on the use prompt targets (-1: none on offer). */
  private kitUseBodyId = -1;
  private world: DungeonPromptsFrame['world'] | null = null;
  /** One lookup for every view (no closure a frame). */
  private readonly entity = (id: number) => this.world?.entities.get(id);
  /** What is showing above the use prompt (one object, rewritten a frame). */
  private readonly slot: DungeonPromptSlotState = {
    cage: false,
    chain: false,
    bastion: false,
    wildheart: false,
    sanctum: false,
    crypt: false,
    quench: false,
    knot: false,
    temple: false,
    cryptSoft: false,
    wildheartSoft: false,
  };

  constructor(deps: CageEscapeDeps) {
    this.cage = new CageEscapePrompt(deps);
    this.chain = new GaolChainAlert(deps);
    this.bastion = new EncounterAlert(deps, {
      id: 'bastion-alert',
      className: 'ui-panel-strong encounter-alert bastion-alert',
      kinds: BASTION_ALERT_KINDS,
    });
    this.wildheart = new EncounterAlert(deps, {
      id: 'wildheart-alert',
      className: 'ui-panel-strong encounter-alert wildheart-alert',
      kinds: WILDHEART_ALERT_KINDS,
    });
    this.sanctum = new EncounterAlert(deps, {
      id: 'sanctum-alert',
      className: 'ui-panel-strong encounter-alert sanctum-alert',
      kinds: SANCTUM_ALERT_KINDS,
    });
    this.crypt = new EncounterAlert(deps, {
      id: 'crypt-alert',
      className: 'ui-panel-strong encounter-alert crypt-alert',
      kinds: CRYPT_ALERT_KINDS,
    });
    // The cold bar is the player's own gauge, read the whole fight: docked on
    // the player frame like a secondary resource bar (never the screen's
    // middle; the owner's rule of 2026-11-04), the HUD layer the fallback.
    this.quench = new EncounterAlert(
      { ...deps, layer: () => quenchDock(deps.layer()) },
      {
        id: 'heart-quench-alert',
        className: 'ui-panel-strong encounter-alert heart-quench-alert',
        kinds: QUENCH_ALERT_KINDS,
      },
    );
    this.knot = new EncounterAlert(deps, {
      id: 'heart-knot-alert',
      className: 'ui-panel-strong encounter-alert heart-knot-alert',
      kinds: KNOT_ALERT_KINDS,
    });
    this.tankSwap = new EncounterAlert(deps, {
      id: 'heart-tank-swap',
      className: 'ui-panel-strong encounter-alert heart-tank-swap',
      kinds: TANK_SWAP_ALERT_KINDS,
    });
    this.liveCoal = new EncounterAlert(deps, {
      id: 'heart-live-coal',
      className: 'ui-panel-strong encounter-alert heart-live-coal',
      kinds: COAL_ALERT_KINDS,
    });
    this.finalPhase = new HeartFinalPhasePanel(deps);
    this.breathWind = new BreathWindBadge(deps);
    this.quenchIce = new QuenchIceBadge(deps);
    this.temple = new EncounterAlert(deps, {
      id: 'temple-alert',
      className: 'ui-panel-strong encounter-alert temple-alert',
      kinds: TEMPLE_ALERT_KINDS,
    });
    // A press on the use prompt is the interact key's own 'use' arm: target
    // the body it names, then the ordinary interact.
    this.kitUse = new EncounterAlert(
      {
        ...deps,
        onPress: () => {
          if (this.kitUseBodyId < 0) return;
          this.world?.targetEntity(this.kitUseBodyId);
          deps.onPress();
        },
      },
      {
        id: 'kit-use-prompt',
        className: 'ui-panel-strong encounter-alert kit-use-prompt',
        kinds: KIT_USE_PROMPT_KINDS,
      },
    );
  }

  paint(f: DungeonPromptsFrame): void {
    const p = f.player;
    this.world = f.world;
    const entity = this.entity;
    const cage = buildCageEscapeView({
      auras: p.auras,
      cage: entity,
      interactKey: f.interactKey,
      touch: f.touch,
    });
    this.cage.paint(cage);
    const chain = buildGaolChainView({
      selfId: p.id,
      selfPos: p.pos,
      auras: p.auras,
      entity,
      party: f.party,
    });
    this.chain.paint(chain);
    // The advisory alerts: built only while the hints setting lets them show.
    const hints = f.mechanicHints;
    const bastion = dungeonPromptEnabled('bastion', hints)
      ? buildBastionAlertView({ auras: p.auras, targetId: p.targetId, entity })
      : HINT_HIDDEN;
    this.bastion.paint(bastion);
    let wildheart: WildheartAlertView = dungeonPromptEnabled('wildheart', hints)
      ? buildWildheartAlertView({
          auras: p.auras,
          targetId: p.targetId,
          entity,
          selfId: p.id,
          selfPos: p.pos,
          scene: this.wildheartScene.update(f.world),
        })
      : HINT_HIDDEN;
    const wildheartSoft = wildheart.visible && WILDHEART_SOFT_ALERT_KINDS.has(wildheart.kind);
    // The UI clock (seconds): an Ice Slab's cover hint shows for its first moments.
    const now = performance.now() / 1000;
    const sanctum = dungeonPromptEnabled('sanctum', hints)
      ? buildSanctumAlertView({
          selfId: p.id,
          selfPos: p.pos,
          auras: p.auras,
          targetId: p.targetId,
          entity,
          scene: this.sanctumScene.update(f.world, now),
          now,
        })
      : HINT_HIDDEN;
    this.sanctum.paint(sanctum);
    let crypt: CryptAlertView = dungeonPromptEnabled('crypt', hints)
      ? buildCryptAlertView({
          selfId: p.id,
          selfPos: p.pos,
          auras: p.auras,
          targetId: p.targetId,
          entity,
          scene: this.cryptScene.update(f.world),
        })
      : HINT_HIDDEN;
    const cryptSoft = crypt.visible && CRYPT_SOFT_ALERT_KINDS.has(crypt.kind);
    // The Hammer Council paints no prompt: its marks read in the world only
    // (the team's feedback of 2026-11-17; docs/design/raid/smith_heart.md 7.1).
    // The cold bar is the player's own gauge: never hidden by the hints.
    const quench = dungeonPromptEnabled('quench', hints)
      ? buildQuenchAlertView({ auras: p.auras, dead: p.dead })
      : HINT_HIDDEN;
    this.quench.paint(quench);
    // The Knotted Gale's part in the fight (the panel is the throw's button).
    const knot = dungeonPromptEnabled('knot', hints)
      ? buildKnotAlertView({
          auras: p.auras,
          pos: p.pos,
          dead: p.dead,
          interactKey: f.interactKey,
          touch: f.touch,
        })
      : HINT_HIDDEN;
    this.knot.paint(knot);
    // The raid's one tank swap cue (an action prompt: never the hints'; off
    // the shared slot, so it never makes the use prompt yield).
    this.tankSwap.paint(
      dungeonPromptEnabled('tankSwap', hints)
        ? buildTankSwapAlertView({ self: p, entity })
        : HINT_HIDDEN,
    );
    // The Live Coal's bearer's own chip (an action readout, off the slot).
    this.liveCoal.paint(
      dungeonPromptEnabled('liveCoal', hints)
        ? buildCoalAlertView({ auras: p.auras, dead: p.dead })
        : HINT_HIDDEN,
    );
    // The Masterless Strength's raid HUD (its phase readout; its Overload
    // bars are the room's ring): no personal alert since Jose's playtest of
    // 2026-11-19 (its marks read in the world).
    this.finalPhase.paint(buildFinalPhaseView(this.finalScan.frame(f.world), this.finalPhaseView));
    // The Breath's wind badge: every preset, never behind the hints setting
    // (the wind's way is what the player acts on).
    this.breathWind.paint(
      buildBreathWindView(this.breathWindScan.frame(f.world), p, this.breathWindView),
    );
    // The Quench's ice-state badge and the water's frost veil: every preset,
    // never behind the hints setting (the ice breaking under you is what
    // you act on).
    this.quenchIce.paint(
      buildQuenchIceView(f.world, this.quenchIceScan.frame(f.world), p, this.quenchIceView),
    );
    const temple = dungeonPromptEnabled('temple', hints)
      ? buildTempleAlertView({
          selfPos: p.pos,
          auras: p.auras,
          scene: this.templeScene.update(f.world),
        })
      : HINT_HIDDEN;
    this.temple.paint(temple);
    // The use prompt last: it yields the shared slot to any prompt showing
    // above (a soft Crypt readout yields to it instead).
    const slot = this.slot;
    slot.cage = cage.visible;
    slot.chain = chain.visible;
    slot.bastion = bastion.visible;
    slot.wildheart = wildheart.visible;
    slot.sanctum = sanctum.visible;
    slot.crypt = crypt.visible;
    slot.quench = quench.visible;
    slot.knot = knot.visible;
    slot.temple = temple.visible;
    slot.cryptSoft = cryptSoft;
    slot.wildheartSoft = wildheartSoft;
    const use = usePromptYields(slot)
      ? null
      : buildKitUsePromptView({
          self: p,
          bodies: this.kitUseScene.update(f.world),
          entity,
          interactKey: f.interactKey,
          touch: f.touch,
        });
    if (cryptSoft && use?.visible) crypt = KIT_USE_HIDDEN;
    this.crypt.paint(crypt);
    // A spear to pull, and the use prompt offers it: the prompt says it.
    if (wildheartSoft && use?.visible) wildheart = KIT_USE_HIDDEN;
    this.wildheart.paint(wildheart);
    this.kitUseBodyId = use?.visible ? use.bodyId : -1;
    this.kitUse.paint(use ?? KIT_USE_HIDDEN);
  }

  dispose(): void {
    this.cage.dispose();
    this.chain.dispose();
    this.bastion.dispose();
    this.wildheart.dispose();
    this.sanctum.dispose();
    this.crypt.dispose();
    this.quench.dispose();
    this.knot.dispose();
    this.tankSwap.dispose();
    this.liveCoal.dispose();
    this.finalPhase.dispose();
    this.breathWind.dispose();
    this.quenchIce.dispose();
    this.temple.dispose();
    this.kitUse.dispose();
  }
}

/** Where the Quench cold bar docks: the player frame when the HUD has one,
 *  else the HUD layer itself. */
export function quenchDock(layer: HTMLElement | null): HTMLElement | null {
  return layer?.ownerDocument.getElementById('player-frame') ?? layer;
}
