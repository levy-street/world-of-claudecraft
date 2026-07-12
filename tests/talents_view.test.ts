import { describe, expect, it } from 'vitest';
import {
  cloneAllocation,
  emptyAllocation,
  pointsSpent,
  TALENTS,
  type TalentAllocation,
  type TalentNode,
  talentsFor,
  validateAllocation,
} from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import {
  buildTalentsView,
  TALENT_CELL_H,
  TALENT_CELL_W,
  TALENT_NODE_SIZE,
  TALENT_TOP_PAD,
} from '../src/ui/talents_view';

// The talents core takes the staged edit buffer + class + total points as inputs and
// derives the whole render model. These tests pin (1) the geometry against the named
// layout constants, (2) the node gating BYTE-FOR-BYTE against validateAllocation (the
// load-bearing correctness point), and (3) the ClientWorld-vs-Sim seed
// parity. The buffer is a LOCAL clone, so the parity surface is the seed read, not a
// per-frame IWorld field.

const CLS: PlayerClass = 'warrior';
const TOTAL = 11; // talentPointsAtLevel(20): a full level-cap budget.
const CLASSES_WITH_TREES = Object.keys(TALENTS) as PlayerClass[];

const centerX = (n: TalentNode): number => n.col * TALENT_CELL_W + TALENT_CELL_W / 2;
const centerY = (n: TalentNode): number =>
  n.row * TALENT_CELL_H + TALENT_TOP_PAD + TALENT_NODE_SIZE / 2;

describe('talents_view layout constants', () => {
  it('exposes the named tree-layout constants the painter consumes (no bare numbers)', () => {
    expect(TALENT_CELL_W).toBe(86);
    expect(TALENT_CELL_H).toBe(70);
    expect(TALENT_NODE_SIZE).toBe(46);
    expect(TALENT_TOP_PAD).toBe(6);
  });
});

describe('buildTalentsView header + geometry', () => {
  it('derives the header counts from an empty staged build', () => {
    const view = buildTalentsView(emptyAllocation(), CLS, TOTAL);
    expect(view.hasTree).toBe(true);
    expect(view.total).toBe(TOTAL);
    expect(view.spent).toBe(0);
    expect(view.available).toBe(TOTAL);
    expect(view.classSpent).toBe(0);
    expect(view.specSpent).toBe(0);
    expect(view.valid).toBe(true);
    expect(view.specs.length).toBe(talentsFor(CLS)!.specs.length);
    expect(view.selectedSpec).toBeNull();
    expect(view.specTree).toBeNull();
  });

  it('sizes the class tree and node boxes from the layout constants', () => {
    const view = buildTalentsView(emptyAllocation(), CLS, TOTAL);
    const ct = talentsFor(CLS)!;
    const classNodes = ct.nodes.filter((n) => n.tree === 'class');
    const cols = Math.max(...classNodes.map((n) => n.col)) + 1;
    const rows = Math.max(...classNodes.map((n) => n.row)) + 1;
    expect(view.classTree.empty).toBe(false);
    expect(view.classTree.width).toBe(cols * TALENT_CELL_W);
    expect(view.classTree.height).toBe(rows * TALENT_CELL_H + TALENT_TOP_PAD);
    const vm = view.classTree.nodes[0];
    expect(vm.left).toBe(vm.node.col * TALENT_CELL_W + (TALENT_CELL_W - TALENT_NODE_SIZE) / 2);
    expect(vm.top).toBe(vm.node.row * TALENT_CELL_H + TALENT_TOP_PAD);
  });
});

describe('buildTalentsView node gating matches validateAllocation byte-for-byte', () => {
  it('marks every empty-build node avail/locked exactly as the spend check would', () => {
    const view = buildTalentsView(emptyAllocation(), CLS, TOTAL);
    for (const vm of view.classTree.nodes) {
      const n = vm.node;
      const cand = cloneAllocation(emptyAllocation());
      cand.ranks[n.id] = 1;
      if (n.kind === 'choice' && n.choices?.[0]) cand.choices[n.id] = n.choices[0].id;
      const canAdd = 0 < n.maxRank && validateAllocation(CLS, cand, TOTAL).ok;
      expect(vm.ranks).toBe(0);
      expect(vm.state).toBe(canAdd ? 'avail' : 'locked');
      expect(vm.disabled).toBe(!canAdd);
    }
  });

  it('reflects filled then maxed state as a node gains ranks', () => {
    const ct = talentsFor(CLS)!;
    const target = ct.nodes.find(
      (n) =>
        n.tree === 'class' &&
        (n.requires?.length ?? 0) === 0 &&
        !n.pointsGate &&
        n.kind !== 'choice',
    );
    expect(target).toBeDefined();
    const one: TalentAllocation = { spec: null, ranks: { [target!.id]: 1 }, choices: {} };
    const view = buildTalentsView(one, CLS, TOTAL);
    const vm = view.classTree.nodes.find((v) => v.node.id === target!.id)!;
    expect(view.spent).toBe(1);
    expect(view.available).toBe(TOTAL - 1);
    expect(view.classSpent).toBe(1);
    expect(vm.ranks).toBe(1);
    expect(vm.state).toBe(target!.maxRank === 1 ? 'maxed' : 'filled');

    const maxed: TalentAllocation = {
      spec: null,
      ranks: { [target!.id]: target!.maxRank },
      choices: {},
    };
    const vMax = buildTalentsView(maxed, CLS, TOTAL).classTree.nodes.find(
      (v) => v.node.id === target!.id,
    )!;
    expect(vMax.state).toBe('maxed');
  });

  it('marks a staged node dormant when its gate/prereq is unmet', () => {
    const ct = talentsFor(CLS)!;
    const gated = ct.nodes.find(
      (n) => n.tree === 'class' && ((n.requires?.length ?? 0) > 0 || (n.pointsGate ?? 0) > 0),
    );
    expect(gated).toBeDefined();
    const alloc: TalentAllocation = { spec: null, ranks: { [gated!.id]: 1 }, choices: {} };
    const vm = buildTalentsView(alloc, CLS, TOTAL).classTree.nodes.find(
      (v) => v.node.id === gated!.id,
    )!;
    expect(vm.state).toBe('dormant');
  });
});

