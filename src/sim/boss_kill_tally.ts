// The character's lifetime boss kill tally: how many times this character has
// felled each instance boss, per difficulty. It backs IWorld.bossKills (the
// Adventure Journal's "Your kills" strip) on every host: the offline Sim reads
// it off the primary player, and the server ships it on the self record
// (`bkills`) for the online mirror.
//
// WHAT COUNTS is content, never a rule in here: every encounter the Dungeon
// Finder catalogue authors (content/dungeon_finder.ts, every activity kind:
// five-player dungeons, the shipped raids, the solo crypt) plus the Smith's
// Heart's own route (its council as ONE encounter of two bodies). A boss made
// of several bodies (the Mere Hydra's heads, the Hammer Council) is one kill,
// counted when its LAST body falls while every other body lies dead in the
// same claim, so a head that grows back or a council member that falls first
// never counts on its own. Only a death inside a claimed instance counts: a
// boss template met anywhere else (a dev spawn, a dummy) never does.
//
// WHO IS CREDITED mirrors the Weekly Vault's boss row (weekly_rewards.ts
// recordWeeklyBossKill), the same death-time participation snapshot the loot
// and the Heroic Marks use, widened by the claim's own roster for those who
// actually walked through the door, so a raider who died and released still
// counts the kill their raid made.
//
// WHEN: called once from the death hub (combat/damage.ts), the authoritative
// kill point, on the server and the offline Sim alike. It draws NO rng and
// reads no clock; a client never writes it.
//
// STORAGE: a frozen record on PlayerMeta, keyed `<bossMobId>` for Normal and
// `<bossMobId>:heroic` for Heroic (the deeds' dungeonClears idiom), replaced
// (never mutated) on every kill so a reader can hold it by identity: the
// server serializes each record once, and the client mirror stays the same
// object until a count moves. Persisted inside the character save
// (character_storage.ts), absent while empty, so an old save loads as no kills.

