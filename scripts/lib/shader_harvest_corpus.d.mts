export interface HarvestedProgram {
  key: number;
  vertex: string;
  fragment: string;
  index0: string;
}

export interface HarvestedProgramMeta {
  key: number;
  links: number;
  steps: string[];
  contexts: number[];
}

export interface HarvestDrain {
  programs: HarvestedProgram[];
  meta: HarvestedProgramMeta[];
}

export interface CorpusShader {
  hash: string;
  stage: 'vert' | 'frag';
  text: string;
}

export interface CorpusProgram {
  hash: string;
  name: string;
  kind: string;
  vertexHash: string;
  fragmentHash: string;
  index0: string;
  seen: Record<string, { links: number; steps: string[]; contexts: number[] }>;
}

export interface Corpus {
  programs: Map<string, CorpusProgram>;
  shaders: Map<string, CorpusShader>;
  byPageKey: Map<string, Map<number, string>>;
}

export interface ShaderSite {
  file: string;
  tokens: string[];
}

export function textHash(text: string): string;
export function programHash(vertex: string, fragment: string, index0: string): string;
export function materialKindOf(fragment: string): string;
export function shaderNameOf(text: string): string;
export function createCorpus(): Corpus;
export function foldDrain(corpus: Corpus, profile: string, drain: HarvestDrain): number;
export function corpusIndex(
  corpus: Corpus,
  header: Record<string, unknown>,
): Record<string, unknown> & {
  programCount: number;
  shaderCount: number;
  programs: CorpusProgram[];
  shaders: { hash: string; stage: string; bytes: number }[];
};
export interface ClassifiedSite extends ShaderSite {
  own: string[];
}
export function classifySites(
  corpus: Pick<Corpus, 'shaders'>,
  sites: ShaderSite[],
): { seen: ClassifiedSite[]; unseen: ClassifiedSite[]; undetermined: ClassifiedSite[] };
export function shaderTokensOf(source: string): string[];
