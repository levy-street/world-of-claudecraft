import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createNameplateHeraldry,
  nameplateHeraldryInto,
} from '../src/render/nameplate_heraldry_core';
import {
  DEED_HERALDRY_CEREMONIAL_TIP_PX,
  DEED_HERALDRY_PLAQUE_CLIP_PATHS,
  DEED_HERALDRY_PLAQUE_NOTCH_PX,
  DEED_HERALDRY_PLAQUE_TIP_PX,
  DEED_HERALDRY_TAB_TIP_PX,
} from '../src/ui/deed_heraldry_plaque_core';

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

describe('Deed Heraldry plaque silhouette core', () => {
  it('pins fixed-pixel compact, mirrored, ceremonial, and deed-tab silhouettes', () => {
    expect(DEED_HERALDRY_PLAQUE_TIP_PX).toBe(8);
    expect(DEED_HERALDRY_PLAQUE_NOTCH_PX).toBe(4);
    expect(DEED_HERALDRY_CEREMONIAL_TIP_PX).toBe(16);
    expect(DEED_HERALDRY_TAB_TIP_PX).toBe(10);
    expect(Object.keys(DEED_HERALDRY_PLAQUE_CLIP_PATHS).sort()).toEqual([
      'ceremonial',
      'compact',
      'mirror',
      'tab',
    ]);
    expect(DEED_HERALDRY_PLAQUE_CLIP_PATHS).toEqual({
      compact: 'polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%, 4px 50%)',
      mirror: 'polygon(8px 0, 100% 0, calc(100% - 4px) 50%, 100% 100%, 8px 100%, 0 50%)',
      ceremonial:
        'polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%)',
      tab: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)',
    });
  });

  it('freezes the stored silhouette authority', () => {
    expect(Object.isFrozen(DEED_HERALDRY_PLAQUE_CLIP_PATHS)).toBe(true);
  });

  it('uses the same fixed-pixel pointed silhouette in the world hot path', () => {
    const out = nameplateHeraldryInto(createNameplateHeraldry(), {
      screenX: 320,
      nameRowBottomY: 200,
      nameRowWidth: 70,
      nameRowHeight: 16,
      slug: 'deepward',
    }) as unknown as {
      plaque: { x: number; y: number; w: number; h: number };
      plaqueShoulderX: number;
      plaqueNotchX: number;
    };
    expect(out.plaque).toEqual({ x: 278, y: 183, w: 92, h: 18 });
    expect(out.plaqueShoulderX).toBe(362);
    expect(out.plaqueNotchX).toBe(282);
    const source = read('src/render/nameplate_heraldry_core.ts');
    expect(source).toContain("from '../ui/deed_heraldry_plaque_core'");
    expect(source).not.toMatch(/ribbon/i);
  });
});

