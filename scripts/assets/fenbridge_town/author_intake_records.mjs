#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const INTAKE_ROOT = resolve(ROOT, 'docs/design/fenbridge-rebuild/img2threejs');
const REFERENCE_ROOT = 'docs/design/fenbridge-rebuild/references';
const CHECK_ONLY = process.argv.includes('--check');

const RGBA = {
  timber: ['rgba(52, 39, 30, 1)', 'rgba(82, 59, 41, 1)', 'wood'],
  board: ['rgba(118, 82, 54, 1)', 'rgba(78, 58, 42, 1)', 'wood'],
  teal: ['rgba(23, 98, 105, 1)', 'rgba(39, 106, 111, 1)', 'fabric'],
  iron: ['rgba(52, 56, 58, 1)', 'rgba(155, 118, 45, 1)', 'metal'],
  parchment: ['rgba(211, 190, 140, 1)', 'rgba(156, 116, 73, 1)', 'fabric'],
  moss: ['rgba(67, 86, 59, 1)', 'rgba(110, 118, 73, 1)', 'wood'],
  wax: ['rgba(164, 38, 50, 1)', 'rgba(80, 45, 43, 1)', 'plastic'],
};

const MATERIAL_COLORS = {
  '#34271e': RGBA.timber,
  '#523b29': RGBA.timber,
  '#765236': RGBA.board,
  '#176269': RGBA.teal,
  '#276a6f': RGBA.teal,
  '#34383a': RGBA.iron,
  '#9b762d': RGBA.iron,
  '#d3be8c': RGBA.parchment,
  '#9e7449': RGBA.parchment,
  '#43563b': RGBA.moss,
  '#a42632': RGBA.wax,
};

function feature(id, kind, description, mapRef, zone, affects, scale = 'meso') {
  return { id, kind, description, mapRef, zone, affects, scale };
}

