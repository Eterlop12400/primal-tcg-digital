// ============================================================
// Primal TCG — Event Collector
// ============================================================
// Accumulates animation events during engine mutations.
// Passed as optional parameter to processAction — backward compatible.

import type { AnimationEvent, AnimationTiming } from './animationEvents';
import type { PlayerId } from '../types';

/** Partial event without auto-assigned fields */
type EmitPayload = {
  [K in AnimationEvent['type']]: Omit<Extract<AnimationEvent, { type: K }>, 'sequenceId' | 'order' | 'timestamp'>
}[AnimationEvent['type']];

type EmitConcurrentPayload = {
  [K in AnimationEvent['type']]: Omit<Extract<AnimationEvent, { type: K }>, 'sequenceId' | 'order' | 'timestamp' | 'timing'>
}[AnimationEvent['type']];

let globalSequenceId = 0;

export class EventCollector {
  private events: AnimationEvent[] = [];
  private orderCounter = 0;

  /**
   * Emit an animation event. Auto-assigns sequenceId and order.
   */
  emit(event: EmitPayload): void {
    this.events.push({
      ...event,
      sequenceId: globalSequenceId++,
      order: this.orderCounter++,
      timestamp: Date.now(),
    } as AnimationEvent);
  }

  /**
   * Emit an event that should play concurrently with the previous event.
   */
  emitConcurrent(event: EmitConcurrentPayload): void {
    this.events.push({
      ...event,
      sequenceId: globalSequenceId++,
      order: this.orderCounter++,
      timestamp: Date.now(),
      timing: { concurrent: true },
    } as AnimationEvent);
  }

  /**
   * Returns all collected events and resets the collector.
   */
  drain(): AnimationEvent[] {
    const result = [...this.events];
    this.events = [];
    this.orderCounter = 0;
    return result;
  }

  /**
   * Peek at collected events without draining.
   */
  peek(): ReadonlyArray<AnimationEvent> {
    return this.events;
  }

  /**
   * Check if any events have been collected.
   */
  get hasEvents(): boolean {
    return this.events.length > 0;
  }

  /**
   * Number of collected events.
   */
  get count(): number {
    return this.events.length;
  }
}
