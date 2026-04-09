'use client';

import { useEffect, useRef } from 'react';
import { GameState, PlayerId, PlayerAction } from '@/game/types';
import { getAIAction } from '@/game/ai';
import { GameMode } from './useGameEngine';
import { getActingPlayer } from '@/lib/gameHelpers';
import { AI_MOVE_DELAY_MS } from '@/lib/constants';

// ============================================================
// Types
// ============================================================

interface UseAILoopOptions {
  gameState: GameState | null;
  mode: GameMode;
  humanPlayer: PlayerId;
  isPaused: boolean;
  aiSpeed: number;
  isAIThinking: boolean;
  gameStarted: boolean;
  mulliganDone: Record<PlayerId, boolean>;
  onAIAction: (player: PlayerId, action: PlayerAction) => void;
  onAIThinkingChange: (value: boolean) => void;
  onAIMulligan: (player: PlayerId) => void;
}

// ============================================================
// Hook
// ============================================================

export function useAILoop(options: UseAILoopOptions): void {
  const {
    gameState,
    mode,
    humanPlayer,
    isPaused,
    aiSpeed,
    isAIThinking,
    gameStarted,
    mulliganDone,
    onAIAction,
    onAIThinkingChange,
    onAIMulligan,
  } = options;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store latest callbacks in refs so the effect doesn't re-fire on every render
  const onAIActionRef = useRef(onAIAction);
  const onAIThinkingChangeRef = useRef(onAIThinkingChange);
  const onAIMulliganRef = useRef(onAIMulligan);

  onAIActionRef.current = onAIAction;
  onAIThinkingChangeRef.current = onAIThinkingChange;
  onAIMulliganRef.current = onAIMulligan;

  useEffect(() => {
    // Clear any existing timeout when dependencies change
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Do nothing if no game state or game is over or paused
    if (!gameState) return;
    if (gameState.gameOver) return;
    if (isPaused) return;

    // --- Handle mulligan phase ---
    if (!gameStarted) {
      if (mode === 'pvai') {
        // AI player is the opponent of the human
        const aiPlayer: PlayerId = humanPlayer === 'player1' ? 'player2' : 'player1';
        if (!mulliganDone[aiPlayer]) {
          // Schedule the AI mulligan after a short delay
          onAIThinkingChangeRef.current(true);
          timeoutRef.current = setTimeout(() => {
            onAIMulliganRef.current(aiPlayer);
            onAIThinkingChangeRef.current(false);
            timeoutRef.current = null;
          }, AI_MOVE_DELAY_MS);
        }
      } else if (mode === 'aivai') {
        // Both players are AI — mulligan for whichever hasn't gone yet
        const nextToMulligan: PlayerId | null = !mulliganDone.player1
          ? 'player1'
          : !mulliganDone.player2
            ? 'player2'
            : null;

        if (nextToMulligan) {
          onAIThinkingChangeRef.current(true);
          timeoutRef.current = setTimeout(() => {
            onAIMulliganRef.current(nextToMulligan);
            onAIThinkingChangeRef.current(false);
            timeoutRef.current = null;
          }, Math.min(aiSpeed, AI_MOVE_DELAY_MS));
        }
      }
      return;
    }

    // --- Handle post-mulligan game actions ---
    if (mode === 'pvai') {
      // Only act if it's not the human's turn
      const actingPlayer = getActingPlayer(gameState);
      if (actingPlayer === humanPlayer) return;

      // Schedule AI action
      onAIThinkingChangeRef.current(true);
      timeoutRef.current = setTimeout(() => {
        // Re-read the current gameState is not possible in a closure,
        // but the effect will re-run when gameState changes, so this is fine.
        try {
          const action = getAIAction(gameState, actingPlayer);
          onAIActionRef.current(actingPlayer, action);
        } catch (err) {
          // If the AI fails, pass priority as fallback
          onAIActionRef.current(actingPlayer, { type: 'pass-priority' });
        }
        onAIThinkingChangeRef.current(false);
        timeoutRef.current = null;
      }, AI_MOVE_DELAY_MS);
    } else if (mode === 'aivai') {
      // Both players are AI — always schedule the next action
      const actingPlayer = getActingPlayer(gameState);
      onAIThinkingChangeRef.current(true);

      timeoutRef.current = setTimeout(() => {
        try {
          const action = getAIAction(gameState, actingPlayer);
          onAIActionRef.current(actingPlayer, action);
        } catch (err) {
          onAIActionRef.current(actingPlayer, { type: 'pass-priority' });
        }
        onAIThinkingChangeRef.current(false);
        timeoutRef.current = null;
      }, aiSpeed);
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [gameState, mode, humanPlayer, isPaused, aiSpeed, gameStarted, mulliganDone]);
}
