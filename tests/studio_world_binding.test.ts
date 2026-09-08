import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_CONFIG, StudioSession } from '../src/vfx_studio/session';
import { bindStudioWorld } from '../src/vfx_studio/world_binding';

describe('retained studio renderer world binding', () => {
  it('redirects saved getters and methods to the replacement session', () => {
    let current = new StudioSession(DEFAULT_STUDIO_CONFIG).sim;
    const world = bindStudioWorld(() => current);
    const oldEntities = world.entities;
    const savedTarget = world.targetEntity;
    const old = current;
    current = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'arms' }).sim;
    expect(world.player.templateId).toBe('warrior');
    expect(world.entities).not.toBe(oldEntities);
    expect(world.targetEntity).toBe(savedTarget);
    savedTarget(current.player.id);
    expect(current.player.targetId).toBe(current.player.id);
    expect(old.player.targetId).not.toBe(old.player.id);
    expect(() => Reflect.set(world, 'primaryId', 0)).toThrow('read-only');
  });
  it('does not retain a stale receiver when a world method uses private state', () => {
    class World {
      constructor(private value: number) {}
      read() {
        return this.value;
      }
    }
    let current = new World(1);
    const world = bindStudioWorld(() => current),
      read = world.read;
    current = new World(2);
    expect(read()).toBe(2);
    expect(world.read).toBe(read);
  });
});
