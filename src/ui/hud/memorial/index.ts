// Public surface of the memorial HUD domain: the Roll of Honour plaque a
// player gets for reading a war memorial.

export {
  buildMemorialPlaqueModel,
  composeRollName,
  MEMORIAL_PLAQUE_DEFAULT_COLUMNS,
  type MemorialDefLike,
  type MemorialPlaqueModel,
  type MemorialRollName,
  splitIntoColumns,
} from './memorial_plaque_view';
export {
  closeMemorialPlaque,
  type MemorialPlaqueDeps,
  renderMemorialPlaque,
} from './memorial_plaque_window';
