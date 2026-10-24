import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  StoryPresentationPlayback,
  type PresentationClock,
} from "../apps/geolibre-desktop/src/components/storymap/storymap-presentation-playback";

function fixture(durations = [2, 3, 1], synchronous = false) {
  let time = 0;
  let nextId = 0;
  let stops = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const visits: { index: number; automatic: boolean; arrive: () => void }[] = [];
  const clock: PresentationClock = {
    now: () => time,
    schedule(callback, delay) {
      timers.set(++nextId, { at: time + delay, callback });
      return nextId as unknown as ReturnType<typeof setTimeout>;
    },
    cancel(id) {
      timers.delete(id as unknown as number);
    },
  };
  const playback = new StoryPresentationPlayback(
    durations,
    (index, automatic, arrive) => {
      visits.push({ index, automatic, arrive });
      if (synchronous) arrive();
    },
    () => {
      stops++;
    },
    () => {},
    clock,
  );
  const advance = (ms: number) => {
    const end = time + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      time = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    time = end;
  };
  return { playback, visits, advance, stops: () => stops, timers };
}

describe("interactive story presentation playback", () => {
  it("stops manual flights without skipping the first chapter or losing replay", () => {
    const f = fixture([1, 1], true);
    f.playback.initialize();
    const initial = f.playback.snapshot;
    f.playback.pause();
    assert.deepEqual(f.playback.snapshot, initial);
    assert.equal(f.stops(), 1);
    f.playback.play();
    assert.equal(f.playback.snapshot.index, 0);
    assert.equal(f.playback.snapshot.phase, "playing");
    f.advance(2000);
    const ended = f.playback.snapshot;
    assert.equal(ended.phase, "ended");
    const stops = f.stops();
    f.playback.pause();
    assert.deepEqual(f.playback.snapshot, ended);
    assert.equal(f.stops(), stops + 1);
    f.playback.play();
    assert.equal(f.playback.snapshot.index, 0);
    assert.equal(f.playback.snapshot.phase, "playing");
  });

  it("opens paused and counts dwell only after camera arrival", () => {
    const f = fixture();
    f.playback.initialize();
    assert.equal(f.playback.snapshot.phase, "paused");
    f.playback.play();
    f.advance(30_000);
    assert.equal(f.playback.snapshot.phase, "moving");
    assert.equal(f.playback.snapshot.index, 0);
    f.visits.at(-1)!.arrive();
    f.advance(1900);
    assert.equal(f.playback.snapshot.index, 0);
    f.advance(100);
    assert.equal(f.playback.snapshot.index, 1);
    assert.equal(f.playback.snapshot.phase, "moving");
  });

  it("pauses a flight, ignores stale arrivals, and resumes from the next chapter", () => {
    const f = fixture();
    f.playback.initialize();
    f.playback.play();
    const oldArrival = f.visits.at(-1)!.arrive;
    f.playback.pause();
    oldArrival();
    f.advance(60_000);
    assert.equal(f.playback.snapshot.phase, "paused");
    assert.equal(f.playback.snapshot.index, 0);
    f.playback.play();
    assert.equal(f.visits.at(-1)!.index, 1);
    assert.equal(f.visits.at(-1)!.automatic, true);
  });

  it("freezes the countdown until an explicit presenter action", () => {
    const f = fixture(undefined, true);
    f.playback.initialize();
    f.playback.play();
    f.advance(1100);
    f.playback.pause();
    const paused = f.playback.snapshot;
    f.advance(120_000);
    assert.deepEqual(f.playback.snapshot, paused);
    assert.equal(paused.remainingSeconds, 1);
    assert.equal(f.timers.size, 0);
  });

  it("manual navigation and reset remain paused, including the same chapter", () => {
    const f = fixture(undefined, true);
    f.playback.initialize();
    f.playback.play();
    f.playback.select(1);
    assert.equal(f.playback.snapshot.phase, "paused");
    f.playback.resetView();
    assert.deepEqual(
      f.visits.slice(-2).map((v) => [v.index, v.automatic]),
      [
        [1, false],
        [1, false],
      ],
    );
    f.advance(30_000);
    assert.equal(f.playback.snapshot.index, 1);
    f.playback.play();
    assert.equal(f.playback.snapshot.index, 2);
  });

  it("finishes on the last chapter without wrapping or leaving a rotation running", () => {
    const f = fixture([1, 1], true);
    f.playback.initialize();
    f.playback.play();
    f.advance(2000);
    assert.equal(f.playback.snapshot.phase, "ended");
    assert.equal(f.playback.snapshot.index, 1);
    const stops = f.stops();
    f.advance(60_000);
    assert.equal(f.stops(), stops);
    assert.equal(f.timers.size, 0);
    f.playback.play();
    assert.equal(f.playback.snapshot.index, 0);
  });

  it("duplicate callbacks cannot reset dwell and disposal cancels all pending work", () => {
    const f = fixture();
    f.playback.initialize();
    f.playback.play();
    const arrive = f.visits.at(-1)!.arrive;
    arrive();
    f.advance(1500);
    arrive();
    f.advance(500);
    assert.equal(f.playback.snapshot.index, 1);
    f.playback.dispose();
    f.visits.at(-1)!.arrive();
    f.advance(60_000);
    assert.equal(f.timers.size, 0);
    const count = f.visits.length;
    f.playback.play();
    assert.equal(f.visits.length, count);
  });
});
