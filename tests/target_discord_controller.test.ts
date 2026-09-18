// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/sim/types';
import { TargetDiscordController } from '../src/ui/target_discord_controller';

function target(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 2,
    kind: 'player',
    templateId: 'warrior',
    name: 'Adventurer',
    discordName: 'linked-user',
    discordTier: 1,
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    ghost: false,
    ...overrides,
  } as Entity;
}

describe('TargetDiscordController', () => {
  it('shows linked account flair and clears it when the target is no longer eligible', () => {
    const root = document.createElement('div');
    const controller = new TargetDiscordController(root, () => true);

    controller.update(target());
    expect(root.classList.contains('show')).toBe(true);
    expect(root.textContent).toContain('linked-user');
    const rendered = root.firstElementChild;

    controller.update(target());
    expect(root.firstElementChild).toBe(rendered);

    controller.update(target({ kind: 'mob', discordName: undefined, discordTier: 0 }));
    expect(root.classList.contains('show')).toBe(false);
    expect(root.childElementCount).toBe(0);
  });
});
