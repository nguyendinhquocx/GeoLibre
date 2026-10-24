/** Default chapter dwell time after the camera arrives, in seconds. */
export const DEFAULT_STORY_CHAPTER_DURATION_SECONDS = 15;
export const MIN_STORY_CHAPTER_DURATION_SECONDS = 1;
export const MAX_STORY_CHAPTER_DURATION_SECONDS = 3600;

/** Resolve old or hand-authored chapter timings to a safe autoplay duration. */
export function normalizeStoryChapterDurationSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_STORY_CHAPTER_DURATION_SECONDS;
  }
  return Math.min(
    MAX_STORY_CHAPTER_DURATION_SECONDS,
    Math.max(MIN_STORY_CHAPTER_DURATION_SECONDS, value),
  );
}
