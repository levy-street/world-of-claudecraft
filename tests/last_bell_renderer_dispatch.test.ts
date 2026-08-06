import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

function objectBranch(templateId: string, nextTemplateId: string): string {
  const start = source.indexOf(`e.templateId === '${templateId}'`);
  const end = source.indexOf(`e.templateId === '${nextTemplateId}'`, start + 1);
  if (start < 0 || end < 0) throw new Error(`missing renderer branch ${templateId}`);
  return source.slice(start, end);
}

describe('Last Bell renderer object dispatch', () => {
  it('keeps the ferry marker on its bespoke non-interactive builder', () => {
    const branch = objectBranch('lb_ferry', 'lb_scenario_door');
    expect(branch).toContain('buildFerryMooring(e.id)');
    expect(branch).toContain('objectMesh = body;');
    expect(branch).not.toContain('attachInteractSparkle');
    expect(branch).not.toContain('takeOrBuildGroundObject');
  });

  it('keeps the scenario door bespoke and visibly interactive', () => {
    const branch = objectBranch('lb_scenario_door', 'lb_breach_maw');
    expect(branch).toContain('buildScenarioDoor(e.id)');
    expect(branch).toContain('sparkle = this.attachInteractSparkle(group)');
    expect(branch).not.toContain('takeOrBuildGroundObject');
  });

  it('keeps the breach on its portal builder without an interaction sparkle', () => {
    const branch = objectBranch('lb_breach_maw', 'noticeboard_eastbrook');
    expect(branch).toContain('buildBreachMaw(this.lowGfx)');
    expect(branch).toContain('portal = built.portal');
    expect(branch).not.toContain('attachInteractSparkle');
    expect(branch).not.toContain('takeOrBuildGroundObject');
  });
});
