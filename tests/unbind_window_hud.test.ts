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
  return hudSource.slice(start, end);
}

describe('hud.ts unbindResult event arm (source pins)', () => {
  it('logs the unbound line on ok and maps the deny reasons to unbind keys', () => {
    const arm = unbindResultArm();
    expect(arm).toContain("t('hudChrome.unbind.unbound'");
    for (const key of [
      'hudChrome.unbind.notEligible',
      'hudChrome.unbind.notBound',
      'hudChrome.unbind.cannotAfford',
      'hudChrome.unbind.outOfRange',
    ]) {
      expect(arm, key).toContain(key);
    }
    for (const reason of ['unbind_not_eligible', 'unbind_not_bound', 'unbind_cannot_afford']) {
      expect(arm, reason).toContain(reason);
    }
  });

  it('pairs each deny reason with ITS OWN key (a key swap in the chain must fail here)', () => {
    // Presence pins alone cannot catch two keys swapped inside the ternary
    // chain, so pin each reason-to-key pairing. unbind_out_of_range is
    // deliberately the fallback arm (its literal never appears in hud.ts), so
    // its pairing is pinned as the else branch of the cannotAfford arm.
    const arm = unbindResultArm();
    expect(arm).toMatch(/'unbind_not_eligible'\s*\?\s*'hudChrome\.unbind\.notEligible'/);
    expect(arm).toMatch(/'unbind_not_bound'\s*\?\s*'hudChrome\.unbind\.notBound'/);
    expect(arm).toMatch(
      /'unbind_cannot_afford'\s*\?\s*'hudChrome\.unbind\.cannotAfford'\s*:\s*'hudChrome\.unbind\.outOfRange'/,
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
    expect(arm).not.toMatch(/showBanner|showToast|this\.audio|playSfx|playCue|celebrat/i);
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
    expect(hudSource).toContain('this.sim.craftItem(recipeId, commission);');
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
    const arm = hudSource.slice(start, start + 600);
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
