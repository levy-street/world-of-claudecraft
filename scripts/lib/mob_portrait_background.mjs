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
      <radialGradient id="v" cx="50%" cy="38%" r="68%">
        <stop offset="0" stop-color="${center}"/>
        <stop offset="0.58" stop-color="#30343a"/>
        <stop offset="1" stop-color="#11131a"/>
      </radialGradient>
      <linearGradient id="s" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.14"/>
        <stop offset="0.48" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#v)"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.43}" fill="none" stroke="#d7bd78" stroke-opacity="0.22" stroke-width="${Math.max(1, size * 0.018)}"/>
    <rect width="${size}" height="${size}" fill="url(#s)"/>
  </svg>`;
}
