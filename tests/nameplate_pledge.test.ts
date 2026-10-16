// @vitest-environment happy-dom
//
// The guild pledge board's nameplate half (docs/prd/guild-pledge-board.md):
//  - a player who PLEDGED to a guild without being a member shows the localized
//    pledge wording on the guild line, never the `<Guild>` member wrapper, so
//    an aspirant can never read as a member;
//  - a real membership always wins the line over any stale pledge field;
//  - the guild line's fill tiers by the guild's collective lifetime XP
//    (entity.guildTier -> GUILD_TIER_FILLS), one entry per guild_tier.ts
//    threshold, with tier 0 keeping the classic fill;
//  - the stylesheet's .guild-tier-N classes (the guild board + social window)
//    carry the SAME palette, so the HUD and the canvas can never disagree.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NameplateCanvasState } from '../src/render/nameplate_canvas';
import type { NameplatePlan } from '../src/render/nameplate_view';
import { GUILD_TIER_THRESHOLDS } from '../src/sim/guild_tier';
import type { Entity } from '../src/sim/types';

interface ContentResolver {
  world: { markerFor: () => null };
  resolveContent(
    state: NameplateCanvasState,
    entity: Entity,
    player: Entity,
    plan: NameplatePlan,
    showOwnNameplate: boolean,
    showDevBadges: boolean,
  ): void;
}

function player(over: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'player',
    name: 'Aspirant',
    templateId: 'warrior',
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

async function harness() {
  window.history.replaceState({}, '', '/?lang=en');
  vi.resetModules();
  const [{ NameplatePainter }, canvas] = await Promise.all([
    import('../src/render/nameplate_painter'),
    import('../src/render/nameplate_canvas'),
  ]);
  const painter = Object.create(NameplatePainter.prototype) as ContentResolver;
  painter.world = { markerFor: () => null };
  const me = player({ id: 1 });
  const state = canvas.createNameplateCanvasState();
  const plan = {
    hidden: false,
    anchorYOffset: 0,
    urgent: true,
    hasOverheadEmote: false,
    threat: false,
    comboPips: 0,
    noHealthBar: false,
  } satisfies NameplatePlan;
  const resolve = (entity: Entity) => painter.resolveContent(state, entity, me, plan, false, true);
  return { state, resolve, GUILD_TIER_FILLS: canvas.GUILD_TIER_FILLS };
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.resetModules();
});

describe('the nameplate pledge line', () => {
  it('renders the localized pledge wording, never the member wrapper', async () => {
    const { state, resolve } = await harness();
    resolve(
      player({ id: 2, pledgeGuild: 'Iron Vanguard', guildTier: 3 } as Partial<Entity> & {
        id: number;
      }),
    );
    expect(state.guild).toBe('Iron Vanguard');
    expect(state.guildLabel).toBe('Pledge of Iron Vanguard');
    expect(state.guildLabel).not.toContain('<');
    expect(state.guildTier).toBe(3);
  });

  it('a real membership wins the line over any stale pledge field', async () => {
    const { state, resolve } = await harness();
    resolve(
      player({
        id: 3,
        guild: 'Wolves',
        pledgeGuild: 'Iron Vanguard',
        guildTier: 1,
      } as Partial<Entity> & {
        id: number;
      }),
    );
    expect(state.guild).toBe('Wolves');
    expect(state.guildLabel).toBe('<Wolves>');
  });

  it('an unguilded, unpledged player keeps an empty guild line, and a recycled plate resets its tier', async () => {
    const { state, resolve } = await harness();
    resolve(player({ id: 4, guildTier: 4 } as Partial<Entity> & { id: number }));
    expect(state.guild).toBe('');
    expect(state.guildLabel).toBe('');
    // The reset block zeroes guildTier before the per-kind branches, so a
    // plate recycled off a tiered member never inherits a stale fill.
    resolve({ ...player({ id: 5 }), kind: 'npc' } as unknown as Entity);
    expect(state.guildTier).toBe(0);
  });
});

describe('the guild colour tier palette', () => {
  it('has one canvas fill per guild_tier.ts threshold, tier 0 the classic blue', async () => {
    const { GUILD_TIER_FILLS } = await harness();
    expect(GUILD_TIER_FILLS.length).toBe(GUILD_TIER_THRESHOLDS.length);
    expect(GUILD_TIER_FILLS[0]).toBe('#c9dcfb');
  });

  it('the stylesheet .guild-tier-N classes carry the same palette as the canvas', async () => {
    const { GUILD_TIER_FILLS } = await harness();
    const css = readFileSync('src/styles/components.css', 'utf8');
    GUILD_TIER_FILLS.forEach((fill, tier) => {
      const start = css.indexOf(`.guild-tier-${tier} {`);
      expect(start, `.guild-tier-${tier} rule missing`).toBeGreaterThan(-1);
      const rule = css.slice(start, css.indexOf('}', start));
      expect(rule).toContain(`color: ${fill}`);
    });
  });
});
