// The flee-eligibility predicate extracted from sim.ts (src/sim/mob/flee_rules.ts,
// the Market Sweep's monolith payment): pinned directly, as the extraction promised.
import { describe, expect, it } from 'vitest';
import { DELVE_COMPANIONS } from '../src/sim/content/delves';
import { MOBS } from '../src/sim/data';
import { isDelveCompanionMob } from '../src/sim/delves/companion';
import { canFlee, FLEEING_FAMILIES } from '../src/sim/mob/flee_rules';
import type { Entity } from '../src/sim/types';

const mob = (templateId: string, over: Partial<Entity> = {}): Entity =>
  ({ templateId, hasFled: false, enraged: false, ownerId: null, ...over }) as Entity;

const byFamily = (pick: (t: (typeof MOBS)[string]) => boolean) =>
  Object.entries(MOBS).find(([, t]) => pick(t))?.[0];

describe('canFlee', () => {
  it('admits a plain mob of a cowardly family, once, while not enraged', () => {
    const id = byFamily((t) => FLEEING_FAMILIES.has(t.family) && !t.boss && !t.elite && !t.rare);
    if (!id) throw new Error('no plain cowardly mob in the catalog');
    expect(canFlee(mob(id))).toBe(true);
    expect(canFlee(mob(id, { hasFled: true }))).toBe(false);
    expect(canFlee(mob(id, { enraged: true }))).toBe(false);
  });
  it('refuses fight-to-the-death families, elites, rares, bosses, and unknown templates', () => {
    const brave = byFamily((t) => !FLEEING_FAMILIES.has(t.family));
    const hard = byFamily((t) => FLEEING_FAMILIES.has(t.family) && !!(t.boss || t.elite || t.rare));
    if (!brave || !hard) throw new Error('catalog lacks a control mob');
    expect(canFlee(mob(brave))).toBe(false);
    expect(canFlee(mob(hard))).toBe(false);
    expect(canFlee(mob('no_such_template'))).toBe(false);
  });
});

describe('isDelveCompanionMob', () => {
  it('is an OWNED mob whose template is a delve companion', () => {
    const tpl = Object.values(DELVE_COMPANIONS)[0]?.mobTemplateId;
    if (!tpl) throw new Error('no delve companions');
    expect(isDelveCompanionMob(mob(tpl, { ownerId: 7 }))).toBe(true);
    expect(isDelveCompanionMob(mob(tpl))).toBe(false);
    expect(isDelveCompanionMob(mob('wolf', { ownerId: 7 }))).toBe(false);
  });
});
