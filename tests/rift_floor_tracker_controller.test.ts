import { describe, expect, it } from 'vitest';
import { RiftFloorTrackerController } from '../src/ui/hud/rift/rift_floor_tracker_controller';
import type { IWorld } from '../src/world_api';
import type { RiftFloorView } from '../src/world_api/dungeons';

function trackerElement() {
  let html = '';
  let writes = 0;
  const element = {
    style: { display: '' },
    get innerHTML() {
      return html;
    },
    set innerHTML(value: string) {
      html = value;
      writes++;
    },
  } as unknown as HTMLElement;
  return { element, writes: () => writes };
}

function floor(overrides: Partial<RiftFloorView> = {}): RiftFloorView {
  return {
    eventId: 'evt1',
    instanceId: 1,
    seed: 42,
    baseLevel: 20,
    floorIndex: 1,
    floorCount: 5,
    origin: { x: 0, z: 0 },
    contentId: 'procedural-v1:42:20',
    contentHash: 'procedural-v1:42:20',
    upgrade: null,
    name: 'Sunken Hall',
    themeName: 'flooded',
    tier: 'B',
    ...overrides,
  };
}

type World = Pick<IWorld, 'riftFloor' | 'riftEventMsRemaining'>;

describe('RiftFloorTrackerController', () => {
  it('hides and clears stale content outside a rift', () => {
    const tracker = trackerElement();
    tracker.element.innerHTML = 'stale';
    const world: World = { riftFloor: null, riftEventMsRemaining: () => null };
    const controller = new RiftFloorTrackerController({
      element: tracker.element,
      world: () => world,
    });

    controller.update();

    expect(tracker.element.style.display).toBe('none');
    expect(tracker.element.innerHTML).toBe('');
  });

  it('shows the floor line and elides identical repaints', () => {
    const tracker = trackerElement();
    const world: World = { riftFloor: floor(), riftEventMsRemaining: () => null };
    const controller = new RiftFloorTrackerController({
      element: tracker.element,
      world: () => world,
    });

    controller.update();
    controller.update();

    expect(tracker.writes()).toBe(1);
    expect(tracker.element.style.display).toBe('block');
    expect(tracker.element.innerHTML).toContain('2');
    expect(tracker.element.innerHTML).toContain('5');
  });

  it('degrades to floor-progress-only for a dev-spawned rift (no timer line)', () => {
    const tracker = trackerElement();
    const world: World = { riftFloor: floor(), riftEventMsRemaining: () => null };
    const controller = new RiftFloorTrackerController({
      element: tracker.element,
      world: () => world,
    });

    controller.update();

    expect(tracker.element.innerHTML).not.toContain('rt-obj rt-obj');
    // No second "rt-obj" div for the timer line: only the header + the floor line.
    expect(tracker.element.innerHTML.match(/rt-obj/g)?.length).toBe(1);
  });

  it('repaints once per changed whole second, not more often', () => {
    const tracker = trackerElement();
    let ms = 65_000;
    const world: World = { riftFloor: floor(), riftEventMsRemaining: () => ms };
    const controller = new RiftFloorTrackerController({
      element: tracker.element,
      world: () => world,
    });

    controller.update();
    expect(tracker.writes()).toBe(1);

    // Same whole second (e.g. a sub-second re-poll): no repaint.
    ms = 65_010;
    controller.update();
    expect(tracker.writes()).toBe(1);

    // A new whole second: repaints.
    ms = 64_500;
    controller.update();
    expect(tracker.writes()).toBe(2);
    expect(tracker.element.innerHTML.match(/rt-obj/g)?.length).toBe(2); // floor line + timer line
  });

  it('relocalize forces exactly one rebuild even with an unchanged model', () => {
    const tracker = trackerElement();
    const world: World = { riftFloor: floor(), riftEventMsRemaining: () => null };
    const controller = new RiftFloorTrackerController({
      element: tracker.element,
      world: () => world,
    });

    controller.update();
    expect(tracker.writes()).toBe(1);
    controller.relocalize();
    expect(tracker.writes()).toBe(2);
  });
});
