import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from './_harness';

const EPSILON = 0.5;

beforeEach(async () => {
  await page.viewport(844, 390);
  document.body.className = 'mobile-touch game-active hud-mobile-compact';
});

afterEach(() => {
  cleanup();
  document.body.className = '';
});

function aura(className: string, duration: string): HTMLElement {
  const icon = document.createElement('div');
  icon.className = className;
  const label = document.createElement('div');
  label.className = 'dur';
  label.textContent = duration;
  icon.appendChild(label);
  return icon;
}

describe('compact raid aura timing', () => {
  it('keeps exact m:ss labels readable and inside the raid tile', () => {
    const frames = document.createElement('div');
    frames.id = 'party-frames';
    frames.className = 'party-expanded party-style-raid';
    const rows = document.createElement('div');
    rows.className = 'party-rows';
    const row = document.createElement('div');
    row.className = 'party-frame';
    const strip = document.createElement('div');
    strip.className = 'pfm-auras';
    strip.append(aura('buff timed debuff', '1:30'), aura('buff timed', '1:30'));
    row.appendChild(strip);
    rows.appendChild(row);
    frames.appendChild(rows);
    document.body.appendChild(frames);

    const tileRect = row.getBoundingClientRect();
    const labels = Array.from(strip.querySelectorAll<HTMLElement>('.dur'));
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      const rect = label.getBoundingClientRect();
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + EPSILON);
      expect(rect.left).toBeGreaterThanOrEqual(tileRect.left - EPSILON);
      expect(rect.right).toBeLessThanOrEqual(tileRect.right + EPSILON);
      expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
    }
    expect(labels[0].getBoundingClientRect().right).toBeLessThanOrEqual(
      labels[1].getBoundingClientRect().left + EPSILON,
    );
  });

  it('keeps classic party auras in a dedicated lane above both status rails', () => {
    const frames = document.createElement('div');
    frames.id = 'party-frames';
    frames.className = 'party-expanded';
    const rows = document.createElement('div');
    rows.className = 'party-rows';
    const row = document.createElement('div');
    row.className = 'party-frame';
    const name = document.createElement('div');
    name.className = 'pfm-name';
    name.textContent = 'Brightoak';
    const strip = document.createElement('div');
    strip.className = 'pfm-auras';
    strip.append(aura('buff timed debuff', '1:30'), aura('buff timed', '1:30'));
    const hp = document.createElement('div');
    hp.className = 'bar hp';
    const resource = document.createElement('div');
    resource.className = 'bar';
    row.append(name, strip, hp, resource);
    rows.appendChild(row);
    frames.appendChild(rows);
    document.body.appendChild(frames);

    const stripRect = strip.getBoundingClientRect();
    const hpRect = hp.getBoundingClientRect();
    const resourceRect = resource.getBoundingClientRect();
    expect(stripRect.bottom).toBeLessThanOrEqual(hpRect.top + EPSILON);
    expect(stripRect.bottom).toBeLessThanOrEqual(resourceRect.top + EPSILON);
    expect(hpRect.bottom).toBeLessThanOrEqual(resourceRect.top + EPSILON);
  });
});
