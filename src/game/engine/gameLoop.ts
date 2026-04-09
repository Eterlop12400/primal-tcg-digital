// ============================================================
// Game Loop — Turn phases and game flow
// ============================================================

import {
  GameState,
  PlayerId,
  Phase,
  PlayerAction,
  Team,
  ShowdownResult,
  CharacterCardDef,
} from '../types';
import {
  getOpponent,
  getCard,
  getCardDefForInstance,
  drawCards,
  moveCard,
  addLog,
  getEffectiveStats,
  calculateTeamPower,
  dealDamage,
  generateId,
  getCardsInZone,
} from './utils';
import { resolveChain, flushPendingTriggers } from './chainResolver';

// ============================================================
// Phase Transitions
// ============================================================

export function advanceToStartPhase(state: GameState): void {
  state.phase = 'start';
  const player = state.currentTurn;
  const playerState = state.players[player];

  addLog(state, player, 'phase-start', 'Start Phase');

  // 1. Remove Permanent Counters from Permanent(X) strategies
  const kingdom = getCardsInZone(state, player, 'kingdom');
  for (const card of kingdom) {
    const def = getCardDefForInstance(state, card.instanceId);
    if (def.cardType === 'strategy') {
      const permCounterIdx = card.counters.findIndex(
        (c) => c.type === 'permanent'
      );
      if (permCounterIdx !== -1) {
        card.counters.splice(permCounterIdx, 1);
        // If last permanent counter removed, move to essence
        if (!card.counters.some((c) => c.type === 'permanent')) {
          moveCard(state, card.instanceId, 'essence');
          addLog(
            state,
            player,
            'permanent-expired',
            `${def.name} moved to Essence (last Permanent Counter removed)`
          );
        }
      }
    }
  }

  // 2. Clear "until start of turn" lingering effects
  state.lingeringEffects = state.lingeringEffects.filter(
    (e) => e.duration !== 'until-start-of-turn'
  );

  // 3. TODO: Check for start-of-turn trigger effects

  // 4. Normal Draw (skip if P1's first turn)
  if (!state.isFirstTurn || state.currentTurn !== state.currentTurn) {
    // The first player's first turn skips the draw
    if (!(state.turnNumber === 1 && state.currentTurn === state.currentTurn && state.isFirstTurn)) {
      // Actually: skip draw on the very first turn of the game for the first player
    }
  }

  // Simpler logic: skip draw only on turn 1 for the player who goes first
  const isVeryFirstTurn = state.turnNumber === 1;
  if (!isVeryFirstTurn) {
    if (playerState.deck.length > 0) {
      drawCards(state, player, 1);
      addLog(state, player, 'normal-draw', 'Drew 1 card');
    }
  } else {
    addLog(state, player, 'skip-draw', 'First turn — no draw');
  }

  // 5. Move to Main Phase
  advanceToMainPhase(state);
}

export function advanceToMainPhase(state: GameState): void {
  state.phase = 'main';
  state.priorityPlayer = state.currentTurn;
  state.consecutivePasses = 0;

  addLog(state, state.currentTurn, 'phase-main', 'Main Phase');

  // TODO: Check for start-of-main-phase triggers
}

export function advanceToOrganizationPhase(state: GameState): void {
  state.phase = 'organization';
  state.priorityPlayer = state.currentTurn;
  state.consecutivePasses = 0;
  const player = state.currentTurn;

  addLog(state, player, 'phase-organization', 'Organization Phase');

  // TODO: Check for start-of-organization triggers

  // Clear existing teams then auto-create solo teams for each kingdom character
  clearTeams(state, player);
  autoCreateSoloTeams(state, player);
}

export function advanceToBattlePhase(state: GameState): void {
  state.phase = 'battle-attack';
  state.priorityPlayer = state.currentTurn;
  state.consecutivePasses = 0;

  addLog(state, state.currentTurn, 'phase-battle', 'Battle Phase — Attack Step');

  // TODO: Check for start-of-battle triggers
}

export function advanceToEOA(state: GameState): void {
  state.phase = 'battle-eoa';
  state.priorityPlayer = state.currentTurn;
  state.consecutivePasses = 0;

  addLog(state, state.currentTurn, 'phase-eoa', 'Exchange of Ability Step');

  // TODO: Check for start-of-EOA triggers
}

