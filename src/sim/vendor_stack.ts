// Pure, host-agnostic helper: how many units a single vendor purchase yields.
//
// Classic vendors hand out staple food and drink in stacks (you click once and
// get a stack), while gear, reagents, and potions are bought one at a time. The
// stack is charged PER UNIT: one purchase debits the listed buyValue for every
// unit in the stack (items.ts buyItem, vendor_view.ts VendorPrice), keeping the
// per-unit price classic and above the per-unit sell value. Keeping this a leaf
// (no Sim state, no DOM) lets BOTH the sim buy path (items.ts buyItem) and the
// vendor window view (ui/hud/vendor/vendor_view.ts) share one rule, so the UI's
// "x5" badge can never drift from what the server grants.
//
// DOM-free and deterministic so tests/vendor_stack.test.ts drives it directly.

import type { ItemDef } from './types';

/** Units handed over per purchase for a stacked vendor staple (food / drink). */
export const VENDOR_STACK_SIZE = 5;

/**
 * How many units one click on this vendor good yields. Food and drink come in a
 * stack of VENDOR_STACK_SIZE for the same listed price; everything else is one
 * unit per purchase.
 */
export function vendorStackSize(def: ItemDef): number {
  return def.kind === 'food' || def.kind === 'drink' ? VENDOR_STACK_SIZE : 1;
}
