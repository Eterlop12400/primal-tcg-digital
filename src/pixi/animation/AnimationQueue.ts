// ============================================================
// Primal TCG — Animation Queue
// ============================================================
// Converts raw animation events into sequenced steps.
// Groups events (respecting concurrent flag), plays steps
// sequentially, concurrent events within a step play in parallel.

import type { AnimationEvent } from '@/game/engine/animationEvents';

export type AnimationPlayer = (event: AnimationEvent) => Promise<void>;

export class AnimationQueue {
  private queue: AnimationEvent[][] = [];
  private _isBusy = false;
  private _speed = 1;
  private _skipRequested = false;
  private onComplete: (() => void) | null = null;
  private player: AnimationPlayer | null = null;

  get isBusy(): boolean {
    return this._isBusy;
  }

  get speed(): number {
    return this._speed;
  }

  setSpeed(multiplier: number): void {
    this._speed = Math.max(0.1, Math.min(5, multiplier));
  }

  setPlayer(player: AnimationPlayer): void {
    this.player = player;
  }

  /**
   * Enqueue a batch of events. Groups them into steps
   * respecting the concurrent flag.
   */
  enqueue(events: AnimationEvent[], onComplete?: () => void): void {
    if (events.length === 0) {
      onComplete?.();
      return;
    }

    // Group events into steps: concurrent events go in the same step
    const steps: AnimationEvent[][] = [];
    let currentStep: AnimationEvent[] = [];

    for (const event of events) {
      if (event.timing?.concurrent && currentStep.length > 0) {
        // Add to current concurrent group
        currentStep.push(event);
      } else {
        // Start a new step
        if (currentStep.length > 0) {
          steps.push(currentStep);
        }
        currentStep = [event];
      }
    }
    if (currentStep.length > 0) {
      steps.push(currentStep);
    }

    this.queue.push(...steps);
    if (onComplete) this.onComplete = onComplete;

    // Start playing if not already
    if (!this._isBusy) {
      this.playNext();
    }
  }

  /**
   * Skip all remaining animations, jumping to final state.
   */
  skip(): void {
    this._skipRequested = true;
    this.queue = [];
    this._isBusy = false;
    this.onComplete?.();
    this.onComplete = null;
  }

  private async playNext(): Promise<void> {
    if (this.queue.length === 0 || this._skipRequested) {
      this._isBusy = false;
      this._skipRequested = false;
      this.onComplete?.();
      this.onComplete = null;
      return;
    }

    this._isBusy = true;
    const step = this.queue.shift()!;

    if (this.player) {
      // Play all events in this step concurrently
      const promises = step.map(event => {
        // Apply speed multiplier to delay
        if (event.timing?.delay) {
          event.timing.delay /= this._speed;
        }
        return this.player!(event).catch(() => {
          // Swallow animation errors to prevent queue stall
        });
      });

      await Promise.all(promises);
    }

    // Continue to next step
    this.playNext();
  }

  /** Clear the queue without triggering onComplete. */
  clear(): void {
    this.queue = [];
    this._isBusy = false;
    this.onComplete = null;
  }
}
