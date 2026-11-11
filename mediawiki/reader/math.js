// Draws a <woc-math> formula: frac(top, bottom) becomes a stacked fraction and
// pow(base, exponent) a superscript. Arguments may hold text, brackets and other
// frac()/pow() calls; a comma separates the two arguments. Everything is escaped.
const escapeHtml = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function parseMath(expr) {
  let i = 0;
  // Returns { html, text } up to a top-level stop character (not consumed).
  function sequence(stops) {
    let html = '',
      text = '',
      depth = 0;
    while (i < expr.length) {
      const fn = /^(frac|pow)\(/.exec(expr.slice(i));
      if (fn) {
        i += fn[0].length;
        const a = sequence([',']);
        i++;
        while (expr[i] === ' ') i++;
        const b = sequence([')']);
        i++;
        if (fn[1] === 'frac') {
          html +=
            '<span class="woc-frac"><span class="woc-frac-top" aria-hidden="true">' +
            a.html +
            '</span><span class="woc-frac-bottom" aria-hidden="true">' +
            b.html +
            '</span><span class="woc-math-text">(' +
            escapeHtml(a.text) +
            ') ÷ (' +
            escapeHtml(b.text) +
            ')</span></span>';
          text += '(' + a.text + ') ÷ (' + b.text + ')';
        } else {
          html += a.html + '<sup>' + b.html + '</sup>';
          text += a.text + '^(' + b.text + ')';
        }
        continue;
      }
      const ch = expr[i];
      if (depth === 0 && stops.includes(ch)) break;
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      html += escapeHtml(ch);
      text += ch;
      i++;
    }
    return { html, text };
  }
  return sequence([]);
}

export function renderMath(expr) {
  return '<span class="woc-math">' + parseMath(expr).html + '</span>';
}

// A power bonus: the short label "(+ 85.7% Healing Power)" on the page, with the full
// working shown when the reader points at it, focuses it or taps it.
export function renderScale(label, expr, note = '') {
  return (
    '<span class="woc-scale" tabindex="0">(' +
    escapeHtml(label) +
    ')<span class="woc-scale-tip" role="tooltip">' +
    renderMath(expr) +
    (note ? '<small>' + escapeHtml(note) + '</small>' : '') +
    '</span></span>'
  );
}
