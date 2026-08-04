// @vitest-environment happy-dom

// The single-line grant contract (#2430), tested through the REAL hud event
// switch rather than through source-text pins.
//
// Before: every profession action produced TWO chat lines for one grant. The
// grant hub (Sim.addItem/addItemInstance) emitted a 'loot' SimEvent whose flat
// "You receive: X" line the HUD logged unconditionally, and the profession's
// own result event logged a second, richer line right after it. The weaker
// line printed FIRST, carried no quality color, no quantity and no item link,
// so the richer line underneath read as the echo.
//
// After: a profession grant sets the loot event's `callerLogs` flag, the HUD's
// case 'loot' arm skips its log() call for it, and the profession's own line
// is the only one. That line now also splices the granted item as a clickable
// [[i:id]] chat link, which the chat log renders as a bracketed,
// quality-colored, tooltipped span.
//
// This file drives hud.handleEvents with the exact event BURST the sim emits
// for each of the seven flows and counts the rendered chat lines, which is the
// thing a player actually sees and the thing no source-text pin can prove.
// The sim half of the contract (which grants carry the flags) is pinned in
// tests/professions_silent_loot.test.ts and tests/professions_fishing.test.ts.
//
// Six of the seven flows grant ONE item per command, so their burst is a pair
// (the elided hub grant, then the result event). Corpse harvest (#2457) is the
// seventh and the exception: one command grants several DISTINCT items, so its
// burst is several elided hub grants plus ONE list-carrying result event, and
// the contract restates as one line per distinct granted item with one cue per
// COMMAND. Its own describe block sits below the six.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import { ITEMS } from '../src/sim/data';
import type { HarvestYield } from '../src/sim/professions/harvest_yields';
import type { SimEvent } from '../src/sim/types';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { Hud } from '../src/ui/hud';
import { QUALITY_COLOR } from '../src/ui/icons';

const PLAYER_ID = 7;
// Real content ids so the item links resolve through the same ITEMS table the
// renderer uses. A rename that strands one of these fails loudly here.
const SWORD = 'eastbrook_arming_sword';
const DUST = 'arcane_dust';
const ORE = 'copper_ore';
const RARE_WEAPON = 'moggers_copper_cudgel'; // rare, so link color varies from SWORD's
// The corpse-harvest cast (#2457). HIDE and MEAT are common-quality components
// whose families each carry a rare-quality Pristine specimen, which is what
// lets the rolled-rarity-versus-def-quality pin below have two answers to tell
// apart. FANG has no specimen, so it is the family the signed arm reaches.
const HIDE = 'rough_hide';
const FANG = 'wolf_fang';
const MEAT = 'game_meat';
const HIDE_SPECIMEN = 'pristine_hide';
const MEAT_SPECIMEN = 'prime_cut';

// jsdom normalizes an assigned hex to rgb(), so a raw QUALITY_COLOR hex never
// compares equal to what style.color reads back. Round-trip the expectation
// through the same element property instead of hand-writing the rgb() form.
const cssColor = (hex: string): string => {
  const probe = document.createElement('span');
  probe.style.color = hex;
  return probe.style.color;
};

interface GrantLineHarness {
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
  handleEvents(events: SimEvent[]): void;
}

function makeHud(): GrantLineHarness {
  const hud = Object.create(Hud.prototype) as unknown as GrantLineHarness;
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
  // null so the unbindResult arm's service-row refresh short-circuits before
  // it reaches $('#unbind-window'), which this harness does not mount.
  hud.openUnbindNpcId = null;
  hud.renderBags = vi.fn();
  hud.renderCrafting = vi.fn();
  hud.showError = vi.fn();
  // appendChatItemLink attaches a real tooltip; stub the binding so the test
  // exercises the LINK construction without the tooltip host.
  hud.attachTooltip = vi.fn();
  hud.itemTooltip = vi.fn();
  return hud;
}

