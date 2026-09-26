// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HUD_FRAME_GROUPS,
  HudFrameGroups,
  refreshHudFrameGroupLabels,
} from '../src/ui/hud_frame_groups';
import { registerHudFrames } from '../src/ui/hud_frame_registry';
import { InterfaceUnlock } from '../src/ui/interface_unlock';
import { HUD_FRAME_SPECS, hudFrameActive } from '../src/ui/interface_unlock_core';

beforeEach(() => {
  document.body.innerHTML = '<div id="ui"><div id="right-tracker-stack"></div></div>';
  for (const group of HUD_FRAME_GROUPS) {
    const parent = document.getElementById(group.parentId)!;
    for (const id of group.members) {
      const member = document.createElement('div');
      member.id = HUD_FRAME_SPECS.find((spec) => spec.id === id)!.elementId;
      parent.appendChild(member);
    }
  }
});

describe('optional HUD frame groups', () => {
  it('reattaches Target of Target without losing its independent saved position', () => {
    localStorage.clear();
    const spec = HUD_FRAME_SPECS.find((row) => row.id === 'targetOfTarget')!;
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.innerHTML = '<div id="totarget-frame"><div class="uf-resource"></div></div>';
    document.getElementById('ui')!.appendChild(target);
    const child = document.getElementById('totarget-frame')!;
    const resource = child.firstChild;
    const saved = JSON.stringify({ left: 75, top: 85, scale: 1.2 });
    localStorage.setItem(spec.storageKey, saved);
    let independent = false;
    const groups = new HudFrameGroups(document, HUD_FRAME_SPECS);
    const registry = new InterfaceUnlock({ document });
    const sync = registerHudFrames({
      document,
      registry,
      groups,
      isMobileLayout: () => false,
      snapToGrid: () => false,
      labelKey: (row) => row.labelKey,
      isActive: () => true,
      onPositioned: () => {},
      options: () => ({
        settings: {
          get: (key) => (key === 'moveTargetOfTargetIndependently' ? independent : true),
          set: (_key, value) => value,
        },
        onSettingChange: () => {},
      }),
    });
    sync();
    registry.setUnlocked(true);
    expect(child.parentElement).toBe(target);
    expect(child.classList.contains('tf-unlocked')).toBe(false);
    independent = true;
    sync();
    registry.refreshSettings();
    expect(child.parentElement!.id).toBe('ui');
    expect(child.style.left).toBe('75px');
    expect(child.classList.contains('tf-unlocked')).toBe(true);
    independent = false;
    sync();
    registry.refreshSettings();
    expect(child.parentElement).toBe(target);
    expect(child.style.left).toBe('');
    expect(JSON.parse(localStorage.getItem(spec.storageKey)!)).toMatchObject(JSON.parse(saved));
    independent = true;
    sync();
    registry.refreshSettings();
    expect(child.style.left).toBe('75px');
    expect(child.contains(resource)).toBe(true);
    localStorage.clear();
  });
  it('restores the original order when markup differs from the group table', () => {
    const parent = document.getElementById('right-tracker-stack')!;
    parent.prepend(document.getElementById('reliquary-tracker')!);
    parent.prepend(document.getElementById('delve-tracker')!);
    const original = [...parent.children];
    const groups = new HudFrameGroups(document, HUD_FRAME_SPECS);
    const frames = { clearAppliedGeometry: vi.fn(), restoreSavedPosition: vi.fn() };
    groups.sync(() => true, frames);
    groups.sync(() => false, frames);
    expect([...parent.children].filter((el) => original.includes(el))).toEqual(original);
  });

  it('restores independently saved geometry through the real registry while unlocked', () => {
    localStorage.clear();
    const questSpec = HUD_FRAME_SPECS.find((spec) => spec.id === 'questTracker')!;
    localStorage.setItem(questSpec.storageKey, JSON.stringify({ left: 75, top: 85, scale: 1 }));
    const groups = new HudFrameGroups(document, HUD_FRAME_SPECS);
    const registry = new InterfaceUnlock({ document });
    registerHudFrames({
      document,
      registry,
      groups,
      isMobileLayout: () => false,
      snapToGrid: () => false,
      labelKey: (spec) => spec.labelKey,
      isActive: () => true,
      onPositioned: () => {},
      options: () => null,
    });
    groups.sync(() => false, registry);
    registry.setUnlocked(true);
    const quest = document.getElementById('quest-tracker')!;
    const savedLeft = quest.style.left;
    expect(savedLeft).not.toBe('');
    groups.sync(() => true, registry);
    registry.refreshSettings();
    expect(quest.parentElement!.id).toBe('tracker-group');
    expect(quest.style.left).toBe('');
    expect(quest.classList.contains('tf-unlocked')).toBe(false);
    groups.sync(() => false, registry);
    registry.refreshSettings();
    expect(quest.parentElement!.id).toBe('ui');
    expect(quest.style.left).toBe(savedLeft);
    expect(quest.classList.contains('tf-unlocked')).toBe(true);
    expect(JSON.parse(localStorage.getItem(questSpec.storageKey)!)).toMatchObject({
      left: 75,
      top: 85,
    });
    localStorage.clear();
  });

  it('round-trips live nodes, sibling order, chrome, member visibility and saved geometry independently', () => {
    const parent = document.getElementById('right-tracker-stack')!;
    const original = [...parent.children];
    const member = document.getElementById('quest-tracker')!;
    const clicked = vi.fn();
    member.addEventListener('click', clicked);
    member.classList.add('tf-user-hidden');
    const groups = new HudFrameGroups(document, HUD_FRAME_SPECS);
    const calls: string[] = [];
    const frames = {
      clearAppliedGeometry: (id: string) => calls.push(`clear:${id}`),
      restoreSavedPosition: (id: string) => calls.push(`restore:${id}`),
    };
    groups.sync(() => false, frames);
    expect(groups.isActive('questTracker')).toBe(true);
    expect(groups.isActive('trackerGroup')).toBe(false);
    expect(document.getElementById('tracker-group')!.hidden).toBe(true);
    calls.length = 0;
    groups.sync((key) => key === 'combineTrackerFrames', frames);
    expect(groups.isCombinedMember('questTracker')).toBe(true);
    expect(groups.isCombinedMember('auraTrack_self')).toBe(false);
    const root = document.getElementById('tracker-group')!;
    expect([...root.children]).toEqual(original);
    expect(root.contains(document.getElementById('delve-tracker'))).toBe(true);
    expect(root.contains(document.getElementById('reliquary-tracker'))).toBe(true);
    expect(calls.at(-1)).toBe('restore:trackerGroup');
    const chrome = document.createElement('button');
    root.appendChild(chrome);
    refreshHudFrameGroupLabels(document, HUD_FRAME_SPECS);
    expect(root.contains(chrome)).toBe(true);
    calls.length = 0;
    groups.sync(() => false, frames);
    expect(calls[0]).toBe('clear:trackerGroup');
    expect(calls).toContain('restore:questTracker');
    expect([...parent.children].filter((el) => original.includes(el))).toEqual(original);
    member.click();
    expect(clicked).toHaveBeenCalledOnce();
    expect(member.classList.contains('tf-user-hidden')).toBe(true);
    expect(member.classList.contains('hud-group-member')).toBe(false);
    calls.length = 0;
    groups.sync(() => false, frames);
    expect(calls).toEqual([]);
    groups.sync((key) => key === 'combineAuraFrames', frames);
    expect(groups.isCombinedMember('auraTrack_self')).toBe(true);
    expect(groups.isCombinedMember('questTracker')).toBe(false);
  });

  it('keeps optional settings and action-bar shape authoritative', () => {
    const state = {
      playerClass: 'mage' as const,
      combined: false,
      bar2: false,
      bar3: false,
      enabled: () => false,
    };
    expect(hudFrameActive('reliquaryTracker', state)).toBe(false);
    expect(hudFrameActive('targetOfTarget', state)).toBe(false);
    expect(hudFrameActive('targetDots', state)).toBe(false);
    expect(hudFrameActive('actionBar1', state)).toBe(true);
    expect(hudFrameActive('actionBar2', state)).toBe(false);
    expect(hudFrameActive('actionBarGroup', { ...state, combined: true })).toBe(true);
    expect(hudFrameActive('actionBar1', { ...state, combined: true })).toBe(false);
    expect(hudFrameActive('reliquaryTracker', { ...state, enabled: () => true })).toBe(true);
  });
});
