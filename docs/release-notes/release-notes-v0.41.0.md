# World of ClaudeCraft v0.41.0 Release Notes

**Release:** v0.41.0
**Date:** 2026-08-25
**Previous release:** v0.40.0

Version 0.41.0 is the storage release. Bank pressure has been the loudest standing complaint from
players who craft, and almost all of the answer here is free: a new Materials Vault that holds
crafting materials outside your bank, a wider bag catalog, four bank bag sockets, and a capacity
meter that finally tells you where the space went. Prices are covered further down, after the
things that cost nothing.

This file covers the storage work. Other v0.41.0 items are added alongside these sections.

## Highlights

- The Materials Vault stores crafting materials per character, outside the bank, with its own
  ceiling per material. Crafting draws from it automatically.
- Seven new bags, including the first reagent satchels, which hold materials only and free your
  ordinary bag space for everything else.
- Four bank bag sockets let you seat spare bags into the bank itself.
- A capacity meter on the bank window shows what is used, what is left, and which of the two
  pools it belongs to.
- The bank window is usable on a short phone again: on a stocked bank the meter and footer used
  to sit past the window edge where nothing could reach them.
- Crafting no longer makes you withdraw reagents first.

## The Materials Vault

The Materials Vault is a third tab in the bank window, beside Personal and Guild. It is per
character, like the bank, and it holds only crafting materials. Every material gets its own room
rather than sharing one pool, so a stack of one thing can never crowd out another.

- The vault starts at 40 of each material and widens in four steps to 200 of each.
- Deposit by clicking a material in your bags while the Vault tab is open, or use Deposit All to
  send everything in one trip. Gear, tools, quest items, and consumables are never touched.
- Withdrawing more than your bags can hold tells you how many actually fit instead of failing.
- The vault is a banker service, like the bank: deposits and withdrawals happen at a bursar.

## Crafting draws from the vault

Crafting now spends the reagents you are carrying first, then takes the rest straight from your
Materials Vault. The crafting window marks each line that will draw from the vault, so you can
see it before you commit. This works in the open world. Inside dungeons, delves, raids, rifts,
battlegrounds, and the arena you craft from what you carry, and the window says so plainly rather
than silently failing.

## Bank bag sockets

The bank gains four bag sockets, a tier above the existing slot ladder. Seat any bag into a
socket and its slots join your bank's budget. Sockets unlock in order, cheapest first.

Bags come in two kinds now, and the difference matters here. An ordinary bag widens your general
space. A reagent satchel widens materials-only space. Socketing a satchel trades general room for
a larger materials allowance, which is the point: it is a choice, not an upgrade.

Taking a bag back out never loses anything. If removing it leaves your bank over its budget,
everything stays exactly where it is and the bank simply refuses new deposits until there is room
again.

Two new deeds track the sockets, Strongbox Outfitter for the first and Four Bags Deep for all
four. Both award Renown only, like every deed.

## Bags

Seven new bags, four of them reagent satchels:

| Bag | Slots | Holds | How you get it |
|---|---:|---|---|
| Burlap Reagent Pouch | 8 | Materials only | Vendor, zone 1 |
| Forager's Haversack | 12 | Materials only | Tailoring |
| Duskweave Bag | 12 | Anything | Tailoring |
| Wayfarer's Backpack | 16 | Anything | World drop |
| Resonantweave Bag | 16 | Anything | Tailoring |
| Necromancer's Reagent Satchel | 20 | Materials only | Grand Necromancer |
| Loombound Reagent Satchel | 24 | Materials only | Tailoring |

The Loombound Reagent Satchel is the largest bag in the game. Both of the unique bags have
Reliquary pages telling you where they come from: the Necromancer's Reagent Satchel joins the
Gravewyrm Sanctum page and the Wayfarer's Backpack joins Spoils of the Realm. Because those two
pages already shipped, a page you had completed shows as incomplete again until you find the new
bag. Item tooltips now name a materials-only bag as such, so the restriction is legible before
you buy or craft one.

## Reading your space at a glance

The bank window carries a capacity meter showing slots used against slots available, split into
the general and materials pools, with a note explaining that materials-only space cannot take
anything else. The meter warms to a gilded treatment as the general pool approaches full, so a
bank filling up looks like one before it stops accepting deposits. Your carried bags window gained
the same two-pool readout.

On phones, a stocked bank used to push the meter and the footer past the window border, where
they could not be reached or even seen. The bank pane now scrolls, which also pins the tab title
in place. This is a layout fix with no new control.

## How large the bank can get

Published plainly, because it is worth knowing before you spend:

- A bank starts at 24 slots.
- The gold slot ladder is unchanged: 12 rungs of 6 slots, so 96 slots once fully bought.
- Account bonus slots add up to 16 more.
- Four socketed bags add their own slots on top. Filled with the largest bags available today, a
  bank reaches 272 items, of which up to 96 is materials-only room.
- The Materials Vault sits outside all of that, at up to 200 of each material.

That socket number is not a fixed ceiling. It is four times whatever the largest bag happens to
be, so it grows with the game as new bags are added.

## Gold prices

Everything above except the bags you craft or find is bought with gold at a bursar. The existing
twelve-rung bank slot ladder is unchanged and nothing about already-purchased slots changes.

These prices are set on the server and can be adjusted without a client update, so the bursar is
always the current answer and the numbers below are the launch values. Every purchase surface
carries a line noting that prices may change with the game economy.

- Bank bag sockets: 100 gold, 200 gold, 350 gold, and 500 gold, in that order.
- Materials Vault: 2 gold to unlock, then 5 gold, 10 gold, 20 gold, and 40 gold to widen every
  material ceiling by 40 each time.

## Strongbox Charters

The WOC Store gains a Strongbox category selling charters that expand one character's bank by a
fixed number of slots. They advance the same ladder the bursar sells for gold and reach no
capacity gold cannot: the bursar can always sell the same slots. A charter is offered only when
its full grant fits in the room left. Slot expansions bought this way apply to that character
only. The bursar's own expansion button now shows a second price tag when the store is reachable.

Prices are in the store rather than here, because they are set server side and would go stale in
a release note. The store category is a web client surface and is not present in the native app
shells.

## Compatibility and upgrade notes

- Characters saved before this release load without change. A character with no vault and no
  sockets simply has neither until it buys them.
- A bank left over its budget after a bag is unsocketed keeps everything it holds. Over-capacity
  is tolerated and never truncated.
- The Materials Vault and socketed bags are new character state. Run one version of the game
  server across the fleet during the upgrade rather than a rolling restart: a server binary from
  before this release does not know these keys and drops them on its next save. The same applies
  in reverse to any rollback past this release, where it destroys socketed bags outright.
- Store availability is set by the economy service catalog, so the charter category can be
  withdrawn without a game release.

## Verification

- The release includes unit, integration, parity, browser, and mobile-layout coverage for the
  simulation, wire, server, and interface work above, including item-conservation property tests
  on every operation that moves an item.
- Purchase flows were driven end to end against a real economy service, including outage,
  timeout, and page-reload cases.
- The full release gate, release locale fill, version check, and malware audit are required to
  pass before merge.
