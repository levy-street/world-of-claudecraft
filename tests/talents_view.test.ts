import { describe, expect, it } from 'vitest';
import {
  cloneAllocation,
  emptyAllocation,
  FIRST_TALENT_LEVEL,
  pointsSpent,
  TALENTS,
  type TalentAllocation,
  type TalentNode,
  talentsFor,
  validateAllocation,
} from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import { buildTalentsView, tierUnlockLevel } from '../src/ui/talents_view';

// The talents core takes the staged edit buffer + class + total points as inputs and
// derives the whole render model. These tests pin (1) the tiered layout (rows grouped
// into unlock-level tiers, cards ordered by column), (2) the node gating BYTE-FOR-BYTE
// against validateAllocation (the load-bearing correctness point), and (3) the
// ClientWorld-vs-Sim seed parity. The buffer is a LOCAL clone, so the parity surface
// is the seed read, not a per-frame IWorld field.

const CLS: PlayerClass = 'warrior';
const TOTAL = 11; // talentPointsAtLevel(20): a full level-cap budget.
const CLASSES_WITH_TREES = Object.keys(TALENTS) as PlayerClass[];

// The cheapest investment that could unlock a node: its pointsGate, else one rank
// per requires edge, else free (mirrors the core's tier-level derivation).
const minInvest = (n: TalentNode): number => n.pointsGate ?? n.requires?.length ?? 0;

describe('buildTalentsView header counts', () => {
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
});

describe('buildTalentsView tier rows', () => {
  it('groups the class tree into row-keyed tiers with cards in column order', () => {
    const view = buildTalentsView(emptyAllocation(), CLS, TOTAL);
    const ct = talentsFor(CLS)!;
    const classNodes = ct.nodes.filter((n) => n.tree === 'class');
    const rows = [...new Set(classNodes.map((n) => n.row))].sort((a, b) => a - b);
    expect(view.classTree.empty).toBe(false);
    expect(view.classTree.tiers.map((t) => t.row)).toEqual(rows);
    for (const tier of view.classTree.tiers) {
      const expected = classNodes.filter((n) => n.row === tier.row);
      expect(tier.nodes.length).toBe(expected.length);
      const cols = tier.nodes.map((vm) => vm.col);
      expect(cols).toEqual([...cols].sort((a, b) => a - b));
      for (const vm of tier.nodes) expect(vm.col).toBe(vm.node.col);
    }
    // The flat list is the tiers in order (the gating tests below iterate it).
    expect(view.classTree.nodes).toEqual(view.classTree.tiers.flatMap((t) => t.nodes));
  });

  it('keys each tier on its cheapest unlock level (FIRST_TALENT_LEVEL + min invest)', () => {
    const view = buildTalentsView(emptyAllocation(), CLS, TOTAL);
    const ct = talentsFor(CLS)!;
    for (const tier of view.classTree.tiers) {
      const rowNodes = ct.nodes.filter((n) => n.tree === 'class' && n.row === tier.row);
      const invest = Math.min(...rowNodes.map(minInvest));
      expect(tier.level).toBe(FIRST_TALENT_LEVEL + invest);
      expect(tier.level).toBe(tierUnlockLevel(invest));
    }
    // The first tier is free to enter, so it unlocks at the first talent level.
    expect(view.classTree.tiers[0].level).toBe(FIRST_TALENT_LEVEL);
    // Tiers never get cheaper as you go down the tree.
    const levels = view.classTree.tiers.map((t) => t.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it('marks a tier level-locked exactly when the point budget cannot open it', () => {
    const ct = talentsFor(CLS)!;
    // With a single point (level 10) only the free tier is reachable.
    const one = buildTalentsView(emptyAllocation(), CLS, 1);
    for (const tier of one.classTree.tiers) {
      const rowNodes = ct.nodes.filter((n) => n.tree === 'class' && n.row === tier.row);
      const invest = Math.min(...rowNodes.map(minInvest));
      expect(tier.levelLocked).toBe(1 < invest + 1);
    }
    expect(one.classTree.tiers[0].levelLocked).toBe(false);
    expect(one.classTree.tiers.at(-1)!.levelLocked).toBe(true);
    // A full budget opens every tier.
    const full = buildTalentsView(emptyAllocation(), CLS, TOTAL);
    for (const tier of full.classTree.tiers) expect(tier.levelLocked).toBe(false);
  });

  it('tiers every spec tree the same way for every class', () => {
    for (const cls of CLASSES_WITH_TREES) {
      const ct = talentsFor(cls)!;
      for (const sp of ct.specs) {
        const alloc: TalentAllocation = { spec: sp.id, ranks: {}, choices: {} };
        const view = buildTalentsView(alloc, cls, TOTAL);
        const specNodes = ct.nodes.filter((n) => n.tree === 'spec' && n.specId === sp.id);
        expect(view.specTree, `${cls}/${sp.id}`).not.toBeNull();
        expect(view.specTree!.nodes.length).toBe(specNodes.length);
        const rows = [...new Set(specNodes.map((n) => n.row))].sort((a, b) => a - b);
        expect(view.specTree!.tiers.map((t) => t.row)).toEqual(rows);
      }
    }
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
    expect(view.classTree.tiers).toEqual([]);
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
