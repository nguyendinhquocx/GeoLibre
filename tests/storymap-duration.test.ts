import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_STORY_CHAPTER_DURATION_SECONDS,
  createEmptyProject,
  createSampleStoryMap,
  normalizeStoryChapterDurationSeconds,
  normalizeStoryMap,
  parseProject,
  parseStoryMapCsv,
  parseStoryMapJson,
  serializeProject,
  serializeStoryMapCsv,
  serializeStoryMapJson,
} from "@geolibre/core";

describe("story map chapter dwell time", () => {
  it("keeps old stories valid without adding an authored duration", () => {
    const sample = createSampleStoryMap();
    const restored = parseStoryMapJson(serializeStoryMapJson(sample));
    for (const chapter of restored.chapters) {
      assert.equal(chapter.durationSeconds, undefined);
      assert.equal(normalizeStoryChapterDurationSeconds(chapter.durationSeconds), 15);
    }
    assert.equal(DEFAULT_STORY_CHAPTER_DURATION_SECONDS, 15);
  });

  it("clamps finite durations and preserves fractional seconds", () => {
    const sample = createSampleStoryMap();
    const first = sample.chapters[0];
    const input = [-5, 0, 1, 2.5, 3600, 9000];
    const restored = normalizeStoryMap({
      ...sample,
      chapters: input.map((durationSeconds, i) => ({ ...first, id: String(i), durationSeconds })),
    });
    assert.deepEqual(
      restored?.chapters.map((chapter) => chapter.durationSeconds),
      [1, 1, 1, 2.5, 3600, 3600],
    );
  });

  it("rejects malformed durations without allowing an immediate advance or infinite timer", () => {
    const sample = createSampleStoryMap();
    const first = sample.chapters[0];
    const input = [null, "20", "", true, {}, [], NaN, Infinity, -Infinity];
    const restored = normalizeStoryMap({
      ...sample,
      chapters: input.map((durationSeconds, i) => ({ ...first, id: String(i), durationSeconds })),
    });
    for (const chapter of restored!.chapters) {
      assert.equal(chapter.durationSeconds, undefined);
      assert.equal(normalizeStoryChapterDurationSeconds(chapter.durationSeconds), 15);
    }
    for (const value of input) assert.equal(normalizeStoryChapterDurationSeconds(value), 15);
  });

  it("round-trips explicit timings through JSON, CSV, and project files", () => {
    const sample = createSampleStoryMap();
    const story = { ...sample, chapters: [{ ...sample.chapters[0], durationSeconds: 22.5 }] };
    const restoredStories = [
      parseStoryMapJson(serializeStoryMapJson(story)),
      parseStoryMapCsv(serializeStoryMapCsv(story)),
      parseProject(serializeProject({ ...createEmptyProject(), storymap: story })).storymap,
    ];
    for (const restored of restoredStories) {
      assert.equal(restored?.chapters[0].durationSeconds, 22.5);
      assert.deepEqual(restored?.chapters[0].location, story.chapters[0].location);
    }
  });

  it("treats missing or blank CSV timing cells as the default", () => {
    const oldCsv = "title,lng,lat,zoom\nOld chapter,117,39,10\n";
    const blankCsv = "title,lng,lat,durationSeconds\nBlank timing,117,39, \n";
    for (const csv of [oldCsv, blankCsv]) {
      const chapter = parseStoryMapCsv(csv).chapters[0];
      assert.equal(chapter.durationSeconds, undefined);
      assert.equal(normalizeStoryChapterDurationSeconds(chapter.durationSeconds), 15);
    }
    const exported = serializeStoryMapCsv(createSampleStoryMap());
    assert.ok(exported.split("\n")[0].endsWith(",durationSeconds"));
    assert.ok(!exported.includes("undefined"));
    assert.equal(parseStoryMapCsv(exported).chapters[0].durationSeconds, undefined);
  });

  it("imports reordered timing columns case-insensitively and validates every row", () => {
    const csv = [
      "DURATIONSECONDS,lat,title,lng",
      "4.5,39,Short,117",
      "0,39,Minimum,117",
      "7200,39,Maximum,117",
      "NaN,39,Invalid,117",
      "Infinity,39,Unbounded,117",
      "no,39,Text,117",
    ].join("\n");
    const restored = parseStoryMapCsv(csv);
    assert.deepEqual(
      restored.chapters.map((chapter) =>
        normalizeStoryChapterDurationSeconds(chapter.durationSeconds),
      ),
      [4.5, 1, 3600, 15, 15, 15],
    );
  });
});
