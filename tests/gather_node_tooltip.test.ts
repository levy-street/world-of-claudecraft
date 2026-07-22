// Gather-node tooltip copy surface + the hud gatherDenied binding (Professions
// 2.0 Phase 12). The pure MODEL is covered in tests/gathering_view.test.ts;
// this file drives the i18n-composing half (gatherNodeTooltipHtml,
// gatherNodeToolGateFor) directly, plus the hud.ts source pins in the
// tests/gather_event_i18n.test.ts idiom (the event switch case must stay an
// error toast only: no log line, no cue, the grant-hub double-log trap).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gatherNodeToolGateFor, gatherNodeTooltipHtml } from '../src/ui/gather_node_tooltip';
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

  it('a tier-1 node renders NO requirement line (the bare-hands floor makes it false)', () => {
    const html = gatherNodeTooltipHtml(model({ tier: 1, locked: false }));
    expect(html).not.toContain('Requires');
    expect(html).toContain('<div class="tt-title">Ore Vein</div>');
  });

  it('the cooldown state renders the respawning line without the ready green', () => {
    const html = gatherNodeTooltipHtml(model({ state: 'cooldown' }));
    expect(html).toContain('Respawning');
    expect(html).not.toContain('tt-green');
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
      'hudChrome.gathering.stateReady',
      'hudChrome.gathering.stateCooldown',
    ] as const) {
      expect(hasTranslation(key), key).toBe(true);
    }
  });
});

describe('gatherNodeToolGateFor', () => {
  function worldWith(inventory: { itemId: string; count: number }[]): IWorld {
    return { inventory } as unknown as IWorld;
  }

  it('resolves the viewer tier from bags and bakes the localized denial line per family', () => {
    const gate = gatherNodeToolGateFor(worldWith([{ itemId: 'iron_mining_pick', count: 1 }]), {
      type: 'ore',
      tier: 3,
    });
    expect(gate).toEqual({
      nodeTier: 3,
      viewerToolTier: 2,
      unmetText: 'You need a tier 3 mining pick to harvest this vein.',
    });
    // Bare hands floor to 1, and the wood/herb families word their own lines.
    expect(gatherNodeToolGateFor(worldWith([]), { type: 'wood', tier: 2 })).toEqual({
      nodeTier: 2,
      viewerToolTier: 1,
      unmetText: 'You need a tier 2 logging axe to fell this stand.',
    });
    expect(gatherNodeToolGateFor(worldWith([]), { type: 'herb', tier: 2 })).toEqual({
      nodeTier: 2,
      viewerToolTier: 1,
      unmetText: 'You need a tier 2 herbalism sickle to gather this patch.',
    });
  });
});

describe('hud gatherDenied case stays an error toast only (source pin)', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
  const caseStart = source.indexOf("case 'gatherDenied'");
  const block = source.slice(caseStart, source.indexOf('break;', caseStart));

  it('maps surface + professionId through the pure key mapper into showError', () => {
    expect(caseStart).toBeGreaterThan(-1);
    expect(block).toContain('this.showError(');
    expect(block).toContain('gatherDeniedLineKey(ev.surface, ev.professionId)');
    expect(block).toContain('formatNumber(ev.requiredTier');
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
