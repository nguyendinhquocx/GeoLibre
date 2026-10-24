/** Presentation timing, independent of React and of any map rendering engine. */
export type PresentationPhase = "paused" | "moving" | "playing" | "ended";

export interface PresentationPlaybackState {
  index: number;
  phase: PresentationPhase;
  remainingSeconds: number;
  started: boolean;
}

export interface PresentationClock {
  now(): number;
  schedule(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
}

const systemClock: PresentationClock = {
  now: () => performance.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (timer) => clearTimeout(timer),
};

/**
 * A presenter explicitly owns the map: any manual interaction pauses playback.
 * Resuming skips the explained chapter and starts the next one. Camera arrival
 * callbacks are generation-checked, including synchronous jumpTo callbacks.
 */
export class StoryPresentationPlayback {
  private state: PresentationPlaybackState = {
    index: 0,
    phase: "paused",
    remainingSeconds: 0,
    started: false,
  };
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline = 0;
  private disposed = false;

  constructor(
    private readonly durations: readonly number[],
    private readonly navigate: (index: number, automatic: boolean, arrived: () => void) => void,
    private readonly stopCamera: () => void,
    private readonly changed: (state: PresentationPlaybackState) => void,
    private readonly clock: PresentationClock = systemClock,
  ) {}

  get snapshot(): PresentationPlaybackState {
    return { ...this.state };
  }

  initialize(index = 0, started = false): void {
    this.visit(index, false, started);
  }

  select(index: number): void {
    this.visit(index, false, true);
  }

  /** Explicitly restore this chapter; never resume its timer or rotation. */
  resetView(): void {
    this.visit(this.state.index, false, true);
  }

  play(): void {
    if (this.disposed || this.state.phase === "playing" || this.state.phase === "moving") return;
    if (this.state.phase === "ended") {
      this.visit(0, true, true);
    } else if (!this.state.started) {
      this.visit(this.state.index, true, true);
    } else if (this.state.index + 1 < this.durations.length) {
      this.visit(this.state.index + 1, true, true);
    } else {
      this.finish();
    }
  }

  pause(): void {
    if (this.disposed) return;
    if (this.state.phase !== "playing" && this.state.phase !== "moving") {
      this.cancel();
      return;
    }
    const remaining =
      this.state.phase === "playing"
        ? Math.max(0, Math.ceil((this.deadline - this.clock.now()) / 1000))
        : this.state.remainingSeconds;
    this.cancel();
    this.publish({ ...this.state, phase: "paused", remainingSeconds: remaining, started: true });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }

  private cancel(stopCamera = true): void {
    // Invalidate before stopping the camera: stopping may synchronously fire
    // its previous moveend callback. It must not restart the chapter timer.
    this.generation++;
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null;
    if (stopCamera) this.stopCamera();
  }

  private publish(state: PresentationPlaybackState): void {
    this.state = state;
    this.changed(this.snapshot);
  }

  private visit(index: number, automatic: boolean, started: boolean): void {
    if (this.disposed || index < 0 || index >= this.durations.length) return;
    // A new camera command supersedes the previous movement itself. Avoid
    // stop()+flyTo() in the same frame (which can suppress fast transitions).
    this.cancel(false);
    const generation = this.generation;
    const duration = Math.max(1, this.durations[index] || 15);
    this.publish({
      index,
      phase: automatic ? "moving" : "paused",
      remainingSeconds: duration,
      started,
    });
    this.navigate(index, automatic, () => {
      if (this.disposed || generation !== this.generation || !automatic) return;
      // Guard duplicate arrival events, which some renderers emit at rest.
      if (this.state.phase !== "moving") return;
      this.deadline = this.clock.now() + duration * 1000;
      this.publish({ ...this.state, phase: "playing" });
      this.tick(generation);
    });
  }

  private tick(generation: number): void {
    if (this.disposed || generation !== this.generation || this.state.phase !== "playing") return;
    const remainingSeconds = Math.max(0, Math.ceil((this.deadline - this.clock.now()) / 1000));
    if (remainingSeconds === 0) {
      if (this.state.index + 1 < this.durations.length)
        this.visit(this.state.index + 1, true, true);
      else this.finish();
      return;
    }
    if (remainingSeconds !== this.state.remainingSeconds)
      this.publish({ ...this.state, remainingSeconds });
    this.timer = this.clock.schedule(() => this.tick(generation), 100);
  }

  private finish(): void {
    this.cancel();
    this.publish({ ...this.state, phase: "ended", remainingSeconds: 0, started: true });
  }
}
