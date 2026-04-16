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
  FieldCardDef,
} from '../types';
import {
  getCard,
  getCardDefForInstance,
  moveCard,
  moveCardToBottomOfDeck,
  drawCards,
  addLog,
  getOpponent,
  generateId,
  canPayHandCost,
  characterHasAttribute,
  cardHasSymbol,
  fieldHasSymbol,
  setupNextEssenceRedirectPrompt,
} from './utils';
import type { EventCollector } from './EventCollector';
import {
  advanceToStartPhase,
  advanceToOrganizationPhase,
  advanceToBattlePhase,
  advanceToEndPhase,
  finishEndPhase,
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
  action: PlayerAction,
  collector?: EventCollector,
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
      return handlePass(state, player, collector);

    case 'summon':
      return handleSummon(state, player, action, collector);

    case 'play-strategy':
      return handlePlayStrategy(state, player, action, collector);

    case 'play-ability':
      return handlePlayAbility(state, player, action, collector);

    case 'activate-effect':
      return handleActivateEffect(state, player, action, collector);

    case 'charge-essence':
      return handleChargeEssence(state, player, action, collector);

    case 'organize-teams':
      return handleOrganizeTeams(state, player, action);

    case 'choose-battle-or-end':
      return handleBattleOrEnd(state, player, action, collector);

    case 'select-attackers':
      return handleSelectAttackers(state, player, action, collector);

    case 'select-blockers':
      return handleSelectBlockers(state, player, action, collector);

    case 'choose-showdown-order':
      return handleShowdownOrder(state, player, action, collector);

    case 'discard-to-hand-limit':
      return handleDiscardToHandLimit(state, player, action, collector);

    case 'search-select':
      return handleSearchSelect(state, player, action);

    case 'resolve-target-choice':
      return handleResolveTargetChoice(state, player, action);

    case 'choose-optional-trigger':
      return handleChooseOptionalTrigger(state, player, action, collector);

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
  player: PlayerId,
  collector?: EventCollector,
): { success: boolean; error?: string } {
  if (state.priorityPlayer !== player) {
    return { success: false, error: 'Not your priority' };
  }

  addLog(state, player, 'pass', 'Passed priority');
  handlePassPriority(state, collector);
  return { success: true };
}

function handleSummon(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'summon' }>,
  collector?: EventCollector,
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

  // Check Unique characteristic
  if (charDef.characteristics.includes('unique')) {
    const kingdom = state.players[player].kingdom;
    const battlefield = state.players[player].battlefield;
    const hasInPlay = [...kingdom, ...battlefield].some((id) => {
      const d = getCardDefForInstance(state, id);
      return d.printNumber === charDef.printNumber;
    });
    if (hasInPlay) {
      return { success: false, error: 'Unique — character with same print number already in play' };
    }
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

  addLog(state, player, 'summon', `Summoning ${def.name}`, action.cardInstanceId);

  // Emit animation event (single close-up for summon — no separate chain notification)
  collector?.emit({
    type: 'card-zone-change',
    player,
    cardId: action.cardInstanceId,
    cardName: def.name,
    defId: def.id,
    fromZone: 'hand',
    toZone: 'general-play' as any,
    reason: 'summon',
  });

  return { success: true };
}

function handlePlayStrategy(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'play-strategy' }>,
  collector?: EventCollector,
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

  addLog(state, player, 'play-strategy', `Playing ${def.name}`, action.cardInstanceId);

  // Single close-up for strategy play (shown as "STRATEGY!" via card-zone-change summon-style)
  collector?.emit({
    type: 'card-zone-change',
    player,
    cardId: action.cardInstanceId,
    cardName: def.name,
    defId: def.id,
    fromZone: 'hand',
    toZone: 'general-play' as any,
    reason: 'play',
  });

  return { success: true };
}