const ASSETS = {
  'provision-stall': {
    name: 'Fenbridge Provision Stall',
    reference: 'provision-stall-turnaround.png',
    primaryType: 'open-air timber provision stall',
    formLanguage: ['low rectangular counter', 'four-post canopy', 'dense stepped food display'],
    structureKind: [
      'assembled timber frame',
      'tensioned cloth roof',
      'open customer-facing counter',
    ],
    motionPotential: [
      'static service prop',
      'replaceable hanging goods',
      'cloth-edge secondary motion',
    ],
    materialFamilies: [
      'dark weathered timber',
      'teal waxed canvas',
      'bread produce fish and glass',
    ],
    complexity: 'complex',
    silhouette: {
      boundingShape:
        'A broad low counter under a peaked teal canopy, with goods rising above the front lip.',
      aspectRatios: ['width:height about 1.15:1', 'depth:width about 0.5:1'],
      symmetry: 'Frame is nearly bilateral; the provision heaps are deliberately asymmetric.',
      dominantCurves: ['shallow canopy ridge', 'rounded baskets and produce heaps'],
      negativeSpaces: ['open vendor bay beneath canopy', 'gaps between front baskets and crates'],
      landmarks: ['teal roof', 'four dark posts', 'bread and produce counter', 'rear storage'],
    },
    materials: [
      ['dark-timber', 'Weathered dark timber', '#34271e', 0.86, 0.0, 'worn-counter-edges'],
      ['teal-canvas', 'Teal waxed canvas', '#276a6f', 0.62, 0.0, 'canopy-ridge-fade'],
      [
        'provision-goods',
        'Warm provisions and bottle accents',
        '#d3be8c',
        0.55,
        0.0,
        'bottle-gloss-and-produce-color',
      ],
    ],
    components: [
      [
        'counter-frame',
        'Customer counter and lower frame',
        'macro',
        'box',
        'dark-timber',
        ['customer-counter-lip', 'lower-crate-shelf'],
      ],
      [
        'peaked-canopy',
        'Peaked teal canopy silhouette',
        'macro',
        'plane-card',
        'teal-canvas',
        ['scalloped-canopy-edge', 'center-ridge-sag'],
      ],
      [
        'corner-posts',
        'Four exposed timber canopy posts',
        'meso',
        'box',
        'dark-timber',
        ['four-post-rhythm'],
      ],
      [
        'basket-display',
        'Tiered front baskets and crates',
        'meso',
        'box',
        'provision-goods',
        ['stepped-basket-line', 'produce-heaps'],
      ],
      [
        'food-and-bottles',
        'Bread fish produce and bottle groups',
        'meso',
        'ellipsoid',
        'provision-goods',
        ['bread-loaves', 'fish-and-bottle-highlights'],
      ],
      [
        'rear-storage',
        'Rear vendor sacks and reserve crates',
        'micro',
        'box',
        'dark-timber',
        ['hanging-sack', 'rear-crate-stack'],
      ],
    ],
    repetition: [
      [
        'display-goods',
        'Alternating baskets, loaves, produce and bottles across the counter',
        'food-and-bottles',
      ],
    ],
    details: [
      feature(
        'counter-edge-wear',
        'bevel',
        'Bright worn bevel along the customer counter edge.',
        'worn-counter-edges',
        'front',
        'material roughness and edge readability',
      ),
      feature(
        'teal-scalloped-valance',
        'contour',
        'Teal canopy terminates in a shallow scalloped front valance.',
        'scalloped-canopy-edge',
        'front',
        'front silhouette',
      ),
      feature(
        'canopy-ridge-crease',
        'ridge',
        'A centered ridge and slight cloth sag break the canopy plane.',
        'center-ridge-sag',
        'side',
        'roof volume',
      ),
      feature(
        'four-post-spacing',
        'linework',
        'Four dark posts form a legible frame around the vendor opening.',
        'four-post-rhythm',
        'rear',
        'structural rhythm',
      ),
      feature(
        'stepped-baskets',
        'contour',
        'Baskets and crates step up behind the front lip.',
        'stepped-basket-line',
        'hero',
        'display depth',
      ),
      feature(
        'produce-color-breakup',
        'gloss',
        'Warm produce and cool bottle accents punctuate the neutral food display.',
        'bottle-gloss-and-produce-color',
        'hero',
        'material separation',
      ),
      feature(
        'bread-loaf-row',
        'ridge',
        'Rounded bread loaves create a repeating warm ridge.',
        'bread-loaves',
        'front',
        'identity detail',
      ),
      feature(
        'rear-sack-profile',
        'contour',
        'A hanging sack and reserve crates keep the vendor side stocked.',
        'hanging-sack',
        'rear',
        'rear-view completeness',
      ),
    ],
    critical: [
      [
        'canopy-and-counter',
        'Peaked teal canopy over the broad customer counter',
        ['counter-frame', 'peaked-canopy'],
      ],
      [
        'dense-provision-display',
        'Dense readable provision display',
        ['basket-display', 'food-and-bottles'],
      ],
      ['open-vendor-bay', 'Open vendor bay framed by four posts', ['corner-posts', 'rear-storage']],
    ],
  },
  'palisade-wing': {
    name: 'Fenbridge Palisade Wing',
    reference: 'palisade-wing-turnaround.png',
    primaryType: 'modular sharpened timber palisade wall',
    formLanguage: [
      'uneven sharpened stake rhythm',
      'heavy squared end posts',
      'horizontal binding rails',
    ],
    structureKind: [
      'repeated vertical stakes',
      'cross-braced timber assembly',
      'iron and rope binding',
    ],
    motionPotential: [
      'static fortification module',
      'repeatable wall run',
      'optional cloth-tab flutter',
    ],
    materialFamilies: ['raw timber', 'forged iron', 'hemp rope', 'teal marker cloth'],
    complexity: 'moderate',
    silhouette: {
      boundingShape: 'A long thin wall with ten irregular sharpened stakes and taller end posts.',
      aspectRatios: ['width:height about 1.75:1', 'depth:width about 0.12:1'],
      symmetry: 'Broadly balanced end-to-end but intentionally irregular stake heights.',
      dominantCurves: ['jagged sawtooth top line', 'slight rope catenary'],
      negativeSpaces: ['narrow seams between stakes', 'clear ground gap beneath lower rail'],
      landmarks: ['pointed stake row', 'heavy end posts', 'two rails', 'teal end tab'],
    },
    materials: [
      [
        'raw-timber',
        'Split raw palisade timber',
        '#765236',
        0.9,
        0.0,
        'split-grain-and-dark-bases',
      ],
      [
        'iron-and-rope',
        'Iron bands and hemp lashings',
        '#34383a',
        0.58,
        0.72,
        'band-edge-and-rope-wrap',
      ],
      ['teal-marker', 'Teal boundary marker cloth', '#276a6f', 0.66, 0.0, 'weathered-teal-tab'],
    ],
    components: [
      [
        'wall-root',
        'Grounded modular wall span',
        'macro',
        'box',
        'raw-timber',
        ['grounded-baseline', 'thin-wall-depth'],
      ],
      [
        'stake-row',
        'Irregular sharpened stake row',
        'macro',
        'box',
        'raw-timber',
        ['ten-stake-rhythm', 'alternating-point-heights'],
      ],
      [
        'end-posts',
        'Oversized squared terminal posts',
        'meso',
        'box',
        'raw-timber',
        ['heavy-end-caps'],
      ],
      [
        'cross-rails',
        'Two horizontal binding rails',
        'meso',
        'box',
        'raw-timber',
        ['upper-and-lower-rails'],
      ],
      [
        'bindings',
        'Iron bands and rope wraps',
        'meso',
        'box',
        'iron-and-rope',
        ['end-post-bands', 'rope-lashing-lines'],
      ],
      [
        'teal-tab',
        'Small teal identification tab',
        'micro',
        'plane-card',
        'teal-marker',
        ['single-teal-tab'],
      ],
    ],
    repetition: [
      [
        'stake-instances',
        'Ten uneven sharpened stakes with deterministic height variation',
        'stake-row',
      ],
    ],
    details: [
      feature(
        'stake-sawtooth',
        'contour',
        'Alternating sharpened stake tips form the dominant sawtooth edge.',
        'alternating-point-heights',
        'front',
        'silhouette',
      ),
      feature(
        'stake-seams',
        'seam',
        'Narrow dark seams remain visible between individual stakes.',
        'ten-stake-rhythm',
        'front',
        'repetition readability',
      ),
      feature(
        'end-post-mass',
        'bevel',
        'End posts are visibly heavier and more squared than the stake row.',
        'heavy-end-caps',
        'side',
        'module termination',
      ),
      feature(
        'rail-pair',
        'linework',
        'Upper and lower rails bind the full wall span.',
        'upper-and-lower-rails',
        'rear',
        'structural read',
      ),
      feature(
        'iron-band-fasteners',
        'fastener',
        'Dark iron bands wrap the terminal posts.',
        'end-post-bands',
        'hero',
        'fortification detail',
      ),
      feature(
        'rope-wraps',
        'ridge',
        'Rope lashings cross the rail/post junctions.',
        'rope-lashing-lines',
        'hero',
        'joinery',
      ),
      feature(
        'teal-marker-cloth',
        'contour',
        'A small teal tab marks one terminal post.',
        'weathered-teal-tab',
        'side',
        'Fenbridge color cue',
      ),
      feature(
        'dark-ground-bases',
        'stain',
        'Stake feet darken where timber meets damp ground.',
        'split-grain-and-dark-bases',
        'rear',
        'weathering',
      ),
    ],
    critical: [
      ['jagged-stake-row', 'Jagged repeated sharpened stake silhouette', ['stake-row']],
      ['bound-end-posts', 'Heavy bound end-post system', ['end-posts', 'bindings']],
      ['fortification-rails', 'Two readable cross rails', ['cross-rails']],
    ],
  },
  'gate-arch': {
    name: 'Fenbridge Gate Arch',
    reference: 'gate-arch-turnaround.png',
    primaryType: 'open timber settlement gate arch',
    formLanguage: [
      'paired monumental jambs',
      'deep roofed lintel',
      'horn and lantern skyline accents',
    ],
    structureKind: ['assembled timber portal', 'iron-braced jambs', 'shingled overhead cap'],
    motionPotential: ['static open gateway', 'lantern sway', 'banner flutter'],
    materialFamilies: [
      'dark timber',
      'teal shingles and banners',
      'iron',
      'aged brass',
      'teal fenlight',
    ],
    complexity: 'complex',
    silhouette: {
      boundingShape:
        'Two broad jambs support a teal-roofed lintel around a tall unobstructed lane.',
      aspectRatios: ['width:height about 1.5:1', 'depth:width about 0.14:1'],
      symmetry:
        'Portal mass is bilateral; horns, lanterns and hanging banners add controlled asymmetry.',
      dominantCurves: ['upturned roof shoulders', 'curved horn profiles'],
      negativeSpaces: ['large central travel lane', 'small gaps around hanging lanterns'],
      landmarks: ['twin jambs', 'teal roof', 'open lane', 'horns and lanterns'],
    },
    materials: [
      ['gate-timber', 'Dark reinforced gate timber', '#34271e', 0.84, 0.0, 'worn-jamb-edges'],
      [
        'teal-roof-cloth',
        'Teal shingles and hanging banners',
        '#176269',
        0.7,
        0.0,
        'roof-edge-and-banner-fade',
      ],
      [
        'gate-metal-light',
        'Iron straps brass horns and fenlight',
        '#34383a',
        0.48,
        0.76,
        'brass-horn-and-teal-glow',
      ],
    ],
    components: [
      [
        'portal-root',
        'Open gateway lane and grounded footprint',
        'macro',
        'box',
        'gate-timber',
        ['clear-travel-lane', 'broad-ground-contact'],
      ],
      [
        'twin-jambs',
        'Paired monumental timber jambs',
        'macro',
        'box',
        'gate-timber',
        ['tapered-jamb-pair', 'stepped-jamb-feet'],
      ],
      [
        'roofed-lintel',
        'Deep teal-shingled overhead lintel',
        'meso',
        'box',
        'teal-roof-cloth',
        ['upturned-roof-ends', 'deep-lintel-shadow'],
      ],
      [
        'horn-crown',
        'Curved horn pair above the lintel',
        'meso',
        'curve-sweep',
        'gate-metal-light',
        ['paired-gate-horns'],
      ],
      [
        'lantern-banners',
        'Hanging lantern and banner accents',
        'meso',
        'plane-card',
        'teal-roof-cloth',
        ['teal-lantern-pair', 'hanging-banner-tabs'],
      ],
      [
        'iron-bracing',
        'Iron straps and jamb foot plates',
        'micro',
        'box',
        'gate-metal-light',
        ['jamb-strap-lines', 'foot-plate-fasteners'],
      ],
    ],
    repetition: [
      ['jamb-fasteners', 'Mirrored iron straps and fasteners on both jambs', 'iron-bracing'],
    ],
    details: [
      feature(
        'open-lane-gap',
        'contour',
        'The tall central lane remains completely open and readable.',
        'clear-travel-lane',
        'front',
        'gameplay passage',
      ),
      feature(
        'tapered-jambs',
        'contour',
        'Jambs taper slightly upward from stepped grounded feet.',
        'tapered-jamb-pair',
        'front',
        'portal weight',
      ),
      feature(
        'roof-upturn',
        'ridge',
        'Teal cap roof kicks upward at both ends.',
        'upturned-roof-ends',
        'side',
        'Fenbridge skyline',
      ),
      feature(
        'lintel-shadow',
        'stain',
        'A deep value band separates roof cap from the timber lintel.',
        'deep-lintel-shadow',
        'rear',
        'depth read',
      ),
      feature(
        'paired-horns',
        'contour',
        'A paired curved horn crown breaks the roofline.',
        'paired-gate-horns',
        'hero',
        'identity cue',
      ),
      feature(
        'teal-lanterns',
        'emissive',
        'Two teal lanterns hang near the upper jambs.',
        'teal-lantern-pair',
        'hero',
        'night readability',
      ),
      feature(
        'iron-jamb-straps',
        'linework',
        'Dark vertical and transverse iron straps articulate each jamb.',
        'jamb-strap-lines',
        'front',
        'reinforcement',
      ),
      feature(
        'brass-teal-contrast',
        'gloss',
        'Warm horn brass contrasts with the cool teal fenlight.',
        'brass-horn-and-teal-glow',
        'side',
        'material hierarchy',
      ),
    ],
    critical: [
      ['open-gate-portal', 'Unobstructed monumental gate opening', ['portal-root', 'twin-jambs']],
      ['teal-roofed-lintel', 'Deep teal roofed lintel', ['roofed-lintel']],
      ['horn-lantern-crown', 'Horn and fenlight crown cues', ['horn-crown', 'lantern-banners']],
    ],
  },
  boardwalk: {
    name: 'Fenbridge Boardwalk',
    reference: 'boardwalk-turnaround.png',
    primaryType: 'modular marsh timber boardwalk span',
    formLanguage: ['long parallel plank deck', 'low irregular rail posts', 'rope-bound edges'],
    structureKind: ['repeated plank deck', 'cross-bearer support', 'low rope guard'],
    motionPotential: ['static walkable module', 'repeatable path segment', 'rope secondary motion'],
    materialFamilies: ['raw weathered boards', 'dark rope and iron', 'moss and damp staining'],
    complexity: 'moderate',
    silhouette: {
      boundingShape: 'A very low long plank deck with sparse short posts and rope edges.',
      aspectRatios: ['length:width about 2.85:1', 'height:length about 0.04:1'],
      symmetry: 'Deck span is regular; edge posts and moss are uneven.',
      dominantCurves: ['slight rope sags', 'subtle uneven plank edge'],
      negativeSpaces: ['thin gaps between planks', 'open sides below the low ropes'],
      landmarks: ['parallel planks', 'low posts', 'rope edges', 'mossy corners'],
    },
    materials: [
      [
        'boardwalk-timber',
        'Damp raw board timber',
        '#765236',
        0.92,
        0.0,
        'wet-end-grain-and-plank-variation',
      ],
      ['rope-iron', 'Dark rope and iron pins', '#34383a', 0.72, 0.35, 'rope-fiber-and-pin-glints'],
      ['boardwalk-moss', 'Marsh moss accumulations', '#43563b', 0.98, 0.0, 'moss-edge-clumps'],
    ],
    components: [
      [
        'walk-root',
        'Grounded walkable span',
        'macro',
        'box',
        'boardwalk-timber',
        ['low-profile-baseline', 'walkable-clear-width'],
      ],
      [
        'plank-deck',
        'Parallel uneven deck boards',
        'macro',
        'box',
        'boardwalk-timber',
        ['parallel-plank-rhythm', 'uneven-plank-ends'],
      ],
      [
        'cross-bearers',
        'Transverse underside bearers',
        'meso',
        'box',
        'boardwalk-timber',
        ['under-deck-crossbars'],
      ],
      [
        'edge-posts',
        'Short irregular edge posts',
        'meso',
        'box',
        'boardwalk-timber',
        ['sparse-post-pairs'],
      ],
      [
        'rope-guards',
        'Low sagging rope edge lines',
        'meso',
        'curve-sweep',
        'rope-iron',
        ['left-and-right-rope-sags'],
      ],
      [
        'moss-clumps',
        'Moss at damp deck corners',
        'micro',
        'ellipsoid',
        'boardwalk-moss',
        ['asymmetric-moss-corners'],
      ],
    ],
    repetition: [
      [
        'plank-instances',
        'Deterministic row of parallel boards with small length offsets',
        'plank-deck',
      ],
      ['post-instances', 'Sparse paired edge posts', 'edge-posts'],
    ],
    details: [
      feature(
        'plank-gap-lines',
        'seam',
        'Dark narrow gaps separate every deck board.',
        'parallel-plank-rhythm',
        'front',
        'surface readability',
      ),
      feature(
        'uneven-board-ends',
        'contour',
        'Individual board ends project by small irregular amounts.',
        'uneven-plank-ends',
        'side',
        'hand-built silhouette',
      ),
      feature(
        'crossbar-shadow',
        'linework',
        'Transverse bearers remain visible in the low side view.',
        'under-deck-crossbars',
        'rear',
        'structural depth',
      ),
      feature(
        'short-post-rhythm',
        'contour',
        'Sparse short post pairs punctuate both edges.',
        'sparse-post-pairs',
        'hero',
        'path boundary',
      ),
      feature(
        'rope-catenary',
        'contour',
        'Rope guards sag gently between posts.',
        'left-and-right-rope-sags',
        'hero',
        'organic line',
      ),
      feature(
        'iron-pin-glint',
        'gloss',
        'Small iron pin highlights anchor rope to post tops.',
        'rope-fiber-and-pin-glints',
        'front',
        'joinery',
      ),
      feature(
        'moss-corner-clumps',
        'stain',
        'Green moss collects asymmetrically at damp corners.',
        'moss-edge-clumps',
        'rear',
        'marsh integration',
      ),
      feature(
        'wet-end-grain',
        'ridge',
        'Board end grain and damp tonal variation break the long span.',
        'wet-end-grain-and-plank-variation',
        'side',
        'material age',
      ),
    ],
    critical: [
      ['parallel-plank-span', 'Long low parallel plank span', ['walk-root', 'plank-deck']],
      ['low-rope-edges', 'Sparse posts with low sagging ropes', ['edge-posts', 'rope-guards']],
      ['marsh-weathering', 'Damp timber and moss edge cues', ['cross-bearers', 'moss-clumps']],
    ],
  },
  'muster-board': {
    name: 'Fenbridge Muster Board',
    reference: 'muster-board-turnaround.png',
    primaryType: 'roofed settlement notice and muster board',
    formLanguage: ['two-post sign frame', 'small peaked teal roof', 'dense paper-and-seal face'],
    structureKind: ['freestanding timber frame', 'ironbound display panel', 'shingled weather cap'],
    motionPotential: ['static civic prop', 'replaceable notices', 'lantern sway'],
    materialFamilies: [
      'dark timber',
      'teal shingles',
      'iron',
      'parchment',
      'red wax',
      'teal fenlight',
    ],
    complexity: 'complex',
    // The provenance review rejected the fragmented side quadrant. All
    // positive claims below are therefore grounded in front/rear/hero only.
    admittedViews: ['front', 'rear', 'hero'],
    silhouette: {
      boundingShape: 'A compact two-post board topped by a shallow teal roof and side lantern.',
      aspectRatios: ['width:height about 0.92:1', 'depth:width about 0.25:1'],
      symmetry: 'Frame is balanced; notice papers, seals and lantern are asymmetric.',
      dominantCurves: ['shallow roof pitch', 'small hanging lantern cage'],
      negativeSpaces: ['gaps outside the central notice panel', 'space beneath the roof eaves'],
      landmarks: ['roof cap', 'ironbound panel', 'three notices', 'wax seals', 'teal lantern'],
    },
    materials: [
      [
        'board-timber',
        'Dark civic-board timber',
        '#34271e',
        0.88,
        0.0,
        'worn-post-and-panel-edges',
      ],
      ['board-paper', 'Aged notices and red wax', '#d3be8c', 0.78, 0.0, 'paper-edge-and-wax-seals'],
      [
        'board-roof-metal',
        'Teal roof iron bindings and fenlight',
        '#176269',
        0.56,
        0.45,
        'iron-straps-and-teal-light',
      ],
    ],
    components: [
      [
        'board-root',
        'Grounded two-post civic frame',
        'macro',
        'box',
        'board-timber',
        ['paired-post-feet', 'grounded-board-width'],
      ],
      [
        'roofed-frame',
        'Peaked roof and outer frame silhouette',
        'macro',
        'box',
        'board-roof-metal',
        ['teal-weather-cap', 'tall-post-finials'],
      ],
      [
        'notice-panel',
        'Inset dark notice panel',
        'meso',
        'box',
        'board-timber',
        ['deep-panel-inset', 'ironbound-panel-edge'],
      ],
      [
        'paper-cluster',
        'Three overlapping parchment notices',
        'meso',
        'plane-card',
        'board-paper',
        ['three-paper-layout', 'uneven-paper-edges'],
      ],
      [
        'iron-straps',
        'Horizontal iron bindings',
        'meso',
        'box',
        'board-roof-metal',
        ['upper-lower-iron-straps'],
      ],
      [
        'lantern-seals',
        'Teal lantern and red wax seals',
        'micro',
        'ellipsoid',
        'board-paper',
        ['side-teal-lantern', 'three-wax-seals'],
      ],
    ],
    repetition: [
      ['notice-fasteners', 'Three notice sheets each pinned with a wax seal', 'paper-cluster'],
    ],
    details: [
      feature(
        'teal-roof-cap',
        'ridge',
        'A shallow teal cap roof projects beyond the post frame.',
        'teal-weather-cap',
        'front',
        'weather protection silhouette',
      ),
      feature(
        'post-finials',
        'contour',
        'Both tall posts end in dark faceted finials.',
        'tall-post-finials',
        'hero',
        'vertical silhouette',
      ),
      feature(
        'panel-inset-shadow',
        'stain',
        'The notice surface is deeply inset behind the frame.',
        'deep-panel-inset',
        'rear',
        'depth',
      ),
      feature(
        'iron-panel-frame',
        'linework',
        'Iron bars bind the upper and lower panel edges.',
        'ironbound-panel-edge',
        'hero',
        'civic construction',
      ),
      feature(
        'three-notice-layout',
        'seam',
        'Three differently scaled notices overlap across the face.',
        'three-paper-layout',
        'front',
        'information density',
      ),
      feature(
        'wax-seal-fasteners',
        'fastener',
        'A red wax seal pins the upper area of each notice.',
        'three-wax-seals',
        'hero',
        'muster identity',
      ),
      feature(
        'paper-edge-wear',
        'chip',
        'Uneven parchment edges keep the notices visibly separate.',
        'paper-edge-and-wax-seals',
        'front',
        'paper material',
      ),
      feature(
        'teal-side-lantern',
        'emissive',
        'A single teal lantern hangs outside the left post.',
        'side-teal-lantern',
        'rear',
        'night landmark',
      ),
    ],
    critical: [
      [
        'roofed-civic-frame',
        'Roofed two-post civic-board silhouette',
        ['board-root', 'roofed-frame'],
      ],
      [
        'notice-and-seal-face',
        'Readable three-notice and wax-seal face',
        ['notice-panel', 'paper-cluster', 'lantern-seals'],
      ],
      [
        'ironbound-construction',
        'Dark inset panel with iron bindings',
        ['notice-panel', 'iron-straps'],
      ],
    ],
  },
  'muster-order': {
    name: 'Fenbridge Muster Order',
    reference: 'muster-order-turnaround.png',
    primaryType: 'sealed board-backed parchment muster packet',
    formLanguage: [
      'thin rectangular packet',
      'layered irregular pages',
      'central colored binding and wax seal',
    ],
    structureKind: ['stacked parchment leaves', 'rigid backing board', 'bound sealed document'],
    motionPotential: [
      'static quest pickup',
      'whole-object hover or rotation',
      'optional page flutter only in close-up',
    ],
    materialFamilies: [
      'aged parchment',
      'dark backing timber',
      'teal cloth binding',
      'red wax',
      'dark ink',
    ],
    complexity: 'moderate',
    silhouette: {
      boundingShape:
        'A thin horizontal document packet with layered page edges over a dark backing board.',
      aspectRatios: [
        'width:depth about 1.38:1',
        'thickness:width about 0.24:1 after gameplay normalization',
      ],
      symmetry: 'Board and binding are centered; wax seal and ink lines are offset.',
      dominantCurves: ['slightly curled page corners', 'round wax seal'],
      negativeSpaces: ['thin separations between leaf edges', 'small exposed backing border'],
      landmarks: ['parchment stack', 'teal binding', 'red wax seal', 'three dark text lines'],
    },
    materials: [
      ['order-parchment', 'Aged parchment leaves', '#d3be8c', 0.82, 0.0, 'page-edge-darkening'],
      [
        'order-binding',
        'Teal cloth binding and dark backboard',
        '#276a6f',
        0.68,
        0.0,
        'binding-fold-and-board-border',
      ],
      [
        'order-wax-ink',
        'Red wax seal and dark ink',
        '#a42632',
        0.32,
        0.0,
        'wax-gloss-and-ink-lines',
      ],
    ],
    components: [
      [
        'order-root',
        'Rigid board-backed packet footprint',
        'macro',
        'box',
        'order-binding',
        ['exposed-backboard-border', 'thin-grounded-profile'],
      ],
      [
        'parchment-stack',
        'Five layered parchment leaves',
        'macro',
        'box',
        'order-parchment',
        ['layered-page-edges', 'irregular-page-corners'],
      ],
      [
        'binding-band',
        'Centered teal cloth binding',
        'meso',
        'box',
        'order-binding',
        ['teal-cross-band', 'binding-fold-line'],
      ],
      [
        'wax-seal',
        'Offset raised red wax seal',
        'meso',
        'ellipsoid',
        'order-wax-ink',
        ['round-red-seal', 'faceted-seal-impression'],
      ],
      [
        'ink-lines',
        'Three short dark text lines',
        'meso',
        'box',
        'order-wax-ink',
        ['three-ink-lines'],
      ],
      [
        'page-edges',
        'Alternating exposed parchment leaf edges',
        'micro',
        'plane-card',
        'order-parchment',
        ['alternating-leaf-tones'],
      ],
    ],
    repetition: [
      [
        'page-layer-stack',
        'Five diminishing parchment leaves with minute positional offsets',
        'parchment-stack',
      ],
      ['ink-line-stack', 'Three short parallel ink lines', 'ink-lines'],
    ],
    details: [
      feature(
        'backboard-border',
        'contour',
        'A narrow dark board border remains visible around the parchment.',
        'exposed-backboard-border',
        'front',
        'object silhouette',
      ),
      feature(
        'layered-page-seams',
        'seam',
        'Five thin leaf edges read as separate parchment layers.',
        'layered-page-edges',
        'side',
        'packet thickness',
      ),
      feature(
        'page-corner-offsets',
        'contour',
        'Each leaf has a slightly different corner and edge offset.',
        'irregular-page-corners',
        'rear',
        'handmade paper',
      ),
      feature(
        'teal-binding-band',
        'ridge',
        'A raised teal band crosses and visibly binds the packet.',
        'teal-cross-band',
        'hero',
        'Fenbridge quest identity',
      ),
      feature(
        'binding-fold',
        'seam',
        'A darker fold line articulates the center of the cloth binding.',
        'binding-fold-line',
        'front',
        'cloth construction',
      ),
      feature(
        'red-wax-seal',
        'gloss',
        'An offset red wax seal has a lower roughness than the parchment.',
        'wax-gloss-and-ink-lines',
        'hero',
        'quest legibility',
      ),
      feature(
        'seal-impression',
        'ridge',
        'A faceted raised impression breaks the wax disk.',
        'faceted-seal-impression',
        'side',
        'seal depth',
      ),
      feature(
        'three-text-lines',
        'linework',
        'Three short dark horizontal ink lines sit opposite the seal.',
        'three-ink-lines',
        'rear',
        'document read',
      ),
    ],
    critical: [
      [
        'layered-document-packet',
        'Thin board-backed layered parchment packet',
        ['order-root', 'parchment-stack', 'page-edges'],
      ],
      ['teal-binding-system', 'Reference-accurate teal binding band', ['binding-band']],
      ['wax-and-ink-marks', 'Offset red wax seal and three ink lines', ['wax-seal', 'ink-lines']],
    ],
  },
};

