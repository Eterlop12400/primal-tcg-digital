// ============================================================
// Action Processor — Handles player/AI inputs and advances game
// ============================================================

import {
  GameState,
  PlayerAction,
  PlayerId,
  ChainEntry,
  CharacterCardDef,
  StrategyCardDef,
  AbilityCardDef,
} from '../types';
import {
  getCard,
  getCardDef,
  getCardDefForInstance,
  moveCard,
  moveCardToBottomOfDeck,
  addLog,
  getOpponent,
  generateId,
  canPayHandCost,
  characterHasAttribute,
  cardHasSymbol,
} from './utils';
import {
  advanceToStartPhase,
  advanceToOrganizationPhase,
  advanceToBattlePhase,
  advanceToEndPhase,
  advanceToEOA,
  advanceToShowdown,
  organizeTeams,
  sendAttackers,
  assignBlockers,
  resolveShowdown,
  returnFromBattlefield,
  handlePassPriority,
} from './gameLoop';
import { resolveChain, checkSentToAttackTriggers, checkSentToBattleTriggers } from './chainResolver';

export function processAction(
  state: GameState,
  player: PlayerId,
  action: PlayerAction
): { success: boolean; error?: string } {
  // Validate it's this player's turn to act
  if (state.gameOver) {
    return { success: false, error: 'Game is over' };
  }

  switch (action.type) {
    case 'concede':
      return handleConcede(state, player);

    case 'mulligan':
      return handleMulligan(state, player, action);

    case 'pass-priority':
      return handlePass(state, player);

    case 'summon':
      return handleSummon(state, player, action);

    case 'play-strategy':
      return handlePlayStrategy(state, player, action);

    case 'play-ability':
      return handlePlayAbility(state, player, action);

    case 'activate-effect':
      return handleActivateEffect(state, player, action);

    case 'charge-essence':
      return handleChargeEssence(state, player, action);

    case 'organize-teams':
      return handleOrganizeTeams(state, player, action);

    case 'choose-battle-or-end':
      return handleBattleOrEnd(state, player, action);

    case 'select-attackers':
      return handleSelectAttackers(state, player, action);

    case 'select-blockers':
      return handleSelectBlockers(state, player, action);

    case 'choose-showdown-order':
      return handleShowdownOrder(state, player, action);

    case 'discard-to-hand-limit':
      return handleDiscardToHandLimit(state, player, action);

    case 'search-select':
      return handleSearchSelect(state, player, action);

    default:
      return { success: false, error: `Unknown action type` };
  }
}

// --- Individual Action Handlers ---

function handleConcede(
  state: GameState,
  player: PlayerId
): { success: boolean; error?: string } {
  state.gameOver = true;
  state.winner = getOpponent(player);
  state.winReason = 'concede';
  addLog(state, player, 'concede', `${player} concedes`);
  return { success: true };
}

function handleMulligan(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'mulligan' }>
): { success: boolean; error?: string } {
  // Import and use performMulligan from gameSetup
  const { performMulligan } = require('./gameSetup');
  performMulligan(state, player, action.cardInstanceIds);
  return { success: true };
}

function handlePass(
  state: GameState,
  player: PlayerId
): { success: boolean; error?: string } {
  if (state.priorityPlayer !== player) {
    return { success: false, error: 'Not your priority' };
  }

  addLog(state, player, 'pass', 'Passed priority');
  handlePassPriority(state);
  return { success: true };
}

