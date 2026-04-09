// ============================================================
// Test Game — Run a simulated AI vs AI game to verify engine
// ============================================================

import { createNewGame, performMulligan } from './engine/gameSetup';
import { advanceToStartPhase } from './engine/gameLoop';
import { processAction } from './engine/actionProcessor';
import { getAIAction } from './ai/basicAI';
import { GameState, PlayerId } from './types';
import { getOpponent } from './engine/utils';

export function runTestGame(verbose: boolean = true): GameState {
  // Create a new game
  const state = createNewGame();

  if (verbose) {
    console.log('='.repeat(60));
    console.log('PRIMAL TCG DIGITAL — TEST GAME');
    console.log('='.repeat(60));
    console.log(`First player: ${state.currentTurn}`);
    console.log(
      `P1 hand: ${state.players.player1.hand.length} cards`
    );
    console.log(
      `P2 hand: ${state.players.player2.hand.length} cards`
    );
    console.log('');
  }

  // Mulligan phase
  for (const player of ['player1', 'player2'] as PlayerId[]) {
    const mulliganAction = getAIAction(state, player);
    if (mulliganAction.type === 'mulligan') {
      performMulligan(state, player, mulliganAction.cardInstanceIds);
      if (verbose) {
        console.log(
          `${player} mulligan: returned ${mulliganAction.cardInstanceIds.length} card(s)`
        );
      }
    }
  }

  // Start the game
  advanceToStartPhase(state);

  // Game loop
  let actionCount = 0;
  const maxActions = 1000; // safety limit
  const maxTurnNumber = 50; // safety limit

  while (!state.gameOver && state.turnNumber <= maxTurnNumber && actionCount < maxActions) {
    // Determine who should act based on the current phase
    let actingPlayer: PlayerId;

    if (
      state.phase === 'organization' ||
      state.phase === 'battle-attack' ||
      state.phase === 'battle-showdown'
    ) {
      actingPlayer = state.currentTurn;
    } else if (state.phase === 'battle-block') {
      actingPlayer = getOpponent(state.currentTurn);
    } else {
      actingPlayer = state.priorityPlayer;
    }

    const action = getAIAction(state, actingPlayer);
    actionCount++;

    if (verbose && action.type !== 'pass-priority') {
      console.log(
        `[Turn ${state.turnNumber} | ${state.phase}] ${actingPlayer}: ${action.type}`
      );
    }

    const result = processAction(state, actingPlayer, action);

    if (!result.success) {
      if (verbose) {
        console.log(`  ERROR: ${result.error}`);
      }
      // If we get stuck on a non-priority phase, break to prevent infinite loop
      if (state.phase === 'organization' || state.phase === 'battle-attack' ||
          state.phase === 'battle-block' || state.phase === 'battle-showdown') {
        if (verbose) console.log('  Stuck in non-priority phase, forcing end');
        break;
      }
      // Otherwise try passing priority to advance
      processAction(state, actingPlayer, { type: 'pass-priority' });
    }
  }

  if (verbose) {
    console.log('');
    console.log('='.repeat(60));
    if (state.gameOver) {
      console.log(`GAME OVER — Winner: ${state.winner}`);
      console.log(`Reason: ${state.winReason}`);
    } else {
      console.log('GAME ENDED — Max turns/actions reached');
    }
    console.log(
      `P1: ${state.players.player1.battleRewards.length} BRs, ${state.players.player1.deck.length} cards in deck`
    );
    console.log(
      `P2: ${state.players.player2.battleRewards.length} BRs, ${state.players.player2.deck.length} cards in deck`
    );
    console.log(
      `P1 kingdom: ${state.players.player1.kingdom.length} | P2 kingdom: ${state.players.player2.kingdom.length}`
    );
    console.log(
      `P1 discard: ${state.players.player1.discard.length} | P2 discard: ${state.players.player2.discard.length}`
    );
    console.log(`Total actions: ${actionCount}`);
    console.log(`Turns played: ${state.turnNumber}`);
    console.log('='.repeat(60));
  }

  return state;
}

// Run multiple games for consistency testing
function runMultipleGames(count: number): void {
  const results = { player1: 0, player2: 0, draw: 0 };
  const reasons: Record<string, number> = {};

  for (let i = 0; i < count; i++) {
    const state = runTestGame(false);
    if (state.gameOver && state.winner) {
      results[state.winner]++;
      const reason = state.winReason || 'unknown';
      reasons[reason] = (reasons[reason] || 0) + 1;
    } else {
      results.draw++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULTS OVER ${count} GAMES`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Player 1 wins: ${results.player1} (${((results.player1 / count) * 100).toFixed(1)}%)`);
  console.log(`Player 2 wins: ${results.player2} (${((results.player2 / count) * 100).toFixed(1)}%)`);
  console.log(`Draws/Timeouts: ${results.draw}`);
  console.log(`Win reasons:`, reasons);
  console.log('='.repeat(60));
}

// Run if executed directly
if (typeof require !== 'undefined' && require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--multi')) {
    const count = parseInt(args[args.indexOf('--multi') + 1]) || 10;
    runMultipleGames(count);
  } else {
    runTestGame(true);
  }
}
