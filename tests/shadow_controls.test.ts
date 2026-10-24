import { describe, expect, it, vi } from 'vitest';
import {
  type ShadowControlWorld,
  shadowChooseSlot,
  shadowControlsActive,
  shadowPickpocketTarget,
} from '../src/game/shadow_controls';
import { SHADOW_GUARDS, SHADOW_QUEST_ID } from '../src/sim/content/world_quest_shadow';
import { t } from '../src/ui/i18n';
import { createShadowActionBarView, shadowActionHint } from '../src/ui/world_quest_shadow_view';

function rig() {
  const progress = {
    questId: SHADOW_QUEST_ID,
    state: 'active',
    count: 0,
    creditedObjects: [] as string[],
    shadow: { phase: 'cloaked', suspicion: 0, cooldown: 0, stealing: undefined as unknown },
  };
  const world = {
    player: { dead: false, pos: { x: 0, y: 0, z: 0 }, targetId: null as number | null },
    entities: new Map(
      SHADOW_GUARDS.map((g, i) => [
        g.entityId,
        {
          id: g.entityId,
          kind: 'npc',
          facing: Math.PI / 2,
          dead: false,
          pos: { x: 1 + i * 0.1, y: 0, z: 0 },
        },
      ]),
    ),
    worldQuestLog: new Map([[SHADOW_QUEST_ID, progress]]),
    shadowWorldQuestAction: vi.fn(),
  };
  return { world: world as unknown as ShadowControlWorld, progress, raw: world };
}
describe('shadow action controls', () => {
  it('prefers a selected guard, excludes sentries and already stolen orders', () => {
    const { world, raw, progress } = rig();
    raw.player.targetId = SHADOW_GUARDS[2].entityId;
    expect(shadowPickpocketTarget(world)).toBe(SHADOW_GUARDS[2].entityId);
    progress.creditedObjects.push(String(SHADOW_GUARDS[2].entityId));
    raw.player.targetId = SHADOW_GUARDS[4].entityId;
    expect(shadowPickpocketTarget(world)).toBe(SHADOW_GUARDS[0].entityId);
  });
  it('sends one channel start and never leaks ordinary action slots', () => {
    const { world, raw, progress } = rig();
    shadowChooseSlot(world, 0);
    expect(raw.shadowWorldQuestAction).toHaveBeenCalledWith(
      'pickpocket',
      SHADOW_GUARDS[0].entityId,
    );
    progress.shadow.stealing = { remaining: 1 };
    shadowChooseSlot(world, 0);
    shadowChooseSlot(world, 4);
    expect(raw.shadowWorldQuestAction).toHaveBeenCalledTimes(1);
    shadowChooseSlot(world, 1);
    expect(raw.shadowWorldQuestAction).toHaveBeenLastCalledWith('leave');
  });
  it('rejects stolen orders, vertical separation and suspicious or distant steals', () => {
    const { world, raw, progress } = rig();
    progress.shadow.suspicion = 0.2;
    shadowChooseSlot(world, 0);
    progress.shadow.suspicion = 0;
    raw.player.pos.y = 4;
    shadowChooseSlot(world, 0);
    raw.player.pos.y = 0;
    progress.creditedObjects = SHADOW_GUARDS.filter((guard) => !guard.sentry).map((guard) =>
      String(guard.entityId),
    );
    shadowChooseSlot(world, 0);
    expect(raw.shadowWorldQuestAction).not.toHaveBeenCalled();
  });
  it('restores control after caught/completed/death and rejects unavailable targets', () => {
    const { world, raw, progress } = rig();
    progress.shadow.phase = 'caught';
    expect(shadowControlsActive(world)).toBe(false);
    shadowChooseSlot(world, 0);
    progress.shadow.phase = 'cloaked';
    raw.player.dead = true;
    shadowChooseSlot(world, 1);
    expect(raw.shadowWorldQuestAction).not.toHaveBeenCalled();
    raw.player.dead = false;
    raw.player.pos.x = 100;
    expect(shadowPickpocketTarget(world)).toBeUndefined();
    progress.state = 'completed';
    expect(shadowControlsActive(world)).toBe(false);
  });
  it('reuses the action family state and disables only pickpocket during cooldown', () => {
    const { world, progress } = rig();
    const view = createShadowActionBarView();
    const state = view.tick(world, (i) => String(i + 1));
    expect(state.slots[0].usable).toBe(true);
    expect(state.slots[0].keybindLabel).toBe('1');
    progress.shadow.cooldown = 2;
    expect(view.tick(world, () => '').slots).toBe(state.slots);
    expect(state.slots[0].usable).toBe(false);
    expect(state.slots[1].usable).toBe(true);
  });
});

it('disables theft at the front and explains the rear opening before enabling it behind', () => {
  const { world, raw } = rig();
  const target = raw.entities.get(SHADOW_GUARDS[0].entityId)!;
  raw.player.targetId = target.id;
  target.facing = -Math.PI / 2;
  const view = createShadowActionBarView();
  expect(shadowPickpocketTarget(world)).toBeUndefined();
  expect(view.tick(world, () => '').slots[0].usable).toBe(false);
  expect(shadowActionHint(world)).toBe(t('questUi.worldQuest.shadow.behind'));
  target.facing = Math.PI / 2;
  expect(shadowPickpocketTarget(world)).toBe(target.id);
  expect(view.tick(world, () => '').slots[0].usable).toBe(true);
});
