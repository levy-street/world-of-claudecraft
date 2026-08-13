import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { GatherNodeType, StationType } from '../src/sim/types';
import {
  EMPTY_MAP_MARKER_ART,
  gatherMarkerArtId,
  MAP_MARKER_ART_IDS,
  MAP_MARKER_SIZES,
  type MapMarkerArtId,
  type MapMarkerSize,
  mapMarkerIconUrl,
  mapMarkerSizesFor,
  questMarkerArtId,
  stationMarkerArtId,
} from '../src/ui/map_marker_icon_art';
import {
  createMapMarkerArt,
  grayscaleMapMarkerPixels,
  MAP_MARKER_RASTER_COLOR_TOKENS,
  type MapMarkerRasterColors,
  resolveMapMarkerRasterColors,
} from '../src/ui/map_marker_icon_loader';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markerDir = path.join(repoRoot, 'public/ui/map-markers');
const mappingPath = path.join(markerDir, 'mapping.json');
const historicalProvenanceRef = 'docs/achievements/map-marker-art-2026-08-12.md';
const v2ProvenanceRef = 'docs/achievements/map-marker-art-v2-2026-08-12.md';
const historicalProvenancePath = path.join(repoRoot, historicalProvenanceRef);
const v2ProvenancePath = path.join(repoRoot, v2ProvenanceRef);
const creditsPath = path.join(repoRoot, 'CREDITS.md');
const loaderSource = readFileSync(path.join(repoRoot, 'src/ui/map_marker_icon_loader.ts'), 'utf8');
const tokenSource = readFileSync(path.join(repoRoot, 'src/styles/tokens.css'), 'utf8');
const mainSource = readFileSync(path.join(repoRoot, 'src/main.ts'), 'utf8');

const RASTER_COLORS = {
  keyline: '#f5dfad',
  cooldownArcDark: '#24292a',
  cooldownArcLight: '#c8cdcc',
  lockDark: '#24170f',
  lockBronze: '#d39a45',
  lockHighlight: '#f2c46d',
  semanticDark: '#171a1d',
  semanticBronze: '#c28a42',
  semanticSilver: '#d7dce1',
  semanticGold: '#f2c357',
  semanticCyan: '#70d8ff',
  semanticJammed: '#e56d45',
  semanticOpened: '#d8dddc',
  neutralFallback: '#9ba1a2',
} as const satisfies MapMarkerRasterColors;

const GATHER_TYPES = ['ore', 'wood', 'herb'] as const satisfies readonly GatherNodeType[];
const STATION_TYPES = [
  'forge',
  'kitchens',
  'apothecary',
  'tannery',
  'loom',
  'toolworks',
] as const satisfies readonly StationType[];

const SOURCE_SHA256_BY_ID = {
  'dungeon-entrance': 'dd28296a6273e8c35d0df53dcc54a176f5e1829e9bdb96c0166e12937dc38d76',
  'dungeon-exit': '5277987a1cb4e31fde680fd57dc2562fec35547574a222457ae0eda8d360c769',
  'gather-ore': '3b43300921bdf6dd5568ca7b6b31cca3d0b8c065a05381c8b7acac22a028693c',
  'gather-wood': 'd1a7e193aa778f7e58cf06b153e9ea83a2215c3d00dfd073e2c9423ee85b96da',
  'gather-herb': '334fd6ece51b15b366f91a747b34fe15b2694d071c168e95fa006f67cf366985',
  'station-forge': '3da0df40f27c9b9d841ab6e16b5427cfd6db4cae4ed9bc380575ab603d74519f',
  'station-kitchens': 'e4885c27ac3859df748dda39057634d7aa058d37c010ee1d3f94c5892d6607f0',
  'station-apothecary': 'c66b306ef9008449a115c5d0477e8a2d16904a8e9556fd8d9c462297e650e315',
  'station-tannery': 'eb7855ce422c22fcd2313536ec1a17cd2a3574895d10b555f918c9baf894739a',
  'station-loom': '5cf425d0d0dcf761320f6c12fd229d8ceaa09b1c518ed2393a8310a49b1d21ad',
  'station-toolworks': 'a01989ff342e7f6f569a3a1851cb4acb9155603eb992836cb620e823d3de6e93',
  'service-mailbox': '88e1d574c54447019dc9f5ba545deafa77bb5eb18c47ee5b5bace6d1ab67256a',
  'service-noticeboard': 'de559fddf4815d0cad8ba4eeb69ac4852ac9e0d20af90b9fda1a71d8b9e336d9',
  'quest-available': 'e280ec3de7d1ac64532959e70dd18d0b784ae35e6750c2cbe44f4927f08e31f8',
  'quest-ready': '98803766cd2af93ced0d526f646d6607e9e72c18725e3cb6101a9d9076ccfa0d',
  'quest-repeat': '6e0dae26d978b55b3c32ba05df0d5cc6e7a133b0bc3bf6a9ab261cb4c5b8ef45',
  'quest-cooldown': '3910808797b2ae3fd6807780c9f20cd8f8c3c586e04d464354ceb0c611546128',
  'delve-entrance': '9e4d41096ce142d97ae7060935c5e768021b886f562f9dbc302ebf6cab443620',
  'delve-passage': '12f911165738450d2cac372e553077197c4f0309a211a600511a9148df6dc50e',
  'delve-surface-exit': '7d89ee53a3b4e027e7766d8e77162f40fbdbc959581b2e93e895e09e41679f18',
  'rift-entrance': '09c15e1091ceda64115a10a4e4ad8b2bfe2ed32f159d077b184924601ed347c3',
  'rift-descent': '6665c8af9b4d1515d180148c24a5623eb848ef8b4ef5a0e283869d36d1b7da8e',
  'rift-beacon': '48324b58bf21cb5bb65394bccde1eecabe19c879bff28cac5ee34d6d84c3ef45',
  'rift-egress': '26a81047de37a719c9b33dcd5dbaef89994693a9bef6f455b3222632fc69652a',
  'reward-treasure': '836c2f0feb8107755da0e166b4921b3469bbb9af35828b71d188943d252faffe',
  'reward-locked-cache': '04c0507837e4ac9fd9fe10a07d61196d70234bf7244578bcc8da622d6dace941',
  'reward-reliquary': '45fc42584d0c65d88afb91fadc7aa148462d8c678c226f61dd6151b83e4c6aae',
  'world-passage': '5e2620e2ee1764d1180b25160cc25f7606eddd82c020e2519a099f066cca830e',
} as const satisfies Readonly<Record<MapMarkerArtId, string>>;

// Literal pins, deliberately independent of mapping.json. Comparing only the
// file and mapping values to each other lets both drift together while the
// gate stays green.
const SHIPPING_SHA256_BY_ID = {
  'dungeon-entrance': '28f1e14469366e15c823540ad869094e40a1caa21c964fd719813eb25cb362fa',
  'dungeon-exit': '4253763693dc75ff5adab5312a3664b84aabbfc66a131af06b3de59048f9c830',
  'gather-ore': '32afbd4bb56dd4e8254faed09304ce9746b388b00c35175187f98fe21adf9ecb',
  'gather-wood': '1a80702fc7a43ddff51f44d3c0d447cbaf61d905f26ad3fa8315e289fe591b91',
  'gather-herb': '0c51c70a735a7ad25863111e47afbcf4bef8cbc1c385dba1689507618a547509',
  'station-forge': '706307171fe33aec62a0a48806de6ef1c92c22ee5af0d1dbe58bdea7df2d91ea',
  'station-kitchens': '9a767650b30028de780d70b707344e00aac95d7245ed98a1025f4eac45a211bb',
  'station-apothecary': '9d88cf7375593a1184e290e9407916606fa81b82295ea13b0b9a1ba11791f07b',
  'station-tannery': '78cb0b7a29534c5456c7e7378461420a8d9fb292978af964609830894fdc5c95',
  'station-loom': 'b4575cb0b9a10036b3332ded9b75f3ec03e61cec619a703c2ec39e5c16bf9f7a',
  'station-toolworks': '62431cb413f43dcd20198de69283cd0d5fbcc171095df8f46e383a08fac762aa',
  'service-mailbox': 'dbad81a0ad5297012d133340e507fa7c5e72cc7f13d5bd215251ccc01094de66',
  'service-noticeboard': '47faba67fe06ef13f543be1a661c7b2ff54f0a552c1d38568111ae72c64c5e20',
  'quest-available': '9d97c9c5d1fb73a2d742ee296bd2b8514cda0b7f6b8020ed7fef315be5eef390',
  'quest-ready': '76dc0a20c464f32028d9c032967468de159a9b8cec62758e9cf77a40a01a692f',
  'quest-repeat': 'be13691b5991275e166b5343ab546d22755b83d1e72dff3af40b1d478c458723',
  'quest-cooldown': '5eb1413f7c9b7f465ccdf86539b73f4ae253b40b7a40c0f9a1844424385639f3',
  'delve-entrance': '31d9fe5d02541ee4d196f26ad19cfd0c7851d90ecfc73dc963eca6ca470546b5',
  'delve-passage': '5742ea658b8c6cb0ff8227ec7f92d618b0ec4a13cbad240034d87394310f8779',
  'delve-surface-exit': '3b94484e18ae28abf56c37fd1c7afc0b6ab8c560e474d52f63d3ee093d48748d',
  'rift-entrance': '06f6e42b287787a4ef58384cc5d198689141d69d44180fd150218f8b56742bd6',
  'rift-descent': '95225a44b6d710120308fa7e883d4af1214e81e804af90d70f4e10b8153b3d8d',
  'rift-beacon': '797b66013e1ea05ecc9074c9623106cc317931da946390f06c8e0c2de4a3baf5',
  'rift-egress': '22fe63eab9c49ada9be7974980671d08e39dca859a9329d930d1001085014091',
  'reward-treasure': '85315ff00a576c9d7b469f91161d17d68a416e847bbd0305240a9051015aeb60',
  'reward-locked-cache': '96b38bf00bb894b629f6e92d378cab984f74bf468d4c5b1152e3002e5b37a4aa',
  'reward-reliquary': 'd1cae63400055d17002d7bf07da1c669beb45096dd0162560510d7f66f627909',
  'world-passage': '5a7205fe6a7eb812ee3b88e75e9f63d5ea09ef7db7e585de3447b424b27b641e',
} as const satisfies Readonly<Record<MapMarkerArtId, string>>;

