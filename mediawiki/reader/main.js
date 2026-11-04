import cardsUrl from '../seed/pages.tooltips.json?url';
import seedUrl from '../seed/pages.xml?url';
import { mountCompanion } from './companion.js';
import { openReader } from './reader.js';

const assetUrl = (path) => path;
mountCompanion(assetUrl);
openReader({ seedUrl, cardsUrl, assetUrl });