function handlePlayAbility(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'play-ability' }>,
  collector?: EventCollector,
): { success: boolean; error?: string } {
  if (state.phase !== 'battle-eoa') {
    return { success: false, error: 'Can only play abilities during Exchange of Ability' };
  }

  // Check Micromon Beach 6+ restriction
  const noAbilitiesEffect = state.lingeringEffects.find((e) => e.id.startsWith('micromon_beach_no_abilities'));
  if (noAbilitiesEffect) {
    return { success: false, error: 'Ability cards cannot be played this turn (Micromon Beach)' };
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
    if (req.type === 'turn-cost-min') {
      const userDef = getCardDefForInstance(state, action.userId) as CharacterCardDef;
      if (userDef.turnCost < parseInt(req.value, 10)) {
        return { success: false, error: `User must have Turn Cost ${req.value} or higher` };
      }
    }
  }

  // Validate targets are on the battlefield and opposing the user
  if (action.targetIds && action.targetIds.length > 0) {
    // Find the user's team
    const userTeam = Object.values(state.teams).find(
      (t) => t.characterIds.includes(action.userId)
    );
    if (!userTeam) {
      return { success: false, error: 'User is not in any team' };
    }

    for (const tid of action.targetIds) {
      const target = getCard(state, tid);
      if (target.zone !== 'battlefield') {
        return { success: false, error: 'Target must be on the battlefield' };
      }

      // Check target is in an opposing team (blocking or being blocked by user's team)
      if (def.targetDescription && def.targetDescription.toLowerCase().includes('opposing')) {
        const targetTeam = Object.values(state.teams).find(
          (t) => t.characterIds.includes(tid)
        );
        if (!targetTeam) {
          return { success: false, error: 'Target is not in any team' };
        }
        const isOpposing = (userTeam.isAttacking && targetTeam.blockingTeamId === userTeam.id) ||
          (userTeam.isBlocking && userTeam.blockingTeamId === targetTeam.id);
        if (!isOpposing) {
          return { success: false, error: 'Target must be opposing the user' };
        }
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

  addLog(state, player, 'play-ability', `Playing ${def.name}`, action.cardInstanceId);

  return { success: true };
}

function handleActivateEffect(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'activate-effect' }>,
  collector?: EventCollector,
): { success: boolean; error?: string } {
  const card = getCard(state, action.cardInstanceId);
  const def = getCardDefForInstance(state, action.cardInstanceId);

  if (def.cardType !== 'character' && def.cardType !== 'field' && def.cardType !== 'strategy') {
    return { success: false, error: 'Card type does not have activate effects' };
  }

  // Find the effect on the card
  const effectList = def.cardType === 'character'
    ? (def as CharacterCardDef).effects
    : def.cardType === 'field'
    ? (def as FieldCardDef).effects
    : (def as StrategyCardDef).effects;
  const effect = effectList.find((e) => e.id === action.effectId);

  if (!effect || effect.type !== 'activate') {
    return { success: false, error: 'Effect not found or not an activate effect' };
  }

  // Check injured (characters only)
  if (def.cardType === 'character' && card.state === 'injured' && !effect.isValid) {
    return { success: false, error: 'Character is injured and effect is not Valid' };
  }

  // Check once per turn
  if (effect.oncePerTurn && card.usedEffects.includes(effect.id)) {
    return { success: false, error: 'Effect already used this turn' };
  }

  // Check name-turn scope (yellow activate — once per turn across all copies)
  if (effect.activateScope === 'name-turn') {
    const nameKey = def.printNumber + ':' + effect.id;
    if (state.players[player].usedActivateNames.includes(nameKey)) {
      return { success: false, error: 'This activate effect has already been used by another copy this turn' };
    }
  }

  // Check name-game scope (pink activate — once per game across all copies)
  if (effect.activateScope === 'name-game') {
    const nameKey = def.printNumber + ':' + effect.id;
    if (state.players[player].usedActivateNames.includes(nameKey)) {
      return { success: false, error: 'This activate effect has already been used this game' };
    }
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

  // Pay costs — card-specific validation and execution
  const isExpelFromHand = effect.costDescription?.toLowerCase().includes('expel this card from your hand');
  const isExpelFromEssence = effect.costDescription?.toLowerCase().includes('expel this card from your essence');
  const isPutInPlayFromHand = effect.effectDescription?.toLowerCase().includes('from your hand in play');

  if (isExpelFromEssence) {
    // Activate-from-essence: card must be in essence, cost is expelling it
    if (card.zone !== 'essence' || card.owner !== player) {
      return { success: false, error: 'Card must be in your Essence area to activate this effect' };
    }
    // Expel the card (move to expel zone) — this IS the cost
    moveCard(state, action.cardInstanceId, 'expel');
    addLog(state, player, 'cost', `Expelled ${def.name} from Essence`);
  } else if (isExpelFromHand) {
    // Activate-from-hand: card must be in hand, cost is expelling it
    if (card.zone !== 'hand' || card.owner !== player) {
      return { success: false, error: 'Card must be in your hand to activate this effect' };
    }
    // Expel the card (move to expel zone) — this IS the cost
    moveCard(state, action.cardInstanceId, 'expel');
    addLog(state, player, 'cost', `Expelled ${def.name} from hand`);
  } else if (isPutInPlayFromHand) {
    // Put-in-play-from-hand: card must be in hand, no cost
    if (card.zone !== 'hand' || card.owner !== player) {
      return { success: false, error: 'Card must be in your hand to activate this effect' };
    }
    // Card stays in hand — effect executor will move it to kingdom
  } else if (action.costCardIds && action.costCardIds.length > 0) {
    const costResult = payActivateCost(state, player, action.effectId, action.costCardIds);
    if (!costResult.success) {
      return { success: false, error: costResult.error };
    }
  } else if (effect.costDescription) {
    // Effect has a cost but no cost cards provided
    return { success: false, error: 'Effect requires cost payment' };
  }

  // Mark effect as used
  card.usedEffects.push(effect.id);

  // Track name-scoped activate usage at player level
  if (effect.activateScope === 'name-turn' || effect.activateScope === 'name-game') {
    const nameKey = def.printNumber + ':' + effect.id;
    state.players[player].usedActivateNames.push(nameKey);
  }

  // Add to chain
  const chainEntry: ChainEntry = {
    id: generateId('chain'),
    type: 'activate-effect',
    sourceCardInstanceId: action.cardInstanceId,
    effectId: action.effectId,
    effectSubChoice: action.effectSubChoice,
    targetIds: action.targetIds,
    resolved: false,
    negated: false,
    owner: player,
  };
  state.chain.push(chainEntry);

  state.priorityPlayer = getOpponent(player);
  state.consecutivePasses = 0;

  addLog(state, player, 'activate', `Activated ${def.name}'s effect`, action.cardInstanceId);

  return { success: true };
}

function handleChargeEssence(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'charge-essence' }>,
  collector?: EventCollector,
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

  // Emit charge events
  for (const cardId of action.cardInstanceIds) {
    let cardName = 'Card';
    let defId = '';
    try {
      const def = getCardDefForInstance(state, cardId);
      cardName = def.name;
      defId = def.id;
    } catch { /* skip */ }
    collector?.emit({
      type: 'card-zone-change',
      player,
      cardId,
      cardName,
      defId,
      fromZone: 'hand',
      toZone: 'essence',
      reason: 'charge',
    });
  }

  // Charging does NOT pass priority or start a chain
  return { success: true };
}

function handleOrganizeTeams(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'organize-teams' }>
): { success: boolean; error?: string } {
  // Allowed during organization (turn player) and battle-block (defender)
  if (state.phase === 'organization') {
    if (state.currentTurn !== player) {
      return { success: false, error: 'Not your turn' };
    }
  } else if (state.phase === 'battle-block') {
    if (state.currentTurn === player) {
      return { success: false, error: 'Only the defender can reorganize during block' };
    }
  } else {
    return { success: false, error: 'Cannot organize teams in this phase' };
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
  action: Extract<PlayerAction, { type: 'choose-battle-or-end' }>,
  collector?: EventCollector,
): { success: boolean; error?: string } {
  if (state.phase !== 'organization') {
    return { success: false, error: 'Not in Organization Phase' };
  }

  // First turn of the game must go to End Phase
  if (state.turnNumber === 0) {
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
  action: Extract<PlayerAction, { type: 'select-attackers' }>,
  collector?: EventCollector,
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
    resolveChain(state, collector);

    // resolveChain resets priorityPlayer to currentTurn, but sendAttackers
    // already advanced to battle-block where defender should have priority.
    // Restore defender priority after trigger resolution.
    const defender = getOpponent(player);
    state.priorityPlayer = defender;
    state.consecutivePasses = 0;
  }

  return { success: true };
}

function handleSelectBlockers(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'select-blockers' }>,
  collector?: EventCollector,
): { success: boolean; error?: string } {
  if (state.phase !== 'battle-block') {
    return { success: false, error: 'Not in Block Step' };
  }

  // Collect blocker character IDs before assigning (for sent-to-battle triggers)
  const allBlockerIds: string[] = [];
  for (const assignment of action.assignments) {
    const team = state.teams[assignment.blockingTeamId];
    if (team) {
      allBlockerIds.push(...team.characterIds);
    }
  }

  assignBlockers(state, action.assignments);

  // Check "sent to battle while injured" triggers for blockers
  if (allBlockerIds.length > 0) {
    checkSentToBattleTriggers(state, allBlockerIds, player);

    if (state.pendingTriggers.length > 0) {
      const triggers = [...state.pendingTriggers];
      state.pendingTriggers = [];
      for (const t of triggers) {
        state.chain.push(t);
      }
      resolveChain(state, collector);
    }
  }

  return { success: true };
}

function handleShowdownOrder(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'choose-showdown-order' }>,
  collector?: EventCollector,
): { success: boolean; error?: string } {
  if (state.phase !== 'battle-showdown') {
    return { success: false, error: 'Not in Showdown Step' };
  }

  // Resolve each showdown in the order chosen by turn player
  for (const teamId of action.teamIds) {
    resolveShowdown(state, teamId);
  }

  // Check for Oceanic Abyss (S0042) discard-to-essence redirects before cleanup
  if (state.pendingEssenceRedirects?.length) {
    if (setupNextEssenceRedirectPrompt(state)) {
      return { success: true }; // pause — returnFromBattlefield + advanceToEndPhase deferred
    }
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
  action: Extract<PlayerAction, { type: 'discard-to-hand-limit' }>,
  collector?: EventCollector,
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

  // After discarding, finish the end phase (increment turn marker, switch turns)
  finishEndPhase(state);

  return { success: true };
}

function handleSearchSelect(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'search-select' }>
): { success: boolean; error?: string } {
  if (!state.pendingSearch) {
    return { success: false, error: 'No pending search' };
  }
  if (state.pendingSearch.owner !== player) {
    return { success: false, error: 'Not your search' };
  }

  const chosen = action.cardInstanceId;
  const { discardRest, displayCardIds } = state.pendingSearch;

  if (chosen === null) {
    // Player declined to search
    if (discardRest && displayCardIds) {
      // Discard all displayed cards (e.g., Vanessa — no valid pick)
      for (const id of displayCardIds) {
        state.players[player].deck = state.players[player].deck.filter((did) => did !== id);
        moveCard(state, id, 'discard');
      }
      addLog(state, player, 'search', `${state.pendingSearch.sourceCardName ?? 'Effect'} — No card selected, discarded ${displayCardIds.length} cards`);
    } else {
      const { shuffleDeck } = require('./utils');
      shuffleDeck(state, player);
      addLog(state, player, 'search', 'Declined to search');
    }
    state.pendingSearch = undefined;
    return { success: true };
  }

  // Validate chosen card is in valid list
  if (!state.pendingSearch.validCardIds.includes(chosen)) {
    return { success: false, error: 'Invalid search selection' };
  }

  const effectId = state.pendingSearch.effectId;

  if (effectId === 'C0088-E1') {
    // Hydroon — put selected "Krakaan" into kingdom, then move Hydroon to Essence
    state.players[player].deck = state.players[player].deck.filter((id) => id !== chosen);
    const card = getCard(state, chosen);
    card.zone = 'kingdom';
    card.state = 'healthy';
    state.players[player].kingdom.push(chosen);

    // Create a solo team for Krakaan
    const teamId = generateId('team');
    state.teams[teamId] = {
      id: teamId,
      owner: player,
      characterIds: [chosen],
      hasLead: true,
      isAttacking: false,
      isBlocking: false,
    };
    card.teamId = teamId;
    card.battleRole = 'team-lead';

    const def = getCardDefForInstance(state, chosen);
    addLog(state, player, 'effect', `Hydroon — ${def.name} enters the Kingdom`);

    // Move Hydroon to Essence ("and if you do")
    const hydroonId = state.pendingSearch?.sourceCardInstanceId;
    if (hydroonId) {
      const hydroonCard = state.cards[hydroonId];
      if (hydroonCard && (hydroonCard.zone === 'kingdom' || hydroonCard.zone === 'battlefield')) {
        moveCard(state, hydroonId, 'essence');
        addLog(state, player, 'effect', 'Hydroon — Moved to Essence area');
      }
    }

    const { shuffleDeck } = require('./utils');
    shuffleDeck(state, player);
  } else if (effectId === 'C0087-E1') {
    // Rococo — put selected card into kingdom with +1/+1 counter
    state.players[player].deck = state.players[player].deck.filter((id) => id !== chosen);
    const card = getCard(state, chosen);
    card.zone = 'kingdom';
    card.state = 'healthy';
    state.players[player].kingdom.push(chosen);

    // Add +1/+1 counter
    card.counters.push({ type: 'plus-one' });

    // Create a solo team
    const teamId = generateId('team');
    state.teams[teamId] = {
      id: teamId,
      owner: player,
      characterIds: [chosen],
      hasLead: true,
      isAttacking: false,
      isBlocking: false,
    };
    card.teamId = teamId;
    card.battleRole = 'team-lead';

    const def = getCardDefForInstance(state, chosen);
    addLog(state, player, 'effect', `Rococo — ${def.name} enters kingdom with +1/+1 Counter`);

    const { shuffleDeck } = require('./utils');
    shuffleDeck(state, player);
  } else if (effectId === 'S0044-E1-hand') {
    // Unknown Pathway — chosen card goes to hand
    state.players[player].deck = state.players[player].deck.filter((id) => id !== chosen);
    const card = getCard(state, chosen);
    card.zone = 'hand';
    state.players[player].hand.push(chosen);

    const def = getCardDefForInstance(state, chosen);
    addLog(state, player, 'effect', `Unknown Pathway — ${def.name} moved to hand`);

    // Remaining displayed cards
    const remaining = (displayCardIds ?? []).filter((id) => id !== chosen);

    if (remaining.length === 0) {
      // No more cards to distribute
    } else if (remaining.length === 1) {
      // Only 1 remaining — auto-send to essence
      state.players[player].deck = state.players[player].deck.filter((id) => id !== remaining[0]);
      moveCard(state, remaining[0], 'essence');
      const remDef = getCardDefForInstance(state, remaining[0]);
      addLog(state, player, 'effect', `Unknown Pathway — ${remDef.name} moved to Essence`);
    } else {
      // 2 remaining — pick 1 for essence, last auto-discards
      state.pendingSearch = {
        effectId: 'S0044-E1-essence',
        owner: player,
        criteria: 'Choose 1 card for your Essence (the other goes to Discard)',
        validCardIds: [...remaining],
        displayCardIds: [...remaining],
        sourceCardName: 'Unknown Pathway',
      };
    }
  } else if (effectId === 'S0044-E1-essence') {
    // Unknown Pathway — chosen card goes to essence
    state.players[player].deck = state.players[player].deck.filter((id) => id !== chosen);
    moveCard(state, chosen, 'essence');

    const def = getCardDefForInstance(state, chosen);
    addLog(state, player, 'effect', `Unknown Pathway �� ${def.name} moved to Essence`);

    // Last remaining card auto-discards
    const remaining = (displayCardIds ?? []).filter((id) => id !== chosen);
    for (const id of remaining) {
      state.players[player].deck = state.players[player].deck.filter((did) => did !== id);
      moveCard(state, id, 'discard');
      const remDef = getCardDefForInstance(state, id);
      addLog(state, player, 'effect', `Unknown Pathway — ${remDef.name} moved to Discard`);
    }
  } else {
    // Default: move chosen card from deck to hand
    state.players[player].deck = state.players[player].deck.filter((id) => id !== chosen);
    const card = getCard(state, chosen);
    card.zone = 'hand';
    state.players[player].hand.push(chosen);

    const def = getCardDefForInstance(state, chosen);
    addLog(state, player, 'search', `Selected ${def.name}`);

    if (discardRest && displayCardIds) {
      // Discard the remaining displayed cards (e.g., Vanessa — discard the other top cards)
      const toDiscard = displayCardIds.filter((id) => id !== chosen);
      for (const id of toDiscard) {
        state.players[player].deck = state.players[player].deck.filter((did) => did !== id);
        moveCard(state, id, 'discard');
      }
    } else {
      // Standard search: shuffle deck after
      const { shuffleDeck } = require('./utils');
      shuffleDeck(state, player);
    }
  }

  state.pendingSearch = undefined;
  return { success: true };
}

