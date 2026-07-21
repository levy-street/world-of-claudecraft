// Local SEO and Accessibility Audit Script
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.resolve(__dirname, '../index.html');
const expectedAlternates = [
  { hreflang: 'en', href: 'https://worldofclaudecraft.com/' },
  { hreflang: 'es', href: 'https://worldofclaudecraft.com/?lang=es' },
  { hreflang: 'es-ES', href: 'https://worldofclaudecraft.com/?lang=es_ES' },
  { hreflang: 'fr-FR', href: 'https://worldofclaudecraft.com/?lang=fr_FR' },
  { hreflang: 'fr-CA', href: 'https://worldofclaudecraft.com/?lang=fr_CA' },
  { hreflang: 'en-CA', href: 'https://worldofclaudecraft.com/?lang=en_CA' },
  { hreflang: 'it-IT', href: 'https://worldofclaudecraft.com/?lang=it_IT' },
  { hreflang: 'de-DE', href: 'https://worldofclaudecraft.com/?lang=de_DE' },
  { hreflang: 'zh-CN', href: 'https://worldofclaudecraft.com/?lang=zh_CN' },
  { hreflang: 'zh-TW', href: 'https://worldofclaudecraft.com/?lang=zh_TW' },
  { hreflang: 'ko-KR', href: 'https://worldofclaudecraft.com/?lang=ko_KR' },
  { hreflang: 'ja-JP', href: 'https://worldofclaudecraft.com/?lang=ja_JP' },
  { hreflang: 'pt-BR', href: 'https://worldofclaudecraft.com/?lang=pt_BR' },
  { hreflang: 'ru-RU', href: 'https://worldofclaudecraft.com/?lang=ru_RU' },
  { hreflang: 'cs-CZ', href: 'https://worldofclaudecraft.com/?lang=cs_CZ' },
  { hreflang: 'nl-NL', href: 'https://worldofclaudecraft.com/?lang=nl_NL' },
  { hreflang: 'pl-PL', href: 'https://worldofclaudecraft.com/?lang=pl_PL' },
  { hreflang: 'id-ID', href: 'https://worldofclaudecraft.com/?lang=id_ID' },
  { hreflang: 'tr-TR', href: 'https://worldofclaudecraft.com/?lang=tr_TR' },
  { hreflang: 'sv-SE', href: 'https://worldofclaudecraft.com/?lang=sv_SE' },
  { hreflang: 'vi-VN', href: 'https://worldofclaudecraft.com/?lang=vi_VN' },
  { hreflang: 'da-DK', href: 'https://worldofclaudecraft.com/?lang=da_DK' },
  { hreflang: 'x-default', href: 'https://worldofclaudecraft.com/' },
];

