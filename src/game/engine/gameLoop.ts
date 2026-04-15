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
  characterHasAttribute,
  isProtectedFromCharacterEffects,
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

  // 4. Normal Draw — only the current turn player draws.
  //    Skip draw on the very first turn of the game (turn 0) for the player who goes first.
  if (state.turnNumber > 0) {
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

  // Preserve existing teams but clean up:
  // 1. Remove characters no longer in kingdom from their teams
  // 2. Delete empty teams
  // 3. Reset battle flags
  // 4. Create solo teams for unteamed kingdom characters
  cleanupTeams(state, player);
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

  // Process start-of-showdown lingering effects (e.g., Swift Strike)
  const showdownEffects = state.lingeringEffects.filter(
    (e) => e.id.startsWith('swiftstrike_')
  );

  for (const effect of showdownEffects) {
    const targetId = effect.data?.targetId as string | undefined;
    const owner = effect.data?.owner as PlayerId | undefined;
    if (!targetId || !owner) continue;

    const target = state.cards[targetId];
    if (!target || target.zone !== 'battlefield') {
      addLog(state, owner, 'effect', 'Swift Strike — Target no longer on battlefield');
      continue;
    }

    // Check protection (Omtaba E2)
    if (isProtectedFromCharacterEffects(state, targetId, owner)) {
      addLog(state, owner, 'effect', 'Swift Strike — Target is protected from character effects');
      continue;
    }

    // Check if target used an ability that resolved this turn
    // (We check if the target character was the userId of a resolved ability)
    const targetUsedAbility = state.log.some(
      (log) =>
        log.turn === state.turnNumber &&
        log.action === 'ability-user-resolved' &&
        log.cardInstanceId === targetId
    );

    if (!targetUsedAbility) {
      // Deal 1 damage to the target
      const result = dealDamage(state, targetId, 1);
      const targetDef = getCardDefForInstance(state, targetId);
      addLog(state, owner, 'effect', `Swift Strike — Dealt 1 damage to ${targetDef.name}`);

      // If discarded, you may draw 1 card (optional)
      if (result.discarded) {
        state.lingeringEffects.push({
          id: `swiftstrike_draw_${effect.id}`,
          source: effect.source,
          effectDescription: 'You may draw 1 card (Swift Strike target was discarded)',
          duration: 'turn',
          appliedTurn: state.turnNumber,
          data: { owner, optional: true },
        });
      }
    } else {
      addLog(state, owner, 'effect', 'Swift Strike — Target used an ability, no damage dealt');
    }
  }

  // Remove consumed Swift Strike damage effects (keep draw effects for optional prompt)
  state.lingeringEffects = state.lingeringEffects.filter(
    (e) => !e.id.startsWith('swiftstrike_') || e.id.startsWith('swiftstrike_draw_')
  );

  // Check for Swift Strike draw optional effects
  const drawEffects = state.lingeringEffects.filter(
    (e) => e.id.startsWith('swiftstrike_draw_')
  );
  if (drawEffects.length > 0) {
    const first = drawEffects[0];
    state.pendingOptionalEffect = {
      lingeringEffectId: first.id,
      sourceCardId: first.source,
      effectId: 'A0038-E1',
      cardName: 'Swift Strike',
      effectDescription: first.effectDescription,
      owner: first.data.owner as PlayerId,
    };
    return; // Pause — player must respond before continuing to showdown
  }
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

  // 3. Process end-of-turn lingering effects BEFORE clearing them

  // Solomon's end-of-turn: may discard top 2 of deck (optional prompt)
  const solomonEffects = state.lingeringEffects.filter(
    (e) => e.id.startsWith('solomon_')
  );
  if (solomonEffects.length > 0) {
    const first = solomonEffects[0];
    const effectPlayer = first.data?.player as PlayerId | undefined;
    if (effectPlayer) {
      state.pendingOptionalEffect = {
        lingeringEffectId: first.id,
        sourceCardId: first.source,
        effectId: 'C0079-E2',
        cardName: 'Solomon',
        effectDescription: 'You may discard the top 2 cards of your deck.',
        owner: effectPlayer,
      };
      return; // Pause — player must respond before continuing end phase
    }
  }

  // Clear "until end of turn" effects and lingering effects
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

  // 4. Hand limit check (7 cards) — player must discard down
  if (state.players[player].hand.length > 7) {
    state.priorityPlayer = player;
    state.consecutivePasses = 0;
    addLog(state, player, 'hand-limit', `Hand has ${state.players[player].hand.length} cards — must discard to 7`);
    return; // Wait for discard-to-hand-limit action
  }

  // Hand is fine — finish the end phase immediately
  finishEndPhase(state);
}

