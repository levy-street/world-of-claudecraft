// Conversational layer for the agentic bot. The planner already decides movement/
// combat *intent*; this lets the SAME plan also (a) talk back in the bot's own
// voice and (b) take concrete in-game actions — equip/use an item, accept a party
// invite, accept a trade and pocket what you handed it, come to you, or follow you.
//
// Three jobs:
//   1. collectInbound() — buffer chat + trade requests ACROSS ticks. The control
//      loop clears bot.events every ~110ms but the planner only runs every ~8s, so
//      a whisper would be gone before the LLM ever saw it. We keep a rolling log.
//   2. chatSnapshot() — the conversation/inventory slice of the planner snapshot
//      (so it can answer "what's in your bags" and decide what to wear/hand back).
//   3. applySpeech()/applyActions()/driveTick() — turn the returned intent into
//      real bot.cmd()s. One-shot effects are deduped; follow/come/trade are
//      persistent and finished off each tick.
//
// Everything here is a thin wrapper over commands that already exist server-side
// (chat, equip, use, paccept, trade_accept, trade_confirm). Nothing new on the wire.

const RELAY = new Set(['whisper', 'say', 'yell', 'party']);
const MAX_INBOX = 12;

// ---- 1. inbound buffering --------------------------------------------------
export function collectInbound(bot, buf) {
  if (!bot) return;
  for (const ev of bot.events ?? []) {
    if (ev.fromPid === bot.pid) continue; // never react to our own lines
    if (ev.type === 'chat' && RELAY.has(ev.channel ?? 'say')) {
      buf.push({ kind: 'chat', from: ev.from ?? '?', channel: ev.channel ?? 'say', text: String(ev.text ?? '').slice(0, 240), handled: false });
    } else if (ev.type === 'tradeRequest') {
      buf.push({ kind: 'tradeRequest', from: ev.fromName ?? '?', channel: 'trade', text: `${ev.fromName ?? 'someone'} wants to trade`, handled: false });
    }
  }
  while (buf.length > MAX_INBOX) buf.shift();
}

export function hasUnhandled(buf) { return buf.some((m) => !m.handled); }
export function markHandled(buf) { for (const m of buf) m.handled = true; }

// ---- 2. snapshot fragment --------------------------------------------------
export function chatSnapshot(bot, buf) {
  const s = bot?.self ?? {};
  const inv = Array.isArray(s.inv) ? s.inv.map(itemRef).filter(Boolean).slice(0, 24) : [];
  const players = [];
  for (const e of bot?.ents?.values?.() ?? []) {
    if (e.k === 'player' && !e.dead && e.id !== bot.pid) {
      const dx = (e.x ?? 0) - (s.x ?? 0), dz = (e.z ?? 0) - (s.z ?? 0);
      players.push({ name: e.nm ?? '?', dist: Math.round(Math.hypot(dx, dz)) });
    }
  }
  players.sort((a, b) => a.dist - b.dist);
  return {
    inbox: buf.filter((m) => !m.handled).map((m) => ({ from: m.from, channel: m.channel, text: m.text })),
    inventory: inv,
    equipment: s.equip && typeof s.equip === 'object' ? s.equip : {},
    nearbyPlayers: players.slice(0, 6),
    trade: tradeSnap(s.trade),
  };
}

function itemRef(it) {
  if (!it) return null;
  const id = it.itemId ?? it.id ?? (typeof it === 'string' ? it : null);
  if (!id) return null;
  return { id, name: it.name ?? id, count: it.count ?? 1 };
}
function tradeSnap(t) {
  if (!t) return null;
  return {
    with: t.otherName ?? '?',
    theyOffer: (t.theirOffer?.items ?? []).map((s) => s.itemId),
    theirCopper: t.theirOffer?.copper ?? 0,
    theyAccepted: !!t.theirAccepted,
    iAccepted: !!t.myAccepted,
  };
}