// case 'loot' reads `$('#bags').style.display` unconditionally, and $ is an
// unchecked querySelector cast, so the element has to exist or the arm throws.
function mountBags(): void {
  const bags = document.createElement('div');
  bags.id = 'bags';
  // OPEN, so the arm's `!== 'none'` refresh branch actually runs and the pin
  // below proves the callerLogs guard does not swallow it.
  bags.style.display = 'block';
  document.body.append(bags);
  const crafting = document.createElement('div');
  crafting.id = 'crafting-window';
  crafting.style.display = 'none';
  document.body.append(crafting);
}

const lines = (hud: GrantLineHarness): string[] =>
  [...hud.chatLogEl.children].map((el) => el.textContent ?? '');

/** The hub loot event a profession grant now emits: text still carried, both
 *  stand-down flags set. */
const professionGrant = (itemId: string, count = 1): SimEvent =>
  ({
    type: 'loot',
    text: `You receive: ${ITEMS[itemId]?.name ?? itemId}${count > 1 ? ` x${count}` : ''}.`,
    pid: PLAYER_ID,
    silent: true,
    callerLogs: true,
  }) as SimEvent;

// Every cue this file stubs, as ONE list the beforeEach installs and
// firedCues() reads back, so the two can never cover different sets.
const STUBBED_CUES = [
  'lootItem',
  'coin',
  'gather',
  'gatherRareTier',
  'craftSuccess',
  'masterwork',
  'disenchant',
  'salvage',
  'enchant',
  'fishReel',
] as const;

/** The names of every STUBBED cue that actually fired, in list order. Asking
 *  about the whole set is what makes #2458's "same action, same audio" more
 *  than a two-name claim: naming lootItem and coin alone would miss a cue
 *  added on some other arm later.
 *
 *  Its reach stops at STUBBED_CUES, and deliberately so rather than by
 *  oversight: a cue reached through an idiom this file does not stub
 *  (sfx.playUi, sfx.crowdRoar, voice.play, audio.click) would fire for real
 *  in jsdom and read as absent here. The complement that closes that is the
 *  source pin over the whole unbindResult arm in
 *  tests/unbind_window_hud.test.ts, which forbids every audio/sfx/voice call
 *  in it outright. Read the two together, not this one alone. */
const firedCues = (): string[] =>
  STUBBED_CUES.filter((name) => {
    const spy = audio[name] as unknown as { mock?: { calls: unknown[] } };
    return (spy.mock?.calls.length ?? 0) > 0;
  });

/** The exact event burst the sim emits for one successful unbind, per arm.
 *  The stacked arm peels a copy back through the grant hub (both stand-down
 *  flags since #2458); the lone arm clears boundTo in place, never reaches the
 *  hub, and so has no grant event at all. That asymmetry in the BURST is the
 *  whole reason the two arms could ever have sounded different. */
const unbindBurst = (arm: 'stacked' | 'lone'): SimEvent[] => [
  ...(arm === 'stacked' ? [professionGrant(SWORD, 1)] : []),
  { type: 'unbindResult', pid: PLAYER_ID, ok: true, itemId: SWORD, fee: 2500 } as SimEvent,
];

