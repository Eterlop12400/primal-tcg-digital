'use client';

// ============================================================
// Primal TCG — PixiJS Game Canvas (React Wrapper)
// ============================================================
// This is the React component that:
// 1. Holds useGameEngine() and useAILoop() hooks (unchanged)
// 2. Ports auto-pass logic from GameProvider
// 3. Mounts a <canvas> and initializes PixiJS GameRenderer
// 4. Calls renderer.update(gameState, uiState) on every state change

import { useEffect, useRef, useCallback, useState } from 'react';
import { useGameEngine, GameMode } from '@/hooks/useGameEngine';
import { useAILoop } from '@/hooks/useAILoop';
import { PlayerId, PlayerAction } from '@/game/types';
import { getAIAction } from '@/game/ai';
import { getCardDefForInstance, getLegalActions } from '@/game/engine';
import { getActingPlayer, isHumanTurn } from '@/lib/gameHelpers';
import { GameRenderer } from './GameRenderer';

interface PixiGameCanvasProps {
  mode: GameMode;
}

export function PixiGameCanvas({ mode }: PixiGameCanvasProps) {
  const { uiState, dispatch, gameState, legalActions, isMyTurn } = useGameEngine();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const initRef = useRef(false);
  const [rendererReady, setRendererReady] = useState(false);

  // ============================================================
  // Initialize game on mount
  // ============================================================
  useEffect(() => {
    dispatch({ type: 'INIT_GAME', mode });
  }, [mode, dispatch]);

  // ============================================================
  // Initialize PixiJS renderer
  // ============================================================
  useEffect(() => {
    if (!canvasRef.current || initRef.current) return;
    initRef.current = true;

    const renderer = new GameRenderer();
    rendererRef.current = renderer;

    renderer.init(canvasRef.current).then(() => {
      renderer.setDispatch(dispatch);
      setRendererReady(true);
    });

    // Handle resize
    const handleResize = () => renderer.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.destroy();
      rendererRef.current = null;
      initRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // Update renderer when state changes
  // ============================================================
  useEffect(() => {
    if (!rendererReady || !rendererRef.current || !gameState) return;
    rendererRef.current.update(gameState, uiState);
  }, [gameState, uiState, rendererReady]);

  // ============================================================
  // AI Loop callbacks
  // ============================================================
  const handleAIAction = useCallback(
    (player: PlayerId, action: PlayerAction) => {
      dispatch({ type: 'PERFORM_ACTION', player, action });
    },
    [dispatch],
  );

  const handleAIThinkingChange = useCallback(
    (value: boolean) => {
      dispatch({ type: 'SET_AI_THINKING', value });
    },
    [dispatch],
  );

  const handleAIMulligan = useCallback(
    (player: PlayerId) => {
      if (!gameState) return;
      const mulliganAction = getAIAction(gameState, player);
      if (mulliganAction.type === 'mulligan') {
        dispatch({
          type: 'SUBMIT_MULLIGAN',
          player,
          cardIds: mulliganAction.cardInstanceIds,
        });
      } else {
        dispatch({ type: 'SUBMIT_MULLIGAN', player, cardIds: [] });
      }
    },
    [gameState, dispatch],
  );

  useAILoop({
    gameState,
    mode: uiState.mode,
    humanPlayer: uiState.humanPlayer,
    isPaused: uiState.isPaused,
    aiSpeed: uiState.aiSpeed,
    isAIThinking: uiState.isAIThinking,
    gameStarted: uiState.gameStarted,
    mulliganDone: uiState.mulliganDone,
    onAIAction: handleAIAction,
    onAIThinkingChange: handleAIThinkingChange,
    onAIMulligan: handleAIMulligan,
  });

  // ============================================================
  // Auto-pass logic (ported from GameProvider)
  // ============================================================
  const autoPassRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (autoPassRef.current) {
      clearTimeout(autoPassRef.current);
      autoPassRef.current = null;
    }

    if (!gameState || !isMyTurn || uiState.mode !== 'pvai' || gameState.gameOver) return;
    if (!uiState.gameStarted) return;

    const humanPlayer = uiState.humanPlayer;
    const isTurnPlayer = gameState.currentTurn === humanPlayer;
    const phase = gameState.phase;
    const hasChain = gameState.chain.length > 0;

    let shouldAutoPass = false;

    const hasAbilityCards = gameState.players[humanPlayer].hand.some((id) => {
      try {
        const def = getCardDefForInstance(gameState, id);
        return def.cardType === 'ability';
      } catch { return false; }
    });

    if (!isTurnPlayer) {
      if (phase === 'main') {
        const hasCounterStrategies = legalActions.includes('play-strategy');
        if (!hasCounterStrategies) shouldAutoPass = true;
      } else if (phase === 'battle-eoa') {
        if (!hasAbilityCards) shouldAutoPass = true;
      }
    } else {
      if (hasChain && phase === 'main') shouldAutoPass = true;
      if (phase === 'start') shouldAutoPass = true;
      if (phase === 'end' && gameState.players[humanPlayer].hand.length <= 7) shouldAutoPass = true;
      if (phase === 'battle-eoa' && !hasAbilityCards) shouldAutoPass = true;
      if (phase === 'battle-showdown' && legalActions.includes('choose-showdown-order')) {
        const myAttackingTeams = Object.values(gameState.teams).filter(
          (t) => t.owner === humanPlayer && t.isAttacking,
        );
        if (myAttackingTeams.length <= 1) {
          autoPassRef.current = setTimeout(() => {
            dispatch({
              type: 'PERFORM_ACTION',
              player: humanPlayer,
              action: {
                type: 'choose-showdown-order',
                teamIds: myAttackingTeams.map((t) => t.id),
              },
            });
            autoPassRef.current = null;
          }, 100);
          return () => {
            if (autoPassRef.current) {
              clearTimeout(autoPassRef.current);
              autoPassRef.current = null;
            }
          };
        }
      }
    }

    if (shouldAutoPass) {
      autoPassRef.current = setTimeout(() => {
        dispatch({
          type: 'PERFORM_ACTION',
          player: humanPlayer,
          action: { type: 'pass-priority' },
        });
        autoPassRef.current = null;
      }, 100);
    }

    return () => {
      if (autoPassRef.current) {
        clearTimeout(autoPassRef.current);
        autoPassRef.current = null;
      }
    };
  }, [gameState, isMyTurn, legalActions, uiState.mode, uiState.humanPlayer, uiState.gameStarted, dispatch]);

  // ============================================================
  // Render
  // ============================================================
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#0d1117',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