function handleSummon(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'summon' }>
): { success: boolean; error?: string } {
  if (state.phase !== 'main') {
    return { success: false, error: 'Can only summon during Main Phase' };
  }
  if (state.currentTurn !== player) {
    return { success: false, error: 'Can only summon on your turn' };
  }
  if (state.players[player].hasSummonedThisTurn) {
    return { success: false, error: 'Already summoned this turn' };
  }
  if (state.chain.length > 0) {
    return { success: false, error: 'Cannot summon while chain is active' };
  }

  const card = getCard(state, action.cardInstanceId);
  const def = getCardDefForInstance(state, action.cardInstanceId);

  if (def.cardType !== 'character') {
    return { success: false, error: 'Card is not a character' };
  }
  if (card.zone !== 'hand') {
    return { success: false, error: 'Card is not in hand' };
  }

  const charDef = def as CharacterCardDef;
  if (charDef.turnCost > state.players[player].turnMarker) {
    return { success: false, error: 'Turn Marker too low' };
  }

  // Pay hand cost
  if (charDef.handCost > 0) {
    if (!action.handCostCardIds || action.handCostCardIds.length < charDef.handCost) {
      return { success: false, error: 'Insufficient hand cost payment' };
    }

    // Validate hand cost cards have matching symbols
    for (const costCardId of action.handCostCardIds) {
      const costCard = getCard(state, costCardId);
      if (costCard.zone !== 'hand' || costCard.owner !== player) {
        return { success: false, error: 'Invalid hand cost card' };
      }
      const costDef = getCardDefForInstance(state, costCardId);
      if (!charDef.symbols.some((s) => costDef.symbols.includes(s))) {
        return { success: false, error: 'Hand cost card symbol does not match' };
      }
    }

    // Move hand cost cards to essence
    for (const costCardId of action.handCostCardIds) {
      moveCard(state, costCardId, 'essence');
    }
  }

  // Move character to general play area
  moveCard(state, action.cardInstanceId, 'general-play' as any);

  // Add summon to chain
  const chainEntry: ChainEntry = {
    id: generateId('chain'),
    type: 'summon',
    sourceCardInstanceId: action.cardInstanceId,
    resolved: false,
    negated: false,
    owner: player,
  };
  state.chain.push(chainEntry);
  state.players[player].hasSummonedThisTurn = true;

  // Pass priority to opponent
  state.priorityPlayer = getOpponent(player);
  state.consecutivePasses = 0;

  addLog(state, player, 'summon', `Summoning ${def.name}`);

  return { success: true };
}

function handlePlayStrategy(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'play-strategy' }>
): { success: boolean; error?: string } {
  if (state.phase !== 'main') {
    return { success: false, error: 'Can only play strategies during Main Phase' };
  }
  if (state.players[player].hasPlayedStrategyThisTurn) {
    return { success: false, error: 'Already played a strategy this turn' };
  }

  const card = getCard(state, action.cardInstanceId);
  const def = getCardDefForInstance(state, action.cardInstanceId) as StrategyCardDef;

  if (def.cardType !== 'strategy') {
    return { success: false, error: 'Card is not a strategy' };
  }
  if (card.zone !== 'hand') {
    return { success: false, error: 'Card is not in hand' };
  }

  // Check Counter keyword restrictions
  const isTurnPlayer = state.currentTurn === player;
  if (isTurnPlayer && def.keywords.includes('counter')) {
    return { success: false, error: 'Counter strategies can only be played on opponent\'s turn' };
  }
  if (!isTurnPlayer && !def.keywords.includes('counter')) {
    return { success: false, error: 'Non-Counter strategies can only be played on your turn' };
  }

  if (def.turnCost > state.players[player].turnMarker) {
    return { success: false, error: 'Turn Marker too low' };
  }

  // Check Unique
  if (def.keywords.includes('unique')) {
    const kingdom = state.players[player].kingdom;
    const hasInPlay = kingdom.some((id) => {
      const d = getCardDefForInstance(state, id);
      return d.printNumber === def.printNumber;
    });
    if (hasInPlay) {
      return { success: false, error: 'Unique — card with same print number already in play' };
    }
  }

  // Pay hand cost
  if (def.handCost > 0) {
    if (!action.handCostCardIds || action.handCostCardIds.length < def.handCost) {
      return { success: false, error: 'Insufficient hand cost payment' };
    }
    for (const costCardId of action.handCostCardIds) {
      const costDef = getCardDefForInstance(state, costCardId);
      if (!def.symbols.some((s) => costDef.symbols.includes(s))) {
        return { success: false, error: 'Hand cost card symbol does not match' };
      }
      moveCard(state, costCardId, 'essence');
    }
  }

  // Move to general play area
  moveCard(state, action.cardInstanceId, 'general-play' as any);

  // Add to chain
  const chainEntry: ChainEntry = {
    id: generateId('chain'),
    type: 'strategy',
    sourceCardInstanceId: action.cardInstanceId,
    targetIds: action.targetIds,
    resolved: false,
    negated: false,
    owner: player,
  };
  state.chain.push(chainEntry);
  state.players[player].hasPlayedStrategyThisTurn = true;

  state.priorityPlayer = getOpponent(player);
  state.consecutivePasses = 0;

  addLog(state, player, 'play-strategy', `Playing ${def.name}`);

  return { success: true };
}

