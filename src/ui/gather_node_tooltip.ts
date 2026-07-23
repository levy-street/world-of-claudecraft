// Gather-node world-hover tooltip (Professions 2.0): desktop pointer
// only. Hovering an ore vein / timber stand / herb patch in the 3D scene shows
// the node's name, its tool-tier requirement (tier 2+ only: tier 1 is the
// bare-hands floor, so a requirement line would be false), and its per-viewer
// ready/cooldown state. Mobile has no hover surface: touch players read the
// tier off the minimap lock tint and the gatherDenied error toast instead.
//
// Reuses the HUD's shared #tooltip container and the paintTooltipAt idiom
// (hud.ts): same box, same +14/-10 cursor offsets, same author-space viewport
// clamp via getUiScale. paintTooltipAt itself is Hud-private, so the paint is
// replicated here rather than a new tooltip system invented; hiding goes
// through the PUBLIC hud.hideTooltip() so the shared-owner release (#1626)
// stays consistent. Content comes from the pure buildGatherNodeTooltip core
// (gathering_view.ts), which tests drive directly.
//
// Identical on every graphics preset and FPS tier: the tier requirement is
// actionable info (fairness invariant), so nothing here reads
// ui_effects_profile or the governor.

import type { GatheringProfessionId } from '../sim/content/professions';
import { NODE_HARVEST_TABLE } from '../sim/professions/gathering';
import { BARE_HANDS_TOOL_TIER } from '../sim/professions/tools';
import type { GatherNodeDef, GatherNodeType } from '../sim/types';
import type { IWorld } from '../world_api';
import { esc } from './esc';
import {
  buildGatherNodeTooltip,
  type GatherNodeTooltipModel,
  viewerBestToolTier,
} from './gathering_view';
import { formatNumber, type TranslationKey, t } from './i18n';
import { getUiScale } from './ui_scale';

// Re-pick cadence floor: world raycasts are the expensive half of hover (see
// main.ts HoverPickGate), so the pointer stream is throttled well below the
// display rate. State (ready/cooldown) also refreshes at this cadence.
const PICK_THROTTLE_MS = 120;

const NODE_NAME_KEYS: Record<GatherNodeType, string> = {
  ore: 'hudChrome.gathering.nodeName.ore',
  wood: 'hudChrome.gathering.nodeName.wood',
  herb: 'hudChrome.gathering.nodeName.herb',
};

// Keyed per profession, never composed from fragments (single-key
// interpolation only); fishing never appears (no fishing world nodes).
const TIER_REQUIRED_KEYS: Partial<Record<GatheringProfessionId, string>> = {
  mining: 'hudChrome.gathering.tierRequired.mining',
  logging: 'hudChrome.gathering.tierRequired.logging',
  herbalism: 'hudChrome.gathering.tierRequired.herbalism',
};

/** The tooltip's inner HTML for one resolved node model. Exported for the
 *  hover module's own use; all copy resolves through t() here (the pure core
 *  stays i18n-free). */
export function gatherNodeTooltipHtml(model: GatherNodeTooltipModel): string {
  const name = t(NODE_NAME_KEYS[model.type] as TranslationKey);
  let html = `<div class="tt-title">${esc(name)}</div>`;
  const tierKey = TIER_REQUIRED_KEYS[model.professionId];
  if (model.tier > BARE_HANDS_TOOL_TIER && tierKey) {
    const line = t(tierKey as TranslationKey, {
      tier: formatNumber(model.tier, { maximumFractionDigits: 0 }),
    });
    // Red only while the viewer's owned-best tool falls short, mirroring the
    // item-tooltip unmet-requirement idiom.
    html += `<div class="${model.locked ? 'tt-red' : 'tt-sub'}">${esc(line)}</div>`;
  }
  const stateKey =
    model.state === 'ready'
      ? 'hudChrome.gathering.stateReady'
      : 'hudChrome.gathering.stateCooldown';
  html += `<div class="${model.state === 'ready' ? 'tt-green' : 'tt-sub'}">${esc(t(stateKey as TranslationKey))}</div>`;
  return html;
}

