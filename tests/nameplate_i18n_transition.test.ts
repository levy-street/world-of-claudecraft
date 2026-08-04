// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NameplateCanvasState } from '../src/render/nameplate_canvas';
import type { NameplatePlan } from '../src/render/nameplate_view';
import type { Entity } from '../src/sim/types';

interface ContentResolver {
  world: { markerFor: () => null };
  resolveContent(
    state: NameplateCanvasState,
    entity: Entity,
    player: Entity,
    plan: NameplatePlan,
    showOwnNameplate: boolean,
    showDevBadges: boolean,
  ): void;
}

function player(over: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'player',
    name: 'Streamer',
    templateId: 'warrior',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 10,
    hp: 100,
    maxHp: 100,
    dead: false,
    lootable: false,
    hostile: false,
    ownerId: null,
    guild: '',
    auras: [],
    questIds: [],
    targetId: null,
    aggroTargetId: null,
    comboPoints: 0,
    comboTargetId: null,
    castingAbility: null,
    castTotal: 0,
    castRemaining: 0,
    channeling: false,
    ...over,
  } as unknown as Entity;
}

async function pseudoHarness() {
  window.history.replaceState({}, '', '/?lang=en_XA');
  vi.resetModules();
  const [{ NameplatePainter }, { createNameplateCanvasState }, i18n] = await Promise.all([
    import('../src/render/nameplate_painter'),
    import('../src/render/nameplate_canvas'),
    import('../src/ui/i18n'),
  ]);
  const painter = Object.create(NameplatePainter.prototype) as ContentResolver;
  painter.world = { markerFor: () => null };
  const me = player({ id: 1, name: 'Me' });
  const target = player({ id: 2, aiAccount: true, title: 'prog_veteran' });
  const state = createNameplateCanvasState();
  const plan = {
    hidden: false,
    anchorYOffset: 0,
    urgent: true,
    hasOverheadEmote: false,
    threat: false,
    comboPips: 0,
  } satisfies NameplatePlan;
  const resolve = () => painter.resolveContent(state, target, me, plan, false, true);
  return { state, resolve, setLanguage: i18n.setLanguage };
}

beforeEach(() => {
  window.history.replaceState({}, '', '/?lang=en_XA');
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.resetModules();
});

describe('canvas nameplate language-only transitions', () => {
  it('re-resolves localized AI and deed-title sprites after a language change', async () => {
    const { state, resolve, setLanguage } = await pseudoHarness();
    resolve();
    expect(state.aiLabel).toBe('[[ÁÍ]]');
    expect(state.title).toBe('[Ʋéţéŕáñ]');

    setLanguage('en');
    resolve();
    expect(state.aiLabel).toBe('[AI]');
    expect(state.title).toBe('Veteran');
  }, 30_000);
});
