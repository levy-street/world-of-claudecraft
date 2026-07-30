// Off-by-default account provisioning for community test realms. This module owns
// the immutable character templates and generated-name policy; db.ts owns the
// transaction that inserts them. The templates are built through public Sim APIs
// so level, derived stats, equipment rules, bags, and persistence stay canonical.
//
// Gear: each template wears the TRUE best-in-slot PvE kit for its class's
// primary role and carries every alternate role's kit in four best-in-game
// bags, riding trained and Nythraxis-attuned, via the shared boost kit
// (server/pbe_boost.ts applyBoostKitToPlayer). The original hand-curated
// WARFARE (honor vendor) loadouts were retired 2026-07-22: their PvP-budgeted
// stats are exactly what endgame PvE testers should not be wearing (the
// S-raid playtest ran in them), and one shared kit source cannot drift.

import { type CharacterState, Sim } from '../src/sim/sim';
import { ALL_CLASSES, ALL_EQUIP_SLOTS, MAX_LEVEL, type PlayerClass } from '../src/sim/types';
import { validCharName } from './auth';
import { applyBoostKitToPlayer } from './pbe_boost';

const TEMPLATE_SEED = 20061;
const NAME_TOKEN_LENGTH = 8;
export const GENERATED_NAME_ATTEMPTS = 32;

export interface CommunityTestCharacter {
  readonly cls: PlayerClass;
  readonly name: string;
  readonly state: CharacterState;
}

let enabled = false;
let cachedTemplates: ReadonlyMap<PlayerClass, CharacterState> | null = null;

export function configureCommunityTestAccounts(next: boolean): void {
  enabled = next;
}

export function communityTestAccountsEnabled(): boolean {
  return enabled;
}

function cloneState(state: CharacterState): CharacterState {
  return JSON.parse(JSON.stringify(state)) as CharacterState;
}

function templateStates(): ReadonlyMap<PlayerClass, CharacterState> {
  if (cachedTemplates) return cachedTemplates;
  const sim = new Sim({ seed: TEMPLATE_SEED, playerClass: 'warrior', noPlayer: true });
  const templates = new Map<PlayerClass, CharacterState>();
  for (const cls of ALL_CLASSES) {
    const pid = sim.addPlayer(cls, `${cls}template`);
    sim.setPlayerLevel(MAX_LEVEL, pid);
    // Remove starter gear before applying the kit. With live offhands and
    // dual wielding, leaving it equipped can route the intended mainhand into
    // the offhand or retain an obsolete shield beside a two-hander.
    for (const slot of ALL_EQUIP_SLOTS) sim.unequipItem(slot, pid);
    // The shared boost kit: bags, the primary role's true-BiS kit equipped,
    // every alternate role's kit in the bags, riding, and the attunement. The
    // kit-version stamp it writes also tells the world-join top-up these
    // characters are already current.
    if (!applyBoostKitToPlayer(sim, pid)) {
      throw new Error(`boost kit did not apply to community test template for ${cls}`);
    }
    // Equipment can raise maximum health and mana, so refill through the same
    // authoritative level path after the final stat recalculation.
    sim.setPlayerLevel(MAX_LEVEL, pid);
    const state = sim.serializeCharacter(pid);
    if (!state) throw new Error(`failed to build community test template for ${cls}`);
    templates.set(cls, state);
  }
  cachedTemplates = templates;
  return cachedTemplates;
}

/** Build and cache pristine templates before opening an account transaction. */
export function prepareCommunityTestCharacters(): void {
  templateStates();
}

function encodeNameToken(value: bigint): string {
  let cursor = value;
  const chars = Array<string>(NAME_TOKEN_LENGTH).fill('a');
  for (let index = NAME_TOKEN_LENGTH - 1; index >= 0; index--) {
    chars[index] = String.fromCharCode(97 + Number(cursor % 26n));
    cursor /= 26n;
  }
  return chars.join('');
}

export function generatedTestCharacterName(
  accountId: number,
  cls: PlayerClass,
  attempt = 0,
): string {
  const safeAccountId = Math.max(0, Math.floor(accountId));
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const encoded = BigInt(safeAccountId) * BigInt(GENERATED_NAME_ATTEMPTS) + BigInt(safeAttempt);
  const prefix = `${cls[0].toUpperCase()}${cls.slice(1)}`;
  return `${prefix}${encodeNameToken(encoded)}`;
}

function firstValidName(accountId: number, cls: PlayerClass): string {
  for (let attempt = 0; attempt < GENERATED_NAME_ATTEMPTS; attempt++) {
    const candidate = generatedTestCharacterName(accountId, cls, attempt);
    if (validCharName(candidate)) return candidate;
  }
  throw new Error(`failed to generate a valid community test name for ${cls}`);
}

export function buildCommunityTestCharacters(accountId: number): CommunityTestCharacter[] {
  const templates = templateStates();
  return ALL_CLASSES.map((cls) => {
    const state = templates.get(cls);
    if (!state) throw new Error(`missing community test template for ${cls}`);
    return { cls, name: firstValidName(accountId, cls), state: cloneState(state) };
  });
}
