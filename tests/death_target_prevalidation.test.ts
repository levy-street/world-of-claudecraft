import { describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';

// A ClientWorld with only the fields the cast path touches, to exercise its
// dead-target pre-validation without the WebSocket plumbing. Kept bespoke on
// purpose (issue #2088): a narrower field subset plus a `cmd` spy.
// tests/helpers/bare_client.ts bareClient() is the default for a new suite
// that just needs a bare ClientWorld.
function castClient(targetDead: boolean): any {
  const c: any = Object.create(ClientWorld.prototype);
  c.entities = new Map();
  c.playerId = 1;
  c.eventQueue = [];
  c.entities.set(1, { id: 1, targetId: 2 });
  c.entities.set(2, { id: 2, dead: targetDead });
  c.known = [{ def: { id: 'fireball', requiresTarget: true, targetType: 'enemy' } }];
  c.cmd = vi.fn();
  return c;
}

describe('ClientWorld dead-target cast pre-validation', () => {
  it('drops a hostile cast on a target it sees dead and queues the standard error', () => {
    const c = castClient(true);
    c.castAbility('fireball');
    expect(c.cmd).not.toHaveBeenCalled();
    expect(c.drainEvents()).toContainEqual({
      type: 'error',
      text: 'You have no target.',
      reason: 'target_dead',
    });
  });

  it('sends a hostile cast on a live target', () => {
    const c = castClient(false);
    c.castAbility('fireball');
    expect(c.cmd).toHaveBeenCalledWith({ cmd: 'cast', ability: 'fireball' });
    expect(c.drainEvents()).toHaveLength(0);
  });

  it('does not block a friendly-target ability on a dead target', () => {
    const c = castClient(true);
    c.known = [{ def: { id: 'renew', requiresTarget: true, targetType: 'friendly' } }];
    c.castAbility('renew');
    expect(c.cmd).toHaveBeenCalledWith({ cmd: 'cast', ability: 'renew' });
  });

  it('gates castAbilityBySlot the same way', () => {
    const c = castClient(true);
    c.castAbilityBySlot(0);
    expect(c.cmd).not.toHaveBeenCalled();
    expect(c.drainEvents()).toContainEqual({
      type: 'error',
      text: 'You have no target.',
      reason: 'target_dead',
    });
  });
});
