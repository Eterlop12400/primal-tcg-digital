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
import { AUTO_PASS_DELAY_MS, SPEED_PRESETS } from '@/lib/constants';
import { GameRenderer } from './GameRenderer';

interface PixiGameCanvasProps {
  mode: GameMode;
  p1Deck?: string;
  p2Deck?: string;
}

export function PixiGameCanvas({ mode, p1Deck, p2Deck }: PixiGameCanvasProps) {
  const { uiState, dispatch, gameState, legalActions, isMyTurn } = useGameEngine();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const initRef = useRef(false);
  const consumedEventsRef = useRef<Set<number>>(new Set());
  const [rendererReady, setRendererReady] = useState(false);
  const [isAnimationBusy, setIsAnimationBusy] = useState(false);

  // ============================================================
  // Initialize game on mount
  // ============================================================
  useEffect(() => {
    dispatch({ type: 'INIT_GAME', mode, p1Deck, p2Deck });
  }, [mode, p1Deck, p2Deck, dispatch]);

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
      if (mode === 'pvai') {
        renderer.setHumanPlayer('player1');
      }
      setRendererReady(true);
    });

    // Handle resize with debounce to avoid layout thrashing
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => renderer.resize(), 50);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimer) clearTimeout(resizeTimer);
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
    // Filter out events that were already consumed to prevent duplicate animations
    const newEvents = uiState.pendingEvents.filter(
      (e) => !consumedEventsRef.current.has(e.sequenceId),
    );
    // Mark these events as consumed
    for (const e of newEvents) {
      consumedEventsRef.current.add(e.sequenceId);
    }
    // Prevent unbounded growth — clear old IDs periodically
    if (consumedEventsRef.current.size > 500) {
      consumedEventsRef.current = new Set(
        [...consumedEventsRef.current].slice(-200),
      );
    }
    rendererRef.current.update(gameState, uiState, newEvents);
  }, [gameState, uiState, rendererReady]);

  // ============================================================
  // Poll animation busy state (100ms interval)
  // ============================================================
  useEffect(() => {
    if (!rendererReady) return;
    const interval = setInterval(() => {
      const busy = rendererRef.current?.isAnimationBusy ?? false;
      setIsAnimationBusy(busy);
    }, 100);
    return () => clearInterval(interval);
  }, [rendererReady]);

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
    speedPreset: uiState.speedPreset,
    isAIThinking: uiState.isAIThinking,
    gameStarted: uiState.gameStarted,
    mulliganDone: uiState.mulliganDone,
    isAnimationBusy,
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

    // Don't auto-pass while animations are playing
    if (isAnimationBusy) return;

    // Don't auto-pass when there's a pending interactive choice
    if (gameState.pendingSearch || gameState.pendingTargetChoice || gameState.pendingOptionalEffect) return;

    const autoPassDelay = SPEED_PRESETS[uiState.speedPreset].autoPassDelay;
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

    // Check if player has any teams to block with
    const myTeams = Object.values(gameState.teams).filter(
      (t) => t.owner === humanPlayer && !t.isAttacking && !t.isBlocking,
    );

    // Check if player has characters with usable activate effects
    const hasActivateEffects = gameState.players[humanPlayer].kingdom
      .concat(gameState.players[humanPlayer].battlefield)
      .some((id) => {
        try {
          const def = getCardDefForInstance(gameState, id);
          if (def.cardType !== 'character') return false;
          const card = gameState.cards[id];
          return def.effects.some((e) =>
            e.type === 'activate' &&
            !card?.usedEffects.includes(e.id) &&
            (e.timing === 'eoa' || e.timing === 'both')
          );
        } catch { return false; }
      });

    // Check if player has characters on the battlefield (needed to use abilities)
    const hasBattlefieldChars = gameState.players[humanPlayer].battlefield.some((id) => {
      const card = gameState.cards[id];
      return card && card.owner === humanPlayer;
    });

    // Check if player has a field card with activate effects
    const hasFieldActivate = (() => {
      const fieldId = gameState.players[humanPlayer].fieldCard;
      if (!fieldId) return false;
      try {
        const def = getCardDefForInstance(gameState, fieldId);
        return def.cardType === 'field' && (def as { effects?: { type: string }[] }).effects?.some((e: { type: string }) => e.type === 'activate');
      } catch { return false; }
    })();

    // Check if player has essence cards with activate-from-essence effects
    const hasEssenceActivate = gameState.players[humanPlayer].essence.some((id) => {
      try {
        const def = getCardDefForInstance(gameState, id);
        if (def.cardType !== 'strategy') return false;
        return (def as { effects?: { type: string; costDescription?: string }[] }).effects?.some((e: { type: string; costDescription?: string }) =>
          e.type === 'activate' && e.costDescription?.toLowerCase().includes('expel this card from your essence')
        );
      } catch { return false; }
    });

    const hasEOAOptions = (hasBattlefieldChars && (hasAbilityCards || hasActivateEffects))
      || hasFieldActivate || hasEssenceActivate;

    if (!isTurnPlayer) {
      if (phase === 'main') {
        const hasCounterStrategies = legalActions.includes('play-strategy');
        if (!hasCounterStrategies) shouldAutoPass = true;
      } else if (phase === 'battle-eoa') {
        if (!hasEOAOptions) shouldAutoPass = true;
      }

      // Auto-submit empty blockers when player has no teams to block with
      // (defender is the non-turn player during battle-block)
      if (phase === 'battle-block' && legalActions.includes('select-blockers') && myTeams.length === 0) {
        autoPassRef.current = setTimeout(() => {
          dispatch({
            type: 'PERFORM_ACTION',
            player: humanPlayer,
            action: { type: 'select-blockers', assignments: [] },
          });
          autoPassRef.current = null;
        }, autoPassDelay);
        return () => {
          if (autoPassRef.current) {
            clearTimeout(autoPassRef.current);
            autoPassRef.current = null;
          }
        };
      }
    } else {
      if (hasChain && phase === 'main') shouldAutoPass = true;
      if (phase === 'start') shouldAutoPass = true;
      // End phase with hand <= 7 is handled immediately by finishEndPhase —
      // no need to auto-pass since the phase won't linger at 'end'
      // Turn player during EOA must always manually click PASS — never auto-pass

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
          }, autoPassDelay);
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
      }, autoPassDelay);
    }

    return () => {
      if (autoPassRef.current) {
        clearTimeout(autoPassRef.current);
        autoPassRef.current = null;
      }
    };
  }, [gameState, isMyTurn, legalActions, uiState.mode, uiState.humanPlayer, uiState.gameStarted, uiState.speedPreset, isAnimationBusy, dispatch]);

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
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