import { FINDER_ACTIVITIES, finderEncounterBodyIds } from './content/dungeon_finder';
import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
} from './content/smith_heart';
import { dungeonPlacedBossDead } from './instances/dungeon_gates';
import { instanceLockoutMetas } from './instances/dungeons';
import type { InstanceSlot, PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { DungeonDifficulty, Entity } from './types';

/** Kill counts keyed `<bossMobId>` (Normal) or `<bossMobId>:heroic`. */
export type BossKillTally = Readonly<Record<string, number>>;

/** The tally every character starts with, and the read for a missing one. */
export const EMPTY_BOSS_KILLS: BossKillTally = Object.freeze({});

/** The live state this module owns on PlayerMeta. */
export interface BossKillTallyState {
  bossKills?: BossKillTally;
}

/** The highest count a key may hold (a load clamps above it). */
export const BOSS_KILL_COUNT_CAP = 1_000_000;
/** The most keys a tally keeps; far above every boss the game places. */
export const BOSS_KILL_KEY_CAP = 512;

const KEY_RE = /^[a-z0-9_]{1,80}(:heroic)?$/;

/** The tally key of one boss on one difficulty. */
export function bossKillKey(bossMobId: string, difficulty: DungeonDifficulty): string {
  return difficulty === 'heroic' ? `${bossMobId}:heroic` : bossMobId;
}

/** One boss's count on one difficulty (0 when never killed). */
export function bossKillCount(
  tally: BossKillTally,
  bossMobId: string,
  difficulty: DungeonDifficulty,
): number {
  const key = bossKillKey(bossMobId, difficulty);
  return Object.hasOwn(tally, key) ? tally[key] : 0;
}

/** One tracked encounter: the key it counts under and every body it needs. */
export interface BossKillEncounter {
  mobId: string;
  bodyIds: readonly string[];
}

/** Single-body bosses with a journal page and no Finder encounter row. */
const JOURNAL_PAGE_BOSSES: readonly string[] = [
  'crypt_ossuary_drake',
  'crypt_knellwyrm',
  'turretback_hermit',
  'sledge_tusker',
  'great_saurian',
];

function buildEncounters(): ReadonlyMap<string, BossKillEncounter> {
  const byBody = new Map<string, BossKillEncounter>();
  const add = (mobId: string, bodyIds: readonly string[]) => {
    if (bodyIds.some((body) => byBody.has(body))) return;
    const encounter: BossKillEncounter = Object.freeze({
      mobId,
      bodyIds: Object.freeze([...bodyIds]),
    });
    for (const body of bodyIds) byBody.set(body, encounter);
  };
  for (const activity of FINDER_ACTIVITIES) {
    for (const encounter of activity.encounters) {
      add(encounter.mobId, finderEncounterBodyIds(encounter));
    }
  }
  // The bosses the Finder's encounter lists leave out but the Adventure
  // Journal gives a page of their own: the dungeons' named minibosses and the
  // Hollow Crypt's summoned finale. tests/boss_kill_tally.test.ts fails any
  // journal page with no tracked body, so a new page cannot read 0 forever.
  for (const mobId of JOURNAL_PAGE_BOSSES) add(mobId, [mobId]);
  // The Smith's Heart is not in the Finder yet: its route, the council as one.
  add(SMITH_HEART_COUNCIL[0], SMITH_HEART_COUNCIL);
  add(SMITH_HEART_GUARDIANS.breath, [SMITH_HEART_GUARDIANS.breath]);
  add(SMITH_HEART_GUARDIANS.quench, [SMITH_HEART_GUARDIANS.quench]);
  add(SMITH_HEART_GUARDIANS.heat, [SMITH_HEART_GUARDIANS.heat]);
  add(SMITH_HEART_FINAL_BOSS, [SMITH_HEART_FINAL_BOSS]);
  return byBody;
}

/** Every tracked body, to the encounter it belongs to. Built once from
 *  immutable content. */
export const BOSS_KILL_ENCOUNTERS: ReadonlyMap<string, BossKillEncounter> = buildEncounters();

/** The encounter a dying body completes in this claim, or null: an untracked
 *  template, or a body whose fellow bodies still stand. */
export function completedBossEncounter(
  ctx: SimContext,
  inst: InstanceSlot,
  bodyId: string,
): BossKillEncounter | null {
  const encounter = BOSS_KILL_ENCOUNTERS.get(bodyId);
  if (!encounter) return null;
  if (encounter.bodyIds.length === 1) return encounter;
  return encounter.bodyIds.every((body) => dungeonPlacedBossDead(ctx, inst, body))
    ? encounter
    : null;
}

/** Add one kill of `bossMobId` on `difficulty` to a character's tally. */
export function addBossKill(
  meta: BossKillTallyState,
  bossMobId: string,
  difficulty: DungeonDifficulty,
): void {
  const held = meta.bossKills ?? EMPTY_BOSS_KILLS;
  const key = bossKillKey(bossMobId, difficulty);
  const next = Math.min(BOSS_KILL_COUNT_CAP, (Object.hasOwn(held, key) ? held[key] : 0) + 1);
  meta.bossKills = Object.freeze({ ...held, [key]: next });
}

/**
 * Credit one boss death to everyone who took part (see the header). The death
 * hub calls it for every death with the claim the dying mob belongs to (null
 * outside an instance) and the death-time participation snapshot.
 */
export function recordBossKillTally(
  ctx: SimContext,
  boss: Entity,
  recipients: readonly PlayerMeta[],
  inst: InstanceSlot | null,
): void {
  if (!inst || inst.partyKey === null) return;
  const encounter = completedBossEncounter(ctx, inst, boss.templateId);
  if (!encounter) return;
  // A grown-back last head pays no kill credit of its own (Entity.regrown), so
  // it arrives with no recipients; the claim's roster is then the credit list.
  // Any other death with nobody to credit stays uncredited.
  if (recipients.length === 0 && !(encounter.bodyIds.length > 1 && boss.regrown === true)) return;
  const credited = new Map<number, PlayerMeta>();
  for (const meta of recipients) credited.set(meta.entityId, meta);
  for (const meta of instanceLockoutMetas(ctx, inst)) {
    if (inst.enteredBy.has(meta.entityId)) credited.set(meta.entityId, meta);
  }
  for (const meta of credited.values()) {
    if (meta.leaving) continue;
    addBossKill(meta, encounter.mobId, inst.difficulty);
  }
}

/**
 * A saved or mirrored tally, sanitized: string keys of the tally's own shape,
 * whole counts from 1 to the cap (a zero or a broken count drops), at most
 * BOSS_KILL_KEY_CAP keys in sorted order, frozen. Tolerates any untrusted JSON
 * (absent, null, an array, a non-object): an old save with no field loads as
 * no kills. A key for a boss this build does not know is kept, so content
 * that leaves and returns never loses a character's record.
 */
export function sanitizeBossKills(raw: unknown): BossKillTally {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_BOSS_KILLS;
  const source = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  let kept = 0;
  for (const key of Object.keys(source).sort()) {
    if (kept >= BOSS_KILL_KEY_CAP) break;
    const count = source[key];
    if (!KEY_RE.test(key) || typeof count !== 'number' || !Number.isFinite(count)) continue;
    const whole = Math.min(BOSS_KILL_COUNT_CAP, Math.floor(count));
    if (whole < 1) continue;
    out[key] = whole;
    kept++;
  }
  return kept === 0 ? EMPTY_BOSS_KILLS : Object.freeze(out);
}

/** The tally as the character save writes it: absent while empty, so a
 *  character that never felled a boss saves byte-equal to before. */
export function savedBossKills(meta: BossKillTallyState): { bossKills?: Record<string, number> } {
  const tally = meta.bossKills;
  if (!tally || Object.keys(tally).length === 0) return {};
  const out: Record<string, number> = {};
  for (const key of Object.keys(tally).sort()) out[key] = tally[key];
  return { bossKills: out };
}

/** Do two tallies hold the same counts? */
export function sameBossKills(a: BossKillTally, b: BossKillTally): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key) || a[key] !== b[key]) return false;
  }
  return true;
}
