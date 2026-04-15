'use client';

import { useEffect, useRef } from 'react';
import { GameState, PlayerId, PlayerAction } from '@/game/types';
import { getAIAction } from '@/game/ai';
import { GameMode } from './useGameEngine';
import { getActingPlayer } from '@/lib/gameHelpers';
import { AI_MOVE_DELAY_MS, SPEED_PRESETS } from '@/lib/constants';
import type { SpeedPreset } from '@/lib/constants';

// ============================================================
// Types
// ============================================================

interface UseAILoopOptions {
  gameState: GameState | null;
  mode: GameMode;
  humanPlayer: PlayerId;
  isPaused: boolean;
  aiSpeed: number;
  speedPreset: SpeedPreset;
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
    speedPreset,
    isAIThinking,
    gameStarted,
    mulliganDone,
    onAIAction,
    onAIThinkingChange,
    onAIMulligan,
  } = options;

  const aiDelay = SPEED_PRESETS[speedPreset].aiMoveDelay;

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
          }, aiDelay);
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
          }, aiDelay);
        }
      }
      return;
    }

    // --- Handle pending search for AI ---
    if (gameState.pendingSearch) {
      const searchOwner = gameState.pendingSearch.owner;
      const isAISearch = mode === 'aivai' || (mode === 'pvai' && searchOwner !== humanPlayer);
      if (isAISearch) {
        onAIThinkingChangeRef.current(true);
        timeoutRef.current = setTimeout(() => {
          // AI auto-picks first valid card
          const chosen = gameState.pendingSearch?.validCardIds[0] ?? null;
          onAIActionRef.current(searchOwner, { type: 'search-select', cardInstanceId: chosen });
          onAIThinkingChangeRef.current(false);
          timeoutRef.current = null;
        }, AI_MOVE_DELAY_MS);
        return;
      }
      // If it's a human search, don't proceed with AI actions — wait for overlay
      if (searchOwner === humanPlayer) return;
    }

    // --- Handle pending optional effect for AI ---
    if (gameState.pendingOptionalEffect) {
      const optOwner = gameState.pendingOptionalEffect.owner;
      const isAIOpt = mode === 'aivai' || (mode === 'pvai' && optOwner !== humanPlayer);
      if (isAIOpt) {
        onAIThinkingChangeRef.current(true);
        timeoutRef.current = setTimeout(() => {
          // AI always activates optional effects
          onAIActionRef.current(optOwner, {
            type: 'choose-optional-trigger',
            effectId: gameState.pendingOptionalEffect?.effectId ?? '',
            activate: true,
          });
          onAIThinkingChangeRef.current(false);
          timeoutRef.current = null;
        }, AI_MOVE_DELAY_MS);
        return;
      }
      // If it's a human optional effect, don't proceed — wait for overlay
      if (optOwner === humanPlayer) return;
    }

    // --- Handle pending target choice for AI ---
    if (gameState.pendingTargetChoice) {
      const choiceOwner = gameState.pendingTargetChoice.owner;
      const isAIChoice = mode === 'aivai' || (mode === 'pvai' && choiceOwner !== humanPlayer);
      if (isAIChoice) {
        onAIThinkingChangeRef.current(true);
        timeoutRef.current = setTimeout(() => {
          // AI auto-picks first valid target
          const chosen = gameState.pendingTargetChoice?.validTargetIds[0] ?? '';
          onAIActionRef.current(choiceOwner, { type: 'resolve-target-choice', cardInstanceId: chosen });
          onAIThinkingChangeRef.current(false);
          timeoutRef.current = null;
        }, AI_MOVE_DELAY_MS);
        return;
      }
      // If it's a human choice, don't proceed with AI actions — wait for overlay
      if (choiceOwner === humanPlayer) return;
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
      }, aiDelay);
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
      }, aiDelay);
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [gameState, mode, humanPlayer, isPaused, aiSpeed, speedPreset, gameStarted, mulliganDone]);
}