beforeEach(() => {
  mountBags();
  // Every cue is stubbed: this file is about lines, and the cue contract has
  // its own file. The fishing arm's cue count is asserted below, though.
  for (const name of STUBBED_CUES) {
    vi.spyOn(audio, name).mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('one profession action prints exactly one grant line', () => {
  it('a harvest prints the gather line only, with the quantity and an item link', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(ORE, 5),
      {
        type: 'gatherResult',
        pid: PLAYER_ID,
        nodeId: 'n1',
        nodeType: 'ore',
        professionId: 'mining',
        itemId: ORE,
        rarity: 'rare',
        qty: 5,
        rareEvent: null,
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`You gather: [${itemDisplayName(ITEMS[ORE])}] x5.`]);
    // The bag refresh still runs for the elided grant: only the TEXT stands down.
    expect(hud.renderBags).toHaveBeenCalled();
  });

  it('a single-unit harvest prints no x1', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(ORE, 1),
      {
        type: 'gatherResult',
        pid: PLAYER_ID,
        nodeId: 'n1',
        nodeType: 'ore',
        professionId: 'mining',
        itemId: ORE,
        rarity: 'common',
        qty: 1,
        rareEvent: null,
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`You gather: [${itemDisplayName(ITEMS[ORE])}].`]);
  });

  it('a landed catch prints the reel-in line only, and plays exactly one cue', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(ORE, 1),
      // Fully-populated union member (no shape-hiding cast): a future
      // required-field addition must red this fixture, not skip it.
      {
        type: 'fishingResult',
        pid: PLAYER_ID,
        itemId: ORE,
        quality: 'common',
        zoneId: 'eastbrook_vale',
        band: 0,
      } satisfies SimEvent,
    ]);
    expect(lines(hud)).toEqual([`You reel in: [${itemDisplayName(ITEMS[ORE])}]`]);
    // The double-cue half of #2430: the reel cue fires, the generic loot ding
    // does not.
    expect(audio.fishReel).toHaveBeenCalledTimes(1);
    expect(audio.lootItem).not.toHaveBeenCalled();
    expect(audio.coin).not.toHaveBeenCalled();
  });

  it('a multi-output craft prints ONE line carrying the count, not one per grant call', () => {
    const hud = makeHud();
    // A resultCount 3 recipe can reach the hub as several internal grant calls;
    // every one of them is elided and the single craft line carries the count.
    hud.handleEvents([
      professionGrant(SWORD, 1),
      professionGrant(SWORD, 2),
      {
        type: 'craftResult',
        pid: PLAYER_ID,
        ok: true,
        recipeId: 'recipe_x',
        itemId: SWORD,
        count: 3,
        quality: 'common',
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`Crafted: [${itemDisplayName(ITEMS[SWORD])}] x3`]);
  });

  it('a single-output craft prints no x1', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(SWORD, 1),
      {
        type: 'craftResult',
        pid: PLAYER_ID,
        ok: true,
        recipeId: 'recipe_x',
        itemId: SWORD,
        count: 1,
        quality: 'common',
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`Crafted: [${itemDisplayName(ITEMS[SWORD])}]`]);
  });

  it('a sub-rare disenchant prints ONE line naming both the piece and the yield', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(DUST, 2),
      {
        type: 'disenchantResult',
        pid: PLAYER_ID,
        ok: true,
        itemId: SWORD,
        materialItemId: DUST,
        count: 2,
      } as SimEvent,
    ]);
    // The yield is the whole reason the line was extended: eliding the hub
    // line without naming the material would tell the player nothing about
    // what they got back.
    expect(lines(hud)).toEqual([
      `You disenchant [${itemDisplayName(ITEMS[SWORD])}] into [${itemDisplayName(ITEMS[DUST])}] x2.`,
    ]);
  });

  it('a rare+ disenchant adds ONE extra line for the typed secondary, not one per unit', () => {
    const hud = makeHud();
    const secondary = Object.keys(ITEMS).find((id) => id !== DUST && id !== SWORD);
    if (!secondary) throw new Error('no second content item');
    // The sim grants the secondary one unit per call, so an epic yield of 2
    // emits TWO hub loot events; both are elided and the count rides one line.
    hud.handleEvents([
      professionGrant(DUST, 1),
      professionGrant(secondary, 1),
      professionGrant(secondary, 1),
      {
        type: 'disenchantResult',
        pid: PLAYER_ID,
        ok: true,
        itemId: SWORD,
        materialItemId: DUST,
        count: 1,
        secondaryItemId: secondary,
        secondaryCount: 2,
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([
      `You disenchant [${itemDisplayName(ITEMS[SWORD])}] into [${itemDisplayName(ITEMS[DUST])}].`,
      `You also recover [${itemDisplayName(ITEMS[secondary])}] x2.`,
    ]);
  });

  it('a salvage prints ONE line naming both the piece and the yield', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(DUST, 3),
      {
        type: 'salvageResult',
        pid: PLAYER_ID,
        ok: true,
        itemId: SWORD,
        materialItemId: DUST,
        count: 3,
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([
      `You salvage [${itemDisplayName(ITEMS[SWORD])}] into [${itemDisplayName(ITEMS[DUST])}] x3.`,
    ]);
  });

  it('unbinding one copy out of a stack prints the unbind line only, with no cue', () => {
    // The sweep's last grant site (commission.ts unbindItem). A bound stack of
    // byte-equal copies is SPLIT: one copy is peeled off and re-granted through
    // the hub, so the player was told they received an item they already held,
    // stacked on top of the unbind line. A single-copy unbind clears in place
    // and never reaches the hub, so only the stacked arm ever double-logged.
    const hud = makeHud();
    hud.handleEvents(unbindBurst('stacked'));
    const rendered = lines(hud);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).not.toContain('You receive');
    expect(rendered[0]).toContain(itemDisplayName(ITEMS[SWORD]));
    // #2458: the cue stands down too. Unbind has no dedicated cue of its own,
    // so hudChrome.unbind.unbound is documented as the ONE success surface (no
    // toast, no sound cue, the trainResult rule) and the grant carries silent
    // alongside callerLogs. Asked across every stubbed cue, not just the two
    // the hub loot arm can reach, so a cue routed through some OTHER arm of
    // the burst does not slip in under a narrower assertion. What that cannot
    // see is an unstubbed idiom, which is why the arm's own source pin in
    // tests/unbind_window_hud.test.ts forbids the whole audio/sfx/voice
    // receiver set rather than a cue list.
    expect(firedCues()).toEqual([]);
    // The peel still moved items, so the bag mirror still repaints.
    expect(hud.renderBags).toHaveBeenCalled();
  });

  it('unbinding a lone copy sounds exactly like unbinding out of a stack', () => {
    // #2458's acceptance criterion, stated as one comparison rather than two
    // separate single-arm claims. The count-1 arm clears boundTo in place, so
    // its burst is the unbindResult event ALONE with no hub grant to flag,
    // which is why the two arms could ever have differed. This is a negative
    // control, not the regression guard for the fix: it passes on the old code
    // too. What it adds is the cross-arm equality, so the sim pin in
    // tests/professions_commissions.test.ts stays the decisive one.
    const stacked = makeHud();
    stacked.handleEvents(unbindBurst('stacked'));
    const stackedCues = firedCues();
    vi.clearAllMocks();

    const lone = makeHud();
    lone.handleEvents(unbindBurst('lone'));
    const loneCues = firedCues();

    const rendered = lines(lone);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toContain(itemDisplayName(ITEMS[SWORD]));
    expect(loneCues).toEqual(stackedCues);
    expect(loneCues).toEqual([]);
  });

  it('a yield-free disenchant success renders no dangling empty operand', () => {
    // The fallback contract spans two files: enchanting_view picks the
    // yield-free key when materialItemId is absent, and hud.ts independently
    // substitutes an empty {material}. If the selector ever returned a Yield
    // key for a material-less success the player would read "You disenchant
    // [Sword] into ." This drives the arm end to end so the two halves cannot
    // drift apart silently.
    const hud = makeHud();
    hud.handleEvents([
      { type: 'disenchantResult', pid: PLAYER_ID, ok: true, itemId: SWORD } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`You disenchant [${itemDisplayName(ITEMS[SWORD])}].`]);
  });

  it('a yield-free salvage success renders no dangling empty operand either', () => {
    const hud = makeHud();
    hud.handleEvents([
      { type: 'salvageResult', pid: PLAYER_ID, ok: true, itemId: SWORD } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`You salvage [${itemDisplayName(ITEMS[SWORD])}].`]);
  });

  it('applying an enchant never says the player received an item they already held', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(SWORD, 1),
      {
        type: 'enchantResult',
        pid: PLAYER_ID,
        ok: true,
        itemId: SWORD,
        enchantId: 'enchant_weapon_might',
      } as SimEvent,
    ]);
    const rendered = lines(hud);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).not.toContain('You receive');
    expect(rendered[0]).toContain(`[${itemDisplayName(ITEMS[SWORD])}]`);
  });
});

