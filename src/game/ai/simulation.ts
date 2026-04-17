// ============================================================
// AI Simulation Foundation — clone / simulate / score / enumerate
// ============================================================
// Reusable pure helpers for simulation-based AI decision making.
// No React, no PixiJS — just game state in, score out.
// ============================================================

import {
  GameState,
  PlayerAction,
  PlayerId,
  CharacterCardDef,
  StrategyCardDef,
  AbilityCardDef,
} from '../types';
import { getCardDefForInstance, cardHasSymbol, getOpponent } from '../engine/utils';
import { processAction } from '../engine/actionProcessor';
import { evaluateBoard } from './basicAI';

const MAX_CANDIDATES = 40;

/** Deep clone game state using native structuredClone. GameState is fully serializable. */
export function cloneGameState(state: GameState): GameState {
  return structuredClone(state);
}

/**
 * Clone state, apply the action via processAction, return the resulting clone.
 * Returns null if the action is rejected or throws.
 * Note: no EventCollector is passed — no animation events leak from simulated moves.
 */
export function simulateAction(
  state: GameState,
  player: PlayerId,
  action: PlayerAction,
): GameState | null {
  try {
    const clone = cloneGameState(state);
    const result = processAction(clone, player, action);
    if (!result.success) return null;
    return clone;
  } catch {
    return null;
  }
}

/**
 * Score a candidate action as the board-evaluation delta for `player`.
 * Higher = better for `player`. Also subtracts opponent's evaluation delta
 * (if the move incidentally helps them, we should notice).
 */
export function scoreAction(
  state: GameState,
  player: PlayerId,
  action: PlayerAction,
): number {
  const before = evaluateBoard(state, player);
  const next = simulateAction(state, player, action);
  if (!next) return -Infinity;

  const after = evaluateBoard(next, player);
  const opponent = getOpponent(player);
  const oppBefore = evaluateBoard(state, opponent);
  const oppAfter = evaluateBoard(next, opponent);

  // Delta for us, minus their delta (zero-sum weighting)
  return (after - before) - (oppAfter - oppBefore) * 0.5;
}

/**
 * Enumerate all legal main-phase actions the AI might consider:
 * - summon each affordable character in hand (with cheapest hand-cost)
 * - charge each hand card
 * - play each affordable strategy
 * - pass-priority
 *
 * Capped at MAX_CANDIDATES to keep decision time bounded.
 */
