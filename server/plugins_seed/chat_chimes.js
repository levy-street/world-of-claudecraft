// Chat Chimes: never miss your name again.
// Plays a soft chime and shows a toast when someone says your name in chat,
// and always chimes for whispers. Channels can be muted individually and the
// choices are remembered.

const CHANNELS = ['say', 'yell', 'whisper', 'party', 'guild', 'general', 'world', 'lfg'];

const panel = woc.ui.panel({ id: 'chimes', title: 'Chat Chimes' });
const muted = woc.storage.get('muted') || {};
const recent = [];

function mentioned(text, name) {
  if (!text || !name) return false;
  return text.toLowerCase().indexOf(name.toLowerCase()) !== -1;
}

woc.on('chat', (ev) => {
  const me = woc.player();
  if (!me || ev.from === me.name) return;
  const channel = ev.channel || 'say';
  if (muted[channel]) return;
  const isWhisper = channel === 'whisper';
  if (!isWhisper && !mentioned(ev.text, me.name)) return;
  woc.ui.sound('chime');
  woc.ui.toast((isWhisper ? 'Whisper from ' : 'Mentioned by ') + ev.from);
  recent.unshift({ from: ev.from, channel: channel });
  if (recent.length > 5) recent.pop();
  render();
});

function render() {
  let html = '<div style="margin-bottom:4px"><b>Listening on</b></div><div>';
  for (let i = 0; i < CHANNELS.length; i++) {
    const channel = CHANNELS[i];
    const off = muted[channel];
    html +=
      '<button type="button" data-ch="' +
      channel +
      '" style="cursor:pointer;margin:2px;' +
      (off ? 'opacity:0.45' : '') +
      '">' +
      woc.util.esc(channel) +
      '</button>';
  }
  html += '</div>';
  if (recent.length) {
    html += '<hr style="border-color:#3a2f1b"><div><b>Recent pings</b></div>';
    for (let j = 0; j < recent.length; j++) {
      html +=
        '<div>' +
        woc.util.esc(recent[j].from) +
        ' <span style="opacity:0.7">(' +
        woc.util.esc(recent[j].channel) +
        ')</span></div>';
    }
  }
  panel.body.innerHTML = html;
  const buttons = panel.body.querySelectorAll('[data-ch]');
  for (let k = 0; k < buttons.length; k++) {
    ((btn) => {
      btn.addEventListener('click', () => {
        const channel = btn.getAttribute('data-ch');
        muted[channel] = !muted[channel];
        woc.storage.set('muted', muted);
        render();
      });
    })(buttons[k]);
  }
}

render();
