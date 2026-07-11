// Pure, host-agnostic view model for the talents & specializations window.
//
// This is the pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; reference unit_portrait.ts / vendor_view.ts). It derives everything
// the talents window decides that is worth testing without a DOM: the point counts,
// the tab pips, the spec list, and the tiered tree layout (nodes grouped into
// unlock-level tier rows, each with its per-node state).
//
// CRUCIAL FRAMING: the talents core is NOT IWorld-derived. The window edits a LOCAL
// mutable edit buffer (a `cloneAllocation` of the live `IWorld.talents`) that is only
// committed on save / loadout-switch. So this core takes that buffer (`stage`) plus
// the player class plus the total available points as INPUTS, alongside the static
// content table (`talentsFor`). It reads no combat/world state. The painter owns the
// mutation callbacks that write back into the same buffer and re-derive.
//
// TIERED LAYOUT (classic tiered-choices redesign): a tree renders as tier rows keyed
// by the row's minimum unlock LEVEL. Points arrive 1 per level from
// FIRST_TALENT_LEVEL, so the earliest level a row can open is FIRST_TALENT_LEVEL
// plus the cheapest investment that satisfies its gate: a node's `pointsGate` is
// points spent above the row, and a `requires` edge needs at least 1 rank per
// prerequisite. `levelLocked` marks a tier the CURRENT point budget cannot open
// under ANY spending pattern (total < minInvest + 1), i.e. the player must level.
//
// The gating (per-node avail/filled/maxed/locked/dormant) MUST match the previous
// inline version byte-for-byte: it reuses cloneAllocation + validateAllocation +
// dormantNodes + pointsSpent exactly, so a unit test can pin it. DOM-free and
// i18n-free (the painter localizes via t()/tTalent from the emitted discriminators)
// so tests/talents_view.test.ts drives it directly.

import {
  cloneAllocation,
  dormantNodes,
  FIRST_TALENT_LEVEL,
  pointsSpent,
  type Role,
  type SpecDef,
  type TalentAllocation,
  type TalentChoiceOption,
  type TalentNode,
  talentsFor,
  validateAllocation,
} from '../sim/content/talents';
import type { PlayerClass } from '../sim/types';

export type TalentNodeShape = 'square' | 'octagon' | 'circle';
export type TalentNodeState = 'dormant' | 'maxed' | 'filled' | 'avail' | 'locked';

/** One talent card, ready to paint into its tier row. */
export interface TalentNodeVM {
  node: TalentNode;
  shape: TalentNodeShape;
  state: TalentNodeState;
  ranks: number;
  maxRank: number;
  /** aria-disabled: cannot spend and nothing is invested (`!canAdd && ranks <= 0`). */
  disabled: boolean;
  /** Grid column identity (the content `col`), so a two-card row keeps its gap. */
  col: number;
  /** The selected option for a `choice` node, else undefined. */
  chosen: TalentChoiceOption | undefined;
}

/** One tier row: the cards that share a content row, keyed by unlock level. */
export interface TalentTierVM {
  /** The content row index (stable ordering key). */
  row: number;
  /** The earliest character level at which this tier can possibly open. */
  level: number;
  /**
   * True when the current TOTAL point budget cannot open this tier under any
   * spending pattern (the player must level up). Per-card `locked` still covers
   * the softer case of an unmet gate with points to spare.
   */
  levelLocked: boolean;
  nodes: TalentNodeVM[];
}

/** A single tree (class tree, or a chosen spec's tree), as tier rows. */
export interface TalentTreeVM {
  /** No nodes to lay out (e.g. a spec tree before a spec is chosen). */
  empty: boolean;
  tiers: TalentTierVM[];
  /** All cards flat, in tier order (convenience for tests/consumers). */
  nodes: TalentNodeVM[];
}

/** A specialization card for the spec picker. */
export interface TalentSpecVM {
  spec: SpecDef;
  selected: boolean;
  role: Role;
}

/** The full derived talents view. */
export interface TalentsView {
  /** The class has a talent tree (false renders the "coming soon" empty state). */
  hasTree: boolean;
  available: number;
  total: number;
  spent: number;
  classSpent: number;
  specSpent: number;
  /** The whole staged build validates (gates the save / new-build buttons). */
  valid: boolean;
  specs: TalentSpecVM[];
  selectedSpec: SpecDef | null;
  classTree: TalentTreeVM;
  /** The chosen spec's tree, or null when no spec is selected. */
  specTree: TalentTreeVM | null;
}

const EMPTY_TREE: TalentTreeVM = { empty: true, tiers: [], nodes: [] };