function rgbaFor(hex) {
  return (
    MATERIAL_COLORS[hex.toLowerCase()] ?? [
      'rgba(128, 128, 128, 1)',
      'rgba(96, 96, 96, 1)',
      'unknown',
    ]
  );
}

function materialRecord([id, name, color, roughness, metalness, overrideId], index) {
  return {
    id,
    name,
    type: 'standard',
    shaderModel: 'MeshStandardMaterial / merged runtime palette',
    baseColor: color,
    color,
    albedo: {
      dominant: color,
      secondary: index === 0 ? ['#523b29', '#765236'] : ['#34383a', '#d3be8c'],
      samplingNotes:
        'Mapped from the labeled turnaround zones; preserve local hue separation after semantic-mesh merge.',
    },
    colorVariation: {
      palette: [color, index === 0 ? '#523b29' : '#d3be8c'],
      pattern: 'component-local deterministic variation',
      amplitude: 0.12,
      heightCorrelation: 0.2,
    },
    textureResolution: 512,
    textureProjection: {
      mode: 'shared Fenbridge fixed 12-world-yard atlas-cell projection plus baked vertex palette',
      repeat: [1, 1],
      anisotropy: 4,
      texelDensityIntent:
        'Keep one padded semantic cell at a fixed physical scale without wrapping into neighboring cells or adding per-asset texture resources.',
    },
    surfaceFrequencyBands: [
      { id: 'macro', frequency: 2, amplitude: 0.18, role: 'component-scale value separation' },
      { id: 'meso', frequency: 12, amplitude: 0.09, role: 'grain, folds, dents, or age variation' },
      { id: 'micro', frequency: 48, amplitude: 0.035, role: 'grazing-light highlight breakup' },
    ],
    roughness: {
      base: roughness,
      variation: 0.12,
      map: '/textures/fenbridge_surface_roughness.webp green channel',
      localResponse:
        'Cavities remain rougher; handled or waxed accents retain controlled highlights.',
    },
    metalness: {
      base: metalness,
      variation: metalness > 0 ? 0.08 : 0,
      map: '/textures/fenbridge_surface_roughness.webp blue channel',
    },
    normal: {
      pattern: '/textures/fenbridge_surface_normal.webp',
      strength: 0.55,
      scale: 12,
      space: 'tangent',
    },
    ambientOcclusion: {
      cavityStrength: 0.28,
      contactShadowBias: 0.35,
      notes: 'Darken seams, intersections, underside contacts, and layered paper or board edges.',
    },
    wear: { edgeWear: 0.08, scratches: ['short direction-following marks'], chips: [] },
    dirt: { amount: 0.06, cavityBias: 0.7, color: '#2f2a22' },
    localOverrides: [
      {
        id: overrideId,
        description: `Observed local response for ${name.toLowerCase()}.`,
        evidenceRefs: ['hero', 'front'],
        roughness: /gloss|glint|wax|light|glow|brass/.test(overrideId)
          ? 0.22
          : Math.max(0.18, roughness - 0.12),
      },
    ],
    shaderNotes: [
      'Final GLB uses one opaque merged material plus an optional emissive material.',
      'Shared support maps are renderer-owned resources and are not embedded in the GLB.',
    ],
  };
}

