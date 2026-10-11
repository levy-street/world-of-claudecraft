import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';
import type { InterfaceUnlock } from './interface_unlock';
import type { HudFrameSpec } from './interface_unlock_core';

export const HUD_FRAME_GROUPS = [
  {
    id: 'trackerGroup',
    elementId: 'tracker-group',
    parentId: 'right-tracker-stack',
    setting: 'combineTrackerFrames',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.trackerGroup' as TranslationKey,
    members: [
      'questTracker',
      'deedTracker',
      'riftTracker',
      'gatheringGoalTracker',
      'delveTracker',
      'reliquaryTracker',
    ],
  },
  {
    id: 'auraGroup',
    elementId: 'aura-track-group',
    parentId: 'ui',
    setting: 'combineAuraFrames',
    labelKey: 'hudChrome.interfaceUnlock.frameNames.auraGroup' as TranslationKey,
    members: [
      'targetDots',
      'auraTrack_defensives',
      'auraTrack_self',
      'auraTrack_power',
      'auraTrack_utility',
      'auraTrack_friendly',
      'auraTrack_shields',
    ],
  },
] as const;

export function frameGroupFor(id: string): (typeof HUD_FRAME_GROUPS)[number] | undefined {
  return HUD_FRAME_GROUPS.find((group) => (group.members as readonly string[]).includes(id));
}

/** Reuse live roots and retain independent saved geometry across layout switches. */
export class HudFrameGroups {
  private readonly combined = new Map<string, boolean>();
  private readonly homes = new Map<
    string,
    { element: HTMLElement; parent: Node; next: Node | null; order: number }
  >();

  constructor(
    private readonly doc: Document,
    specs: readonly HudFrameSpec[],
  ) {
    for (const group of HUD_FRAME_GROUPS) {
      const parent = doc.getElementById(group.parentId);
      if (!parent) continue;
      const root = doc.getElementById(group.elementId) ?? doc.createElement('div');
      root.id = group.elementId;
      root.classList.add('hud-frame-group');
      root.hidden = true;
      if (!root.parentNode) parent.appendChild(root);
      for (const id of group.members) {
        const spec = specs.find((entry) => entry.id === id);
        const member = spec && doc.getElementById(spec.elementId);
        if (!member || !spec) continue;
        member.setAttribute('data-group-label', t(spec.labelKey));
        if (member.parentNode)
          this.homes.set(id, {
            element: member,
            parent: member.parentNode,
            next: member.nextSibling,
            order: Array.from(member.parentNode.childNodes).indexOf(member),
          });
      }
    }
  }

  isCombinedMember(id: string): boolean {
    const group = frameGroupFor(id);
    return !!group && this.combined.get(group.id) === true;
  }

  isActive(id: string): boolean {
    return HUD_FRAME_GROUPS.some((group) => group.id === id)
      ? this.combined.get(id) === true
      : !this.isCombinedMember(id);
  }

  sync(
    enabled: (key: (typeof HUD_FRAME_GROUPS)[number]['setting']) => boolean,
    frames: Pick<InterfaceUnlock, 'clearAppliedGeometry' | 'restoreSavedPosition'>,
  ): void {
    for (const group of HUD_FRAME_GROUPS) {
      const on = enabled(group.setting);
      if (this.combined.get(group.id) === on) continue;
      const root = this.doc.getElementById(group.elementId);
      if (!root) continue;
      if (on) {
        for (const id of group.members) frames.clearAppliedGeometry(id);
        this.combined.set(group.id, true);
        for (const id of group.members) {
          const member = this.homes.get(id)?.element;
          if (!member) continue;
          member.classList.add('hud-group-member');
          root.appendChild(member);
        }
        root.hidden = false;
        frames.restoreSavedPosition(group.id);
      } else {
        frames.clearAppliedGeometry(group.id);
        this.combined.set(group.id, false);
        const orderedMembers = [...group.members].sort(
          (a, b) => (this.homes.get(b)?.order ?? 0) - (this.homes.get(a)?.order ?? 0),
        );
        for (const id of orderedMembers) {
          const home = this.homes.get(id);
          if (!home) continue;
          home.element.classList.remove('hud-group-member');
          if (home.element.parentNode === root)
            home.parent.insertBefore(
              home.element,
              home.next?.parentNode === home.parent ? home.next : null,
            );
        }
        root.hidden = true;
        for (const id of group.members) frames.restoreSavedPosition(id);
      }
    }
  }
}

export function refreshHudFrameGroupLabels(doc: Document, specs: readonly HudFrameSpec[]): void {
  for (const spec of specs) {
    if (frameGroupFor(spec.id))
      doc.getElementById(spec.elementId)?.setAttribute('data-group-label', t(spec.labelKey));
  }
}
