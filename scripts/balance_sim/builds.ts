// Build and gear generation for the balance simulator. Builds are GENERATED,
// not hand authored, so all 27 specs get the same methodology: pick the spec,
// then greedily fill the point budget one validated point at a time, spec tree
// first (the spec identity nodes and ability grants), then the class tree.
// Mirrors defaultBuild() in src/sim/content/talents.ts, which fills class-first
// and only ever picks each class's first spec.

import {
  emptyAllocation,
  type TalentAllocation,
  type TalentNode,
  talentsFor,
  validateAllocation,
} from '../../src/sim/content/talents';
import { ITEMS } from '../../src/sim/data';
import { canEquipItem } from '../../src/sim/equipment_rules';
import { meetsLevelRequirement } from '../../src/sim/item_level_req';
import type { EquipSlot, ItemDef, PlayerClass } from '../../src/sim/types';
import type { BalanceSpec } from './spec_catalog';

export function specBuild(cls: PlayerClass, specId: string, points: number): TalentAllocation {
  const ct = talentsFor(cls);
  if (!ct) return emptyAllocation();
  if (!ct.specs.some((s) => s.id === specId)) return emptyAllocation();
  const alloc: TalentAllocation = { spec: specId, ranks: {}, choices: {} };
  const order = [...ct.nodes].sort((a, b) => {
    if (a.tree !== b.tree) return a.tree === 'spec' ? -1 : 1;
    return a.row - b.row || a.col - b.col;
  });
  let spent = 0;
  // Two greedy passes: gates can lock a spec row until class-tree points exist,
  // so a single sweep may strand budget that a second sweep can place.
  for (let pass = 0; pass < 2 && spent < points; pass++) {
    for (const node of order) {
      if (spent >= points) break;
      if (node.tree === 'spec' && node.specId !== specId) continue;
      spent = fillNode(cls, alloc, node, points, spent);
    }
  }
  return alloc;
}

function fillNode(
  cls: PlayerClass,
  alloc: TalentAllocation,
  node: TalentNode,
  points: number,
  spent: number,
): number {
  while (spent < points) {
    const cur = alloc.ranks[node.id] ?? 0;
    if (node.kind === 'choice') {
      if (cur >= 1) return spent;
      const opt = node.choices?.[0];
      if (!opt) return spent;
      alloc.choices[node.id] = opt.id;
      alloc.ranks[node.id] = 1;
      if (validateAllocation(cls, alloc, points).ok) return spent + 1;
      delete alloc.ranks[node.id];
      delete alloc.choices[node.id];
      return spent;
    }
    if (cur >= node.maxRank) return spent;
    alloc.ranks[node.id] = cur + 1;
    if (validateAllocation(cls, alloc, points).ok) {
      spent++;
      continue;
    }
    if (cur === 0) delete alloc.ranks[node.id];
    else alloc.ranks[node.id] = cur;
    return spent;
  }
  return spent;
}

// Knockout variants for talent attribution: the build minus one node, with the
// node's dependents pruned so the allocation stays legal. The winrate delta of
// a knockout against the full build measures how much that one talent carries.
export interface KnockoutBuild {
  nodeId: string;
  alloc: TalentAllocation;
}

export function knockoutBuilds(
  cls: PlayerClass,
  base: TalentAllocation,
  points: number,
): KnockoutBuild[] {
  const ct = talentsFor(cls);
  if (!ct) return [];
  const out: KnockoutBuild[] = [];
  const spentNodes = Object.keys(base.ranks)
    .filter((id) => (base.ranks[id] ?? 0) > 0)
    .sort();
  for (const nodeId of spentNodes) {
    const alloc: TalentAllocation = {
      spec: base.spec,
      ranks: { ...base.ranks },
      choices: { ...base.choices },
    };
    delete alloc.ranks[nodeId];
    delete alloc.choices[nodeId];
    pruneInvalid(cls, alloc, points);
    if (validateAllocation(cls, alloc, points).ok) out.push({ nodeId, alloc });
  }
  return out;
}

