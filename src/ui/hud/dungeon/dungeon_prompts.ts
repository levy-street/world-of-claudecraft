// The dungeon encounter prompts the HUD composes as ONE member with ONE frame
// call: the Iron Cage escape (cage_escape_*), Gaoler Ossick's chain alert
// (gaol_chain_*), the Wildheart Basin's alert (wildheart_alert_view.ts on the
// shared encounter alert painter, encounter_alert_painter.ts: the Prey, the
// Stalk, the pollen, the Pack Bond readout) and the Gravewyrm Sanctum's
// (sanctum_alert_view.ts on the same family: the chains, the meltwater, the
// lake). It owns no DOM itself; it builds each view from the frame's inputs
// and hands it to that prompt's painter. The frame hands it the world (its
// entities and roster version): the prompts look bodies up by id, and the
// Sanctum alert keeps its scene off the roster (sanctum_alert_scene_core.ts).

import { type CageEscapeDeps, CageEscapePrompt } from './cage_escape_painter';
import { buildCageEscapeView } from './cage_escape_view';
import { EncounterAlert } from './encounter_alert_painter';
import { GaolChainAlert } from './gaol_chain_painter';
import { buildGaolChainView, type GaolChainEntity } from './gaol_chain_view';
import { SanctumAlertSceneScan, type SanctumSceneEntity } from './sanctum_alert_scene_core';
import { buildSanctumAlertView, SANCTUM_ALERT_KINDS } from './sanctum_alert_view';
import { buildWildheartAlertView, WILDHEART_ALERT_KINDS } from './wildheart_alert_view';

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
    }[];
    /** The player's target (an alert may read the boss being targeted). */
    targetId?: number | null;
  };
  /** The world: every body by id, and the roster version (bumped when one
   *  comes or goes). */
  world: {
    entities: ReadonlyMap<number, GaolChainEntity & SanctumSceneEntity>;
    entityRosterVersion: number;
  };
  party: readonly { pid: number }[] | null | undefined;
  /** The interact key's label ('' when unbound). */
  interactKey: string;
  touch: boolean;
}

export class DungeonPrompts {
  private readonly cage: CageEscapePrompt;
  private readonly chain: GaolChainAlert;
  private readonly wildheart: EncounterAlert;
  private readonly sanctum: EncounterAlert;
  private readonly sanctumScene = new SanctumAlertSceneScan();
  private world: DungeonPromptsFrame['world'] | null = null;
  /** One lookup for every view (no closure a frame). */
  private readonly entity = (id: number) => this.world?.entities.get(id);

  constructor(deps: CageEscapeDeps) {
    this.cage = new CageEscapePrompt(deps);
    this.chain = new GaolChainAlert(deps);
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
  }

  paint(f: DungeonPromptsFrame): void {
    const p = f.player;
    this.world = f.world;
    const entity = this.entity;
    this.cage.paint(
      buildCageEscapeView({
        auras: p.auras,
        cage: entity,
        interactKey: f.interactKey,
        touch: f.touch,
      }),
    );
    this.chain.paint(
      buildGaolChainView({
        selfId: p.id,
        selfPos: p.pos,
        auras: p.auras,
        entity,
        party: f.party,
      }),
    );
    this.wildheart.paint(buildWildheartAlertView({ auras: p.auras, targetId: p.targetId, entity }));
    this.sanctum.paint(
      buildSanctumAlertView({
        selfId: p.id,
        selfPos: p.pos,
        auras: p.auras,
        targetId: p.targetId,
        entity,
        scene: this.sanctumScene.update(f.world),
      }),
    );
  }

  dispose(): void {
    this.cage.dispose();
    this.chain.dispose();
    this.wildheart.dispose();
    this.sanctum.dispose();
  }
}
