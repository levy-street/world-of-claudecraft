// Interact-prompt target resolution: turn the shared nearby-interaction scan
// into the narrow target descriptor the HUD prompt renders.
//
// The prompt reads the SAME scan tryNearbyInteraction dispatches from
// (scanNearbyInteraction in nearby_interaction.ts), so what the prompt names and
// what the key does can never disagree. This module only re-labels that result:
// it splits the scan's single 'object' arm into the cases a player reads
// differently (a mailbox opens, a dungeon door leads somewhere, loose loot is
// picked up) and drops 'escortAway', which is a denial toast rather than an
// interactable.
//
// Pure: no DOM, no Three, no i18n. The display NAME is resolved painter-side
// (src/ui/interact_prompt_painter.ts), where the entity label helpers live.

import type { Entity, GatherNodeType } from '../sim/types';
import type { InteractPromptTargetKind } from '../ui/interact_prompt_view';
import type { NearbyInteractionScan } from './nearby_interaction';

export interface InteractPromptTarget {
  kind: InteractPromptTargetKind;
  /** The entity the prompt names, or null for a gather node. */
  entityId: number | null;
  /** The gather node the prompt names, or null for an entity. */
  nodeId: string | null;
  /** Node family, for the node's localized name; null for an entity. */
  nodeType: GatherNodeType | null;
}

/** Re-scan cadence for the prompt. The scan walks every visible entity, so it
 *  runs well below the display rate; 100ms is fast enough that walking into
 *  range feels immediate and slow enough that it never shows on a frame profile.
 *  Deliberately independent of HOVER_REPICK_MS: that one gates a GPU raycast on
 *  pointer movement, this one gates a CPU proximity sweep on player movement. */
export const INTERACT_PROMPT_SCAN_MS = 100;

/** Fixed-cadence gate for the prompt scan. Pure state machine (the caller
 *  supplies the clock), so it unit-tests without timers. */
export class InteractPromptScanGate {
  private nextAt = 0;

  shouldScan(nowMs: number): boolean {
    if (nowMs < this.nextAt) return false;
    this.nextAt = nowMs + INTERACT_PROMPT_SCAN_MS;
    return true;
  }
}

function objectKind(entity: Entity | undefined): InteractPromptTargetKind {
  if (entity?.templateId === 'mailbox') return 'mailbox';
  if (entity?.templateId === 'dungeon_door') return 'dungeonDoor';
  if (entity?.templateId === 'dungeon_exit') return 'dungeonExit';
  return 'pickup';
}

/** Narrow a scan result to what the prompt should name, or null for nothing. */
export function interactPromptTarget(
  scan: NearbyInteractionScan,
  entities: ReadonlyMap<number, Entity>,
): InteractPromptTarget | null {
  if (scan === null || scan.kind === 'escortAway') return null;
  if (scan.kind === 'node') {
    return {
      kind: 'gatherNode',
      entityId: null,
      nodeId: scan.node.id,
      nodeType: scan.node.type,
    };
  }
  const entityId = scan.kind === 'escortStart' ? scan.verdict.entityId : scan.entityId;
  const entity = entities.get(entityId);
  // A scanned id the entity map no longer holds (it despawned between the scan
  // and this call) has no name to show, so it earns no prompt.
  if (!entity) return null;
  let kind: InteractPromptTargetKind;
  if (scan.kind === 'corpse') kind = 'corpse';
  else if (scan.kind === 'delve') kind = 'delveObject';
  else if (scan.kind === 'object') kind = objectKind(entity);
  else if (scan.kind === 'escortStart') kind = 'escort';
  else kind = entity.templateId === 'spirit_healer' ? 'spiritHealer' : 'npc';
  return { kind, entityId, nodeId: null, nodeType: null };
}
