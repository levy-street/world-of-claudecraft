/** Ground dust shares the surface palette used by solid impact fragments. */
export function groundContactColor(surface: string): number {
  switch (surface) {
    case 'stone':
      return 0x9b9a95;
    case 'wood':
      return 0xa8895f;
    case 'snow':
      return 0xe6eef5;
    case 'dirt':
      return 0xa38257;
    default:
      return 0x8d9a63;
  }
}
