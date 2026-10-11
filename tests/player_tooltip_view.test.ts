import { describe, expect, it } from 'vitest';
import {
  type PlayerTooltipI18n,
  type PlayerTooltipModel,
  type PlayerTooltipResolvers,
  type PlayerTooltipSource,
  playerTooltipHtml,
  playerTooltipKey,
  playerTooltipModel,
} from '../src/ui/player_tooltip_view';

const fakeT = (key: string, params?: Record<string, string>): string =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;
const fakeFmt = (v: number): string => String(v);
const deps: PlayerTooltipI18n = { t: fakeT, fmt: fakeFmt };

const model = (over: Partial<PlayerTooltipModel> = {}): PlayerTooltipModel => ({
  name: 'Aldwin',
  classLabel: 'Mage',
  classColor: '#33c1f1',
  level: 12,
  ...over,
});

const source = (over: Partial<PlayerTooltipSource> = {}): PlayerTooltipSource => ({
  id: 7,
  name: 'Aldwin',
  level: 12,
  templateId: 'priest',
  guild: '',
  pledgeGuild: '',
  title: null,
  specId: null,
  ...over,
});

// Resolvers that record what they were asked, so the model's lookups are
// visible: the spec lookup must be keyed by class AND spec id (spec ids
// collide across classes).
const resolvers: PlayerTooltipResolvers = {
  classLabel: (cls) => `class:${cls}`,
  classColor: (cls) => `color:${cls}`,
  titleText: (id) => (id === 'deed_known' ? 'the Unbroken' : ''),
  spec: (cls, specId) =>
    cls === 'priest' && specId === 'holy' ? { name: 'Holy', role: 'Healer' } : null,
};

describe('playerTooltipHtml', () => {
  it('renders a class-colored name and localized level/class line', () => {
    const html = playerTooltipHtml(model(), deps);

    expect(html).toContain('<div class="tt-title" style="color:#33c1f1">Aldwin</div>');
    expect(html).toContain(
      '<div class="tt-sub">itemUi.equipment.levelClass(level=12,className=Mage)</div>',
    );
  });

  it('renders the classic <Guild> line only when the guild is non-empty', () => {
    expect(playerTooltipHtml(model({ guild: 'The Azure Order' }), deps)).toContain(
      '<div class="tt-sub tt-player-guild">hudChrome.playerTooltip.guild(guild=The Azure Order)</div>',
    );
    expect(playerTooltipHtml(model({ guild: '' }), deps)).not.toContain('tt-player-guild');
    expect(playerTooltipHtml(model(), deps).match(/class="tt-sub/g)).toHaveLength(1);
  });

  it('borrows the guild line for a pledge, worded as a pledge, only while unguilded', () => {
    expect(playerTooltipHtml(model({ pledgeGuild: 'Dawnwardens' }), deps)).toContain(
      '<div class="tt-sub tt-player-guild">hudChrome.nameplate.pledgeTag(guild=Dawnwardens)</div>',
    );
    // A member never reads as pledged, even if a stale pledge is still set.
    const both = playerTooltipHtml(model({ guild: 'Order', pledgeGuild: 'Dawnwardens' }), deps);
    expect(both).toContain('hudChrome.playerTooltip.guild(guild=Order)');
    expect(both).not.toContain('pledgeTag');
  });

  it('renders the deed title under the name and the spec with its role under the level', () => {
    const html = playerTooltipHtml(
      model({ title: 'the Unbroken', guild: 'Order', spec: { name: 'Holy', role: 'Healer' } }),
      deps,
    );
    expect(html).toContain('<div class="tt-sub tt-player-title">the Unbroken</div>');
    expect(html).toContain(
      '<div class="tt-sub tt-player-spec">hudChrome.playerTooltip.specRole(spec=Holy,role=Healer)</div>',
    );
    // Classic line order: name, title, guild, level/class, spec.
    const order = [
      'tt-title',
      'tt-player-title',
      'tt-player-guild',
      'levelClass',
      'tt-player-spec',
    ];
    const at = order.map((needle) => html.indexOf(needle));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('omits the title and spec lines when there is nothing to show', () => {
    const html = playerTooltipHtml(model({ title: '' }), deps);
    expect(html).not.toContain('tt-player-title');
    expect(html).not.toContain('tt-player-spec');
  });

  it('escapes player-controlled name, title, guild and pledge text', () => {
    const html = playerTooltipHtml(
      model({ name: '<Aldwin>', guild: '<The Azure Order>', title: '<b>x</b>' }),
      deps,
    );
    expect(html).not.toContain('<Aldwin>');
    expect(html).not.toContain('<The Azure Order>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;Aldwin&gt;');
    expect(html).toContain('&lt;The Azure Order&gt;');
    const pledged = playerTooltipHtml(model({ pledgeGuild: '<img src=x>' }), deps);
    expect(pledged).not.toContain('<img');
  });

  it('is deterministic for the same model', () => {
    expect(playerTooltipHtml(model({ guild: 'The Azure Order' }), deps)).toBe(
      playerTooltipHtml(model({ guild: 'The Azure Order' }), deps),
    );
  });
});

describe('playerTooltipModel', () => {
  it('resolves the class, title and spec through the injected lookups', () => {
    expect(
      playerTooltipModel(
        source({ guild: 'Order', title: 'deed_known', specId: 'holy', level: 60 }),
        resolvers,
      ),
    ).toEqual({
      name: 'Aldwin',
      classLabel: 'class:priest',
      classColor: 'color:priest',
      level: 60,
      title: 'the Unbroken',
      guild: 'Order',
      pledgeGuild: '',
      spec: { name: 'Holy', role: 'Healer' },
    });
  });

  it('has no spec line for an unspecced player or a spec the class does not own', () => {
    expect(playerTooltipModel(source({ specId: null }), resolvers).spec).toBeUndefined();
    expect(playerTooltipModel(source({ specId: 'arms' }), resolvers).spec).toBeUndefined();
    // Keyed by class: a paladin's "holy" is not the priest spec the fake knows.
    expect(
      playerTooltipModel(source({ templateId: 'paladin', specId: 'holy' }), resolvers).spec,
    ).toBeUndefined();
  });

  it('reads an absent mirror (an older server) as no title, pledge or spec', () => {
    const bare: PlayerTooltipSource = {
      id: 1,
      name: 'A',
      level: 3,
      templateId: 'priest',
      guild: '',
    };
    const m = playerTooltipModel(bare, resolvers);
    expect(m.title).toBe('');
    expect(m.pledgeGuild).toBe('');
    expect(m.spec).toBeUndefined();
  });
});

describe('playerTooltipKey', () => {
  it('changes whenever a painted line would change, so a mid-hover change repaints', () => {
    const base = source({ guild: 'Order', title: 'deed_known', specId: 'holy' });
    const key = playerTooltipKey(base);
    expect(playerTooltipKey({ ...base })).toBe(key);
    for (const over of [
      { level: 13 },
      { name: 'Aldwine' },
      { guild: 'Other' },
      { pledgeGuild: 'Dawnwardens' },
      { title: 'deed_other' },
      { specId: 'shadow' },
      { specId: null },
      { templateId: 'mage' },
      { id: 8 },
    ] satisfies Partial<PlayerTooltipSource>[]) {
      expect(playerTooltipKey({ ...base, ...over }), JSON.stringify(over)).not.toBe(key);
    }
  });
});
