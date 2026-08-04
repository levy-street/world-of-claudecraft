// Source pins over the Hud's recipe-training integration (the
// craft_celebration/log_event_route source-scan style: the wiring lives in
// the hud.ts coordinator, so these pin the load-bearing snippets instead of
// booting the whole Hud):
//  - the trainResult event arm logs exactly one localized line per outcome,
//    with NO banner/toast/audio (the grant-hub double-log trap), derives the
//    tier threshold from static content, and repaints both open windows;
//  - renderCrafting filters the recipe list to KNOWN recipes through the
//    SHARED isRecipeKnownForViewer predicate before buildCraftingView;
//  - the train window wires the pure view core to the IWorld seam
//    (identity.knownRecipes in, sim.trainRecipe out);
//  - both HTML entries declare the #train-window container.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hudSource = readFileSync(resolve(__dirname, '../src/ui/hud.ts'), 'utf8');

function trainResultArm(): string {
  const start = hudSource.indexOf("case 'trainResult': {");
  // The unbindResult arm sits between trainResult and
  // masterwork; the slice ends at the NEXT case so the single-surface pins
  // below stay scoped to the trainResult arm alone.
  const end = hudSource.indexOf("case 'unbindResult': {", start);
  expect(start, 'trainResult case arm present in handleEvents').toBeGreaterThan(-1);
  expect(end, 'trainResult arm precedes the unbindResult arm').toBeGreaterThan(start);
  return hudSource.slice(start, end);
}