// SHA-256 of the exact UTF-8 body between each accepted prompt's `text`
// fences, excluding the fence-adjacent newlines. These literals make the
// historical prompt record immutable without copying thirteen long prompts
// into the test or trusting the mutable mapping beside the shipping files.
const PROMPT_SHA256_BY_ID = {
  'dungeon-entrance': 'f5a64b1e52cb9b5333ce7206c701405e19e2f0c917a620f6cb2d1228b5cd2b3b',
  'dungeon-exit': '1d00d48c9d44128727ca6315641f79db01bfe5e4d8d7ecb2251fb1a69ad077f1',
  'gather-ore': 'c05e60dc15eb8232f87d07980bb6770a9019f6596bf705a9ede39330f7429cdd',
  'gather-wood': '00d6baff777a679574078aa9b37e31bb943f3a716d9b48ce98819d4711a1db30',
  'gather-herb': '1de7677a533ad82d46facde2ebbf11ef94640ebe9a2768255033e2117846c31e',
  'station-forge': '58534ce47242caecba0d5f26aeed7005f40e27a17627f586b389a127e59f1eff',
  'station-kitchens': 'a17e7e31695237a3b9562bb26738279b2ed4404d47c1abb0f47f9c663db0c6eb',
  'station-apothecary': 'c6dcaaccb5b6460e1b2ee8e3e485b90fcf9564b03cd6acc94ac8b4600c2b588f',
  'station-tannery': 'b9b961983cefa3ed5a3a8afd7d97de105c67745b0ed59b6c126cef4fccd228cf',
  'station-loom': '1238dc287b0c05067e37b4f106dcae20d36c6a7e08318274c3ad38ccc51cca7b',
  'station-toolworks': 'b89c843fb0179d44e0717cb9c556aa8a8bcf9c56589773fc0bb9922b9252266f',
  'service-mailbox': '797d19d7c090d9cfeb89fe3638619247bd1c357880b066e972430561b1a451c9',
  'service-noticeboard': '00f1de599b83d90672de2560e22df6d951691bd2e578c7e6fc3319b5509f386d',
  'quest-available': '13be45d900554ddbc69c2b796b6b3856e25650f339f2b16dc90f40cac6761190',
  'quest-ready': 'c54c0ba4b5418edb56121ca4f516ec73ceec614a7c97f7dede3930c12a252108',
  'quest-repeat': '9bd035ac0df627d527a20cca726f2eb0a08df6c661ff151b9626bac163cce41c',
  'quest-cooldown': '8b19021513acc81e5926c31b8fe78a0b642011cfb042112826441e4cbeacfdd5',
  'delve-entrance': '2c54f2f13cbd394e85bbf6a25dbe471c0f8c2e2dc46eb2af9ccfbd97ee3c3fd7',
  'delve-passage': 'd1ca22bd7a03e7c887d546c163c44deaae04c61ed9b1dea460e3e1de1ee5dcce',
  'delve-surface-exit': '262613dee0cd37179e6279506d7c3a03c2c7d8fcba1b439593328589e2bd3bba',
  'rift-entrance': '47aac082d4aefbd06b45aa6e8a78c6fdbaf712f4d642c07b5966309f40e36bda',
  'rift-descent': '61241a4f0ecd25e6dfe72c3752eb7d3a1ec48f9aa9d2ba775c32145416fc0142',
  'rift-beacon': '15af14d97277ff789f4dbb310e0317920ec5337e64a325800c4d376340a5afe0',
  'rift-egress': 'd1cef47c9431085cfc1740f28e16377da383072e7ed32c38cdb0271e363ffba7',
  'reward-treasure': '88f972df1bdb1d5384fb0784ab710603af91b5d9f38284f1953bf4604a8501e6',
  'reward-locked-cache': 'c901f44ac29f956bdfba242fbdf079f7be55d8c3e0f494beb7a060acd617eb08',
  'reward-reliquary': '582ab91ce6cd49ce8acbdde4d35ca2b989a6bb3a4c513c5b082df72feb653d99',
  'world-passage': '70d863ec13c182941d26507a8d881598262d007fa5a6ee1b92e60601dd172344',
} as const satisfies Readonly<Record<MapMarkerArtId, string>>;

type MarkerFamily =
  | 'dungeon'
  | 'gather'
  | 'station'
  | 'service'
  | 'quest'
  | 'questCooldown'
  | 'navigation'
  | 'reward';

type MarkerGenerationMode = 'precise-object-edit' | 'stylized-concept' | 'precise-object-design';

interface MarkerMappingEntry {
  id: MapMarkerArtId;
  family: MarkerFamily;
  file: string;
  motif: string;
  mode: MarkerGenerationMode;
  generatedResultPath: string;
  sourceSha256: string;
  promptSha256: string;
  shippingSha256: string;
  bytes: number;
  promptRef: string;
}

interface MarkerMapping {
  contract: string;
  supersedes: string;
  license: string;
  generator: string;
  sourceIconSize: number;
  shippingIconSize: number;
  shippingFormat: string;
  profiles: unknown;
  targetRenderSizes: unknown;
  runtimeStateOwnership: unknown;
  provenance: string;
  historicalProvenance: string;
  entries: MarkerMappingEntry[];
}