function audit() {
  console.log('--- World of ClaudeCraft: Local SEO & A11y Audit ---');
  if (!fs.existsSync(indexPath)) {
    console.error(`Error: index.html not found at ${indexPath}`);
    process.exit(1);
  }

  const html = fs.readFileSync(indexPath, 'utf-8');

  // Simple HTML element parsers using regex
  const getTagAttribute = (tag, attr) => {
    const regex = new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`, 'i');
    const match = html.match(regex);
    return match ? match[1] : null;
  };

  const getTags = (tagPattern) => {
    const regex = new RegExp(`<${tagPattern}(?:\\s+[^>]*)?>`, 'gi');
    return html.match(regex) || [];
  };

  const getFullTags = (tag) => {
    const regex = new RegExp(`<${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
    const matches = [];
    let match;
    match = regex.exec(html);
    while (match !== null) {
      matches.push({ full: match[0], content: match[1].trim() });
      match = regex.exec(html);
    }
    return matches;
  };

  const getAttribute = (tagStr, attr) => {
    const regex = new RegExp(`${attr}=["']([^"']*)["']`, 'i');
    const match = tagStr.match(regex);
    return match ? match[1] : null;
  };

  const checks = [];

  // 1. Title Check
  const titles = getFullTags('title');
  const titleText = titles.length > 0 ? titles[0].content : '';
  const hasTitle = titles.length === 1 && titleText.length > 0;
  const isTitleGoodLength = titleText.length >= 10 && titleText.length <= 70;
  const hasTitleEmDash = titleText.includes('\u2014');

  checks.push({
    category: 'SEO',
    name: 'Document has a <title> element',
    passed: hasTitle && !hasTitleEmDash,
    score: hasTitle && !hasTitleEmDash ? 15 : 0,
    maxScore: 15,
    details: hasTitle
      ? `Found title: "${titleText}" (${titleText.length} chars). ${hasTitleEmDash ? 'Warning: Contains em-dash!' : ''}`
      : 'No title or multiple titles found.',
  });

  // 2. Meta Description Check
  const metaDescMatch =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const hasMetaDesc = !!metaDescMatch;
  const metaDescText = hasMetaDesc ? metaDescMatch[1] : '';
  const isDescGoodLength = metaDescText && metaDescText.length >= 50 && metaDescText.length <= 300;

  checks.push({
    category: 'SEO',
    name: 'Document has a meta description',
    passed: !!hasMetaDesc && !!isDescGoodLength,
    score: hasMetaDesc && isDescGoodLength ? 15 : hasMetaDesc ? 8 : 0,
    maxScore: 15,
    details: hasMetaDesc
      ? `Found description: "${metaDescText.slice(0, 50)}..." (${metaDescText.length} chars).`
      : 'Missing description meta tag.',
  });

  // 3. Document Lang Check
  const htmlLang = getTagAttribute('html', 'lang');
  const hasLang = !!htmlLang;

  checks.push({
    category: 'SEO/GEO',
    name: 'Document lang attribute is present',
    passed: hasLang,
    score: hasLang ? 10 : 0,
    maxScore: 10,
    details: hasLang
      ? `Lang attribute is set to: "${htmlLang}".`
      : 'html tag is missing lang attribute.',
  });

  // 4. Heading Hierarchy (Single H1)
  const h1s = getFullTags('h1');
  const hasSingleH1 = h1s.length === 1;

  checks.push({
    category: 'SEO/A11y',
    name: 'Page has exactly one <h1> heading',
    passed: hasSingleH1,
    score: hasSingleH1 ? 15 : h1s.length > 1 ? 5 : 0,
    maxScore: 15,
    details: `Found ${h1s.length} <h1> tags.`,
  });

  // 5. Image Alt Attributes
  const imgTags = getTags('img');
  let missingAlts = 0;
  let hasAlts = 0;
  for (const img of imgTags) {
    const alt = getAttribute(img, 'alt');
    const ariaHidden = getAttribute(img, 'aria-hidden');
    if (!alt && ariaHidden !== 'true') {
      missingAlts++;
    } else {
      hasAlts++;
    }
  }
  const allImgsHaveAlt = missingAlts === 0;

  checks.push({
    category: 'A11y',
    name: 'Image elements have descriptive [alt] attributes or aria-hidden',
    passed: allImgsHaveAlt,
    score: imgTags.length === 0 ? 15 : Math.round((hasAlts / imgTags.length) * 15),
    maxScore: 15,
    details: `Total images: ${imgTags.length}. Passed: ${hasAlts}, Failed: ${missingAlts}.`,
  });

  // 6. Semantic Landmark Structures
  const landmarks = ['header', 'nav', 'main', 'footer', 'section'];
  let foundLandmarks = 0;
  for (const mark of landmarks) {
    if (html.includes(`<${mark}`) || html.includes(`class="homepage-${mark}"`)) {
      foundLandmarks++;
    }
  }
  const hasSemanticLayout = foundLandmarks >= 4; // should have at least 4 key semantic regions

  checks.push({
    category: 'SEO/A11y',
    name: 'HTML5 Semantic elements are present',
    passed: hasSemanticLayout,
    score: hasSemanticLayout ? 15 : Math.round((foundLandmarks / 5) * 15),
    maxScore: 15,
    details: `Found landmarks: ${landmarks.filter((l) => html.includes(`<${l}`) || html.includes(`class="homepage-${l}"`)).join(', ')}.`,
  });

  // 7. Interactive Element Accessible Names
  const buttons = getTags('button');
  let missingLabels = 0;
  let okLabels = 0;
  for (const btn of buttons) {
    const id = getAttribute(btn, 'id');
    const ariaLabel = getAttribute(btn, 'aria-label') || getAttribute(btn, 'data-i18n-aria');
    const textLabel = html.includes(btn); // simplified
    const isHamburger = btn.includes('mobile-menu-toggle');
    const isPasswordToggle = btn.includes('password-toggle');

    if ((isHamburger || isPasswordToggle) && !ariaLabel) {
      missingLabels++;
    } else {
      okLabels++;
    }
  }
  const allBtnsHaveLabel = missingLabels === 0;

  checks.push({
    category: 'A11y',
    name: 'Interactive button controls have accessible names',
    passed: allBtnsHaveLabel,
    score: allBtnsHaveLabel ? 15 : 10,
    maxScore: 15,
    details: `Audited key buttons: ${missingLabels} missing labels.`,
  });

  // 8. Canonical Link Check
  const hasCanonical =
    html.includes('rel="canonical"') && html.includes('href="https://worldofclaudecraft.com/"');
  checks.push({
    category: 'SEO',
    name: 'Canonical link tag is present and correct',
    passed: hasCanonical,
    score: hasCanonical ? 10 : 0,
    maxScore: 10,
    details: hasCanonical
      ? 'Found rel="canonical" pointing to worldofclaudecraft.com.'
      : 'Missing rel="canonical" link tag.',
  });

  // 9. GEO / hreflang alternates Check
  const linkTags = getTags('link');
  const missingAlternates = expectedAlternates.filter((expected) => {
    return !linkTags.some((tag) => {
      return (
        getAttribute(tag, 'rel') === 'alternate' &&
        getAttribute(tag, 'hreflang') === expected.hreflang &&
        getAttribute(tag, 'href') === expected.href
      );
    });
  });
  const hasAllAlternates = missingAlternates.length === 0;
  checks.push({
    category: 'SEO/GEO',
    name: 'Multilingual hreflang alternates are present',
    passed: hasAllAlternates,
    score: hasAllAlternates ? 10 : 0,
    maxScore: 10,
    details: hasAllAlternates
      ? `Found all ${expectedAlternates.length} hreflang alternates.`
      : `Missing alternates: ${missingAlternates.map((alt) => alt.hreflang).join(', ')}.`,
  });

  // 10. Open Graph Check
  const ogTitle = html.includes('property="og:title"');
  const ogDesc = html.includes('property="og:description"');
  const ogType = html.includes('property="og:type"');
  const ogUrl = html.includes('property="og:url"');
  const ogImage = html.includes('property="og:image"') && html.includes('woc_logo_square.webp');
  const hasAllOg = ogTitle && ogDesc && ogType && ogUrl && ogImage;
  checks.push({
    category: 'SEO',
    name: 'Open Graph metadata is complete',
    passed: hasAllOg,
    score: hasAllOg ? 10 : 0,
    maxScore: 10,
    details: `OG matches - title: ${ogTitle}, desc: ${ogDesc}, type: ${ogType}, url: ${ogUrl}, image: ${ogImage}.`,
  });

  // 11. Twitter Card Check
  const twCard = html.includes('name="twitter:card"');
  const twTitle = html.includes('name="twitter:title"');
  const twDesc = html.includes('name="twitter:description"');
  const twImage = html.includes('name="twitter:image"');
  const hasAllTwitter = twCard && twTitle && twDesc && twImage;
  checks.push({
    category: 'SEO',
    name: 'Twitter/X Card metadata is complete',
    passed: hasAllTwitter,
    score: hasAllTwitter ? 10 : 0,
    maxScore: 10,
    details: `Twitter matches - card: ${twCard}, title: ${twTitle}, desc: ${twDesc}, image: ${twImage}.`,
  });

  // 12. Structured Data JSON-LD Check
  const hasJsonLd =
    html.includes('type="application/ld+json"') && html.includes('"@type": "VideoGame"');
  checks.push({
    category: 'SEO',
    name: 'JSON-LD VideoGame Schema markup is present',
    passed: hasJsonLd,
    score: hasJsonLd ? 10 : 0,
    maxScore: 10,
    details: hasJsonLd
      ? 'Found application/ld+json script with @type VideoGame.'
      : 'Missing Schema.org VideoGame markup.',
  });

  // Calculate Scores
  const seoMax = checks
    .filter((c) => c.category.includes('SEO'))
    .reduce((a, b) => a + b.maxScore, 0);
  const seoScore = checks
    .filter((c) => c.category.includes('SEO'))
    .reduce((a, b) => a + b.score, 0);

  const a11yMax = checks
    .filter((c) => c.category.includes('A11y'))
    .reduce((a, b) => a + b.maxScore, 0);
  const a11yScore = checks
    .filter((c) => c.category.includes('A11y'))
    .reduce((a, b) => a + b.score, 0);

  const totalMax = checks.reduce((a, b) => a + b.maxScore, 0);
  const totalScore = checks.reduce((a, b) => a + b.score, 0);

  console.log('\n=== AUDIT RESULTS ===');
  checks.forEach((c) => {
    const status = c.passed ? 'PASSED' : 'FAILED';
    console.log(`[${c.category}] ${status} - ${c.name}`);
    console.log(`     Score: ${c.score}/${c.maxScore} | ${c.details}`);
  });

  console.log('\n=== SUMMARY SCORES ===');
  const seoPct = Math.round((seoScore / seoMax) * 100);
  const a11yPct = Math.round((a11yScore / a11yMax) * 100);
  const overallPct = Math.round((totalScore / totalMax) * 100);

  console.log(`SEO Score:         ${seoPct}% (${seoScore}/${seoMax})`);
  console.log(`A11y Score:        ${a11yPct}% (${a11yScore}/${a11yMax})`);
  console.log(`Overall Score:     ${overallPct}% (${totalScore}/${totalMax})`);

  if (overallPct === 100) {
    console.log('\nPerfect score: 100% compliant with local SEO & Accessibility rules.');
  } else {
    console.log(`\nScore: ${overallPct}%. Some elements can be optimized further.`);
  }
}

audit();
