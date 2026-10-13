// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecruitmentController } from '../src/ui/hud/expeditions/recruitment_controller';
import type { IWorld } from '../src/world_api';
import type { DungeonFinderInfo } from '../src/world_api/dungeon_finder';

function setup() {
  const world = {
    playerId: 1,
    player: { level: 8, name: 'Recruiter', inCombat: false },
    partyInfo: null,
    dungeonFinderInfo: {
      roles: ['tank'],
      eligibleRoles: ['tank', 'dps'],
      cooldown: 0,
      queue: null,
      proposal: null,
      myListing: null,
      myApplication: null,
    } as DungeonFinderInfo,
    dungeonFinderExpeditionConfigure: vi.fn(),
  };
  const root = document.createElement('section');
  document.body.append(root);
  const repaint = vi.fn();
  const controller = new RecruitmentController({
    world: () => world as unknown as IWorld,
    repaint,
  });
  const render = () => {
    controller.sync();
    root.innerHTML = controller.isOpen ? controller.html() : '';
    controller.restoreControls(root);
  };
  root.addEventListener('click', (event) => controller.click(event));
  root.addEventListener('change', (event) => controller.change(event));
  root.addEventListener('input', (event) => controller.input(event));
  root.addEventListener('compositionstart', (event) => controller.composition(event));
  root.addEventListener('compositionend', (event) => controller.composition(event));
  controller.open();
  render();
  return { world, controller, root, render, repaint };
}
const publish = () =>
  document.querySelector<HTMLButtonElement>('[data-recruit-action="publish"]')!.click();
function note(value: string) {
  const input = document.querySelector<HTMLInputElement>('[data-recruit-field="note"]')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}
function choose(field: string, value: string) {
  const input = document.querySelector<HTMLSelectElement>(`[data-recruit-field="${field}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('recruitment controller authority and draft behavior', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('escapes notes and sends one atomic command until authoritative confirmation', () => {
    const { world, root, render, controller } = setup();
    choose('role', 'dps');
    choose('purpose', 'first_time');
    note('<img src=x onerror=alert(1)>');
    render();
    expect(root.querySelector('[onerror]')).toBeNull();
    publish();
    publish();
    expect(world.dungeonFinderExpeditionConfigure).toHaveBeenCalledExactlyOnceWith({
      kind: 'recruit',
      activityId: 'hollow_crypt_normal',
      role: 'dps',
      details: { purpose: 'first_time', note: '<img src=x onerror=alert(1)>' },
    });
    expect(controller.isOpen).toBe(true);
    world.dungeonFinderInfo.myListing = {
      id: 5,
      activityId: 'hollow_crypt_normal',
      tags: [],
      applicants: [],
    };
    controller.sync();
    expect(controller.isOpen).toBe(false);
  });

  it('revalidates current queue authority before handling a stale Publish button', () => {
    const { world } = setup();
    world.dungeonFinderInfo.queue = { activities: ['hollow_crypt_normal'], waited: 0 };
    publish();
    expect(world.dungeonFinderExpeditionConfigure).not.toHaveBeenCalled();
  });

  it('retains the draft for explicit retry after an unconfirmed publication times out', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { world, controller, render } = setup();
    note('Learning together');
    publish();
    vi.setSystemTime(10_999);
    render();
    expect(document.querySelector('[data-recruit-action="publish"]')).toHaveProperty(
      'disabled',
      true,
    );
    vi.setSystemTime(11_000);
    render();
    expect(document.querySelector('[data-recruit-action="publish"]')).toHaveProperty(
      'disabled',
      false,
    );
    expect(document.querySelector('[data-recruit-field="note"]')).toHaveProperty(
      'value',
      'Learning together',
    );
    expect(controller.isOpen).toBe(true);
    publish();
    expect(world.dungeonFinderExpeditionConfigure).toHaveBeenCalledTimes(2);
  });

  it('does not reopen a cancelled form on delayed confirmation', () => {
    const { world, controller } = setup();
    publish();
    controller.close();
    world.dungeonFinderInfo.myListing = {
      id: 5,
      activityId: 'hollow_crypt_normal',
      tags: [],
      applicants: [],
    };
    controller.sync();
    expect(controller.isOpen).toBe(false);
  });

  it('holds IME input until composition ends and resets cleanly on confirmation', () => {
    const { world, controller, repaint } = setup();
    const input = document.querySelector<HTMLInputElement>('[data-recruit-field="note"]')!;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    repaint.mockClear();
    note('Exploring');
    expect(controller.isComposing).toBe(true);
    expect(repaint).not.toHaveBeenCalled();
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(repaint).toHaveBeenCalledOnce();
    publish();
    expect(world.dungeonFinderExpeditionConfigure).toHaveBeenCalledWith(
      expect.objectContaining({ details: { purpose: 'clear', note: 'Exploring' } }),
    );
    world.dungeonFinderInfo.myListing = {
      id: 5,
      activityId: 'hollow_crypt_normal',
      tags: [],
      applicants: [],
    };
    controller.sync();
    expect(controller.isComposing).toBe(false);
    expect(controller.isOpen).toBe(false);
  });

  it('preserves a cancelled draft but clears it when resetting ownership', () => {
    const { controller, render } = setup();
    note('Learning together');
    controller.close();
    controller.open();
    render();
    expect(document.querySelector('[data-recruit-field="note"]')).toHaveProperty(
      'value',
      'Learning together',
    );
    controller.reset();
    controller.open();
    render();
    expect(document.querySelector('[data-recruit-field="note"]')).toHaveProperty('value', '');
  });
});