function actionProfile(id, root = false) {
  return {
    animationRole: root ? 'root' : 'static-detail',
    pivot: {
      mode: root ? 'floor-center' : 'component-center',
      localPosition: [0, 0, 0],
      axis: [0, 1, 0],
      confidence: 0.9,
    },
    transformChannels: {
      translate: root,
      rotate: root,
      scale: root,
      bend: false,
      twist: false,
      detach: false,
      visibility: true,
      materialState: true,
    },
    sockets: [],
    constraints: [],
    destruction: {
      breakable: false,
      fractureGroup: id,
      seamRefs: [],
      detachableFragments: [],
      breakImpulse: 0,
      debrisMaterial: 'none',
    },
  };
}

function componentRecord(item, index, materialMap) {
  const [id, name, level, primitive, material, localFeatures] = item;
  const [dominantAlbedo, secondaryAlbedo, materialClass] = rgbaFor(materialMap.get(material)[2]);
  const root = index === 0;
  const attachmentPrimitive = ['cylinder', 'cone', 'capsule', 'tube', 'curve-sweep'].includes(
    primitive,
  );
  return {
    id,
    name,
    parent: root ? null : (item[6] ?? item.rootId),
    level,
    role: root ? 'foundation' : level === 'micro' ? 'surface-detail' : 'identity-structure',
    primitive,
    topologyClass: primitive === 'plane-card' ? 'conforming-shell' : 'assembled-solid',
    topologyRationale:
      primitive === 'plane-card'
        ? `${name} is visibly thin, layered over the supporting assembly, and must read from both face and edge views.`
        : `${name} is visibly assembled from discrete low-poly solids with readable overlaps and contact seams.`,
    material,
    materialLayers: [material],
    dimensions: {
      width: 1,
      height: 1,
      depth: 1,
      units: 'relative-to-native-bounds',
      confidence: 0.86,
    },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    geometryDescriptor: {
      topologyIntent: 'low-poly shipping silhouette with deterministic primitive assembly',
      uvStrategy: 'fixed 12-world-yard padded atlas-cell projection; no embedded per-asset texture',
      normalStrategy: 'flat-to-soft normals chosen per semantic primitive before merge',
      edgeTreatment: { bevelRadius: 0.02, segments: 1 },
      deformationStack: [],
    },
    colorMaterialRecipe: {
      dominantAlbedo,
      secondaryAlbedo,
      materialClass,
      materialClassConfidence: 0.86,
    },
    deformations: [],
    joints: [],
    seams: [
      'overlap adjacent solids by at least 0.02 native units where visible contact is required',
    ],
    localFeatures,
    evidenceRefs: ['hero', index % 2 === 0 ? 'front' : 'side'],
    actionProfile: actionProfile(id, root),
    ...(attachmentPrimitive && !root
      ? {
          attachment: {
            parentId: item[6] ?? item.rootId,
            parentSocket: 'surface-contact',
            localStart: [0, 0, 0],
            localEnd: [0, 1, 0],
            contactType: 'embedded-overlap',
            overlap: 0.03,
            gapTolerance: 0.01,
            evidenceRefs: ['hero'],
          },
        }
      : {}),
    importance: level === 'macro' ? 1 : level === 'meso' ? 0.85 : 0.7,
    confidence: 0.86,
  };
}