describe('hud.ts trainResult event arm (source pins)', () => {
  it('logs the learned line on ok and maps all five deny reasons to training keys', () => {
    const arm = trainResultArm();
    expect(arm).toContain("t('hudChrome.training.learned'");
    for (const key of [
      'hudChrome.training.tierUnmet',
      'hudChrome.training.cannotAfford',
      'hudChrome.training.notTaughtHere',
      'hudChrome.training.alreadyKnown',
      'hudChrome.training.outOfRange',
    ]) {
      expect(arm, key).toContain(key);
    }
    for (const reason of [
      'train_tier_unmet',
      'train_cannot_afford',
      'train_not_taught_here',
      'train_already_known',
    ]) {
      expect(arm, reason).toContain(reason);
    }
  });

  it('pairs each deny reason with ITS OWN key (a key swap in the chain must fail here)', () => {
    // The presence pins above cannot catch two keys swapped inside the ternary
    // chain (all five keys and four reason literals would still be present), so
    // pin each reason-to-key pairing. train_out_of_range is deliberately the
    // fallback arm (its literal never appears in hud.ts), so its pairing is
    // pinned as the else branch of the alreadyKnown arm.
    const arm = trainResultArm();
    expect(arm).toMatch(/'train_tier_unmet'\s*\?\s*t\('hudChrome\.training\.tierUnmet'/);
    expect(arm).toMatch(/'train_cannot_afford'\s*\?\s*'hudChrome\.training\.cannotAfford'/);
    expect(arm).toMatch(/'train_not_taught_here'\s*\?\s*'hudChrome\.training\.notTaughtHere'/);
    expect(arm).toMatch(
      /'train_already_known'\s*\?\s*'hudChrome\.training\.alreadyKnown'\s*:\s*'hudChrome\.training\.outOfRange'/,
    );
  });

  it('derives the tierUnmet craft and threshold from recipeId plus static content', () => {
    const arm = trainResultArm();
    // The event is text-free: the threshold is tier * step from the recipe
    // record, localized craft name via the craft-name helper.
    expect(arm).toContain('tierForSkill');
    expect(arm).toContain('TIER_SKILL_STEP');
    expect(arm).toContain('craftNameText');
    expect(arm).toContain('formatNumber');
  });

  it('stays single-surface: chat log only, no banner, toast, or audio cue in the arm', () => {
    const arm = trainResultArm();
    expect(arm.match(/this\.log\(/g)?.length, 'exactly the ok + deny log call sites').toBe(2);
    expect(arm).not.toMatch(/showBanner|showToast|this\.audio|playSfx|playCue|celebrat/i);
  });

  it('renders nothing for a reason-less deny (the malformed-recipe-id probe arm)', () => {
    const arm = trainResultArm();
    // resolveTrain's silent arm emits ok:false with reason undefined; the deny
    // log call must be guarded on ev.reason so that arm stays render-free.
    expect(arm).toContain('else if (ev.reason)');
  });

  it('repaints the open train window AND the open crafting window', () => {
    const arm = trainResultArm();
    expect(arm).toContain('this.renderTrain();');
    expect(arm).toContain('this.renderCrafting();');
    expect(arm).toContain("$('#crafting-window').style.display === 'flex'");
  });

  it('resolves the learn flight from the event, ok or deny (issue #2342)', () => {
    // resolve() closes the pending flight either way and feeds the confirmed
    // overlay on ok, so the repaint below reads Known even when the cprof
    // mirror has not caught up yet. It must run BEFORE the renderTrain
    // repaint, or the repaint paints the stale pending row.
    const arm = trainResultArm();
    const resolveAt = arm.indexOf('this.trainLearns.resolve(ev.recipeId, ev.ok);');
    expect(resolveAt, 'resolve call present in the arm').toBeGreaterThan(-1);
    expect(resolveAt).toBeLessThan(arm.indexOf('this.renderTrain();'));
  });
});

describe('hud.ts crafting known-filter (source pins)', () => {
  it('filters the recipe list through the SHARED viewer predicate before the view build', () => {
    // Deliberate re-pin: the filter must delegate to the one
    // isRecipeKnownForViewer helper the train ladder also uses, never an
    // inline restatement the two windows could let drift apart.
    expect(hudSource).toContain('const knownRecipes = this.sim.recipeList.filter((recipe) =>');
    expect(hudSource).toContain('isRecipeKnownForViewer(recipe, knownRecipeIds)');
    expect(hudSource).toContain('new Set(this.sim.craftingIdentity.knownRecipes)');
    expect(hudSource).toMatch(
      /import \{ buildTrainView, isRecipeKnownForViewer \} from '\.\/hud\/vendor\/train_view';/,
    );
  });
});

describe('hud.ts train window wiring (source pins)', () => {
  it('feeds the pure view core from the IWorld identity mirror and routes trains to the seam', () => {
    expect(hudSource).toContain('knownRecipes: identity.knownRecipes');
    expect(hudSource).toContain('onTrain: (recipeId) => this.trainRecipeClicked(recipeId)');
    expect(hudSource).toContain("this.closeOtherWindows('#train-window')");
  });

  it('opens the learn flight BEFORE the command leaves and repaints immediately (issue #2342)', () => {
    // begin() false swallows the activation, so a rapid double-click sends
    // train_recipe exactly once and train_already_known can never surface
    // from the trainer window; the immediate renderTrain paints the disabled
    // pending row as the first click's feedback. The while-dead arm comes
    // FIRST: the sim's dead gate (src/sim/dead_gate.ts) refuses the command
    // with the shared error line and emits NO trainResult, so a flight
    // opened for it would only sit disabled until its TTL; the click still
    // sends, so the refusal line is the feedback.
    expect(hudSource).toMatch(
      /private trainRecipeClicked\(recipeId: string\): void \{\s*\n(\s*\/\/[^\n]*\n)*\s*if \(this\.sim\.player\.dead\) \{\s*\n\s*this\.sim\.trainRecipe\(recipeId\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*if \(!this\.trainLearns\.begin\(recipeId, performance\.now\(\)\)\) return;\s*\n\s*this\.sim\.trainRecipe\(recipeId\);\s*\n\s*this\.renderTrain\(\);/,
    );
    expect(hudSource).toMatch(
      /import \{ TrainLearnTracker \} from '\.\/hud\/vendor\/train_learn_core';/,
    );
  });

  it('feeds both tracker read surfaces into buildTrainView', () => {
    expect(hudSource).toContain('pendingRecipes: this.trainLearns.pendingIds(performance.now())');
    expect(hudSource).toContain(
      'confirmedRecipes: this.trainLearns.confirmedIds(identity.knownRecipes)',
    );
  });
});

describe('#train-window container exists in both HTML entries', () => {
  it('index.html and play.html both declare the train window panel', () => {
    for (const entry of ['index.html', 'play.html']) {
      const html = readFileSync(resolve(__dirname, '..', entry), 'utf8');
      expect(html, entry).toContain('id="train-window"');
      const tag = html.match(/<div[^>]*id="train-window"[^>]*>/)?.[0] ?? '';
      expect(tag, `${entry} train window is a .window.panel container`).toMatch(
        /class="[^"]*window[^"]*panel[^"]*"/,
      );
    }
  });
});
