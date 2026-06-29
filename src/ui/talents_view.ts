// Pure, host-agnostic view model for the talents & specializations window.
//
// This is the pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; reference unit_portrait.ts / vendor_view.ts). It derives everything
// the talents window decides that is worth testing without a DOM: the point counts,
// which class/spec tab pips to light, the spec list, and the full tree layout
// (per-node geometry + state + the prereq arrows).
//
// CRUCIAL FRAMING: the talents core is NOT IWorld-derived. The window edits a LOCAL
// mutable edit buffer (a `cloneAllocation` of the live `IWorld.talents`) that is only
// committed on save / loadout-switch. So this core takes that buffer (`stage`) plus
// the player class plus the total available points as INPUTS, alongside the static
// content table (`talentsFor`). It reads no combat/world state. The painter owns the
// mutation callbacks that write back into the same buffer and re-derive.
//
// The gating (which tiers/points are spendable, per-node avail/filled/maxed/locked/
// dormant) MUST match the inline version byte-for-byte: it reuses cloneAllocation +
// validateAllocation + dormantNodes + pointsSpent exactly as the inline code did, so
// a unit test can pin it. DOM-free and i18n-free (the painter localizes via t()/
// tTalent from the emitted discriminators) so tests/talents_view.test.ts drives it
// directly.

import {
  cloneAllocation,
  dormantNodes,
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

// Tree layout constants (named, not bare numbers in the painter). The
// painter consumes the derived geometry below, never these directly.
export const TALENT_CELL_W = 86; // horizontal cell pitch (column stride)
export const TALENT_CELL_H = 70; // vertical cell pitch (row stride)
export const TALENT_NODE_SIZE = 46; // node box edge length
export const TALENT_TOP_PAD = 6; // top padding above the first row

export type TalentNodeShape = 'square' | 'octagon' | 'circle';
export type TalentNodeState = 'dormant' | 'maxed' | 'filled' | 'avail' | 'locked';

/** One talent node, ready to paint. Geometry is absolute pixels in the tree box. */
export interface TalentNodeVM {
  node: TalentNode;
  shape: TalentNodeShape;
  state: TalentNodeState;
  ranks: number;
  maxRank: number;
  /** aria-disabled: cannot spend and nothing is invested (`!canAdd && ranks <= 0`). */
  disabled: boolean;
  left: number;
  top: number;
  /** The selected option for a `choice` node, else undefined. */
  chosen: TalentChoiceOption | undefined;
}

/** A prereq connector line between two nodes, in absolute tree-box pixels. */
export interface TalentArrowVM {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The upstream prereq node has at least one rank. */
  filled: boolean;
}

/** A single tree (class tree, or a chosen spec's tree). */
export interface TalentTreeVM {
  /** No nodes to lay out (e.g. a spec tree before a spec is chosen). */
  empty: boolean;
  width: number;
  height: number;
  nodes: TalentNodeVM[];
  arrows: TalentArrowVM[];
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

const EMPTY_TREE: TalentTreeVM = { empty: true, width: 0, height: 0, nodes: [], arrows: [] };

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

// Center of a node box, used as the arrow anchor (mirrors the inline cx/cy).
function centerX(node: TalentNode): number {
  return node.col * TALENT_CELL_W + TALENT_CELL_W / 2;
}
function centerY(node: TalentNode): number {
  return node.row * TALENT_CELL_H + TALENT_TOP_PAD + TALENT_NODE_SIZE / 2;
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

  const cols = Math.max(...nodes.map((n) => n.col)) + 1;
  const rows = Math.max(...nodes.map((n) => n.row)) + 1;
  const width = cols * TALENT_CELL_W;
  const height = rows * TALENT_CELL_H + TALENT_TOP_PAD;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dormant = dormantNodes(cls, stage);

  const arrows: TalentArrowVM[] = [];
  for (const n of nodes)
    for (const req of n.requires ?? []) {
      const r = byId.get(req);
      if (!r) continue;
      arrows.push({
        x1: centerX(r),
        y1: centerY(r) + TALENT_NODE_SIZE / 2,
        x2: centerX(n),
        y2: centerY(n) - TALENT_NODE_SIZE / 2,
        filled: (stage.ranks[req] ?? 0) > 0,
      });
    }

  const nodeVMs: TalentNodeVM[] = [];
  for (const n of nodes) {
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
    nodeVMs.push({
      node: n,
      shape,
      state,
      ranks,
      maxRank: n.maxRank,
      disabled: !canAdd && ranks <= 0,
      left: n.col * TALENT_CELL_W + (TALENT_CELL_W - TALENT_NODE_SIZE) / 2,
      top: n.row * TALENT_CELL_H + TALENT_TOP_PAD,
      chosen,
    });
  }

  return { empty: false, width, height, nodes: nodeVMs, arrows };
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