function handlePlayAbility(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'play-ability' }>
): { success: boolean; error?: string } {
  if (state.phase !== 'battle-eoa') {
    return { success: false, error: 'Can only play abilities during Exchange of Ability' };
  }

  const card = getCard(state, action.cardInstanceId);
  const def = getCardDefForInstance(state, action.cardInstanceId) as AbilityCardDef;

  if (def.cardType !== 'ability') {
    return { success: false, error: 'Card is not an ability' };
  }
  if (card.zone !== 'hand') {
    return { success: false, error: 'Card is not in hand' };
  }

  // Validate user
  const user = getCard(state, action.userId);
  if (user.zone !== 'battlefield' || user.owner !== player) {
    return { success: false, error: 'User must be on your battlefield' };
  }

  // Check requirements
  for (const req of def.requirements) {
    if (req.type === 'attribute') {
      if (!characterHasAttribute(state, action.userId, req.value)) {
        return { success: false, error: `User doesn't have required attribute: ${req.value}` };
      }
    }
  }

  // Pay essence cost
  if (action.essenceCostCardIds.length > 0) {
    for (const essCardId of action.essenceCostCardIds) {
      const essCard = getCard(state, essCardId);
      if (essCard.zone !== 'essence' || essCard.owner !== player) {
        return { success: false, error: 'Invalid essence payment card' };
      }
      moveCard(state, essCardId, 'discard');
    }
  }

  // Move ability to general play area
  moveCard(state, action.cardInstanceId, 'general-play' as any);

  // Add to chain
  const chainEntry: ChainEntry = {
    id: generateId('chain'),
    type: 'ability',
    sourceCardInstanceId: action.cardInstanceId,
    userId: action.userId,
    targetIds: action.targetIds,
    xValue: action.xValue,
    resolved: false,
    negated: false,
    owner: player,
  };
  state.chain.push(chainEntry);

  state.priorityPlayer = getOpponent(player);
  state.consecutivePasses = 0;

  addLog(state, player, 'play-ability', `Playing ${def.name}`);

  return { success: true };
}

function handleActivateEffect(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'activate-effect' }>
): { success: boolean; error?: string } {
  const card = getCard(state, action.cardInstanceId);
  const def = getCardDefForInstance(state, action.cardInstanceId);

  if (def.cardType !== 'character') {
    return { success: false, error: 'Only character cards have activate effects in this deck' };
  }

  const charDef = def as CharacterCardDef;
  const effect = charDef.effects.find((e) => e.id === action.effectId);

  if (!effect || effect.type !== 'activate') {
    return { success: false, error: 'Effect not found or not an activate effect' };
  }

  // Check injured
  if (card.state === 'injured' && !effect.isValid) {
    return { success: false, error: 'Character is injured and effect is not Valid' };
  }

  // Check once per turn
  if (effect.oncePerTurn && card.usedEffects.includes(effect.id)) {
    return { success: false, error: 'Effect already used this turn' };
  }

  // Check timing
  const isTurnPlayer = state.currentTurn === player;
  if (effect.turnTiming === 'your-turn' && !isTurnPlayer) {
    return { success: false, error: 'Effect can only be used on your turn' };
  }
  if (effect.timing === 'main' && state.phase !== 'main') {
    return { success: false, error: 'Effect can only be used during Main Phase' };
  }
  if (effect.timing === 'eoa' && state.phase !== 'battle-eoa') {
    return { success: false, error: 'Effect can only be used during EOA' };
  }

  // Pay costs (handled per-card, cost cards passed in action)
  if (action.costCardIds) {
    for (const costId of action.costCardIds) {
      // Cost handling is card-specific — the action includes the cards to use
      // Actual cost validation should be done here per effect
    }
  }

  // Mark effect as used
  card.usedEffects.push(effect.id);

  // Add to chain
  const chainEntry: ChainEntry = {
    id: generateId('chain'),
    type: 'activate-effect',
    sourceCardInstanceId: action.cardInstanceId,
    effectId: action.effectId,
    targetIds: action.targetIds,
    resolved: false,
    negated: false,
    owner: player,
  };
  state.chain.push(chainEntry);

  state.priorityPlayer = getOpponent(player);
  state.consecutivePasses = 0;

  addLog(state, player, 'activate', `Activated ${def.name}'s effect`);

  return { success: true };
}

