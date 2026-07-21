import { describe, expect, it } from 'vitest';
import {
  type MobTooltipI18n,
  type MobTooltipModel,
  mobTooltipHtml,
} from '../src/ui/mob_tooltip_view';

// Fake i18n: echo the key plus its params so assertions can see exactly which
// catalog key and which formatted values the view chose, without binding the
// runtime i18n table (mirrors tests/stat_tooltip_view.test.ts).
const fakeT = (key: string, params?: Record<string, string>): string =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;
const fakeFmt = (v: number): string => String(v);
const deps: MobTooltipI18n = { t: fakeT, fmt: fakeFmt };

const model = (over: Partial<MobTooltipModel> = {}): MobTooltipModel => ({
  name: 'Forest Wolf',
  level: 5,
  familyLabel: 'Beasts',
  color: '#ffe97a',
  hostile: true,
  quests: [],
  ...over,
});

describe('mobTooltipHtml', () => {
  it('renders the localized name AND the level/family line colored by the con-color', () => {
    const html = mobTooltipHtml(model(), deps);
    expect(html).toContain('<div class="tt-title" style="color:#ffe97a">Forest Wolf</div>');
    expect(html).toContain(
      '<div class="tt-sub" style="color:#ffe97a">hudChrome.mobTooltip.levelFamily(level=5,family=Beasts)</div>',
    );
  });

  it('formats the level through the injected fmt, not a raw string', () => {
    const html = mobTooltipHtml(model({ level: 12 }), deps);
    expect(html).toContain('level=12');
  });

  it('shows a red Hostile line for a hostile mob', () => {
    const html = mobTooltipHtml(model({ hostile: true }), deps);
    expect(html).toContain('<div class="tt-red">hudChrome.mobTooltip.hostile</div>');
    expect(html).not.toContain('hudChrome.mobTooltip.friendly');
  });

  it('shows a green Friendly line for a non-hostile mob', () => {
    const html = mobTooltipHtml(model({ hostile: false }), deps);
    expect(html).toContain('<div class="tt-green">hudChrome.mobTooltip.friendly</div>');
    expect(html).not.toContain('hudChrome.mobTooltip.hostile');
  });

  it('escapes HTML in the name and family label', () => {
    const html = mobTooltipHtml(model({ name: '<script>alert(1)</script>' }), deps);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders Questie-style quest lines between the family line and the reaction', () => {
    const html = mobTooltipHtml(
      model({
        quests: [
          { title: 'Wolves at the Door', progress: 'Forest Wolf slain: 3/8' },
          { title: 'Another Errand', progress: 'Wolf Pelt: 1/4' },
        ],
      }),
      deps,
    );
    expect(html).toContain('<div class="tt-quest-name">Wolves at the Door</div>');
    expect(html).toContain('<div class="tt-quest-obj">Forest Wolf slain: 3/8</div>');
    expect(html).toContain('<div class="tt-quest-name">Another Errand</div>');
    // order: family line, then the quest lines, then the reaction line
    const familyAt = html.indexOf('levelFamily');
    const questAt = html.indexOf('tt-quest-name');
    const reactionAt = html.indexOf('tt-red');
    expect(familyAt).toBeGreaterThanOrEqual(0);
    expect(questAt).toBeGreaterThan(familyAt);
    expect(reactionAt).toBeGreaterThan(questAt);
  });

  it('escapes HTML inside quest lines and renders none when the list is empty', () => {
    const evil = mobTooltipHtml(
      model({ quests: [{ title: '<b>x</b>', progress: '<i>y</i>' }] }),
      deps,
    );
    expect(evil).not.toContain('<b>');
    expect(evil).toContain('&lt;b&gt;');
    expect(mobTooltipHtml(model(), deps)).not.toContain('tt-quest-name');
  });

  it('same input produces the same output (deterministic, no DOM)', () => {
    const m = model();
    expect(mobTooltipHtml(m, deps)).toEqual(mobTooltipHtml(m, deps));
  });
});
