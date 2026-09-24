// Pure, host-agnostic core for the in-game quest tracker (the persistent
// #quest-tracker overlay). It decides WHAT the tracker shows given the active
// quests and the player's collapse preference, so the collapse + per-objective
// "done" logic is unit-testable without the DOM or a locale loaded.
//
// The thin consumer (quest_tracker_controller.ts) resolves quest/objective text
// through t(), formats the count through formatNumber, and renders this view
// model to HTML. Keeping this module fully string/DOM-free mirrors unit_portrait's
// pure-core split (the consumer owns all t()/formatNumber, the way xp_bar's does),
// so the collapse + done logic is testable without a locale loaded.
//
// The tracker is split into SECTIONS, the classic objective tracker's layout:
// the "Quests" section (the quest log's tracked quests, plus the Clue Scroll
// hunt row) and a "World Quests" section of its own for the active world
// quests, each with its own header and collapse. `questTrackerSections` does
// the grouping; each section is an ordinary `questTrackerView`.

export interface TrackedObjective {
  /** Already-localized objective label. */
  label: string;
  current: number;
  total: number;
  /** A movement lesson instruction, shown in full without a numeric suffix. */
  instruction?: boolean;
}

export interface TrackedQuest {
  id: string;
  /** 1-based acceptance-order number, matching the world map's badges. */
  number: number;
  /** Already-localized quest title. */
  title: string;
  /** True when the quest is ready to turn in (the "(Complete)" state). */
  complete: boolean;
  objectives: readonly TrackedObjective[];
  /** An active world quest: it lists under the "World Quests" section. */
  worldQuest?: boolean;
}

export interface QuestTrackerObjectiveRow extends TrackedObjective {
  done: boolean;
  counted: boolean;
}

export interface QuestTrackerQuestRow {
  id: string;
  number: number;
  title: string;
  complete: boolean;
  objectives: QuestTrackerObjectiveRow[];
}

export interface QuestTrackerView {
  /** Whether to render anything at all (false when no quests are tracked). */
  visible: boolean;
  collapsed: boolean;
  /** Number of tracked quests; shown beside the header in both states. */
  count: number;
  /** The quest rows to render; empty when collapsed (header only). */
  quests: QuestTrackerQuestRow[];
}

/** Build the tracker view from the tracked quests + the collapse preference.
 *  Collapsed renders the header only (with the quest count); expanded renders
 *  every quest and objective, with each objective's done state computed. */
export function questTrackerView(
  quests: readonly TrackedQuest[],
  collapsed: boolean,
): QuestTrackerView {
  const count = quests.length;
  if (count === 0) return { visible: false, collapsed, count: 0, quests: [] };
  if (collapsed) return { visible: true, collapsed: true, count, quests: [] };
  const questRows = quests.map((q) => ({
    id: q.id,
    number: q.number,
    title: q.title,
    complete: q.complete,
    objectives: q.objectives.map((o) => ({
      ...o,
      done: o.current >= o.total,
      counted: o.total > 1,
    })),
  }));
  return { visible: true, collapsed: false, count, quests: questRows };
}

/** The tracker's sections, in paint order. */
export type QuestTrackerSection = 'quests' | 'worldQuests';
export const QUEST_TRACKER_SECTIONS: readonly QuestTrackerSection[] = ['quests', 'worldQuests'];

export interface QuestTrackerSectionView extends QuestTrackerView {
  section: QuestTrackerSection;
}

/** The section a tracked row lists under. */
export function questTrackerSectionFor(quest: TrackedQuest): QuestTrackerSection {
  return quest.worldQuest === true ? 'worldQuests' : 'quests';
}

/** A section header's `data-qt-section` value back to its section; anything
 *  else (the Quests header carries none) is the Quests section. */
export function questTrackerSectionOf(value: string | undefined): QuestTrackerSection {
  return value === 'worldQuests' ? 'worldQuests' : 'quests';
}

/** Group the tracked rows into their sections, keeping each section's rows in
 *  the order they arrived, and build each through `questTrackerView` with that
 *  section's own collapse. Sections with no rows are left out entirely, so a
 *  character with only world quests shows only the World Quests section. */
export function questTrackerSections(
  quests: readonly TrackedQuest[],
  collapsed: (section: QuestTrackerSection) => boolean,
): QuestTrackerSectionView[] {
  const sections: QuestTrackerSectionView[] = [];
  for (const section of QUEST_TRACKER_SECTIONS) {
    const rows = quests.filter((quest) => questTrackerSectionFor(quest) === section);
    const view = questTrackerView(rows, collapsed(section));
    if (view.visible) sections.push({ section, ...view });
  }
  return sections;
}
