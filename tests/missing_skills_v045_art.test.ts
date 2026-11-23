import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABILITY_ART_PENDING, abilityImageUrl, iconDataUrl } from '../src/ui/icons';

const expected = [
  ['courier', 'warrior'],
  ['lunge', 'druid'],
  ['hamstring_bite', 'druid'],
  ['clockwork_shock_bomb', 'warrior'],
] as const;

describe('integration 45 missing skill art', () => {
  it('resolves every former fallback through the action-bar icon route', () => {
    // The release's new Scratch ability remains explicitly pending; this wave
    // completed the four integration icons listed below.
    expect([...ABILITY_ART_PENDING]).toEqual(['scratch']);
    for (const [id, cls] of expected) {
      const url = `/ui/skills/${cls}/${id}.webp`;
      expect(abilityImageUrl(id)).toBe(url);
      expect(iconDataUrl('ability', id)).toBe(url);
    }
  });

  it('pins the four accepted paintings and their individual provenance owners', () => {
    const record = JSON.parse(
      readFileSync('docs/achievements/missing-skills-v045-2026-10-22/accepted-art.json', 'utf8'),
    );
    expect(record.assets.map((a: { id: string }) => a.id).sort()).toEqual(
      expected.map(([id]) => id).sort(),
    );
    for (const [id, cls] of expected) {
      const asset = record.assets.find((a: { id: string }) => a.id === id);
      const bytes = readFileSync(`public/ui/skills/${cls}/${id}.webp`);
      expect(createHash('sha256').update(bytes).digest('hex'), id).toBe(asset.acceptedSha256);
      expect(bytes.length, id).toBe(asset.acceptedBytes);
      expect(bytes.length, id).toBeLessThanOrEqual(15 * 1024);
      const mapping = JSON.parse(readFileSync(`public/ui/skills/${cls}/mapping.json`, 'utf8'));
      const owners = mapping.abilities.filter((a: { abilityId: string }) => a.abilityId === id);
      expect(owners, id).toHaveLength(1);
      expect(owners[0].generationPrompt, id).toBe(asset.generation.prompt);
      expect(owners[0].license, id).toContain('project-generated');
    }
  });
});
