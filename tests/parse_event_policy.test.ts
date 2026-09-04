import { describe, expect, test } from 'vitest';
import {
  EVENT_RECORD_POLICY,
  eventActorId,
  GENERIC_RECORDED_EVENT_TYPES,
} from '../server/parse/event_policy';
import type { SimEvent } from '../src/sim/types';

// Completeness itself is enforced at typecheck: EVENT_RECORD_POLICY is a
// Record over the full SimEvent type union, so a new event type fails the
// build until it is classified. These tests pin the classification that the
// recorder's routing depends on, so a reclassification is a deliberate diff.

describe('EVENT_RECORD_POLICY', () => {
  test('every type the recorder handles bespoke is marked routed', () => {
    for (const type of [
      'damage',
      'heal2',
      'heal',
      'aura',
      'castStart',
      'castStop',
      'death',
    ] as const) {
      expect(EVENT_RECORD_POLICY[type]).toBe('routed');
    }
  });

  test('resurrection state changes ship through the generic record path', () => {
    expect(EVENT_RECORD_POLICY.respawn).toBe('record');
    expect(EVENT_RECORD_POLICY.resurrectionOffer).toBe('record');
    expect([...GENERIC_RECORDED_EVENT_TYPES].sort()).toEqual(['respawn', 'resurrectionOffer']);
  });

  test('chatter and cosmetic cues never enter the parse', () => {
    for (const type of [
      'chat',
      'log',
      'spellfx',
      'spellfxAt',
      'loot',
      'xp',
      'mailArrived',
    ] as const) {
      expect(EVENT_RECORD_POLICY[type]).toBe('skip');
    }
  });
});

describe('eventActorId', () => {
  test('prefers the personal pid, then entity, target, source', () => {
    expect(eventActorId({ type: 'respawn', pid: 7 } as SimEvent)).toBe(7);
    expect(eventActorId({ type: 'castStop', entityId: 8, success: true } as SimEvent)).toBe(8);
    expect(
      eventActorId({ type: 'aura', targetId: 9, name: 'Rend', gained: true } as SimEvent),
    ).toBe(9);
    expect(eventActorId({ type: 'log', text: 'hi' } as SimEvent)).toBeNull();
  });
});
