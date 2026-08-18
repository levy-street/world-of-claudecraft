import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderContactSheetHtml } from '../scripts/lib/cinematic_contact_sheet_html_core.mjs';

describe('cinematic contact sheet HTML', () => {
  it('is byte-stable and renders the intent checklist for every still', () => {
    const input = {
      sceneId: 'scn_<review>',
      seed: 734_221,
      frames: [
        {
          file: 'frame_0000_target_2s.png',
          targetTime: 2,
          measuredTime: 2.05,
          windowStart: 0,
          windowEnd: 4,
          reasons: ['camera cut at 0s'],
          expectedSubjects: ['harbor_ship'],
          expectedTextKeys: ['lb.departure'],
        },
        {
          file: 'frame_0001_target_6_5s.png',
          targetTime: 6.5,
          measuredTime: 6.7,
          windowStart: 4,
          windowEnd: 9,
          reasons: ['camera cut at 4s'],
          expectedSubjects: [],
          expectedTextKeys: [],
        },
        {
          file: 'frame_after_scene_end.png',
          targetTime: 10,
          measuredTime: null,
          windowStart: 10,
          windowEnd: 10,
          reasons: ['after scene end'],
          expectedSubjects: [],
          expectedTextKeys: [],
        },
      ],
    };

    const first = renderContactSheetHtml(input);
    const second = renderContactSheetHtml(structuredClone(input));

    expect(first).toBe(second);
    expect(first).toContain('<h1>scn_&lt;review&gt;</h1>');
    expect(first).toContain('Target 2s');
    expect(first).toContain('Measured 2.05s');
    expect(first).toContain('harbor_ship');
    expect(first).toContain('lb.departure');
    expect(createHash('sha256').update(first).digest('hex')).toBe(
      '91483ad8b8f5fbc577528b2d8712ca8715f8c52b94ae04887c057c89d17ef651',
    );

    const figures = [...first.matchAll(/<figure>[\s\S]*?<\/figure>/g)].map((match) => match[0]);
    expect(figures).toHaveLength(3);
    for (const figure of figures) {
      expect(figure.match(/Named subject visible/g)).toHaveLength(1);
      expect(figure.match(/Expected text visible/g)).toHaveLength(1);
      expect(figure.match(/Frame differs from the previous one/g)).toHaveLength(1);
      expect(figure).toContain('Target ');
      expect(figure).toContain('Measured ');
    }
    expect(figures[1]).toContain('Target 6.5s');
    expect(figures[1]).toContain('Measured 6.7s');
    expect(figures[2]).toContain('Target 10s');
    expect(figures[2]).toContain('Measured not available');
  });
});
