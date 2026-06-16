// STUB (RFC) — elizaOS Actions. Each maps 1:1 to a server dispatchMessage case (server/game.ts).
// Movement actions SET A GOAL on WocConnectionService; combat/quest actions forward a one-shot cmd.
// The LLM never emits raw movement input — it only sets goals and fires discrete commands.
// TODO(eliza): import { type Action } from '@elizaos/core' and fill validate/handler/examples.

// Minimal local mirror of the elizaOS Action shape so this stub reads without the dependency.
interface ActionLike {
  name: string;
  similes?: string[];
  description: string;
  parameters?: Record<string, { type: string; optional?: boolean }>;
  // validate(runtime, message, state, options): Promise<boolean>
  // handler(runtime, message, state, options, callback): Promise<ActionResult>
}

export const wocMoveTo: ActionLike = {
  name: 'WOC_MOVE_TO',
  similes: ['GO_TO', 'WALK_TO', 'APPROACH'],
  description: 'Move toward a target entity id or a world point. The body steers itself (Clock A).',
  parameters: {
    targetId: { type: 'number', optional: true },
    x: { type: 'number', optional: true },
    z: { type: 'number', optional: true },
    stopRange: { type: 'number', optional: true },
  },
  // handler: svc.setGoal(targetId != null ? {kind:'follow',...} : {kind:'waypoint',...})
};

export const wocTarget: ActionLike = {
  name: 'WOC_TARGET',
  description: 'Set the current target by entity id.',
  parameters: { id: { type: 'number' } },
  // handler: svc.cmd({ cmd:'target', id })
};

export const wocCast: ActionLike = {
  name: 'WOC_CAST',
  description: 'Cast an ability by id on the current target (e.g. "frostbolt", "battle_shout").',
  parameters: { ability: { type: 'string' }, targetId: { type: 'number', optional: true } },
  // handler: if(targetId) svc.cmd({cmd:'target',id:targetId}); svc.cmd({ cmd:'cast', ability })
};

export const wocAttack: ActionLike = {
  name: 'WOC_ATTACK',
  description: 'Start auto-attacking the current target.',
  // handler: svc.cmd({ cmd:'attack' })
};

export const wocAcceptQuest: ActionLike = {
  name: 'WOC_ACCEPT_QUEST',
  description: 'Accept a quest by id from a nearby quest-giver.',
  parameters: { quest: { type: 'string' } },
  // handler: svc.cmd({ cmd:'accept', quest })
};

export const wocTurninQuest: ActionLike = {
  name: 'WOC_TURNIN_QUEST',
  description: 'Turn in a completed quest by id.',
  parameters: { quest: { type: 'string' } },
  // handler: svc.cmd({ cmd:'turnin', quest })
};

export const wocChat: ActionLike = {
  name: 'WOC_CHAT',
  description: 'Send a chat message (say/party/whisper via prefix).',
  parameters: { text: { type: 'string' } },
  // handler: svc.cmd({ cmd:'chat', text })
};

export const wocBindFamiliar: ActionLike = {
  name: 'WOC_BIND_FAMILIAR',
  description: 'Familiar mode: bind this agent to drive the owner-summoned companion entity.',
  parameters: { ownerCharacter: { type: 'string' } },
  // handler: reconnect with { mode:'familiar', ownerCharacter }; requires the human to have issued bind_familiar
};

// TODO(eliza): WOC_CAST_SLOT, WOC_TAB, WOC_TARGET_NEAREST, WOC_STOP_ATTACK, WOC_INTERACT, WOC_LOOT,
//              WOC_EQUIP, WOC_USE, WOC_BUY, WOC_SELL, WOC_PARTY_INVITE, WOC_PARTY_ACCEPT, WOC_SUMMON.

export const allActions: ActionLike[] = [
  wocMoveTo,
  wocTarget,
  wocCast,
  wocAttack,
  wocAcceptQuest,
  wocTurninQuest,
  wocChat,
  wocBindFamiliar,
];
