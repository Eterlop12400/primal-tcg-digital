// ============================================================
// Game Helpers — UI-facing utility functions
// ============================================================

import {
  GameState,
  PlayerId,
  Phase,
  Zone,
  CardInstance,
  CharacterCardDef,
  StrategyCardDef,
} from '@/game/types';
import {
  getCardDefForInstance,
  getEffectiveStats,
  getCardsInZone,
  getOpponent,
  fieldHasName,
  characterHasAttribute,
} from '@/game/engine';

/**
 * Determines which player should currently act based on the game phase.
 *
 * During organization, battle-attack, and battle-showdown: the current turn player acts.
 * During battle-block: the opponent of the current turn player acts.
 * Otherwise (main, EOA, etc.): whoever has priority acts.
 */
export function getActingPlayer(state: GameState): PlayerId {
  if (
    state.phase === 'organization' ||
    state.phase === 'battle-attack' ||
    state.phase === 'battle-showdown'
  ) {
    return state.currentTurn;
  } else if (state.phase === 'battle-block') {
    return getOpponent(state.currentTurn);
  } else {
    return state.priorityPlayer;
  }
}

/**
 * Returns true if the human player is the one who should currently act.
 */
export function isHumanTurn(state: GameState, humanPlayer: PlayerId): boolean {
  return getActingPlayer(state) === humanPlayer;
}

/**
 * Checks if a specific character card can be summoned by the given player.
 *
 * Conditions:
 * - Card is in the player's hand
 * - Card is a character
 * - Turn cost <= player's turn marker
 * - Player has not already summoned this turn
 * - No active chain (chain length === 0)
 * - Phase is main
 * - It's the player's turn
 */
export function canSummonCard(
  state: GameState,
  player: PlayerId,
  instanceId: string
): boolean {
  const playerState = state.players[player];

  // Must be main phase and player's turn
  if (state.phase !== 'main') return false;
  if (state.currentTurn !== player) return false;

  // Can't summon while chain is active
  if (state.chain.length > 0) return false;

  // Can't summon if already summoned this turn
  if (playerState.hasSummonedThisTurn) return false;

  // Card must exist and be in hand
  const card = state.cards[instanceId];
  if (!card || card.zone !== 'hand' || card.owner !== player) return false;

  // Card must be a character
  const def = getCardDefForInstance(state, instanceId);
  if (def.cardType !== 'character') return false;

  const charDef = def as CharacterCardDef;

  // Turn cost must be affordable
  if (charDef.turnCost > playerState.turnMarker) return false;

  // Check Unique characteristic
  if (charDef.characteristics.includes('unique')) {
    const hasInPlay = [...playerState.kingdom, ...playerState.battlefield].some((id) => {
      const d = getCardDefForInstance(state, id);
      return d.printNumber === charDef.printNumber;
    });
    if (hasInPlay) return false;
  }

  // Check hand cost affordability
  if (charDef.handCost > 0) {
    const matchingInHand = playerState.hand.filter((id) => {
      if (id === instanceId) return false;
      const d = getCardDefForInstance(state, id);
      return charDef.symbols.some((s) => d.symbols.includes(s));
    });
    if (matchingInHand.length < charDef.handCost) return false;
  }

  return true;
}

/**
 * Checks if a specific strategy card can be played by the given player.
 *
 * Conditions:
 * - Card is in the player's hand
 * - Card is a strategy
 * - Turn cost <= player's turn marker
 * - Player has not already played a strategy this turn
 * - Counter strategies can only be played on the opponent's turn
 * - Non-counter strategies can only be played on your own turn
 */
export function canPlayStrategyCard(
  state: GameState,
  player: PlayerId,
  instanceId: string
): boolean {
  const playerState = state.players[player];

  // Must be main phase
  if (state.phase !== 'main') return false;

  // Can't play if already played a strategy this turn
  if (playerState.hasPlayedStrategyThisTurn) return false;

  // Card must exist and be in hand
  const card = state.cards[instanceId];
  if (!card || card.zone !== 'hand' || card.owner !== player) return false;

  // Card must be a strategy
  const def = getCardDefForInstance(state, instanceId);
  if (def.cardType !== 'strategy') return false;

  const stratDef = def as StrategyCardDef;

  // Turn cost must be affordable
  if (stratDef.turnCost > playerState.turnMarker) return false;

  // Counter restriction: counter strategies only on opponent's turn,
  // non-counter strategies only on your own turn
  const isTurnPlayer = state.currentTurn === player;
  if (isTurnPlayer && stratDef.keywords.includes('counter')) return false;
  if (!isTurnPlayer && !stratDef.keywords.includes('counter')) return false;

  // Check hand cost affordability
  if (stratDef.handCost > 0) {
    const matchingInHand = playerState.hand.filter((id) => {
      if (id === instanceId) return false;
      const d = getCardDefForInstance(state, id);
      return stratDef.symbols.some((s) => d.symbols.includes(s));
    });
    if (matchingInHand.length < stratDef.handCost) return false;
  }

  // Check Unique keyword
  if (stratDef.keywords.includes('unique')) {
    const inPlay = playerState.kingdom.some((id) => {
      const d = getCardDefForInstance(state, id);
      return d.printNumber === stratDef.printNumber;
    });
    if (inPlay) return false;
  }

  // Card-specific pre-validation
  if (def.id === 'S0040') {
    // Bounty Board: requires field "Slayer Guild's Hideout" AND {Weapon} character in hand
    if (!fieldHasName(state, player, "Slayer Guild's Hideout")) return false;
    const hasWeapon = playerState.hand.some((id) => {
      if (id === instanceId) return false; // Exclude Bounty Board itself
      const d = getCardDefForInstance(state, id);
      return d.cardType === 'character' && characterHasAttribute(state, id, 'Weapon');
    });
    if (!hasWeapon) return false;
  }

  return true;
}

/**
 * Returns the instanceIds of hand cards that can be used to pay the hand cost
 * of a target card. A hand cost card must share at least one symbol with the
 * target card, and must not be the target card itself.
 */
export function getValidHandCostCards(
  state: GameState,
  player: PlayerId,
  targetCardId: string
): string[] {
  const playerState = state.players[player];

  // Get the target card's definition for its symbols
  const targetDef = getCardDefForInstance(state, targetCardId);
  if (targetDef.cardType !== 'character' && targetDef.cardType !== 'strategy') {
    return [];
  }

  const targetSymbols = targetDef.symbols;

  return playerState.hand.filter((id) => {
    // Can't pay with the card itself
    if (id === targetCardId) return false;

    const cardDef = getCardDefForInstance(state, id);
    // Must share at least one symbol with the target card
    return targetSymbols.some((s) => cardDef.symbols.includes(s));
  });
}
