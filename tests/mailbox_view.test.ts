// Pure view-core tests for the Ravenpost mailbox window (src/ui/mailbox_view.ts):
// the inbox/send render models, the opened-letter resolution, the client-side
// send pre-check, and the envelope indicator. Same-input-same-output against
// both a Sim-shaped and a ClientWorld-shaped MailInfo (they share the wire
// type, so one fixture drives both worlds' mirrors).

import { describe, expect, it } from 'vitest';
import {
  buildMailboxView,
  mailIndicatorView,
  mailSendBlocked,
  mailSendCost,
  recipientSuggestions,
  wrappedSuggestionIndex,
} from '../src/ui/mailbox_view';
import type { MailInfo } from '../src/world_api';

const INFO: MailInfo = {
  messages: [
    {
      id: 7,
      senderName: 'Alice',
      kind: 'player',
      subject: 'Hello',
      body: 'A fine day.',
      copper: 120,
      items: [{ itemId: 'roasted_boar', count: 2 }],
      read: false,
    },
    {
      id: 3,
      senderName: 'The Ravenpost',
      kind: 'system',
      letterId: 'ravenpost_welcome',
      subject: 'The ravens now fly for you',
      body: 'Traveler...',
      copper: 0,
      items: [],
      read: true,
    },
  ],
  totalCount: 2,
  unread: 1,
  postage: 30,
  maxAttachments: 3,
  deliverySeconds: 45,
};

describe('buildMailboxView', () => {
  it('returns no-data away from a mailbox', () => {
    expect(
      buildMailboxView({ info: null, tab: 'inbox', openedId: null, attachments: [] }).kind,
    ).toBe('no-data');
  });

  it('models the inbox rows (unread, attachments, letterId passthrough)', () => {
    const view = buildMailboxView({ info: INFO, tab: 'inbox', openedId: null, attachments: [] });
    if (view.kind !== 'inbox') throw new Error('expected inbox');
    expect(view.body.rows.map((r) => r.id)).toEqual([7, 3]);
    expect(view.body.rows[0]).toMatchObject({
      unread: true,
      hasAttachments: true,
      letterId: null,
      senderName: 'Alice',
    });
    expect(view.body.rows[1]).toMatchObject({
      unread: false,
      hasAttachments: false,
      letterId: 'ravenpost_welcome',
    });
    expect(view.body.opened).toBeNull();
    expect(view.body.unread).toBe(1);
  });

  it('resolves the opened letter, and drops a stale openedId', () => {
    const opened = buildMailboxView({ info: INFO, tab: 'inbox', openedId: 7, attachments: [] });
    if (opened.kind !== 'inbox') throw new Error('expected inbox');
    expect(opened.body.opened?.id).toBe(7);
    expect(opened.body.opened?.body).toBe('A fine day.');
    const stale = buildMailboxView({ info: INFO, tab: 'inbox', openedId: 99, attachments: [] });
    if (stale.kind !== 'inbox') throw new Error('expected inbox');
    expect(stale.body.opened).toBeNull();
  });

  it('models the send form (attachment cap)', () => {
    const two = buildMailboxView({
      info: INFO,
      tab: 'send',
      openedId: null,
      attachments: [
        { itemId: 'a', count: 1 },
        { itemId: 'b', count: 1 },
      ],
    });
    if (two.kind !== 'send') throw new Error('expected send');
    expect(two.body.canAttachMore).toBe(true);
    const full = buildMailboxView({
      info: INFO,
      tab: 'send',
      openedId: null,
      attachments: [
        { itemId: 'a', count: 1 },
        { itemId: 'b', count: 1 },
        { itemId: 'c', count: 1 },
      ],
    });
    if (full.kind !== 'send') throw new Error('expected send');
    expect(full.body.canAttachMore).toBe(false);
    expect(full.body.postage).toBe(30);
  });

  it('is deterministic: identical inputs give identical models (Sim vs mirror)', () => {
    const a = buildMailboxView({ info: INFO, tab: 'inbox', openedId: 7, attachments: [] });
    const b = buildMailboxView({
      info: JSON.parse(JSON.stringify(INFO)),
      tab: 'inbox',
      openedId: 7,
      attachments: [],
    });
    expect(a).toEqual(b);
  });
});

describe('mailSendBlocked / mailSendCost', () => {
  it('computes the full send cost (coin + postage)', () => {
    expect(mailSendCost(500, 30)).toBe(530);
    expect(mailSendCost(0, 30)).toBe(30);
  });

  it('blocks an empty recipient and an unaffordable send', () => {
    expect(mailSendBlocked({ to: '  ', attachedCopper: 0, postage: 30, purse: 999 })).toBe(
      'needRecipient',
    );
    expect(mailSendBlocked({ to: 'Bob', attachedCopper: 500, postage: 30, purse: 529 })).toBe(
      'cantAffordPostage',
    );
    expect(mailSendBlocked({ to: 'Bob', attachedCopper: 500, postage: 30, purse: 530 })).toBeNull();
  });
});

describe('mailIndicatorView', () => {
  it('shows only while something unread waits', () => {
    expect(mailIndicatorView(0)).toEqual({ visible: false, count: 0 });
    expect(mailIndicatorView(3)).toEqual({ visible: true, count: 3 });
    expect(mailIndicatorView(Number.NaN)).toEqual({ visible: false, count: 0 });
  });
});

describe('recipientSuggestions', () => {
  const results = [
    { name: 'Player', cls: 'warrior', level: 20 },
    { name: 'Alice', cls: 'mage', level: 18 },
    { name: 'Bob', cls: 'priest', level: 12 },
    { name: 'Cara', cls: 'rogue', level: 16 },
  ];

  it('excludes the current player name and caps results', () => {
    expect(recipientSuggestions(results, 'Player', 2).map((r) => r.name)).toEqual(['Alice', 'Bob']);
  });

  it('returns no suggestions when max is zero or negative', () => {
    expect(recipientSuggestions(results, 'Player', 0)).toEqual([]);
    expect(recipientSuggestions(results, 'Player', -3)).toEqual([]);
  });
});

describe('wrappedSuggestionIndex', () => {
  it('starts at the first item on down and last item on up from no selection', () => {
    expect(wrappedSuggestionIndex(-1, 1, 4)).toBe(0);
    expect(wrappedSuggestionIndex(-1, -1, 4)).toBe(3);
  });

  it('wraps around in both directions', () => {
    expect(wrappedSuggestionIndex(3, 1, 4)).toBe(0);
    expect(wrappedSuggestionIndex(0, -1, 4)).toBe(3);
  });

  it('returns -1 for an empty list', () => {
    expect(wrappedSuggestionIndex(0, 1, 0)).toBe(-1);
  });
});
