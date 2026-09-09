// The dev-only chat interceptor chain (src/game/dev_chat_hooks.ts): the
// day/night scrub and the placer rig ride one hook main.ts calls on the
// chat send path. Vitest runs under Vite's dev env, so the DEV gate is
// open here; the cases pin recognition and pass-through, not the hooks'
// own behavior (each has its own suite).
import { describe, expect, it } from 'vitest';
import { tryDevChatHooks } from '../src/game/dev_chat_hooks';

function deps() {
  const logs: string[] = [];
  return {
    logs,
    bag: {
      hud: {
        log: (text: string) => {
          logs.push(text);
        },
        refreshDayNightDial: () => {},
      },
      scene: { add() {}, remove() {}, traverse() {} } as never,
      world: { player: undefined, chat: () => {} },
    },
  };
}

describe('dev chat hooks', () => {
  it('passes ordinary chat through untouched', () => {
    const d = deps();
    expect(tryDevChatHooks('hello world', d.bag)).toBe(false);
    expect(tryDevChatHooks('/party hi', d.bag)).toBe(false);
    expect(d.logs).toEqual([]);
  });

  it('consumes a day/night scrub line', () => {
    const d = deps();
    expect(tryDevChatHooks('/daynight', d.bag)).toBe(true);
    expect(d.logs.length).toBeGreaterThan(0);
    expect(d.logs[0]).toContain('/daynight');
  });
});