describe('buildTalentsView prereq arrows', () => {
  it('derives arrow geometry from the layout constants and flips filled with the upstream rank', () => {
    // Some trees gate only by points (no prereq edges), so scan for a class with a
    // requires-based class-tree edge and assert on that one.
    let found: { cls: PlayerClass; from: TalentNode; to: TalentNode } | null = null;
    for (const cls of CLASSES_WITH_TREES) {
      const ct = talentsFor(cls)!;
      const dep = ct.nodes.find((n) => n.tree === 'class' && (n.requires?.length ?? 0) > 0);
      if (dep) {
        const from = ct.nodes.find((x) => x.id === dep.requires![0]);
        if (from) {
          found = { cls, from, to: dep };
          break;
        }
      }
    }
    expect(found, 'no class tree with a prereq edge found').not.toBeNull();
    const { cls, from, to } = found!;
    const match = (a: { x1: number; y1: number; x2: number; y2: number }): boolean =>
      a.x1 === centerX(from) &&
      a.y1 === centerY(from) + TALENT_NODE_SIZE / 2 &&
      a.x2 === centerX(to) &&
      a.y2 === centerY(to) - TALENT_NODE_SIZE / 2;

    const base = buildTalentsView(emptyAllocation(), cls, TOTAL).classTree;
    const edge = base.arrows.find(match);
    expect(edge, 'expected a prereq arrow for the discovered edge').toBeDefined();
    expect(edge!.filled).toBe(false);

    const ranked = buildTalentsView(
      { spec: null, ranks: { [from.id]: 1 }, choices: {} },
      cls,
      TOTAL,
    ).classTree;
    expect(ranked.arrows.find(match)!.filled).toBe(true);
  });
});

describe('buildTalentsView is a pure projection', () => {
  it('returns identical structure for identical input (same input -> same output)', () => {
    const spec = talentsFor(CLS)!.specs[0].id;
    const alloc: TalentAllocation = { spec, ranks: {}, choices: {} };
    expect(buildTalentsView(cloneAllocation(alloc), CLS, TOTAL)).toEqual(
      buildTalentsView(cloneAllocation(alloc), CLS, TOTAL),
    );
  });

  it('reports no tree for a class without talents (the coming-soon path)', () => {
    // All 9 real classes have a tree; cast a non-class id to exercise the defensive
    // branch the painter uses to render the "coming soon" empty state.
    const view = buildTalentsView(emptyAllocation(), 'monk' as PlayerClass, TOTAL);
    expect(view.hasTree).toBe(false);
    expect(view.classTree.empty).toBe(true);
    expect(view.specTree).toBeNull();
    expect(view.specs).toEqual([]);
  });
});

describe('ClientWorld-vs-Sim seed parity', () => {
  // The core is fed a (stage, cls, total) bag, but the seed values come from a world
  // (IWorld.talents / IWorld.talentPoints().total). Drive it from BOTH a Sim-shaped
  // and a ClientWorld-mirror-shaped source for those seeds and assert identical render
  // models. The buffer itself is a local clone, so the parity surface is the seed
  // read, not a per-frame IWorld field.
  function simShaped(alloc: TalentAllocation, total: number) {
    return { talents: alloc, talentPoints: () => ({ total, spent: pointsSpent(alloc) }) };
  }
  function clientShaped(alloc: TalentAllocation, total: number) {
    return {
      talents: cloneAllocation(alloc), // mirrored from a server snapshot
      talentPoints(): { total: number; spent: number } {
        return { total, spent: pointsSpent(this.talents) };
      },
    };
  }

  it('yields identical views from a Sim-shaped and a ClientWorld-mirror-shaped seed', () => {
    const ct = talentsFor(CLS)!;
    const seed: TalentAllocation = { spec: ct.specs[0].id, ranks: {}, choices: {} };
    // spend a spec point so the spec tree + tab pips are exercised, not just empties
    const specNode = ct.nodes.find(
      (n) =>
        n.tree === 'spec' &&
        n.specId === ct.specs[0].id &&
        (n.requires?.length ?? 0) === 0 &&
        !n.pointsGate &&
        n.kind !== 'choice',
    );
    if (specNode) seed.ranks[specNode.id] = 1;

    const simW = simShaped(seed, TOTAL);
    const cliW = clientShaped(seed, TOTAL);
    const simView = buildTalentsView(cloneAllocation(simW.talents), CLS, simW.talentPoints().total);
    const cliView = buildTalentsView(cloneAllocation(cliW.talents), CLS, cliW.talentPoints().total);
    expect(simView).toEqual(cliView);
  });
});