const TOOL_TIER_UNMET_KEYS: Record<GatherNodeType, string> = {
  ore: 'hudChrome.gathering.toolTierUnmet.mining',
  wood: 'hudChrome.gathering.toolTierUnmet.logging',
  herb: 'hudChrome.gathering.toolTierUnmet.herbalism',
};

/** The client-side tool-tier pre-gate for one node, with the localized denial
 *  line already resolved for exactly this node (this module is the gathering
 *  copy surface, so main.ts wires it in one line). Structurally matches
 *  gather_node_interact.ts GatherNodeToolGate; the server stays authoritative
 *  either way (a stale read still answers gatherDenied). */
export function gatherNodeToolGateFor(
  world: IWorld,
  node: Pick<GatherNodeDef, 'type' | 'tier'>,
): { nodeTier: number; viewerToolTier: number; unmetText: string } {
  return {
    nodeTier: node.tier,
    viewerToolTier: viewerBestToolTier(world, NODE_HARVEST_TABLE[node.type].professionId),
    unmetText: t(TOOL_TIER_UNMET_KEYS[node.type] as TranslationKey, {
      tier: formatNumber(node.tier, { maximumFractionDigits: 0 }),
    }),
  };
}

export interface GatherNodeTooltipHud {
  hideTooltip(): void;
}

/**
 * Wire the hover tooltip onto the 3D canvas. `pickEntity` mirrors the click
 * path's priority (main.ts handlePick: a direct entity hit always wins), so
 * the node tip never fights the mob/player hover tooltip for the shared box;
 * `pointerBusy` is the caller's drag gate. Pointer-locked mouselook and touch
 * pointers never show it.
 */
export function attachGatherNodeHoverTooltip(
  canvas: HTMLElement,
  world: IWorld,
  hud: GatherNodeTooltipHud,
  pickGatherNode: (clientX: number, clientY: number) => string | null,
  pickEntity: (clientX: number, clientY: number) => number | null,
  pointerBusy: () => boolean,
): void {
  const tooltipEl = document.getElementById('tooltip');
  if (!tooltipEl) return;
  let lastPickAt = 0;
  let shown = false;

  // Only ever hide the shared box when THIS module painted it (the
  // hideMapAreaTip idiom), so an unrelated owner's tooltip is never wiped.
  const hide = (): void => {
    if (!shown) return;
    shown = false;
    hud.hideTooltip();
  };

  const paintAt = (model: GatherNodeTooltipModel, x: number, y: number): void => {
    // The paintTooltipAt idiom: drop the mob-tooltip size modifier, fill,
    // then clamp the author-space box against the viewport (x/y arrive in
    // visual space, so divide by the UI scale first).
    tooltipEl.classList.remove('mob-tooltip');
    tooltipEl.innerHTML = gatherNodeTooltipHtml(model);
    tooltipEl.style.display = 'block';
    const z = getUiScale();
    const tw = tooltipEl.offsetWidth;
    const th = tooltipEl.offsetHeight;
    tooltipEl.style.left = `${Math.max(8, Math.min(window.innerWidth / z - tw - 8, x / z + 14))}px`;
    tooltipEl.style.top = `${Math.max(8, y / z - th - 10)}px`;
    shown = true;
  };

  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return; // touch has no hover
    if (document.pointerLockElement !== null || pointerBusy()) {
      hide();
      return;
    }
    const now = performance.now();
    if (now - lastPickAt < PICK_THROTTLE_MS) return;
    lastPickAt = now;
    // A direct entity hit always wins (the hover pipeline shows its own
    // mob/player tooltip in the fixed corner slot); only a bare node shows.
    const nodeId =
      pickEntity(ev.clientX, ev.clientY) === null ? pickGatherNode(ev.clientX, ev.clientY) : null;
    const model = nodeId !== null ? buildGatherNodeTooltip(world, nodeId) : null;
    if (model === null) {
      hide();
      return;
    }
    paintAt(model, ev.clientX, ev.clientY);
  });
  // Leaving the canvas (including onto an overlaying HUD window) or starting
  // any press (a click harvests or moves) dismisses the tip.
  canvas.addEventListener('pointerleave', hide);
  canvas.addEventListener('pointerdown', hide);
}