describe('Deed Heraldry plaque surface family', () => {
  it('uses the shared compact and mirrored plaque hosts on both game entries', () => {
    for (const rel of ['index.html', 'play.html']) {
      const html = read(rel);
      expect(html).toMatch(/class="uf-name-header deed-heraldry-plaque" id="pf-name-header"/);
      expect(html).toMatch(
        /class="uf-name-header deed-heraldry-plaque deed-heraldry-plaque-mirror" id="tf-name-header"/,
      );
    }
  });

  it('uses the ceremonial plaque for inspect and the portrait-left compact form in both Book previews', () => {
    const inspect = read('src/ui/inspect_window.ts');
    const deeds = read('src/ui/deeds_window.ts');
    expect(inspect).toContain(
      'class="inspect-heraldry-face deed-heraldry-plaque deed-heraldry-plaque-ceremonial"',
    );
    expect(inspect).toContain(
      'class="inspect-heraldry-deed deed-heraldry-plaque deed-heraldry-plaque-tab"',
    );
    expect(deeds).toContain('class="deed-heraldry-preview-ribbon deed-heraldry-plaque"');
    expect(deeds).toContain('class="deed-heraldry-preview-header deed-heraldry-plaque"');
    expect(deeds).not.toContain(
      'class="deed-heraldry-preview-header deed-heraldry-plaque deed-heraldry-plaque-mirror"',
    );
  });

  it('binds CSS clip paths to the pure silhouette authority and stays static and sprite-free', () => {
    const components = read('src/styles/components.css');
    const selectors = {
      compact: '.deed-heraldry-plaque',
      mirror: '.deed-heraldry-plaque-mirror',
      ceremonial: '.deed-heraldry-plaque-ceremonial',
      tab: '.deed-heraldry-plaque-tab',
    } as const;
    for (const [shape, selector] of Object.entries(selectors)) {
      const escaped = selector.replaceAll('.', '\\.');
      const rule = components.match(new RegExp(`\\n {2}${escaped} \\{([\\s\\S]*?)\\n {2}\\}`))?.[1];
      const clip = rule?.match(/--deed-heraldry-plaque-clip:\s*(polygon\([\s\S]*?\));/)?.[1];
      expect(clip, `${shape} CSS plaque clip path`).toBeTruthy();
      expect(clip?.replace(/\s/g, '')).toBe(
        DEED_HERALDRY_PLAQUE_CLIP_PATHS[shape as keyof typeof selectors].replace(/\s/g, ''),
      );
    }
    const cssFamily = [components, read('src/styles/hud.css'), read('src/styles/shell.css')]
      .flatMap((css) =>
        [
          ...css.matchAll(
            /[^{}]*(?:deed-heraldry-plaque|inspect-heraldry-banner|uf-name-header|deed-heraldry-preview-(?:ribbon|header))[^{}]*\{[^{}]*\}/g,
          ),
        ].map((match) => match[0]),
      )
      .join('\n');
    const family = `${read('src/ui/deed_heraldry_plaque_core.ts')}\n${cssFamily}`;
    expect(family).not.toMatch(/url\(|\.png|\.webp|\.jpg|filter:|backdrop-filter:/);
    expect(family).not.toMatch(/animation:|@keyframes|transition:/);
  });

  it('tools every cold plaque with two rivets, restrained grain, and an inset keyline', () => {
    const components = read('src/styles/components.css');
    const face = components.match(
      /\.deed-heraldry-plaque\[data-border\]:not\(\[data-border=""\]\)::before,[\s\S]*?\{([^}]*)\}/,
    )?.[1];
    const keyline = components.match(
      /\.deed-heraldry-plaque\[data-border\]:not\(\[data-border=""\]\)::after,[\s\S]*?\{([^}]*)\}/,
    )?.[1];
    expect(face, 'shared plaque material face missing').toBeTruthy();
    expect(face?.match(/radial-gradient\(/g) ?? []).toHaveLength(2);
    expect(face).toMatch(/radial-gradient\(\s*circle at 7px 50%/);
    expect(face).toMatch(/radial-gradient\(\s*circle at calc\(100% - 7px\) 50%/);
    expect(face).toMatch(
      /repeating-linear-gradient\(\s*135deg,\s*transparent 0 5px,\s*color-mix\(in srgb, var\(--border-accent-edge, transparent\) 8%, transparent\) 5px 6px/s,
    );
    expect(keyline, 'shared plaque inner keyline missing').toBeTruthy();
    expect(keyline).toContain('inset: 3px;');
    expect(keyline).toContain('clip-path: var(--deed-heraldry-plaque-clip);');
    expect(keyline).toContain('border: 1px solid');
    expect(keyline).not.toMatch(/width:|height:|border-radius: 50%|translateY/);
    const sealFinish = components.match(/\n {2}\.deed-heraldry-seal::after \{([^}]*)\}/)?.[1];
    expect(sealFinish, 'shared seal finishing ring missing').toBeTruthy();
    expect(sealFinish).toContain('position: absolute;');
    expect(sealFinish).toContain('inset: 5px;');
    expect(sealFinish).toContain('border-top: 1px solid');
    expect(sealFinish).toContain('border-bottom: 1px solid');
    expect(sealFinish).toContain('border-radius: 50%;');
    const tab = components.match(/\n {2}\.deed-heraldry-plaque-tab \{([^}]*)\}/)?.[1];
    expect(tab).toContain('--deed-heraldry-plaque-rivet-edge: transparent;');
    expect(tab).toContain('--deed-heraldry-plaque-rivet-frame: transparent;');
  });

  it('gives interaction plaques a mirrored 2px seal gap and centers the identity line', () => {
    const hud = read('src/styles/hud.css');
    const header = hud.match(
      /\n {2}\.uf-name-header\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    const name = hud.match(
      /\n {2}\.uf-name-header\[data-border\]:not\(\[data-border=""\]\) \.uf-name \{([^}]*)\}/,
    )?.[1];
    const motif = hud.match(
      /\n {2}\.uf-name-header\[data-border\]:not\(\[data-border=""\]\) \.deed-heraldry-pattern \{([^}]*)\}/,
    )?.[1];
    const mirror = hud.match(
      /\n {2}\.uf-name-header\.deed-heraldry-plaque-mirror\[data-border\]:not\(\[data-border=""\]\) \{([^}]*)\}/,
    )?.[1];
    expect(header).toContain('width: calc(100% - 2px);');
    expect(header).toContain('margin-left: 2px;');
    expect(mirror).toContain('margin-right: 2px;');
    expect(mirror).toContain('margin-left: 0;');
    expect(name).toContain('text-align: center;');
    expect(motif).toContain('top: 50%;');
    expect(motif).toContain('transform: translateY(-50%);');
  });

  it('keeps both Book previews centered and gives each seal a protected plaque gap', () => {
    const components = read('src/styles/components.css');
    const previewRows = components.match(
      /\n {2}\.deed-heraldry-preview-world,\n {2}\.deed-heraldry-preview-interaction \{([^}]*)\}/,
    )?.[1];
    const worldPlaque = components.match(/\n {2}\.deed-heraldry-preview-ribbon \{([^}]*)\}/)?.[1];
    const interactionPlaque = components.match(
      /\n {2}\.deed-heraldry-preview-header \{([^}]*)\}/,
    )?.[1];
    const interactionMotif = components.match(
      /\n {2}\.deed-heraldry-preview-header \.deed-heraldry-pattern \{([^}]*)\}/,
    )?.[1];
    expect(previewRows, 'shared preview centering rule missing').toBeTruthy();
    expect(previewRows).toContain('display: flex;');
    expect(previewRows).toContain('align-items: center;');
    expect(worldPlaque).toContain('margin-left: 2px;');
    expect(interactionPlaque).toContain('margin-left: 2px;');
    expect(interactionMotif).toContain('top: 50%;');
    expect(interactionMotif).toContain('transform: translateY(-50%);');
  });

  it('gives the Book preview enough width to show each reward scale without compression', () => {
    const components = read('src/styles/components.css');
    const preview = components.match(/\n {2}\.deed-heraldry-preview \{([^}]*)\}/)?.[1];
    const rows = components.match(
      /\n {2}\.deed-heraldry-preview-world,\n {2}\.deed-heraldry-preview-interaction \{([^}]*)\}/,
    )?.[1];
    const worldPlaque = components.match(/\n {2}\.deed-heraldry-preview-ribbon \{([^}]*)\}/)?.[1];
    const interactionPlaque = components.match(
      /\n {2}\.deed-heraldry-preview-header \{([^}]*)\}/,
    )?.[1];
    const swatch = components.match(/\n {2}\.deed-border-swatch \{([^}]*)\}/)?.[1];
    const swatchSeal = components.match(
      /\n {2}\.deed-border-swatch \.deed-heraldry-seal \{([^}]*)\}/,
    )?.[1];
    const material = components.match(/\n {2}\.deed-border-material \{([^}]*)\}/)?.[1];
    const materialMotif = components.match(
      /\n {2}\.deed-border-material \.deed-heraldry-pattern \{([^}]*)\}/,
    )?.[1];
    const previewPortrait = components.match(
      /\n {2}\.deed-heraldry-preview-portrait \{([^}]*)\}/,
    )?.[1];
    expect(preview).toContain('grid-template-columns: 1fr;');
    expect(rows).toContain('justify-content: center;');
    expect(worldPlaque).toContain('max-width: 220px;');
    expect(interactionPlaque).toContain('flex: 0 1 260px;');
    expect(interactionPlaque).toContain('max-width: 260px;');
    expect(swatch).toContain('width: 60px;');
    expect(swatch).toContain('height: 28px;');
    expect(swatchSeal).toContain('width: 28px;');
    expect(swatchSeal).toContain('height: 28px;');
    expect(material).toContain('height: 18px;');
    expect(materialMotif).toContain('width: 32px;');
    expect(materialMotif).toContain('height: 32px;');
    expect(previewPortrait).toContain('background: var(--deed-heraldry-well, var(--panel-bg));');
    expect(previewPortrait).toContain(
      'inset 0 0 0 2px color-mix(in srgb, var(--border-accent-edge, transparent) 72%, transparent)',
    );
  });
});