// --- Activate Effect Cost Validation & Payment ---

function payActivateCost(
  state: GameState,
  player: PlayerId,
  effectId: string,
  costCardIds: string[],
): { success: boolean; error?: string } {
  switch (effectId) {
    // C0078 — Lucian: Discard 1 Character card with {Weapon} from your hand
    case 'C0078-E1': {
      if (costCardIds.length < 1) {
        return { success: false, error: 'Lucian requires discarding 1 Weapon character from hand' };
      }
      const costId = costCardIds[0];
      const costCard = getCard(state, costId);
      if (costCard.zone !== 'hand' || costCard.owner !== player) {
        return { success: false, error: 'Cost card must be in your hand' };
      }
      const costDef = getCardDefForInstance(state, costId);
      if (costDef.cardType !== 'character') {
        return { success: false, error: 'Cost card must be a Character' };
      }
      if (!characterHasAttribute(state, costId, 'Weapon')) {
        return { success: false, error: 'Cost card must have {Weapon}' };
      }
      moveCard(state, costId, 'discard');
      addLog(state, player, 'pay-cost', `Discarded ${costDef.name} as cost for Lucian`);
      return { success: true };
    }

    // C0079 — Solomon: Expel 2 cards from your Discard Pile
    case 'C0079-E1': {
      if (costCardIds.length < 2) {
        return { success: false, error: 'Solomon requires expelling 2 cards from Discard Pile' };
      }
      for (const costId of costCardIds.slice(0, 2)) {
        const costCard = getCard(state, costId);
        if (costCard.zone !== 'discard' || costCard.owner !== player) {
          return { success: false, error: 'Cost cards must be in your Discard Pile' };
        }
        moveCard(state, costId, 'expel');
      }
      addLog(state, player, 'pay-cost', 'Expelled 2 cards from Discard Pile for Solomon');
      return { success: true };
    }

    default:
      // Unknown cost — allow through (effect may handle its own cost)
      return { success: true };
  }
}

