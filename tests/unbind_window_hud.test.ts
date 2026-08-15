// Source pins over the Hud's Maker's Bond integration (the
// train_window_hud.test.ts style: the wiring lives in the hud.ts coordinator,
// so these pin the load-bearing snippets instead of booting the whole Hud):
//  - the unbindResult event arm logs exactly one localized line per outcome,
//    with NO banner/toast/audio (the trainResult single-surface rule), maps
//    every deny reason to ITS OWN key, and repaints the unbind window + bags
//    (the single-copy unbind clears boundTo in place with no loot event);
//  - the commission opt-in is a ONE-SHOT per-craft Set: onCraft consumes via
//    delete (a regression to has() would arm EVERY later craft), the checkbox
//    reads via has, and closing the crafting window clears every armed row;
//  - the unbind window wires gossip -> openUnbind and the fee-confirm dialog
//    to the IWorld seam (sim.unbindItem), never deciding the outcome locally;
//  - both HTML entries declare the #unbind-window container.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hudSource = readFileSync(resolve(__dirname, '../src/ui/hud.ts'), 'utf8');

function unbindResultArm(): string {
  const start = hudSource.indexOf("case 'unbindResult': {");
  // The arm sits between trainResult and masterwork in drainEvents; slicing
  // to the NEXT case keeps the single-surface pins scoped to this arm alone
  // (a future arm inserted between them must update this anchor).
  const end = hudSource.indexOf("case 'masterwork': {", start);
  expect(start, 'unbindResult case arm present in handleEvents').toBeGreaterThan(-1);
  expect(end, 'unbindResult arm precedes the masterwork arm').toBeGreaterThan(start);
  // Comments stripped from the slice (`://` protocol slashes preserved), the
  // repo's raw-source-pin idiom (the codeOnly helper in
  // tests/professions_silent_loot.test.ts). This arm's whole subject is what
  // it deliberately does NOT do, so the odds of a future comment NAMING a cue
  // or a toast here are high, and it would turn the negative pins below red
  // for the wrong reason; on the other side a commented-out key would satisfy
  // the positive pins.
  return hudSource
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('hud.ts unbindResult event arm (source pins)', () => {
  it('logs the unbound line on ok and maps the deny reasons to unbind keys', () => {
    const arm = unbindResultArm();
    expect(arm).toContain("t('hudChrome.unbind.unbound'");
    for (const key of [
      'hudChrome.unbind.notEligible',
      'hudChrome.unbind.notBound',
      'hudChrome.unbind.cannotAfford',
      'hudChrome.unbind.noSpace',
      'hudChrome.unbind.outOfRange',
    ]) {
      expect(arm, key).toContain(key);
    }
    for (const reason of [
      'unbind_not_eligible',
      'unbind_not_bound',
      'unbind_cannot_afford',
      'unbind_no_space',
    ]) {
      expect(arm, reason).toContain(reason);
    }
  });

  it('pairs each deny reason with ITS OWN key (a key swap in the chain must fail here)', () => {
    // Presence pins alone cannot catch two keys swapped inside the ternary
    // chain, so pin each reason-to-key pairing. unbind_out_of_range is
    // deliberately the fallback arm (its literal never appears in hud.ts), so
    // its pairing is pinned as the else branch of the unbind_no_space arm.
    const arm = unbindResultArm();
    expect(arm).toMatch(/'unbind_not_eligible'\s*\?\s*'hudChrome\.unbind\.notEligible'/);
    expect(arm).toMatch(/'unbind_not_bound'\s*\?\s*'hudChrome\.unbind\.notBound'/);
    expect(arm).toMatch(/'unbind_cannot_afford'\s*\?\s*'hudChrome\.unbind\.cannotAfford'/);
    expect(arm).toMatch(
      /'unbind_no_space'\s*\?\s*'hudChrome\.unbind\.noSpace'\s*:\s*'hudChrome\.unbind\.outOfRange'/,
    );
  });

  it('derives the item name from static content and formats the fee locally (text-free event)', () => {
    const arm = unbindResultArm();
    expect(arm).toContain('ITEMS[ev.itemId]');
    expect(arm).toContain('itemDisplayName');
    expect(arm).toContain('formatLocalizedMoney(ev.fee)');
  });

  it('stays single-surface: chat log only, no banner, toast, or audio cue in the arm', () => {
    const arm = unbindResultArm();
    expect(arm.match(/this\.log\(/g)?.length, 'exactly the ok + deny log call sites').toBe(2);
    // ALLOWLIST, not a blocklist, and that is the whole point. This pin spent
    // two rounds losing an arms race it could not win: it began as an
    // alternation of this.audio / playSfx / playCue / showToast, all four of
    // which occur ZERO times in hud.ts (showToast occurs nowhere in src/ at
    // all), so it enforced only its banner clause and a real cue added here
    // would have passed the whole repo. Naming the live idioms instead just
    // moved the goalposts: hud.ts reaches sound through audio.<cue>(, and
    // sfx.playUi( / playAt( / crowdRoar( / unloop( / loop( / goalHorn(, and
    // voice.play(, and three private wrappers of its own (this.combat, a
    // route straight onto sfx.playAt, plus playEventSfx and
    // playAttackerSfx); its out-of-chat surfaces run to showBanner,
    // showError (itself BOTH a toast and a cue, since it calls audio.error),
    // showPrompt, showSelfNote, showSubzone, confirmDialog, inputDialog,
    // combatLog and flashActionSlot. Neither list is closed, and that is the
    // point: every enumeration of them was one idiom short of the next one
    // somebody adds.
    //
    // So enumerate what the arm IS instead. Its entire method surface is
    // three calls, and #2458 made "one chat line and nothing else" the
    // load-bearing contract on BOTH unbind arms, so anything a contributor
    // adds here has to show up in this list and be argued for by name.
    const selfCalls = [...new Set(arm.match(/\bthis\.\w+\(/g) ?? [])].sort();
    expect(selfCalls, 'the arm calls nothing but the chat line and the two repaints').toEqual([
      'this.log(',
      'this.renderBags(',
      'this.renderUnbind(',
    ]);
    // The allowlist cannot see a call with no `this.` receiver, which is
    // exactly how every module-level cue is spelled, so the receiver pin
    // stays as its complement. Between them: no bare audio/sfx/voice call,
    // and no method of the Hud beyond the three named above.
    expect(arm).not.toMatch(/\b(audio|sfx|voice)\.\w+\(/);
  });

  it('renders nothing for a reason-less deny (the silent malformed-item-id arm)', () => {
    const arm = unbindResultArm();
    expect(arm).toContain('else if (ev.reason)');
  });

  it('repaints the open unbind window AND the open bags (no loot event repaints for us)', () => {
    const arm = unbindResultArm();
    expect(arm).toContain('this.renderUnbind();');
    expect(arm).toContain('this.renderBags();');
    expect(arm).toContain("$('#unbind-window').style.display === 'block'");
    expect(arm).toContain("$('#bags').style.display !== 'none'");
  });
});

describe('hud.ts commission opt-in state contract (source pins)', () => {
  it('onCraft consumes the opt-in as a ONE-SHOT delete, never a persistent read', () => {
    // The load-bearing line: delete() both reads AND clears the armed flag,
    // so the checkbox arms exactly one craft. A regression to has() would
    // silently arm every subsequent craft of that recipe and no sim-side pin
    // could catch it (the sim honors whatever flag arrives).
    expect(hudSource).toContain('const commission = this.craftCommissionOptIn.delete(recipeId);');
    expect(hudSource).toContain(
      'this.sim.craftItem(recipeId, commission, Math.max(1, Math.floor(count)));',
    );
  });

  it('the checkbox paints from has() and toggles through add/delete', () => {
    expect(hudSource).toContain(
      'commissionChecked: (recipeId) => this.craftCommissionOptIn.has(recipeId)',
    );
    expect(hudSource).toContain('if (on) this.craftCommissionOptIn.add(recipeId);');
    expect(hudSource).toContain('else this.craftCommissionOptIn.delete(recipeId);');
  });

  it('closing the crafting window drops every armed checkbox (the off-by-default rule)', () => {
    const start = hudSource.indexOf('closeCrafting(): void {');
    expect(start).toBeGreaterThan(-1);
    // Anchor on the METHOD BODY (brace depth), not a fixed byte count: a
    // fixed slice went stale the moment closeCrafting grew unrelated lines.
    let depth = 0;
    let end = start;
    for (let i = hudSource.indexOf('{', start); i < hudSource.length; i++) {
      if (hudSource[i] === '{') depth++;
      else if (hudSource[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const arm = hudSource.slice(start, end);
    expect(arm).toContain('this.craftCommissionOptIn.clear();');
  });
});

describe('hud.ts unbind window wiring (source pins)', () => {
  it('gossip routes to openUnbind and the confirm dialog sends the command to the seam', () => {
    expect(hudSource).toContain('openUnbind: (npcId) => this.openUnbind(npcId)');
    expect(hudSource).toContain("this.closeOtherWindows('#unbind-window')");
    expect(hudSource).toContain("t('hudChrome.unbind.confirmTitle')");
    expect(hudSource).toContain('() => this.sim.unbindItem(itemId),');
  });
});

describe('#unbind-window container exists in both HTML entries', () => {
  it('index.html and play.html both declare the unbind window panel', () => {
    for (const entry of ['index.html', 'play.html']) {
      const html = readFileSync(resolve(__dirname, '..', entry), 'utf8');
      expect(html, entry).toContain('id="unbind-window"');
      const tag = html.match(/<div[^>]*id="unbind-window"[^>]*>/)?.[0] ?? '';
      expect(tag, `${entry} unbind window is a .window.panel container`).toMatch(
        /class="[^"]*window[^"]*panel[^"]*"/,
      );
    }
  });
});