function handleChargeEssence(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'charge-essence' }>
): { success: boolean; error?: string } {
  if (state.phase !== 'main') {
    return { success: false, error: 'Can only charge during Main Phase' };
  }
  if (state.currentTurn !== player) {
    return { success: false, error: 'Can only charge on your turn' };
  }
  if (state.chain.length > 0) {
    return { success: false, error: 'Cannot charge while chain is active' };
  }

  for (const cardId of action.cardInstanceIds) {
    const card = getCard(state, cardId);
    if (card.zone !== 'hand' || card.owner !== player) {
      return { success: false, error: 'Card not in your hand' };
    }
    moveCard(state, cardId, 'essence');
  }

  addLog(
    state,
    player,
    'charge',
    `Charged ${action.cardInstanceIds.length} card(s) to Essence`
  );

  // Charging does NOT pass priority or start a chain
  return { success: true };
}

function handleOrganizeTeams(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'organize-teams' }>
): { success: boolean; error?: string } {
  if (state.phase !== 'organization') {
    return { success: false, error: 'Not in Organization Phase' };
  }
  if (state.currentTurn !== player) {
    return { success: false, error: 'Not your turn' };
  }

  // Validate team sizes (max 3 per team)
  for (const team of action.teams) {
    if (team.supportIds.length > 2) {
      return { success: false, error: 'Max 3 characters per team' };
    }
  }

  organizeTeams(state, player, action.teams);
  addLog(state, player, 'organize', `Organized ${action.teams.length} team(s)`);

  return { success: true };
}

function handleBattleOrEnd(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'choose-battle-or-end' }>
): { success: boolean; error?: string } {
  if (state.phase !== 'organization') {
    return { success: false, error: 'Not in Organization Phase' };
  }

  // First turn of the game must go to End Phase
  if (state.turnNumber === 1) {
    action.choice = 'end';
  }

  if (action.choice === 'battle') {
    advanceToBattlePhase(state);
  } else {
    advanceToEndPhase(state);
  }

  return { success: true };
}

function handleSelectAttackers(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'select-attackers' }>
): { success: boolean; error?: string } {
  if (state.phase !== 'battle-attack') {
    return { success: false, error: 'Not in Attack Step' };
  }

  // Validate max 3 teams
  if (action.teamIds.length > 3) {
    return { success: false, error: 'Maximum 3 teams can attack' };
  }

  // Check sent-to-attack triggers before sending
  const allAttackerIds: string[] = [];
  for (const teamId of action.teamIds) {
    const team = state.teams[teamId];
    if (team) {
      allAttackerIds.push(...team.characterIds);
    }
  }

  sendAttackers(state, action.teamIds);

  // Check triggers
  checkSentToAttackTriggers(state, allAttackerIds, player);

  // Also check "sent to battle while injured" triggers
  checkSentToBattleTriggers(state, allAttackerIds, player);

  // If there are pending triggers, resolve them
  if (state.pendingTriggers.length > 0) {
    const triggers = [...state.pendingTriggers];
    state.pendingTriggers = [];
    for (const t of triggers) {
      state.chain.push(t);
    }
    resolveChain(state);
  }

  return { success: true };
}

function handleSelectBlockers(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'select-blockers' }>
): { success: boolean; error?: string } {
  if (state.phase !== 'battle-block') {
    return { success: false, error: 'Not in Block Step' };
  }

  assignBlockers(state, action.assignments);
  return { success: true };
}

function handleShowdownOrder(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'choose-showdown-order' }>
): { success: boolean; error?: string } {
  if (state.phase !== 'battle-showdown') {
    return { success: false, error: 'Not in Showdown Step' };
  }

  // Resolve each showdown in the order chosen by turn player
  for (const teamId of action.teamIds) {
    resolveShowdown(state, teamId);
  }

  // Return all characters from battlefield to kingdom
  returnFromBattlefield(state);

  // Advance to End Phase
  advanceToEndPhase(state);

  return { success: true };
}

function handleDiscardToHandLimit(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'discard-to-hand-limit' }>
): { success: boolean; error?: string } {
  const hand = state.players[player].hand;
  const excess = hand.length - 7;

  if (excess <= 0) {
    return { success: false, error: 'Hand is not over limit' };
  }

  if (action.cardInstanceIds.length !== excess) {
    return { success: false, error: `Must discard exactly ${excess} card(s)` };
  }

  for (const cardId of action.cardInstanceIds) {
    moveCard(state, cardId, 'discard');
  }

  addLog(state, player, 'discard-hand-limit', `Discarded ${excess} card(s) to hand limit`);

  return { success: true };
}

function handleSearchSelect(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'search-select' }>
): { success: boolean; error?: string } {
  // This is used for interactive deck searches — will be wired up with UI
  return { success: true };
}
