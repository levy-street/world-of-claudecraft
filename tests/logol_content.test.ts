import { describe, expect, it } from 'vitest';
import {
  LOGOL_FLAGSHIP_WARE_ID,
  LOGOL_HARBINGER_NPC_ID,
  LOGOL_NPC_ID,
  LOGOL_ROTATION_SIZE,
  LOGOL_SIGN_QUEST_ID,
  LOGOL_UNLOCK_QUEST_ID,
  LOGOL_WARES,
  logolOfferedWares,
  logolShopUnlocked,
  logolWare,
} from '../src/sim/content/logol';
import { NPCS, QUESTS } from '../src/sim/data';

describe('logol content', () => {
  it('registers both NPCs as dynamic (spawned only by the gated Logol system)', () => {
    // Both are dynamic: true so the Sim ctor never surface-places them, keeping a
    // feature-off world byte-identical (the parity gate proves it). The gated
    // logol_roam system spawns the Harbinger persistently and Logol on a clock.
    expect(NPCS[LOGOL_NPC_ID]).toBeDefined();
    expect(NPCS[LOGOL_NPC_ID].dynamic).toBe(true);
    expect(NPCS[LOGOL_HARBINGER_NPC_ID]).toBeDefined();
    expect(NPCS[LOGOL_HARBINGER_NPC_ID].dynamic).toBe(true);
    // The Harbinger gives the chain; Logol carries the final quest id so his
    // gossip dialog offers the "speak with him" discussion entry that credits
    // the interact objective (he is neither its giver nor its turn-in).
    expect(NPCS[LOGOL_HARBINGER_NPC_ID].questIds).toContain(LOGOL_UNLOCK_QUEST_ID);
    expect(NPCS[LOGOL_NPC_ID].questIds).toEqual([LOGOL_UNLOCK_QUEST_ID]);
    expect(QUESTS[LOGOL_UNLOCK_QUEST_ID].giverNpcId).toBe(LOGOL_HARBINGER_NPC_ID);
    expect(QUESTS[LOGOL_UNLOCK_QUEST_ID].objectives[0].targetNpcId).toBe(LOGOL_NPC_ID);
  });

  it('chains the unlock quests via requiresQuest', () => {
    expect(QUESTS[LOGOL_SIGN_QUEST_ID].requiresQuest).toBeDefined();
    expect(QUESTS[LOGOL_UNLOCK_QUEST_ID].requiresQuest).toBe(LOGOL_SIGN_QUEST_ID);
  });

  it('gates the shop only on the final quest', () => {
    expect(logolShopUnlocked([])).toBe(false);
    expect(logolShopUnlocked([LOGOL_SIGN_QUEST_ID])).toBe(false);
    expect(logolShopUnlocked([LOGOL_UNLOCK_QUEST_ID])).toBe(true);
    expect(logolShopUnlocked(['q_other', LOGOL_UNLOCK_QUEST_ID])).toBe(true);
  });

  it('ships only cosmetic-only ware kinds, with unique ids', () => {
    const ids = LOGOL_WARES.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Cosmetic-only invariant: this draft ships title/flair (no render dep); the
    // power-adjacent-sounding transmog/mount kinds carry NO entries yet.
    for (const w of LOGOL_WARES) {
      expect(w.kind === 'title' || w.kind === 'flair').toBe(true);
      expect(w.priceWoc).toBeGreaterThan(0);
    }
    expect(LOGOL_WARES.some((w) => w.kind === 'transmog' || w.kind === 'mount')).toBe(false);
  });

  it('resolves a ware by id and rejects unknowns', () => {
    expect(logolWare(LOGOL_WARES[0].id)).toEqual(LOGOL_WARES[0]);
    expect(logolWare('not_a_ware')).toBeUndefined();
  });

  it('prices sit in the thousands, with exactly one flagship in the hundreds of thousands', () => {
    const flagship = LOGOL_WARES.filter((w) => w.priceWoc >= 100_000);
    expect(flagship).toHaveLength(1);
    expect(flagship[0].id).toBe(LOGOL_FLAGSHIP_WARE_ID);
    expect(flagship[0].rarity).toBe('legendary');
    for (const w of LOGOL_WARES) {
      if (w.id === LOGOL_FLAGSHIP_WARE_ID) continue;
      expect(w.priceWoc).toBeGreaterThanOrEqual(1000);
      expect(w.priceWoc).toBeLessThan(100_000);
    }
  });
});

describe('logol weekly rotation', () => {
  it('always offers the flagship plus LOGOL_ROTATION_SIZE rotating wares', () => {
    for (const week of [0, 1, 2, 7, 53, 1000]) {
      const offered = logolOfferedWares(week);
      expect(offered).toHaveLength(1 + LOGOL_ROTATION_SIZE);
      expect(offered[0].id).toBe(LOGOL_FLAGSHIP_WARE_ID);
      // No duplicates within a week's stock.
      expect(new Set(offered.map((w) => w.id)).size).toBe(offered.length);
    }
  });

  it('rotates the stock week over week and is deterministic per week', () => {
    const w0 = logolOfferedWares(0).map((w) => w.id);
    const w1 = logolOfferedWares(1).map((w) => w.id);
    expect(w1).not.toEqual(w0);
    expect(logolOfferedWares(0).map((w) => w.id)).toEqual(w0);
    // The rotation cycles: with a pool of N non-flagship wares, week k and week
    // k+N offer the same stock.
    const pool = LOGOL_WARES.length - 1;
    expect(logolOfferedWares(3 + pool).map((w) => w.id)).toEqual(
      logolOfferedWares(3).map((w) => w.id),
    );
  });

  it('every non-flagship ware appears in some week (nothing is unreachable)', () => {
    const pool = LOGOL_WARES.length - 1;
    const seen = new Set<string>();
    for (let week = 0; week < pool; week++) {
      for (const w of logolOfferedWares(week)) seen.add(w.id);
    }
    expect(seen.size).toBe(LOGOL_WARES.length);
  });

  it('handles negative week indices without crashing (pre-epoch clocks in tests)', () => {
    const offered = logolOfferedWares(-3);
    expect(offered).toHaveLength(1 + LOGOL_ROTATION_SIZE);
    expect(offered[0].id).toBe(LOGOL_FLAGSHIP_WARE_ID);
  });
});