// Drop ranks until the allocation validates: removing a prerequisite or a
// points-gate contributor can orphan downstream nodes, and validateAllocation
// names the offender, so peel offenders until the build is legal again.
function pruneInvalid(cls: PlayerClass, alloc: TalentAllocation, points: number): void {
  const ct = talentsFor(cls);
  if (!ct) return;
  const idx = new Map(ct.nodes.map((n) => [n.id, n]));
  for (let guard = 0; guard < 64; guard++) {
    if (validateAllocation(cls, alloc, points).ok) return;
    let dropped = false;
    for (const id of Object.keys(alloc.ranks).sort()) {
      const node = idx.get(id);
      if (!node) {
        delete alloc.ranks[id];
        dropped = true;
        continue;
      }
      const missingReq = (node.requires ?? []).some((req) => (alloc.ranks[req] ?? 0) <= 0);
      if (missingReq) {
        delete alloc.ranks[id];
        delete alloc.choices[id];
        dropped = true;
      }
    }
    if (!dropped) {
      // No structural offender left: the budget itself is over, trim the last node.
      const ids = Object.keys(alloc.ranks).sort();
      const last = ids[ids.length - 1];
      if (last === undefined) return;
      delete alloc.ranks[last];
      delete alloc.choices[last];
    }
  }
}

// Stat-weight gearing per spec archetype, following the equipBest heuristic in
// scripts/nythraxis_matrix.ts. Weapon dps dominates for physical specs; casters
// and healers weigh int/spi. Level-gated so low-level sweeps do not equip inert
// over-level gear (recalcPlayerStats ignores items above the wearer's level).
const GEAR_SLOTS: EquipSlot[] = [
  'mainhand',
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
];

export function gearScore(item: ItemDef, spec: BalanceSpec): number {
  const s = item.stats ?? {};
  const weapon = item.weapon ? (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed : 0;
  const sp = 'spellPower' in item ? (item.spellPower ?? 0) : 0;
  if (spec.kind === 'healer') {
    return (
      weapon +
      sp * 2 +
      (s.int ?? 0) * 5.4 +
      (s.spi ?? 0) * 4.4 +
      (s.sta ?? 0) * 0.8 +
      (s.armor ?? 0) * 0.004
    );
  }
  if (spec.kind === 'caster') {
    return (
      weapon * 2 +
      sp * 3 +
      (s.int ?? 0) * 4.6 +
      (s.spi ?? 0) * 1.8 +
      (s.sta ?? 0) * 0.6 +
      (s.armor ?? 0) * 0.003
    );
  }
  if (spec.kind === 'tank') {
    return (
      weapon * 5 +
      (s.sta ?? 0) * 5 +
      (s.str ?? 0) * 3 +
      (s.agi ?? 0) * 2 +
      (s.int ?? 0) * (spec.cls === 'paladin' || spec.cls === 'druid' ? 1.2 : 0) +
      (s.armor ?? 0) * 0.08
    );
  }
  return (
    weapon * 8 +
    (s.str ?? 0) * 3 +
    (s.agi ?? 0) * 3 +
    (s.sta ?? 0) +
    (s.int ?? 0) * (spec.cls === 'paladin' || spec.cls === 'shaman' ? 1.5 : 0) +
    (s.armor ?? 0) * 0.01
  );
}

// Deterministic best-in-slot pick per gear slot for a spec at a level. Pure so
// the build test can assert legality without spinning a Sim.
export function bestGearFor(spec: BalanceSpec, level: number): Partial<Record<EquipSlot, string>> {
  const out: Partial<Record<EquipSlot, string>> = {};
  for (const slot of GEAR_SLOTS) {
    const best = Object.keys(ITEMS)
      .sort()
      .map((id) => ITEMS[id])
      .filter(
        (item) =>
          item.slot === slot &&
          (item.kind === 'weapon' || item.kind === 'armor') &&
          canEquipItem(spec.cls, item) &&
          meetsLevelRequirement(level, item),
      )
      .sort((a, b) => gearScore(b, spec) - gearScore(a, spec) || a.id.localeCompare(b.id))[0];
    if (best) out[slot] = best.id;
  }
  return out;
}
