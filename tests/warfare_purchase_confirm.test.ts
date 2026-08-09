// The Warfare shop's purchase confirmation, pinned as a STRUCTURE rather than a
// comment.
//
// Honor purchases record no buyback, so a mis-tap is unrefundable, and the gear is
// expensive. `Hud.requestWarfarePurchase` therefore fires the buy command ONLY from
// the confirm dialog's accept callback. That invariant was carried by a source
// comment ("the buy command fires ONLY from the confirm callback") and by nothing
// else: moving `this.sim.buyItem(...)` one line up, out of the callback and into the
// method body, would spend a player's honor with no prompt and break no test.
//
// It matters more now that the generic goods row is suppressed at a Warfare vendor
// (quest_dialog_controller): the sectioned shop is the ONLY purchase route at those
// two NPCs, so this one gate carries all of it.
//
// Read as a call walk rather than a grep, using the same helper the HUD cadence
// registry uses. The helper's contract is the assertion: a call inside a callback is
// NOT a direct evaluation of the enclosing method, so `buyItem` appearing in the
// direct-call list is exactly the regression this guards.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ITEMS, NPCS } from '../src/sim/data';
import { readMethodCallSites } from './helpers/method_call_sites';

const HUD_PATH = new URL('../src/ui/hud.ts', import.meta.url);
const HUD_SRC = readFileSync(HUD_PATH, 'utf8');

function scan(method: string) {
  return readMethodCallSites('src/ui/hud.ts', HUD_SRC, 'Hud', method);
}

/** Source text of one `Hud` method, for the presence half of each check. */
function methodSource(method: string): string {
  const from = HUD_SRC.slice(HUD_SRC.indexOf(`private ${method}`));
  return from.slice(0, from.indexOf('\n  }\n') + 4);
}

// The two unrefundable-currency shops, each with the EXACT command its confirm
// callback is required to own. Naming the command per shop is load-bearing, not
// tidiness: the first version of this file asserted `buyItem` for BOTH rows, and
// the Marks command is `buyHeroicVendorItem`, which does not contain that
// substring. So the sibling row could never have failed, however the heroic
// purchase was refactored, while claiming to cover it (OSSBrain review, #3137).
// Parameterizing removes the whole class of mistake: each row now says the one
// call it forbids, and the vacuity assertion below proves that call is really in
// the method it names.
const CONFIRMED_PURCHASES = [
  { method: 'requestWarfarePurchase', command: 'buyItem', label: 'Warfare (honor)' },
  {
    method: 'requestHeroicVendorPurchase',
    command: 'buyHeroicVendorItem',
    label: 'Heroic Marks',
  },
] as const;

describe('Warfare purchases are gated behind the confirm dialog', () => {
  it.each(CONFIRMED_PURCHASES)(
    'routes the $label buy through confirmDialog, never calling $command directly',
    ({ method, command }) => {
      const calls = scan(method).sites.map((s) => s.call);

      // The dialog IS evaluated by the method.
      expect(calls, `${method} must open the confirm dialog`).toContain('this.confirmDialog');

      // The purchase is NOT. It lives in the accept callback, which the walk
      // deliberately does not count as a direct evaluation, so hoisting it out of
      // the callback makes it appear here and fails this.
      expect(
        calls.filter((c) => c.includes(command)),
        `${command} must fire only from the confirm callback, never directly`,
      ).toEqual([]);
    },
  );

  it.each(CONFIRMED_PURCHASES)(
    'names a $command that really exists in $method, so the row cannot be vacuous',
    ({ method, command }) => {
      // Guards the guard, in both directions. An empty method, a renamed command,
      // or a typo in the table would each satisfy the assertion above by matching
      // nothing at all. This is exactly what the original single-command version
      // lacked for the heroic row.
      const source = methodSource(method);
      expect(source, `${method} must still perform ${command} somewhere`).toContain(command);
      expect(source, `${method} must still open a confirm dialog`).toContain('confirmDialog');
    },
  );

  it('forbids a DISTINCT command per shop, so one row cannot stand in for the other', () => {
    // The heroic bug in miniature: two rows sharing one command string means the
    // narrower shop is unguarded. Pinning distinctness keeps a future editor from
    // collapsing them back together.
    const commands = CONFIRMED_PURCHASES.map((row) => row.command);
    expect(new Set(commands).size, 'each shop must forbid its own command').toBe(commands.length);
    // And neither may be a substring of the other, which is the precise trap
    // here: a `buyItem` filter silently matches nothing in `buyHeroicVendorItem`.
    for (const a of commands) {
      for (const b of commands) {
        if (a !== b) expect(a.includes(b), `${a} must not subsume ${b}`).toBe(false);
      }
    }
  });

  it('leaves no honor-priced stock reachable through the UNCONFIRMED ordinary window', () => {
    // The completeness half, and the reason the goods-row suppression is a
    // safety fix rather than only a tidiness one. The ordinary vendor window
    // renders an honor price for its rows (vendor_view.ts) and its onBuy calls
    // sim.buyItem straight through with NO confirm, so while a WARFARE
    // quartermaster still offered a generic goods row, a player could spend
    // tens of thousands of honor on a set piece in one click, out of the very
    // same stock the sectioned window guards.
    //
    // The window-level guards above say the WARFARE and Marks shops confirm.
    // Only this says nothing ELSE sells honor gear, which is what makes "an
    // expensive purchase always confirms" true rather than merely local. If a
    // future NPC gains honor-priced stock, it must either carry warfareVendor
    // (routing to the sectioned window) or grow its own confirm, and this fails
    // until one of those happens.
    const honorSellers = Object.values(NPCS)
      .filter((npc) => (npc.vendorItems ?? []).some((id) => (ITEMS[id]?.priceHonor ?? 0) > 0))
      .map((npc) => npc.id)
      .sort();

    // Not vacuous: the two shipped quartermasters really do stock honor gear,
    // so an empty sweep would mean the price field moved, not that the rule holds.
    expect(honorSellers).toEqual(['fury', 'warmarshal_draven_kole']);
    for (const id of honorSellers) {
      expect(NPCS[id].warfareVendor, `${id} sells honor gear without the shop flag`).toBe(true);
    }
  });
});
