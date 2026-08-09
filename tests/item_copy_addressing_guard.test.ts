// Every item command can NAME the copy it acts on.
//
// This is the guard that makes the copy-addressing work a fix rather than a
// fourth patch. The defect has been treated three times without being closed
// (the phase 12 trade copy-choice fix, the phase 18 discard and vendor widening,
// the #2398 buyback review), each time by adding a heuristic predicate to bias a
// guess. The reason it kept coming back is that nothing stopped the NEXT item
// command from shipping id-only, and every one that did inherited the bug.
//
// So this test enumerates the item-acting commands from source and asserts each
// one carries per-copy addressing, with a short, justified exemption list. It is
// deliberately a source scan rather than a behavior test: behavior tests cover
// what a surface DOES, and nothing but a sweep can say that no surface was
// forgotten.
//
// Two limits, stated so this is not read as more than it is. It checks that the
// wire message can CARRY a selection, not that every UI call site passes one (a
// caller that has no slot in hand, like the char window's paperdoll-to-paperdoll
// drag, legitimately passes nothing). And it reads `ClientWorld` senders, so a
// hand-crafted frame from a modified client is out of scope: the sim re-validates
// every index against its own inventory, which is what actually guards that.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ONLINE = readFileSync(new URL('../src/net/online.ts', import.meta.url), 'utf8');
const SERVER = readFileSync(new URL('../server/game.ts', import.meta.url), 'utf8');

/**
 * The item-acting wire commands, each with the field that names the copy.
 *
 * `slot` is the bag index everywhere it is free. The `equip` token is the one
 * exception and uses `bagSlot`, because there `slot` already means the EQUIP slot
 * (equipItemToSlot). That collision is the reason this table records the field
 * per command instead of assuming one name: `apply_enchant`'s `slot` is an equip
 * slot too, so "the command has a slot field" would have been a vacuous check.
 */
const ADDRESSED_COMMANDS: ReadonlyArray<{ cmd: string; field: string; why?: string }> = [
  { cmd: 'salvage_item', field: 'slot' },
  { cmd: 'disenchant_item', field: 'slot', why: 'the original precise surface' },
  { cmd: 'discard', field: 'slot' },
  { cmd: 'sell', field: 'slot' },
  { cmd: 'use', field: 'slot' },
  { cmd: 'pet_feed', field: 'slot' },
  { cmd: 'equip_bag', field: 'slot' },
  { cmd: 'rift_upgrade_item', field: 'slot' },
  { cmd: 'rift_enchant_item', field: 'slot' },
  { cmd: 'rift_socket_gem', field: 'slot' },
  { cmd: 'equip', field: 'bagSlot', why: 'slot is the equip slot on this token' },
];

/**
 * Item commands that carry NO copy selection, each with the reason it needs none.
 * A new entry here is a claim that has to survive review, which is the point: the
 * cost of an exemption is writing down why.
 */
const EXEMPT: ReadonlyArray<{ cmd: string; why: string }> = [
  {
    cmd: 'market_list',
    why: 'fungible-only by construction: it refuses unless countFungibleItem covers the request, and the instanced path is the separate market_list_instance command, which names the copy by payload',
  },
  {
    cmd: 'market_list_instance',
    why: 'already names the copy, by instance payload rather than bag index',
  },
  {
    cmd: 'buyback',
    why: 'already names the copy, by the buyback row instance payload (#2398)',
  },
  {
    cmd: 'apply_enchant',
    why: 'targets a WORN piece by equip slot; a worn piece is one copy per slot, so there is nothing to disambiguate',
  },
  {
    cmd: 'unbind_item',
    why: 'resolved by bag slot index inside professions/commission.ts rather than by item id',
  },
  {
    cmd: 'buy',
    why: 'acquires a copy from vendor stock rather than acting on one the player holds',
  },
  {
    cmd: 'mail_send',
    why: 'names the copy by PAYLOAD rather than bag index: it ships full InvSlots and post_office resolves each against the sender bags with removeMatchingInstance, the market_list_instance shape',
  },
  {
    cmd: 'trade_offer',
    why: 'ships full InvSlots so the payload is on the wire, but the consume still uses the phase 12 sellerSignedCharmDeprioritize heuristic rather than matching that payload. Exempted as a KNOWN remaining gap rather than left invisible: converting the trade offer is follow-up work, and this entry is what keeps it from being forgotten',
  },
  {
    cmd: 'sell_all_junk',
    why: 'operates over the whole junk set by definition, so no single copy is named',
  },
];