function markerMapping(): MarkerMapping {
  return JSON.parse(readFileSync(mappingPath, 'utf8')) as MarkerMapping;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function markdownAnchor(heading: string): string {
  return heading.trim().toLowerCase().replaceAll(' ', '-');
}

function acceptedPromptBody(section: string): string | undefined {
  const promptBody = section.match(/```text\n([\s\S]*?)\n```/)?.[1];
  // The V2 record stores the repository-forbidden punctuation as an ASCII
  // escape, then explicitly requires decoding it to recover the exact prompt.
  return promptBody?.replaceAll('\\u2013', String.fromCodePoint(0x2013));
}

function filenameFor(id: MapMarkerArtId): string {
  return `${id.replaceAll('-', '_')}.webp`;
}

function committedWebps(): string[] {
  if (!existsSync(markerDir)) return [];
  return readdirSync(markerDir)
    .filter((file) => path.extname(file).toLowerCase() === '.webp')
    .sort();
}

class FakeImage {
  decoding = '';
  complete = false;
  naturalWidth = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly srcAssignments: string[] = [];
  private value = '';

  get src(): string {
    return this.value;
  }

  set src(value: string) {
    this.value = value;
    this.srcAssignments.push(value);
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  readonly draws: Array<{
    image: FakeImage | FakeCanvas;
    args: number[];
  }> = [];
  readonly clears: number[][] = [];
  readonly fills: Array<{ style: string; composite: string; args: number[] }> = [];
  readonly imageDataReads: Array<{ x: number; y: number; width: number; height: number }> = [];
  readonly imageDataWrites: Array<{ x: number; y: number }> = [];
  readonly strokes: Array<{
    style: string;
    lineWidth: number;
    lineCap: string;
    arcs: number[][];
  }> = [];
  constructor(
    private readonly contextAvailable = true,
    private readonly imageDataFails = false,
  ) {}

  readonly context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    currentArcs: [] as number[][],
    drawImage: (image: FakeImage | FakeCanvas, ...args: number[]) => {
      this.draws.push({ image, args });
    },
    clearRect: (...args: number[]) => {
      this.clears.push(args);
    },
    fillRect: (...args: number[]) => {
      this.fills.push({
        style: this.context.fillStyle,
        composite: this.context.globalCompositeOperation,
        args,
      });
    },
    beginPath: () => {
      this.context.currentArcs = [];
    },
    moveTo: () => {},
    lineTo: () => {},
    arc: (...args: number[]) => {
      this.context.currentArcs.push(args);
    },
    stroke: () => {
      this.strokes.push({
        style: this.context.strokeStyle,
        lineWidth: this.context.lineWidth,
        lineCap: this.context.lineCap,
        arcs: this.context.currentArcs.map((arc) => [...arc]),
      });
    },
    getImageData: (x: number, y: number, width: number, height: number) => {
      this.imageDataReads.push({ x, y, width, height });
      if (this.imageDataFails) throw new Error('pixel access denied');
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    },
    putImageData: (_imageData: unknown, x: number, y: number) => {
      this.imageDataWrites.push({ x, y });
    },
  };

  getContext(kind: string): typeof this.context | null {
    return kind === '2d' && this.contextAvailable ? this.context : null;
  }
}

interface LoaderHarnessOptions {
  contextAvailable?: (canvasIndex: number) => boolean;
  imageDataFails?: (canvasIndex: number) => boolean;
  configureImage?: (image: FakeImage, imageIndex: number) => void;
}

function loaderHarness(options: LoaderHarnessOptions = {}): {
  art: ReturnType<typeof createMapMarkerArt>;
  images: FakeImage[];
  canvases: FakeCanvas[];
} {
  const images: FakeImage[] = [];
  const canvases: FakeCanvas[] = [];
  const hostDocument = {
    createElement: vi.fn((tag: string) => {
      expect(tag).toBe('canvas');
      const canvasIndex = canvases.length;
      const canvas = new FakeCanvas(
        options.contextAvailable?.(canvasIndex) ?? true,
        options.imageDataFails?.(canvasIndex) ?? false,
      );
      canvases.push(canvas);
      return canvas;
    }),
  };
  const art = createMapMarkerArt(
    hostDocument as unknown as Pick<Document, 'createElement'>,
    () => {
      const image = new FakeImage();
      options.configureImage?.(image, images.length);
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
    RASTER_COLORS,
  );
  return { art, images, canvases };
}

describe('map marker painted art', () => {
  it('resolves every one-time raster color from an exact design token', () => {
    expect(MAP_MARKER_RASTER_COLOR_TOKENS).toEqual({
      keyline: '--color-map-marker-keyline',
      cooldownArcDark: '--color-map-marker-cooldown-arc-dark',
      cooldownArcLight: '--color-map-marker-cooldown-arc-light',
      lockDark: '--color-map-marker-lock-dark',
      lockBronze: '--color-map-marker-lock-bronze',
      lockHighlight: '--color-map-marker-lock-highlight',
      semanticDark: '--color-map-marker-semantic-dark',
      semanticBronze: '--color-map-marker-semantic-bronze',
      semanticSilver: '--color-map-marker-semantic-silver',
      semanticGold: '--color-map-marker-semantic-gold',
      semanticCyan: '--color-map-marker-semantic-cyan',
      semanticJammed: '--color-map-marker-semantic-jammed',
      semanticOpened: '--color-map-marker-semantic-opened',
      neutralFallback: '--color-map-marker-neutral-fallback',
    });

    const reads: string[] = [];
    const resolved = resolveMapMarkerRasterColors({
      getPropertyValue: (token: string) => {
        reads.push(token);
        const key = Object.entries(MAP_MARKER_RASTER_COLOR_TOKENS).find(
          ([, expectedToken]) => expectedToken === token,
        )?.[0] as keyof MapMarkerRasterColors | undefined;
        return `  ${key ? RASTER_COLORS[key] : ''}  `;
      },
    } as Pick<CSSStyleDeclaration, 'getPropertyValue'>);
    expect(resolved).toEqual(RASTER_COLORS);
    expect(reads).toEqual(Object.values(MAP_MARKER_RASTER_COLOR_TOKENS));

    for (const [key, token] of Object.entries(MAP_MARKER_RASTER_COLOR_TOKENS) as Array<
      [keyof MapMarkerRasterColors, string]
    >) {
      const matches = tokenSource.match(new RegExp(`${token}:\\s*${RASTER_COLORS[key]};`, 'g'));
      expect(matches, token).toHaveLength(1);
    }
    const executableLoader = loaderSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(executableLoader.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(executableLoader.match(/\brgba?\s*\(/g)).toBeNull();
  });

  it('resolves the production default palette once and applies it to cached state rasters', () => {
    const images: FakeImage[] = [];
    const canvases: FakeCanvas[] = [];
    const root = {};
    const reads: string[] = [];
    const resolvedColors = Object.fromEntries(
      Object.keys(RASTER_COLORS).map((key) => [key, `resolved-${key}`]),
    ) as unknown as MapMarkerRasterColors;
    const style = {
      getPropertyValue: vi.fn((token: string) => {
        reads.push(token);
        const key = Object.entries(MAP_MARKER_RASTER_COLOR_TOKENS).find(
          ([, expectedToken]) => expectedToken === token,
        )?.[0] as keyof MapMarkerRasterColors | undefined;
        return key ? `  ${resolvedColors[key]}  ` : '';
      }),
    } as Pick<CSSStyleDeclaration, 'getPropertyValue'>;
    const getComputedStyleMock = vi.fn(() => style);
    vi.stubGlobal('getComputedStyle', getComputedStyleMock);

    try {
      const hostDocument = {
        documentElement: root,
        createElement: vi.fn((tag: string) => {
          expect(tag).toBe('canvas');
          const canvas = new FakeCanvas();
          canvases.push(canvas);
          return canvas;
        }),
      };
      const art = createMapMarkerArt(hostDocument as unknown as Document, () => {
        const image = new FakeImage();
        images.push(image);
        return image as unknown as HTMLImageElement;
      });

      expect(getComputedStyleMock).toHaveBeenCalledTimes(1);
      expect(getComputedStyleMock).toHaveBeenCalledWith(root);
      expect(reads).toEqual(Object.values(MAP_MARKER_RASTER_COLOR_TOKENS));
      expect(style.getPropertyValue).toHaveBeenCalledTimes(reads.length);

      expect(art.sprite('gather-ore', 'minimapGatherCooldownLocked')).toBeNull();
      images[0].onload?.();
      expect(art.sprite('gather-ore', 'minimapGatherCooldownLocked')).not.toBeNull();

      expect(art.sprite('rift-entrance', 'minimapNavigationRankS')).toBeNull();
      images[1].onload?.();
      expect(art.sprite('rift-entrance', 'minimapNavigationRankS')).not.toBeNull();

      const fillColors = new Set(
        canvases.flatMap((canvas) => canvas.fills.map((fill) => fill.style)),
      );
      const strokeColors = new Set(
        canvases.flatMap((canvas) => canvas.strokes.map((stroke) => stroke.style)),
      );
      for (const color of [
        resolvedColors.keyline,
        resolvedColors.lockDark,
        resolvedColors.lockBronze,
        resolvedColors.lockHighlight,
        resolvedColors.semanticDark,
        resolvedColors.semanticGold,
      ]) {
        expect(fillColors).toContain(color);
      }
      for (const color of [
        resolvedColors.cooldownArcDark,
        resolvedColors.cooldownArcLight,
        resolvedColors.lockDark,
        resolvedColors.lockBronze,
        resolvedColors.semanticDark,
        resolvedColors.semanticGold,
      ]) {
        expect(strokeColors).toContain(color);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refreshes a changed default palette without reloading decoded marker sources', () => {
    const images: FakeImage[] = [];
    const canvases: FakeCanvas[] = [];
    const root = {};
    let palettePrefix = 'initial';
    const style = {
      getPropertyValue: vi.fn((token: string) => {
        const key = Object.entries(MAP_MARKER_RASTER_COLOR_TOKENS).find(
          ([, expectedToken]) => expectedToken === token,
        )?.[0];
        return key ? `${palettePrefix}-${key}` : '';
      }),
    } as Pick<CSSStyleDeclaration, 'getPropertyValue'>;
    const getComputedStyleMock = vi.fn(() => style);
    vi.stubGlobal('getComputedStyle', getComputedStyleMock);

    try {
      const hostDocument = {
        documentElement: root,
        createElement: vi.fn((tag: string) => {
          expect(tag).toBe('canvas');
          const canvas = new FakeCanvas();
          canvases.push(canvas);
          return canvas;
        }),
      };
      const art = createMapMarkerArt(hostDocument as unknown as Document, () => {
        const image = new FakeImage();
        images.push(image);
        return image as unknown as HTMLImageElement;
      });

      expect(art.sprite('rift-entrance', 'minimapNavigationRankS')).toBeNull();
      images[0].onload?.();
      const initialSprite = art.sprite('rift-entrance', 'minimapNavigationRankS');
      expect(initialSprite).not.toBeNull();
      const initialCanvasCount = canvases.length;

      art.refreshPalette();
      expect(art.sprite('rift-entrance', 'minimapNavigationRankS')).toBe(initialSprite);
      expect(canvases).toHaveLength(initialCanvasCount);

      palettePrefix = 'refreshed';
      art.refreshPalette();
      const refreshedSprite = art.sprite('rift-entrance', 'minimapNavigationRankS');

      expect(refreshedSprite).not.toBeNull();
      expect(refreshedSprite).not.toBe(initialSprite);
      expect(images).toHaveLength(1);
      expect(images[0].srcAssignments).toEqual([mapMarkerIconUrl('rift-entrance')]);
      expect(getComputedStyleMock).toHaveBeenCalledTimes(3);
      expect(getComputedStyleMock).toHaveBeenLastCalledWith(root);
      const refreshedCanvases = canvases.slice(initialCanvasCount);
      expect(refreshedCanvases.length).toBeGreaterThan(0);
      const refreshedFills = refreshedCanvases.flatMap((canvas) =>
        canvas.fills.map((fill) => fill.style),
      );
      const refreshedStrokes = refreshedCanvases.flatMap((canvas) =>
        canvas.strokes.map((stroke) => stroke.style),
      );
      expect(refreshedFills).toEqual(
        expect.arrayContaining(['refreshed-keyline', 'refreshed-semanticGold']),
      );
      expect(refreshedStrokes).toEqual(
        expect.arrayContaining(['refreshed-semanticDark', 'refreshed-semanticGold']),
      );
      expect(refreshedFills.some((color) => color.startsWith('initial-'))).toBe(false);
      expect(refreshedStrokes.some((color) => color.startsWith('initial-'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rebuilds every decoded marker when one non-first palette token changes', () => {
    const images: FakeImage[] = [];
    const canvases: FakeCanvas[] = [];
    let palette: MapMarkerRasterColors = { ...RASTER_COLORS };
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (token: string) => {
        const key = Object.entries(MAP_MARKER_RASTER_COLOR_TOKENS).find(
          ([, expectedToken]) => expectedToken === token,
        )?.[0] as keyof MapMarkerRasterColors | undefined;
        return key ? palette[key] : '';
      },
    }));

    try {
      const art = createMapMarkerArt(
        {
          documentElement: {},
          createElement: () => {
            const canvas = new FakeCanvas();
            canvases.push(canvas);
            return canvas;
          },
        } as unknown as Document,
        () => {
          const image = new FakeImage();
          images.push(image);
          return image as unknown as HTMLImageElement;
        },
      );

      expect(art.sprite('reward-reliquary', 'minimapRewardActive')).toBeNull();
      images[0].onload?.();
      expect(art.sprite('rift-entrance', 'minimapNavigationRankS')).toBeNull();
      images[1].onload?.();
      const activeBefore = art.sprite('reward-reliquary', 'minimapRewardActive');
      const rankBefore = art.sprite('rift-entrance', 'minimapNavigationRankS');
      const initialCanvasCount = canvases.length;

      const refreshedCyan = '#16bde8';
      palette = { ...palette, semanticCyan: refreshedCyan };
      art.refreshPalette();

      expect(art.sprite('reward-reliquary', 'minimapRewardActive')).not.toBe(activeBefore);
      expect(art.sprite('rift-entrance', 'minimapNavigationRankS')).not.toBe(rankBefore);
      expect(images).toHaveLength(2);
      expect(images[0].srcAssignments).toEqual([mapMarkerIconUrl('reward-reliquary')]);
      expect(images[1].srcAssignments).toEqual([mapMarkerIconUrl('rift-entrance')]);
      const refreshedStrokes = canvases
        .slice(initialCanvasCount)
        .flatMap((canvas) => canvas.strokes.map((stroke) => stroke.style));
      expect(refreshedStrokes).toContain(refreshedCyan);
      expect(refreshedStrokes).not.toContain(RASTER_COLORS.semanticCyan);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the latest palette when a source finishes decoding after a refresh', () => {
    const images: FakeImage[] = [];
    const canvases: FakeCanvas[] = [];
    let palettePrefix = 'initial';
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (token: string) => {
        const key = Object.entries(MAP_MARKER_RASTER_COLOR_TOKENS).find(
          ([, expectedToken]) => expectedToken === token,
        )?.[0];
        return key ? `${palettePrefix}-${key}` : '';
      },
    }));

    try {
      const art = createMapMarkerArt(
        {
          documentElement: {},
          createElement: () => {
            const canvas = new FakeCanvas();
            canvases.push(canvas);
            return canvas;
          },
        } as unknown as Document,
        () => {
          const image = new FakeImage();
          images.push(image);
          return image as unknown as HTMLImageElement;
        },
      );

      expect(art.sprite('gather-ore', 'minimapGatherCooldownLocked')).toBeNull();
      expect(images).toHaveLength(1);
      expect(canvases).toHaveLength(0);

      palettePrefix = 'latest';
      art.refreshPalette();
      images[0].onload?.();

      expect(art.sprite('gather-ore', 'minimapGatherCooldownLocked')).not.toBeNull();
      expect(images).toHaveLength(1);
      expect(images[0].srcAssignments).toEqual([mapMarkerIconUrl('gather-ore')]);
      const bakedFills = canvases.flatMap((canvas) => canvas.fills.map((fill) => fill.style));
      const bakedStrokes = canvases.flatMap((canvas) =>
        canvas.strokes.map((stroke) => stroke.style),
      );
      expect(bakedFills).toEqual(
        expect.arrayContaining([
          'latest-keyline',
          'latest-lockDark',
          'latest-lockBronze',
          'latest-lockHighlight',
        ]),
      );
      expect(bakedStrokes).toEqual(
        expect.arrayContaining([
          'latest-cooldownArcDark',
          'latest-cooldownArcLight',
          'latest-lockDark',
          'latest-lockBronze',
        ]),
      );
      expect(bakedFills.some((color) => color.startsWith('initial-'))).toBe(false);
      expect(bakedStrokes.some((color) => color.startsWith('initial-'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the closed catalog, URL routes, and committed WebPs in exact bijection', () => {
    const expectedIds = [
      'dungeon-entrance',
      'dungeon-exit',
      ...GATHER_TYPES.map((type) => `gather-${type}`),
      ...STATION_TYPES.map((type) => `station-${type}`),
      'service-mailbox',
      'service-noticeboard',
      'quest-available',
      'quest-ready',
      'quest-repeat',
      'quest-cooldown',
      'delve-entrance',
      'delve-passage',
      'delve-surface-exit',
      'rift-entrance',
      'rift-descent',
      'rift-beacon',
      'rift-egress',
      'reward-treasure',
      'reward-locked-cache',
      'reward-reliquary',
      'world-passage',
    ];
    expect([...MAP_MARKER_ART_IDS]).toEqual(expectedIds);
    expect(committedWebps()).toEqual(MAP_MARKER_ART_IDS.map(filenameFor).sort());

    for (const id of MAP_MARKER_ART_IDS) {
      expect(mapMarkerIconUrl(id)).toBe(`/ui/map-markers/${filenameFor(id)}`);
    }

    const sourceRasterFiles = existsSync(markerDir)
      ? readdirSync(markerDir)
          .filter((file) => /\.(?:avif|gif|jpe?g|png|tiff?)$/i.test(file))
          .sort()
      : [];
    expect(
      sourceRasterFiles,
      'only optimized WebPs may ship in the runtime marker directory',
    ).toEqual([]);
  });

  it('maps every gather and station identity to a painted catalog id', () => {
    expect(GATHER_TYPES.map(gatherMarkerArtId)).toEqual([
      'gather-ore',
      'gather-wood',
      'gather-herb',
    ]);
    expect(STATION_TYPES.map(stationMarkerArtId)).toEqual([
      'station-forge',
      'station-kitchens',
      'station-apothecary',
      'station-tannery',
      'station-loom',
      'station-toolworks',
    ]);
    expect((['available', 'ready', 'repeat', 'cooldown'] as const).map(questMarkerArtId)).toEqual([
      'quest-available',
      'quest-ready',
      'quest-repeat',
      'quest-cooldown',
    ]);
  });

  it('pins the complete accepted-art ownership, source, prompt, and credit contract', () => {
    const mapping = markerMapping();
    expect(Object.keys(mapping).sort()).toEqual(
      [
        'contract',
        'entries',
        'generator',
        'historicalProvenance',
        'license',
        'profiles',
        'provenance',
        'runtimeStateOwnership',
        'shippingFormat',
        'shippingIconSize',
        'sourceIconSize',
        'supersedes',
        'targetRenderSizes',
      ].sort(),
    );
    expect(mapping).toMatchObject({
      contract: 'woc-map-marker-art-v2',
      supersedes: 'woc-map-marker-art-v1',
      license:
        'World of ClaudeCraft project-generated art, project asset, rights reserved. No redistribution without permission.',
      generator: 'OpenAI built-in image generation',
      sourceIconSize: 1254,
      shippingIconSize: 64,
      shippingFormat: 'sRGB WebP with alpha',
      profiles: {
        standard: 'Desktop and standard touch portrait.',
        compact: 'Touch landscape and the explicit compact HUD, compensating for scaled UI chrome.',
      },
      targetRenderSizes: {
        gatherReady: {
          standard: { minimap: 18, map: 20 },
          compact: { minimap: 24, map: 28 },
        },
        gatherCooldown: {
          standard: { minimap: 16, map: 18 },
          compact: { minimap: 22, map: 26 },
        },
        dungeon: {
          standard: { minimap: 18, map: 20 },
          compact: { minimap: 24, map: 30 },
        },
        station: {
          standard: { minimap: 16, map: 20 },
          compact: { minimap: 22, map: 28 },
        },
        service: {
          standard: { minimap: 16, map: 20 },
          compact: { minimap: 22, map: 28 },
        },
        quest: {
          standard: { minimap: 20, map: 24 },
          compact: { minimap: 26, map: 32 },
        },
        questCooldown: {
          standard: { minimap: 16, map: 18 },
          compact: { minimap: 22, map: 26 },
        },
        navigation: {
          standard: { minimap: 18, map: 22 },
          compact: { minimap: 24, map: 30 },
        },
        reward: {
          standard: { minimap: 18, map: 20 },
          compact: { minimap: 24, map: 28 },
        },
      },
      runtimeStateOwnership: {
        masters:
          'The 64px masters supply stable marker identity. Quest masters also own actionable available, ready, repeatable, and cooldown state silhouettes.',
        loader:
          'One shared bounded loader precomputes every exact standard and compact raster. It adds the terrain-separating keyline. Gathering cooldown uses a smaller grayscale subject inside a broken 300 degree neutral ring. Tool-locked gathering variants add a bronze padlock independently to both ready and cooldown states. Navigation variants add sealed locks or C, B, A, and S rank rings with one to four notches; S also adds a bottom diamond. Reward variants add locked, active, opened, jammed, and bountiful treatments. Opened and jammed rewards are grayscale; state overlays remain full alpha.',
        painters:
          'Runtime painters own ready glow, labels, hover and hit state, stacking, clipping, tracking emphasis, and dynamic entity state. They select one cached raster and blit it without per-marker image allocation, canvas filtering, or text rendering.',
        procedural:
          'Neutral NPCs and live player, party, enemy, loot, corpse, battleground, and direction markers remain procedural so changing state is never baked into a fixed painting.',
      },
      provenance: v2ProvenanceRef,
      historicalProvenance: historicalProvenanceRef,
    });
    expect(mapping.entries.map(({ id }) => id)).toEqual([...MAP_MARKER_ART_IDS]);
    expect(new Set(mapping.entries.map(({ id }) => id)).size).toBe(MAP_MARKER_ART_IDS.length);
    expect(Object.keys(mapping.profiles as object).sort()).toEqual(['compact', 'standard']);
    expect(Object.keys(mapping.targetRenderSizes as object).sort()).toEqual(
      [
        'dungeon',
        'gatherCooldown',
        'gatherReady',
        'navigation',
        'quest',
        'questCooldown',
        'reward',
        'service',
        'station',
      ].sort(),
    );
    expect(Object.keys(mapping.runtimeStateOwnership as object).sort()).toEqual(
      ['loader', 'masters', 'painters', 'procedural'].sort(),
    );

    const provenanceByRef = new Map([
      [historicalProvenanceRef, readFileSync(historicalProvenancePath, 'utf8')],
      [v2ProvenanceRef, readFileSync(v2ProvenancePath, 'utf8')],
    ]);
    const expectedFamilies: Readonly<Record<MapMarkerArtId, MarkerFamily>> = {
      'dungeon-entrance': 'dungeon',
      'dungeon-exit': 'dungeon',
      'gather-ore': 'gather',
      'gather-wood': 'gather',
      'gather-herb': 'gather',
      'station-forge': 'station',
      'station-kitchens': 'station',
      'station-apothecary': 'station',
      'station-tannery': 'station',
      'station-loom': 'station',
      'station-toolworks': 'station',
      'service-mailbox': 'service',
      'service-noticeboard': 'service',
      'quest-available': 'quest',
      'quest-ready': 'quest',
      'quest-repeat': 'quest',
      'quest-cooldown': 'questCooldown',
      'delve-entrance': 'navigation',
      'delve-passage': 'navigation',
      'delve-surface-exit': 'navigation',
      'rift-entrance': 'navigation',
      'rift-descent': 'navigation',
      'rift-beacon': 'navigation',
      'rift-egress': 'navigation',
      'reward-treasure': 'reward',
      'reward-locked-cache': 'reward',
      'reward-reliquary': 'reward',
      'world-passage': 'navigation',
    };
    const validModes = new Set<MarkerGenerationMode>([
      'precise-object-edit',
      'stylized-concept',
      'precise-object-design',
    ]);
    expect(new Set(mapping.entries.map(({ mode }) => mode))).toEqual(validModes);

    const sourcePaths = new Set<string>();
    for (const entry of mapping.entries) {
      expect(Object.keys(entry).sort(), `${entry.id} mapping fields`).toEqual(
        [
          'bytes',
          'family',
          'file',
          'generatedResultPath',
          'id',
          'mode',
          'motif',
          'promptRef',
          'promptSha256',
          'shippingSha256',
          'sourceSha256',
        ].sort(),
      );
      expect(entry.family, `${entry.id} family`).toBe(expectedFamilies[entry.id]);
      expect(validModes.has(entry.mode), `${entry.id} generation mode`).toBe(true);
      expect(entry.file, `${entry.id} file`).toBe(filenameFor(entry.id));
      expect(entry.motif.trim().length, `${entry.id} motif`).toBeGreaterThan(10);
      expect(entry.generatedResultPath, `${entry.id} generated result`).toMatch(
        /\/generated_images\/[^/]+\/exec-[^/]+\.png$/,
      );
      expect(
        sourcePaths.has(entry.generatedResultPath),
        `${entry.id} unique generated result`,
      ).toBe(false);
      sourcePaths.add(entry.generatedResultPath);
      expect(entry.sourceSha256, `${entry.id} accepted source hash`).toBe(
        SOURCE_SHA256_BY_ID[entry.id],
      );
      if (existsSync(entry.generatedResultPath)) {
        expect(
          sha256(readFileSync(entry.generatedResultPath)),
          `${entry.id} retained generated source hash`,
        ).toBe(entry.sourceSha256);
      }
      const promptRefMatch = entry.promptRef.match(/^(.*\.md)#(.+)$/);
      expect(promptRefMatch, `${entry.id} exact prompt reference`).not.toBeNull();
      const promptDocRef = promptRefMatch?.[1] ?? '';
      const promptAnchor = promptRefMatch?.[2] ?? '';
      expect([historicalProvenanceRef, v2ProvenanceRef], `${entry.id} prompt document`).toContain(
        promptDocRef,
      );
      expect(promptAnchor, `${entry.id} prompt anchor`).toBe(entry.id);
      const provenance = provenanceByRef.get(promptDocRef) ?? '';
      const promptHeadings = [...provenance.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
      const heading = promptHeadings.find((candidate) => markdownAnchor(candidate) === entry.id);
      expect(heading, `${entry.id} prompt heading`).toBeDefined();
      const sectionStart = provenance.indexOf(`### ${heading}`);
      const nextSection = provenance.indexOf('\n### ', sectionStart + 4);
      const section = provenance.slice(
        sectionStart,
        nextSection === -1 ? provenance.length : nextSection,
      );
      // Some legacy prompt bodies predate the structured Use case prefix.
      // The mapping enum is nevertheless closed and its prompt hash is pinned
      // below; where a mode declaration exists, it must agree with the entry.
      const declaredMode = section.match(/(?:Mode: `|Use case: )([a-z-]+)/)?.[1];
      if (declaredMode !== undefined)
        expect(declaredMode, `${entry.id} generation mode`).toBe(entry.mode);
      expect(section, `${entry.id} exact accepted prompt`).toMatch(/```text\n[\s\S]{500,}\n```/);
      const promptBody = acceptedPromptBody(section);
      expect(promptBody, `${entry.id} accepted prompt body`).toBeDefined();
      expect(
        sha256(Buffer.from(promptBody ?? '', 'utf8')),
        `${entry.id} accepted prompt body hash`,
      ).toBe(PROMPT_SHA256_BY_ID[entry.id]);
      expect(entry.promptSha256, `${entry.id} mapped prompt body hash`).toBe(
        PROMPT_SHA256_BY_ID[entry.id],
      );
      expect(section, `${entry.id} reference lineage`).toMatch(
        /(?:References?, in order:|References: set [A-Z])/,
      );
    }

    const creditRows = readFileSync(creditsPath, 'utf8')
      .split('\n')
      .filter((line) => line.includes('public/ui/map-markers/*.webp'));
    expect(creditRows).toEqual([
      '| Map and minimap marker paintings (`public/ui/map-markers/*.webp`) | World of ClaudeCraft | Twenty-eight original micro-icons generated with OpenAI built-in image generation from the exact World of ClaudeCraft references and prompts recorded in `public/ui/map-markers/mapping.json`; the [V1 map-marker lineage](docs/achievements/map-marker-art-2026-08-12.md) preserves the first accepted batch and the [V2 map-marker lineage](docs/achievements/map-marker-art-v2-2026-08-12.md) records the responsive redesigns, gathering and reward state treatments, four painted quest states, and the delve, rift, Duskfall passage, and reward families, all chroma-keyed, reviewed at actual runtime sizes, and optimized locally | Project asset, rights reserved | **No, permission required** |',
    ]);
  });

  it('pins the micro-scale raster sizes to only the consumers that use each family', () => {
    expect(MAP_MARKER_SIZES).toEqual({
      minimapGatherReady: 18,
      minimapGatherReadyCompact: 24,
      minimapGatherReadyLocked: 18,
      minimapGatherReadyLockedCompact: 24,
      minimapGatherCooldown: 16,
      minimapGatherCooldownCompact: 22,
      minimapGatherCooldownLocked: 16,
      minimapGatherCooldownLockedCompact: 22,
      mapGatherReady: 20,
      mapGatherReadyCompact: 28,
      mapGatherReadyLocked: 20,
      mapGatherReadyLockedCompact: 28,
      mapGatherCooldown: 18,
      mapGatherCooldownCompact: 26,
      mapGatherCooldownLocked: 18,
      mapGatherCooldownLockedCompact: 26,
      minimapDungeon: 18,
      minimapDungeonCompact: 24,
      mapDungeon: 20,
      mapDungeonCompact: 30,
      minimapStation: 16,
      minimapStationCompact: 22,
      mapStation: 20,
      mapStationCompact: 28,
      minimapService: 16,
      minimapServiceCompact: 22,
      mapService: 20,
      mapServiceCompact: 28,
      minimapQuest: 20,
      minimapQuestCompact: 26,
      minimapQuestCooldown: 16,
      minimapQuestCooldownCompact: 22,
      mapQuest: 24,
      mapQuestCompact: 32,
      mapQuestCooldown: 18,
      mapQuestCooldownCompact: 26,
      minimapNavigation: 18,
      minimapNavigationCompact: 24,
      minimapNavigationLocked: 18,
      minimapNavigationLockedCompact: 24,
      mapNavigation: 22,
      mapNavigationCompact: 30,
      mapNavigationLocked: 22,
      mapNavigationLockedCompact: 30,
      minimapNavigationRankC: 18,
      minimapNavigationRankCCompact: 24,
      minimapNavigationRankB: 18,
      minimapNavigationRankBCompact: 24,
      minimapNavigationRankA: 18,
      minimapNavigationRankACompact: 24,
      minimapNavigationRankS: 18,
      minimapNavigationRankSCompact: 24,
      mapNavigationRankC: 22,
      mapNavigationRankCCompact: 30,
      mapNavigationRankB: 22,
      mapNavigationRankBCompact: 30,
      mapNavigationRankA: 22,
      mapNavigationRankACompact: 30,
      mapNavigationRankS: 22,
      mapNavigationRankSCompact: 30,
      minimapRewardAvailable: 18,
      minimapRewardAvailableCompact: 24,
      minimapRewardLocked: 18,
      minimapRewardLockedCompact: 24,
      minimapRewardActive: 18,
      minimapRewardActiveCompact: 24,
      minimapRewardOpened: 18,
      minimapRewardOpenedCompact: 24,
      minimapRewardJammed: 18,
      minimapRewardJammedCompact: 24,
      minimapRewardAvailableBountiful: 18,
      minimapRewardAvailableBountifulCompact: 24,
      minimapRewardLockedBountiful: 18,
      minimapRewardLockedBountifulCompact: 24,
      minimapRewardActiveBountiful: 18,
      minimapRewardActiveBountifulCompact: 24,
      minimapRewardOpenedBountiful: 18,
      minimapRewardOpenedBountifulCompact: 24,
      minimapRewardJammedBountiful: 18,
      minimapRewardJammedBountifulCompact: 24,
      mapRewardAvailable: 20,
      mapRewardAvailableCompact: 28,
      mapRewardLocked: 20,
      mapRewardLockedCompact: 28,
      mapRewardActive: 20,
      mapRewardActiveCompact: 28,
      mapRewardOpened: 20,
      mapRewardOpenedCompact: 28,
      mapRewardJammed: 20,
      mapRewardJammedCompact: 28,
      mapRewardAvailableBountiful: 20,
      mapRewardAvailableBountifulCompact: 28,
      mapRewardLockedBountiful: 20,
      mapRewardLockedBountifulCompact: 28,
      mapRewardActiveBountiful: 20,
      mapRewardActiveBountifulCompact: 28,
      mapRewardOpenedBountiful: 20,
      mapRewardOpenedBountifulCompact: 28,
      mapRewardJammedBountiful: 20,
      mapRewardJammedBountifulCompact: 28,
    });
    expect(mapMarkerSizesFor('dungeon-entrance')).toEqual([
      'minimapDungeon',
      'minimapDungeonCompact',
      'mapDungeon',
      'mapDungeonCompact',
    ]);
    expect(mapMarkerSizesFor('dungeon-exit')).toEqual([
      'minimapDungeon',
      'minimapDungeonCompact',
      'mapDungeon',
      'mapDungeonCompact',
    ]);
    for (const type of GATHER_TYPES) {
      expect(mapMarkerSizesFor(gatherMarkerArtId(type))).toEqual([
        'minimapGatherReady',
        'minimapGatherReadyCompact',
        'minimapGatherReadyLocked',
        'minimapGatherReadyLockedCompact',
        'minimapGatherCooldown',
        'minimapGatherCooldownCompact',
        'minimapGatherCooldownLocked',
        'minimapGatherCooldownLockedCompact',
        'mapGatherReady',
        'mapGatherReadyCompact',
        'mapGatherReadyLocked',
        'mapGatherReadyLockedCompact',
        'mapGatherCooldown',
        'mapGatherCooldownCompact',
        'mapGatherCooldownLocked',
        'mapGatherCooldownLockedCompact',
      ]);
    }
    for (const type of STATION_TYPES) {
      expect(mapMarkerSizesFor(stationMarkerArtId(type))).toEqual([
        'minimapStation',
        'minimapStationCompact',
        'mapStation',
        'mapStationCompact',
      ]);
    }
    expect(mapMarkerSizesFor('service-mailbox')).toEqual([
      'minimapService',
      'minimapServiceCompact',
      'mapService',
      'mapServiceCompact',
    ]);
    expect(mapMarkerSizesFor('service-noticeboard')).toEqual([
      'minimapService',
      'minimapServiceCompact',
      'mapService',
      'mapServiceCompact',
    ]);
    for (const id of ['quest-available', 'quest-ready', 'quest-repeat'] as const) {
      expect(mapMarkerSizesFor(id)).toEqual([
        'minimapQuest',
        'minimapQuestCompact',
        'mapQuest',
        'mapQuestCompact',
      ]);
    }
    expect(mapMarkerSizesFor('quest-cooldown')).toEqual([
      'minimapQuestCooldown',
      'minimapQuestCooldownCompact',
      'mapQuestCooldown',
      'mapQuestCooldownCompact',
    ]);
  });

  it('ships distinct transparent 64px sRGB WebPs under the micro-icon byte budget', async () => {
    const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as {
      entries: Array<{
        id: string;
        file: string;
        shippingSha256: string;
        bytes: number;
      }>;
    };
    expect(mapping.entries.map((entry) => entry.id)).toEqual([...MAP_MARKER_ART_IDS]);
    const hashes = new Set<string>();
    for (const id of MAP_MARKER_ART_IDS) {
      const file = path.join(markerDir, filenameFor(id));
      const bytes = readFileSync(file);
      expect(bytes.length, `${id} byte budget`).toBeLessThanOrEqual(6 * 1024);

      const hash = sha256(bytes);
      expect(hash, `${id} literal shipping hash`).toBe(SHIPPING_SHA256_BY_ID[id]);
      expect(mapping.entries.find((entry) => entry.id === id)).toMatchObject({
        file: filenameFor(id),
        shippingSha256: SHIPPING_SHA256_BY_ID[id],
        bytes: bytes.length,
      });
      expect(hashes.has(hash), `${id} must not duplicate another marker`).toBe(false);
      hashes.add(hash);

      const metadata = await sharp(bytes).metadata();
      expect(metadata, `${id} metadata`).toMatchObject({
        format: 'webp',
        width: 64,
        height: 64,
        space: 'srgb',
        hasAlpha: true,
      });

      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const alphaAt = (x: number, y: number): number =>
        decoded.data[(y * decoded.info.width + x) * decoded.info.channels + 3];
      expect(
        [alphaAt(0, 0), alphaAt(63, 0), alphaAt(0, 63), alphaAt(63, 63)],
        `${id} transparent corners`,
      ).toEqual([0, 0, 0, 0]);
      const perimeterAlpha: number[] = [];
      for (let coordinate = 0; coordinate < 64; coordinate++) {
        perimeterAlpha.push(
          alphaAt(coordinate, 0),
          alphaAt(coordinate, 63),
          alphaAt(0, coordinate),
          alphaAt(63, coordinate),
        );
      }
      expect(Math.max(...perimeterAlpha), `${id} transparent perimeter`).toBe(0);

      let visiblePixels = 0;
      let opaquePixels = 0;
      for (let offset = 3; offset < decoded.data.length; offset += decoded.info.channels) {
        const alpha = decoded.data[offset];
        if (alpha >= 8) visiblePixels++;
        if (alpha >= 240) opaquePixels++;
      }
      const coverage = visiblePixels / (decoded.info.width * decoded.info.height);
      expect(coverage, `${id} must read at tiny scale`).toBeGreaterThanOrEqual(0.3);
      // Reward silhouettes are the deliberate upper edge. The open treasure
      // coffer is 0.72021484375 and the locked coffer is 0.7275390625; 0.728
      // keeps the breathing-room gate strict and literal.
      expect(coverage, `${id} must retain transparent breathing room`).toBeLessThanOrEqual(0.728);
      expect(opaquePixels, `${id} must contain a solid readable silhouette`).toBeGreaterThan(0);
    }
  });

  it('decodes each source once and pre-rasterizes only its bounded consumer sizes', () => {
    const { art, images, canvases } = loaderHarness();

    art.preload();
    art.preload();
    expect(images).toHaveLength(MAP_MARKER_ART_IDS.length);
    expect(canvases).toHaveLength(0);
    for (const [index, id] of MAP_MARKER_ART_IDS.entries()) {
      expect(art.sprite(id, mapMarkerSizesFor(id)[0])).toBeNull();
      expect(images[index].decoding).toBe('async');
      expect(images[index].srcAssignments).toEqual([mapMarkerIconUrl(id)]);
    }
    expect(images).toHaveLength(MAP_MARKER_ART_IDS.length);

    for (const image of images) image.onload?.();

    const expectedCanvasCount = MAP_MARKER_ART_IDS.reduce(
      (total, id) => total + mapMarkerSizesFor(id).length,
      0,
    );
    // Closed catalog bound, including all exact profile, rank, reward-state,
    // and bountiful variants. No painter creates a state canvas at redraw time.
    expect(expectedCanvasCount).toBe(248);
    // One reusable scratch surface prepares every retained exact-size raster.
    expect(canvases).toHaveLength(expectedCanvasCount + 1);
    const scratch = canvases[0];
    const retainedSprites = new Set<FakeCanvas>();

    for (const [index, id] of MAP_MARKER_ART_IDS.entries()) {
      const expectedSizes = new Set(mapMarkerSizesFor(id));
      const sourceDraws = scratch.draws.filter((draw) => draw.image === images[index]);
      expect(sourceDraws).toHaveLength(expectedSizes.size);
      for (const size of expectedSizes) {
        const sprite = art.sprite(id, size);
        expect(sprite).not.toBeNull();
        const canvas = sprite as unknown as FakeCanvas;
        retainedSprites.add(canvas);
        expect([canvas.width, canvas.height]).toEqual([
          MAP_MARKER_SIZES[size],
          MAP_MARKER_SIZES[size],
        ]);
        expect(canvas.context.imageSmoothingEnabled).toBe(true);
        expect(canvas.context.imageSmoothingQuality).toBe('high');
        expect(canvas.draws).toHaveLength(9);
        expect(canvas.draws.every((draw) => draw.image === scratch)).toBe(true);
        expect(canvas.draws.slice(0, 8).map(({ args }) => args)).toEqual([
          [-1, -1],
          [0, -1],
          [1, -1],
          [-1, 0],
          [1, 0],
          [-1, 1],
          [0, 1],
          [1, 1],
        ]);
        expect(canvas.draws[8].args).toEqual([0, 0]);
        expect(canvas.fills[0]).toEqual({
          style: '#f5dfad',
          composite: 'source-in',
          args: [0, 0, MAP_MARKER_SIZES[size], MAP_MARKER_SIZES[size]],
        });
        const locked = size.includes('Gather') && size.includes('Locked');
        if (!size.includes('Navigation') && !size.includes('Reward')) {
          expect(canvas.fills.slice(1).map((fill) => fill.style)).toEqual(
            locked ? ['#24170f', '#d39a45', '#f2c46d', '#24170f'] : [],
          );
        }
        expect(canvas.context.globalCompositeOperation).toBe('source-over');
      }
      for (const size of Object.keys(MAP_MARKER_SIZES) as MapMarkerSize[]) {
        if (!expectedSizes.has(size)) expect(art.sprite(id, size)).toBeNull();
      }
      for (const [draw, size] of sourceDraws.map((entry, sourceIndex) => [
        entry,
        mapMarkerSizesFor(id)[sourceIndex],
      ]) as Array<[FakeCanvas['draws'][number], MapMarkerSize]>) {
        const pixels = MAP_MARKER_SIZES[size];
        const inset = size.includes('GatherCooldown') ? 2 : 1;
        expect(draw.args).toEqual([inset, inset, pixels - inset * 2, pixels - inset * 2]);
      }
    }
    expect(retainedSprites.size).toBe(expectedCanvasCount);
    // Every cooldown surface/profile/lock combination is pre-neutralized once;
    // every ready and non-gather keyline path stays compositor-only.
    expect(scratch.imageDataReads).toHaveLength(GATHER_TYPES.length * 8 + 24);
    expect(scratch.imageDataWrites).toHaveLength(GATHER_TYPES.length * 8 + 24);

    const imageCount = images.length;
    const canvasCount = canvases.length;
    art.preload();
    for (const [index, id] of MAP_MARKER_ART_IDS.entries()) {
      for (const size of mapMarkerSizesFor(id)) art.sprite(id, size);
      images[index].onload?.();
    }
    expect(images).toHaveLength(imageCount);
    expect(canvases).toHaveLength(canvasCount);
  });

  it('converts cooldown color to neutral luminance while preserving alpha', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0]);
    grayscaleMapMarkerPixels(pixels);
    expect([...pixels]).toEqual([81, 81, 81, 255, 177, 177, 177, 128, 54, 54, 54, 0]);
  });

  it('precomputes independent ready, cooldown, and locked gathering grammar', () => {
    const { art, images } = loaderHarness();
    expect(art.sprite('gather-ore', 'minimapGatherReady')).toBeNull();
    images[0].onload?.();

    const canvasFor = (size: MapMarkerSize): FakeCanvas => {
      const sprite = art.sprite('gather-ore', size);
      expect(sprite).not.toBeNull();
      return sprite as unknown as FakeCanvas;
    };
    const ready = canvasFor('minimapGatherReady');
    const readyLocked = canvasFor('minimapGatherReadyLocked');
    const cooldown = canvasFor('minimapGatherCooldown');
    const cooldownLocked = canvasFor('minimapGatherCooldownLocked');

    expect(ready.strokes).toEqual([]);
    expect(readyLocked.strokes.map((stroke) => stroke.style)).toEqual(['#24170f', '#d39a45']);
    expect(cooldown.strokes.map((stroke) => stroke.style)).toEqual(['#24292a', '#c8cdcc']);
    expect(cooldownLocked.strokes.map((stroke) => stroke.style)).toEqual([
      '#24292a',
      '#c8cdcc',
      '#24170f',
      '#d39a45',
    ]);
    expect(cooldown.strokes.every((stroke) => stroke.lineCap === 'round')).toBe(true);
    expect(cooldown.strokes.every((stroke) => stroke.arcs[0]?.length === 5)).toBe(true);

    expect(ready.fills.map((fill) => fill.style)).toEqual(['#f5dfad']);
    expect(readyLocked.fills.map((fill) => fill.style)).toEqual([
      '#f5dfad',
      '#24170f',
      '#d39a45',
      '#f2c46d',
      '#24170f',
    ]);
    expect(cooldown.fills.map((fill) => fill.style)).toEqual(['#f5dfad']);
    expect(cooldownLocked.fills.map((fill) => fill.style)).toEqual([
      '#f5dfad',
      '#24170f',
      '#d39a45',
      '#f2c46d',
      '#24170f',
    ]);
  });

  it('returns the fallback sentinel during loading and after a failed decode', () => {
    const { art, images, canvases } = loaderHarness();
    expect(art.sprite('gather-ore', 'minimapGatherReady')).toBeNull();
    expect(images).toHaveLength(1);
    expect(art.sprite('gather-ore', 'mapGatherReady')).toBeNull();
    expect(images).toHaveLength(1);

    images[0].onerror?.();
    expect(art.sprite('gather-ore', 'minimapGatherReady')).toBeNull();
    expect(art.sprite('gather-ore', 'mapGatherReady')).toBeNull();
    expect(images).toHaveLength(1);
    expect(canvases).toHaveLength(0);

    expect(EMPTY_MAP_MARKER_ART.sprite('dungeon-entrance', 'mapDungeon')).toBeNull();
    expect(() => EMPTY_MAP_MARKER_ART.preload()).not.toThrow();
  });

  it('fails soft and caches misses when the host has no image factory', () => {
    const hostDocument = { createElement: vi.fn(() => new FakeCanvas()) };
    const createImage = vi.fn(() => null);
    const art = createMapMarkerArt(
      hostDocument as unknown as Pick<Document, 'createElement'>,
      createImage,
      RASTER_COLORS,
    );

    expect(art.sprite('gather-ore', 'minimapGatherReady')).toBeNull();
    expect(art.sprite('gather-ore', 'mapGatherReady')).toBeNull();
    expect(createImage).toHaveBeenCalledTimes(1);
    expect(hostDocument.createElement).not.toHaveBeenCalled();

    art.preload();
    expect(createImage).toHaveBeenCalledTimes(MAP_MARKER_ART_IDS.length);
    expect(hostDocument.createElement).not.toHaveBeenCalled();
  });

  it.each([
    { surface: 'scratch', contexts: [false], canvases: 1, sourceDraws: 0 },
    { surface: 'retained sprite', contexts: [true, false], canvases: 2, sourceDraws: 1 },
  ])('fails soft when the $surface canvas has no 2D context', (expected) => {
    const harness = loaderHarness({
      contextAvailable: (index) => expected.contexts[index] ?? true,
    });

    expect(harness.art.sprite('dungeon-entrance', 'mapDungeon')).toBeNull();
    harness.images[0].onload?.();

    expect(harness.art.sprite('dungeon-entrance', 'mapDungeon')).toBeNull();
    expect(harness.images).toHaveLength(1);
    expect(harness.canvases).toHaveLength(expected.canvases);
    expect(harness.canvases[0].draws).toHaveLength(expected.sourceDraws);
  });

  it('uses the neutral compositor fallback when cooldown pixel reads are denied', () => {
    const { art, images, canvases } = loaderHarness({
      imageDataFails: (index) => index === 0,
    });

    expect(art.sprite('gather-ore', 'minimapGatherCooldown')).toBeNull();
    images[0].onload?.();

    const scratch = canvases[0];
    const cooldownPixels = [16, 22, 16, 22, 18, 26, 18, 26];
    expect(scratch.imageDataReads).toEqual(
      cooldownPixels.map((pixels) => ({ x: 0, y: 0, width: pixels, height: pixels })),
    );
    expect(scratch.imageDataWrites).toEqual([]);
    expect(scratch.fills).toEqual(
      cooldownPixels.map((pixels) => ({
        style: '#9ba1a2',
        composite: 'source-in',
        args: [0, 0, pixels, pixels],
      })),
    );
    expect(scratch.context.globalCompositeOperation).toBe('source-over');
    expect(art.sprite('gather-ore', 'minimapGatherCooldown')).not.toBeNull();
    expect(art.sprite('gather-ore', 'mapGatherCooldown')).not.toBeNull();
  });

  it('publishes sprites immediately for an already-complete synchronous image', () => {
    const { art, images, canvases } = loaderHarness({
      configureImage: (image) => {
        image.complete = true;
        image.naturalWidth = 64;
      },
    });

    const sprite = art.sprite('dungeon-exit', 'mapDungeon');
    expect(sprite).toBe(canvases[3]);
    expect(images).toHaveLength(1);
    expect(images[0].srcAssignments).toEqual([mapMarkerIconUrl('dungeon-exit')]);
    expect(canvases).toHaveLength(5);

    images[0].onload?.();
    expect(art.sprite('dungeon-exit', 'mapDungeon')).toBe(sprite);
    expect(canvases).toHaveLength(5);
  });

  it('creates, preloads, and shares one Hud-owned marker cache across every painter', () => {
    const hud = readFileSync(path.join(repoRoot, 'src/ui/hud.ts'), 'utf8');
    expect(hud.match(/createMapMarkerArt\(document\)/g)).toHaveLength(1);
    expect(hud.match(/this\.mapMarkerArt\.preload\(\);/g)).toHaveLength(1);
    expect(hud).toMatch(
      /new MapWindowPainter\(\s*classCss,\s*this\.mapMarkerArt,\s*this\.mapMarkerProfile,\s*\)/,
    );
    expect(hud).toMatch(
      /new MinimapPainter\((?:(?!\n  \);)[\s\S])*?this\.mapMarkerArt,\s*this\.mapMarkerProfile,\s*\n  \);/,
    );
    expect(hud).toMatch(
      /new DelveMapPainter\(\s*this\.writerFacet,\s*classCss,\s*this\.mapMarkerArt,\s*this\.mapMarkerProfile,\s*\)/,
    );
    expect(hud).toMatch(
      /new RiftMapPainter\((?:(?!\n  \);)[\s\S])*?this\.mapMarkerArt,\s*this\.mapMarkerProfile,\s*\n  \);/,
    );
    expect(hud).toMatch(
      /mapMarkerProfileForFlags\(\s*classes\.contains\('mobile-touch'\),\s*classes\.contains\('hud-mobile-compact'\),\s*classes\.contains\('hud-mobile-landscape'\),?\s*\)/,
    );
    expect(hud).toMatch(
      /refreshMapMarkerArtPalette\(\): void \{\s*this\.mapMarkerArt\.refreshPalette\(\);\s*\}/,
    );
    expect(mainSource).toMatch(
      /function applyTheme\(\): void \{[\s\S]*?mapMarkerPaletteLifecycle\?\.notify\(\);\s*\}/,
    );
    expect(mainSource).toMatch(
      /mapMarkerPaletteLifecycle = installMapMarkerPaletteLifecycle\(\s*window,\s*\(\) =>\s*hud\.refreshMapMarkerArtPalette\(\),?\s*\)/,
    );
  });
});
