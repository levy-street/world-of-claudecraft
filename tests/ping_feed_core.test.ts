// What the group's pings do on this client, pure half
// (src/ui/hud/pings/ping_feed_core.ts): new-ping detection, the view range,
// the chat line (no dashes in the English copy), each kind's sound (an
// existing sampled cue), and where a ping sits on the minimap.

import { describe, expect, it } from 'vitest';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import {
  type PartyPing,
  PING_ASSIST,
  PING_ATTACK,
  PING_KIND_COUNT,
  PING_LOOK,
  PING_ON_MY_WAY,
  PING_WARNING,
} from '../src/sim/social/party_pings';
import {
  PING_SOUNDS,
  PING_VIEW_RANGE,
  pingChatLine,
  pingInView,
  pingMinimapPoint,
  pingTargetName,
  takeNewPings,
} from '../src/ui/hud/pings/ping_feed_core';
import { setLanguage } from '../src/ui/i18n';

setLanguage('en');

function ping(over: Partial<PartyPing> = {}): PartyPing {
  return {
    id: 1,
    kind: PING_LOOK,
    from: 3,
    fromName: 'Jose',
    target: null,
    targetKind: null,
    targetTemplate: '',
    targetName: '',
    x: 0,
    y: 0,
    z: 0,
    ...over,
  };
}

const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}-]`);

describe('ping feed: what is new', () => {
  it('takes each ping once, and forgets ids no longer live', () => {
    const seen = new Set<number>();
    const a = ping({ id: 1 });
    const b = ping({ id: 2 });
    expect(takeNewPings(seen, [a]).map((p) => p.id)).toEqual([1]);
    expect(takeNewPings(seen, [a, b]).map((p) => p.id)).toEqual([2]);
    expect(takeNewPings(seen, [a, b])).toEqual([]);
    expect(takeNewPings(seen, [b])).toEqual([]);
    expect([...seen]).toEqual([2]);
    expect(takeNewPings(seen, [])).toEqual([]);
    expect(seen.size).toBe(0);
  });

  it('only pings within the view range matter', () => {
    expect(pingInView(ping({ x: PING_VIEW_RANGE - 1 }), { x: 0, z: 0 })).toBe(true);
    expect(pingInView(ping({ x: PING_VIEW_RANGE + 1 }), { x: 0, z: 0 })).toBe(false);
  });
});

describe('ping feed: the chat line', () => {
  it('a ground ping names the sender and the kind, with a colon', () => {
    expect(pingChatLine(ping(), null)).toBe('Jose: Look Here');
    expect(pingChatLine(ping({ kind: PING_WARNING }), null)).toBe('Jose: Warning');
    expect(pingChatLine(ping({ kind: PING_ON_MY_WAY }), null)).toBe('Jose: On My Way');
  });

  it('a unit ping names the unit', () => {
    const at = (kind: number) => pingChatLine(ping({ kind, target: 7, targetName: 'Bet' }), 'Bet');
    expect(at(PING_ATTACK)).toBe('Jose: Attack Bet');
    expect(at(PING_ASSIST)).toBe('Jose: Assist Bet');
    expect(at(PING_WARNING)).toBe('Jose: Warning, Bet');
    expect(at(PING_ON_MY_WAY)).toBe('Jose: On my way to Bet');
    expect(at(PING_LOOK)).toBe('Jose: Look at Bet');
  });

  it('no line carries a dash', () => {
    for (let k = 0; k < PING_KIND_COUNT; k++) {
      expect(pingChatLine(ping({ kind: k }), null)).not.toMatch(DASHES);
      expect(pingChatLine(ping({ kind: k, target: 2 }), 'Wolf')).not.toMatch(DASHES);
    }
  });

  it('an out-of-view unit is named from the wire (a player by raw name)', () => {
    const p = ping({ target: 5, targetKind: 'player', targetName: 'Bet' });
    expect(pingTargetName(p, undefined)).toBe('Bet');
  });
});

describe('ping feed: sounds', () => {
  it('every kind plays an existing sampled cue, each kind its own', () => {
    const keys = new Set<string>();
    for (let k = 0; k < PING_KIND_COUNT; k++) {
      const s = PING_SOUNDS[k];
      expect(s, `kind ${k}`).toBeDefined();
      expect(SFX_FIXED_CATALOG_KEYS).toContain(s.key);
      expect(s.gain).toBeGreaterThan(0);
      expect(s.gain).toBeLessThanOrEqual(1);
      keys.add(s.key);
    }
    expect(keys.size).toBe(PING_KIND_COUNT);
  });

  it('pins the kind-to-sound map (each cue matches its meaning)', () => {
    const byKind = Object.fromEntries(
      Array.from({ length: PING_KIND_COUNT }, (_, k) => [k, PING_SOUNDS[k].key]),
    );
    expect(byKind).toEqual({
      0: 'ui_ping_look', // Look Here
      1: 'ui_ping_attack', // Attack
      2: 'ui_ping_warning', // Warning
      3: 'ui_ping_on_my_way', // On My Way
      4: 'ui_ping_assist', // Assist
    });
  });
});

describe('ping feed: the minimap', () => {
  it('north-up and player-centred: +X is map-left, +Z is map-up', () => {
    const me = { x: 100, z: 100 };
    expect(pingMinimapPoint({ x: 100, z: 100 }, me, 2, 162, 70)).toEqual({
      x: 81,
      y: 81,
      edge: false,
    });
    const east = pingMinimapPoint({ x: 110, z: 100 }, me, 2, 162, 70);
    expect(east.x).toBe(61);
    const north = pingMinimapPoint({ x: 100, z: 110 }, me, 2, 162, 70);
    expect(north.y).toBe(61);
  });

  it('a ping past the rim is pulled in to it and flagged', () => {
    const p = pingMinimapPoint({ x: 0, z: 1000 }, { x: 0, z: 0 }, 2, 162, 70);
    expect(p.edge).toBe(true);
    expect(Math.hypot(p.x - 81, p.y - 81)).toBeCloseTo(70, 6);
  });
});
