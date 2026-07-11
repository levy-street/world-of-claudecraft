// multibox_dashboard.mjs — a tiny local web UI that live-streams the multibox
// journals AND relays chat two-way. One tab per character + the party log + CI
// status + a 💬 Chat tab. Not a 3D view — it streams the text logs over SSE,
// tailing ./logs as the bots write.
//
// CHAT: bots append incoming whispers to logs/chat_inbox.jsonl (tailed here into
// the Chat tab); your replies POST to /send and are appended to logs/chat_outbox.jsonl,
// which the bot processes poll and send in-game. So you answer whispers from here —
// no game client needed. See scripts/multibox_chat.mjs.
//
// Run:  node scripts/multibox_dashboard.mjs        (then open http://localhost:8099)
//   port: DASH_PORT env (default 8099)

import http from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync, appendFileSync } from 'node:fs';
import { fleetParties } from './multibox_config.mjs';

const PORT = Number(process.env.DASH_PORT ?? 8099);
const LOG_DIR = 'logs';
const INBOX = `${LOG_DIR}/chat_inbox.jsonl`;
const OUTBOX = `${LOG_DIR}/chat_outbox.jsonl`;
const isMeta = (f) => f.startsWith('party') || f === 'STATUS.md';

// base character name from a journal filename ("ryzeheal.companion.md" -> "ryzeheal")
const baseChar = (f) => f.replace(/\.md$/, '').replace(/\.companion$/, '').toLowerCase();
function logFiles() {
  if (!existsSync(LOG_DIR)) return [];
  const all = readdirSync(LOG_DIR).filter((f) => f.endsWith('.md'));
  const pinned = all.filter(isMeta).sort((a, b) => (a === 'STATUS.md' ? 1 : b === 'STATUS.md' ? -1 : a.localeCompare(b)));
  // Only surface journals for characters in the ACTIVE fleet, so banned/retired chars
  // whose journals still linger in ./logs (Durgan, Tovak, ryzelock, …) never show.
  let members = null;
  try { members = new Set(fleetParties().flatMap((p) => [...p.members])); } catch {}
  const bots = all.filter((f) => !isMeta(f) && (!members || members.has(baseChar(f)))).sort();
  return [...pinned, ...bots];
}
const tailLines = (file, n) => { try { return readFileSync(`${LOG_DIR}/${file}`, 'utf8').split('\n').filter(Boolean).slice(-n); } catch { return []; } };
function chatBacklog(n) {
  try { return readFileSync(INBOX, 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}

function computeStats() {
  const parties = fleetParties();
  const partyOf = (name) => (parties.find((p) => p.members.has(name.toLowerCase()))?.label) ?? 'other';
  const groups = new Map();
  for (const f of logFiles().filter((f) => !isMeta(f))) {
    let txt = ''; try { txt = readFileSync(`${LOG_DIR}/${f}`, 'utf8'); } catch {}
    const name = f.replace('.md', '');
    const k = (txt.match(/⚔️ Killed/g) || []).length;
    const lm = [...txt.matchAll(/Reached level (\d+)/g)]; const em = txt.match(/at level (\d+)/);
    const lvl = lm.length ? +lm[lm.length - 1][1] : em ? +em[1] : 1;
    const xm = [...txt.matchAll(/run total (\d+)/g)]; const x = xm.length ? +xm[xm.length - 1][1] : 0;
    // xp/min was derived as run-total ÷ session-minutes — a since-login AVERAGE that (a) reads 0 for the
    // first ~5 min after any relaunch (run total only emits every few min and resets on relog) and (b) lags
    // the real rate forever. Use the ACTUAL recent rate from the last "+N XP in Wm" gain line instead.
    const gm = [...txt.matchAll(/\+(\d+) XP in (\d+(?:\.\d+)?)m/g)]; const gl = gm.length ? gm[gm.length - 1] : null;
    const xr = gl ? +gl[1] / Math.max(1, +gl[2]) : 0;   // recent xp/min for this character
    const om = txt.match(/Journal opened ([0-9.\-T:]+Z)/); const start = om ? new Date(om[1]).getTime() : Date.now();
    const label = partyOf(name);
    const g = groups.get(label) ?? { label, kills: 0, xp: 0, xpRate: 0, deaths: 0, rows: [], start: Infinity };
    g.kills += k; g.xp += x; g.xpRate += xr; g.deaths += (txt.match(/☠️ I fell/g) || []).length;
    g.rows.push({ name, lvl, kills: k }); if (start < g.start) g.start = start;
    groups.set(label, g);
  }
  const out = [...groups.values()].map((g) => {
    const mins = Math.max(1, (Date.now() - (isFinite(g.start) ? g.start : Date.now())) / 60000);
    // xpm = summed recent per-character rate; fall back to the session average only when no gain line exists yet.
    const xpm = g.xpRate > 0 ? Math.round(g.xpRate) : Math.round(g.xp / mins);
    return { label: g.label, kills: g.kills, xp: g.xp, deaths: g.deaths, mins: Math.round(mins), kpm: +(g.kills / mins).toFixed(1), xpm, rows: g.rows };
  }).sort((a, b) => b.kills - a.kills);
  return { parties: out };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Multibox Live</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;background:#0d1117;color:#c9d1d9;display:flex;flex-direction:column;height:100vh;overflow:hidden}
  header{padding:8px 12px;background:#161b22;border-bottom:1px solid #30363d;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  header b{color:#58a6ff}
  #tabs{display:flex;gap:4px;flex-wrap:wrap;padding:6px 12px;background:#161b22;border-bottom:1px solid #30363d}
  .tab{padding:4px 10px;border:1px solid #30363d;border-radius:6px;cursor:pointer;background:#0d1117;user-select:none}
  .tab.active{background:#1f6feb;color:#fff;border-color:#1f6feb}
  .tab .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:6px;background:#3fb950;vertical-align:middle}
  .tab.stale .dot{background:#f85149}
  .tab.flash{animation:fl 1.1s ease-in-out infinite}
  @keyframes fl{50%{background:#9e6a03;color:#fff;border-color:#bb8009}}
  #panes{flex:1;min-height:0}
  .pane{display:none;padding:10px 14px;white-space:pre-wrap;word-break:break-word;height:100%;box-sizing:border-box;overflow:auto}
  .pane.active{display:block}
  #pane-__chat.active{display:flex;flex-direction:column;padding:0}
  #chatfeed{flex:1;overflow:auto;padding:8px 12px;white-space:normal}
  #chatfeed .msg{padding:3px 2px;border-bottom:1px solid #21262d}
  #chatfeed .msg.whisper{background:#16201c;border-left:3px solid #3fb950;padding-left:6px}
  #chatfeed .time{color:#8b949e}
  #chatfeed .rcpt{color:#d2a8ff}
  #chatfeed .ch{color:#8b949e;font-size:11px}
  #chatfeed .from{color:#f0c674;font-weight:bold}
  #chatfeed .reply{color:#58a6ff;cursor:pointer;margin-left:8px;text-decoration:underline}
  #chatcompose{display:flex;gap:6px;padding:8px;border-top:1px solid #30363d;background:#161b22}
  #chatcompose select,#chatcompose input{font:13px ui-monospace,monospace;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:7px}
  #chatcompose input{flex:1}
  #chatcompose button{background:#238636;color:#fff;border:none;border-radius:6px;padding:7px 16px;cursor:pointer}
  .conn{margin-left:auto;font-size:12px}
</style></head><body>
<header><b>🎮 Multibox Live</b><span id="statsbar" style="display:flex;flex-direction:column;gap:2px">…</span><span class="conn" id="conn">●</span></header>
<div id="tabs"></div>
<div id="panes"></div>
<script>
const tabsEl=document.getElementById('tabs'),panesEl=document.getElementById('panes');
const panes={},tabs={},lastAt={};let active=null;
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function ensure(file){
  if(panes[file])return;
  const t=document.createElement('div');t.className='tab';t.innerHTML=file.replace('.md','')+'<span class="dot"></span>';
  t.onclick=()=>select(file);tabsEl.appendChild(t);tabs[file]=t;
  const p=document.createElement('div');p.className='pane';p.id='pane-'+file;panesEl.appendChild(p);panes[file]=p;
  if(!active)select(file);
}
function select(file){active=file;if(tabs[file])tabs[file].classList.remove('flash');for(const f in panes){panes[f].classList.toggle('active',f===file);tabs[f].classList.toggle('active',f===file);}}
function append(file,line){ensure(file);const p=panes[file];const near=p.scrollTop+p.clientHeight>=p.scrollHeight-40;p.textContent+=line+"\\n";if(near)p.scrollTop=p.scrollHeight;lastAt[file]=Date.now();}
function staleCheck(){const now=Date.now();for(const f in tabs){if(f==='party.md'||f==='STATUS.md'||f==='__chat')continue;tabs[f].classList.toggle('stale',now-(lastAt[f]||0)>90000);}}
setInterval(staleCheck,5000);

// --- chat tab (two-way) ---
const chatChars=new Set();
function addChatChar(name){name=String(name||'').replace(/\\.companion$/,'');if(!name||chatChars.has(name))return;chatChars.add(name);const o=document.createElement('option');o.value=name;o.textContent=name;document.getElementById('chatChar').appendChild(o);}
function setupChat(){
  const t=document.createElement('div');t.className='tab';t.id='tab-chat';t.innerHTML='💬 Chat';t.onclick=()=>select('__chat');tabsEl.appendChild(t);tabs['__chat']=t;
  const p=document.createElement('div');p.className='pane';p.id='pane-__chat';
  p.innerHTML='<div id="chatfeed"></div><div id="chatcompose"><select id="chatChar"></select><input id="chatText" placeholder="reply as the selected char — type /w name message, or click reply on a whisper"/><button id="chatSend">Send</button></div>';
  panesEl.appendChild(p);panes['__chat']=p;
  p.querySelector('#chatSend').onclick=sendChat;
  p.querySelector('#chatText').addEventListener('keydown',ev=>{if(ev.key==='Enter')sendChat();});
}
function addChat(e){
  addChatChar(e.char);
  const feed=document.getElementById('chatfeed');if(!feed)return;
  const near=feed.scrollTop+feed.clientHeight>=feed.scrollHeight-40;
  const d=document.createElement('div');d.className='msg'+(e.channel==='whisper'?' whisper':'');
  d.innerHTML='<span class="time">'+String(e.t||'').slice(11,19)+'</span> <span class="rcpt">'+esc(e.char)+'</span> &larr; <span class="from">'+esc(e.from)+'</span> <span class="ch">'+esc(e.channel)+'</span>: '+esc(e.text)+' <span class="reply">reply</span>';
  d.querySelector('.reply').onclick=()=>{const sel=document.getElementById('chatChar');sel.value=e.char;const ti=document.getElementById('chatText');ti.value='/w '+e.from+' ';select('__chat');ti.focus();};
  feed.appendChild(d);if(near)feed.scrollTop=feed.scrollHeight;
  if(active!=='__chat'&&tabs['__chat'])tabs['__chat'].classList.add('flash');
}
async function sendChat(){
  const char=document.getElementById('chatChar').value;const ti=document.getElementById('chatText');const text=ti.value.trim();
  if(!char||!text)return;
  try{await fetch('/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({char,text})});}catch(e){}
  ti.value='';
}
setupChat();

const es=new EventSource('/stream');
es.onopen=()=>document.getElementById('conn').style.color='#3fb950';
es.onerror=()=>document.getElementById('conn').style.color='#f85149';
es.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.t==='files'){m.files.forEach(f=>{ensure(f);if(!(f.startsWith('party')||f==='STATUS.md'))addChatChar(f.replace('.md',''));});}
  else if(m.t==='line'){append(m.file,m.line);}
  else if(m.t==='chat'){addChat(m.e);}
};
async function refreshStats(){try{const s=await(await fetch('/stats')).json();
  document.getElementById('statsbar').innerHTML=(s.parties||[]).map(p=>{
    const roster=p.rows.map(r=>r.name+' L'+r.lvl).join(' · ');
    return '<div>🛡️ <b style="color:#d2a8ff">'+p.label+'</b> &nbsp; ⚔️ <b>'+p.kills+'</b> ('+p.kpm+'/min) · 📈 <b>'+p.xp+'</b> xp ('+p.xpm+'/min) · ☠️ '+p.deaths+' · ⏱ '+p.mins+'m &nbsp; <span style="color:#8b949e">'+roster+'</span></div>';
  }).join('');
}catch(e){}}
setInterval(refreshStats,4000);refreshStats();
</script></body></html>`;

const offsets = new Map();
let chatOffset; // byte offset already streamed from the inbox
const clients = new Set();
function send(res, obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }
function broadcast(obj) { for (const res of clients) send(res, obj); }

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  if (req.url === '/stats') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(computeStats())); }
  if (req.method === 'POST' && req.url === '/send') {
    let body = ''; req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try { const m = JSON.parse(body || '{}'); if (m.char && m.text) appendFileSync(OUTBOX, JSON.stringify({ t: new Date().toISOString(), char: String(m.char), text: String(m.text).slice(0, 200) }) + '\n'); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
    });
    return;
  }
  if (req.url === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const files = logFiles();
    send(res, { t: 'files', files });
    for (const f of files) for (const line of tailLines(f, 80)) send(res, { t: 'line', file: f, line });
    for (const e of chatBacklog(50)) send(res, { t: 'chat', e });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  res.writeHead(404); res.end('not found');
});

// poll the log dir; push only newly-appended journal lines + inbox chat to all SSE clients
function pump() {
  for (const f of logFiles()) {
    const path = `${LOG_DIR}/${f}`;
    let size; try { size = statSync(path).size; } catch { continue; }
    const prev = offsets.get(f);
    if (prev === undefined) { offsets.set(f, size); continue; }
    if (size > prev) {
      const buf = readFileSync(path).subarray(prev, size).toString('utf8');
      offsets.set(f, size);
      for (const line of buf.split('\n').filter(Boolean)) broadcast({ t: 'line', file: f, line });
    } else if (size < prev) { offsets.set(f, size); }
  }
  // tail the chat inbox (jsonl) → push as chat events
  try {
    const size = statSync(INBOX).size;
    if (chatOffset === undefined) { chatOffset = size; }
    else if (size > chatOffset) {
      const buf = readFileSync(INBOX).subarray(chatOffset, size).toString('utf8');
      chatOffset = size;
      for (const line of buf.split('\n').filter(Boolean)) { try { broadcast({ t: 'chat', e: JSON.parse(line) }); } catch {} }
    } else if (size < chatOffset) { chatOffset = size; }
  } catch {}
}
setInterval(pump, 500);

server.listen(PORT, () => console.log(`Multibox dashboard → http://localhost:${PORT}  (streaming ./logs + chat relay, Ctrl-C to stop)`));
