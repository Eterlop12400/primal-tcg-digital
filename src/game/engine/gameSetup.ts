// ============================================================
// Game Setup — Initialize a new game
// ============================================================

import {
  GameState,
  PlayerId,
  PlayerState,
  CardInstance,
} from '../types';
import { STARTER_DECK_1_LIST } from '../cards/starter-deck-1';
import { getCardDef } from '../cards';
import {
  createCardInstance,
  generateId,
  resetIdCounter,
  shuffleDeck,
  drawCards,
  addLog,
} from './utils';

export interface DeckConfig {
  fieldCardId?: string;
  mainDeck: { cardId: string; count: number }[];
}

function createPlayerState(
  playerId: PlayerId,
  deckConfig: DeckConfig,
  gameState: GameState
): PlayerState {
  const playerState: PlayerState = {
    id: playerId,
    turnMarker: 0,
    hasSummonedThisTurn: false,
    hasPlayedStrategyThisTurn: false,
    hasUsedRushThisTurn: false,
    deck: [],
    hand: [],
    kingdom: [],
    battlefield: [],
    essence: [],
    discard: [],
    expel: [],
    battleRewards: [],
  };

  // Create field card instance
  if (deckConfig.fieldCardId) {
    const fieldInstance = createCardInstance(
      deckConfig.fieldCardId,
      playerId,
      'field-area'
    );
    gameState.cards[fieldInstance.instanceId] = fieldInstance;
    playerState.fieldCard = fieldInstance.instanceId;
  }

  // Create main deck card instances
  for (const entry of deckConfig.mainDeck) {
    for (let i = 0; i < entry.count; i++) {
      const instance = createCardInstance(entry.cardId, playerId, 'deck');
      gameState.cards[instance.instanceId] = instance;
      playerState.deck.push(instance.instanceId);
    }
  }

  return playerState;
}

export function createNewGame(
  player1Deck?: DeckConfig,
  player2Deck?: DeckConfig
): GameState {
  resetIdCounter();

  // Default to Starter Deck 1 for both players
  const defaultDeck: DeckConfig = {
    fieldCardId: 'F0005',
    mainDeck: STARTER_DECK_1_LIST,
  };

  const deck1 = player1Deck ?? defaultDeck;
  const deck2 = player2Deck ?? defaultDeck;

  const gameState: GameState = {
    players: {} as Record<PlayerId, PlayerState>,
    cards: {},
    teams: {},
    turnNumber: 0,
    currentTurn: 'player1', // will be set by coin flip
    phase: 'setup',
    isFirstTurn: true,
    priorityPlayer: 'player1',
    consecutivePasses: 0,
    chain: [],
    isChainResolving: false,
    pendingTriggers: [],
    lingeringEffects: [],
    gameOver: false,
    log: [],
  };

  // Create player states
  gameState.players.player1 = createPlayerState('player1', deck1, gameState);
  gameState.players.player2 = createPlayerState('player2', deck2, gameState);

  // Shuffle both decks
  shuffleDeck(gameState, 'player1');
  shuffleDeck(gameState, 'player2');

  // Determine who goes first (coin flip)
  const firstPlayer: PlayerId = Math.random() < 0.5 ? 'player1' : 'player2';
  gameState.currentTurn = firstPlayer;
  gameState.priorityPlayer = firstPlayer;

  addLog(gameState, firstPlayer, 'goes-first', `${firstPlayer} wins the coin flip`);

  // Draw initial hands (6 cards each)
  drawCards(gameState, 'player1', 6);
  drawCards(gameState, 'player2', 6);

  addLog(gameState, 'player1', 'draw-initial', 'Drew 6 cards');
  addLog(gameState, 'player2', 'draw-initial', 'Drew 6 cards');

  // Move to mulligan phase — players can choose to mulligan
  // (handled by game loop awaiting PlayerAction of type 'mulligan')

  return gameState;
}

// --- Mulligan ---
// Player may move any number of cards from hand to bottom of deck,
// draw that many, then shuffle. Once per game per player.
export function performMulligan(
  state: GameState,
  player: PlayerId,
  cardIdsToReturn: string[]
): void {
  if (cardIdsToReturn.length === 0) {
    addLog(state, player, 'mulligan-skip', 'Kept opening hand');
    return;
  }

  const playerState = state.players[player];
  const count = cardIdsToReturn.length;

  // Move selected cards to bottom of deck
  for (const cardId of cardIdsToReturn) {
    const idx = playerState.hand.indexOf(cardId);
    if (idx !== -1) {
      playerState.hand.splice(idx, 1);
      playerState.deck.push(cardId);
      const card = state.cards[cardId];
      card.zone = 'deck';
    }
  }

  // Draw that many cards
  drawCards(state, player, count);

  // Shuffle deck
  shuffleDeck(state, player);

  addLog(
    state,
    player,
    'mulligan',
    `Returned ${count} card(s) and drew ${count} new card(s)`
  );
}