/** Sender bodies from ClientWorld, keyed by the wire token they send. */
function senderBodyFor(cmd: string): string {
  // Every sender routes through the private cmd() helper, so the token literal
  // appears inside the method that owns it. Take a window around each occurrence
  // rather than parsing: the assertion only needs to see whether the selection
  // field rides alongside the token.
  const needle = `cmd: '${cmd}'`;
  let out = '';
  let at = ONLINE.indexOf(needle);
  while (at !== -1) {
    out += ONLINE.slice(at, at + 220);
    at = ONLINE.indexOf(needle, at + 1);
  }
  return out;
}

describe('every item command can name the copy it acts on', () => {
  it.each(ADDRESSED_COMMANDS)('$cmd carries a $field selection on the wire', ({ cmd, field }) => {
    const body = senderBodyFor(cmd);
    expect(body, `no ClientWorld sender found for ${cmd}`).not.toBe('');
    expect(body, `${cmd} must be able to send a ${field}`).toContain(field);
  });

  it.each(ADDRESSED_COMMANDS)('$cmd is parsed and forwarded server-side', ({ cmd, field }) => {
    // The client being able to SEND it is half the contract; the server arm has
    // to read it, or the selection is silently dropped at the authority boundary,
    // which is indistinguishable from the bug.
    //
    // The window ENDS at the next `case '`, which is load-bearing. A fixed-length
    // slice bleeds into neighbouring arms, and since most of them do parse a
    // selection, this assertion passed even with the arm under test reverted:
    // verified by reverting `use` and watching it stay green. Bounding the arm is
    // what gives it teeth.
    const at = SERVER.indexOf(`case '${cmd}':`);
    expect(at, `no dispatch arm for ${cmd}`).toBeGreaterThan(-1);
    const rest = SERVER.slice(at + `case '${cmd}':`.length);
    const nextCase = rest.indexOf("case '");
    const arm = nextCase === -1 ? rest : rest.slice(0, nextCase);
    expect(arm, `${cmd} must parse msg.${field} in its OWN dispatch arm`).toContain(
      `Number.isInteger(msg.${field})`,
    );
    // Parsing is half of it. An arm that reads the field and then calls the sim
    // without it drops the selection at the authority boundary, which is
    // indistinguishable from never having sent it. Require the parsed local to
    // reach a sim call in the same arm.
    const local = field === 'bagSlot' ? 'bag' : 'slot';
    const simCall = arm.slice(arm.indexOf('sim.'));
    expect(simCall, `${cmd} must FORWARD the parsed ${local} to the sim call`).toMatch(
      new RegExp(`\\b${local}\\b`),
    );
  });

  it('exempts only commands with a written reason, and no command is in both lists', () => {
    // Guards the guard. An exemption with no reason, or a command quietly living
    // in both tables, would let a surface escape while the file still looked
    // complete.
    for (const row of EXEMPT) {
      expect(row.why.length, `${row.cmd} needs a real reason`).toBeGreaterThan(30);
    }
    const addressed = new Set(ADDRESSED_COMMANDS.map((r) => r.cmd));
    for (const row of EXEMPT) {
      expect(addressed.has(row.cmd), `${row.cmd} cannot be both addressed and exempt`).toBe(false);
    }
  });

  it('covers every item-acting command the client can send, so nothing is unclassified', () => {
    // The completeness half, and the only assertion here that catches a NEW
    // command. Anything that sends an `item` field is acting on an item and must
    // appear in exactly one of the two tables above.
    const sending = new Set<string>();
    // `items?` on purpose: the first version matched only a literal `item` field,
    // so trade_offer and mail_send (both of which ship items, as an `items` array)
    // escaped classification entirely.
    const re = /cmd: '([a-z_]+)'[^}]*\bitems?\b/g;
    for (const m of ONLINE.matchAll(re)) sending.add(m[1]);

    // Not vacuous: the sweep really does find the family.
    expect(sending.size, 'expected the scan to find many item commands').toBeGreaterThan(10);

    const classified = new Set([
      ...ADDRESSED_COMMANDS.map((r) => r.cmd),
      ...EXEMPT.map((r) => r.cmd),
    ]);
    const unclassified = [...sending].filter((c) => !classified.has(c)).sort();
    expect(
      unclassified,
      'a new item command must either name the copy it acts on or be exempted with a reason',
    ).toEqual([]);
  });
});