function handleResolveTargetChoice(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'resolve-target-choice' }>,
): { success: boolean; error?: string } {
  if (!state.pendingTargetChoice) {
    return { success: false, error: 'No pending target choice' };
  }
  if (state.pendingTargetChoice.owner !== player) {
    return { success: false, error: 'Not your target choice' };
  }

  const chosen = action.cardInstanceId;

  // Handle declining (null) for "you may" effects
  if (chosen === null) {
    if (!state.pendingTargetChoice.allowDecline) {
      return { success: false, error: 'This choice cannot be declined' };
    }
    addLog(state, player, 'effect-declined', 'Declined target choice');
    state.pendingTargetChoice = undefined;
    return { success: true };
  }

  if (!state.pendingTargetChoice.validTargetIds.includes(chosen)) {
    return { success: false, error: 'Invalid target selection' };
  }

  const effectId = state.pendingTargetChoice.effectId;

  // Apply the effect based on which card created the pending choice
  switch (effectId) {
    case 'C0078-E1': {
      // Lucian — put chosen card from hand to bottom of deck
      moveCardToBottomOfDeck(state, chosen);
      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Lucian — Put ${def.name} at bottom of deck`);
      break;
    }
    case 'S0040-E1': {
      // Bounty Board — reveal chosen {Weapon}, put at deck bottom, draw 3
      const revealDef = getCardDefForInstance(state, chosen);
      // Emit card-revealed event for the opponent to see
      moveCardToBottomOfDeck(state, chosen);
      drawCards(state, player, 3);
      addLog(state, player, 'effect', `Bounty Board — Revealed ${revealDef.name}, drew 3 cards`);
      break;
    }
    case 'C0082-E1': {
      // Omtaba — discard chosen injured opponent character
      moveCard(state, chosen, 'discard');
      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Omtaba — Discarded opponent's injured ${def.name}`);
      break;
    }
    case 'C0083-E1': {
      // Swordmaster Don — move chosen {Weapon} from DP to hand
      moveCard(state, chosen, 'hand');
      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Swordmaster Don — Recovered ${def.name} from DP`);
      break;
    }
    case 'C0084-E1': {
      // Sinbad — place +1/+1 counter on chosen {Weapon} character
      const target = getCard(state, chosen);
      target.counters.push({ type: 'plus-one' });
      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Sinbad — Placed +1/+1 Counter on ${def.name}`);
      break;
    }
    case 'C0085-E1': {
      // Samanosuke — move chosen {Weapon} from DP to deck bottom, then +2/+0 if field has Necro
      moveCardToBottomOfDeck(state, chosen);
      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Samanosuke — Moved ${def.name} from DP to deck bottom`);

      // Apply stat boost if field has Necro
      const sourceCard = state.pendingTargetChoice?.sourceCardId;
      if (sourceCard && fieldHasSymbol(state, player, 'necro')) {
        const samCard = getCard(state, sourceCard);
        samCard.statModifiers.push({
          lead: 2,
          support: 0,
          source: 'C0085-Samanosuke',
          duration: 'turn',
        });
        addLog(state, player, 'effect', 'Samanosuke — Gained +2/+0 this turn');
      }
      break;
    }
    case 'C0093-E1': {
      // Linda The Puffer — move chosen hand card to bottom of deck
      moveCardToBottomOfDeck(state, chosen);
      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Linda The Puffer — Put ${def.name} at bottom of deck`);
      break;
    }
    case 'F0006-E1-buff': {
      // Micromon Beach 2+ — apply +1/+1 to chosen character this turn
      const target = getCard(state, chosen);
      target.statModifiers.push({
        lead: 1,
        support: 1,
        source: 'F0006-MicromonBeach',
        duration: 'turn',
      });
      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Micromon Beach — ${def.name} gets +1/+1 this turn`);
      break;
    }
    case 'F0006-E1-dp-to-essence': {
      // Micromon Beach 4+ — move chosen DP card to essence
      moveCard(state, chosen, 'essence');
      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Micromon Beach — Moved ${def.name} from DP to Essence`);
      break;
    }
    case 'C0089-E1': {
      // Carnodile — move chosen opponent character to bottom of owner's deck
      const def = getCardDefForInstance(state, chosen);
      moveCardToBottomOfDeck(state, chosen);
      addLog(state, player, 'effect', `Carnodile — Moved ${def.name} to the bottom of their deck`);
      break;
    }
    case 'C0075-E1': {
      // Aquaconda — discard chosen card from opponent's Essence
      moveCard(state, chosen, 'discard');
      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Aquaconda — Discarded ${def.name} from opponent's Essence`);
      break;
    }
    case 'S0044-E2': {
      // Unknown Pathway — remove 1 counter from chosen card
      const target = getCard(state, chosen);
      if (target.counters.length > 0) {
        const removed = target.counters.shift()!;
        const def = getCardDefForInstance(state, chosen);
        const counterName = removed.type === 'plus-one' ? '+1/+1' : removed.type === 'minus-one' ? '-1/-1' : removed.name ?? removed.type;
        addLog(state, player, 'effect', `Unknown Pathway — Removed ${counterName} counter from ${def.name}`);
      }
      break;
    }
    case 'S0037-E1': {
      // Dangerous Waters — put chosen Sea Monster from essence into play
      moveCard(state, chosen, 'kingdom');
      const card = getCard(state, chosen);
      card.state = 'healthy';

      // Create a solo team
      const teamId = generateId('team');
      state.teams[teamId] = {
        id: teamId,
        owner: player,
        characterIds: [chosen],
        hasLead: true,
        isAttacking: false,
        isBlocking: false,
      };
      card.teamId = teamId;

      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Dangerous Waters — Put ${def.name} in play from Essence`);

      // Add lingering effect for end-of-turn cleanup
      state.lingeringEffects.push({
        id: `dangerous_waters_${chosen}`,
        source: chosen,
        effectDescription: 'At end of turn, if Turn Marker ≤ 4, discard this character.',
        duration: 'until-end-of-turn',
        appliedTurn: state.turnNumber,
        data: { targetId: chosen, owner: player },
      });

      // Check put-in-play triggers (and Sea Monster triggers for Krakaan)
      const charDef = def as CharacterCardDef;
      // Check the card's own put-in-play triggers (card just entered healthy)
      for (const effect of charDef.effects) {
        if (effect.type === 'trigger' && effect.triggerCondition === 'put-in-play') {
          state.pendingTriggers.push({
            id: `trigger_${chosen}_${effect.id}`,
            type: 'trigger-effect',
            sourceCardInstanceId: chosen,
            effectId: effect.id,
            resolved: false,
            negated: false,
            owner: player,
          });
        }
      }
      // Check other chars for put-in-play-sea-monster triggers
      if (charDef.attributes.includes('Sea Monster')) {
        const allInPlay = [
          ...state.players[player].kingdom,
          ...state.players[player].battlefield,
        ];
        for (const otherId of allInPlay) {
          if (otherId === chosen) continue;
          const otherCard = state.cards[otherId];
          if (!otherCard || otherCard.isNegated) continue;
          try {
            const otherDef = getCardDefForInstance(state, otherId);
            if (otherDef.cardType !== 'character') continue;
            const otherCharDef = otherDef as CharacterCardDef;
            for (const eff of otherCharDef.effects) {
              if (eff.type !== 'trigger' || eff.triggerCondition !== 'put-in-play-sea-monster') continue;
              if (otherCard.state === 'injured' && !eff.isValid) continue;
              state.pendingTriggers.push({
                id: `trigger_${otherId}_${eff.id}_${chosen}`,
                type: 'trigger-effect',
                sourceCardInstanceId: otherId,
                effectId: eff.id,
                resolved: false,
                negated: false,
                owner: player,
              });
            }
          } catch { /* skip */ }
        }
      }
      break;
    }
    case 'A0035-E1-pick1': {
      // Aquabatics — discard first chosen card from opponent's Essence
      moveCard(state, chosen, 'discard');
      const def = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Aquabatics — Discarded ${def.name} from opponent's Essence (1/2)`);

      // Check if opponent has more essence to discard
      const opponent1 = getOpponent(player);
      const remainingEssence = [...state.players[opponent1].essence];
      if (remainingEssence.length > 0) {
        // Set up second pick
        state.pendingTargetChoice = {
          effectId: 'A0035-E1-pick2',
          sourceCardId: state.pendingTargetChoice!.sourceCardId,
          owner: player,
          description: "Choose a card from your opponent's Essence to discard (2 of 2)",
          validTargetIds: remainingEssence,
        };
        return { success: true };
      }

      // No more to discard — check BR condition
      if (state.players[player].essence.length > state.players[opponent1].essence.length) {
        const loserDeck = state.players[opponent1].deck;
        if (loserDeck.length > 0) {
          const brCardId = loserDeck.shift()!;
          state.cards[brCardId].zone = 'battle-rewards';
          state.players[opponent1].battleRewards.push(brCardId);
          addLog(state, player, 'effect', 'Aquabatics — You win 1 Battle Reward!');
        }
      } else {
        addLog(state, player, 'effect', 'Aquabatics — Essence not greater, no Battle Reward');
      }
      break;
    }
    case 'A0035-E1-pick2': {
      // Aquabatics — discard second chosen card from opponent's Essence
      moveCard(state, chosen, 'discard');
      const def = getCardDefForInstance(state, chosen);
      const opponent2 = getOpponent(player);
      addLog(state, player, 'effect', `Aquabatics — Discarded ${def.name} from opponent's Essence (2/2)`);

      // Check BR condition: your essence > opponent's essence
      if (state.players[player].essence.length > state.players[opponent2].essence.length) {
        const loserDeck = state.players[opponent2].deck;
        if (loserDeck.length > 0) {
          const brCardId = loserDeck.shift()!;
          state.cards[brCardId].zone = 'battle-rewards';
          state.players[opponent2].battleRewards.push(brCardId);
          addLog(state, player, 'effect', 'Aquabatics — You win 1 Battle Reward!');
        }
      } else {
        addLog(state, player, 'effect', 'Aquabatics — Essence not greater, no Battle Reward');
      }
      break;
    }
    case 'C0091-E1-pick1': {
      // Sea Queen Argelia — discard first chosen card from opponent's Essence
      moveCard(state, chosen, 'discard');
      const def91a = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Sea Queen Argelia — Discarded ${def91a.name} from opponent's Essence (1/2)`);

      // Check if opponent has more essence to discard for pick 2
      const opponent91 = getOpponent(player);
      const remainingEssence91 = [...state.players[opponent91].essence];
      if (remainingEssence91.length > 0) {
        state.pendingTargetChoice = {
          effectId: 'C0091-E1-pick2',
          sourceCardId: state.pendingTargetChoice!.sourceCardId,
          owner: player,
          description: "Choose a card from your opponent's Essence to discard (2 of 2)",
          validTargetIds: remainingEssence91,
        };
        return { success: true };
      }
      break;
    }
    case 'C0091-E1-pick2': {
      // Sea Queen Argelia — discard second chosen card from opponent's Essence
      moveCard(state, chosen, 'discard');
      const def91b = getCardDefForInstance(state, chosen);
      addLog(state, player, 'effect', `Sea Queen Argelia — Discarded ${def91b.name} from opponent's Essence (2/2)`);
      break;
    }
    default:
      return { success: false, error: `Unknown pending target effect: ${effectId}` };
  }

  state.pendingTargetChoice = undefined;
  return { success: true };
}

