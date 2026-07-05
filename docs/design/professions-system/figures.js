(function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const COL = { line: "#2b303c", muted: "#a4abbb", gold: "#d9b25a", teal: "#4fd0c0", green: "#6fd08a", violet: "#b594e8", grey: "#8a93a6", red: "#e0795f", blue: "#6fa8ff", rare: "#2f86ff", panel: "#1c1f28" };
  function el(tag, attrs, parent) { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; }
  function angAt(i, n) { return (-Math.PI / 2) + i * 2 * Math.PI / n; }
  function anchorFor(a) { return Math.abs(Math.cos(a)) < 0.3 ? "middle" : (Math.cos(a) > 0 ? "start" : "end"); }

  // Ring order (the ten crafts), skill-form labels.
  const CRAFTS = ["Engineering", "Alchemy", "Cooking", "Leatherworking", "Tailoring", "Inscription", "Enchanting", "Jewelcrafting", "Weaponcrafting", "Armorcrafting"];
  const N = 10;
  const COMP = ["Horn", "Hide", "Scale", "Spur", "Venom sac", "Gland", "Gill", "Bone"];

  function gridAndAxes(svg, labels, R) {
    const cx = 170, cy = 170, n = labels.length;
    for (let g = 1; g <= 4; g++) { const pts = []; for (let i = 0; i < n; i++) { const a = angAt(i, n), r = R * g / 4; pts.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1)); } el("polygon", { points: pts.join(" "), fill: "none", stroke: COL.line, "stroke-width": 1 }, svg); }
    for (let i = 0; i < n; i++) { const a = angAt(i, n); el("line", { x1: cx, y1: cy, x2: cx + R * Math.cos(a), y2: cy + R * Math.sin(a), stroke: COL.line, "stroke-width": 1 }, svg); const lr = R + 16, lx = cx + lr * Math.cos(a), ly = cy + lr * Math.sin(a); const t = el("text", { x: lx.toFixed(1), y: (ly + 3).toFixed(1), fill: COL.muted, "font-size": 10.5, "text-anchor": anchorFor(a) }, svg); t.textContent = labels[i]; }
  }
  function valuePoly(svg, values, color, fill, R) {
    const cx = 170, cy = 170, n = values.length, pts = [];
    for (let i = 0; i < n; i++) { const a = angAt(i, n), r = R * Math.min(values[i], 100) / 100; pts.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1)); }
    el("polygon", { points: pts.join(" "), fill: fill, stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
    for (let i = 0; i < n; i++) { const a = angAt(i, n), r = R * Math.min(values[i], 100) / 100; el("circle", { cx: (cx + r * Math.cos(a)).toFixed(1), cy: (cy + r * Math.sin(a)).toFixed(1), r: 2.6, fill: color }, svg); }
  }

  // Figure 1: static wheel with an example pair + opposite hobby dots.
  (function () {
    const svg = document.getElementById("wheel10"); if (!svg) return;
    const cx = 185, cy = 185, R = 112;
    const rim = i => { const a = angAt(i, N); return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; };
    for (let g = 1; g <= 3; g++) { const pts = []; for (let i = 0; i < N; i++) { const a = angAt(i, N), r = R * g / 3; pts.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1)); } el("polygon", { points: pts.join(" "), fill: "none", stroke: COL.line, "stroke-width": 1 }, svg); }
    for (let i = 0; i < N; i++) { const a = angAt(i, N); el("line", { x1: cx, y1: cy, x2: cx + R * Math.cos(a), y2: cy + R * Math.sin(a), stroke: COL.line, "stroke-width": 1 }, svg); }
    [[9, 4], [0, 5]].forEach(([m, h]) => { const [mx, my] = rim(m), [hx, hy] = rim(h); el("line", { x1: mx.toFixed(1), y1: my.toFixed(1), x2: hx.toFixed(1), y2: hy.toFixed(1), stroke: COL.rare, "stroke-width": 1.6, "stroke-dasharray": "4 4", "opacity": 0.85 }, svg); });
    const [ax, ay] = rim(9), [bx, by] = rim(0); el("line", { x1: ax.toFixed(1), y1: ay.toFixed(1), x2: bx.toFixed(1), y2: by.toFixed(1), stroke: COL.gold, "stroke-width": 4, "stroke-linecap": "round", "opacity": 0.9 }, svg);
    for (let i = 0; i < N; i++) { const a = angAt(i, N), [px, py] = rim(i); el("circle", { cx: px.toFixed(1), cy: py.toFixed(1), r: 3, fill: COL.muted }, svg); const lr = R + 16, lx = cx + lr * Math.cos(a), ly = cy + lr * Math.sin(a); const t = el("text", { x: lx.toFixed(1), y: (ly + 3).toFixed(1), fill: COL.muted, "font-size": 11, "text-anchor": anchorFor(a) }, svg); t.textContent = CRAFTS[i]; }
    [9, 0].forEach(i => { const [px, py] = rim(i); el("circle", { cx: px.toFixed(1), cy: py.toFixed(1), r: 5, fill: COL.gold, stroke: "#0c0e13", "stroke-width": 1.2 }, svg); });
    [4, 5].forEach(i => { const [px, py] = rim(i); el("circle", { cx: px.toFixed(1), cy: py.toFixed(1), r: 5, fill: COL.rare, stroke: "#0c0e13", "stroke-width": 1.2 }, svg); });
  })();

  // Interactive explorer. majors=[i,(i+1)%N], hobbies=[opp(i),opp(i+1)], opp(i)=(i+5)%N.
  const NAMES = ["Bombardier", "Apothecary", "Trapper", "Outfitter", "Mageweaver", "Arcanist", "Gembinder", "Bladewright", "Smith", "Cogsmith"];
  const ARCH = NAMES.map((nm, i) => ({ name: nm, majors: [i, (i + 1) % N], hobbies: [(i + 5) % N, (i + 6) % N] }));
  const TIERS = ["common", "uncommon", "rare", "epic", "legendary"], RINGS = 5;
  let cur = 8, hob = 0; // default Smith

  function drawLive() {
    const svg = document.getElementById("liveRadar"); if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const A = ARCH[cur], hobby = A.hobbies[hob], cx = 200, cy = 197, R = 116;
    const rim = (i, v) => { const a = angAt(i, N), r = R * v / 100; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    for (let g = 1; g <= RINGS; g++) { const pts = []; for (let i = 0; i < N; i++) { const a = angAt(i, N), r = R * g / RINGS; pts.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1)); } const isRare = (g === 3); el("polygon", { points: pts.join(" "), fill: "none", stroke: isRare ? COL.rare : COL.line, "stroke-width": isRare ? 1.3 : 1, "stroke-dasharray": isRare ? "4 4" : "none", "opacity": isRare ? 0.8 : 1 }, svg); }
    for (let i = 0; i < N; i++) { const a = angAt(i, N); el("line", { x1: cx, y1: cy, x2: cx + R * Math.cos(a), y2: cy + R * Math.sin(a), stroke: COL.line, "stroke-width": 1 }, svg); const isMaj = A.majors.includes(i), isHob = (i === hobby); const lr = R + 15, lx = cx + lr * Math.cos(a), ly = cy + lr * Math.sin(a); const t = el("text", { x: lx.toFixed(1), y: (ly + 3).toFixed(1), fill: isMaj ? COL.gold : (isHob ? COL.rare : COL.muted), "font-size": 10.5, "text-anchor": anchorFor(a), "font-weight": (isMaj || isHob) ? "700" : "400" }, svg); t.textContent = CRAFTS[i]; }
    for (let g = 1; g <= RINGS; g++) { const t = el("text", { x: cx + 5, y: (cy - R * g / RINGS - 2).toFixed(1), fill: COL.muted, "font-size": 8.5 }, svg); t.textContent = TIERS[g - 1]; }
    const vals = new Array(N).fill(20); A.majors.forEach(m => vals[m] = 100); vals[hobby] = 60;
    const pts = []; for (let i = 0; i < N; i++) { const [px, py] = rim(i, vals[i]); pts.push(px.toFixed(1) + "," + py.toFixed(1)); }
    el("polygon", { points: pts.join(" "), fill: "rgba(217,178,90,0.16)", stroke: COL.gold, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
    A.majors.forEach(m => { const [px, py] = rim(m, 100); el("circle", { cx: px.toFixed(1), cy: py.toFixed(1), r: 5, fill: COL.gold, stroke: "#0c0e13", "stroke-width": 1.2 }, svg); });
    const [hx, hy] = rim(hobby, 60); el("circle", { cx: hx.toFixed(1), cy: hy.toFixed(1), r: 5, fill: COL.rare, stroke: "#0c0e13", "stroke-width": 1.2 }, svg);
    // clickable archetype names, placed on the arc between each adjacent pair (outside the craft labels)
    for (let k = 0; k < N; k++) {
      const a = angAt(k + 0.5, N), lr = R + 38, lx = cx + lr * Math.cos(a), ly = cy + lr * Math.sin(a), sel = (k === cur);
      const t = el("text", { x: lx.toFixed(1), y: (ly + 3).toFixed(1), fill: sel ? "#fff" : COL.red, "font-size": sel ? 12 : 11, "text-anchor": anchorFor(a), "font-weight": sel ? "700" : "400", "text-decoration": "underline" }, svg);
      t.textContent = ARCH[k].name; t.style.cursor = "pointer";
      t.onclick = () => { cur = k; hob = 0; buildHobby(); drawLive(); };
    }
    document.getElementById("liveCap").textContent = A.name + ": masters " + CRAFTS[A.majors[0]] + " + " + CRAFTS[A.majors[1]] + " to legendary, hobby " + CRAFTS[hobby] + " capped at rare.";
  }
  function buildHobby() { const box = document.getElementById("hobbyBtns"); if (!box) return; box.innerHTML = ""; const A = ARCH[cur]; A.hobbies.forEach((h, k) => { const b = document.createElement("button"); b.className = "hbtn" + (k === hob ? " active" : ""); b.textContent = CRAFTS[h] + " (rare cap)"; b.onclick = () => { hob = k; buildHobby(); drawLive(); }; box.appendChild(b); }); }
  if (document.getElementById("liveRadar")) { buildHobby(); drawLive(); }

  // Figure 2: specialist vs generalist (Smith: majors legendary, hobby Leatherworking at rare, rest at the common floor).
  (function () { const svg = document.getElementById("radar-specialist"); if (!svg) return; gridAndAxes(svg, CRAFTS, 112); valuePoly(svg, [20, 20, 20, 60, 20, 20, 20, 20, 100, 100], COL.gold, "rgba(217,178,90,0.22)", 112); })();
  (function () { const svg = document.getElementById("radar-generalist"); if (!svg) return; gridAndAxes(svg, CRAFTS, 112); valuePoly(svg, new Array(N).fill(40), COL.blue, "rgba(111,168,255,0.18)", 112); })();

  // Figure 3: tiered radar. Majors at legendary, hobby Leatherworking at rare, rest at the common floor.
  (function () {
    const svg = document.getElementById("radar-tiers"); if (!svg) return;
    const cx = 170, cy = 170, R = 112, n = N;
    for (let g = 1; g <= RINGS; g++) { const pts = []; for (let i = 0; i < n; i++) { const a = angAt(i, n), r = R * g / RINGS; pts.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1)); } el("polygon", { points: pts.join(" "), fill: "none", stroke: COL.line, "stroke-width": 1 }, svg); }
    for (let i = 0; i < n; i++) { const a = angAt(i, n); el("line", { x1: cx, y1: cy, x2: cx + R * Math.cos(a), y2: cy + R * Math.sin(a), stroke: COL.line, "stroke-width": 1 }, svg); const lr = R + 16, lx = cx + lr * Math.cos(a), ly = cy + lr * Math.sin(a); const t = el("text", { x: lx.toFixed(1), y: (ly + 3).toFixed(1), fill: COL.muted, "font-size": 10.5, "text-anchor": anchorFor(a) }, svg); t.textContent = CRAFTS[i]; }
    for (let g = 1; g <= RINGS; g++) { const t = el("text", { x: cx + 5, y: (cy - R * g / RINGS - 2).toFixed(1), fill: COL.muted, "font-size": 8.5 }, svg); t.textContent = TIERS[g - 1]; }
    // ring units order [Engineering, Alchemy, Cooking, Leatherworking, Tailoring, Inscription, Enchanting, Jewelcrafting, Weaponcrafting, Armorcrafting]
    const reach = [1, 1, 1, 3, 1, 1, 1, 1, 5, 5].map(r => r * 100 / RINGS);
    valuePoly(svg, reach, COL.gold, "rgba(217,178,90,0.14)", R);
    valuePoly(svg, new Array(n).fill(100 / RINGS), COL.teal, "rgba(79,208,192,0.30)", R);
  })();

  // Figure 5: corpse extraction tradeoff.
  (function () {
    const svg = document.getElementById("corpse-diagram"); if (!svg) return;
    const comps = ["Horn", "Scale", "Venom sac"];
    function group(x, title, tiers, note) {
      const t = el("text", { x: x, y: 24, fill: "#fff", "font-size": 13, "font-weight": "600" }, svg); t.textContent = title;
      const colors = [COL.gold, COL.teal, COL.red];
      for (let i = 0; i < comps.length; i++) { const y = 44 + i * 46; el("rect", { x: x, y: y, width: 220, height: 14, rx: 7, fill: "#11131a", stroke: COL.line }, svg); el("rect", { x: x, y: y, width: (220 * tiers[i] / 5).toFixed(0), height: 14, rx: 7, fill: colors[i] }, svg); const lab = el("text", { x: x, y: y - 4, fill: COL.muted, "font-size": 10.5 }, svg); lab.textContent = comps[i] + "  (tier " + tiers[i] + "/5)"; }
      const nt = el("text", { x: x, y: 214, fill: COL.muted, "font-size": 11 }, svg); nt.textContent = note;
    }
    group(20, "Focus one component", [5, 0, 0], "high tier, the other two skipped");
    group(270, "Focus two", [4, 3, 0], "good, narrower haul");
    group(510, "Split across all three", [2, 2, 2], "everything, but low tier each");
  })();

  // Figure 6: additive focus radar over component types.
  (function () {
    const svg = document.getElementById("radar-additive"); if (!svg) return;
    const base = 38;
    gridAndAxes(svg, COMP, 112);
    valuePoly(svg, [base, base, base, base, base + 46, base + 42, base, base], COL.gold, "rgba(217,178,90,0.16)", 112);
    valuePoly(svg, new Array(COMP.length).fill(base), COL.teal, "rgba(79,208,192,0.30)", 112);
  })();

  // Figure 4: power spectrum.
  (function () {
    const host = document.getElementById("spectrum"); if (!host) return;
    const segs = [
      { w: 14, c: "#6b7280", t: "Vendor / basic" },
      { w: 30, c: COL.teal, t: "Average crafter: rare to epic normal-dungeon" },
      { w: 30, c: COL.gold, t: "Specialist + epic mats: equals or beats some drops" },
      { w: 26, c: COL.blue, t: "Top dungeon / raid drops" },
    ];
    segs.forEach(s => { const d = document.createElement("div"); d.style.flex = s.w + " 0 0"; d.style.background = s.c; d.textContent = s.t; host.appendChild(d); });
  })();
  (function () {
    const svg = document.getElementById("effects-axis"); if (!svg) return;
    el("line", { x1: 20, y1: 40, x2: 700, y2: 40, stroke: COL.line, "stroke-width": 2 }, svg);
    el("polygon", { points: "700,40 690,35 690,45", fill: COL.muted }, svg);
    const t = el("text", { x: 20, y: 22, fill: COL.gold, "font-size": 12, "font-weight": "600" }, svg); t.textContent = "Crafting-only effects (orthogonal to item level)";
    ["proc on hit", "set-style bonus", "utility / movement", "no drop equivalent"].forEach((it, i) => { const x = 70 + i * 165; el("circle", { cx: x, cy: 40, r: 5, fill: COL.gold }, svg); const lt = el("text", { x: x, y: 60, fill: COL.muted, "font-size": 11, "text-anchor": "middle" }, svg); lt.textContent = it; });
  })();

  // In-text figure references (a.figref): jump to the figure, leave a floating pill to return.
  (function () {
    const refs = document.querySelectorAll("a.figref");
    if (!refs.length) return;
    const pill = document.createElement("button");
    pill.className = "return-pill";
    pill.textContent = "Back to where you were";
    pill.hidden = true;
    document.body.appendChild(pill);
    let backY = 0;
    refs.forEach(a => a.addEventListener("click", () => { backY = window.scrollY; pill.hidden = false; }));
    pill.addEventListener("click", () => { window.scrollTo({ top: backY }); pill.hidden = true; });
  })();
})();
