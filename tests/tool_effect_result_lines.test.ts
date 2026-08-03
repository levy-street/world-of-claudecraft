// @vitest-environment happy-dom

// The toolEffectResult HUD arm (the acquisition craft's one result surface),
// driven through the REAL hud event switch: two success shapes, the deny
// reasons a player can actually see, the unknown-id fallbacks, and the
// window repaint hook. The event is text-free (ids only), so every line a
// player reads is minted HERE; a mis-mapped reason or a dropped id renders
// the wrong sentence with every sim-side assertion still green, which is why
// these arms pin the rendered text and not the event.
//
// Rig copied from tests/professions_single_line_grants.test.ts (the sibling
// single-surface contract), trimmed to the fields this arm's path reads,
// plus the professionsWindow stub the repaint hook needs.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { Hud } from '../src/ui/hud';

const PLAYER_ID = 7;

interface ToolEffectLineHarness {
  sim: {
    playerId: number;
    craftingIdentity: { synced: boolean };
    craftSkills: Record<string, number>;
  };
  renderer: { handleEvent: ReturnType<typeof vi.fn> };
  playEventSfx: ReturnType<typeof vi.fn>;
  meters: { onEvent: ReturnType<typeof vi.fn> };
  isNythraxisEvent: ReturnType<typeof vi.fn>;
  lootRolls: { closeForItem: ReturnType<typeof vi.fn> };
  chatLogEl: HTMLElement;
  chatTimestamps: boolean;
  chatWindow: { hideIfFiltered: ReturnType<typeof vi.fn> };
  chatAnnouncer: { push: ReturnType<typeof vi.fn> };
  prevCraftSkills: Record<string, number> | null;
  craftTierUpDrains: number;
  openUnbindNpcId: number | null;
  renderBags: ReturnType<typeof vi.fn>;
  renderCrafting: ReturnType<typeof vi.fn>;
  showError: ReturnType<typeof vi.fn>;
  attachTooltip: ReturnType<typeof vi.fn>;
  itemTooltip: ReturnType<typeof vi.fn>;
  professionsWindow: { isOpen: boolean; render: ReturnType<typeof vi.fn> };
  handleEvents(events: SimEvent[]): void;
}

function makeHud(): ToolEffectLineHarness {
  const hud = Object.create(Hud.prototype) as unknown as ToolEffectLineHarness;
  hud.sim = { playerId: PLAYER_ID, craftingIdentity: { synced: false }, craftSkills: {} };
  hud.renderer = { handleEvent: vi.fn() };
  hud.playEventSfx = vi.fn();
  hud.meters = { onEvent: vi.fn() };
  hud.isNythraxisEvent = vi.fn(() => false);
  hud.lootRolls = { closeForItem: vi.fn() };
  hud.chatLogEl = document.createElement('div');
  hud.chatTimestamps = false;
  hud.chatWindow = { hideIfFiltered: vi.fn() };
  hud.chatAnnouncer = { push: vi.fn() };
  hud.prevCraftSkills = null;
  hud.craftTierUpDrains = 0;
  hud.openUnbindNpcId = null;
  hud.renderBags = vi.fn();
  hud.renderCrafting = vi.fn();
  hud.showError = vi.fn();
  hud.attachTooltip = vi.fn();
  hud.itemTooltip = vi.fn();
  hud.professionsWindow = { isOpen: false, render: vi.fn() };
  return hud;
}

const lines = (hud: ToolEffectLineHarness): string[] =>
  [...hud.chatLogEl.children].map((el) => el.textContent ?? '');