export function advanceToShowdown(state: GameState): void {
  state.phase = 'battle-showdown';
  state.priorityPlayer = state.currentTurn;
  state.consecutivePasses = 0;

  addLog(state, state.currentTurn, 'phase-showdown', 'Showdown Step');

  // TODO: Check for start-of-showdown triggers + lingering effects
}

export function advanceToEndPhase(state: GameState): void {
  state.phase = 'end';
  const player = state.currentTurn;
  const opponent = getOpponent(player);

  addLog(state, player, 'phase-end', 'End Phase');

  // 1. Check Battle Rewards win condition
  // BR zone fills on the LOSING side — if your BR has 10+, your opponent wins
  if (state.players[player].battleRewards.length >= 10) {
    state.gameOver = true;
    state.winner = opponent;
    state.winReason = 'battle-rewards';
    addLog(state, opponent, 'win', `${opponent} wins — ${player} has 10+ Battle Rewards!`);
    return;
  }
  if (state.players[opponent].battleRewards.length >= 10) {
    state.gameOver = true;
    state.winner = player;
    state.winReason = 'battle-rewards';
    addLog(state, player, 'win', `${player} wins — ${opponent} has 10+ Battle Rewards!`);
    return;
  }

  // 2. Check deck-out
  if (state.players[player].deck.length === 0) {
    state.gameOver = true;
    state.winner = opponent;
    state.winReason = 'deck-out';
    addLog(state, player, 'lose', `${player} loses by deck-out!`);
    return;
  }
  if (state.players[opponent].deck.length === 0) {
    state.gameOver = true;
    state.winner = player;
    state.winReason = 'deck-out';
    addLog(state, opponent, 'lose', `${opponent} loses by deck-out!`);
    return;
  }

  // 3. Clear "until end of turn" effects and lingering effects
  state.lingeringEffects = state.lingeringEffects.filter(
    (e) => e.duration !== 'until-end-of-turn' && e.duration !== 'turn'
  );

  // Clear stat modifiers with turn duration from all cards
  for (const card of Object.values(state.cards)) {
    card.statModifiers = card.statModifiers.filter(
      (m) => m.duration !== 'turn' && m.duration !== 'until-end-of-turn'
    );
    // Reset used effects for next turn
    card.usedEffects = [];
  }

  // 4. TODO: End-of-turn triggers

  // 5. Hand limit check (7 cards) — player must discard down
  // This is handled by awaiting a player action if hand > 7

  // 6. Increment turn marker
  state.players[player].turnMarker += 1;
  addLog(
    state,
    player,
    'turn-marker',
    `Turn Marker → ${state.players[player].turnMarker}`
  );

  // 7. Reset per-turn flags
  state.players[player].hasSummonedThisTurn = false;
  state.players[player].hasPlayedStrategyThisTurn = false;
  state.players[player].hasUsedRushThisTurn = false;

  // 8. Switch turns
  const nextPlayer = opponent;
  state.currentTurn = nextPlayer;
  state.turnNumber += 1;
  state.isFirstTurn = false;

  addLog(state, nextPlayer, 'new-turn', `Turn ${state.turnNumber} — ${nextPlayer}'s turn`);

  // Begin next player's Start Phase
  advanceToStartPhase(state);
}

// ============================================================
// Team Management
// ============================================================

function clearTeams(state: GameState, player: PlayerId): void {
  // Remove all existing teams for this player
  for (const [teamId, team] of Object.entries(state.teams)) {
    if (team.owner === player) {
      for (const charId of team.characterIds) {
        const card = state.cards[charId];
        if (card) {
          card.teamId = undefined;
          card.battleRole = undefined;
        }
      }
      delete state.teams[teamId];
    }
  }
}

function autoCreateSoloTeams(state: GameState, player: PlayerId): void {
  const kingdom = state.players[player].kingdom;
  for (const cardId of kingdom) {
    const card = state.cards[cardId];
    if (!card || card.state === undefined) continue; // Only characters have state

    const teamId = generateId('team');
    const team: Team = {
      id: teamId,
      owner: player,
      characterIds: [cardId],
      hasLead: true,
      isAttacking: false,
      isBlocking: false,
    };
    state.teams[teamId] = team;
    card.teamId = teamId;
    card.battleRole = 'team-lead';
  }
}

