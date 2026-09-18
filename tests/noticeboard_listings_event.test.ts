// The `listings` arm of the noticeboard event (src/sim/interaction.ts) carries
// the board's own id exactly like the `empty` arm does (tests/noticeboard_interaction
// .test.ts pins that one): the HUD picks the guild board's default view from
// it. The authored table is empty today (every board opens the guild board), so
// the arm is driven through a mocked listings table rather than authored content.

import { describe, expect, it, vi } from 'vitest';

const { LISTINGS } = vi.hoisted(() => ({
  LISTINGS: [{ guild: 'Stormcallers', note: 'Raid nights Tue and Thu.' }],
}));

vi.mock('../src/sim/content/noticeboard_listings', () => ({
  NOTICEBOARD_LISTINGS: { eastbrook_noticeboard: LISTINGS },
}));

import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { Sim } from '../src/sim/sim';

describe('noticeboard listings event', () => {
  it('carries the board id on the listings arm too', () => {
    const sim = new Sim({ seed: 20_061, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Reader');
    const board = [...sim.entities.values()].find(
      (entity) => entity.kind === 'object' && entity.templateId === 'noticeboard_eastbrook',
    );
    if (!board) throw new Error('missing noticeboard entity');
    const player = sim.entities.get(pid);
    if (!player) throw new Error(`missing player ${pid}`);
    const point = EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint;
    player.pos = sim.groundPos(point.x, point.z);
    player.prevPos = { ...player.pos };
    sim.rebucket(player);

    sim.drainEvents();
    expect(sim.pickUpObject(board.id, pid)).toBe(true);
    expect(sim.drainEvents()).toEqual([
      {
        type: 'noticeboard',
        noticeboardId: 'noticeboard_eastbrook',
        boardId: 'eastbrook_noticeboard',
        state: 'listings',
        listings: LISTINGS,
        pid,
      },
    ]);
  });
});
