// Gather-node tooltip copy surface + the hud gatherDenied binding (Professions
// 2.0). The pure MODEL is covered in tests/gathering_view.test.ts;
// this file drives the i18n-composing half (gatherNodeTooltipHtml,
// gatherNodeToolGateFor) directly, plus the hud.ts source pins in the
// tests/gather_event_i18n.test.ts idiom (the event switch case must stay an
// error toast only: no log line, no cue, the grant-hub double-log trap).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  gatherNodeToolGateFor,
  gatherNodeTooltipHtml,
} from '../src/ui/gather_node_tooltip_controller';
import type { GatherNodeTooltipModel } from '../src/ui/gathering_view';
import { hasTranslation } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

function model(over: Partial<GatherNodeTooltipModel> = {}): GatherNodeTooltipModel {
  return {
    type: 'ore',
    professionId: 'mining',
    tier: 2,
    locked: true,
    state: 'ready',
    ...over,
  };
}

describe('gatherNodeTooltipHtml', () => {
  it('renders title, requirement, and state lines for a locked tier-2 vein', () => {
    const html = gatherNodeTooltipHtml(model());
    expect(html).toContain('<div class="tt-title">Ore Vein</div>');
    // Locked: the requirement line renders red (the unmet-requirement idiom).
    expect(html).toContain('<div class="tt-red">Requires a tier 2 mining pick</div>');
    expect(html).toContain('<div class="tt-green">Ready</div>');
  });

  it('an owned sufficient tool turns the requirement line neutral, not red', () => {
    const html = gatherNodeTooltipHtml(model({ locked: false }));
    expect(html).toContain('<div class="tt-sub">Requires a tier 2 mining pick</div>');
    expect(html).not.toContain('tt-red');
  });

  it('a wield shortfall outranks the tier line: the hover names the counter (R22)', () => {
    // The player carries a covering pick and only Mining is short: the tier
    // sentence would name a requirement they meet, so the wield line renders
    // instead, red, with the smallest counter that unlocks something owned.
    const html = gatherNodeTooltipHtml(model({ wieldSkill: 40 }));
    expect(html).toContain(
      '<div class="tt-red">You need Mining 40 to swing the pick already in your bags.</div>',
    );
    expect(html).not.toContain('Requires a tier 2 mining pick');
    // The shortfall only speaks while the node is actually locked.
    const unlocked = gatherNodeTooltipHtml(model({ locked: false, wieldSkill: 40 }));
    expect(unlocked).toContain('<div class="tt-sub">Requires a tier 2 mining pick</div>');
  });

  it('a tier-1 node renders the tierless base-tool requirement line (#2343: bare hands never gather)', () => {
    // Locked (no pick owned): the tierless line renders red.
    const locked = gatherNodeTooltipHtml(model({ tier: 1, locked: true }));
    expect(locked).toContain('<div class="tt-red">Requires a mining pick</div>');
    expect(locked).toContain('<div class="tt-title">Ore Vein</div>');
    // Owning the pick turns the same line neutral, never drops it.
    const tooled = gatherNodeTooltipHtml(model({ tier: 1, locked: false }));
    expect(tooled).toContain('<div class="tt-sub">Requires a mining pick</div>');
    expect(tooled).not.toContain('tt-red');
  });

  it('the cooldown state renders the respawning line without the ready green', () => {
    const html = gatherNodeTooltipHtml(model({ state: 'cooldown' }));
    expect(html).toContain('Respawning');
    expect(html).not.toContain('tt-green');
  });

  it('a cooldown with respawnSeconds renders the live countdown, m:ss, ceiled', () => {
    const html = gatherNodeTooltipHtml(model({ state: 'cooldown', respawnSeconds: 226.4 }));
    // 226.4 ceils to 227 = 3:47; the untimed word must NOT also render.
    expect(html).toContain('Respawns in 3:47');
    expect(html).not.toContain('>Respawning<');
    // Sub-minute remainders keep the two-digit seconds token.
    expect(gatherNodeTooltipHtml(model({ state: 'cooldown', respawnSeconds: 8 }))).toContain(
      'Respawns in 0:08',
    );
    // A live timer never reads 0:00 while the node still refuses.
    expect(gatherNodeTooltipHtml(model({ state: 'cooldown', respawnSeconds: 0.2 }))).toContain(
      'Respawns in 0:01',
    );
  });

  it('the fine-grade preview line renders green exactly when the model carries it true', () => {
    const on = gatherNodeTooltipHtml(model({ locked: false, fineUpgrade: true }));
    expect(on).toContain('<div class="tt-green">Your tool refines this yield to fine grade.</div>');
    const off = gatherNodeTooltipHtml(model({ locked: false, fineUpgrade: false }));
    expect(off).not.toContain('fine grade');
    const absent = gatherNodeTooltipHtml(model({ locked: false }));
    expect(absent).not.toContain('fine grade');
  });

  it('each node family resolves its own name key', () => {
    expect(gatherNodeTooltipHtml(model({ type: 'wood', professionId: 'logging' }))).toContain(
      'Timber Stand',
    );
    expect(gatherNodeTooltipHtml(model({ type: 'herb', professionId: 'herbalism' }))).toContain(
      'Herb Patch',
    );
    // The keys exist in the catalog (the hasTranslation floor).
    for (const key of [
      'hudChrome.gathering.nodeName.ore',
      'hudChrome.gathering.nodeName.wood',
      'hudChrome.gathering.nodeName.herb',
      'hudChrome.gathering.tierRequired.mining',
      'hudChrome.gathering.requiresTool.mining',
      'hudChrome.gathering.requiresTool.logging',
      'hudChrome.gathering.requiresTool.herbalism',
      'hudChrome.gathering.stateReady',
      'hudChrome.gathering.stateCooldown',
    ] as const) {
      expect(hasTranslation(key), key).toBe(true);
    }
  });
});

