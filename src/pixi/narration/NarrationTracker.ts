// ============================================================
// Primal TCG — Narration Tracker
// ============================================================
// Tracks which concepts have been explained and maps game events
// to narration items for the overlay to display.

import type { AnimationEvent } from '@/game/engine/animationEvents';
import type { Phase, PlayerId } from '@/game/types';
import {
  CONCEPT_NARRATIONS,
  PHASE_CONCEPTS,
  getActionNarration,
  getEventConcept,
} from './NarrationContent';

export interface NarrationItem {
  title: string;
  text: string;
  duration: number;
  priority: 'concept' | 'action';
}

export class NarrationTracker {
  private seenConcepts = new Set<string>();

  reset(): void {
    this.seenConcepts.clear();
  }

  /** Process animation events and return narration items. */
  processEvents(events: AnimationEvent[], humanPlayer: PlayerId, mode: string): NarrationItem[] {
    const items: NarrationItem[] = [];

    for (const event of events) {
      // Check for concept triggers
      const conceptKey = getEventConcept(event);
      if (conceptKey && !this.seenConcepts.has(conceptKey)) {
        const concept = CONCEPT_NARRATIONS[conceptKey];
        if (concept) {
          this.seenConcepts.add(conceptKey);
          items.push({
            title: concept.title,
            text: concept.text,
            duration: concept.duration,
            priority: 'concept',
          });
        }
      }

      // Generate action narration
      const playerLabel = mode === 'aivai'
        ? (event.player === 'player1' ? 'Player 1' : 'Player 2')
        : (event.player === humanPlayer ? 'You' : 'Opponent');
      const actionText = getActionNarration(event, playerLabel);
      if (actionText) {
        items.push({
          title: 'NARRATOR',
          text: actionText,
          duration: 3000,
          priority: 'action',
        });
      }
    }

    // Sort: concepts first, then actions
    items.sort((a, b) => {
      if (a.priority === 'concept' && b.priority !== 'concept') return -1;
      if (a.priority !== 'concept' && b.priority === 'concept') return 1;
      return 0;
    });

    return items;
  }

  /** Process a phase change and return concept narration if applicable. */
  processPhaseChange(fromPhase: Phase, toPhase: Phase): NarrationItem | null {
    const conceptKey = PHASE_CONCEPTS[toPhase];
    if (!conceptKey || this.seenConcepts.has(conceptKey)) return null;

    const concept = CONCEPT_NARRATIONS[conceptKey];
    if (!concept) return null;

    this.seenConcepts.add(conceptKey);
    return {
      title: concept.title,
      text: concept.text,
      duration: concept.duration,
      priority: 'concept',
    };
  }
}
