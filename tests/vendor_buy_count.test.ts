// Phase 21 wire surface pins for the vendor count purchase.
//
// Sender side (the phase 14 confirmUse precedent, gather_node_online.test.ts):
// `count` rides the buy frame only above 1, `bulk` only when true, and the
// client NEVER emits both, so the sim's bulk-wins precedence only ever decides
// hand-crafted frames. The default frame's key set is pinned exactly, which is
// the byte-identity claim of acceptance (a)/(d) re-baselined post-PR-2661: no
// count, no bulk, nothing new.
//
// Dispatch side: the count verb stays a PLAIN-vendor verb. The Marks shops
// (Q17) and buyback (Q18) dispatch arms are pinned to their single-purchase
// sim entry points and to reading no count field, so a future widening has to
// come back through this file deliberately.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';

describe('ClientWorld.buyItem count/bulk wire form (sender)', () => {
  function rig(): { client: ClientWorld; sent: Record<string, unknown>[] } {
    const client = Object.create(ClientWorld.prototype) as ClientWorld;
    const sent: Record<string, unknown>[] = [];
    (client as unknown as { cmd(msg: Record<string, unknown>): void }).cmd = (msg) => {
      sent.push(msg);
    };
    return { client, sent };
  }

  it('sends the pre-phase byte-identical frame for a plain, empty, or count-1 buy', () => {
    const { client, sent } = rig();
    client.buyItem(7, 'baked_bread');
    client.buyItem(7, 'baked_bread', {});
    client.buyItem(7, 'baked_bread', { count: 1 });
    client.buyItem(7, 'baked_bread', { bulk: false });
    expect(sent).toHaveLength(4);
    for (const msg of sent) {
      // The EXACT key set, not just count's absence: any new field here is a
      // byte-identity regression on the default frame.
      expect(Object.keys(msg).sort()).toEqual(['cmd', 'item', 'npc']);
      expect(msg).toEqual({ cmd: 'buy', npc: 7, item: 'baked_bread' });
    }
  });

  it('sends count only above 1 and bulk only when true, never both', () => {
    const { client, sent } = rig();
    client.buyItem(7, 'baked_bread', { count: 5 });
    client.buyItem(7, 'baked_bread', { bulk: true });
    client.buyItem(7, 'baked_bread', { bulk: true, count: 5 });
    expect(sent).toEqual([
      { cmd: 'buy', npc: 7, item: 'baked_bread', count: 5 },
      { cmd: 'buy', npc: 7, item: 'baked_bread', bulk: true },
      // Bulk wins sender-side too: the mixed bag degrades to the bulk frame
      // rather than ever emitting both fields.
      { cmd: 'buy', npc: 7, item: 'baked_bread', bulk: true },
    ]);
    expect('bulk' in sent[0]).toBe(false);
    expect('count' in sent[1]).toBe(false);
    expect('count' in sent[2]).toBe(false);
  });

  it('the sender forwards finite hostile counts for the authoritative deny and drops non-finite ones', () => {
    const { client, sent } = rig();
    // Finite hostiles ride the wire as-is so the authoritative sanitize
    // denies them with the same toast the offline Sim gives...
    client.buyItem(7, 'baked_bread', { count: 0 });
    client.buyItem(7, 'baked_bread', { count: -3 });
    client.buyItem(7, 'baked_bread', { count: 2.5 });
    expect(sent).toEqual([
      { cmd: 'buy', npc: 7, item: 'baked_bread', count: 0 },
      { cmd: 'buy', npc: 7, item: 'baked_bread', count: -3 },
      { cmd: 'buy', npc: 7, item: 'baked_bread', count: 2.5 },
    ]);
    // ...while a non-finite value would serialize to null and silently buy 1,
    // so the sender drops the command entirely, the one place it can.
    client.buyItem(7, 'baked_bread', { count: Number.NaN });
    client.buyItem(7, 'baked_bread', { count: Number.POSITIVE_INFINITY });
    expect(sent).toHaveLength(3);
  });
});

describe('count stays a plain-vendor verb (Q17/Q18 exclusion pins)', () => {
  const game = readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8');
  // Strip comments first: a prose mention of "count" must not satisfy or
  // trip a source pin (the comment-gameable trap).
  const stripped = game.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  function caseBody(name: string): string {
    const start = stripped.indexOf(`case '${name}':`);
    expect(start, `case '${name}' present`).toBeGreaterThan(-1);
    const rest = stripped.slice(start + `case '${name}':`.length);
    const next = rest.search(/case '/);
    expect(next, `case '${name}' has a successor`).toBeGreaterThan(-1);
    return rest.slice(0, next);
  }

  it('the buy dispatch is the ONE arm that forwards a count', () => {
    const body = caseBody('buy');
    expect(body).toContain("count: typeof msg.count === 'number' ? msg.count : undefined,");
  });

  it('delve_buy dispatches the single-purchase entry and reads no count (Q17)', () => {
    const body = caseBody('delve_buy');
    expect(body).toContain('sim.delveBuyShopItem(msg.delveId, msg.itemId, pid);');
    expect(body).not.toContain('count');
  });

  it('heroic_buy dispatches the single-purchase entry and reads no count (Q17)', () => {
    const body = caseBody('heroic_buy');
    expect(body).toContain('sim.buyHeroicVendorItem(msg.itemId, pid);');
    expect(body).not.toContain('count');
  });

  it('buyback dispatches one redemption per click and reads no count (Q18)', () => {
    const body = caseBody('buyback');
    expect(body).toContain('sim.buyBackItem(');
    expect(body).not.toContain('count');
  });
});
