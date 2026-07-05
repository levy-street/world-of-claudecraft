import { describe, expect, it } from 'vitest';
import {
  LOGOL_HARBINGER_NPC_ID,
  LOGOL_NPC_ID,
  LOGOL_SIGN_QUEST_ID,
  LOGOL_UNLOCK_QUEST_ID,
  LOGOL_WARES,
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
    // The Harbinger gives the chain; Logol carries no quests (he only trades).
    expect(NPCS[LOGOL_HARBINGER_NPC_ID].questIds).toContain(LOGOL_UNLOCK_QUEST_ID);
    expect(NPCS[LOGOL_NPC_ID].questIds).toHaveLength(0);
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
});