describe('a corpse harvest prints one line per DISTINCT granted item (#2457)', () => {
  // The seventh flow, and the one the #2430 pass deliberately skipped. Corpse
  // harvest reaches the grant hub from six call sites inside one command, so it
  // used to print one "You receive:" line and one generic ding PER COMPONENT:
  // two of each for an everyday wolf, four for a Mire Prowler double proc.
  // Every one of those grants now carries silent + callerLogs and the command's
  // own list-carrying result event owns the whole of the feedback.
  //
  // Measured here on the rendered log and the cue COUNT. The pins in
  // tests/professions_audio_wiring.test.ts can only show that the source calls
  // audio.lootItem() once outside the loop; only driving the real arm with a
  // multi-entry list shows that a four-item harvest still dings once.

  /** The event burst one harvestCorpse command emits: one elided hub grant per
   *  internal grant call, then the single result event carrying the ledger. */
  const harvestBurst = (yields: HarvestYield[]): SimEvent[] => [
    ...yields.map((y) => professionGrant(y.itemId, y.qty)),
    { type: 'harvestResult', pid: PLAYER_ID, yields } as SimEvent,
  ];

  it('a two-component harvest prints two lines and plays exactly ONE cue', () => {
    const hud = makeHud();
    hud.handleEvents(
      harvestBurst([
        { itemId: HIDE, qty: 1, rarity: 'common', kind: 'plain' },
        { itemId: FANG, qty: 2, rarity: 'common', kind: 'plain' },
      ]),
    );
    // Both quantity variants in one command, so the per-ENTRY key choice is
    // exercised (the other six flows pick one key per command).
    expect(lines(hud)).toEqual([
      `You harvest: [${itemDisplayName(ITEMS[HIDE])}].`,
      `You harvest: [${itemDisplayName(ITEMS[FANG])}] x2.`,
    ]);
    for (const line of lines(hud)) expect(line).not.toContain('You receive');
    // The audio half of the bug, stated directly: two hub grants, one ding.
    expect(audio.lootItem).toHaveBeenCalledTimes(1);
    // The elision is text-only: the bag mirror still repaints for both grants.
    expect(hud.renderBags).toHaveBeenCalled();
  });

  it('a specimen proc adds its OWN line beside the component, still on one cue', () => {
    const hud = makeHud();
    hud.handleEvents(
      harvestBurst([
        { itemId: HIDE, qty: 1, rarity: 'rare', kind: 'plain' },
        { itemId: FANG, qty: 1, rarity: 'uncommon', kind: 'plain' },
        { itemId: HIDE_SPECIMEN, qty: 1, rarity: 'rare', kind: 'specimen' },
      ]),
    );
    // The acceptance criterion: the proc ADDS a line, and the component it came
    // from still reports its own plain yield. The specimen borrows the
    // rare-or-better disenchant's "You also recover" wording, so a regression
    // that folded it into the component family would read as the same yield
    // reported twice.
    expect(lines(hud)).toEqual([
      `You harvest: [${itemDisplayName(ITEMS[HIDE])}].`,
      `You harvest: [${itemDisplayName(ITEMS[FANG])}].`,
      `You also recover [${itemDisplayName(ITEMS[HIDE_SPECIMEN])}].`,
    ]);
    expect(audio.lootItem).toHaveBeenCalledTimes(1);
  });

  it('the worst case in shipped content is four lines and STILL one cue', () => {
    // A Mire Prowler with both specimen families procced: the exact burst the
    // issue measures at four lines and four dings. It is still four items, so
    // still four lines, but one command is now one ding.
    const hud = makeHud();
    hud.handleEvents(
      harvestBurst([
        { itemId: HIDE, qty: 2, rarity: 'rare', kind: 'plain' },
        { itemId: MEAT, qty: 2, rarity: 'rare', kind: 'plain' },
        { itemId: HIDE_SPECIMEN, qty: 1, rarity: 'rare', kind: 'specimen' },
        { itemId: MEAT_SPECIMEN, qty: 1, rarity: 'rare', kind: 'specimen' },
      ]),
    );
    expect(lines(hud)).toEqual([
      `You harvest: [${itemDisplayName(ITEMS[HIDE])}] x2.`,
      `You harvest: [${itemDisplayName(ITEMS[MEAT])}] x2.`,
      `You also recover [${itemDisplayName(ITEMS[HIDE_SPECIMEN])}].`,
      `You also recover [${itemDisplayName(ITEMS[MEAT_SPECIMEN])}].`,
    ]);
    expect(audio.lootItem).toHaveBeenCalledTimes(1);
  });

  it('a SIGNED component reports the same line as a plain one, at the same rarity', () => {
    // The settled ruling, measured on rendered TEXT rather than on the key: the
    // node-gather windfall has never had a line of its own either, so the two
    // gathering surfaces must not announce the same mark differently. The
    // discriminant still rides the event, so a deliberate divergence later has
    // to come here and say so.
    const hud = makeHud();
    hud.handleEvents(harvestBurst([{ itemId: FANG, qty: 1, rarity: 'rare', kind: 'signed' }]));
    const signed = lines(hud);
    document.body.replaceChildren();
    mountBags();
    const plainHud = makeHud();
    plainHud.handleEvents(harvestBurst([{ itemId: FANG, qty: 1, rarity: 'rare', kind: 'plain' }]));
    expect(signed).toEqual(lines(plainHud));
    expect(signed).toEqual([`You harvest: [${itemDisplayName(ITEMS[FANG])}].`]);
  });

  it('a MULTI-UNIT signed component takes the quantity line, like its plain twin', () => {
    // A signed corpse yield carries the roll's own quantity (#2473), so the
    // signed-plus-quantity combination is reachable for the first time: before
    // it, that arm could only ever land one unit. The ruling above is unchanged
    // (a signed line reads exactly like a plain one), but the key choice now
    // has to survive a count, and a line that dropped it would under-report
    // what the player just received.
    const hud = makeHud();
    hud.handleEvents(harvestBurst([{ itemId: FANG, qty: 3, rarity: 'rare', kind: 'signed' }]));
    const signed = lines(hud);
    document.body.replaceChildren();
    mountBags();
    const plainHud = makeHud();
    plainHud.handleEvents(harvestBurst([{ itemId: FANG, qty: 3, rarity: 'rare', kind: 'plain' }]));
    expect(signed).toEqual(lines(plainHud));
    expect(signed).toEqual([`You harvest: [${itemDisplayName(ITEMS[FANG])}] x3.`]);
  });

  it('each line paints from its ROLLED rarity while the link paints from the item def', () => {
    // The gatherResult rule, and the arm no source-text pin can settle. Rough
    // Hide is a COMMON item granted at every roll, so a rare roll must color
    // the sentence blue and leave the link inside it common-white: a link that
    // followed the roll would claim the hide itself got rarer. Two entries at
    // two different rolls, so a single flat color cannot pass.
    const hud = makeHud();
    hud.handleEvents(
      harvestBurst([
        { itemId: HIDE, qty: 2, rarity: 'rare', kind: 'plain' },
        { itemId: MEAT, qty: 1, rarity: 'common', kind: 'plain' },
      ]),
    );
    const rows = [...hud.chatLogEl.children] as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(rows[0].style.color).toBe(cssColor(QUALITY_COLOR.rare));
    expect(rows[1].style.color).toBe(cssColor(QUALITY_COLOR.common));
    for (const [i, itemId] of [HIDE, MEAT].entries()) {
      const link = rows[i].querySelector('span.chat-item-link') as HTMLElement | null;
      expect(link, itemId).not.toBeNull();
      expect(link?.textContent).toBe(`[${itemDisplayName(ITEMS[itemId])}]`);
      // Focusable, so the link is reachable without a pointer.
      expect(link?.tabIndex).toBe(0);
      expect(link?.style.color).toBe(cssColor(QUALITY_COLOR.common));
    }
  });

  it('every harvest line reaches the chat live region, item link included', () => {
    // The accessibility half. A screen reader gets the harvest through
    // #chat-live and nothing else (the cue is a bare ding and the rarity color
    // is not readable), so EVERY line has to be announced, not just the first,
    // and the announced text has to carry the item's bracketed name rather than
    // an unspoken link element.
    const hud = makeHud();
    hud.handleEvents(
      harvestBurst([
        { itemId: HIDE, qty: 2, rarity: 'rare', kind: 'plain' },
        { itemId: HIDE_SPECIMEN, qty: 1, rarity: 'rare', kind: 'specimen' },
      ]),
    );
    const announced = hud.chatAnnouncer.push.mock.calls.map((c) => c[0]);
    expect(announced).toEqual(lines(hud));
    expect(announced[0]).toContain(`[${itemDisplayName(ITEMS[HIDE])}]`);
    expect(announced[1]).toContain(`[${itemDisplayName(ITEMS[HIDE_SPECIMEN])}]`);
  });
});

