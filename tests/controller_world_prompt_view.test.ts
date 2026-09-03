import { describe, expect, it } from 'vitest';
import {
  CONTROLLER_WORLD_PROMPT_FALLBACK_BOTTOM_PX,
  type ControllerWorldPromptAction,
  type ControllerWorldPromptAnchor,
  type ControllerWorldPromptFrame,
  type ControllerWorldPromptScreenAnchor,
  controllerWorldPromptAnchorEquals,
  controllerWorldPromptPlanInto,
  newControllerWorldPromptPlan,
} from '../src/render/controller_world_prompt_view';

const entityAnchor: ControllerWorldPromptAnchor = { kind: 'entity', entityId: 42 };
const gatherAnchor: ControllerWorldPromptAnchor = { kind: 'gatherNode', nodeId: 'mine:iron:7' };
const reticleAnchor: ControllerWorldPromptAnchor = { kind: 'world', id: 'groundReticle' };

function action(
  anchor: ControllerWorldPromptAnchor = entityAnchor,
  buttonLabel: string | null = 'A',
): ControllerWorldPromptAction {
  return { kind: 'confirm', buttonLabel, anchor, blocked: false };
}

function frame(promptAction: ControllerWorldPromptAction | null): ControllerWorldPromptFrame {
  return { padActive: true, claimedBy: null, action: promptAction };
}

function screenAnchor(
  anchor: ControllerWorldPromptAnchor,
  x: number,
  y: number,
): ControllerWorldPromptScreenAnchor {
  return { anchor, x, y };
}

function resolve(
  promptFrame: ControllerWorldPromptFrame | null,
  labelAnchor: ControllerWorldPromptScreenAnchor | null = null,
  worldAnchor: ControllerWorldPromptScreenAnchor | null = null,
) {
  return controllerWorldPromptPlanInto(newControllerWorldPromptPlan(), {
    frame: promptFrame,
    labelAnchor,
    worldAnchor,
    viewportWidth: 1280,
    viewportHeight: 720,
  });
}

describe('controller world prompt view', () => {
  it('prefers the matching visible label over the projected world point', () => {
    const plan = resolve(
      frame(action()),
      screenAnchor(entityAnchor, 604, 238),
      screenAnchor(entityAnchor, 620, 300),
    );

    expect(plan).toEqual({
      hidden: false,
      actionKind: 'confirm',
      buttonLabel: 'A',
      placement: 'label',
      x: 604,
      y: 238,
    });
  });

  it('uses only anchors with the same entity or string node identity', () => {
    const entityPlan = resolve(
      frame(action(entityAnchor)),
      screenAnchor({ kind: 'entity', entityId: 7 }, 100, 100),
      screenAnchor(entityAnchor, 410, 220),
    );
    const gatherPlan = resolve(
      frame(action(gatherAnchor)),
      screenAnchor(entityAnchor, 100, 100),
      screenAnchor(gatherAnchor, 510, 260),
    );

    expect(entityPlan.placement).toBe('world');
    expect(entityPlan.x).toBe(410);
    expect(gatherPlan.placement).toBe('world');
    expect(gatherPlan.x).toBe(510);
    expect(controllerWorldPromptAnchorEquals(entityAnchor, { kind: 'entity', entityId: 42 })).toBe(
      true,
    );
    expect(
      controllerWorldPromptAnchorEquals(gatherAnchor, {
        kind: 'gatherNode',
        nodeId: 'mine:iron:7',
      }),
    ).toBe(true);
    expect(controllerWorldPromptAnchorEquals(entityAnchor, gatherAnchor)).toBe(false);
    expect(
      controllerWorldPromptAnchorEquals(reticleAnchor, { kind: 'world', id: 'groundReticle' }),
    ).toBe(true);
  });

  it('falls back to bottom center when every matching projection is offscreen', () => {
    const plan = resolve(
      frame(action()),
      screenAnchor(entityAnchor, -1, 240),
      screenAnchor(entityAnchor, 1281, 400),
    );

    expect(plan.placement).toBe('fallback');
    expect(plan.x).toBe(640);
    expect(plan.y).toBe(720 - CONTROLLER_WORLD_PROMPT_FALLBACK_BOTTOM_PX);
  });

  it.each(['A', 'Cross', 'B', 'Triangle'])('passes through the live remapped %s label', (label) => {
    const promptAction = action(entityAnchor, label);
    promptAction.kind = label === 'Triangle' ? 'subcommands' : 'confirm';

    const plan = resolve(frame(promptAction), screenAnchor(entityAnchor, 600, 200));

    expect(plan.buttonLabel).toBe(label);
    expect(plan.actionKind).toBe(promptAction.kind);
  });

  it('hides an unbound action instead of inventing an A or X label', () => {
    expect(resolve(frame(action(entityAnchor, null))).hidden).toBe(true);
  });

  it.each(['death', 'crossHotbar', 'crossHotbarEdit', 'bootcamp'] as const)(
    'yields to the %s specialized surface',
    (claimedBy) => {
      const claimedFrame = frame(action());
      claimedFrame.claimedBy = claimedBy;

      expect(resolve(claimedFrame).hidden).toBe(true);
    },
  );

  it('suppresses blocked actions and keyboard, mouse, or touch handoff', () => {
    const blocked = action();
    blocked.blocked = true;
    const handedOff = frame(action());
    handedOff.padActive = false;

    expect(resolve(frame(blocked)).hidden).toBe(true);
    expect(resolve(handedOff).hidden).toBe(true);
  });

  it('fully resets caller-owned output when the next frame has no action', () => {
    const out = newControllerWorldPromptPlan();
    controllerWorldPromptPlanInto(out, {
      frame: frame(action()),
      labelAnchor: screenAnchor(entityAnchor, 604, 238),
      worldAnchor: null,
      viewportWidth: 1280,
      viewportHeight: 720,
    });
    controllerWorldPromptPlanInto(out, {
      frame: frame(null),
      labelAnchor: null,
      worldAnchor: null,
      viewportWidth: 1280,
      viewportHeight: 720,
    });

    expect(out).toEqual({
      hidden: true,
      actionKind: 'confirm',
      buttonLabel: '',
      placement: 'fallback',
      x: 0,
      y: 0,
    });
  });
});