export function organizeTeams(
  state: GameState,
  player: PlayerId,
  teamConfigs: { leadId: string; supportIds: string[] }[]
): void {
  clearTeams(state, player);

  for (const config of teamConfigs) {
    const teamId = generateId('team');
    const characterIds = [config.leadId, ...config.supportIds];

    const team: Team = {
      id: teamId,
      owner: player,
      characterIds,
      hasLead: true,
      isAttacking: false,
      isBlocking: false,
    };

    state.teams[teamId] = team;

    // Mark lead
    const leadCard = state.cards[config.leadId];
    if (leadCard) {
      leadCard.teamId = teamId;
      leadCard.battleRole = 'team-lead';
    }

    // Mark supports
    for (const supportId of config.supportIds) {
      const supportCard = state.cards[supportId];
      if (supportCard) {
        supportCard.teamId = teamId;
        supportCard.battleRole = 'team-support';
      }
    }
  }
}

// ============================================================
// Battle Resolution
// ============================================================

export function sendAttackers(
  state: GameState,
  teamIds: string[]
): void {
  for (const teamId of teamIds) {
    const team = state.teams[teamId];
    if (!team) continue;

    team.isAttacking = true;

    // Move characters from kingdom to battlefield
    for (const charId of team.characterIds) {
      moveCard(state, charId, 'battlefield');
    }
  }

  if (teamIds.length === 0) {
    // No attackers = skip to End Phase
    addLog(state, state.currentTurn, 'no-attack', 'No teams sent to attack');
    advanceToEndPhase(state);
    return;
  }

  addLog(
    state,
    state.currentTurn,
    'attack',
    `Sent ${teamIds.length} team(s) to attack`
  );

  // Move to Block Step — defending player gets priority
  state.phase = 'battle-block';
  state.priorityPlayer = getOpponent(state.currentTurn);
  state.consecutivePasses = 0;
}

export function assignBlockers(
  state: GameState,
  assignments: { blockingTeamId: string; attackingTeamId: string }[]
): void {
  const opponent = getOpponent(state.currentTurn);

  for (const assignment of assignments) {
    const blockingTeam = state.teams[assignment.blockingTeamId];
    const attackingTeam = state.teams[assignment.attackingTeamId];

    if (!blockingTeam || !attackingTeam) continue;

    blockingTeam.isBlocking = true;
    blockingTeam.blockingTeamId = assignment.attackingTeamId;
    attackingTeam.blockedByTeamId = assignment.blockingTeamId;

    // Move blocking characters to battlefield
    for (const charId of blockingTeam.characterIds) {
      moveCard(state, charId, 'battlefield');
    }
  }

  if (assignments.length > 0) {
    addLog(state, opponent, 'block', `Assigned ${assignments.length} blocker(s)`);
  } else {
    addLog(state, opponent, 'no-block', 'No blockers assigned');
  }

  // Move to EOA
  advanceToEOA(state);
}