describe('non-profession grants are untouched', () => {
  it('an ordinary loot grant still prints the hub line and plays the hub cue', () => {
    // The control. Mob loot, corpse loot, quest rewards, vendor buys, mail and
    // trade all reach the hub with no flags, and none of them has a result
    // event of its own, so the hub line is their only feedback.
    const hud = makeHud();
    hud.handleEvents([
      { type: 'loot', text: 'You receive: Copper Ore x3.', pid: PLAYER_ID } as SimEvent,
    ]);
    expect(lines(hud)).toHaveLength(1);
    expect(lines(hud)[0]).toContain('You receive');
    expect(audio.lootItem).toHaveBeenCalledTimes(1);
  });

  it('a money loot line still prints and plays the coin cue', () => {
    const hud = makeHud();
    hud.handleEvents([{ type: 'loot', text: 'You loot 12s 30c.', pid: PLAYER_ID } as SimEvent]);
    expect(lines(hud)).toHaveLength(1);
    expect(audio.coin).toHaveBeenCalledTimes(1);
  });

  it('a silent-but-logged grant still prints its line (the flags are independent)', () => {
    // A caller that owns the CUE but not the LINE must keep its line. This is
    // the arm that fails if the two flags are ever collapsed into one.
    const hud = makeHud();
    hud.handleEvents([
      { type: 'loot', text: 'You receive: Copper Ore.', pid: PLAYER_ID, silent: true } as SimEvent,
    ]);
    expect(lines(hud)).toHaveLength(1);
    expect(audio.lootItem).not.toHaveBeenCalled();
  });

  it('a loot-roll result line still closes its prompt even when the line is elided', () => {
    // closeForItem sits OUTSIDE the callerLogs guard on purpose: a flagged
    // event must still drive the non-text side effects.
    const hud = makeHud();
    hud.handleEvents([
      {
        type: 'loot',
        text: 'Everyone passed on [[i:copper_ore]].',
        pid: PLAYER_ID,
        callerLogs: true,
      } as SimEvent,
    ]);
    expect(lines(hud)).toHaveLength(0);
    expect(hud.lootRolls.closeForItem).toHaveBeenCalledTimes(1);
    // The OTHER half of flag independence, and the arm that a source-text
    // "the conditions are not merged" pin cannot prove: this event owns the
    // LINE without owning the CUE, so the ding must still fire. Merging the
    // two guards into `if (!(ev.silent || ev.callerLogs))` is behaviorally the
    // regression those pins exist to stop, and it passes them; it fails here.
    // Deliberately SYNTHETIC since #2458: no production emitter sets the two
    // flags apart any more, so this fixture is the only thing keeping the hub's
    // two independent guards from being collapsed into one condition. Do not
    // delete it as unreachable.
    expect(audio.lootItem).toHaveBeenCalledTimes(1);
    // Positive control for firedCues(), which the unbind symmetry pins above
    // read as an EMPTY set. A helper that could never observe a call would
    // make those pass vacuously, so at least one burst has to read back
    // NON-empty through the same spies, and this is the burst where that is
    // done. (Several other cases in this file also fire exactly one cue, but
    // they assert it per-cue with toHaveBeenCalledTimes and so anchor
    // nothing about the helper.)
    expect(firedCues()).toEqual(['lootItem']);
  });
});

