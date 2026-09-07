// The target frame's unit_frame descriptor fill, MOVED out of the Hud coordinator
// (hud.ts): the per-paint mapping from the targeted entity to the family
// descriptor the shared unit_frame core + painter consume. DOM-free; the Hud
// stays a thin consumer that owns the descriptor buffer, the cadence gate, and
// the painter, and calls this once per gated repaint.
//
// The mapping (byte-faithful to the inline block it replaced): hp / resource
// fractions and preformatted text, the "Dead" readout, the classic empty resource
// rail for a resource-less or dead target, the pre-localized title decoration
// (memoized by the caller behind a language + title signature), the Cheater tag,
// the player-kind-gated Book of Deeds border slug, the id-keyed portrait gate,
// and the party-scoped raid marker read from IWorld.markerFor at the call site
// (so a marked mob shows the same symbol on the frame as on its nameplate).

import type { Entity } from '../sim/types';
import { cheaterTagLabel } from './cheater_tag';
import { deedTargetBorderSlug } from './deed_border_view';
import type { TitledNameDecoration } from './deed_i18n';
import { entityDisplayName } from './entity_display_labels';
import { unitFrameCurrentMaxText } from './hud_frames';
import { t } from './i18n';
import type { UnitFrameDescriptor } from './unit_frame';

/**
 * Fill the target frame's descriptor for one entity. Mutates the caller-owned
 * `d` in place (allocation-light, the per-frame HUD path) and returns it.
 * `raidMarker` is the target's party mark (IWorld.markerFor: 0..7 or null).
 */
export function fillTargetFrameDescriptor(
  d: UnitFrameDescriptor,
  target: Entity,
  title: TitledNameDecoration,
  raidMarker: number | null,
): UnitFrameDescriptor {
  d.present = true;
  d.hpFrac = target.hp / Math.max(1, target.maxHp);
  d.hpText = target.dead ? t('hud.core.dead') : unitFrameCurrentMaxText(target.hp, target.maxHp);
  d.showAbsorbText = !target.dead;
  // The target's power bar (classic target frame): players and caster
  // mobs show their mana/rage/energy; a resource-less target (a plain
  // beast, rtype null) maps to 'none' EXPLICITLY (unitResourceClass
  // buckets null with mana), so every type class turns off and the
  // rail renders EMPTY (zero fill, no text) but stays visible, the
  // classic look where the frame never changes height. Dead: same.
  const noResource = target.dead || !target.resourceType;
  d.resourceKind = noResource ? 'none' : target.resourceType;
  d.resFrac = noResource ? 0 : target.resource / Math.max(1, target.maxResource);
  d.resText = noResource
    ? ''
    : unitFrameCurrentMaxText(Math.round(target.resource), target.maxResource);
  d.levelText = String(target.level);
  d.name = entityDisplayName(target);
  d.titlePre = title.pre;
  d.titlePost = title.post;
  // The operator-applied Cheater tag (src/sim/moderation/). Resolved every
  // gated paint rather than memoized behind a signature like the title:
  // cheaterTagLabel is a field read plus one t() lookup, so a memo would
  // cost more than it saves and would need its own language key.
  d.cheaterTag = cheaterTagLabel(target);
  // Explicit player-kind gate: stale/malformed NPC or mob identity data
  // must never inherit a player reward surface.
  d.borderSlug = deedTargetBorderSlug(target.kind, target.border ?? null);
  // id-keyed gate, byte-faithful to the old lastPortraitTarget !== target.id;
  // the painter resets it on hide so an id reused by a new mob still redraws.
  d.portraitKey = String(target.id);
  d.absorb = target.dead ? null : target;
  d.dead = false;
  d.outOfRange = false;
  d.raidMarker = raidMarker;
  return d;
}
