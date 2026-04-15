'use client';

import { useReducer, useCallback, useMemo } from 'react';
import { GameState, PlayerAction, PlayerId, AbilityCardDef, CharacterCardDef } from '@/game/types';
import {
  createNewGame,
  performMulligan,
  advanceToStartPhase,
  processAction,
  getLegalActions,
  EventCollector,
  getCardDefForInstance,
} from '@/game/engine';
import type { AnimationEvent } from '@/game/engine/animationEvents';
import { getActingPlayer, isHumanTurn } from '@/lib/gameHelpers';
import { SPEED_PRESETS } from '@/lib/constants';
import type { SpeedPreset } from '@/lib/constants';

// ============================================================
// Types
// ============================================================

export type GameMode = 'pvai' | 'aivai';

export type SelectionMode =
  | { type: 'none' }
  | { type: 'mulligan' }
  | { type: 'summon-select' }
  | { type: 'strategy-select' }
  | { type: 'hand-cost'; forCardId: string; needed: number }
  | { type: 'charge-essence' }
  | { type: 'team-organize' }
  | { type: 'select-attackers' }
  | { type: 'select-blockers' }
  | { type: 'discard-to-hand-limit'; count: number }
  // Ability card flow: select ability → select user → select targets → pay essence
  | { type: 'ability-select' }
  | { type: 'ability-user-select'; abilityCardId: string }
  | { type: 'ability-target-select'; abilityCardId: string; userId: string; needed: number }
  | { type: 'ability-essence-cost'; abilityCardId: string; userId: string; targetIds: string[]; needed: number; isXCost?: boolean; specificCosts?: { symbol: string; count: number }[]; cardSymbols?: string[] }
  // Activate effect flow: select character → select targets → pay cost
  | { type: 'activate-effect-select' }
  | { type: 'activate-pick-effect'; cardId: string; effects: { id: string; desc: string }[] }
  | { type: 'activate-target-select'; cardId: string; effectId: string; needed: number }
  | { type: 'activate-cost-select'; cardId: string; effectId: string; targetIds: string[]; needed: number; costSource: 'hand' | 'discard' | 'essence'; costDescription?: string }
  // Field card activate effect picker (e.g., Micromon Beach)
  | { type: 'field-activate-pick'; cardId: string; effectId: string; effects: { index: number; threshold: string; desc: string; available: boolean }[] };

export interface UIState {
  gameState: GameState | null;
  mode: GameMode;
  humanPlayer: PlayerId;
  selectionMode: SelectionMode;
  selectedCardIds: string[];
  selectedTeamIds: string[];
  mulliganDone: Record<PlayerId, boolean>;
  isAIThinking: boolean;
  isPaused: boolean;
  aiSpeed: number;
  speedPreset: SpeedPreset;
  narrationEnabled: boolean;
  lastError: string | null;
  gameStarted: boolean;
  pendingEvents: AnimationEvent[];
}

// ============================================================
// Actions
// ============================================================

