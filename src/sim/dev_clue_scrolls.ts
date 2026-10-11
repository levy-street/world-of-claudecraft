// The `/dev clue` cheat family (ctx.devCommands-gated, routed from
// dev_commands.ts handleDevChat): the playtest shortcuts around Clue Scrolls
// (src/sim/clue_scrolls.ts) so a hunt can be driven without a day's board.
//   /dev clue                grants one Clue Scroll (the stack cap still holds)
//   /dev clue hunt <huntId>  starts that hunt directly (no scroll spent)
//   /dev clue solve          completes the active hunt's current step
//   /dev clue casket         grants one Treasure Casket
// Dev-channel text only ([dev] lines); nothing here is player copy.

import {
  activeCluePool,
  advanceClueHunt,
  canHoldAnotherClueScroll,
  clueHuntById,
  startClueHunt,
} from './clue_scrolls';
import {
  CLUE_SCROLL_ITEM_ID,
  CLUE_SCROLL_MIN_LEVEL,
  TREASURE_CASKET_ITEM_ID,
} from './content/clue_hunts';
import type { SimContext } from './sim_context';

function devLog(ctx: SimContext, pid: number, text: string): void {
  ctx.emit({ type: 'log', text, pid });
}

/** Handles one `/dev clue [verb] [arg]` line; `verb`/`arg` are already lower-cased/trimmed. */
export function handleDevClueCommand(
  ctx: SimContext,
  pid: number,
  verb: string,
  arg: string,
): void {
  if (!ctx.devCommands) return;
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (!meta || !player) return;
  if (verb === '') {
    if (!canHoldAnotherClueScroll(ctx, meta)) {
      ctx.error(pid, '[dev] You cannot hold another Clue Scroll.');
      return;
    }
    ctx.addItem(CLUE_SCROLL_ITEM_ID, 1, pid);
    devLog(ctx, pid, '[dev] Clue Scroll granted.');
    return;
  }
  if (verb === 'casket') {
    ctx.addItem(TREASURE_CASKET_ITEM_ID, 1, pid);
    devLog(ctx, pid, '[dev] Treasure Casket granted.');
    return;
  }
  if (verb === 'solve') {
    if (!meta.clueHunt) {
      ctx.error(pid, '[dev] No clue hunt is active.');
      return;
    }
    const step = meta.clueHunt.step;
    advanceClueHunt(ctx, meta);
    devLog(ctx, pid, `[dev] Clue step ${step + 1} solved.`);
    return;
  }
  if (verb === 'hunt') {
    const def = clueHuntById(arg);
    if (!def) {
      ctx.error(
        pid,
        `[dev] Unknown clue hunt "${arg}". Hunts: ${
          activeCluePool()
            .map((hunt) => hunt.id)
            .join(', ') || '(none)'
        }.`,
      );
      return;
    }
    // The landmark sweep rides the world-quest tick, which the level floor
    // gates, so a low-level tester is lifted to the scroll bracket first.
    if (player.level < CLUE_SCROLL_MIN_LEVEL) ctx.setPlayerLevel(CLUE_SCROLL_MIN_LEVEL, pid);
    startClueHunt(ctx, meta, def);
    devLog(ctx, pid, `[dev] Clue hunt ${def.id} started (${def.steps.length} steps).`);
    return;
  }
  ctx.error(
    pid,
    '[dev] Use /dev clue, /dev clue hunt <huntId>, /dev clue solve or /dev clue casket.',
  );
}