export function enumerateMainPhaseActions(
  state: GameState,
  player: PlayerId,
): PlayerAction[] {
  const ps = state.players[player];
  const candidates: PlayerAction[] = [];

  // Always include pass as a fallback
  candidates.push({ type: 'pass-priority' });

  const hand = ps.hand;

  // Summons — one per affordable character
  if (!ps.hasSummonedThisTurn && state.chain.length === 0) {
    for (const cardId of hand) {
      let def;
      try { def = getCardDefForInstance(state, cardId); } catch { continue; }
      if (def.cardType !== 'character') continue;
      const cd = def as CharacterCardDef;
      if (cd.turnCost > ps.turnMarker) continue;

      // Unique enforcement
      if (cd.characteristics.includes('unique')) {
        const inPlay = [...ps.kingdom, ...ps.battlefield].some((id) => {
          try {
            const d = getCardDefForInstance(state, id);
            return d.printNumber === cd.printNumber;
          } catch { return false; }
        });
        if (inPlay) continue;
      }

      // Build hand-cost payment (lowest-value matching cards)
      let handCostCardIds: string[] = [];
      if (cd.handCost > 0) {
        const available = hand.filter((id) => {
          if (id === cardId) return false;
          try {
            const d = getCardDefForInstance(state, id);
            return cd.symbols.some((s) => d.symbols.includes(s));
          } catch { return false; }
        });
        if (available.length < cd.handCost) continue;
        // Sort ascending by a simple heuristic (turn cost as proxy for value)
        const scored = available.map((id) => {
          try {
            const d = getCardDefForInstance(state, id);
            let v = 0;
            if (d.cardType === 'character') {
              const ccd = d as CharacterCardDef;
              v = ccd.healthyStats.lead + ccd.healthyStats.support;
            }
            return { id, v };
          } catch { return { id, v: 0 }; }
        });
        scored.sort((a, b) => a.v - b.v);
        handCostCardIds = scored.slice(0, cd.handCost).map((s) => s.id);
      }

      candidates.push({ type: 'summon', cardInstanceId: cardId, handCostCardIds });
      if (candidates.length >= MAX_CANDIDATES) return candidates;
    }
  }

  // Strategies — one per affordable, non-counter, non-target-required strategy
  if (!ps.hasPlayedStrategyThisTurn) {
    for (const cardId of hand) {
      let def;
      try { def = getCardDefForInstance(state, cardId); } catch { continue; }
      if (def.cardType !== 'strategy') continue;
      const sd = def as StrategyCardDef;
      if (sd.turnCost > ps.turnMarker) continue;
      if (sd.keywords.includes('counter')) continue;

      // Unique check
      if (sd.keywords.includes('unique')) {
        const inPlay = ps.kingdom.some((id) => {
          try {
            const d = getCardDefForInstance(state, id);
            return d.printNumber === sd.printNumber;
          } catch { return false; }
        });
        if (inPlay) continue;
      }

      // Hand cost
      let handCostCardIds: string[] = [];
      if (sd.handCost > 0) {
        const available = hand.filter((id) => {
          if (id === cardId) return false;
          try {
            const d = getCardDefForInstance(state, id);
            return sd.symbols.some((s) => d.symbols.includes(s));
          } catch { return false; }
        });
        if (available.length < sd.handCost) continue;
        handCostCardIds = available.slice(0, sd.handCost);
      }

      // Skip strategies that require a target — those need separate handling
      // (processAction will reject if targetIds missing, so simulation returns null → score -Inf)
      candidates.push({ type: 'play-strategy', cardInstanceId: cardId, handCostCardIds });
      if (candidates.length >= MAX_CANDIDATES) return candidates;
    }
  }

  // Charges — one per hand card (but cap; typical hand is ≤ 7)
  if (state.chain.length === 0 && ps.essence.length < 7) {
    for (const cardId of hand) {
      candidates.push({ type: 'charge-essence', cardInstanceIds: [cardId] });
      if (candidates.length >= MAX_CANDIDATES) return candidates;
    }
  }

  return candidates;
}

/**
 * Check whether the simulated state is a terminal victory for `player`.
 * Used as an early-exit shortcut during candidate scoring.
 */
export function isWinningState(state: GameState, player: PlayerId): boolean {
  if (state.gameOver && state.winner === player) return true;
  const opponent = getOpponent(player);
  // Opponent reached BR threshold (our BR pile = opponent's earned)
  return state.players[opponent].battleRewards.length >= 7;
}

/**
 * Advance the simulated state until `player` has priority in main phase
 * with an empty chain (ready to take another action), or the state becomes
 * unreachable/terminal/outside main phase.
 *
 * Both players auto-pass (optimistic opponent modeling).
 * Returns null if the simulation gets stuck on an interactive prompt that
 * we can't resolve (pendingOptionalEffect, pendingTargetChoice, pendingSearch).
 */
export function advanceToPlayerTurn(
  state: GameState,
  player: PlayerId,
  maxSteps: number = 5,
): GameState | null {
  let current: GameState = state;

  for (let step = 0; step < maxSteps; step++) {
    // Terminal
    if (current.gameOver) return current;

    // Can't auto-resolve interactive prompts in simulation
    if (
      current.pendingOptionalEffect ||
      current.pendingTargetChoice ||
      current.pendingSearch
    ) {
      return null;
    }

    // Phase moved out of main — planner's depth-2 simulation ends here
    if (current.phase !== 'main') return current;

    // Ready for next player action
    const priorityPlayer = current.priorityPlayer ?? current.currentTurn;
    if (priorityPlayer === player && current.chain.length === 0) {
      return current;
    }

    // Auto-pass on behalf of whoever has priority
    const next = simulateAction(current, priorityPlayer, { type: 'pass-priority' });
    if (!next) return null;
    current = next;
  }

  // Exceeded budget — return what we have if it's usable
  if (
    current.phase === 'main' &&
    (current.priorityPlayer ?? current.currentTurn) === player &&
    current.chain.length === 0
  ) {
    return current;
  }
  return null;
}