export function finishEndPhase(state: GameState): void {
  const player = state.currentTurn;
  const opponent = getOpponent(player);

  // Increment turn marker
  state.players[player].turnMarker += 1;
  addLog(
    state,
    player,
    'turn-marker',
    `Turn Marker → ${state.players[player].turnMarker}`
  );

  // Reset per-turn flags
  state.players[player].hasSummonedThisTurn = false;
  state.players[player].hasPlayedStrategyThisTurn = false;
  state.players[player].hasUsedRushThisTurn = false;

  // Switch turns
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

function cleanupTeams(state: GameState, player: PlayerId): void {
  const kingdomIds = new Set(state.players[player].kingdom);

  for (const [teamId, team] of Object.entries(state.teams)) {
    if (team.owner !== player) continue;

    // Reset battle flags
    team.isAttacking = false;
    team.isBlocking = false;
    team.blockedByTeamId = undefined;
    team.blockingTeamId = undefined;

    // Remove characters no longer in kingdom
    team.characterIds = team.characterIds.filter((cid) => {
      if (kingdomIds.has(cid)) return true;
      // Character left kingdom — clear their team ref
      const card = state.cards[cid];
      if (card) {
        card.teamId = undefined;
        card.battleRole = undefined;
      }
      return false;
    });

    // Delete empty teams
    if (team.characterIds.length === 0) {
      delete state.teams[teamId];
      continue;
    }

    // If lead was removed, promote first remaining character
    if (!team.hasLead || !kingdomIds.has(team.characterIds[0])) {
      const newLead = state.cards[team.characterIds[0]];
      if (newLead) {
        newLead.battleRole = 'team-lead';
        team.hasLead = true;
      }
    }
  }
}

function autoCreateSoloTeams(state: GameState, player: PlayerId): void {
  const kingdom = state.players[player].kingdom;
  for (const cardId of kingdom) {
    const card = state.cards[cardId];
    const def = getCardDefForInstance(state, cardId);
    if (!card || def.cardType !== 'character') continue;

    // Skip characters already in a team
    if (card.teamId && state.teams[card.teamId]) continue;

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
  const defender = getOpponent(state.currentTurn);

  // Safeguard: ensure the defender has teams for their kingdom characters.
  // Teams should already exist from the defender's last organization phase,
  // but create solo teams as a fallback if they're missing.
  const defenderHasTeams = Object.values(state.teams).some((t) => t.owner === defender);
  if (!defenderHasTeams) {
    autoCreateSoloTeams(state, defender);
  }

  state.phase = 'battle-block';
  state.priorityPlayer = defender;
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
    applyShowdownDamage(state, attackingTeam, 'stalemate', blockingTeam);
    applyShowdownDamage(state, blockingTeam, 'stalemate', attackingTeam);
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
    applyShowdownDamage(state, losingTeam, 'outstanding-victory', winningTeam);
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
    applyShowdownDamage(state, losingTeam, 'victory', winningTeam);
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
  result: 'victory' | 'outstanding-victory' | 'stalemate',
  winningTeam?: Team
): void {
  const charsOnField = losingTeam.characterIds.filter(
    (id) => state.cards[id]?.zone === 'battlefield'
  );

  if (charsOnField.length === 0) return;

  const discardedIds: string[] = [];

  if (result === 'stalemate' || result === 'victory') {
    // 1 damage to team lead only
    if (losingTeam.hasLead && charsOnField.includes(losingTeam.characterIds[0])) {
      const leadId = losingTeam.characterIds[0];
      const dmgResult = dealDamage(state, leadId, 1);
      addLog(
        state,
        losingTeam.owner,
        'showdown-damage',
        `${getCardDefForInstance(state, leadId).name} takes 1 damage`
      );
      if (dmgResult.discarded) discardedIds.push(leadId);
    }
  } else if (result === 'outstanding-victory') {
    // 2 damage to team lead
    if (losingTeam.hasLead && charsOnField.includes(losingTeam.characterIds[0])) {
      const leadId = losingTeam.characterIds[0];
      const dmgResult = dealDamage(state, leadId, 2);
      addLog(
        state,
        losingTeam.owner,
        'showdown-damage',
        `${getCardDefForInstance(state, leadId).name} takes 2 damage`
      );
      if (dmgResult.discarded) discardedIds.push(leadId);
    }
    // 1 damage to each support
    for (let i = 1; i < losingTeam.characterIds.length; i++) {
      const supportId = losingTeam.characterIds[i];
      if (charsOnField.includes(supportId)) {
        const dmgResult = dealDamage(state, supportId, 1);
        addLog(
          state,
          losingTeam.owner,
          'showdown-damage',
          `${getCardDefForInstance(state, supportId).name} takes 1 damage`
        );
        if (dmgResult.discarded) discardedIds.push(supportId);
      }
    }
  }

  // Check Reaped Fear trigger: if winning team has a Slayer and discarded an opponent's character
  if (winningTeam && discardedIds.length > 0) {
    const winningPlayer = winningTeam.owner;
    const hasSlayer = winningTeam.characterIds.some(
      (id) => state.cards[id] && characterHasAttribute(state, id, 'Slayer')
    );

    if (hasSlayer) {
      // Check if winning player has Reaped Fear in kingdom
      const kingdom = state.players[winningPlayer].kingdom;
      for (const cardId of kingdom) {
        const card = state.cards[cardId];
        if (!card) continue;
        const def = getCardDefForInstance(state, cardId);
        if (def.id !== 'S0039') continue;
        if (card.usedEffects.includes('S0039-E1')) continue;

        // Trigger Reaped Fear
        state.pendingTriggers.push({
          id: `trigger_${cardId}_S0039-E1`,
          type: 'trigger-effect',
          sourceCardInstanceId: cardId,
          effectId: 'S0039-E1',
          resolved: false,
          negated: false,
          owner: winningPlayer,
        });
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

  // Clean up teams: remove dead characters and delete empty teams
  for (const [teamId, team] of Object.entries(state.teams)) {
    team.isAttacking = false;
    team.isBlocking = false;
    team.blockedByTeamId = undefined;
    team.blockingTeamId = undefined;

    // Remove characters no longer in kingdom (discarded/expelled during battle)
    team.characterIds = team.characterIds.filter((cid) => {
      const inst = state.cards[cid];
      return inst && inst.zone === 'kingdom';
    });

    // Delete empty teams
    if (team.characterIds.length === 0) {
      delete state.teams[teamId];
    } else if (!team.characterIds.includes(team.characterIds[0])) {
      // If lead was removed, mark hasLead false
      team.hasLead = false;
    }
  }
}

// ============================================================
// Priority / Pass Handling
// ============================================================

export function handlePassPriority(state: GameState, collector?: import('./EventCollector').EventCollector): void {
  state.consecutivePasses += 1;

  if (state.consecutivePasses >= 2) {
    // Both players passed — resolve chain or advance phase
    state.consecutivePasses = 0;

    if (state.chain.length > 0 && !state.isChainResolving) {
      resolveChain(state, collector);
    } else {
      // No chain — advance to next phase
      const prevPhase = state.phase;
      advancePhase(state);
      if (state.phase !== prevPhase) {
        collector?.emit({
          type: 'phase-change',
          player: state.currentTurn,
          fromPhase: prevPhase,
          toPhase: state.phase,
        });
      }
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

  // Pending optional effect takes priority over everything
  if (state.pendingOptionalEffect && state.pendingOptionalEffect.owner === player) {
    return ['choose-optional-trigger'];
  }

  // Pending target choice takes priority over everything
  if (state.pendingTargetChoice && state.pendingTargetChoice.owner === player) {
    return ['resolve-target-choice'];
  }

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