describe('the grant line renders a real, clickable item link', () => {
  it('the granted item is a chat-item-link span, not plain text', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(ORE, 1),
      {
        type: 'gatherResult',
        pid: PLAYER_ID,
        nodeId: 'n1',
        nodeType: 'ore',
        professionId: 'mining',
        itemId: ORE,
        rarity: 'common',
        qty: 1,
        rareEvent: null,
      } as SimEvent,
    ]);
    const link = hud.chatLogEl.querySelector('span.chat-item-link');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe(`[${itemDisplayName(ITEMS[ORE])}]`);
    // Focusable, so the link is reachable without a pointer.
    expect((link as HTMLElement).tabIndex).toBe(0);
    // Quality-colored. This is load-bearing for the CRAFT family in
    // particular: its line keeps a flat loot-green and delegates the output's
    // quality entirely to the link, so if the link ever stopped painting from
    // the item def the craft line would lose the quality signal outright.
    expect((link as HTMLElement).style.color).toBe(cssColor(QUALITY_COLOR.common));
  });

  it('the craft line paints its quality through the link, and the tier actually varies', () => {
    // The craft arm logs flat '#7fdc4f' by design and lets the item link carry
    // the quality, so the link IS the craft line's only quality signal. Two
    // different tiers, because a single common-quality case would also pass if
    // the link painted everything white.
    const craftedLinkColor = (itemId: string): string => {
      const hud = makeHud();
      hud.handleEvents([
        professionGrant(itemId, 1),
        {
          type: 'craftResult',
          pid: PLAYER_ID,
          ok: true,
          recipeId: 'recipe_x',
          itemId,
          count: 1,
        } as SimEvent,
      ]);
      const link = hud.chatLogEl.querySelector('span.chat-item-link') as HTMLElement;
      expect(link).not.toBeNull();
      return link.style.color;
    };
    expect(ITEMS[SWORD].quality ?? 'common').toBe('common');
    expect(ITEMS[RARE_WEAPON].quality).toBe('rare');
    expect(craftedLinkColor(SWORD)).toBe(cssColor(QUALITY_COLOR.common));
    expect(craftedLinkColor(RARE_WEAPON)).toBe(cssColor(QUALITY_COLOR.rare));
    expect(craftedLinkColor(SWORD)).not.toBe(craftedLinkColor(RARE_WEAPON));
  });

  it('a disenchant line renders BOTH operands as links', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(DUST, 1),
      {
        type: 'disenchantResult',
        pid: PLAYER_ID,
        ok: true,
        itemId: SWORD,
        materialItemId: DUST,
        count: 1,
      } as SimEvent,
    ]);
    const links = [...hud.chatLogEl.querySelectorAll('span.chat-item-link')];
    expect(links.map((el) => el.textContent)).toEqual([
      `[${itemDisplayName(ITEMS[SWORD])}]`,
      `[${itemDisplayName(ITEMS[DUST])}]`,
    ]);
  });

  it('a DENIED action stays a name-free error toast (tokens never expand there)', () => {
    // showError does not go through the chat log, so an item token there would
    // print as literal "[[i:...]]" source text to the player.
    const hud = makeHud();
    hud.handleEvents([
      {
        type: 'disenchantResult',
        pid: PLAYER_ID,
        ok: false,
        itemId: SWORD,
        reason: 'not_disenchantable',
      } as SimEvent,
    ]);
    expect(lines(hud)).toHaveLength(0);
    expect(hud.showError).toHaveBeenCalledTimes(1);
    expect(String(hud.showError.mock.calls[0][0])).not.toContain('[[i:');
  });
});
