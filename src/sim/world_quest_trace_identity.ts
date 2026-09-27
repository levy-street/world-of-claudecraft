/** Shared identity for the movement lesson's NPC interaction, without importing content. */
export const WORLD_QUEST_TRACE_INSTRUCTOR_ID = 'calligraphy_instructor';

export function isWorldQuestTraceInstructor(templateId: string): boolean {
  return templateId === WORLD_QUEST_TRACE_INSTRUCTOR_ID;
}
