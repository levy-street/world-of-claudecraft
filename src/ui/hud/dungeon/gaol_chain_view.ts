// Gaoler Ossick's chain alert: the pure, DOM-free view core. It tells the local
// player what a chain on them (or on a party member) asks of them, read off the
// auras the sim already mirrors (encounters/sunken_bastion):
//  - hooked by the Drowned Anchor (the Anchored aura, whose sourceId names the
//    anchor): run to a lit Mooring Post or have the group break the chain
//    (ossick_moorings.ts holds the post rule), and the bar is the chain broken
//    so far (the anchor body's lost health, the same points the sim counts).
//    The anchor's health IS its links (one per hit, however hard), so the
//    alert counts the links left and says the rule out loud;
//  - shackled to a partner (the Shackled aura, whose sourceId names the partner
//    and whose value2 is the chain's reach): stay close, with the live distance,
//    and a louder line once the pair stands past the reach and the chain bites;
//  - a party member hooked by the anchor: break their chain.
// Priority: a chain on the player first (the anchor over the shackle), then an
// ally's anchor. The painter (gaol_chain_painter.ts) only paints.

import {
  DROWNED_ANCHOR_ID,
  OSSICK_ANCHORED,
  OSSICK_SHACKLED,
  shackleRange,
} from '../../../sim/encounters/sunken_bastion/ids';
import { formatNumber, t } from '../../i18n';

export type GaolChainKind = 'anchored' | 'ally' | 'shackled' | 'strained';

export interface GaolChainLive {
  visible: true;
  kind: GaolChainKind;
  title: string;
  line: string;
  /** Anchor kinds: the chain broken (0 to 1). Shackle kinds: the reach used. */
  progress: number;
  progressAria: string;
  /** Anchor kinds: the links left ("Chain links left: 9 of 12"); '' else. */
  count: string;
  /** Anchor kinds: the one-link-a-hit rule; '' else. */
  hint: string;
}

export interface GaolChainHidden {
  visible: false;
}

export type GaolChainView = GaolChainLive | GaolChainHidden;

const HIDDEN: GaolChainHidden = { visible: false };

interface ChainAura {
  id: string;
  sourceId?: number;
  value2?: number;
}

export interface GaolChainEntity {
  name: string;
  templateId?: string;
  pos: { x: number; z: number };
  hp: number;
  maxHp: number;
  dead?: boolean;
  auras?: readonly ChainAura[];
}

export interface GaolChainInput {
  selfId: number;
  selfPos: { x: number; z: number };
  auras: readonly ChainAura[];
  entity: (id: number) => GaolChainEntity | null | undefined;
  /** The party roster (the local player may be in it; it is skipped). */
  party: readonly { pid: number }[] | null | undefined;
}

function auraOf(auras: readonly ChainAura[] | undefined, id: string): ChainAura | null {
  if (!auras) return null;
  for (const a of auras) if (a.id === id) return a;
  return null;
}

/** The chain broken so far: the anchor's lost share of its points. */
function brokenShare(anchor: GaolChainEntity | null | undefined): number {
  if (!anchor || anchor.maxHp <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - anchor.hp / anchor.maxHp));
}

function pct(share: number): string {
  return formatNumber(share, { style: 'percent', maximumFractionDigits: 0 });
}

/** The anchor's links left and its chain's length (its health is its links). */
export function anchorLinks(anchor: { hp: number; maxHp: number }): {
  left: number;
  total: number;
} {
  return {
    left: Math.max(0, Math.ceil(anchor.hp)),
    total: Math.max(0, Math.round(anchor.maxHp)),
  };
}

/** The target frame's health text for a Drowned Anchor ("9 of 12 links"),
 *  or null for any other body (it keeps its usual health text). */
export function wardHealthText(e: {
  templateId?: string;
  hp: number;
  maxHp: number;
}): string | null {
  if (e.templateId !== DROWNED_ANCHOR_ID || e.maxHp <= 0) return null;
  const { left, total } = anchorLinks(e);
  return t('hudChrome.bastionChain.linksTarget', {
    count: formatNumber(left),
    total: formatNumber(total),
  });
}

/** The floating text a hit on a Drowned Anchor shows ("Link broken!") in
 *  place of its fixed one point, or null for any other target. */
export function wardHitText(target: { templateId?: string } | null | undefined): string | null {
  return target?.templateId === DROWNED_ANCHOR_ID ? t('hudChrome.bastionChain.linkBroken') : null;
}

function anchorView(
  kind: 'anchored' | 'ally',
  anchor: GaolChainEntity | null | undefined,
  name: string,
): GaolChainLive {
  const progress = brokenShare(anchor);
  const links = anchor ? anchorLinks(anchor) : null;
  return {
    visible: true,
    kind,
    title:
      kind === 'anchored'
        ? t('hudChrome.bastionChain.anchoredTitle')
        : t('hudChrome.bastionChain.allyTitle'),
    line:
      kind === 'anchored'
        ? t('hudChrome.bastionChain.anchoredLine')
        : t('hudChrome.bastionChain.allyLine', { name }),
    progress,
    progressAria: t('hudChrome.bastionChain.brokenAria', { pct: pct(progress) }),
    count: links
      ? t('hudChrome.bastionChain.linksLeft', {
          count: formatNumber(links.left),
          total: formatNumber(links.total),
        })
      : '',
    hint: t('hudChrome.bastionChain.linkRule'),
  };
}

export function buildGaolChainView(input: GaolChainInput): GaolChainView {
  const anchored = auraOf(input.auras, OSSICK_ANCHORED);
  if (anchored) return anchorView('anchored', input.entity(anchored.sourceId ?? -1), '');
  const shackled = auraOf(input.auras, OSSICK_SHACKLED);
  if (shackled) {
    const partner = input.entity(shackled.sourceId ?? -1);
    if (partner && !partner.dead) {
      const reach = shackled.value2 && shackled.value2 > 0 ? shackled.value2 : shackleRange(false);
      const dist = Math.hypot(partner.pos.x - input.selfPos.x, partner.pos.z - input.selfPos.z);
      const strained = dist > reach;
      const yd = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
      return {
        visible: true,
        kind: strained ? 'strained' : 'shackled',
        title: t('hudChrome.bastionChain.shackledTitle', { name: partner.name }),
        line: strained
          ? t('hudChrome.bastionChain.strainedLine', { range: yd(reach) })
          : t('hudChrome.bastionChain.shackledLine', { range: yd(reach), dist: yd(dist) }),
        progress: Math.min(1, dist / reach),
        progressAria: t('hudChrome.bastionChain.reachAria', {
          pct: pct(Math.min(1, dist / reach)),
        }),
        count: '',
        hint: '',
      };
    }
  }
  if (input.party) {
    for (const m of input.party) {
      if (m.pid === input.selfId) continue;
      const ally = input.entity(m.pid);
      if (!ally || ally.dead) continue;
      const hook = auraOf(ally.auras, OSSICK_ANCHORED);
      if (hook) return anchorView('ally', input.entity(hook.sourceId ?? -1), ally.name);
    }
  }
  return HIDDEN;
}
