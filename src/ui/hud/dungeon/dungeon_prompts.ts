// The dungeon encounter prompts the HUD composes as ONE member with ONE frame
// call: the Iron Cage escape (cage_escape_*), Gaoler Ossick's chain alert
// (gaol_chain_*), the Sunken Bastion's crown alert (bastion_alert_view.ts:
// Vael's scythe and Fog Veil), the Wildheart Basin's alert (wildheart_alert_view.ts on the
// shared encounter alert painter, encounter_alert_painter.ts: the Prey, the
// Stalk, the pollen, the Pack Bond readout) and the Gravewyrm Sanctum's
// (sanctum_alert_view.ts on the same family: the chains, the meltwater, the
// lake) and the Hollow Crypt's (crypt_alert_view.ts on the same family: the
// grave mark, the Frozen Embrace, the Bride's Lament, the Open Grave, the
// Burning Knell's half, Grasp of the Grave, the Reap, the Toll and Harmony
// readouts, the Rite's candles and the Bound Souls), plus the trash engine's
// use prompt (kit_use_prompt_view.ts on the same family: a Soul Brazier to kick
// over, a Remembrance Candle to relight). It owns no DOM itself; it builds
// each view from the frame's inputs and hands it to that prompt's painter. The
// frame hands it the world (its entities and roster version, and the target
// command a use press needs): the prompts look bodies up by id, and the
// Sanctum and Crypt alerts and the use prompt keep their scenes off the
// roster (sanctum_alert_scene_core.ts, crypt_alert_scene_core.ts,
// KitUseSceneScan).
//
// The prompts share one slot over the action bar, so the use prompt gives way
// to every encounter prompt above it (a strike to dodge or a cage to break
// outranks a brazier), except the Crypt alert's SOFT readouts (the Rite's
// candle count, a Bound Soul on its way), which give the slot to the use
// prompt when it has a body to offer (the relight prompt at a candle); the
// interact press itself still kicks the brazier
// whatever the slot shows (src/game/nearby_interaction_core.ts).

import { BASTION_ALERT_KINDS, buildBastionAlertView } from './bastion_alert_view';
import { type CageEscapeDeps, CageEscapePrompt } from './cage_escape_painter';
import { buildCageEscapeView } from './cage_escape_view';
import { CryptAlertSceneScan, type CryptSceneEntity } from './crypt_alert_scene_core';
import {
  buildCryptAlertView,
  CRYPT_ALERT_KINDS,
  CRYPT_SOFT_ALERT_KINDS,
  type CryptAlertView,
} from './crypt_alert_view';
import { EncounterAlert } from './encounter_alert_painter';
import { GaolChainAlert } from './gaol_chain_painter';
import { buildGaolChainView, type GaolChainEntity } from './gaol_chain_view';
import {
  buildKitUsePromptView,
  KIT_USE_PROMPT_KINDS,
  type KitUseBody,
  KitUseSceneScan,
} from './kit_use_prompt_view';
import { SanctumAlertSceneScan, type SanctumSceneEntity } from './sanctum_alert_scene_core';
import { buildSanctumAlertView, SANCTUM_ALERT_KINDS } from './sanctum_alert_view';
import { buildWildheartAlertView, WILDHEART_ALERT_KINDS } from './wildheart_alert_view';

const KIT_USE_HIDDEN = { visible: false } as const;

export interface DungeonPromptsFrame {
  player: {
    id: number;
    pos: { x: number; z: number };
    auras: readonly {
      id: string;
      sourceId?: number;
      value2?: number;
      remaining?: number;
      duration?: number;
      stacks?: number;
      value?: number;
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
      GaolChainEntity & SanctumSceneEntity & CryptSceneEntity & KitUseBody
    >;
    entityRosterVersion: number;
    /** Select a body (the use prompt's press targets the body, then interacts). */
    targetEntity(id: number | null): void;
  };
  party: readonly { pid: number }[] | null | undefined;
  /** The interact key's label ('' when unbound). */
  interactKey: string;
  touch: boolean;
}

export class DungeonPrompts {
  private readonly cage: CageEscapePrompt;
  private readonly chain: GaolChainAlert;
  private readonly bastion: EncounterAlert;
  private readonly wildheart: EncounterAlert;
  private readonly sanctum: EncounterAlert;
  private readonly sanctumScene = new SanctumAlertSceneScan();
  private readonly crypt: EncounterAlert;
  private readonly cryptScene = new CryptAlertSceneScan();
  private readonly kitUse: EncounterAlert;
  private readonly kitUseScene = new KitUseSceneScan();
  /** The body a press on the use prompt targets (-1: none on offer). */
  private kitUseBodyId = -1;
  private world: DungeonPromptsFrame['world'] | null = null;
  /** One lookup for every view (no closure a frame). */
  private readonly entity = (id: number) => this.world?.entities.get(id);

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
    const bastion = buildBastionAlertView({ auras: p.auras, targetId: p.targetId, entity });
    this.bastion.paint(bastion);
    const wildheart = buildWildheartAlertView({ auras: p.auras, targetId: p.targetId, entity });
    this.wildheart.paint(wildheart);
    // The UI clock (seconds): an Ice Slab's cover hint shows for its first moments.
    const now = performance.now() / 1000;
    const sanctum = buildSanctumAlertView({
      selfId: p.id,
      selfPos: p.pos,
      auras: p.auras,
      targetId: p.targetId,
      entity,
      scene: this.sanctumScene.update(f.world, now),
      now,
    });
    this.sanctum.paint(sanctum);
    let crypt: CryptAlertView = buildCryptAlertView({
      selfId: p.id,
      selfPos: p.pos,
      auras: p.auras,
      targetId: p.targetId,
      entity,
      scene: this.cryptScene.update(f.world),
    });
    const cryptSoft = crypt.visible && CRYPT_SOFT_ALERT_KINDS.has(crypt.kind);
    // The use prompt last: it yields the shared slot to any prompt above (a
    // soft Crypt readout yields to it instead).
    const slotTaken =
      cage.visible ||
      chain.visible ||
      bastion.visible ||
      wildheart.visible ||
      sanctum.visible ||
      (crypt.visible && !cryptSoft);
    const use = slotTaken
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
    this.kitUse.dispose();
  }
}
