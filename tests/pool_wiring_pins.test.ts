// Two-pool wiring pins for the migrated sim command boundaries.
//
// Phase 05 split every container's slot budget into a GENERAL pool and a
// MATERIALS pool, and migrated each grant/withdraw gate from the flat
// bagCapacity(meta.bags) total to the bagPools(meta.bags) split. Most of those
// call sites have no behavioral arm that can tell the two apart: for a material
// item in a within-budget bag the split and the flat total report the SAME free
// count, so reverting any single site to generalOnlyPools(bagCapacity(meta.bags))
// compiles and the whole suite stays green. That is why the wiring itself is
// pinned here: these guards hold the line until each site earns a discriminating
// behavioral arm, and they should be retired site by site as those arms land.
//
// The table is the WHOLE migrated set under src/sim/, re-derived at every release
// sync (the v0.40.0 sync added src/sim/broker_custody.ts, a release-owned grant
// boundary that arrived on the flat arm and was migrated in the merge), with ONE
// deliberate omission:
// src/sim/mail/post_office.ts, whose stronger pin (a positive toContain on the exact
// call shape plus the flat-total not.toContain) already sits beside its behavioral
// arms in tests/mail.test.ts, 'asks the fit gate with the two-pool SPLIT, never a
// flat capacity'. Adding a second, weaker copy here would only give a later edit two
// places to disagree.
//
// Anchoring is PER FUNCTION, not per file. Every site names the function or method
// that encloses it, and the pin counts bagPools( inside THAT function's sliced body,
// so a gate which moves to a different function reds even though the file total is
// unchanged. The file total is asserted against the source separately, which is what
// catches a site added in some function the table does not name. The counts and the
// slices were both read off the CURRENT source; when a real change adds or removes a
// boundary, update the site list and its justification in the same commit.
//
// src/sim/bank.ts and src/sim/materials_vault.ts DO carry discriminating
// behavioral arms already (tests/bank.test.ts, tests/materials_vault.test.ts) and
// are listed here anyway, so the table is the whole migrated set rather than
// whatever happened to lack coverage the day it was written.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Blank out comments while preserving line structure, so a comment quoting a call
// shape can neither satisfy a positive pin nor trip a negative one (the
// stripComments precedent in tests/architecture.test.ts, tests/command_schema.test.ts
// and tests/materials_vault.test.ts). The [^:] guard keeps a '://' in a URL from
// being read as a line comment.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const sourceOf = (relPath: string): string =>
  stripComments(readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8'));

const occurrences = (src: string, needle: string): number => src.split(needle).length - 1;

// The declaration headers fnBody slices on: a top-level `function` declaration
// (exported or not) and a two-space-indented class method or accessor, which is what
// the Sim and Market command surfaces are. The trailing `(?:[^;]*[({])?$` is what
// separates a SIGNATURE from a plain call at the same indent: a one-line signature
// ends its line with `{`, a wrapped parameter list ends it with `(`, and a call
// statement ends it with `;`. Without that, a two-space call such as
// `removePlannedReagentsFromScratch(scratch, reagentPlans);` in enchanting.ts would
// read as a declaration and silently truncate the body it sits in.
const DECL_SOURCE = String.raw`^(?:export )?(?:async )?function ([A-Za-z0-9_]+)\s*[(<]|^ {2}(?:(?:async|get|set) )?([A-Za-z0-9_]+)\((?:[^;]*[({])?$`;

// Built fresh per call: a shared /g regex carries lastIndex between callers, and a
// guard whose matches depend on call order is worse than no guard.
const declarations = (src: string): RegExpExecArray[] => [
  ...src.matchAll(new RegExp(DECL_SOURCE, 'gm')),
];

const declName = (decl: RegExpExecArray): string => decl[1] ?? decl[2];

/** The body of `fn`, sliced from its declaration header to the next declaration. */
const fnBody = (src: string, fn: string): string => {
  const decls = declarations(src);
  const hits = decls.filter((d) => declName(d) === fn);
  // Exactly one: a captured identifier cannot collide by prefix the way a
  // `indexOf('function ' + fn)` probe can, but a genuine duplicate name (an
  // overload, a same-named method on a second class) still must not hand this
  // slice the wrong body without saying so.
  expect(hits, `${fn} should be declared exactly once`).toHaveLength(1);
  const start = hits[0].index;
  const next = decls.find((d) => d.index > start);
  return src.slice(start, next?.index);
};

// The flat-total revert shape: the exact expression each migrated site carried
// before phase 05, and the one a regression would reach for.
const FLAT_REVERT = 'generalOnlyPools(bagCapacity(';

// The other compiling revert spelling, and the more natural reach of the two:
// bagCapacity IS totalPoolCapacity(bagPools(...)), so writing
// generalOnlyPools(totalPoolCapacity(bagPools(meta.bags))) un-splits the pools while
// KEEPING the bagPools( call the positive pin counts, and it evades FLAT_REVERT too.
// Forbidden bare rather than generalOnlyPools-wrapped, so parking the flat total in a
// local first does not evade it either. No pinned module has a legitimate reader:
// totalPoolCapacity appears only in src/sim/bag_pools.ts, which defines it, and in
// src/sim/bags.ts, where bagCapacity is defined as exactly this composition. So the
// needle covers the whole table and needs no per-module exemption.
const POOL_COLLAPSE_REVERT = 'totalPoolCapacity(';

const REVERT_NEEDLES = [FLAT_REVERT, POOL_COLLAPSE_REVERT];

interface PoolWiringSite {
  /** The enclosing function or method, named exactly as the module declares it. */
  fn: string;
  /** What the call site gates: the pin's justification. */
  what: string;
}

interface PoolWiringPin {
  /** Repo-relative module path. */
  path: string;
  /** One entry per `bagPools(` call site, in source order. */
  sites: PoolWiringSite[];
  /**
   * True when every bag-capacity question in the module gates a GRANT, so a bare
   * `bagCapacity(` anywhere in it is by definition a revert. False only for a
   * module with a legitimate non-grant reader, which then gets its own pin.
   */
  grantsOnly: boolean;
}

const PINS: PoolWiringPin[] = [
  {
    // First because it is the hub: every ctx.canAddItem gate in the sim reaches the
    // split through this one method, so a revert here un-splits far more than the
    // per-command sites below.
    path: 'src/sim/sim.ts',
    sites: [
      {
        fn: 'canAddItem',
        what: 'the shared capacity hub every ctx.canAddItem gate routes through',
      },
    ],
    // NOT grants-only: the `bagCapacity` accessor is the IWorld readout of the flat
    // total, a legitimate non-grant reader, and is pinned separately below.
    grantsOnly: false,
  },
  {
    path: 'src/sim/guild_bank.ts',
    sites: [{ fn: 'guildBankWithdraw', what: 'the moveBetweenContainers destination pools' }],
    // The module's other generalOnlyPools call is the guild bank's OWN flat
    // budget, not the withdrawing player's bags; it is pinned separately below.
    grantsOnly: true,
  },
  {
    path: 'src/sim/market.ts',
    sites: [
      { fn: 'marketBuy', what: 'the canGrantCopies gate on the purchased listing' },
      { fn: 'marketCancel', what: 'the canGrantCopies gate on the reclaimed listing' },
      { fn: 'marketCollect', what: 'the canGrantCopies gate on each collection-box row' },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/social/trade.ts',
    sites: [
      {
        fn: 'tradeConfirm',
        // The v0.40.0 release rewrote the closure's BODY around the one shared
        // shippedOfferUnits walk, so the model and the real removal cannot drift.
        // The site itself did not move, which is what this anchor pins.
        what: 'the fitsAfterSwap closure that budgets the units the swap will really ship',
      },
    ],
    grantsOnly: true,
  },
  {
    // Release-owned, and it joined the migrated set at the v0.40.0 sync rather
    // than at phase 05: the marketplace landed this escrow-custody return on the
    // FLAT arm, and the merge re-pointed it the way every sibling was already
    // pointed. Listed here for the table's stated reason, that it is the WHOLE
    // migrated set: without a row, the one thing standing between this site and
    // a silent revert to the flat total is the merge resolution that made it.
    path: 'src/sim/broker_custody.ts',
    sites: [
      {
        fn: 'grantTradableCopyImpl',
        what: 'the canGrantCopies gate on an escrowed copy returning to the bags',
      },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/items.ts',
    sites: [
      { fn: 'canReturnEquippedItemToBags', what: 'the countFit gate on an unequip' },
      { fn: 'buyBackItem', what: 'the countFit gate on the vendor buyback regrant' },
    ],
    // NOT grants-only: moveInventoryItem legitimately keeps the flat total, see
    // the dedicated pin below.
    grantsOnly: false,
  },
  {
    path: 'src/sim/interaction.ts',
    sites: [
      { fn: 'harvestCorpse', what: 'the fitsAll pre-gate over the wanted component rows' },
      { fn: 'harvestCorpse', what: 'the canGrantItemInstance gate on a signed non-specimen grant' },
      { fn: 'harvestCorpse', what: 'the canGrantItemInstance gate on a specimen grant' },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/professions/gathering.ts',
    sites: [
      { fn: 'completeGatherCast', what: 'the pools binding the signed-yield countFit consumes' },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/bank.ts',
    sites: [{ fn: 'bankWithdraw', what: 'the moveBetweenContainers destination pools' }],
    // Phase 06 replaced the bank's generalOnlyPools "single pool for now"
    // marker with the socket-derived split (bankPools); its shape is pinned
    // separately below.
    grantsOnly: true,
  },
  {
    path: 'src/sim/bank_sockets.ts',
    sites: [
      { fn: 'bankUnsocketBag', what: 'the carried-side canAddItem fit for the returning bag' },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/materials_vault.ts',
    sites: [
      {
        fn: 'vaultWithdraw',
        what: 'the shared pools binding both countFit payout branches into the bags',
      },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/quests/quest_commands.ts',
    sites: [
      {
        fn: 'turnInQuest',
        what: 'the countFit gate on the reward, over the scratch the turn-in consumption leaves',
      },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/professions/crafting.ts',
    sites: [
      {
        fn: 'evaluateCraftAdmission',
        what: 'the pools binding the every-shape fitsAll gate over the craft outputs consumes',
      },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/professions/salvage.ts',
    sites: [
      { fn: 'resolveSalvage', what: 'the canAddItem gate on the worst-case salvage payout' },
      {
        fn: 'evaluateSalvageAdmission',
        what: 'the same worst-case payout gate on the pre-cast admission arm',
      },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/professions/commission.ts',
    sites: [
      {
        fn: 'resolveUnbind',
        what: 'the countFit gate on the freed copy a stack-split unbind mints',
      },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/professions/commission_order.ts',
    sites: [
      {
        fn: 'deliverCommissionOrder',
        // Note the bags: requesterMeta, not the delivering crafter. That is why the
        // grants-only needle below is the bare `bagCapacity(` rather than the
        // `bagCapacity(meta.bags)` spelling, which would miss a revert here.
        what: 'the countFit gate on the delivery into the REQUESTER bags',
      },
    ],
    grantsOnly: true,
  },
  {
    path: 'src/sim/professions/enchanting.ts',
    sites: [
      { fn: 'resolveDisenchant', what: 'the fitsAll gate on the disenchant yield rows' },
      {
        fn: 'evaluateDisenchantAdmission',
        what: 'the same yield-row gate on the pre-cast admission arm',
      },
      {
        fn: 'resolveReplaceEnchantBagged',
        what: 'the countFit gate on a replacement enchant minted over a bagged victim',
      },
      { fn: 'resolveApplyEnchant', what: 'the countFit gate on the freshly enchanted copy' },
      {
        fn: 'evaluateApplyEnchantAdmission',
        what: 'the admission arm gate on the confirmed REPLACE path',
      },
      {
        fn: 'evaluateApplyEnchantAdmission',
        what: 'the admission arm gate on the fresh-enchant path',
      },
    ],
    grantsOnly: true,
  },
];

describe('two-pool wiring at the migrated sim command boundaries', () => {
  it.each(PINS)('$path asks bagPools in every function that gates a grant', (pin) => {
    const src = sourceOf(pin.path);
    const expected = new Map<string, number>();
    for (const site of pin.sites) expected.set(site.fn, (expected.get(site.fn) ?? 0) + 1);
    for (const [fn, calls] of expected) {
      const body = fnBody(src, fn);
      // Positive control for the slicer itself: a slice holds exactly ONE
      // declaration header, its own. A slice that swallowed a neighbour, or one cut
      // short by a line the header pattern misread, reds here rather than quietly
      // satisfying (or quietly failing) the count below.
      expect(body.match(new RegExp(DECL_SOURCE, 'gm')), `${pin.path} ${fn} slice`).toHaveLength(1);
      expect(occurrences(body, 'bagPools('), `${pin.path} ${fn}`).toBe(calls);
    }
    // The file total, read off the SOURCE and compared with the table: the
    // per-function counts above cannot see a site that appears in a function the
    // table does not name, and this cannot see one that merely moved. Together they
    // pin both the count and its placement.
    expect(occurrences(src, 'bagPools('), `${pin.path} total`).toBe(pin.sites.length);
  });

  it.each(PINS)('$path carries no flat-total revert', (pin) => {
    // The whole point of the file: these are the expressions that compile, pass
    // every behavioral suite, and silently un-split the pools.
    const src = sourceOf(pin.path);
    for (const needle of REVERT_NEEDLES) {
      expect(occurrences(src, needle), `${pin.path} must not contain ${needle}`).toBe(0);
    }
  });

  it.each(PINS.filter((p) => p.grantsOnly))('$path never reads a bare flat bag total', (pin) => {
    // Every bag-capacity question in these modules gates a grant, so the flat
    // total has no legitimate reader here in ANY spelling: not the
    // generalOnlyPools-wrapped one above, not `bagCapacity(meta.bags)`, and not
    // `bagCapacity(requesterMeta.bags)`, which is the shape a commission_order.ts
    // revert would actually take.
    expect(occurrences(sourceOf(pin.path), 'bagCapacity('), pin.path).toBe(0);
  });

  it('items.ts keeps its ONE flat total, and only for the arrangement command', () => {
    // The first deliberate exemption. moveInventoryItem hands the flat total to
    // moveStackToCell to bounds-check a drag between existing cells: it moves a
    // stack the bags already hold rather than granting a new one, so it asks about
    // the cell grid's extent and never about pool headroom. Pinned to the exact
    // count AND to the enclosing function, so a NEW flat read, or this one drifting
    // onto a grant, still reds. Sliced rather than matched line by line, so
    // rewrapping the call across lines cannot red a pin about WHERE the read lives.
    const src = sourceOf('src/sim/items.ts');
    expect(occurrences(src, 'bagCapacity(')).toBe(1);
    const body = fnBody(src, 'moveInventoryItem');
    expect(body).toContain('bagCapacity(meta.bags)');
    expect(body).toContain('moveStackToCell(');
  });

  it('sim.ts keeps its ONE flat total, and only for the IWorld readout', () => {
    // The second exemption, and the reason sim.ts is not grants-only. The
    // `bagCapacity` accessor is the flat slot total IWorld publishes for the bag
    // frame to render; it answers "how many cells does this player have", never
    // "does this grant fit", so it correctly stays flat. Two occurrences of the
    // token because the accessor's own name is one of them.
    const src = sourceOf('src/sim/sim.ts');
    expect(occurrences(src, 'bagCapacity(')).toBe(2);
    expect(fnBody(src, 'bagCapacity')).toContain('return bagCapacity(this.primary.bags);');
    // The grant-gate spelling, which the hub above owns and must never re-acquire.
    expect(occurrences(src, 'bagCapacity(meta.bags)')).toBe(0);
  });

  it('the personal bank passes its socket-derived split, never a flat budget or the bags', () => {
    // Phase 06: the personal bank's generalOnlyPools "single pool for now"
    // marker is GONE, replaced by bankPools (poolCapacityOf over the ladder
    // budget plus the socketed bag list). Pinning the definition's composition
    // AND both consuming functions is what separates the real split from a
    // revert that re-flattens the budget while keeping the helper name.
    const bank = sourceOf('src/sim/bank.ts');
    expect(occurrences(bank, 'generalOnlyPools(')).toBe(0);
    expect(fnBody(bank, 'bankPools')).toContain(
      'poolCapacityOf(bankCapacity(bank), bank.socketBags)',
    );
    expect(occurrences(fnBody(bank, 'bankDeposit'), 'bankPools(meta.bank)')).toBe(1);
    expect(occurrences(fnBody(bank, 'bankInfoFor'), 'bankPools(bank)')).toBe(1);
  });

  it('the guild bank passes its OWN budget through generalOnlyPools, never the bags', () => {
    // generalOnlyPools is the grep-able "single pool for now" marker bag_pools.ts
    // documents, and the guild bank legitimately keeps one: the container's own
    // flat capacity, which has no materials socket of its own. Pinning the
    // ARGUMENT is what separates that from the revert shape, which reuses the same
    // helper over the player's bags.
    const guildBank = sourceOf('src/sim/guild_bank.ts');
    expect(occurrences(guildBank, 'generalOnlyPools(')).toBe(1);
    expect(guildBank).toContain('generalOnlyPools(guildBankCapacity(book))');
  });

  it('the bank UI precheck consumes the WIRE pool split, never a flat total (phase 07)', () => {
    // The one migrated site OUTSIDE src/sim/: src/ui/bank_view.ts's deposit-all
    // planner was the last generalOnlyPools flat-pool marker on a personal-bank
    // path (state.md phase 07 owes item 3; this suite's src/sim scope never
    // reached it, which is why the pin lands here by name). The precheck now
    // reads the split OFF THE WIRE (bankPoolsOf over BankInfo's
    // generalCapacity/materialsCapacity) rather than re-deriving pool math
    // client-side, so the plan can never disagree with the sim's own gate.
    // The behavioral arm (an over-occupied general pool beside a free
    // materials pool) lives in tests/bank_view.test.ts; these pins hold the
    // wiring's spelling against the compiling reverts.
    const view = sourceOf('src/ui/bank_view.ts');
    for (const needle of REVERT_NEEDLES.concat('generalOnlyPools(', 'bagCapacity(')) {
      expect(occurrences(view, needle), `src/ui/bank_view.ts must not contain ${needle}`).toBe(0);
    }
    expect(fnBody(view, 'bankPoolsOf')).toContain(
      'return { general: info.generalCapacity, materials: info.materialsCapacity };',
    );
    expect(fnBody(view, 'planDepositAllMaterials')).toContain(
      'moveBetweenContainers(invClone, i, count, bankClone, pools)',
    );
    // ...and the painter hands the planner exactly that wire split (the call
    // shape is source-pinned in tests/bank_window.test.ts; the count here
    // keeps a second, flat-total call from riding in beside it).
    const painter = sourceOf('src/ui/bank_window.ts');
    expect(occurrences(painter, 'planDepositAllMaterials(')).toBe(1);
    expect(occurrences(painter, 'bankPoolsOf(')).toBe(1);
    // ...and the painter's two EXTRACTED siblings are read too (Bank Storage
    // phase 17 QA). The counts above are scoped to bank_window.ts alone, which
    // phase 17's own guard census named as a guard that shrinks SILENTLY when the
    // code moves: a second, drifting pool call site landing in a sibling evades
    // every arm in this file. Nothing moved one there, which is why nothing went
    // red and why this was the one census row nobody re-pointed; the gap is
    // structural rather than a phase-17 regression, and it closes here.
    // Bank Storage phase 18 created two MORE siblings out of the same painter,
    // and one of them reads the pool four directly (bank_meter_view.ts maps
    // meter.general and meter.materials into the readout's copy), which is
    // exactly the drift this list exists to catch. Adding them here is the row
    // this guard owed the moment the extraction landed.
    for (const path of [
      'src/ui/bank_bonus_view.ts',
      'src/ui/bank_rung_purchase_core.ts',
      'src/ui/bank_meter_view.ts',
      'src/ui/bank_chrome_layout_core.ts',
    ]) {
      const sibling = sourceOf(path);
      for (const needle of REVERT_NEEDLES.concat(
        'generalOnlyPools(',
        'bagCapacity(',
        'bagPools(',
        'bankPools(',
        'bankPoolsOf(',
        'planDepositAllMaterials(',
      )) {
        expect(occurrences(sibling, needle), `${path} must not contain ${needle}`).toBe(0);
      }
      // Liveness, or every ban above passes over an unreadable path.
      expect(sibling.length, `${path} read back empty`).toBeGreaterThan(500);
    }
  });
});