export function resolveShowdown(
  state: GameState,
  attackingTeamId: string
): ShowdownResult | null {
  const attackingTeam = state.teams[attackingTeamId];
  if (!attackingTeam) return null;

  // Check if all attacking characters are gone
  const attackersOnField = attackingTeam.characterIds.filter(
    (id) => state.cards[id]?.zone === 'battlefield'
  );
  if (attackersOnField.length === 0) {
    addLog(state, attackingTeam.owner, 'showdown-skip', 'No attackers remaining');
    return null;
  }

  const attackPower = calculateTeamPower(state, attackingTeam);
  const opponent = getOpponent(attackingTeam.owner);

  // Unblocked
  if (!attackingTeam.blockedByTeamId) {
    if (attackPower >= 5) {
      // Outstanding Battle Reward — 2 BRs
      awardBattleRewards(state, attackingTeam.owner, 2);
      addLog(
        state,
        attackingTeam.owner,
        'outstanding-battle-reward',
        `Team Power ${attackPower} — Outstanding Battle Reward (2 BRs)!`
      );
      return 'outstanding-battle-reward';
    } else {
      // Battle Reward — 1 BR
      awardBattleRewards(state, attackingTeam.owner, 1);
      addLog(
        state,
        attackingTeam.owner,
        'battle-reward',
        `Team Power ${attackPower} — Battle Reward (1 BR)`
      );
      return 'battle-reward';
    }
  }

  // Blocked
  const blockingTeam = state.teams[attackingTeam.blockedByTeamId];
  if (!blockingTeam) return null;

  const blockersOnField = blockingTeam.characterIds.filter(
    (id) => state.cards[id]?.zone === 'battlefield'
  );
  if (blockersOnField.length === 0) {
    // Blocking team was cleared — treat as unblocked
    attackingTeam.blockedByTeamId = undefined;
    return resolveShowdown(state, attackingTeamId);
  }

  const blockPower = calculateTeamPower(state, blockingTeam);
  const difference = Math.abs(attackPower - blockPower);

  if (attackPower === blockPower) {
    // Stalemate — 1 damage to both team leads
    applyShowdownDamage(state, attackingTeam, 'stalemate');
    applyShowdownDamage(state, blockingTeam, 'stalemate');
    flushPendingTriggers(state);
    addLog(
      state,
      attackingTeam.owner,
      'stalemate',
      `Stalemate! Both Team Power ${attackPower}`
    );
    return 'stalemate';
  }

  const winningTeam =
    attackPower > blockPower ? attackingTeam : blockingTeam;
  const losingTeam =
    attackPower > blockPower ? blockingTeam : attackingTeam;

  if (difference >= 5) {
    // Outstanding Victory
    applyShowdownDamage(state, losingTeam, 'outstanding-victory');
    flushPendingTriggers(state);
    addLog(
      state,
      winningTeam.owner,
      'outstanding-victory',
      `Outstanding Victory! (${attackPower} vs ${blockPower})`
    );
    return 'outstanding-victory';
  } else {
    // Victory
    applyShowdownDamage(state, losingTeam, 'victory');
    flushPendingTriggers(state);
    addLog(
      state,
      winningTeam.owner,
      'victory',
      `Victory! (${attackPower} vs ${blockPower})`
    );
    return 'victory';
  }
}

function applyShowdownDamage(
  state: GameState,
  losingTeam: Team,
  result: 'victory' | 'outstanding-victory' | 'stalemate'
): void {
  const charsOnField = losingTeam.characterIds.filter(
    (id) => state.cards[id]?.zone === 'battlefield'
  );

  if (charsOnField.length === 0) return;

  if (result === 'stalemate' || result === 'victory') {
    // 1 damage to team lead only
    if (losingTeam.hasLead && charsOnField.includes(losingTeam.characterIds[0])) {
      const leadId = losingTeam.characterIds[0];
      dealDamage(state, leadId, 1);
      addLog(
        state,
        losingTeam.owner,
        'showdown-damage',
        `${getCardDefForInstance(state, leadId).name} takes 1 damage`
      );
    }
  } else if (result === 'outstanding-victory') {
    // 2 damage to team lead
    if (losingTeam.hasLead && charsOnField.includes(losingTeam.characterIds[0])) {
      const leadId = losingTeam.characterIds[0];
      dealDamage(state, leadId, 2);
      addLog(
        state,
        losingTeam.owner,
        'showdown-damage',
        `${getCardDefForInstance(state, leadId).name} takes 2 damage`
      );
    }
    // 1 damage to each support
    for (let i = 1; i < losingTeam.characterIds.length; i++) {
      const supportId = losingTeam.characterIds[i];
      if (charsOnField.includes(supportId)) {
        dealDamage(state, supportId, 1);
        addLog(
          state,
          losingTeam.owner,
          'showdown-damage',
          `${getCardDefForInstance(state, supportId).name} takes 1 damage`
        );
      }
    }
  }
}

function awardBattleRewards(
  state: GameState,
  winningPlayer: PlayerId,
  count: number
): void {
  // In Primal TCG, battle rewards are cards from the LOSER's deck
  // placed face-down in the LOSER's Battle Reward zone.
  // When a player's BR zone reaches 10, their opponent wins.
  const losingPlayer = getOpponent(winningPlayer);
  const loserDeck = state.players[losingPlayer].deck;

  for (let i = 0; i < count; i++) {
    if (loserDeck.length === 0) break;
    const cardId = loserDeck.shift()!;
    const card = state.cards[cardId];
    card.zone = 'battle-rewards';
    state.players[losingPlayer].battleRewards.push(cardId);
  }
}

// Return all battlefield characters to kingdom after showdown
export function returnFromBattlefield(state: GameState): void {
  for (const player of ['player1', 'player2'] as PlayerId[]) {
    const battlefield = [...state.players[player].battlefield];
    for (const cardId of battlefield) {
      moveCard(state, cardId, 'kingdom');
    }
  }

  // Clear all teams
  for (const [teamId, team] of Object.entries(state.teams)) {
    team.isAttacking = false;
    team.isBlocking = false;
    team.blockedByTeamId = undefined;
    team.blockingTeamId = undefined;
  }
}

