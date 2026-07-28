import { describe, expect, it } from 'vitest';
import {
  articulatedRigLimit,
  createRigBudgetScratch,
  isRigBudgetActionable,
  planArticulatedRigs,
  type RigBudgetCandidate,
  type RigBudgetDecision,
  type RigBudgetEntityState,
  type RigBudgetPresentationState,
  requiresLocalCharacterVisual,
  resolveRigBudgetRenderMode,
  rigBudgetPriority,
  shouldHidePendingLocalCharacterVisual,
  writeRigBudgetCandidate,
} from '../src/render/articulated_rig_budget_core';
import { planPlayerRigResidency } from '../src/render/player_rig_residency_core';

describe('articulated rig budget', () => {
  it('preserves every actionable pose outside the ordinary rig ceiling', () => {
    const decisions: RigBudgetDecision[] = [];
    planArticulatedRigs(
      [
        { id: 1, distanceSq: 1000, priority: 0, actionable: true },
        { id: 2, distanceSq: 1, priority: 0, actionable: false },
        { id: 3, distanceSq: 4, priority: 0, actionable: false },
        { id: 4, distanceSq: 9, priority: 0, actionable: false },
      ],
      1,
      1,
      decisions,
      createRigBudgetScratch(),
    );
    expect(decisions).toEqual([
      { id: 1, mode: 'rig' },
      { id: 2, mode: 'rig' },
      { id: 3, mode: 'localFar' },
      { id: 4, mode: 'batchedFar' },
    ]);
  });

  it('keeps ordinary articulated rigs bounded and prioritizes players before mobs and NPCs', () => {
    const decisions: RigBudgetDecision[] = [];
    expect(['player', 'mob', 'npc', 'object'].map(rigBudgetPriority)).toEqual([0, 1, 2, null]);
    planArticulatedRigs(
      [
        { id: 30, distanceSq: 1, priority: 2, actionable: false },
        { id: 20, distanceSq: 4, priority: 1, actionable: false },
        { id: 10, distanceSq: 9, priority: 0, actionable: false },
        { id: 11, distanceSq: 16, priority: 0, actionable: false },
      ],
      2,
      1,
      decisions,
      createRigBudgetScratch(),
    );

    expect(decisions).toEqual([
      { id: 10, mode: 'rig' },
      { id: 11, mode: 'rig' },
      { id: 20, mode: 'localFar' },
      { id: 30, mode: 'batchedFar' },
    ]);
    expect(decisions.filter((decision) => decision.mode === 'rig')).toHaveLength(2);
  });

  it('keeps an 80-character ordinary crowd inside the planner tiers', () => {
    const decisions: RigBudgetDecision[] = [];
    planArticulatedRigs(
      Array.from({ length: 80 }, (_, index) => ({
        id: index + 1,
        distanceSq: index + 1,
        priority: index < 40 ? 0 : index < 60 ? 1 : 2,
        actionable: false,
      })),
      16,
      4,
      decisions,
      createRigBudgetScratch(),
    );

    expect(decisions.filter((decision) => decision.mode === 'rig')).toHaveLength(16);
    expect(decisions.filter((decision) => decision.mode === 'localFar')).toHaveLength(4);
    expect(decisions.filter((decision) => decision.mode === 'batchedFar')).toHaveLength(60);
  });

  it('limits fairness exemptions to actionable poses inside the actionable range', () => {
    expect(isRigBudgetActionable(42 * 42, 58 * 58, 8, 1, null, 'fireball')).toBe(true);
    expect(isRigBudgetActionable(59 * 59, 58 * 58, 8, 1, null, 'fireball')).toBe(false);
    expect(isRigBudgetActionable(10 * 10, 58 * 58, 8, 1, null, null, true)).toBe(false);
    expect(isRigBudgetActionable(10 * 10, 58 * 58, 8, 1, null, null)).toBe(false);
  });

  it('keeps non-player overflow on its static far mesh instead of a player-only batch', () => {
    expect(resolveRigBudgetRenderMode('player', 'batchedFar', true)).toBe('batchedFar');
    expect(resolveRigBudgetRenderMode('mob', 'batchedFar', true)).toBe('localFar');
    expect(resolveRigBudgetRenderMode('npc', 'batchedFar', true)).toBe('localFar');
    expect(resolveRigBudgetRenderMode('player', 'batchedFar', true, true)).toBe('localFar');
    expect(resolveRigBudgetRenderMode('player', 'batchedFar', false, true)).toBe('localFar');
    expect(shouldHidePendingLocalCharacterVisual('player', true, true)).toBe(true);
    expect(shouldHidePendingLocalCharacterVisual('player', false, true)).toBe(false);
    expect(shouldHidePendingLocalCharacterVisual('mob', true, true)).toBe(false);
    expect(resolveRigBudgetRenderMode('object', undefined, false)).toBeUndefined();
  });

  it('composes mixed crowd candidates without broad noisy fairness exemptions', () => {
    type TestEntity = RigBudgetEntityState &
      RigBudgetPresentationState & {
        distanceSq: number;
        combatTargetOwnerId: number | null;
        hasVisual: boolean;
        visibleToLocalPlayer: boolean;
        partyMember: boolean;
        hostilePlayer: boolean;
        hostile: boolean;
        overheadEmoteId: number | null;
        partyMemberLike: boolean;
        expectedIncluded: boolean;
        expectedActionable: boolean;
        expectedLocalVisual: boolean;
      };
    const makeEntity = (
      id: number,
      kind: string,
      overrides: Partial<TestEntity> = {},
    ): TestEntity => ({
      id,
      kind,
      distanceSq: id * id,
      castingAbility: null,
      inCombat: false,
      ownerId: null,
      targetId: null,
      aggroTargetId: null,
      combatTargetOwnerId: null,
      hasVisual: true,
      visibleToLocalPlayer: true,
      partyMember: false,
      hostilePlayer: false,
      hostile: false,
      overheadEmoteId: null,
      partyMemberLike: false,
      dead: false,
      auras: [],
      expectedIncluded: true,
      expectedActionable: false,
      expectedLocalVisual: false,
      ...overrides,
    });

    const maxDistanceSq = 58 * 58;
    const entities = [
      makeEntity(1, 'player', { expectedActionable: true }),
      makeEntity(2, 'mob', { expectedActionable: true }),
      makeEntity(3, 'npc', {
        castingAbility: 'heal',
        expectedActionable: true,
      }),
      makeEntity(4, 'mob', {
        inCombat: true,
        aggroTargetId: 10,
        combatTargetOwnerId: 1,
        expectedActionable: true,
      }),
      makeEntity(5, 'player', {
        distanceSq: 25,
        hostile: true,
        overheadEmoteId: 7,
        partyMemberLike: true,
        auras: [{ id: 'fortitude', kind: 'stat' }],
      }),
      makeEntity(6, 'player', {
        distanceSq: 59 * 59,
        castingAbility: 'fireball',
      }),
      makeEntity(7, 'mob', { distanceSq: 36 }),
      makeEntity(8, 'npc', { distanceSq: 49 }),
      makeEntity(9, 'object', { expectedIncluded: false }),
      makeEntity(10, 'player', {
        partyMember: true,
      }),
      makeEntity(11, 'player', {
        hostilePlayer: true,
      }),
      makeEntity(12, 'mob', {
        hasVisual: false,
        expectedIncluded: false,
      }),
      makeEntity(13, 'npc', {
        visibleToLocalPlayer: false,
        expectedIncluded: false,
      }),
      makeEntity(14, 'player', {
        distanceSq: 30,
        dead: true,
        auras: [{ id: 'polymorph', kind: 'polymorph' }],
        expectedLocalVisual: true,
      }),
    ];
    const candidates: RigBudgetCandidate[] = [];
    for (const entity of entities) {
      const candidate: RigBudgetCandidate = {
        id: 0,
        distanceSq: 0,
        priority: 0,
        actionable: false,
      };
      const included = writeRigBudgetCandidate(
        candidate,
        entity,
        entity.distanceSq,
        maxDistanceSq,
        1,
        2,
        entity.combatTargetOwnerId,
        entity.hasVisual,
        entity.visibleToLocalPlayer,
      );
      expect(included).toBe(entity.expectedIncluded);
      if (included) {
        expect(candidate.actionable).toBe(entity.expectedActionable);
        expect(requiresLocalCharacterVisual(entity)).toBe(entity.expectedLocalVisual);
        candidates.push(candidate);
      }
    }
    expect(candidates.filter((candidate) => candidate.actionable).map(({ id }) => id)).toEqual([
      1, 2, 3, 4,
    ]);

    const decisions: RigBudgetDecision[] = [];
    planArticulatedRigs(candidates, 1, 0, decisions, createRigBudgetScratch());
    expect(decisions.find(({ id }) => id === 5)?.mode).toBe('rig');
    expect(decisions.find(({ id }) => id === 14)?.mode).toBe('batchedFar');
    expect(decisions.find(({ id }) => id === 7)?.mode).toBe('batchedFar');
    expect(decisions.find(({ id }) => id === 8)?.mode).toBe('batchedFar');

    const effectiveModes = decisions.map((decision) => {
      const entity = entities.find(({ id }) => id === decision.id);
      if (!entity) throw new Error(`missing test entity ${decision.id}`);
      return {
        id: decision.id,
        mode: resolveRigBudgetRenderMode(
          entity.kind,
          decision.mode,
          true,
          requiresLocalCharacterVisual(entity),
        ),
      };
    });
    expect(effectiveModes.find(({ id }) => id === 14)?.mode).toBe('localFar');
    expect(effectiveModes.find(({ id }) => id === 7)?.mode).toBe('localFar');
    expect(effectiveModes.find(({ id }) => id === 8)?.mode).toBe('localFar');
    expect(effectiveModes.filter(({ mode }) => mode === 'rig')).toHaveLength(5);
    expect(effectiveModes.filter(({ mode }) => mode === 'localFar')).toHaveLength(3);
    expect(effectiveModes.filter(({ mode }) => mode === 'batchedFar')).toHaveLength(3);
    expect(
      requiresLocalCharacterVisual({
        dead: false,
        auras: [{ id: 'frost_nova_root', kind: 'root' }],
      }),
    ).toBe(true);
    expect(
      requiresLocalCharacterVisual({
        dead: false,
        auras: [{ id: 'ice_barrier', kind: 'absorb' }],
      }),
    ).toBe(true);
  });

  it('reduces the ceiling with memory and frame pressure', () => {
    expect(articulatedRigLimit('ultra', false, 0)).toBe(32);
    expect(articulatedRigLimit('ultra', true, 1)).toBeLessThan(20);
    expect(articulatedRigLimit('low', true, 1)).toBe(6);
  });

  it('releases batched players and acquires only rig-backed modes', () => {
    const releases: number[] = [];
    const acquires: number[] = [];
    planPlayerRigResidency(
      [
        { id: 1, mode: 'rig' },
        { id: 2, mode: 'localFar' },
        { id: 3, mode: 'batchedFar' },
        { id: 4, mode: 'batchedFar' },
      ],
      new Set([1, 3]),
      releases,
      acquires,
    );
    expect(releases).toEqual([3]);
    expect(acquires).toEqual([2]);
  });
});