const ev = (over: Record<string, unknown>): SimEvent =>
  ({ type: 'toolEffectResult', pid: PLAYER_ID, ...over }) as unknown as SimEvent;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the toolEffectResult chat arm', () => {
  it('a slot success renders ONE line naming the effect and the profession', () => {
    const hud = makeHud();
    hud.handleEvents([
      ev({ action: 'slot', ok: true, professionId: 'mining', effectId: 'gatherers_cache' }),
    ]);
    expect(lines(hud)).toHaveLength(1);
    expect(lines(hud)[0]).toContain("Gatherer's Cache");
    expect(lines(hud)[0]).toContain('Mining');
  });

  it('a recharge success renders ONE line with the material link and the formatted count', () => {
    const hud = makeHud();
    hud.handleEvents([
      ev({
        action: 'recharge',
        ok: true,
        professionId: 'mining',
        effectId: 'gatherers_cache',
        materialItemId: 'arcane_dust',
        count: 2,
      }),
    ]);
    expect(lines(hud)).toHaveLength(1);
    expect(lines(hud)[0]).toContain("Gatherer's Cache");
    // The material splices as a chat item link (bracketed display name: the
    // arcane_dust id renders as Chime Dust).
    expect(lines(hud)[0]).toContain('[Chime Dust]');
    expect(lines(hud)[0]).toContain('2');
  });

  it('every deny reason renders its own line: one sentence per refusal, none silent', () => {
    const hud = makeHud();
    const denies: [string, Record<string, unknown>][] = [
      ['no_tool', { action: 'slot', professionId: 'mining' }],
      ['no_charm', { action: 'slot', professionId: 'mining', effectId: 'gatherers_cache' }],
      ['no_gain', { action: 'slot', professionId: 'mining', effectId: 'gatherers_cache' }],
      ['invalid_request', { action: 'slot', professionId: 'mining' }],
      ['no_slot', { action: 'recharge', professionId: 'mining' }],
      ['already_full', { action: 'recharge', professionId: 'mining', effectId: 'gatherers_cache' }],
      ['tool_capped', { action: 'recharge', professionId: 'mining', effectId: 'gatherers_cache' }],
      [
        'insufficient_materials',
        {
          action: 'recharge',
          professionId: 'mining',
          effectId: 'gatherers_cache',
          materialItemId: 'arcane_shard',
          count: 5,
        },
      ],
      ['throttled', { action: 'recharge', professionId: 'mining', effectId: 'gatherers_cache' }],
    ];
    for (const [reason, body] of denies) {
      hud.handleEvents([ev({ ok: false, reason, ...body })]);
    }
    const rendered = lines(hud);
    expect(rendered).toHaveLength(denies.length);
    // EVERY reason renders ITS OWN copy, anchored per line: a swap of any
    // two branch keys keeps counts and distinctness green, so only content
    // anchors make the reason-to-sentence mapping decisive.
    const anchors: [number, string][] = [
      [0, 'need a real'], // no_tool
      [1, 'crafted'], // no_charm
      [2, 'already slotted'], // no_gain
      [3, 'cannot be slotted'], // invalid_request
      [4, 'No effect is slotted'], // no_slot
      [5, 'already fully charged'], // already_full
      [6, 'Carry a better'], // tool_capped
      [7, 'Recharging'], // insufficient_materials
      [8, 'crafting too quickly'], // throttled
    ];
    for (const [index, anchor] of anchors) {
      expect(rendered[index], `line for ${denies[index][0]}`).toContain(anchor);
    }
    expect(new Set(rendered).size).toBe(denies.length);
    // The price-carrying deny states the cost (the R46 legibility rule).
    expect(rendered[7]).toContain('[Chime Shard]');
    expect(rendered[7]).toContain('5');
  });

  it('an unknown effect id renders RAW rather than as an empty name or a crash', () => {
    // The stale-content doctrine for result lines: the player just acted on
    // this id, so an unlocalized identifier beats a nameless sentence.
    const hud = makeHud();
    hud.handleEvents([
      ev({
        action: 'slot',
        ok: false,
        reason: 'no_gain',
        professionId: 'mining',
        effectId: 'retired_charm_x',
      }),
    ]);
    expect(lines(hud)).toHaveLength(1);
    expect(lines(hud)[0]).toContain('retired_charm_x');
  });

  it("prototype-key ids ('constructor') render as raw text, never resolved from the tables", () => {
    const hud = makeHud();
    hud.handleEvents([
      ev({
        action: 'slot',
        ok: false,
        reason: 'invalid_request',
        professionId: 'constructor',
        effectId: 'constructor',
      }),
    ]);
    expect(lines(hud)).toHaveLength(1);
    // The literal echoes back; a bare table index would have handed a
    // FUNCTION to t() instead.
    expect(lines(hud)[0]).toContain('constructor');
  });

  it('repaints an OPEN professions window once per event, and never a closed one', () => {
    const hud = makeHud();
    hud.handleEvents([
      ev({ action: 'slot', ok: true, professionId: 'mining', effectId: 'gatherers_cache' }),
    ]);
    expect(hud.professionsWindow.render).not.toHaveBeenCalled();
    hud.professionsWindow.isOpen = true;
    hud.handleEvents([
      ev({
        action: 'recharge',
        ok: false,
        reason: 'already_full',
        professionId: 'mining',
        effectId: 'gatherers_cache',
      }),
    ]);
    expect(hud.professionsWindow.render).toHaveBeenCalledTimes(1);
  });
});