interface PlanOptions {
  topK?: number;
  maxSims?: number;
  heuristicBonusFn?: (state: GameState, player: PlayerId, action: PlayerAction) => number;
  /** If true, use full-turn greedy rollout instead of depth-2. Default: true. */
  fullTurn?: boolean;
  /** Max greedy steps per rollout (depth). Default: 6. */
  maxRolloutDepth?: number;
}

/**
 * Greedy continuation: from the given state, repeatedly pick the best next
 * action for `player` (by one-ply evaluateBoard delta) until no action improves
 * the state or the depth/budget is exhausted.
 *
 * Returns the terminal state reached. Handles interactive prompts (returns
 * current state as-is) and phase transitions (out of main = stop).
 */
function greedyRollout(
  state: GameState,
  player: PlayerId,
  budget: { remaining: number },
  maxDepth: number,
  heuristicBonusFn?: (state: GameState, player: PlayerId, action: PlayerAction) => number,
): GameState {
  let current = state;
  const baseMy = evaluateBoard(current, player);

  for (let step = 0; step < maxDepth; step++) {
    if (budget.remaining <= 0) return current;

    // Advance to our turn in main phase
    const ready = advanceToPlayerTurn(current, player);
    budget.remaining -= 3; // amortized cost of advanceToPlayerTurn's internal sims
    if (!ready) return current;
    if (ready.phase !== 'main') return ready; // terminal (organization, battle, etc.)
    current = ready;

    const candidates = enumerateMainPhaseActions(current, player);
    if (candidates.length === 0) return current;

    let bestAction: PlayerAction | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    const beforeMy = evaluateBoard(current, player);

    for (const action of candidates) {
      if (budget.remaining <= 0) break;
      const post = simulateAction(current, player, action);
      budget.remaining--;
      if (!post) continue;
      const afterMy = evaluateBoard(post, player);
      const bonus = heuristicBonusFn ? heuristicBonusFn(current, player, action) : 0;
      const score = (afterMy - beforeMy) + bonus;
      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }

    if (!bestAction) return current;
    // Stop if best action is to pass or if no positive move exists
    if (bestAction.type === 'pass-priority') return current;
    if (bestScore <= 0) return current;

    const next = simulateAction(current, player, bestAction);
    budget.remaining--;
    if (!next) return current;
    current = next;
  }

  // Keep linter happy — baseMy used conceptually as reference
  void baseMy;
  return current;
}

/**
 * Depth-2 lookahead planner for main phase.
 * Enumerates candidate actions, scores each, then expands the top K by
 * simulating priority-pass/chain-resolution and enumerating follow-ups.
 * Returns the first action of the best-scoring plan.
 *
 * Returns null if planning fails entirely (caller should fall back to
 * single-action scoring).
 */
