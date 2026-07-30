import { formatContactSheetSeconds } from './cinematic_contact_sheet_plan_core.mjs';

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function expectation(values, emptyLabel) {
  return values.length > 0 ? values.map(htmlEscape).join(', ') : emptyLabel;
}

function renderFrame(sceneId, frame, previousFrame) {
  const file = htmlEscape(frame.file);
  const target = `${formatContactSheetSeconds(frame.targetTime)}s`;
  const measured = Number.isFinite(frame.measuredTime)
    ? `${formatContactSheetSeconds(frame.measuredTime)}s`
    : 'not available';
  const windowLabel = `${formatContactSheetSeconds(frame.windowStart)}s to ${formatContactSheetSeconds(frame.windowEnd)}s`;
  const reasons = frame.reasons.map(htmlEscape).join(', ');
  const subjects = expectation(frame.expectedSubjects, 'none derived from authored ops');
  const textKeys = expectation(frame.expectedTextKeys, 'none active at measured clock');
  const previous = previousFrame
    ? `Compare with ${htmlEscape(previousFrame.file)}`
    : 'First still, no previous comparison';

  return `<figure>
        <a href="${file}"><img src="${file}" alt="${sceneId} target ${target}, measured ${measured}" loading="lazy"></a>
        <figcaption>
          <div class="timing">
            <strong>Target ${target}</strong>
            <span>Measured ${measured}</span>
          </div>
          <p>Cut window ${windowLabel}. ${reasons}</p>
          <fieldset>
            <legend>Intent checklist</legend>
            <label><input type="checkbox"> <span>Named subject visible</span><small>Expected: ${subjects}</small></label>
            <label><input type="checkbox"> <span>Expected text visible</span><small>Expected: ${textKeys}</small></label>
            <label><input type="checkbox"> <span>Frame differs from the previous one</span><small>${previous}</small></label>
          </fieldset>
        </figcaption>
      </figure>`;
}

export function renderContactSheetHtml(input) {
  const sceneId = htmlEscape(input.sceneId);
  const cards = input.frames
    .map((frame, index) => renderFrame(sceneId, frame, input.frames[index - 1]))
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${sceneId} contact sheet</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #111; color: #eee; }
    body { margin: 0; padding: 24px; }
    header { margin-bottom: 20px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    p { margin: 4px 0; color: #bbb; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
    figure { margin: 0; overflow: hidden; border: 1px solid #333; border-radius: 6px; background: #1a1a1a; }
    a { display: block; }
    img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: contain; background: #000; }
    figcaption { padding: 10px 12px 12px; font-size: 13px; }
    .timing { display: flex; justify-content: space-between; gap: 12px; }
    .timing span { color: #aaa; }
    fieldset { display: grid; gap: 7px; margin: 10px 0 0; padding: 9px 10px 10px; border: 1px solid #444; }
    legend { color: #ddd; padding: 0 5px; }
    label { display: grid; grid-template-columns: auto 1fr; column-gap: 7px; align-items: start; }
    label input { margin: 2px 0 0; }
    label small { grid-column: 2; color: #aaa; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <header>
    <h1>${sceneId}</h1>
    <p>Offline world seed: ${htmlEscape(input.seed)}</p>
    <p>The authored sampling plan and filenames are deterministic for this scene and seed.</p>
  </header>
  <main>
${cards}
  </main>
</body>
</html>
`;
}