function handleChooseOptionalTrigger(
  state: GameState,
  player: PlayerId,
  action: Extract<PlayerAction, { type: 'choose-optional-trigger' }>,
  collector?: EventCollector,
): { success: boolean; error?: string } {
  if (!state.pendingOptionalEffect) {
    return { success: false, error: 'No pending optional effect' };
  }
  if (state.pendingOptionalEffect.owner !== player) {
    return { success: false, error: 'Not your optional effect' };
  }

  const { chainEntryId, lingeringEffectId } = state.pendingOptionalEffect;
  state.pendingOptionalEffect = undefined;

  if (chainEntryId) {
    // Category A: chain-based effect
    const entry = state.chain.find((e) => e.id === chainEntryId);
    if (!entry) {
      return { success: false, error: 'Chain entry not found' };
    }

    if (action.activate) {
      // Mark as approved and re-resolve
      entry.optionalApproved = true;
      resolveChain(state, collector);
    } else {
      // Declined — mark as resolved, remove from chain
      entry.resolved = true;
      state.chain = state.chain.filter((e) => e.id !== chainEntryId);
      addLog(state, player, 'effect-declined', 'Declined optional effect');
      // Continue resolving remaining chain
      if (state.chain.length > 0) {
        resolveChain(state, collector);
      } else {
        state.isChainResolving = false;
        // Phase-aware priority restore: defender keeps priority during battle-block
        state.priorityPlayer = state.phase === 'battle-block'
          ? getOpponent(state.currentTurn)
          : state.currentTurn;
        state.consecutivePasses = 0;
      }
    }
  } else if (lingeringEffectId) {
    // Category B: lingering effect (Solomon end-of-turn, Swift Strike draw)
    const effect = state.lingeringEffects.find((e) => e.id === lingeringEffectId);

    if (action.activate && effect) {
      // Execute the lingering effect inline
      if (lingeringEffectId.startsWith('solomon_')) {
        const effectPlayer = effect.data?.player as PlayerId | undefined;
        if (effectPlayer) {
          const deck = state.players[effectPlayer].deck;
          const toDiscard = deck.splice(0, Math.min(2, deck.length));
          for (const id of toDiscard) {
            moveCard(state, id, 'discard');
          }
          if (toDiscard.length > 0) {
            addLog(state, effectPlayer, 'effect', `Solomon — Discarded top ${toDiscard.length} card(s) from deck`);
          }
        }
      } else if (lingeringEffectId.startsWith('swiftstrike_draw_')) {
        const drawPlayer = effect.data?.owner as PlayerId | undefined;
        if (drawPlayer) {
          drawCards(state, drawPlayer, 1);
          addLog(state, drawPlayer, 'effect', 'Swift Strike — Drew 1 card');
        }
      } else if (lingeringEffectId.startsWith('stakegun_expert_')) {
        const effectPlayer = effect.data?.player as PlayerId | undefined;
        const effectOpponent = effect.data?.opponent as PlayerId | undefined;
        const xVal = (effect.data?.xValue as number) ?? 0;
        if (effectPlayer && effectOpponent && xVal > 0) {
          const deck = state.players[effectOpponent].deck;
          const toDiscard = deck.splice(0, Math.min(xVal, deck.length));
          for (const id of toDiscard) {
            moveCard(state, id, 'discard');
          }
          addLog(state, effectPlayer, 'effect', `Stake Gun Expert — Discarded ${toDiscard.length} from opponent's deck`);
        }
      } else if (lingeringEffectId.startsWith('oceanic_abyss_redirect_')) {
        // Oceanic Abyss (S0042) — redirect character from discard to essence
        const redirectCardId = effect?.data?.redirectCardId as string | undefined;
        if (redirectCardId) {
          const redirectCard = state.cards[redirectCardId];
          if (redirectCard && redirectCard.zone === 'discard') {
            moveCard(state, redirectCardId, 'essence');
            const redirectDef = getCardDefForInstance(state, redirectCardId);
            addLog(state, player, 'effect', `Oceanic Abyss — ${redirectDef.name} moved to Essence instead of Discard Pile`);
            // Remove any showdown-discard triggers for this character (it wasn't truly discarded)
            state.pendingTriggers = state.pendingTriggers.filter(
              (t) => t.sourceCardInstanceId !== redirectCardId
            );
          }
        }
      }
    } else {
      // Declined
      if (lingeringEffectId.startsWith('oceanic_abyss_redirect_')) {
        const redirectCardId = effect?.data?.redirectCardId as string | undefined;
        if (redirectCardId) {
          const redirectDef = getCardDefForInstance(state, redirectCardId);
          addLog(state, player, 'effect-declined', `Oceanic Abyss — ${redirectDef.name} stays in Discard Pile`);
        }
      } else {
        addLog(state, player, 'effect-declined', 'Declined optional effect');
      }
    }

    // Remove the lingering effect regardless of choice
    state.lingeringEffects = state.lingeringEffects.filter((e) => e.id !== lingeringEffectId);

    // Re-call the phase function to continue
    if (lingeringEffectId.startsWith('solomon_')) {
      advanceToEndPhase(state);
    } else if (lingeringEffectId.startsWith('stakegun_expert_')) {
      // Complete the paused ability chain entry that was waiting for the expert prompt
      if (state.chain.length > 0) {
        const entry = state.chain[state.chain.length - 1];
        if (!entry.resolved && entry.type === 'ability') {
          const def = getCardDefForInstance(state, entry.sourceCardInstanceId);
          moveCard(state, entry.sourceCardInstanceId, 'essence');
          addLog(state, entry.owner, 'ability-resolve', `${def.name} resolved → Essence Area`, entry.sourceCardInstanceId);
          if (entry.userId) {
            addLog(state, entry.owner, 'ability-user-resolved', `${def.name} used by character`, entry.userId);
          }
          entry.resolved = true;
          state.chain.pop();
        }
      }
      resolveChain(state, collector);
    } else if (lingeringEffectId.startsWith('swiftstrike_draw_')) {
      // Check for more Swift Strike draw effects
      const moreDraws = state.lingeringEffects.filter(
        (e) => e.id.startsWith('swiftstrike_draw_')
      );
      if (moreDraws.length > 0) {
        const next = moreDraws[0];
        state.pendingOptionalEffect = {
          lingeringEffectId: next.id,
          sourceCardId: next.source,
          effectId: 'A0038-E1',
          cardName: 'Swift Strike',
          effectDescription: next.effectDescription,
          owner: next.data.owner as PlayerId,
        };
      }
      // Otherwise, showdown phase continues normally
    } else if (lingeringEffectId.startsWith('oceanic_abyss_redirect_')) {
      // Check for more redirects in the queue
      if (state.pendingEssenceRedirects?.length) {
        setupNextEssenceRedirectPrompt(state);
      } else {
        // All redirects processed — continue paused flow
        state.pendingEssenceRedirects = undefined;
        if (state.phase === 'battle-showdown') {
          // Was paused during handleShowdownOrder — finish showdown cleanup
          returnFromBattlefield(state);
          advanceToEndPhase(state);
        } else if (state.phase === 'end') {
          // Was paused during advanceToEndPhase (e.g., Dangerous Waters) — re-run
          advanceToEndPhase(state);
        } else if (state.chain.length > 0) {
          // Was paused during chain resolution — continue resolving
          resolveChain(state, collector);
        }
      }
    }
  }

  return { success: true };
}
