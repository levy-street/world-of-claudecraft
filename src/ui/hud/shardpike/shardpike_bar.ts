// The Shardpike bar's composition seam: one factory the HUD holds and paints.
//
// Mirrors createDoomMeter: the coordinator should know that a bar exists and when to
// paint it, and nothing else. Element lookup, the verb dispatch, and turning world state
// into the bar's state all live here, so the trial's whole input surface is one directory.

import { keyLabel } from '../../../game/keybinds';
import { lanceLeanIntent } from '../../../game/lance_lean_intent';
import { MUSTER_RACK, MUSTER_RACK_TEMPLATE_ID } from '../../../sim/content/mirefen_muster';
import { INTERACT_RANGE } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import type { PainterHostWriters } from '../../painter_host';
import { type ShardpikeBarDeps, ShardpikeBarPainter } from './shardpike_bar_painter';
import { shardpikeBarState } from './shardpike_bar_view';
import { shardpikeLeanKeys } from './shardpike_lean_view';
import { ShardpikePromptPainter } from './shardpike_prompt_painter';
import { shardpikePromptState } from './shardpike_prompt_view';

export interface ShardpikeBar {
  /** Paint one frame. `dead` comes from the caller's already-resolved self entity. */
  paint(dead: boolean): void;
  hide(): void;
}

/**
 * Build the bar over an existing `#shardpike-bar` element.
 *
 * Returns a no-op bar when the element is absent rather than throwing: `index.html` and
 * `play.html` both carry it, but the HUD is also constructed in test and editor hosts that
 * mount a narrower document, and a missing quest-tool bar must never take the HUD down.
 */
export function createShardpikeBar(
  doc: Document,
  writers: PainterHostWriters,
  /**
   * Resolved per call, not captured: the HUD builds its painters as field initializers,
   * which run before its own `sim` field is assigned, so taking the world eagerly here is
   * a use-before-initialization error rather than a style preference.
   */
  world: () => IWorld,
  /** The HUD capabilities the buttons need; see ShardpikeBarDeps. */
  deps: ShardpikeBarDeps = {},
): ShardpikeBar {
  const root = doc.getElementById('shardpike-bar');
  if (!root) return { paint: () => {}, hide: () => {} };
  // The prompt is a SEPARATE element because it belongs somewhere else on screen: the bar
  // sits with the action bars where the hands are, and the instruction sits up near the
  // middle where the eyes already are during a fight. A missing element is a no-op painter
  // for the same reason the bar's is: narrower test and editor documents must not break.
  const rack = rackReach();
  const promptRoot = doc.getElementById('shardpike-prompt');
  const prompt = promptRoot ? new ShardpikePromptPainter(writers, promptRoot) : null;
  const painter = new ShardpikeBarPainter(
    writers,
    root,
    (action) => {
      const w = world();
      if (action === 'brace') w.lanceBrace();
      else if (action === 'thrust') w.lanceThrust();
      else w.lanceRelease();
    },
    deps,
    // The keycaps above the beam hold the lean the same way the keys do: into the client's
    // movement intent, which folds it into the streamed strafe bits (lance_lean_intent.ts).
    (hold) => {
      lanceLeanIntent.hold = hold;
    },
  );
  return {
    paint(dead: boolean): void {
      const w = world();
      const mainhandItemId = w.equipment.mainhand;
      const trial = w.lanceTrial;
      const restRemaining = w.lanceRestRemaining;
      const leanKeys = shardpikeLeanKeys(deps.keybinds?.(), keyLabel);
      const bar = shardpikeBarState({ mainhandItemId, trial, restRemaining, dead, leanKeys });
      // Every frame the bar paints, the movement intent learns whether a pike is couched:
      // that is the one switch that turns the left/right keys into the balance stick.
      lanceLeanIntent.braced = bar.bracing && !dead;
      painter.paint(bar);
      prompt?.paint(
        shardpikePromptState({
          mainhandItemId,
          trial,
          guidance: w.lanceGuidance,
          restRemaining,
          dead,
          leanKeys,
          rackInReach: rack(w),
          interactKey: interactKeyLabel(deps),
          playerLevel: w.player.level,
          touch: doc.body?.classList.contains('mobile-touch') ?? false,
        }),
      );
    },
    hide(): void {
      lanceLeanIntent.braced = false;
      painter.hide();
      prompt?.hide();
    },
  };
}

/** The bound interact key's label, '' when there is none (or no keybinds host). */
function interactKeyLabel(deps: ShardpikeBarDeps): string {
  const code = deps.keybinds?.().codesForAction('interact')[0];
  return code ? keyLabel(code) : '';
}

/**
 * "Is the muster's weapon rack within interact reach?", cheap enough to ask every frame.
 *
 * The rack stands at a fixed post, so the frame's whole cost away from it is one distance
 * to MUSTER_RACK. Only inside reach is the entity itself confirmed (it is the thing the
 * press acts on, and a world without the muster has none): looked up once by template and
 * then held by id, so standing at the rack costs a map lookup, not a roster walk.
 */
function rackReach(): (w: IWorld) => boolean {
  let rackId: number | null = null;
  let missedAt = -1;
  return (w) => {
    const pos = w.player.pos;
    if (Math.hypot(pos.x - MUSTER_RACK.x, pos.z - MUSTER_RACK.z) > INTERACT_RANGE) return false;
    let rack = rackId !== null ? w.entities.get(rackId) : undefined;
    if (rack?.templateId !== MUSTER_RACK_TEMPLATE_ID) {
      rack = undefined;
      rackId = null;
      // A fruitless look is not repeated until an entity is added or dropped.
      if (missedAt === w.entityRosterVersion) return false;
      missedAt = w.entityRosterVersion;
      for (const e of w.entities.values()) {
        if (e.kind === 'object' && e.templateId === MUSTER_RACK_TEMPLATE_ID) {
          rack = e;
          rackId = e.id;
          break;
        }
      }
    }
    return (
      !!rack &&
      rack.lootable &&
      Math.hypot(pos.x - rack.pos.x, pos.z - rack.pos.z) <= INTERACT_RANGE
    );
  };
}