describe('gatherNodeToolGateFor', () => {
  function worldWith(
    inventory: { itemId: string; count: number }[],
    proficiency: Record<string, number> = {},
  ): IWorld {
    // The plain counter map the wield-filtered scan reads (R22).
    return { inventory, gatheringProficiency: proficiency } as unknown as IWorld;
  }

  it('resolves the viewer tier from bags and bakes the localized denial line per family', () => {
    // The pick is WIELDED here (mining 40, R22), so the shortfall is purely
    // the tier: the tiered line renders. The wield shortfall has its own arm
    // below.
    const gate = gatherNodeToolGateFor(
      worldWith([{ itemId: 'iron_mining_pick', count: 1 }], { mining: 40 }),
      {
        type: 'ore',
        tier: 3,
      },
    );
    expect(gate).toEqual({
      nodeTier: 3,
      viewerToolTier: 2,
      unmetText: 'You need a tier 3 mining pick to harvest this vein.',
    });
    // The R22 wield arm: the same pick with the counter short composes the
    // wield line naming the smallest requirement that unlocks something
    // already carried, exactly the line the sim's own denial would render.
    expect(
      gatherNodeToolGateFor(worldWith([{ itemId: 'iron_mining_pick', count: 1 }]), {
        type: 'ore',
        tier: 2,
      }),
    ).toEqual({
      nodeTier: 2,
      viewerToolTier: 0,
      unmetText: 'You need Mining 40 to swing the pick already in your bags.',
    });
    // Empty bags read as no tool owned (0, #2343: no bare-hands floor), and
    // the wood/herb families word their own tiered lines.
    expect(gatherNodeToolGateFor(worldWith([]), { type: 'wood', tier: 2 })).toEqual({
      nodeTier: 2,
      viewerToolTier: 0,
      unmetText: 'You need a tier 2 logging axe to fell this stand.',
    });
    expect(gatherNodeToolGateFor(worldWith([]), { type: 'herb', tier: 2 })).toEqual({
      nodeTier: 2,
      viewerToolTier: 0,
      unmetText: 'You need a tier 2 herbalism sickle to gather this patch.',
    });
  });

  it('a tier-1 node with empty bags gates on the tierless base-tool line (#2343)', () => {
    expect(gatherNodeToolGateFor(worldWith([]), { type: 'ore', tier: 1 })).toEqual({
      nodeTier: 1,
      viewerToolTier: 0,
      unmetText: 'You need a mining pick to harvest this vein.',
    });
  });
});

