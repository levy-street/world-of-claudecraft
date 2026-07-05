import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

// Build a ClientWorld without opening a socket (mirrors snapshots.test.ts `bareClient`).
function bareClient(): { world: any; sent: any[] } {
  const world = Object.create(ClientWorld.prototype) as any;
  const sent: any[] = [];
  world.connected = true;
  world.ws = { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) };
  return { world, sent };
}

describe('ClientWorld.acceptLinkedQuest', () => {
  it('sends a qlinkaccept command with quest + from', () => {
    const { world, sent } = bareClient();
    world.acceptLinkedQuest('q_wolves', 42);
    expect(sent).toEqual([{ t: 'cmd', cmd: 'qlinkaccept', quest: 'q_wolves', from: 42 }]);
  });
});
