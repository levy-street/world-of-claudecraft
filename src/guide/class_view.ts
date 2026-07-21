// Shared class-presentation helpers used by both the Classes pages and the Talents page,
// so the spec card, role badges, crest, and "feel" tags render identically everywhere.
// Pure HTML-string builders; all interpolation goes through esc(). Localized spec and
// mastery prose come from talent_i18n (the same source the in-game talents panel uses).

import { t, type TranslationKey } from '../ui/i18n';
import { esc } from '../ui/esc';
import { iconDataUrl } from '../ui/icons';
import { tTalent } from '../ui/talent_i18n';
import { TALENTS } from '../sim/content/talents';
import type { PlayerClass } from '../sim/types';
import { CLASS_META } from './class_meta';
import { badge, tag, tagRow } from './pages/ui';
import type { GuideRole, GuideClassSpec } from './content.generated';

export function roleKey(role: GuideRole): TranslationKey {
  if (role === 'tank') return 'guide.role.tank';
  if (role === 'healer') return 'guide.role.healer';
  return 'guide.role.damage';
}

export const className = (id: string): string => t(`classes.${id}` as TranslationKey);
export const classLore = (id: string): string => t(`classDetails.lore.${id}` as TranslationKey);
export const classCrest = (id: string, size: number): string => iconDataUrl('crest', `class_${id}`, size);
export const abilityHook = (id: string): string => t(`guide.abilityHook.${id}` as TranslationKey);

export function roleBadges(roles: GuideRole[]): string {
  return roles.map((r) => badge(t(roleKey(r)), `guide-role-${r}`)).join('');
}

// Qualitative "shape" tags from the curated class metadata, never numbers.
export function classTags(id: string): string {
  const m = CLASS_META[id];
  if (!m) return '';
  const styleKey: TranslationKey = m.style === 'melee' ? 'guide.tag.melee' : m.style === 'ranged' ? 'guide.tag.ranged' : 'guide.tag.both';
  const playKey: TranslationKey = m.play === 'solo' ? 'guide.tag.solo' : m.play === 'group' ? 'guide.tag.group' : 'guide.tag.flexible';
  const cxKey: TranslationKey = m.complexity === 'low' ? 'guide.tag.simple' : m.complexity === 'med' ? 'guide.tag.moderate' : 'guide.tag.complex';
  const chips = [
    tag(t(styleKey), 'guide-tag-style'),
    tag(t(playKey), 'guide-tag-play'),
    tag(t(cxKey), `guide-tag-cx guide-tag-cx-${m.complexity}`),
  ];
  if (m.goodFirst) chips.push(tag(t('guide.tag.goodFirst'), 'guide-tag-first'));
  return tagRow(chips.join(''));
}

// One specialization card: signature-ability icon, name, role badge, the localized spec
// one-liner, and the mastery name (never the number-laden mastery effect).
export function specCardHtml(classId: string, sp: GuideClassSpec): string {
  const def = TALENTS[classId as PlayerClass]?.specs.find((s) => s.id === sp.id);
  const name = def ? tTalent({ kind: 'talentSpec', spec: def, field: 'name' }) : sp.name;
  const desc = def ? tTalent({ kind: 'talentSpec', spec: def, field: 'description' }) : '';
  const mastery = def ? tTalent({ kind: 'talentMastery', spec: def, field: 'name' }) : '';
  return `
    <li class="guide-spec-card">
      <img class="guide-spec-icon" src="${esc(iconDataUrl('ability', sp.signature, 48))}" alt="" width="40" height="40" loading="lazy" decoding="async" />
      <div class="guide-spec-body">
        <div class="guide-spec-head">
          <span class="guide-spec-name">${esc(name)}</span>
          ${badge(t(roleKey(sp.role)), `guide-role-${sp.role}`)}
        </div>
        ${desc ? `<p class="guide-spec-desc">${esc(desc)}</p>` : ''}
        ${mastery ? `<p class="guide-spec-mastery"><span>${esc(t('guide.classPage.masteryLabel'))}</span> ${esc(mastery)}</p>` : ''}
      </div>
    </li>`;
}