function detailRecord(assetKey, detail, index) {
  const zoneIndex = { front: 0, side: 1, rear: 2, hero: 3 }[detail.zone];
  const x = zoneIndex % 2 === 0 ? 0 : 0.5;
  const y = zoneIndex < 2 ? 0 : 0.5;
  return {
    id: detail.id,
    kind: detail.kind,
    description: detail.description,
    region: { x, y, width: 0.5, height: 0.5, units: 'normalized montage quadrant' },
    scale: detail.scale,
    affects: detail.affects,
    mapsTo: {
      type:
        detail.mapRef.includes('-') && detail.mapRef.endsWith('edges')
          ? 'material.localOverrides'
          : 'component.localFeatures-or-material.localOverrides',
      ref: detail.mapRef,
    },
    evidenceRef: `docs/design/fenbridge-rebuild/img2threejs/${assetKey}/zones/${detail.zone}.png`,
    confidence: Number((0.9 - index * 0.005).toFixed(3)),
  };
}

function buildAssessment(asset, detailRecords) {
  return {
    objectClass: {
      primaryType: asset.primaryType,
      primaryDomain: 'object',
      formLanguage: asset.formLanguage,
      structureKind: asset.structureKind,
      motionPotential: asset.motionPotential,
      materialFamilies: asset.materialFamilies,
      notes: 'Classified from the four labeled turnaround quadrants; no character anatomy applies.',
    },
    complexity: {
      tier: asset.complexity,
      scores: {
        silhouetteComplexity: asset.complexity === 'complex' ? 3 : 2,
        componentCount: 3,
        hierarchyDepth: 2,
        repetitionDensity: asset.repetition.length ? 2 : 1,
        materialLayerCount: 2,
        localDetailDensity: 3,
        occlusionRisk: 2,
        actionReadinessNeed: 1,
      },
      estimatedCounts: {
        macroComponents: 2,
        mesoComponents: 3,
        microFeatureGroups: asset.details.length,
        materialLayers: asset.materials.length,
        repetitionSystems: asset.repetition.length,
      },
      reasoning: [
        `The turnaround exposes ${asset.components.length} separable semantic systems and ${asset.details.length} identity-defining local details.`,
        `The silhouette, material hierarchy, and rear/side construction require ${asset.complexity} depth rather than a single blockout primitive.`,
      ],
    },
    specDepthDecision: {
      requiredDepth: asset.complexity,
      minimumComponentLevels: ['macro', 'meso', 'micro'],
      needsRepetitionSystems: asset.repetition.length > 0,
      needsMaterialLocalOverrides: true,
      needsMultipleReviewViews: true,
      needsActionReadyHierarchy: true,
      rationale:
        'Front, side, rear, and hero quadrants expose distinct silhouette, joinery, and material evidence.',
    },
    unknownsToResolveBeforeImplementation: [],
    detailInventory: {
      scanMethod: 'labeled-turnaround-component-zones',
      targetMinDetails: asset.details.length,
      note: 'Each observed detail is linked to a concrete component.localFeatures or material.localOverrides key.',
      details: detailRecords,
    },
    anatomy: {
      applies: false,
      styleHeads: 0,
      proportions: { headUnit: 0, torso: 0, legs: 0, shoulderWidth: 0, hipWidth: 0 },
      pose: { type: 'not-applicable', jointAngles: {} },
      faceLandmarks: { eyeLine: 0, eyeSpacing: 0, noseBase: 0, mouthLine: 0, hairline: 0 },
      features: [],
      confidence: 1,
      note: 'Static object track; character reconstruction is not applicable.',
    },
  };
}

