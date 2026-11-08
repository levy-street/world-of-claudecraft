import { activityPaths } from './play_activities';
import { characterPaths } from './play_character';
import { collectionPaths } from './play_collections';
import { socialPaths } from './play_social';
import { tradePaths } from './play_trade';

/** Keyed by the system's logical name, before MediaWiki disambiguates its page title. */
export interface PlayPath {
  where: string;
  need: string;
  steps: string[];
  result: string;
}

const paths = {
  ...activityPaths,
  ...characterPaths,
  ...collectionPaths,
  ...socialPaths,
  ...tradePaths,
};

export function systemWalkthrough(name: string, notice: string): string {
  // These already lead with a dedicated referral walkthrough or a closure notice.
  if (name === 'Referral cards' || notice.startsWith("'''Retired")) return '';
  const path = paths[name];
  if (!path) throw new Error('Missing player walkthrough for ' + name);
  return (
    [
      '== Getting started ==',
      "'''Where to go.''' " + path.where,
      "'''What you need.''' " + path.need,
      '=== Step by step ===\n' + path.steps.map((step) => '# ' + step).join('\n'),
      "'''What you get.''' " + path.result,
    ].join('\n\n') + '\n\n'
  );
}