export type UIAction =
  | { type: 'INIT_GAME'; mode: GameMode }
  | { type: 'SUBMIT_MULLIGAN'; player: PlayerId; cardIds: string[] }
  | { type: 'PERFORM_ACTION'; player: PlayerId; action: PlayerAction }
  | { type: 'SET_SELECTION_MODE'; mode: SelectionMode }
  | { type: 'TOGGLE_CARD_SELECTION'; cardId: string }
  | { type: 'TOGGLE_TEAM_SELECTION'; teamId: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_AI_THINKING'; value: boolean }
  | { type: 'SET_PAUSED'; value: boolean }
  | { type: 'SET_AI_SPEED'; speed: number }
  | { type: 'SET_SPEED_PRESET'; preset: SpeedPreset }
  | { type: 'SET_NARRATION_ENABLED'; enabled: boolean }
  | { type: 'SET_ERROR'; error: string | null };

// ============================================================
// Initial State
// ============================================================

const initialUIState: UIState = {
  gameState: null,
  mode: 'pvai',
  humanPlayer: 'player1',
  selectionMode: { type: 'none' },
  selectedCardIds: [],
  selectedTeamIds: [],
  mulliganDone: { player1: false, player2: false },
  isAIThinking: false,
  isPaused: false,
  aiSpeed: 800,
  speedPreset: 'normal' as SpeedPreset,
  narrationEnabled: false,
  lastError: null,
  gameStarted: false,
  pendingEvents: [],
};

// ============================================================
// Reducer
// ============================================================

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'INIT_GAME': {
      const gameState = createNewGame();
      const defaultPreset: SpeedPreset = action.mode === 'aivai' ? 'slow' : 'normal';
      const defaultNarration = action.mode === 'aivai';
      return {
        ...initialUIState,
        gameState,
        mode: action.mode,
        humanPlayer: 'player1',
        selectionMode: { type: 'mulligan' },
        mulliganDone: { player1: false, player2: false },
        gameStarted: false,
        speedPreset: defaultPreset,
        narrationEnabled: defaultNarration,
        aiSpeed: SPEED_PRESETS[defaultPreset].aiMoveDelay,
      };
    }

    case 'SUBMIT_MULLIGAN': {
      if (!state.gameState) return state;

      const clone = structuredClone(state.gameState);

      try {
        performMulligan(clone, action.player, action.cardIds);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Mulligan failed';
        return { ...state, lastError: message };
      }

      const newMulliganDone = {
        ...state.mulliganDone,
        [action.player]: true,
      };

      // If both players have completed mulligan, advance to start phase
      if (newMulliganDone.player1 && newMulliganDone.player2) {
        try {
          advanceToStartPhase(clone);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to advance to start phase';
          return { ...state, lastError: message };
        }

        return {
          ...state,
          gameState: clone,
          mulliganDone: newMulliganDone,
          gameStarted: true,
          selectionMode: { type: 'none' },
          selectedCardIds: [],
          lastError: null,
        };
      }

      return {
        ...state,
        gameState: clone,
        mulliganDone: newMulliganDone,
        selectedCardIds: [],
        lastError: null,
      };
    }

    case 'PERFORM_ACTION': {
      if (!state.gameState) return state;

      const clone = structuredClone(state.gameState);
      const collector = new EventCollector();
      const result = processAction(clone, action.player, action.action, collector);

      if (!result.success) {
        return {
          ...state,
          lastError: result.error ?? 'Action failed',
        };
      }

      return {
        ...state,
        gameState: clone,
        selectedCardIds: [],
        selectedTeamIds: [],
        selectionMode: { type: 'none' },
        lastError: null,
        pendingEvents: collector.drain(),
      };
    }

    case 'SET_SELECTION_MODE': {
      return {
        ...state,
        selectionMode: action.mode,
        selectedCardIds: [],
        selectedTeamIds: [],
      };
    }

    case 'TOGGLE_CARD_SELECTION': {
      const cardId = action.cardId;
      const isSelected = state.selectedCardIds.includes(cardId);

      return {
        ...state,
        selectedCardIds: isSelected
          ? state.selectedCardIds.filter((id) => id !== cardId)
          : [...state.selectedCardIds, cardId],
      };
    }

    case 'TOGGLE_TEAM_SELECTION': {
      const teamId = action.teamId;
      const isSelected = state.selectedTeamIds.includes(teamId);

      return {
        ...state,
        selectedTeamIds: isSelected
          ? state.selectedTeamIds.filter((id) => id !== teamId)
          : [...state.selectedTeamIds, teamId],
      };
    }

    case 'CLEAR_SELECTION': {
      return {
        ...state,
        selectedCardIds: [],
        selectedTeamIds: [],
        selectionMode: { type: 'none' },
      };
    }

    case 'SET_AI_THINKING': {
      return { ...state, isAIThinking: action.value };
    }

    case 'SET_PAUSED': {
      return { ...state, isPaused: action.value };
    }

    case 'SET_AI_SPEED': {
      return { ...state, aiSpeed: action.speed };
    }

    case 'SET_SPEED_PRESET': {
      const config = SPEED_PRESETS[action.preset];
      return { ...state, speedPreset: action.preset, aiSpeed: config.aiMoveDelay };
    }

    case 'SET_NARRATION_ENABLED': {
      return { ...state, narrationEnabled: action.enabled };
    }

    case 'SET_ERROR': {
      return { ...state, lastError: action.error };
    }

    default:
      return state;
  }
}

// ============================================================
// Hook
// ============================================================

export function useGameEngine() {
  const [uiState, dispatch] = useReducer(uiReducer, initialUIState);

  const gameState = uiState.gameState;

  // Compute legal actions for the current acting player
  const legalActions = useMemo(() => {
    if (!gameState || gameState.gameOver) return [];
    try {
      const actingPlayer = getActingPlayer(gameState);
      return getLegalActions(gameState, actingPlayer);
    } catch {
      return [];
    }
  }, [gameState]);

  // Determine if it's the human player's turn to act
  const isMyTurn = useMemo(() => {
    if (!gameState || gameState.gameOver) return false;
    return isHumanTurn(gameState, uiState.humanPlayer);
  }, [gameState, uiState.humanPlayer]);

  return {
    uiState,
    dispatch,
    gameState,
    legalActions,
    isMyTurn,
  };
}