function persistJson(filePath, payload) {
  const expected = `${JSON.stringify(payload, null, 2)}\n`;
  if (CHECK_ONLY) {
    const actual = readFileSync(filePath, 'utf8');
    if (actual !== expected) {
      throw new Error(`${filePath} is stale; run author_intake_records.mjs`);
    }
    return;
  }
  writeFileSync(filePath, expected);
}

function updateAsset(assetKey, asset) {
  const directory = resolve(INTAKE_ROOT, assetKey);
  const sculptPath = resolve(directory, 'sculpt-spec.json');
  const preSpecPath = resolve(directory, 'pre-spec-assessment.json');
  const detailPath = resolve(directory, 'zones/detail-inventory.json');
  const sculpt = JSON.parse(readFileSync(sculptPath, 'utf8'));
  const preSpec = JSON.parse(readFileSync(preSpecPath, 'utf8'));
  const detailRecords = asset.details.map((detail, index) => detailRecord(assetKey, detail, index));
  const assessment = buildAssessment(asset, detailRecords);
  const materialMap = new Map(asset.materials.map((entry) => [entry[0], entry]));
  const rootId = asset.components[0][0];
  const components = asset.components.map((entry, index) =>
    componentRecord(Object.assign([...entry], { rootId }), index, materialMap),
  );
  const admittedViews = asset.admittedViews ?? ['front', 'side', 'rear', 'hero'];
  for (const component of components.slice(1)) {
    component.parent = rootId;
    if (component.attachment) component.attachment.parentId = rootId;
  }
  for (const component of components) {
    component.evidenceRefs = component.evidenceRefs.map((view) =>
      admittedViews.includes(view) ? view : 'hero',
    );
  }
  const sourceImage = `${REFERENCE_ROOT}/${asset.reference}`;
  const viewEvidence = admittedViews.map((view, index) => {
    const quadrant = { front: 0, side: 1, rear: 2, hero: 3 }[view];
    return {
      id: view,
      view,
      source: `docs/design/fenbridge-rebuild/img2threejs/${assetKey}/zones/${view}.png`,
      imageRegion: {
        x: quadrant % 2 ? 0.5 : 0,
        y: quadrant > 1 ? 0.5 : 0,
        width: 0.5,
        height: 0.5,
        units: 'normalized montage quadrant',
      },
      observations: [
        index === 0
          ? asset.silhouette.boundingShape
          : asset.silhouette.landmarks[index % asset.silhouette.landmarks.length],
      ],
      confidence: 0.9,
    };
  });
  const featureReviewTargets = asset.critical.map(([id, name, componentRefs], index) => ({
    id,
    name,
    tier: index < 2 ? 'critical' : 'important',
    passIds: index === 0 ? ['blockout', 'form-refinement'] : ['structural-pass', 'material-pass'],
    minimumScore: index < 2 ? 0.8 : 0.72,
    mustPass: index < 2,
    componentRefs,
    evidenceRefs: ['hero', admittedViews[index % admittedViews.length]],
  }));

  Object.assign(sculpt, {
    sourceImage,
    suitability: 'pass',
    scores: {
      object_isolation: 3,
      silhouette_readability: 3,
      depth_inference: 2,
      primitive_decomposition: 3,
      material_procedurality: 3,
      occlusion_risk: 2,
      interaction_fit: 3,
    },
    preSpecAssessment: { ...assessment, sourceImage },
    coordinateFrame: {
      front: '+X faces the primary interaction or display side',
      up: '+Y is world up; native floor is y=0',
      depth: '+Z follows the right-handed world-yard convention',
      scaleReference:
        'Native authoring proportions are normalized to the exact asset contract at export.',
    },
    silhouette: asset.silhouette,
    componentTree: components,
    materials: asset.materials.map(materialRecord),
    proceduralStrategy: [
      `Block out ${asset.silhouette.landmarks.slice(0, 2).join(' and ')} before local detail.`,
      'Build observed components as deterministic low-poly solids with explicit overlap at contacts.',
      'Route colors through semantic buckets, then merge to one opaque material plus optional fenlight emissive.',
      'Normalize the finished hierarchy once to the exact contract bounds and floor.',
      'Validate all four turnaround views plus player-scale and collider-contact evidence.',
    ],
    repetitionSystems: asset.repetition.map(([id, description, componentRef]) => ({
      id,
      description,
      componentRef,
      realization: 'deterministic geometry instances before semantic merge',
      buildsGeometry: true,
      geometry: 'low-poly primitive family',
      distribution: 'authored fixed positions and scale variation; no runtime randomness',
    })),
    viewEvidence,
    featureReviewTargets,
    lookDevTargets: {
      qualityPriority: 'reference-observed-low-poly-shipping',
      materialPass: {
        albedoPaletteRequired: true,
        roughnessVariationRequired: true,
        normalOrBumpRequired: true,
        localOverridesRequired: true,
        sharedSupportMaps: [
          '/textures/fenbridge_surface_atlas.webp',
          '/textures/fenbridge_surface_normal.webp',
          '/textures/fenbridge_surface_roughness.webp',
        ],
        referencePbrExtraction: {
          requiredWhenSourceImagePresent: false,
          acceptedLimitation:
            'The source is a stylized multi-view concept sheet, not a calibrated material photograph; preserve observed color/material zones with deterministic shared maps.',
        },
      },
      lightingPass: {
        referenceIntent:
          'Warm upper-left key, cool sky fill, restrained teal emissive accents, and readable ground contact.',
        neutralReviewRequired: true,
        grazingReviewRequired: true,
      },
    },
    lightingFromPhoto: [
      'Key light: warm neutral directional light from upper-left/front at about 1.6 relative intensity.',
      'Fill light: cool blue-grey environment fill at about 0.55 intensity so rear construction remains readable.',
      'Rim light: subtle cool upper-right rim or environment reflection separates the teal silhouette.',
      'Exposure 1.0 with ACES filmic tone mapping and a muted neutral background for fair comparison.',
      'Soft ground contact shadow plus ambient occlusion under feet, rails, papers, and overlapping solids.',
    ],
    assumptions: [
      'Turnaround quadrant labels are authoritative for front/side/rear/hero interpretation.',
      'Small ornamental marks that do not affect silhouette are represented by low-cost relief or color blocks.',
      'Runtime sockets, bounds, mesh count, materials, and budgets remain authoritative in scripts/assets/fenbridge_town/model.js.',
    ],
    risks: [
      'Semantic merge must not erase the observed local color hierarchy.',
      'Exact normalized bounds can compress thin details, so contact sheets must verify readability.',
    ],
  });
  sculpt.qualityContract.minimumSpecDepth = {
    macroComponents: 2,
    mesoComponents: 3,
    microFeatureGroups: 2,
    materialLayers: 2,
    repetitionSystems: asset.repetition.length,
    reviewViewpoints: 3,
  };
  sculpt.qualityTargets = {
    ...sculpt.qualityTargets,
    targetFidelity: 0.7,
    mustMatch: asset.critical.map(([, name]) => name),
    niceToHave: ['subtle material age variation', 'secondary micro-surface breakup'],
    reviewViewpoints: ['front', 'side', 'rear', 'hero'],
  };
  sculpt.buildPasses = sculpt.buildPasses.map((pass) => ({
    ...pass,
    componentRefs: components.map(({ id }) => id),
  }));
  // The authoring refresh owns the initial locked-pass instructions, while the
  // forge review helper owns live pipeline progress once reviews exist. Keep a
  // completed or in-progress review ledger stable under `--check` instead of
  // resetting its next evidence gate to the blockout instructions.
  if (!Array.isArray(sculpt.reviewHistory) || sculpt.reviewHistory.length === 0) {
    sculpt.sculptPipeline.nextRequiredEvidence = [
      'browser render screenshot from the current locked pass',
      'side-by-side reference/render comparison sheet',
      'AI vision overall score >= 0.7 and per-feature scores meeting declared thresholds',
      'reviewHistory entry with action=continue before advancing',
    ];
  }

  Object.assign(preSpec, {
    sourceImage,
    preSpecAssessment: { ...assessment, sourceImage },
    authoringInstruction:
      'Assessment is complete from the labeled turnaround. Keep every linked component/material/detail claim synchronized with sculpt-spec.json.',
  });
  preSpec.qualityContract.minimumSpecDepth = sculpt.qualityContract.minimumSpecDepth;

  const inventory = {
    sourceImage,
    zonesDir: `docs/design/fenbridge-rebuild/img2threejs/${assetKey}/zones`,
    detailInventory: assessment.detailInventory,
    authoringInstruction:
      'Complete: every observed detail maps to an authored component.localFeatures or material.localOverrides key in sculpt-spec.json.',
  };

  persistJson(sculptPath, sculpt);
  persistJson(preSpecPath, preSpec);
  persistJson(detailPath, inventory);
}

for (const [assetKey, asset] of Object.entries(ASSETS)) updateAsset(assetKey, asset);
console.log(
  `${CHECK_ONLY ? 'Checked' : 'Authored'} ${Object.keys(ASSETS).length} Fenbridge img2threejs intake record sets.`,
);