// ---- 3a. speech ------------------------------------------------------------
// Channels all have unambiguous slash prefixes server-side, so routing is
// deterministic regardless of the session's "remembered" channel.
export function applySpeech(bot, intent, sent) {
  const say = intent?.say;
  if (!say?.text) return;
  const text = String(say.text).slice(0, 200);
  const key = `say:${say.channel}:${say.to ?? ''}:${text}`;
  if (sent.has(key)) return; sent.add(key);
  let line;
  if (say.channel === 'whisper' && say.to) line = `/w ${say.to} ${text}`;
  else if (say.channel === 'yell') line = `/y ${text}`;
  else if (say.channel === 'party') line = `/p ${text}`;
  else line = `/s ${text}`;
  try { bot.cmd({ cmd: 'chat', text: line }); } catch {}
}

// ---- 3b. one-shot + persistent actions ------------------------------------
const ITEM_ACTIONS = new Set(['equip', 'use']);

export function applyActions(bot, intent, sent, cstate) {
  for (const a of intent?.do ?? []) {
    if (!a || typeof a.action !== 'string') continue;
    const act = a.action;
    if (ITEM_ACTIONS.has(act)) {
      const item = String(a.item ?? '');
      if (!ownsItem(bot, item)) continue;               // can't conjure items it doesn't hold
      const key = `${act}:${item}`;
      if (sent.has(key)) continue; sent.add(key);
      try { bot.cmd({ cmd: act, item }); } catch {}
    } else if (act === 'accept_party') {
      if (sent.has('paccept')) continue; sent.add('paccept');
      try { bot.cmd({ cmd: 'paccept' }); } catch {}
    } else if (act === 'accept_trade') {
      if (!sent.has('trade_accept')) { sent.add('trade_accept'); try { bot.cmd({ cmd: 'trade_accept' }); } catch {} }
      cstate.tradeAuto = true;                            // finish the handshake in driveTick()
    } else if (act === 'follow') {
      cstate.follow = String(a.who ?? intent?.say?.to ?? '') || null;
      cstate.come = null;
    } else if (act === 'come') {
      cstate.come = String(a.who ?? intent?.say?.to ?? '') || null;
    } else if (act === 'stop') {
      cstate.follow = null; cstate.come = null;
    } else if (act === 'emote') {
      try { bot.cmd({ cmd: 'emote', emote: String(a.emote ?? 'wave') }); } catch {}
    }
  }
}

// Per-tick persistent behaviour. Returns a grind-anchor hint ({home,homeRadius})
// for the base brain when following/coming, else {}.
export function driveTick(bot, cstate) {
  const s = bot?.self; if (!s) return {};
  // auto-complete an accepted trade so "take this and wear it" actually transfers:
  // once the other side has locked in their offer, confirm our (empty) side.
  if (cstate.tradeAuto) {
    const t = s.trade;
    if (t) { if (t.theyAccepted && !t.iAccepted) { try { bot.cmd({ cmd: 'trade_confirm' }); } catch {} } }
    else cstate.tradeAuto = false;                        // window closed → done/cancelled
  }
  const targetName = cstate.follow || cstate.come;
  if (targetName) {
    const p = findPlayer(bot, targetName);
    if (p) {
      const d = bot.dist ? bot.dist({ x: p.x, z: p.z }) : 999;
      if (cstate.come && d <= 7) cstate.come = null;       // arrived → stop a one-shot "come here"
      return { home: { x: p.x, z: p.z }, homeRadius: 6 };
    }
  }
  return {};
}

function findPlayer(bot, name) {
  const w = String(name).toLowerCase();
  for (const e of bot?.ents?.values?.() ?? []) {
    if (e.k === 'player' && !e.dead && String(e.nm ?? '').toLowerCase() === w) return e;
  }
  return null;
}
function ownsItem(bot, id) {
  const inv = bot?.self?.inv;
  if (!Array.isArray(inv) || !id) return false;
  return inv.some((it) => (it?.itemId ?? it?.id ?? it) === id);
}
