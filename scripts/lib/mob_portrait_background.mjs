const FAMILY_CENTER_COLORS = Object.freeze({
  beast: '#6a5f3f',
  burrower: '#62503f',
  demon: '#61426e',
  dragonkin: '#5f4b38',
  elemental: '#405f70',
  humanoid: '#665443',
  mudfin: '#45645f',
  ogre: '#59634a',
  reptile: '#456557',
  spider: '#59475e',
  troll: '#456358',
  undead: '#65527a',
});

const NEUTRAL_CENTER_COLOR = '#59636b';

export function mobPortraitBackgroundSvg(family, size) {
  const center = FAMILY_CENTER_COLORS[family] ?? NEUTRAL_CENTER_COLOR;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="v" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#343a43"/>
        <stop offset="0.46" stop-color="${center}"/>
        <stop offset="1" stop-color="#11131a"/>
      </linearGradient>
      <linearGradient id="s" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
        <stop offset="0.38" stop-color="#ffffff" stop-opacity="0.02"/>
        <stop offset="0.7" stop-color="#000000" stop-opacity="0.06"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.28"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#v)"/>
    <rect width="${size}" height="${size}" fill="url(#s)"/>
  </svg>`;
}
