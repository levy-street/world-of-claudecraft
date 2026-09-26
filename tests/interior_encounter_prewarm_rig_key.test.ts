// The Varkhul rig twin is built from Renderer.prewarmEntity, which spreads the
// LOCAL PLAYER into the entity it returns. The twin only warms the live boss's
// programs while that entity resolves the boss's own visual key, so this pins
// the key through the real method, with a player wearing every cosmetic that
// could divert a body: the Combat Mech, a weapon skin, held items.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { npcLookFor } from '../src/render/characters';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { Renderer } from '../src/render/renderer';
import { MOBS } from '../src/sim/data';
import { VARKHUL_BOSS_ID } from '../src/sim/ignivar_raid_ids';
import { Sim } from '../src/sim/sim';
import { type Entity, isMechWearer } from '../src/sim/types';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

type PrewarmEntityHost = {
  sim: { player: Entity };
  prewarmEntity(
    kind: 'player' | 'mob' | 'npc',
    templateId: string,
    color: number,
    scale: number,
  ): Entity;
};

function varkhulTwinEntity(player: Entity): Entity {
  const host = Object.create(Renderer.prototype) as PrewarmEntityHost;
  host.sim = { player };
  const template = MOBS[VARKHUL_BOSS_ID];
  return host.prewarmEntity('mob', template.id, template.color, template.scale);
}

function cosmeticPlayer(): Entity {
  const player = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }).player;
  player.skinCatalog = 'mech';
  player.weaponSkinId = 'ice_fang_sword';
  player.mainhandItemId ??= 'rusty_sword';
  return player;
}

describe("Varkhul's rig twin entity", () => {
  it("resolves the boss's own visual key whatever the local player wears", () => {
    const player = cosmeticPlayer();
    expect(isMechWearer(player)).toBe(true);
    expect(visualKeyFor(player)).toBe('player_mech');

    const entity = varkhulTwinEntity(player);
    expect(entity).toMatchObject({ kind: 'mob', templateId: VARKHUL_BOSS_ID });
    // The spread carries the player's cosmetics through...
    expect(entity.skinCatalog).toBe('mech');
    expect(entity.weaponSkinId).toBe('ice_fang_sword');
    // ...and none of them reaches a mob's key.
    expect(isMechWearer(entity)).toBe(false);
    expect(visualKeyFor(entity)).toBe('mob_varkhul_forgefather');
  });

  it('has no swap slot under that key, so the held items it carries change nothing', () => {
    const def = VISUALS[visualKeyFor(varkhulTwinEntity(cosmeticPlayer()))];
    expect(def).toBeDefined();
    expect(def.weaponSlots ?? []).toEqual([]);
    expect(def.offhandSlot).toBeUndefined();
  });

  it('is never claimed by the modular look provider, which composes no mob', () => {
    expect(npcLookFor(VARKHUL_BOSS_ID, 'mob')).toBeNull();
    // The provider main.ts installs routes every non-player through npcLookFor
    // with the entity's own kind, the arm above.
    const main = codeWithoutLineComments(
      readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
    );
    const at = main.indexOf('setModularLookProvider((e) =>');
    expect(at).toBeGreaterThan(-1);
    const provider = main.slice(at, main.indexOf(');', at));
    expect(provider).toContain("e.kind === 'player'");
    expect(provider).toContain(': npcLookFor(e.templateId, e.kind)');
  });
});
