# Builds guide.html: the illustrated instruction guide for forging armor sets
# with the asset pipeline. Screenshots are embedded as data URIs so the page is
# fully self-contained (serveable locally and publishable as an artifact).
import base64
import io
import sys

from PIL import Image

QA = 'qa'
SHOTS = 'shots'
WORK = 'work'


def embed(path, width=680, quality=84):
    img = Image.open(path).convert('RGB')
    if img.width > width:
        img = img.resize((width, int(img.height * width / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=quality)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def sheet(paths, width=1360, quality=82):
    imgs = [Image.open(p).convert('RGB') for p in paths]
    h = imgs[0].height
    s = Image.new('RGB', (sum(i.width for i in imgs), h), (12, 10, 8))
    x = 0
    for i in imgs:
        s.paste(i, (x, 0))
        x += i.width
    if s.width > width:
        s = s.resize((width, int(s.height * width / s.width)), Image.LANCZOS)
    buf = io.BytesIO()
    s.save(buf, 'JPEG', quality=quality)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


IMG = {
    'mannequin': embed(f'{QA}/armor_set_ref/front.png', 420),
    'concept_dragon': embed(f'{WORK}/concept_dragonscale.png', 460),
    'concept_bone': embed(f'{WORK}/concept_bonewrought.png', 460),
    'concept_storm': embed(f'{WORK}/concept_stormcrystal.png', 460),
    'raw': embed(f'{QA}/dragonscale_raw/front.png', 420),
    'facing': embed(f'{QA}/facing_check/front.png', 420),
    'set_only': embed(f'{QA}/set_only/front.png', 420),
    'fitted': embed(f'{QA}/shell_dragonscale/front.png', 420),
    'turntable_bone': sheet([f'{QA}/audit_warrior_bonewrought/{v}.png' for v in ['front', 'right', 'back', 'left']]),
    'on_body_bone': embed(f'{QA}/facefix_bonewrought/front.png', 420),
    'on_body_storm': embed(f'{QA}/facefix_stormcrystal/front.png', 420),
    'picker': embed(f'{SHOTS}/loadout_warrior.png', 1360, 80),
    'mixed': embed(f'{SHOTS}/final_warrior_mixed.png', 1360, 80),
}

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forging Armor Sets: Asset Pipeline Guide</title>
<link rel="icon" href="data:,">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">
<style>
  :root {{
    --bg: #0c0a08; --panel: #16110c; --edge: #3a2e1e;
    --gold: #c9a35c; --gold-hi: #eccf8f; --ink: #e8d9b0; --dim: #9c8c6a;
    --ember: #ff7a26; --code-bg: #120e0a;
  }}
  @media (prefers-color-scheme: light) {{
    :root {{
      --bg: #f0e9d8; --panel: #f7f2e4; --edge: #cbb98e;
      --gold: #8a6a2c; --gold-hi: #6d5222; --ink: #2c2416; --dim: #6d5f45;
      --ember: #b34d10; --code-bg: #e9e0c8;
    }}
  }}
  :root[data-theme="dark"] {{
    --bg: #0c0a08; --panel: #16110c; --edge: #3a2e1e;
    --gold: #c9a35c; --gold-hi: #eccf8f; --ink: #e8d9b0; --dim: #9c8c6a;
    --ember: #ff7a26; --code-bg: #120e0a;
  }}
  :root[data-theme="light"] {{
    --bg: #f0e9d8; --panel: #f7f2e4; --edge: #cbb98e;
    --gold: #8a6a2c; --gold-hi: #6d5222; --ink: #2c2416; --dim: #6d5f45;
    --ember: #b34d10; --code-bg: #e9e0c8;
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    background: var(--bg); color: var(--ink);
    font-family: "Alegreya Sans", "Gill Sans", "Segoe UI", sans-serif;
    font-size: 17px; line-height: 1.6;
  }}
  .wrap {{ max-width: 880px; margin: 0 auto; padding: 48px 24px 96px; }}
  header {{ text-align: center; padding: 24px 0 8px; }}
  header h1 {{
    font-family: Cinzel, "Times New Roman", serif; font-weight: 900;
    font-size: clamp(26px, 5vw, 40px); letter-spacing: .14em; color: var(--gold-hi);
    text-wrap: balance;
  }}
  header .sub {{
    margin-top: 10px; font-size: 13px; letter-spacing: .22em; text-transform: uppercase;
    color: var(--dim);
  }}
  .rule {{ height: 1px; background: linear-gradient(to right, transparent, var(--gold), transparent); margin: 28px 0; opacity: .6; }}
  h2 {{
    font-family: Cinzel, serif; font-weight: 700; font-size: 21px; letter-spacing: .1em;
    color: var(--gold); margin: 56px 0 6px; text-wrap: balance;
  }}
  h2 .stage {{
    display: inline-block; min-width: 34px; margin-right: 10px; text-align: center;
    border: 1px solid var(--gold); border-radius: 2px; font-size: 15px; padding: 1px 6px 0;
    color: var(--gold-hi); background: var(--panel);
  }}
  h3 {{ font-family: Cinzel, serif; font-size: 16px; letter-spacing: .08em; color: var(--gold); margin: 26px 0 6px; }}
  p {{ margin: 12px 0; max-width: 68ch; }}
  p.lede {{ font-size: 19px; color: var(--ink); }}
  code {{ font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: .86em; background: var(--code-bg); border: 1px solid var(--edge); border-radius: 3px; padding: 1px 5px; }}
  pre {{
    background: var(--code-bg); border: 1px solid var(--edge); border-radius: 4px;
    padding: 14px 16px; margin: 14px 0; overflow-x: auto;
    font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: 13.5px; line-height: 1.55;
    color: var(--ink);
  }}
  pre code {{ background: none; border: none; padding: 0; }}
  pre .c {{ color: var(--dim); }}
  figure {{ margin: 20px 0; }}
  figure img {{ max-width: 100%; border: 1px solid var(--edge); border-radius: 4px; display: block; }}
  figcaption {{ font-size: 13.5px; color: var(--dim); margin-top: 8px; letter-spacing: .03em; }}
  .figrow {{ display: flex; gap: 14px; flex-wrap: wrap; margin: 20px 0; }}
  .figrow figure {{ flex: 1 1 220px; margin: 0; }}
  .note {{
    border: 1px solid var(--edge); border-left: 3px solid var(--ember);
    background: var(--panel); border-radius: 4px; padding: 12px 16px; margin: 18px 0;
  }}
  .note b {{ color: var(--ember); letter-spacing: .12em; font-size: 12.5px; text-transform: uppercase; display: block; margin-bottom: 4px; }}
  table {{ border-collapse: collapse; margin: 16px 0; width: 100%; font-variant-numeric: tabular-nums; }}
  .tablewrap {{ overflow-x: auto; }}
  th, td {{ border: 1px solid var(--edge); padding: 8px 12px; text-align: left; font-size: 15px; }}
  th {{ background: var(--panel); font-family: Cinzel, serif; font-size: 13px; letter-spacing: .1em; color: var(--gold); }}
  ul, ol {{ margin: 12px 0 12px 24px; max-width: 66ch; }}
  li {{ margin: 6px 0; }}
  a {{ color: var(--gold-hi); }}
  .gallery {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin: 20px 0; }}
  .gallery figure {{ margin: 0; }}
  :focus-visible {{ outline: 2px solid var(--gold); outline-offset: 2px; }}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>FORGING ARMOR SETS</h1>
  <div class="sub">World of ClaudeCraft &middot; asset pipeline guide</div>
</header>
<div class="rule"></div>

<p class="lede">This guide walks the full recipe for creating a brand-new, fully rigged
armor set (helm, pauldrons, breastplate, gauntlets, greaves) from a one-line theme,
using the AI asset pipeline plus the armor tooling in
<code>tmp/asset_pipeline/armor_picker/</code>. A set costs about 90 Tripo credits
(under a dollar) and roughly 30 minutes end to end, most of it waiting on the
segmentation task. Three worked examples, Dragonscale, Bonewrought, and
Stormcrystal, appear throughout and in the gallery at the end.</p>

<h3>Prerequisites</h3>
<ul>
  <li><code>TRIPO_API_KEY</code> and <code>OPENAI_API_KEY</code> in the repo-root <code>.env</code> (never committed).</li>
  <li>Check credits before spending: <code>node scripts/asset_pipeline/pipeline.mjs balance</code>.</li>
  <li>A dequantized base body: the armor is fitted against <code>work/warrior_plain.glb</code>
      (built once from the character source with gltf-transform <code>dequantize()</code>,
      see the Forge Notes in stage 5).</li>
</ul>
<div class="tablewrap"><table>
  <tr><th>Stage</th><th>Tool</th><th>Cost</th><th>Time</th></tr>
  <tr><td>Concept image</td><td>gpt-image-2 (edits API)</td><td>about $0.04</td><td>1 to 2 min</td></tr>
  <tr><td>Image to model</td><td>Tripo image-to-model</td><td>about 50 credits</td><td>3 to 4 min</td></tr>
  <tr><td>Segmentation</td><td>Tripo mesh_segmentation (v2 API)</td><td>about 40 credits</td><td>10 to 20 min</td></tr>
  <tr><td>Slot merge, rig, fit, integrate</td><td>local scripts</td><td>free</td><td>2 to 3 min</td></tr>
</table></div>

<h2><span class="stage">1</span>CONCEPT: REDESIGN THE MANNEQUIN</h2>
<p>Every set starts from the same reference: a render of an armor-only
"invisible mannequin" in T-pose (the maintainer's original Warrior_Armor set,
uprighted). gpt-image-2 redesigns that exact composition around your theme.
Keeping the layout identical is what makes the later automated fitting work:
helmet on top, two pauldrons, chest plate with belt and tassets, two bracers on
the horizontal arm line, two greaves with boots, and critically, no body, no
skin, no face.</p>
<figure><img src="{IMG['mannequin']}" alt="Armor-only mannequin reference render, T-pose, no body"><figcaption>The reference render: armor shells only, arranged as if worn. qa/armor_set_ref/front.png</figcaption></figure>
<pre><code><span class="c"># edit the SETS table in concepts.mjs, then:</span>
node tmp/asset_pipeline/armor_picker/concepts.mjs            <span class="c"># all themes</span>
node tmp/asset_pipeline/armor_picker/concepts.mjs dragonscale <span class="c"># one theme</span></code></pre>
<p>The prompt template pins everything except the theme line. A good theme line
names materials, a helmet silhouette, a pauldron shape, and one signature detail:</p>
<pre><code>Theme: crimson dragonscale. Overlapping deep-red dragon scales, swept-back
dragon horns on the helmet, wing-fin shaped pauldrons, amber gem in the
chest, dark iron trim.</code></pre>
<div class="figrow">
  <figure><img src="{IMG['concept_dragon']}" alt="Dragonscale concept"><figcaption>Dragonscale concept</figcaption></figure>
  <figure><img src="{IMG['concept_bone']}" alt="Bonewrought concept"><figcaption>Bonewrought concept</figcaption></figure>
  <figure><img src="{IMG['concept_storm']}" alt="Stormcrystal concept"><figcaption>Stormcrystal concept</figcaption></figure>
</div>

<h2><span class="stage">2</span>GENERATE AND SEGMENT</h2>
<p>One command takes the concept through Tripo image-to-model (P1 low-poly,
textured, face limit 12000) and then submits the result to the v2
<code>mesh_segmentation</code> endpoint, which accepts v3 task ids. Segmentation
is slow, expect 10 to 20 minutes, and returns the model split into 50 or so
micro parts (every scale and rivet), each carrying its own re-atlased texture.</p>
<pre><code>node tmp/asset_pipeline/armor_picker/gen_set.mjs \\
  tmp/asset_pipeline/armor_picker/work/concept_dragonscale.png dragonscale
<span class="c"># writes work/dragonscale_set_raw.glb and work/dragonscale_set_parts.glb</span></code></pre>
<figure><img src="{IMG['raw']}" alt="Raw generated dragonscale set"><figcaption>The raw generated set. Tripo raws face +X, so the front view shows it side-on; stage 3 fixes the yaw.</figcaption></figure>
<div class="note"><b>Forge note: run it in the background</b>
Segmentation regularly exceeds foreground timeouts. Run <code>gen_set.mjs</code> as a
background job, and never pipe its output through <code>head</code>: truncating stdout
kills the Node process via SIGPIPE before it writes the GLBs.</div>

<h2><span class="stage">3</span>MERGE PARTS INTO THE FIVE SLOTS</h2>
<p><code>merge_slots.mjs</code> classifies the micro parts into Helm, Shoulders,
Torso, Arms, and Legs in the set's own T-pose frame, without moving anything:
the generated arrangement already IS the worn arrangement. Helm is the top band,
Arms are the x-extreme parts sitting on the arm line, Shoulders sit above the
arm line, Legs are the lower body, Torso is the rest. Each part keeps its own
texture; a sidecar JSON records the part order so the rigged mesh can be split
back per slot later.</p>
<pre><code>node tmp/asset_pipeline/armor_picker/merge_slots.mjs \\
  tmp/asset_pipeline/armor_picker/work/dragonscale_set_parts.glb \\
  tmp/asset_pipeline/armor_picker/work/dragonscale_set_raw.glb \\
  tmp/asset_pipeline/armor_picker/work/dragonscale_rig_input.glb -90</code></pre>
<div class="note"><b>Forge note: the yaw is -90, check a front detail</b>
Tripo raws face +X, and the correct yaw to face +Z is -90. Get it wrong and the
whole set mounts backwards, and chibi armor is symmetric enough that renders
still look plausible. Verify with a front-only detail: a chest gem, a visor, a
skull face. Horns and crests sweep BACK, they are not the nose.</div>
<figure><img src="{IMG['facing']}" alt="Correctly faced dragonscale set"><figcaption>After the -90 yaw: visor and chest gems face front, horns sweep back.</figcaption></figure>

<h2><span class="stage">4</span>RIG ONTO THE CHARACTER SKELETON, FREE</h2>
<p>The pipeline's <code>rig-manual</code> lane skins the whole set onto the
warrior's skeleton locally, no credits: distance-to-bone weights, the set's
T-pose arm line fitted to the reference wrist line. Then strip root motion and
split the rigged body back into the five slot nodes.</p>
<pre><code>node scripts/asset_pipeline/pipeline.mjs rig-manual \\
  --raw tmp/asset_pipeline/armor_picker/work/dragonscale_rig_input.glb \\
  --name dragonscale_armor \\
  --reference tmp/asset_pipeline/armor_picker/work/warrior_plain.glb --pre-rotated

job=$(ls -dt tmp/asset_pipeline/skinmodel_dragonscale_armor_* | head -1)
node tmp/asset_pipeline/armor_picker/strip_root_xz.mjs \\
  "$job/dragonscale_armor.glb" tmp/asset_pipeline/armor_picker/work/dragonscale_rigged.glb
node tmp/asset_pipeline/armor_picker/split_by_slots.mjs \\
  tmp/asset_pipeline/armor_picker/work/dragonscale_rigged.glb \\
  tmp/asset_pipeline/armor_picker/work/dragonscale_rig_input.slots.json \\
  tmp/asset_pipeline/armor_picker/work/set_dragonscale.glb \\
  tmp/asset_pipeline/armor_picker/work/set_dragonscale_preview.glb</code></pre>
<div class="note"><b>Forge note: an 11000-triangle warning is expected</b>
The rig-manual validator applies the creature category cap and will report a
FAIL over 11000 triangles. The GLB is still written; a full five-piece set at
face limit 12000 lands slightly over and is fine for the picker.</div>

<h2><span class="stage">5</span>FIT, CLEAR THE BODY, VERIFY</h2>
<p>Two per-vertex tools make the fit exact. <code>adjust_set.mjs</code> applies
targeted rest-space corrections (the standard one is a small helm drop so the
dome seats over the scalp). <code>fit_shell.mjs</code> is a shrinkwrap-outward
pass: any shell vertex sitting within clearance of, or beneath, the body surface
is pushed out along the body's own normal, computed against the union of every
body that can wear the set, so boots and limbs never poke through.</p>
<pre><code><span class="c"># helm seat, applied to both the set file and its preview</span>
node tmp/asset_pipeline/armor_picker/adjust_set.mjs \\
  work/set_dragonscale.glb work/set_dragonscale.glb 1 0 -0.06 "^Set_Helm$"

<span class="c"># shrinkwrap: legs need 0.04 clearance, shoulders and helm 0.02</span>
node tmp/asset_pipeline/armor_picker/fit_shell.mjs \\
  work/set_dragonscale.glb work/set_dragonscale.glb \\
  "^Set_(Legs|Arms|Torso)$" "^(Legs|Arms|Torso)$" 0.03 \\
  work/warrior_plain.glb work/paladin_plain.glb work/druid_plain.glb

<span class="c"># numeric fit gates: whole-set coverage and anchoring medians</span>
node tmp/asset_pipeline/armor_picker/verify_sets.mjs</code></pre>
<div class="figrow">
  <figure><img src="{IMG['set_only']}" alt="Rigged set standing alone"><figcaption>The rigged set alone, posed by the skeleton.</figcaption></figure>
  <figure><img src="{IMG['fitted']}" alt="Set fitted on the warrior body"><figcaption>Fitted on the warrior after the shrinkwrap pass.</figcaption></figure>
</div>
<p>The gates pass when the whole set covers the base armor region within 0.09
world units median and anchors within 0.12 (the three example sets all land
near 0.05 on a 1.8-unit body). Per-slot numbers are informational: designs
allocate a skirt to Legs or Torso freely.</p>
<div class="note"><b>Forge note: dequantize before any vertex math</b>
The shipped character GLBs are meshopt-quantized with one skin per mesh.
Read attributes with gltf-transform <code>getElement()</code> (it de-normalizes)
and run the base bodies through <code>dequantize()</code> once; raw
<code>getArray()</code> on a quantized accessor returns meaningless integers and
was the root cause of every early mis-fit.</div>

<h2><span class="stage">6</span>INTEGRATE INTO THE ARMORY PICKER</h2>
<p>Register the set in the <code>SETS</code> table of
<code>build_picker_assets.mjs</code>, rebuild the manifest, and the picker adds a
chip per slot: every piece can be mixed across sets, plates hide beneath, and
the layering system (hair and shoulder pads hidden by helm and pauldrons, tucked
body geometry under breastplate, gauntlets, and greaves) engages automatically.</p>
<pre><code>node tmp/asset_pipeline/armor_picker/build_picker_assets.mjs
node tmp/asset_pipeline/armor_picker/serve.mjs 5181   <span class="c"># http://localhost:5181/</span></code></pre>
<figure><img src="{IMG['picker']}" alt="The Armory picker with the dragonscale set, dragon wings, and a red skull sword equipped"><figcaption>The Armory: Dragonscale set equipped per slot, with wings and a held weapon from the loadout section.</figcaption></figure>

<h2>EXAMPLES</h2>
<p>The three sets forged with this exact recipe. Each was one concept line, one
generation, one segmentation, and the same local chain.</p>
<figure><img src="{IMG['turntable_bone']}" alt="Bonewrought four-view turntable on the warrior"><figcaption>Bonewrought on the warrior, four views: skull helm, ribcage plate, soul-gem pauldrons.</figcaption></figure>
<div class="gallery">
  <figure><img src="{IMG['on_body_bone']}" alt="Bonewrought fitted"><figcaption>Bonewrought: bleached bone, teal soul-fire gems.</figcaption></figure>
  <figure><img src="{IMG['on_body_storm']}" alt="Stormcrystal fitted"><figcaption>Stormcrystal: azure crystal, geode chest.</figcaption></figure>
  <figure><img src="{IMG['fitted']}" alt="Dragonscale fitted"><figcaption>Dragonscale: crimson scales, horned great-helm.</figcaption></figure>
</div>
<figure><img src="{IMG['mixed']}" alt="Mixed set pieces in the picker"><figcaption>Pieces mix freely across sets and with the texture-variant plate armor.</figcaption></figure>

<h2>QUICK REFERENCE</h2>
<div class="tablewrap"><table>
  <tr><th>Problem</th><th>Fix</th></tr>
  <tr><td>Set mounted backwards</td><td>Re-run merge_slots with the other yaw sign; check a chest gem or visor, horns sweep back</td></tr>
  <tr><td>Set collapsed into a column</td><td>A quantized base was read with getArray(); dequantize the reference and refit</td></tr>
  <tr><td>Set floats or is 2x off</td><td>rig-manual reference had unresolved joint anchors; the lib resolves KayKit names first, then Mixamo aliases</td></tr>
  <tr><td>Boots or garments poke through</td><td>fit_shell with a bigger margin (Legs want 0.04); garments through design gaps want a deeper body tuck</td></tr>
  <tr><td>Helm rides high, scalp shows</td><td>adjust_set: nudge Set_Helm down 0.04 to 0.06</td></tr>
  <tr><td>Output GLBs never appeared</td><td>The driver was piped through head and died on SIGPIPE; rerun without truncation</td></tr>
</table></div>

<div class="rule"></div>
<p style="color: var(--dim); font-size: 14px;">World of ClaudeCraft asset pipeline,
feature/asset-generation-pipeline. Tooling lives in tmp/asset_pipeline/armor_picker/;
the pipeline reference is scripts/asset_pipeline/CLAUDE.md. Costs measured July 2026:
Tripo texture repaint 20 credits, image-to-model 50, segmentation 40, rig-manual free.</p>
</div>
</body>
</html>
"""

out = sys.argv[1] if len(sys.argv) > 1 else 'guide.html'
with open(out, 'w') as f:
    f.write(html)
print(f'wrote {out} ({len(html) // 1024} KB)')