function emptyView(total: number): TalentsView {
  return {
    hasTree: false,
    available: Math.max(0, total),
    total,
    spent: 0,
    classSpent: 0,
    specSpent: 0,
    valid: false,
    specs: [],
    selectedSpec: null,
    classTree: EMPTY_TREE,
    specTree: null,
  };
}

// The cheapest point investment that could satisfy `node`'s unlock conditions:
// its pointsGate (points spent above the row), else 1 rank per `requires` edge,
// else free. The row's minimum across nodes keys the tier's unlock level.
function minInvest(node: TalentNode): number {
  if (node.pointsGate) return node.pointsGate;
  return node.requires?.length ?? 0;
}

/** The earliest character level at which a tier with `invest` cheapest-cost can open. */
export function tierUnlockLevel(invest: number): number {
  return FIRST_TALENT_LEVEL + invest;
}

function buildTree(
  ct: NonNullable<ReturnType<typeof talentsFor>>,
  stage: TalentAllocation,
  cls: PlayerClass,
  total: number,
  tree: 'class' | 'spec',
  specId: string | undefined,
): TalentTreeVM {
  const nodes = ct.nodes.filter(
    (n) => n.tree === tree && (tree === 'class' || n.specId === specId),
  );
  if (nodes.length === 0) return { ...EMPTY_TREE };

  const dormant = dormantNodes(cls, stage);

  const byRow = new Map<number, TalentNode[]>();
  for (const n of nodes) {
    const row = byRow.get(n.row);
    if (row) row.push(n);
    else byRow.set(n.row, [n]);
  }

  const tiers: TalentTierVM[] = [];
  const flat: TalentNodeVM[] = [];
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const rowNodes = (byRow.get(row) ?? []).slice().sort((a, b) => a.col - b.col);
    const invest = Math.min(...rowNodes.map(minInvest));
    const vms: TalentNodeVM[] = [];
    for (const n of rowNodes) {
      const ranks = stage.ranks[n.id] ?? 0;
      const isDormant = dormant.has(n.id);
      const cand = cloneAllocation(stage);
      cand.ranks[n.id] = ranks + 1;
      if (n.kind === 'choice' && !cand.choices[n.id] && n.choices?.[0]) {
        cand.choices[n.id] = n.choices[0].id;
      }
      const canAdd = ranks < n.maxRank && validateAllocation(cls, cand, total).ok;
      const shape: TalentNodeShape =
        n.kind === 'active' ? 'square' : n.kind === 'choice' ? 'octagon' : 'circle';
      const state: TalentNodeState = isDormant
        ? 'dormant'
        : ranks >= n.maxRank
          ? 'maxed'
          : ranks > 0
            ? 'filled'
            : canAdd
              ? 'avail'
              : 'locked';
      const chosen =
        n.kind === 'choice' ? n.choices?.find((c) => c.id === stage.choices[n.id]) : undefined;
      vms.push({
        node: n,
        shape,
        state,
        ranks,
        maxRank: n.maxRank,
        disabled: !canAdd && ranks <= 0,
        col: n.col,
        chosen,
      });
    }
    tiers.push({
      row,
      level: tierUnlockLevel(invest),
      levelLocked: total < invest + 1,
      nodes: vms,
    });
    flat.push(...vms);
  }

  return { empty: false, tiers, nodes: flat };
}

/**
 * Derive the full talents view from the staged edit buffer.
 *
 * @param stage the mutable LOCAL edit buffer (a clone of IWorld.talents); read,
 *   never mutated here.
 * @param cls   the player's class.
 * @param total the total available talent points (IWorld.talentPoints().total).
 */
export function buildTalentsView(
  stage: TalentAllocation,
  cls: PlayerClass,
  total: number,
): TalentsView {
  const ct = talentsFor(cls);
  if (!ct) return emptyView(total);

  const spent = pointsSpent(stage);
  const treeSpent = (tree: 'class' | 'spec'): number =>
    ct.nodes
      .filter((n) => n.tree === tree && (tree === 'class' || n.specId === stage.spec))
      .reduce((a, n) => a + (stage.ranks[n.id] ?? 0), 0);

  const selectedSpec = ct.specs.find((s) => s.id === stage.spec) ?? null;

  return {
    hasTree: true,
    available: Math.max(0, total - spent),
    total,
    spent,
    classSpent: treeSpent('class'),
    specSpent: treeSpent('spec'),
    valid: validateAllocation(cls, stage, total).ok,
    specs: ct.specs.map((sp) => ({ spec: sp, selected: stage.spec === sp.id, role: sp.role })),
    selectedSpec,
    classTree: buildTree(ct, stage, cls, total, 'class', undefined),
    specTree: selectedSpec ? buildTree(ct, stage, cls, total, 'spec', selectedSpec.id) : null,
  };
}
