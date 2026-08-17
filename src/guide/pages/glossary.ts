// Glossary: short, plain definitions of the terms used across the guide and in chat.

import { esc } from '../../ui/esc';
import { type TranslationKey, t } from '../../ui/i18n';
import type { GuidePage } from './types';
import { lead } from './ui';

// Each term carries a slug for a stable per-term anchor (#term-<slug>), so other pages
// can deep-link a piece of jargon to its definition. Exported so site search can index it.
//
// The 'augment' row is deliberately absent: augments only exist inside the Fiesta arena
// mode, which is no longer offered in the arena menu (see the header of arena.ts), so the
// glossary stopped defining a term a player can no longer meet. The augmentTerm/augmentDef
// catalog values stay in place; only the row is retired.
export const GLOSSARY_TERMS: { slug: string; term: TranslationKey; def: TranslationKey }[] = [
  { slug: 'aggro', term: 'guide.glossary.aggroTerm', def: 'guide.glossary.aggroDef' },
  { slug: 'threat', term: 'guide.glossary.threatTerm', def: 'guide.glossary.threatDef' },
  { slug: 'gcd', term: 'guide.glossary.gcdTerm', def: 'guide.glossary.gcdDef' },
  { slug: 'dps', term: 'guide.glossary.dpsTerm', def: 'guide.glossary.dpsDef' },
  { slug: 'buff', term: 'guide.glossary.buffTerm', def: 'guide.glossary.buffDef' },
  { slug: 'debuff', term: 'guide.glossary.debuffTerm', def: 'guide.glossary.debuffDef' },
  { slug: 'dot', term: 'guide.glossary.dotTerm', def: 'guide.glossary.dotDef' },
  { slug: 'cc', term: 'guide.glossary.ccTerm', def: 'guide.glossary.ccDef' },
  { slug: 'proc', term: 'guide.glossary.procTerm', def: 'guide.glossary.procDef' },
  {
    slug: 'five-second-rule',
    term: 'guide.glossary.fiveSecondTerm',
    def: 'guide.glossary.fiveSecondDef',
  },
  { slug: 'elite', term: 'guide.glossary.eliteTerm', def: 'guide.glossary.eliteDef' },
  { slug: 'rare', term: 'guide.glossary.rareTerm', def: 'guide.glossary.rareDef' },
  { slug: 'mob', term: 'guide.glossary.mobTerm', def: 'guide.glossary.mobDef' },
  { slug: 'tank', term: 'guide.glossary.tankTerm', def: 'guide.glossary.tankDef' },
  { slug: 'healer', term: 'guide.glossary.healerTerm', def: 'guide.glossary.healerDef' },
  { slug: 'spec', term: 'guide.glossary.specTerm', def: 'guide.glossary.specDef' },
  {
    slug: 'talent-row',
    term: 'guide.glossary.talentRowTerm',
    def: 'guide.glossary.talentRowDef',
  },
  { slug: 'pull', term: 'guide.glossary.pullTerm', def: 'guide.glossary.pullDef' },
  { slug: 'instance', term: 'guide.glossary.instanceTerm', def: 'guide.glossary.instanceDef' },
  { slug: 'raid', term: 'guide.glossary.raidTerm', def: 'guide.glossary.raidDef' },
  { slug: 'delve', term: 'guide.glossary.delveTerm', def: 'guide.glossary.delveDef' },
  { slug: 'rift', term: 'guide.glossary.riftTerm', def: 'guide.glossary.riftDef' },
  // Rank gets its own anchor even though the Rift entry names the letters: the
  // realm announcement and rift gear both say "A-rank", so the jargon needs a
  // landing spot other pages can deep-link.
  {
    slug: 'rift-rank',
    term: 'guide.glossary.riftRankTerm',
    def: 'guide.glossary.riftRankDef',
  },
  {
    slug: 'dungeon-finder',
    term: 'guide.glossary.finderTerm',
    def: 'guide.glossary.finderDef',
  },
  { slug: 'premade', term: 'guide.glossary.premadeTerm', def: 'guide.glossary.premadeDef' },
  { slug: 'deed', term: 'guide.glossary.deedTerm', def: 'guide.glossary.deedDef' },
  { slug: 'chronicle', term: 'guide.glossary.chronicleTerm', def: 'guide.glossary.chronicleDef' },
  { slug: 'renown', term: 'guide.glossary.renownTerm', def: 'guide.glossary.renownDef' },
  { slug: 'heroic', term: 'guide.glossary.heroicTerm', def: 'guide.glossary.heroicDef' },
  { slug: 'lockout', term: 'guide.glossary.lockoutTerm', def: 'guide.glossary.lockoutDef' },
  { slug: 'marks', term: 'guide.glossary.marksTerm', def: 'guide.glossary.marksDef' },
  { slug: 'honor', term: 'guide.glossary.honorTerm', def: 'guide.glossary.honorDef' },
  { slug: 'warfare', term: 'guide.glossary.warfareTerm', def: 'guide.glossary.warfareDef' },
  { slug: 'rested', term: 'guide.glossary.restedTerm', def: 'guide.glossary.restedDef' },
  { slug: 'fatigue', term: 'guide.glossary.fatigueTerm', def: 'guide.glossary.fatigueDef' },
  {
    slug: 'unstuck-sickness',
    term: 'guide.glossary.unstuckTerm',
    def: 'guide.glossary.unstuckDef',
  },
  { slug: 'pet-bar', term: 'guide.glossary.petBarTerm', def: 'guide.glossary.petBarDef' },
  { slug: 'loadout', term: 'guide.glossary.loadoutTerm', def: 'guide.glossary.loadoutDef' },
  {
    slug: 'damage-meters',
    term: 'guide.glossary.metersTerm',
    def: 'guide.glossary.metersDef',
  },
  {
    slug: 'target-marker',
    term: 'guide.glossary.targetMarkerTerm',
    def: 'guide.glossary.targetMarkerDef',
  },
  {
    slug: 'ready-check',
    term: 'guide.glossary.readyCheckTerm',
    def: 'guide.glossary.readyCheckDef',
  },
  {
    slug: 'item-level',
    term: 'guide.glossary.itemLevelTerm',
    def: 'guide.glossary.itemLevelDef',
  },
  {
    slug: 'required-level',
    term: 'guide.glossary.requiredLevelTerm',
    def: 'guide.glossary.requiredLevelDef',
  },
  { slug: 'off-hand', term: 'guide.glossary.offHandTerm', def: 'guide.glossary.offHandDef' },
  { slug: 'set-bonus', term: 'guide.glossary.setBonusTerm', def: 'guide.glossary.setBonusDef' },
  {
    slug: 'soulbound',
    term: 'guide.glossary.soulboundTerm',
    def: 'guide.glossary.soulboundDef',
  },
  {
    slug: 'commission',
    term: 'guide.glossary.commissionTerm',
    def: 'guide.glossary.commissionDef',
  },
  {
    slug: 'masterwork',
    term: 'guide.glossary.masterworkTerm',
    def: 'guide.glossary.masterworkDef',
  },
  {
    slug: 'tool-charm',
    term: 'guide.glossary.toolCharmTerm',
    def: 'guide.glossary.toolCharmDef',
  },
  { slug: 'mount', term: 'guide.glossary.mountTerm', def: 'guide.glossary.mountDef' },
  { slug: 'riding', term: 'guide.glossary.ridingTerm', def: 'guide.glossary.ridingDef' },
  { slug: 'reins', term: 'guide.glossary.reinsTerm', def: 'guide.glossary.reinsDef' },
  { slug: 'claudium', term: 'guide.glossary.claudiumTerm', def: 'guide.glossary.claudiumDef' },
  { slug: 'world', term: 'guide.glossary.worldTerm', def: 'guide.glossary.worldDef' },
  {
    slug: 'spirit-healer',
    term: 'guide.glossary.spiritHealerTerm',
    def: 'guide.glossary.spiritHealerDef',
  },
  {
    slug: 'world-boss',
    term: 'guide.glossary.worldBossTerm',
    def: 'guide.glossary.worldBossDef',
  },
];

export const glossary: GuidePage = {
  titleKey: 'guide.nav.glossary',
  render() {
    const items = GLOSSARY_TERMS.map(
      ({ slug, term, def }) =>
        `<div class="guide-term" id="term-${esc(slug)}"><dt>${esc(t(term))}</dt><dd>${esc(t(def))}</dd></div>`,
    ).join('');
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.glossary'))}</h1>
        ${lead('guide.glossary.intro')}
        <dl class="guide-glossary">${items}</dl>
      </article>`;
  },
};
