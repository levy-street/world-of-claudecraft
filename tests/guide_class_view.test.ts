import { describe, expect, it } from 'vitest';
import { specCardHtml } from '../src/guide/class_view';
import { GUIDE_CLASSES, type GuideClassSpec } from '../src/guide/content.generated';
import { TALENTS } from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import { abilityImageUrl } from '../src/ui/icons';
import { specIconUrl } from '../src/ui/spec_icon_art';

function renderedIconSource(html: string): string | null {
  return (
    html.match(/<img class="guide-spec-icon" src="([^"]+)"/)?.[1] ??
    html.match(/guide-spec-icon-art" style="background-image:url\(([^)]+)\)/)?.[1] ??
    null
  );
}

describe('public guide specialization cards', () => {
  it('renders every live specialization with its dedicated painted emblem', () => {
    for (const guideClass of GUIDE_CLASSES) {
      const classTalents = TALENTS[guideClass.id as PlayerClass];
      expect(classTalents, guideClass.id).toBeDefined();

      for (const guideSpec of guideClass.specs) {
        const spec = classTalents.specs.find((candidate) => candidate.id === guideSpec.id);
        expect(spec, `${guideClass.id}/${guideSpec.id}`).toBeDefined();
        const expected = spec ? specIconUrl(spec) : null;
        expect(expected, `${guideClass.id}/${guideSpec.id}`).not.toBeNull();
        const html = specCardHtml(guideClass.id, guideSpec);
        expect(renderedIconSource(html)).toBe(expected);
        expect(html, `${guideClass.id}/${guideSpec.id} signature fallback`).toContain(
          `url(${abilityImageUrl(guideSpec.signature)})`,
        );
      }
    }
  });

  it('falls back to known signature art for a synthetic specialization', () => {
    const synthetic: GuideClassSpec = {
      id: 'synthetic',
      name: 'Synthetic',
      role: 'dps',
      signature: 'fireball',
    };

    expect(renderedIconSource(specCardHtml('synthetic_class', synthetic))).toBe(
      abilityImageUrl('fireball'),
    );
  });

  it('uses safe text for an entirely unknown identity without invoking procedural art', () => {
    const missing: GuideClassSpec = {
      id: 'missing',
      name: '<Unknown>',
      role: 'dps',
      signature: 'constructor',
    };
    const html = specCardHtml('constructor', missing);

    expect(renderedIconSource(html)).toBeNull();
    expect(html).toContain(
      '<span class="guide-spec-icon guide-spec-icon-fallback" aria-hidden="true">U</span>',
    );
  });
});
