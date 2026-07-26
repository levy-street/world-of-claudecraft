import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const hudMobileCss = readFileSync(
  new URL('../src/styles/hud.mobile.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const tokensCss = readFileSync(
  new URL('../src/styles/tokens.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const playHtml = readFileSync(new URL('../play.html', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);

describe('unit frame visual identity', () => {
  it('uses the hostile palette for a healthy enemy target instead of player green', () => {
    expect(hudCss).toMatch(
      /#target-frame\.hostile\.health-healthy \.hp \.bar-fill,[\s\S]*?--hp-state-color: color-mix\(in srgb, var\(--color-hostile\)/,
    );
    expect(hudCss).toMatch(
      /#target-frame\.hostile \.uf-bars \{[\s\S]*?border-color: color-mix\(in srgb, var\(--color-hostile\)/,
    );
    expect(hudCss).toContain('#target-frame.hostile .uf-name::before {');
  });

  it('keeps the player shell on a separate gold and cool-material language', () => {
    expect(hudCss).toMatch(
      /#player-frame \.uf-bars \{[\s\S]*?var\(--gold-dim\)[\s\S]*?var\(--color-mana\)/,
    );
    expect(hudCss).toMatch(/#player-frame \.portrait-wrap #xpbar::before \{[\s\S]*?#f6e3a1/);
  });

  it('marks self-targeting on the player frame instead of duplicating it', () => {
    expect(hudTs).toContain('const targetPresentation = unitTargetPresentation(target, p.id);');
    expect(hudTs).toContain("this.toggleClass(this.playerFrameEl, 'self-targeted'");
    expect(hudTs).toContain("if (target && targetPresentation === 'unit') {");
    expect(hudCss).toMatch(
      /#player-frame\.self-targeted \.uf-bars \{[\s\S]*?border-color: var\(--gold\)/,
    );
    expect(hudCss).toMatch(
      /#player-frame\.self-targeted \.uf-bars::after \{[\s\S]*?transform: rotate\(45deg\)/,
    );
  });

  it('presents target-of-target as a compact clickable satellite with a self cue', () => {
    expect(hudTs).toContain('targetOfTargetSubject(target');
    expect(hudTs).toContain('this.targetOfTargetPainter.paint(');
    expect(hudTs).toContain('this.sim.targetEntity(this.targetOfTargetEntityId);');
    expect(hudCss).toMatch(/\.tf-target-target \{[\s\S]*?left: calc\(100% \+ 7px\)/);
    expect(hudCss).toContain('.tf-target-target.is-self {');
    expect(hudMobileCss).toContain('body.mobile-touch .tf-target-target {');
    expect(hudTs).toContain("settings.get('showTargetOfTarget')");
  });

  it('adds structural threat, quest, and connection states to the target frame', () => {
    expect(hudTs).toContain('const threatState = unitThreatState(target, p.id);');
    expect(hudTs).toContain("'threat-high'");
    expect(hudTs).toContain("'target-quest'");
    expect(hudTs).toContain("'target-disconnected'");
    expect(hudCss).toContain('#target-frame.threat-aggro .tf-threat-indicator {');
    expect(hudCss).toContain('#target-frame.target-quest .uf-status-icon.quest {');
  });

  it('keeps frame movement affordances quiet until the frame is inspected', () => {
    expect(hudCss).toMatch(/\.unitframe \.tf-move-btn \{[\s\S]*?opacity: 0\.14;/);
    expect(hudCss).toMatch(/\.unitframe:hover \.tf-move-btn \{\s*opacity: 0\.62;/);
  });

  it('centers the desktop pair on one baseline with a compact visual gap', () => {
    expect(hudCss).toMatch(
      /#ui:has\(#target-frame:not\(\.unitframe-absent\)\)\s*#player-frame:not\(\.pf-detached\) \{\s*left: -143px;/,
    );
    expect(hudCss).toMatch(
      /#target-frame \{[\s\S]*?left: calc\(50% \+ 18px\);[\s\S]*?bottom: 76px;/,
    );
    expect(hudCss).toMatch(/body\.show-actionbar2 #target-frame \{\s*bottom: 134px;/);
    expect(hudCss).toMatch(
      /#player-frame #stancebar \{[\s\S]*?position: absolute;[\s\S]*?bottom: calc\(100% \+ 16px\);[\s\S]*?left: 50%;[\s\S]*?padding: 2px;/,
    );
    expect(hudCss).toMatch(
      /\.stance-btn \{[\s\S]*?width: 24px;[\s\S]*?height: 24px;[\s\S]*?box-sizing: border-box;/,
    );
    expect(hudTs).not.toContain("document.body.classList.toggle('show-stancebar'");
  });

  it('recenters the docked player frame when the target is absent', () => {
    expect(hudCss).toMatch(/#player-frame \{[\s\S]*?left: 0;/);
    expect(hudCss).toMatch(/#player-frame \{[\s\S]*?transition: left var\(--dur-fast\) ease-out;/);
  });

  it('gives buffs, player debuffs, and target auras distinct premium rows', () => {
    expect(hudCss).toContain('#player-frame > #buff-bar .buff {');
    expect(hudCss).toContain('#player-frame > #debuff-bar .buff {');
    expect(hudCss).toMatch(
      /#player-frame > #buff-bar \{[\s\S]*?border: 1px solid color-mix\(in srgb, var\(--color-buff\)/,
    );
    expect(hudCss).toMatch(
      /#player-frame > #debuff-bar \{[\s\S]*?border: 1px solid color-mix\(in srgb, var\(--color-debuff\)/,
    );
    expect(tokensCss).toContain('--color-buff: #3f9f5f;');
    expect(hudCss).not.toMatch(/color-mix\([^)]*var\(--panel-bg\)/);
    expect(hudCss).toContain('#target-frame > #tf-buffs {');
    expect(hudCss).toContain('#target-frame > #tf-debuffs {');
    expect(hudCss).toContain('.buff.timed::before {');
    expect(hudCss).toContain('.buff.expiring {');
    expect(hudCss).toContain('.aura-overflow {');
  });

  it('keeps desktop player auras directly above the health-bar content', () => {
    expect(hudCss).toMatch(
      /#player-frame > #buff-bar,[\s\S]*?#player-frame > #debuff-bar \{[\s\S]*?left: 80px;[\s\S]*?max-width: 199px;/,
    );
    expect(hudMobileCss).toMatch(
      /body\.mobile-touch #player-frame > #buff-bar,[\s\S]*?body\.mobile-touch #player-frame > #debuff-bar \{[\s\S]*?left: 80px;[\s\S]*?max-width: calc\(100% - 80px\);/,
    );
    expect(hudCss).not.toContain('#player-frame.pf-detached > #buff-bar');
    expect(hudCss).not.toContain('#player-frame.pf-detached > #debuff-bar');
  });

  it('keeps player buffs and debuffs anchored to the HP frame on touch layouts', () => {
    const structuralAuraRows =
      /<div id="buff-bar"><\/div>\n\s*<div id="debuff-bar"><\/div>\n\s*<\/div>\n\s*<div id="petbar"/;
    expect(indexHtml).toMatch(structuralAuraRows);
    expect(playHtml).toMatch(structuralAuraRows);
    expect(hudTs).not.toContain('setAurasOnPlayerFrame');
    expect(hudMobileCss).toContain('body.mobile-touch #player-frame > #buff-bar,');
    expect(hudMobileCss).toMatch(
      /body\.mobile-touch #player-frame > #debuff-bar \{[\s\S]*?transform: none;/,
    );
  });

  it('uses beveled portrait plates and makes XP their player-only perimeter', () => {
    expect(hudCss).toMatch(/\.portrait \{[\s\S]*?border-radius: 10px;/);
    expect(hudCss).toMatch(/\.portrait canvas \{[\s\S]*?border-radius: 7px;/);
    expect(hudCss).toContain('#player-frame .portrait-wrap #xpbar {');
    expect(hudCss).toContain('#player-frame .portrait-wrap #xpbar::before {');
    expect(hudCss).toContain('--xp-rested-end: 0;');
    expect(hudCss).not.toMatch(/#xpbar \{\s*width: 612px;/);
  });

  it('supports contextual portrait materials and capped heavy-hit reactions', () => {
    expect(hudTs).toContain('private readonly portraitPlans = new UnitPortraitPlanCache();');
    expect(hudTs).toContain('const playerPortrait = this.portraitPlans.plan(p);');
    expect(hudCss).toContain('.unitframe.portrait-ghost .portrait canvas {');
    expect(hudCss).toContain('.hp.health-damage-heavy-a::after {');
    expect(hudCss).toContain('body.unit-frame-portrait-effects-off .unitframe .portrait');
    expect(hudCss).toContain('body.unit-frame-damage-trail-off .unitframe .bar-health-trail');
  });

  it('uses a restrained heal glint instead of flashing the whole health bar white', () => {
    expect(hudCss).toMatch(
      /@keyframes unit-health-heal-a \{[\s\S]*?opacity: 0\.42;[\s\S]*?linear-gradient\([\s\S]*?background-position: 100% 0;[\s\S]*?background-position: -100% 0;/,
    );
    expect(hudCss).not.toContain('background: var(--color-health-heal);');
    expect(hudCss).toMatch(
      /@keyframes unit-portrait-heal \{[\s\S]*?var\(--color-hp\) 42%[\s\S]*?0 0 7px/,
    );
  });
});