describe('hud gatherDenied case stays an error toast only (source pin)', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
  const caseStart = source.indexOf("case 'gatherDenied'");
  const block = source.slice(caseStart, source.indexOf('break;', caseStart));

  it('maps surface + professionId + requiredTier + wieldProficiency through the pure key mapper into showError', () => {
    expect(caseStart).toBeGreaterThan(-1);
    expect(block).toContain('this.showError(');
    // Comment-stripped THEN whitespace- and trailing-comma-normalized: the
    // case's own comment names all four fields, so an unstripped scrape
    // could be satisfied by prose with the argument removed; and the
    // four-argument call is long enough for the formatter to wrap
    // one-per-line with a dangling comma.
    const strippedBlock = block
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1')
      .replace(/\s+/g, '')
      .replace(/,\)/g, ')');
    expect(strippedBlock).toContain(
      'gatherDeniedLineKey(ev.surface,ev.professionId,ev.requiredTier,ev.wieldProficiency)',
    );
    expect(block).toContain('formatNumber(ev.requiredTier');
    expect(block).toContain('formatNumber(ev.wieldProficiency ?? 0');
  });

  it('adds no log line and no audio cue (toast only, the double-feedback trap)', () => {
    expect(block).not.toContain('this.log(');
    expect(block).not.toContain('audio.');
  });
});

describe('hud gatherToolNoNode case mirrors the gatherDenied toast-only pattern (source pin)', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
  const caseStart = source.indexOf("case 'gatherToolNoNode'");
  const block = source.slice(caseStart, source.indexOf('break;', caseStart));

  it('maps the professionId through the pure key mapper into showError', () => {
    expect(caseStart).toBeGreaterThan(-1);
    expect(block).toContain('this.showError(');
    expect(block).toContain('gatherToolNoNodeKey(ev.professionId)');
  });

  it('adds no log line and no audio cue (toast only, the double-feedback trap)', () => {
    expect(block).not.toContain('this.log(');
    expect(block).not.toContain('audio.');
  });
});

describe('hud gatherDowngrade case mirrors the gatherDenied toast-only pattern (source pin)', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
  const caseStart = source.indexOf("case 'gatherDowngrade'");
  const block = source.slice(caseStart, source.indexOf('break;', caseStart));

  it('maps the lost arm through the pure key mapper into showError', () => {
    expect(caseStart).toBeGreaterThan(-1);
    expect(block).toContain('this.showError(');
    expect(block).toContain('gatherDowngradeLineKey(ev.lost)');
  });

  it('adds no log line and no audio cue (toast only, the double-feedback trap)', () => {
    expect(block).not.toContain('this.log(');
    expect(block).not.toContain('audio.');
  });
});

describe('minimap painter locked tint (source pin)', () => {
  it('the locked tint replaces the state COLOR while both state arms keep their silhouette', () => {
    // Fairness-adjacent composition pin: the painter must pick the locked
    // color inside BOTH the ready and cooldown branches (silhouette kept),
    // never collapse the two states into one locked draw.
    const painter = readFileSync(path.resolve(process.cwd(), 'src/ui/minimap_painter.ts'), 'utf8');
    const readyArm = painter.indexOf('m.locked ? colors.gatherLocked : colors.gatherReady');
    const cooldownArm = painter.indexOf('m.locked ? colors.gatherLocked : colors.gatherCooldown');
    expect(readyArm).toBeGreaterThan(-1);
    expect(cooldownArm).toBeGreaterThan(readyArm);
  });
});