export function planMainPhase(
  state: GameState,
  player: PlayerId,
  options?: PlanOptions,
): PlayerAction | null {
  const topK = options?.topK ?? 8;
  const maxSims = options?.maxSims ?? 200;
  const heuristicBonusFn = options?.heuristicBonusFn;
  const fullTurn = options?.fullTurn ?? true;
  const maxRolloutDepth = options?.maxRolloutDepth ?? 6;

  const candidates = enumerateMainPhaseActions(state, player);
  if (candidates.length === 0) return null;

  let simCount = 0;
  const opponent = getOpponent(player);
  const baseMyEval = evaluateBoard(state, player);
  const baseOppEval = evaluateBoard(state, opponent);

  interface Scored {
    action: PlayerAction;
    depth1Score: number;
    post1State: GameState | null;
    winning: boolean;
  }

  // Depth-1 scoring
  const depth1: Scored[] = [];
  for (const action of candidates) {
    if (simCount >= maxSims) break;
    const post1 = simulateAction(state, player, action);
    simCount++;
    if (!post1) {
      depth1.push({ action, depth1Score: Number.NEGATIVE_INFINITY, post1State: null, winning: false });
      continue;
    }

    // Instant-win short-circuit
    if (isWinningState(post1, player)) {
      return action;
    }

    const myAfter = evaluateBoard(post1, player);
    const oppAfter = evaluateBoard(post1, opponent);
    const rawDelta = (myAfter - baseMyEval) - (oppAfter - baseOppEval) * 0.5;
    const bonus = heuristicBonusFn ? heuristicBonusFn(state, player, action) : 0;
    depth1.push({
      action,
      depth1Score: rawDelta + bonus,
      post1State: post1,
      winning: false,
    });
  }

  // Sort & pick topK candidates for depth-2 expansion
  depth1.sort((a, b) => b.depth1Score - a.depth1Score);
  const finite = depth1.filter((d) => d.depth1Score !== Number.NEGATIVE_INFINITY);
  if (finite.length === 0) return null;

  const expanded = finite.slice(0, topK);
  let bestAction: PlayerAction = finite[0].action;
  let bestScore: number = finite[0].depth1Score;

  for (const cand of expanded) {
    if (simCount >= maxSims) break;
    if (!cand.post1State) continue;

    // "Pass" at depth-1 doesn't get a meaningful depth-2 expansion from our side
    // (we've given up priority); skip the expansion cost but keep the depth-1 score.
    if (cand.action.type === 'pass-priority') {
      if (cand.depth1Score > bestScore) {
        bestScore = cand.depth1Score;
        bestAction = cand.action;
      }
      continue;
    }

    let planScore = cand.depth1Score;

    if (fullTurn) {
      // Full-turn greedy rollout from post1State
      const budget = { remaining: Math.min(30, maxSims - simCount) };
      const terminalState = greedyRollout(cand.post1State, player, budget, maxRolloutDepth, heuristicBonusFn);
      simCount += (30 - budget.remaining);

      if (isWinningState(terminalState, player)) {
        bestScore = Number.POSITIVE_INFINITY;
        bestAction = cand.action;
        break;
      }

      const myFinal = evaluateBoard(terminalState, player);
      const oppFinal = evaluateBoard(terminalState, opponent);
      const terminalDelta = (myFinal - baseMyEval) - (oppFinal - baseOppEval) * 0.5;
      if (terminalDelta > planScore) planScore = terminalDelta;
    } else {
      // Legacy depth-2 expansion
      const myTurnState = advanceToPlayerTurn(cand.post1State, player);
      simCount += 3;

      if (myTurnState && myTurnState.phase === 'main') {
        const depth2Candidates = enumerateMainPhaseActions(myTurnState, player);
        for (const d2 of depth2Candidates) {
          if (simCount >= maxSims) break;
          const post2 = simulateAction(myTurnState, player, d2);
          simCount++;
          if (!post2) continue;
          if (isWinningState(post2, player)) {
            bestScore = Number.POSITIVE_INFINITY;
            bestAction = cand.action;
            break;
          }
          const myFinal = evaluateBoard(post2, player);
          const oppFinal = evaluateBoard(post2, opponent);
          const terminalDelta = (myFinal - baseMyEval) - (oppFinal - baseOppEval) * 0.5;
          if (terminalDelta > planScore) planScore = terminalDelta;
        }
      } else if (myTurnState) {
        const myFinal = evaluateBoard(myTurnState, player);
        const oppFinal = evaluateBoard(myTurnState, opponent);
        const terminalDelta = (myFinal - baseMyEval) - (oppFinal - baseOppEval) * 0.5;
        if (terminalDelta > planScore) planScore = terminalDelta;
      }
    }

    if (bestScore === Number.POSITIVE_INFINITY) break;

    if (planScore > bestScore) {
      bestScore = planScore;
      bestAction = cand.action;
    }
  }

  return bestAction;
}

// Silence unused-import warnings for types that may be referenced in future enhancements
void cardHasSymbol;
void (null as unknown as AbilityCardDef | undefined);