// ============================================================
// Priority / Pass Handling
// ============================================================

export function handlePassPriority(state: GameState): void {
  state.consecutivePasses += 1;

  if (state.consecutivePasses >= 2) {
    // Both players passed — resolve chain or advance phase
    state.consecutivePasses = 0;

    if (state.chain.length > 0 && !state.isChainResolving) {
      resolveChain(state);
    } else {
      // No chain — advance to next phase
      advancePhase(state);
    }
  } else {
    // Pass priority to other player
    state.priorityPlayer = getOpponent(state.priorityPlayer);
  }
}

function advancePhase(state: GameState): void {
  switch (state.phase) {
    case 'main':
      advanceToOrganizationPhase(state);
      break;
    case 'battle-eoa':
      advanceToShowdown(state);
      break;
    case 'battle-showdown':
      returnFromBattlefield(state);
      advanceToEndPhase(state);
      break;
    default:
      break;
  }
}

// ============================================================
// Legal Action Checking
// ============================================================

export function getLegalActions(state: GameState, player: PlayerId): PlayerAction['type'][] {
  const actions: PlayerAction['type'][] = [];

  if (state.gameOver) return [];
  if (state.priorityPlayer !== player) return [];

  const playerState = state.players[player];
  const isTurnPlayer = state.currentTurn === player;

  switch (state.phase) {
    case 'main': {
      // Always can pass
      actions.push('pass-priority');

      if (isTurnPlayer) {
        // Can summon if haven't yet and have a legal summon
        if (!playerState.hasSummonedThisTurn && state.chain.length === 0) {
          const canSummon = playerState.hand.some((id) => {
            const def = getCardDefForInstance(state, id);
            if (def.cardType !== 'character') return false;
            const charDef = def as CharacterCardDef;
            return charDef.turnCost <= playerState.turnMarker;
          });
          if (canSummon) actions.push('summon');
        }

        // Can play strategy if haven't yet
        if (!playerState.hasPlayedStrategyThisTurn) {
          const canPlay = playerState.hand.some((id) => {
            const def = getCardDefForInstance(state, id);
            if (def.cardType !== 'strategy') return false;
            // Counter strategies can't be played as turn player
            if ('keywords' in def && def.keywords.includes('counter')) return false;
            return def.turnCost <= playerState.turnMarker;
          });
          if (canPlay) actions.push('play-strategy');
        }

        // Can charge essence (if no chain)
        if (state.chain.length === 0 && playerState.hand.length > 0) {
          actions.push('charge-essence');
        }

        // Can use activate [Main] effects
        actions.push('activate-effect');
      } else {
        // Non-turn player during main
        // Can play Counter strategies
        if (!playerState.hasPlayedStrategyThisTurn) {
          const canPlay = playerState.hand.some((id) => {
            const def = getCardDefForInstance(state, id);
            if (def.cardType !== 'strategy') return false;
            if (!('keywords' in def) || !def.keywords.includes('counter')) return false;
            return def.turnCost <= playerState.turnMarker;
          });
          if (canPlay) actions.push('play-strategy');
        }

        // Can use activate [Main] effects
        actions.push('activate-effect');
      }

      // Always can concede
      actions.push('concede');
      break;
    }

    case 'organization': {
      if (isTurnPlayer) {
        actions.push('organize-teams');
        actions.push('choose-battle-or-end');
      }
      break;
    }

    case 'battle-attack': {
      if (isTurnPlayer) {
        actions.push('select-attackers');
      }
      break;
    }

    case 'battle-block': {
      if (!isTurnPlayer) {
        actions.push('select-blockers');
        actions.push('organize-teams');
      }
      break;
    }

    case 'battle-eoa': {
      actions.push('pass-priority');
      actions.push('play-ability');
      actions.push('activate-effect');
      actions.push('concede');
      break;
    }

    case 'battle-showdown': {
      if (isTurnPlayer) {
        actions.push('choose-showdown-order');
      }
      break;
    }

    case 'end': {
      if (playerState.hand.length > 7) {
        actions.push('discard-to-hand-limit');
      }
      break;
    }
  }

  return actions;
}
