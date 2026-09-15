// @vitest-environment happy-dom
//
// The NPC role line on the overhead nameplate: an NPC's plate borrows the
// player `<Guild>` line to say what the NPC DOES (src/sim/npc_role.ts via
// src/render/npc_role_label.ts). Pinned here:
//  - a vendor NPC draws its functional role in the catalog's tag wrapper;
//  - an NPC with no functional role draws its authored flavor title instead;
//  - the line is prebuilt in resolveContent (guild + guildLabel together, the
//    guildLabel cadence rule), at guild tier 0 (never a guild colour tier);
//  - a friendly quest MOB (not an npc) draws no role line;
//  - every non-Latin locale the M16 rule names resolves a localized label.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NameplateCanvasState } from '../src/render/nameplate_canvas';
import type { NameplatePlan } from '../src/render/nameplate_view';
import type { Entity } from '../src/sim/types';

interface ContentResolver {
  world: { markerFor: () => null; questsDone: Set<string>; craftingIdentity: null };
  resolveContent(
    state: NameplateCanvasState,
    entity: Entity,
    player: Entity,
    plan: NameplatePlan,
    showOwnNameplate: boolean,
    showDevBadges: boolean,
  ): void;
}

const NON_LATIN = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const;

function entity(over: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'npc',
    name: 'Smith Haldren',
    templateId: 'smith_haldren',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 10,
    hp: 100,
    maxHp: 100,
    dead: false,
    lootable: false,
    hostile: false,
    ownerId: null,
    guild: '',
    pledgeGuild: '',
    guildTier: 0,
    auras: [],
    questIds: [],
    targetId: null,
    aggroTargetId: null,
    comboPoints: 0,
    comboTargetId: null,
    castingAbility: null,
    castTotal: 0,
    castRemaining: 0,
    channeling: false,
    ...over,
  } as unknown as Entity;
}

async function harness(lang = 'en') {
  window.history.replaceState({}, '', `/?lang=${lang}`);
  vi.resetModules();
  const [{ NameplatePainter }, canvas, i18n] = await Promise.all([
    import('../src/render/nameplate_painter'),
    import('../src/render/nameplate_canvas'),
    import('../src/ui/i18n'),
  ]);
  const painter = Object.create(NameplatePainter.prototype) as ContentResolver;
  painter.world = { markerFor: () => null, questsDone: new Set(), craftingIdentity: null };
  const me = entity({ id: 1, kind: 'player', templateId: 'warrior', name: 'Me' });
  const state = canvas.createNameplateCanvasState();
  const plan: NameplatePlan = {
    hidden: false,
    anchorYOffset: 0,
    urgent: true,
    hasOverheadEmote: false,
    threat: false,
    comboPips: 0,
  };
  const resolve = (e: Entity) => {
    painter.resolveContent(state, e, me, plan, false, false);
    return state;
  };
  return { resolve, i18n };
}

afterEach(() => {
  vi.resetModules();
});

describe('nameplate NPC role line', () => {
  it('draws a vendor NPC functional role in the tag wrapper at guild tier 0', async () => {
    const { resolve } = await harness();
    const state = resolve(entity({ id: 2 }));
    expect(state.name).toBe('Smith Haldren');
    expect(state.guild).toBe('Arms Dealer');
    expect(state.guildLabel).toBe('<Arms Dealer>');
    expect(state.guildTier).toBe(0);
  });

  it('service NPCs read as their service', async () => {
    const { resolve } = await harness();
    expect(resolve(entity({ id: 3, templateId: 'bursar_wick' })).guildLabel).toBe('<Banker>');
    expect(resolve(entity({ id: 4, templateId: 'the_merchant' })).guildLabel).toBe('<Auctioneer>');
    expect(resolve(entity({ id: 5, templateId: 'warmarshal_draven_kole' })).guildLabel).toBe(
      '<PvP Vendor>',
    );
    expect(resolve(entity({ id: 6, templateId: 'forgemistress_darva' })).guildLabel).toBe(
      '<Blacksmithing Trainer>',
    );
  });

  it('falls back to the authored flavor title when there is no functional role', async () => {
    const { resolve } = await harness();
    const state = resolve(entity({ id: 7, templateId: 'loremaster_caddis' }));
    expect(state.guild).toBe('Loremaster');
    expect(state.guildLabel).toBe('<Loremaster>');
  });

  it('a friendly quest mob (not an npc) and an unknown template draw no role line', async () => {
    const { resolve } = await harness();
    const mob = resolve(
      entity({ id: 8, kind: 'mob', templateId: 'boar', questIds: ['q_any'], hostile: false }),
    );
    expect(mob.guild).toBe('');
    expect(mob.guildLabel).toBe('');
    const unknown = resolve(entity({ id: 9, templateId: 'no_such_npc' }));
    expect(unknown.guild).toBe('');
    expect(unknown.guildLabel).toBe('');
  });

  it('re-resolving the same state for a non-role entity clears the line', async () => {
    const { resolve } = await harness();
    expect(resolve(entity({ id: 11 })).guildLabel).toBe('<Arms Dealer>');
    // Same NameplateCanvasState, now an unguilded player: the reset at the top
    // of resolveContent must not leave the NPC tag behind.
    const state = resolve(entity({ id: 12, kind: 'player', templateId: 'warrior', name: 'Bo' }));
    expect(state.guild).toBe('');
    expect(state.guildLabel).toBe('');
  });

  it('resolves a localized role in every non-Latin locale (M16)', async () => {
    for (const lang of NON_LATIN) {
      const { resolve, i18n } = await harness(lang);
      await i18n.ensureLocaleLoaded(lang);
      i18n.setLanguage(lang);
      const state = resolve(entity({ id: 10, templateId: 'bursar_wick' }));
      expect(state.guild, `${lang} still English`).not.toBe('Banker');
      expect(state.guild, `${lang} resolved nothing`).not.toBe('');
      expect(state.guildLabel).toContain(state.guild);
    }
  });
});
