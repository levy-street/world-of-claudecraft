// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  type ControllerPromptResolveInput,
  createBootcampConfirmClaim,
  createControllerPromptCoordinator,
  resolveControllerWorldPrompt,
} from '../src/game/controller_prompt_coordinator';
import { FISHING_CAST_ID } from '../src/sim/types';

const base = (): ControllerPromptResolveInput => ({
  padActive: true,
  virtualMouse: false,
  confirmLabel: 'A',
  uiFocused: false,
  death: false,
  crossHotbar: false,
  crossHotbarEdit: false,
  bootcamp: false,
  groundAim: null,
  fishing: null,
  bgFlag: null,
  nearby: null,
  gatherWorldPoint: null,
});

describe('controller prompt resolution', () => {
  it('is controller-owned only and immediately suppresses virtual mouse', () => {
    expect(resolveControllerWorldPrompt({ ...base(), padActive: false })).toBeNull();
    expect(resolveControllerWorldPrompt({ ...base(), virtualMouse: true })).toBeNull();
  });

  it('honors specialized claims before UI and world actions', () => {
    for (const [field, claimedBy] of [
      ['death', 'death'],
      ['crossHotbarEdit', 'crossHotbarEdit'],
      ['crossHotbar', 'crossHotbar'],
      ['bootcamp', 'bootcamp'],
    ] as const) {
      const frame = resolveControllerWorldPrompt({
        ...base(),
        [field]: true,
        nearby: {
          interactionKind: 'npc',
          anchor: { kind: 'entity', entityId: 4 },
          name: {
            kind: 'entity',
            entityKind: 'npc',
            templateId: 'merchant',
            objectItemId: null,
            dungeonId: null,
            sourceName: 'Merchant',
          },
          eligible: true,
        },
      });
      expect(frame).toMatchObject({ padActive: true, claimedBy, action: null });
    }
  });

  it('uses UI focus, ground aim, fishing, flag, then nearby priority', () => {
    const nearby = {
      interactionKind: 'npc' as const,
      anchor: { kind: 'entity' as const, entityId: 7 },
      name: {
        kind: 'entity' as const,
        entityKind: 'npc' as const,
        templateId: 'questgiver',
        objectItemId: null,
        dungeonId: null,
        sourceName: 'Questgiver',
      },
      eligible: true as const,
    };
    const rich = {
      ...base(),
      groundAim: { point: { x: 2, y: 3, z: 4 }, blocked: true },
      fishing: { point: { x: 5, y: 6, z: 7 } },
      bgFlag: {
        interactionKind: 'bgFlag' as const,
        anchor: { kind: 'entity' as const, entityId: 6 },
        team: 1 as const,
        eligible: true as const,
      },
      nearby,
    };
    expect(resolveControllerWorldPrompt({ ...rich, uiFocused: true })?.action).toBeNull();
    expect(resolveControllerWorldPrompt(rich)?.action).toMatchObject({
      kind: 'confirm',
      anchor: { kind: 'world', id: 'ground-aim' },
      blocked: true,
    });
    expect(resolveControllerWorldPrompt({ ...rich, groundAim: null })?.action?.anchor).toEqual({
      kind: 'world',
      id: 'fishingBobber',
    });
    expect(
      resolveControllerWorldPrompt({ ...rich, groundAim: null, fishing: null })?.action?.anchor,
    ).toEqual({ kind: 'entity', entityId: 6 });
    expect(
      resolveControllerWorldPrompt({ ...rich, groundAim: null, fishing: null, bgFlag: null })
        ?.action?.anchor,
    ).toEqual({ kind: 'entity', entityId: 7 });
  });

  it('marks an in-range but ineligible gather node blocked and anchors it in the world', () => {
    const frame = resolveControllerWorldPrompt({
      ...base(),
      nearby: {
        interactionKind: 'gather',
        anchor: { kind: 'gatherNode', nodeId: 'copper-1' },
        name: { kind: 'gatherNode', nodeType: 'ore', nodeTier: 1 },
        eligible: false,
        verdict: 'not_ready',
        nodePos: { x: 11, z: 12 },
      },
      gatherWorldPoint: { x: 11, y: 2.5, z: 12 },
    });
    expect(frame).toMatchObject({
      action: {
        buttonLabel: 'A',
        anchor: { kind: 'gatherNode', nodeId: 'copper-1' },
        blocked: true,
      },
      worldPoint: { x: 11, y: 2.5, z: 12 },
    });
  });

  it('keeps a null semantic label when Confirm is unbound', () => {
    expect(
      resolveControllerWorldPrompt({
        ...base(),
        confirmLabel: null,
        nearby: {
          interactionKind: 'npc',
          anchor: { kind: 'entity', entityId: 3 },
          name: {
            kind: 'entity',
            entityKind: 'npc',
            templateId: 'npc',
            objectItemId: null,
            dungeonId: null,
            sourceName: 'NPC',
          },
          eligible: true,
        },
      })?.action?.buttonLabel,
    ).toBeNull();
  });
});

