// The ONE owner of ClientWorld's correlated request/reply lifecycles
// (Intentional Gathering PR3 transport contract): the boolean command-outcome
// family (loot, pickup, harvestCorpse, harvest_node, enter_dungeon,
// leave_dungeon, delve_interact, resurrect_healer, all via cmdWithOutcome),
// the corpse-harvest status query (inspectCorpseHarvest), and the mob inspect
// window's live stat read (inspectMob, MobInspectRequest). A MOVE, not a
// rewrite: the existing CommandOutcomeTracker (command_outcomes.ts) and
// CorpseHarvestInfoRequest (corpse_harvest_info_request.ts) leaves are reused
// unchanged, never re-implemented or given retry/cache semantics they don't
// already have.
//
// Deliberately narrow: `deps` carries only what a caller needs to decide
// whether a request may be sent at all (`canSend`) and the one raw send
// callback. Both inspection reads build their own `{cmd, id, rid}` payload
// here (`cmd: 'inspectCorpseHarvest'`, `cmd: 'inspectMob'`), which the
// source-scanned send-set gate (tests/command_schema.test.ts, W0b) reads,
// since it scans every src/net module.

import type { ClientCommand, CorpseHarvestInfo, MobInspectInfo } from '../world_api';
import { CommandOutcomeTracker } from './command_outcomes';
import { CorpseHarvestInfoRequest } from './corpse_harvest_info_request';
import { MobInspectRequest } from './mob_inspect_request';

export interface WorldInteractionRequestsDeps {
  /** Whether a request may be sent right now at all: connected, socket open,
   *  and not spectating (spectate only ever forwards `chat`). */
  readonly canSend: () => boolean;
  /** The raw `{t:'cmd', ...payload}` send, exactly what `rawCmd` does. */
  readonly sendRawCommand: (payload: Record<string, unknown>) => void;
}

function isCommandOutcomeReply(msg: Record<string, unknown>): msg is { rid: number; ok: boolean } {
  return (
    msg.t === 'commandOutcome' &&
    Number.isSafeInteger(msg.rid) &&
    (msg.rid as number) > 0 &&
    typeof msg.ok === 'boolean'
  );
}

export class WorldInteractionRequests {
  private readonly commands = new CommandOutcomeTracker();
  private readonly inspection: CorpseHarvestInfoRequest;
  private readonly mobInspection: MobInspectRequest;

  constructor(private readonly deps: WorldInteractionRequestsDeps) {
    this.inspection = new CorpseHarvestInfoRequest((id, rid) =>
      this.deps.sendRawCommand({ cmd: 'inspectCorpseHarvest', id, rid }),
    );
    this.mobInspection = new MobInspectRequest((id, rid) =>
      this.deps.sendRawCommand({ cmd: 'inspectMob', id, rid }),
    );
  }

  /** The boolean command-outcome lifecycle: refuses locally (resolves
   *  `false`, sends nothing) when `canSend()` is false, otherwise registers
   *  and sends exactly like the pre-extraction `cmdWithOutcome`. */
  command(payload: { cmd: ClientCommand } & Record<string, unknown>): Promise<boolean> {
    if (!this.deps.canSend()) return Promise.resolve(false);
    return this.commands.register((rid) => this.deps.sendRawCommand({ ...payload, rid }));
  }

  /** The corpse-harvest status query: refuses locally (resolves `null`, sends
   *  nothing) when `canSend()` is false, otherwise defers entirely to
   *  CorpseHarvestInfoRequest (same-subject sharing, supersede-settles-null,
   *  5s timeout). */
  inspectCorpse(id: number): Promise<CorpseHarvestInfo | null> {
    if (!this.deps.canSend()) return Promise.resolve(null);
    return this.inspection.issue(id);
  }

  /** The mob inspect window's live stat read: refuses locally (resolves
   *  `null`, sends nothing) when `canSend()` is false, otherwise defers to
   *  MobInspectRequest (the same single-pending contract as the corpse query). */
  inspectMob(id: number): Promise<MobInspectInfo | null> {
    if (!this.deps.canSend()) return Promise.resolve(null);
    return this.mobInspection.issue(id);
  }

  /** Routes one already-parsed inbound message to whichever reply type it
   *  is. Returns whether it matched (so the caller can stop further
   *  handling); a message of neither shape is left untouched. */
  onMessage(msg: Record<string, unknown>): boolean {
    if (isCommandOutcomeReply(msg)) {
      this.commands.resolve(msg.rid, msg.ok);
      return true;
    }
    if (msg.t === 'corpseHarvestInfo') {
      this.inspection.onReply(msg);
      return true;
    }
    if (msg.t === 'mobInspectInfo') {
      this.mobInspection.onReply(msg);
      return true;
    }
    return false;
  }

  /** Socket close / session end / spectate-enter: settle every pending
   *  command outcome false AND both pending inspections null. */
  reset(): void {
    this.commands.failAll();
    this.inspection.reset();
    this.mobInspection.reset();
  }

  /** A fresh post-reconnect `hello`: the query alone, alongside this
   *  ClientWorld's other fresh-mirror resets (marketInfo, harvestPreference,
   *  pendingTargetEcho, ...). Command outcomes never need a second reset
   *  here: the old socket's `close` already ran `reset()` above before this
   *  `hello` could ever arrive. */
  resetQuery(): void {
    this.inspection.reset();
    this.mobInspection.reset();
  }
}
