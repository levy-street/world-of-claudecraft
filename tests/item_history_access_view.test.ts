// Who reads which Item history record, and which door each surface shows
// (src/ui/item_history_access_view.ts): the holder reads their own record, a
// viewer weighing someone else's copy (a trade counterparty, a guild bank
// member) reads the public projection with no character id and no parent
// guid, an untracked copy offers nothing, and the button / right-click doors
// follow the surface and the layout.
import { describe, expect, it } from 'vitest';
import type { ItemInstancePayload, ItemProvenance } from '../src/sim/types';
import {
  contextMenuOpensItemHistory,
  itemHistoryButtonShown,
  itemHistoryProvenanceFor,
} from '../src/ui/item_history_access_view';

const GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const PARENT = '9b2d1e7a-1c3f-4a5b-8d6e-7f8091a2b3c4';

const provenance: ItemProvenance = {
  at: Date.UTC(2026, 8, 30),
  by: 'Alice',
  byId: 101,
  source: 'mob:forest_wolf',
  zone: 'eastbrook',
  derivedFrom: PARENT,
  owners: [
    { at: Date.UTC(2026, 9, 1), by: 'Bob', byId: 202 },
    { at: Date.UTC(2026, 9, 2), by: 'Cara', byId: 303 },
  ],
  transfers: 4,
};

const tracked: ItemInstancePayload = { guid: GUID, provenance };

describe('itemHistoryProvenanceFor', () => {
  it('offers nothing for an untracked copy or a missing payload', () => {
    expect(itemHistoryProvenanceFor(undefined, 'self')).toBeNull();
    expect(itemHistoryProvenanceFor(undefined, 'other')).toBeNull();
    expect(itemHistoryProvenanceFor({ signer: 'Alice' }, 'self')).toBeNull();
    expect(itemHistoryProvenanceFor({ signer: 'Alice' }, 'other')).toBeNull();
  });

  it('hands the holder their own full record', () => {
    expect(itemHistoryProvenanceFor(tracked, 'self')).toBe(provenance);
  });

  it('hands another viewer the public projection: names and dates, no ids', () => {
    const view = itemHistoryProvenanceFor(tracked, 'other');
    expect(view).toEqual({
      at: provenance.at,
      by: 'Alice',
      source: 'mob:forest_wolf',
      zone: 'eastbrook',
      owners: [
        { at: Date.UTC(2026, 9, 1), by: 'Bob' },
        { at: Date.UTC(2026, 9, 2), by: 'Cara' },
      ],
      transfers: 4,
    });
    expect(view).not.toHaveProperty('byId');
    expect(view).not.toHaveProperty('derivedFrom');
    for (const hand of view?.owners ?? []) expect(hand).not.toHaveProperty('byId');
    const text = JSON.stringify(view);
    expect(text).not.toContain(GUID);
    expect(text).not.toContain(PARENT);
    expect(text).not.toContain('byId');
  });

  it('never aliases the live record for another viewer', () => {
    const view = itemHistoryProvenanceFor(tracked, 'other');
    expect(view).not.toBe(provenance);
    expect(view?.owners).not.toBe(provenance.owners);
    view?.owners?.push({ at: 0, by: 'Mallory' });
    expect(provenance.owners).toHaveLength(2);
  });
});

describe('itemHistoryButtonShown', () => {
  it('shows beside a list row on every layout (the keyboard door on a plain row)', () => {
    expect(itemHistoryButtonShown('listRow', false)).toBe(true);
    expect(itemHistoryButtonShown('listRow', true)).toBe(true);
  });

  it('shows beside a grid cell on touch layouts only', () => {
    expect(itemHistoryButtonShown('gridCell', false)).toBe(false);
    expect(itemHistoryButtonShown('gridCell', true)).toBe(true);
  });
});

describe('contextMenuOpensItemHistory', () => {
  it('opens for a desktop mouse right-click and the keyboard Context Menu key', () => {
    expect(contextMenuOpensItemHistory('mouse', false)).toBe(true);
    expect(contextMenuOpensItemHistory(undefined, false)).toBe(true);
    expect(contextMenuOpensItemHistory('', false)).toBe(true);
  });

  it('leaves a touch or pen long-press to the tooltip peek', () => {
    expect(contextMenuOpensItemHistory('touch', false)).toBe(false);
    expect(contextMenuOpensItemHistory('pen', false)).toBe(false);
    expect(contextMenuOpensItemHistory('touch', true)).toBe(false);
  });

  it('on the touch layout, opens for a real mouse only', () => {
    expect(contextMenuOpensItemHistory('mouse', true)).toBe(true);
    expect(contextMenuOpensItemHistory(undefined, true)).toBe(false);
  });
});