describe('controller fishing prompt lifecycle', () => {
  it('starts only on the personal bite and clears on terminal events, cast end, death, and reset', () => {
    let castingAbility: string | null = FISHING_CAST_ID;
    let dead = false;
    const coordinator = createControllerPromptCoordinator({
      playerId: () => 4,
      castingAbility: () => castingAbility,
      playerDead: () => dead,
      resolve: () => base(),
    });

    expect(coordinator.fishingLifecycle()).toBe('idle');
    coordinator.onEvents([{ type: 'fishingBite', pid: 8 }]);
    expect(coordinator.fishingLifecycle()).toBe('waiting');
    coordinator.onEvents([{ type: 'fishingBite', pid: 4 }]);
    expect(coordinator.fishingLifecycle()).toBe('bite');
    coordinator.onEvents([{ type: 'fishingGotAway', pid: 4, zoneId: 'z', band: 0 }]);
    expect(coordinator.fishingLifecycle()).toBe('idle');

    coordinator.onEvents([{ type: 'fishingBite', pid: 4 }]);
    castingAbility = null;
    coordinator.frame();
    expect(coordinator.fishingLifecycle()).toBe('idle');

    castingAbility = FISHING_CAST_ID;
    coordinator.onEvents([{ type: 'fishingBite', pid: 4 }]);
    dead = true;
    coordinator.frame();
    expect(coordinator.fishingLifecycle()).toBe('idle');

    dead = false;
    coordinator.onEvents([{ type: 'fishingBite', pid: 4 }]);
    coordinator.reset();
    expect(coordinator.fishingLifecycle()).toBe('idle');
  });

  it('passes bite state into live resolution without side effects', () => {
    const resolve = vi.fn(() => base());
    const coordinator = createControllerPromptCoordinator({
      playerId: () => 1,
      castingAbility: () => FISHING_CAST_ID,
      playerDead: () => false,
      resolve,
    });
    coordinator.onEvents([{ type: 'fishingBite', pid: 1 }]);
    coordinator.frame();
    expect(resolve).toHaveBeenCalledWith('bite');
  });
});

describe('bootcamp Confirm claim', () => {
  it('claims only a visible prompt carrying the same live Confirm glyph', () => {
    document.body.innerHTML =
      '<div class="tut-prompt" style="display:flex"><span class="tut-keycap">A</span></div>';
    let label: string | null = 'A';
    const claimed = createBootcampConfirmClaim(() => label);
    expect(claimed()).toBe(true);
    label = 'X';
    expect(claimed()).toBe(false);
    (document.querySelector('.tut-prompt') as HTMLElement).style.display = 'none';
    label = 'A';
    expect(claimed()).toBe(false);
    document.body.classList.add('bc-coach-up');
    expect(claimed()).toBe(false);
  });
});
