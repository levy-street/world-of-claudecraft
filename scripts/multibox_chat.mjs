// multibox_chat.mjs — two-way chat relay + idle micro-behaviour, shared by
// multibox.mjs and companion.mjs.
//
// WHY: the bots ignoring whispers is the #1 way a real player confirms "that's a
// bot" and reports it (bans here are report → GM review, not an algorithm). This
// pipes incoming chat OUT to the dashboard and lets the operator type replies
// that the bot sends — so you answer whispers without ever opening the game client.
//
// File-based IPC (same pattern as multibox.stop / the tokens file / the journals):
//   logs/chat_inbox.jsonl   bots APPEND incoming whispers; the dashboard tails it.
//   logs/chat_outbox.jsonl  the dashboard APPENDS your replies; bots poll + send.

import { appendFileSync, readFileSync, existsSync } from 'node:fs';

export const INBOX = 'logs/chat_inbox.jsonl';
export const OUTBOX = 'logs/chat_outbox.jsonl';

// Relay directed / local channels (someone talking TO or NEAR the bot). Skip the
// broadcast firehoses (general/world/lfg/guild/officer) — those aren't report bait.
const RELAY = new Set(['whisper', 'say', 'yell', 'party']);

// Pull chat events off a bot's event list, append them to the inbox, and return
// human-readable lines to drop into that bot's journal. Call BEFORE events are cleared.
export function relayInbound(party, bot) {
  const lines = [];
  for (const ev of bot.events ?? []) {
    if (ev.type !== 'chat') continue;
    if (ev.fromPid === bot.pid) continue;               // not our own messages
    const ch = ev.channel ?? 'say';
    if (!RELAY.has(ch)) continue;
    const entry = { t: new Date().toISOString(), party, char: bot.charName, channel: ch, fromPid: ev.fromPid, from: ev.from ?? '?', text: String(ev.text ?? '') };
    try { appendFileSync(INBOX, JSON.stringify(entry) + '\n'); } catch {}
    const tag = ch === 'whisper' ? '🔔 [whisper] ' : ch === 'party' ? '[party] ' : ch === 'yell' ? '[yell] ' : '';
    lines.push(`💬 ${tag}**${entry.from}**: ${entry.text}`);
  }
  return lines;
}

// Returns a pump(bots, onSend) you call on a timer. It tails the outbox and, for any
// reply addressed to a character THIS process owns, sends it via `cmd chat`. Each
// process keeps its own cursor (skips the backlog present when it started, so a
// restart never replays old replies), and only the owning process acts on a line.
export function makeOutboxPump() {
  // cursor = how many outbox lines existed when WE started. Skip that backlog, send
  // everything appended afterwards. Initialize NOW (at startup) — NOT lazily on the
  // first poll — otherwise a reply added before our first poll (e.g. right after the
  // dashboard CREATES the file) is mistaken for backlog and silently dropped.
  let cursor = 0;
  try { if (existsSync(OUTBOX)) cursor = readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).length; } catch {}
  return function pump(bots, onSend) {
    let lines;
    try { if (!existsSync(OUTBOX)) return; lines = readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean); } catch { return; }
    if (lines.length < cursor) cursor = 0;                      // file was reset
    if (lines.length <= cursor) return;
    const byName = new Map(bots.map((b) => [b.charName.toLowerCase(), b]));
    for (let i = cursor; i < lines.length; i++) {
      let e; try { e = JSON.parse(lines[i]); } catch { continue; }
      const b = byName.get(String(e.char ?? '').toLowerCase());
      if (b && b.connected && e.text) { b.cmd({ cmd: 'chat', text: String(e.text).slice(0, 200) }); if (onSend) onSend(b, e.text); }
    }
    cursor = lines.length;
  };
}

// --- idle micro-behaviour ---------------------------------------------------
// A parked character that stands frozen, perfectly still, forever is an obvious
// tell. Humans fidget: glance around, hop, throw an emote. RARE + per-bot randomized
// so a party doesn't fidget in lockstep. Returns an input frame to apply this tick,
// or null (caller then sends its normal idle hold). Emotes are fire-and-forget here.
const EMOTES = ['wave', 'flex', 'dance', 'cheer', 'point', 'bow', 'clap', 'salute', 'laugh', 'roar'];
export function idleFidget(bot, state) {
  const now = Date.now();
  state.next ??= now + 8000 + Math.random() * 22000;
  if (now < state.next) return null;
  state.next = now + 12000 + Math.random() * 28000;         // ~12-40s between fidgets
  const r = Math.random();
  if (r < 0.45) { bot.cmd({ cmd: 'emote', emote: EMOTES[Math.floor(Math.random() * EMOTES.length)] }); return null; }
  if (r < 0.70) return { mi: { j: 1 } };                                              // a hop
  return { mi: {}, facing: (bot.self?.f ?? 0) + (Math.random() - 0.5) * 1.6 };        // glance around
}
