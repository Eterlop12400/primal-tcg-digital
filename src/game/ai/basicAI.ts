// ============================================================
// Basic AI — Heuristic-based decision making (Level 1)
// ============================================================
// Makes reasonable decisions based on simple rules:
// - Play cards when affordable
// - Build teams with good synergy
// - Attack when advantageous
// - Block when necessary
// - Use abilities to maximize damage
// ============================================================

import {
  GameState,
  PlayerAction,
  PlayerId,
  CardInstance,
  CharacterCardDef,
  StrategyCardDef,
  AbilityCardDef,
  Team,
} from '../types';
import {
  getCard,
  getCardDefForInstance,
  getCardsInZone,
  getEffectiveStats,
  calculateTeamPower,
  getOpponent,
  characterHasAttribute,
  fieldHasSymbol,
  fieldHasName,
  cardHasSymbol,
} from '../engine/utils';
import { getCardDef } from '../cards';
import { getLegalActions } from '../engine/gameLoop';

export function getAIAction(state: GameState, player: PlayerId): PlayerAction {
  const phase = state.phase;
  const legalActions = getLegalActions(state, player);

  switch (phase) {
    case 'setup':
      return decideMulligan(state, player);

    case 'main':
      return decideMainPhase(state, player, legalActions);

    case 'organization':
      return decideOrganization(state, player);

    case 'battle-attack':
      return decideAttackers(state, player);

    case 'battle-block':
      return decideBlockers(state, player);

    case 'battle-eoa':
      return decideEOA(state, player, legalActions);

    case 'battle-showdown':
      return decideShowdownOrder(state, player);

    case 'end':
      return decideEndPhase(state, player);

    default:
      return { type: 'pass-priority' };
  }
}

// ============================================================
// Mulligan Decision
// ============================================================

function decideMulligan(state: GameState, player: PlayerId): PlayerAction {
  const hand = state.players[player].hand;
  const cardsToReturn: string[] = [];

  // Count how many 0-cost characters we have (early game plays)
  let zeroCostCount = 0;
  let highCostCount = 0;

  for (const cardId of hand) {
    const def = getCardDefForInstance(state, cardId);
    if (def.cardType === 'character') {
      const charDef = def as CharacterCardDef;
      if (charDef.turnCost === 0) zeroCostCount++;
      if (charDef.turnCost >= 4) highCostCount++;
    }
  }

  // If we have no 0-cost characters, mulligan the most expensive cards
  if (zeroCostCount === 0) {
    // Return up to 3 high-cost cards
    let returned = 0;
    for (const cardId of hand) {
      if (returned >= 3) break;
      const def = getCardDefForInstance(state, cardId);
      if (def.cardType === 'character') {
        const charDef = def as CharacterCardDef;
        if (charDef.turnCost >= 4) {
          cardsToReturn.push(cardId);
          returned++;
        }
      }
    }
  }
  // If hand is all high cost, return some
  else if (highCostCount >= 4) {
    let returned = 0;
    for (const cardId of hand) {
      if (returned >= 2) break;
      const def = getCardDefForInstance(state, cardId);
      if (def.cardType === 'character') {
        const charDef = def as CharacterCardDef;
        if (charDef.turnCost >= 4) {
          cardsToReturn.push(cardId);
          returned++;
        }
      }
    }
  }

  return { type: 'mulligan', cardInstanceIds: cardsToReturn };
}

// ============================================================
// Main Phase Decision
// ============================================================

function decideMainPhase(
  state: GameState,
  player: PlayerId,
  legalActions: PlayerAction['type'][]
): PlayerAction {
  const playerState = state.players[player];
  const isTurnPlayer = state.currentTurn === player;

  if (!isTurnPlayer) {
    // Non-turn player: just pass for now (no counter strategies in deck 1)
    return { type: 'pass-priority' };
  }

  // Priority 1: Summon a character if we can
  if (
    legalActions.includes('summon') &&
    !playerState.hasSummonedThisTurn &&
    state.chain.length === 0
  ) {
    const summonAction = chooseSummon(state, player);
    if (summonAction) return summonAction;
  }

  // Priority 2: Use activate effects (Solomon's buff, Lucian's draw)
  if (legalActions.includes('activate-effect')) {
    const activateAction = chooseActivateEffect(state, player);
    if (activateAction) return activateAction;
  }

  // Priority 3: Play a strategy card
  if (
    legalActions.includes('play-strategy') &&
    !playerState.hasPlayedStrategyThisTurn
  ) {
    const stratAction = chooseStrategy(state, player);
    if (stratAction) return stratAction;
  }

  // Priority 4: Charge essence (move cards we don't need to essence)
  if (legalActions.includes('charge-essence') && state.chain.length === 0) {
    const chargeAction = chooseCharge(state, player);
    if (chargeAction) return chargeAction;
  }

  // Default: pass
  return { type: 'pass-priority' };
}

function chooseSummon(
  state: GameState,
  player: PlayerId
): PlayerAction | null {
  const playerState = state.players[player];
  const hand = playerState.hand;

  // Find all summonable characters, pick the best one
  const summonable: { id: string; score: number }[] = [];

  for (const cardId of hand) {
    const def = getCardDefForInstance(state, cardId);
    if (def.cardType !== 'character') continue;

    const charDef = def as CharacterCardDef;
    if (charDef.turnCost > playerState.turnMarker) continue;

    // Check hand cost affordability
    if (charDef.handCost > 0) {
      const matchingInHand = hand.filter((id) => {
        if (id === cardId) return false;
        const d = getCardDefForInstance(state, id);
        return charDef.symbols.some((s) => d.symbols.includes(s));
      });
      if (matchingInHand.length < charDef.handCost) continue;
    }

    // Score: prefer higher stats, consider turn cost value
    const stats = charDef.healthyStats;
    const score = stats.lead * 2 + stats.support + charDef.effects.length * 2;
    summonable.push({ id: cardId, score });
  }

  if (summonable.length === 0) return null;

  // Pick highest score
  summonable.sort((a, b) => b.score - a.score);
  const chosen = summonable[0];
  const def = getCardDefForInstance(state, chosen.id) as CharacterCardDef;

  // Find hand cost payment cards
  let handCostCardIds: string[] = [];
  if (def.handCost > 0) {
    const available = hand.filter((id) => {
      if (id === chosen.id) return false;
      const d = getCardDefForInstance(state, id);
      return def.symbols.some((s) => d.symbols.includes(s));
    });

    // Pick lowest value cards for hand cost
    const scored = available.map((id) => {
      const d = getCardDefForInstance(state, id);
      let value = 0;
      if (d.cardType === 'character') {
        const cd = d as CharacterCardDef;
        value = cd.healthyStats.lead + cd.healthyStats.support;
      }
      return { id, value };
    });
    scored.sort((a, b) => a.value - b.value);
    handCostCardIds = scored.slice(0, def.handCost).map((s) => s.id);
  }

  return {
    type: 'summon',
    cardInstanceId: chosen.id,
    handCostCardIds,
  };
}

function chooseActivateEffect(
  state: GameState,
  player: PlayerId
): PlayerAction | null {
  const kingdom = getCardsInZone(state, player, 'kingdom');

  for (const card of kingdom) {
    const def = getCardDefForInstance(state, card.instanceId);
    if (def.cardType !== 'character') continue;

    const charDef = def as CharacterCardDef;
    for (const effect of charDef.effects) {
      if (effect.type !== 'activate') continue;
      if (effect.timing !== 'main' && effect.timing !== 'both') continue;
      if (effect.turnTiming === 'opponent-turn') continue;
      if (card.state === 'injured' && !effect.isValid) continue;
      if (effect.oncePerTurn && card.usedEffects.includes(effect.id)) continue;

      // Card-specific cost checks
      if (def.id === 'C0078') {
        // Lucian: needs a Weapon character in hand to discard
        const weaponInHand = state.players[player].hand.filter((id) => {
          const d = getCardDefForInstance(state, id);
          if (d.cardType !== 'character') return false;
          return (d as CharacterCardDef).attributes.includes('Weapon');
        });
        if (weaponInHand.length === 0) continue;

        // Pick lowest value weapon character as cost
        return {
          type: 'activate-effect',
          cardInstanceId: card.instanceId,
          effectId: effect.id,
          costCardIds: [weaponInHand[0]],
        };
      }

      if (def.id === 'C0079') {
        // Solomon: needs 2 cards in discard pile to expel
        const dp = state.players[player].discard;
        if (dp.length < 2) continue;

        return {
          type: 'activate-effect',
          cardInstanceId: card.instanceId,
          effectId: effect.id,
          costCardIds: [dp[0], dp[1]],
        };
      }
    }
  }

  return null;
}

function chooseStrategy(
  state: GameState,
  player: PlayerId
): PlayerAction | null {
  const playerState = state.players[player];
  const hand = playerState.hand;

  // Evaluate each strategy card
  const playable: { id: string; priority: number }[] = [];

  for (const cardId of hand) {
    const def = getCardDefForInstance(state, cardId);
    if (def.cardType !== 'strategy') continue;

    const stratDef = def as StrategyCardDef;
    if (stratDef.turnCost > playerState.turnMarker) continue;
    if (stratDef.keywords.includes('counter')) continue;

    // Check hand cost
    if (stratDef.handCost > 0) {
      const matching = hand.filter((id) => {
        if (id === cardId) return false;
        const d = getCardDefForInstance(state, id);
        return stratDef.symbols.some((s) => d.symbols.includes(s));
      });
      if (matching.length < stratDef.handCost) continue;
    }

    // Check Unique
    if (stratDef.keywords.includes('unique')) {
      const inPlay = playerState.kingdom.some((id) => {
        const d = getCardDefForInstance(state, id);
        return d.printNumber === stratDef.printNumber;
      });
      if (inPlay) continue;
    }

    // Card-specific priority
    let priority = 5;
    if (def.id === 'S0038') priority = 8;  // Search is high value
    if (def.id === 'S0039') priority = 7;  // Reaped Fear is good long-term
    if (def.id === 'S0040') priority = 9;  // Draw 3 is excellent
    if (def.id === 'S0041') {
      // Hard Decision: only good if we have expendable characters
      const cheapChars = playerState.kingdom.filter((id) => {
        const d = getCardDefForInstance(state, id);
        if (d.cardType !== 'character') return false;
        return (d as CharacterCardDef).turnCost === 0;
      });
      if (cheapChars.length > 2) {
        priority = 6;
      } else {
        priority = 2;
      }
    }

    playable.push({ id: cardId, priority });
  }

  if (playable.length === 0) return null;

  playable.sort((a, b) => b.priority - a.priority);
  const chosen = playable[0];
  const def = getCardDefForInstance(state, chosen.id) as StrategyCardDef;

  // Find hand cost cards (lowest value)
  let handCostCardIds: string[] = [];
  if (def.handCost > 0) {
    const available = hand.filter((id) => {
      if (id === chosen.id) return false;
      const d = getCardDefForInstance(state, id);
      return def.symbols.some((s) => d.symbols.includes(s));
    });
    handCostCardIds = available.slice(0, def.handCost);
  }

  // Find target for Hard Decision
  let targetIds: string[] | undefined;
  if (def.id === 'S0041') {
    const cheapChars = playerState.kingdom.filter((id) => {
      const d = getCardDefForInstance(state, id);
      if (d.cardType !== 'character') return false;
      return (d as CharacterCardDef).turnCost === 0;
    });
    if (cheapChars.length > 0) {
      // Pick injured character first, then lowest stat
      const injured = cheapChars.filter((id) => state.cards[id].state === 'injured');
      targetIds = [injured.length > 0 ? injured[0] : cheapChars[0]];
    }
  }

  return {
    type: 'play-strategy',
    cardInstanceId: chosen.id,
    handCostCardIds,
    targetIds,
  };
}

function chooseCharge(
  state: GameState,
  player: PlayerId
): PlayerAction | null {
  const hand = state.players[player].hand;
  const essenceCount = state.players[player].essence.length;

  // Only charge if we have enough cards and need essence for abilities later
  if (hand.length <= 3) return null; // Keep cards in hand
  if (essenceCount >= 6) return null; // Enough essence already

  // Charge duplicate low-cost characters or cards we have 3+ of in hand
  const cardCounts: Record<string, string[]> = {};
  for (const id of hand) {
    const def = getCardDefForInstance(state, id);
    if (!cardCounts[def.id]) cardCounts[def.id] = [];
    cardCounts[def.id].push(id);
  }

  // Find duplicates to charge
  const toCharge: string[] = [];
  for (const [defId, ids] of Object.entries(cardCounts)) {
    if (ids.length >= 2) {
      // Keep 1, charge extras
      const def = getCardDef(defId);
      if (def.cardType === 'character') {
        const charDef = def as CharacterCardDef;
        // Don't charge our only high-value characters
        if (charDef.turnCost <= 2 || ids.length >= 3) {
          toCharge.push(ids[ids.length - 1]); // charge one copy
        }
      }
    }
  }

  if (toCharge.length > 0) {
    return { type: 'charge-essence', cardInstanceIds: [toCharge[0]] };
  }

  return null;
}

// ============================================================
// Organization Phase
// ============================================================

function decideOrganization(state: GameState, player: PlayerId): PlayerAction {
  // Check if teams are already organized (second call after organize-teams)
  const existingTeams = Object.values(state.teams).filter(
    (t) => t.owner === player
  );

  if (existingTeams.length > 0) {
    // Teams already organized — choose battle or end
    // First turn of the game must skip to End Phase
    if (state.turnNumber === 1) {
      return { type: 'choose-battle-or-end', choice: 'end' };
    }

    // Choose battle if we have teams with characters
    // (can't use calculateTeamPower here since chars are in kingdom, not battlefield)
    const hasCharacters = existingTeams.some((t) =>
      t.characterIds.some((id) => {
        const card = getCard(state, id);
        return card && (card.zone === 'kingdom' || card.zone === 'battlefield');
      })
    );
    if (hasCharacters) {
      return { type: 'choose-battle-or-end', choice: 'battle' };
    }
    return { type: 'choose-battle-or-end', choice: 'end' };
  }

  const kingdom = getCardsInZone(state, player, 'kingdom').filter(
    (c) => c.state !== undefined // only characters
  );

  if (kingdom.length === 0) {
    return { type: 'choose-battle-or-end', choice: 'end' };
  }

  // Build teams based on synergy
  const teams = buildTeams(state, player, kingdom);

  return {
    type: 'organize-teams',
    teams: teams.map((t) => ({
      leadId: t[0],
      supportIds: t.slice(1),
    })),
  };
}

function buildTeams(
  state: GameState,
  player: PlayerId,
  characters: CardInstance[]
): string[][] {
  // Sort by lead value (highest lead = team lead candidates)
  const sorted = [...characters].sort((a, b) => {
    const aStats = getEffectiveStats(state, a.instanceId);
    const bStats = getEffectiveStats(state, b.instanceId);
    return bStats.lead - aStats.lead;
  });

  const teams: string[][] = [];
  const assigned = new Set<string>();

  // Build up to 3 teams
  for (const char of sorted) {
    if (assigned.has(char.instanceId)) continue;
    if (teams.length >= 3) break;

    const team: string[] = [char.instanceId];
    assigned.add(char.instanceId);

    // Find good support members (high support value)
    const supports = sorted
      .filter((c) => !assigned.has(c.instanceId))
      .sort((a, b) => {
        const aStats = getEffectiveStats(state, a.instanceId);
        const bStats = getEffectiveStats(state, b.instanceId);
        // Prefer high support value
        let aScore = aStats.support;
        let bScore = bStats.support;

        // Bonus for Rosita synergy (Mercenary/Slayer teamups)
        if (getCardDefForInstance(state, a.instanceId).id === 'C0086') aScore += 3;
        if (getCardDefForInstance(state, b.instanceId).id === 'C0086') bScore += 3;

        return bScore - aScore;
      });

    // Add up to 2 supports
    for (const support of supports) {
      if (team.length >= 3) break;
      team.push(support.instanceId);
      assigned.add(support.instanceId);
    }

    teams.push(team);
  }

  // Any remaining characters go in their own teams
  for (const char of sorted) {
    if (!assigned.has(char.instanceId)) {
      teams.push([char.instanceId]);
      assigned.add(char.instanceId);
    }
  }

  return teams;
}

// ============================================================
// Battle Phase Decisions
// ============================================================

function decideAttackers(state: GameState, player: PlayerId): PlayerAction {
  const playerTeams = Object.values(state.teams).filter(
    (t) => t.owner === player
  );

  if (playerTeams.length === 0) {
    return { type: 'select-attackers', teamIds: [] };
  }

  // Estimate team power (chars are in kingdom, not battlefield yet)
  const teamPowers = playerTeams.map((t) => ({
    team: t,
    power: estimateTeamPower(state, t),
  }));

  // Send teams with power > 0 to attack (up to 3)
  const attacking = teamPowers
    .filter((tp) => tp.power > 0)
    .sort((a, b) => b.power - a.power)
    .slice(0, 3)
    .map((tp) => tp.team.id);

  return { type: 'select-attackers', teamIds: attacking };
}

function decideBlockers(state: GameState, player: PlayerId): PlayerAction {
  const opponent = getOpponent(player);

  // Find attacking teams (these are on the battlefield now)
  const attackingTeams = Object.values(state.teams).filter(
    (t) => t.owner === opponent && t.isAttacking
  );

  // Find our available teams (still in kingdom)
  const ourTeams = Object.values(state.teams).filter(
    (t) => t.owner === player && !t.isAttacking && !t.isBlocking
  );

  if (ourTeams.length === 0 || attackingTeams.length === 0) {
    return { type: 'select-blockers', assignments: [] };
  }

  const assignments: { blockingTeamId: string; attackingTeamId: string }[] = [];
  const availableBlockers = [...ourTeams];

  for (const attacker of attackingTeams) {
    if (availableBlockers.length === 0) break;

    // Attackers are on battlefield so calculateTeamPower works
    const attackPower = calculateTeamPower(state, attacker);

    // Find best blocker (use estimate since blockers are in kingdom)
    let bestBlocker: { team: Team; power: number } | null = null;

    for (const blocker of availableBlockers) {
      const blockPower = estimateTeamPower(state, blocker);

      // Block if we can win or stalemate
      if (blockPower >= attackPower && (!bestBlocker || blockPower < bestBlocker.power)) {
        bestBlocker = { team: blocker, power: blockPower };
      }
    }

    // Also consider blocking to prevent Outstanding Battle Reward (power >= 5)
    if (!bestBlocker && attackPower >= 5) {
      const sacrificial = availableBlockers[0];
      if (sacrificial) {
        bestBlocker = {
          team: sacrificial,
          power: estimateTeamPower(state, sacrificial),
        };
      }
    }

    if (bestBlocker) {
      assignments.push({
        blockingTeamId: bestBlocker.team.id,
        attackingTeamId: attacker.id,
      });
      const idx = availableBlockers.indexOf(bestBlocker.team);
      if (idx !== -1) availableBlockers.splice(idx, 1);
    }
  }

  return { type: 'select-blockers', assignments };
}

// Estimate team power for characters that may not be on the battlefield yet
function estimateTeamPower(state: GameState, team: Team): number {
  let power = 0;
  for (let i = 0; i < team.characterIds.length; i++) {
    const charId = team.characterIds[i];
    const card = state.cards[charId];
    if (!card) continue;

    const stats = getEffectiveStats(state, charId);
    if (i === 0 && team.hasLead) {
      power += stats.lead;
    } else {
      power += stats.support;
    }
  }
  return power;
}

// ============================================================
// EOA (Exchange of Ability) Decision
// ============================================================

function decideEOA(
  state: GameState,
  player: PlayerId,
  legalActions: PlayerAction['type'][]
): PlayerAction {
  // Try to play an ability card
  if (legalActions.includes('play-ability')) {
    const abilityAction = chooseAbility(state, player);
    if (abilityAction) return abilityAction;
  }

  return { type: 'pass-priority' };
}

function chooseAbility(
  state: GameState,
  player: PlayerId
): PlayerAction | null {
  const hand = state.players[player].hand;
  const battlefield = getCardsInZone(state, player, 'battlefield');
  const opponent = getOpponent(player);
  const opponentBattlefield = getCardsInZone(state, opponent, 'battlefield');

  // Find playable abilities
  for (const cardId of hand) {
    const def = getCardDefForInstance(state, cardId);
    if (def.cardType !== 'ability') continue;

    const abilityDef = def as AbilityCardDef;

    // Find a valid user on our battlefield
    const validUser = battlefield.find((c) => {
      if (c.state === 'injured') return false; // most abilities aren't Valid
      const cDef = getCardDefForInstance(state, c.instanceId) as CharacterCardDef;
      return abilityDef.requirements.every((req) => {
        if (req.type === 'attribute') return cDef.attributes.includes(req.value);
        return true;
      });
    });

    if (!validUser) continue;

    // Check essence cost
    const essence = state.players[player].essence;
    const canPayEssence = checkEssenceCost(state, player, abilityDef);
    if (!canPayEssence.canPay) continue;

    // Find target (opposing characters)
    let targetIds: string[] | undefined;
    if (abilityDef.targetDescription?.includes('opposing')) {
      if (opponentBattlefield.length === 0) continue;
      // Target the strongest opposing character
      const sorted = [...opponentBattlefield].sort((a, b) => {
        const aStats = getEffectiveStats(state, a.instanceId);
        const bStats = getEffectiveStats(state, b.instanceId);
        return bStats.lead - aStats.lead;
      });
      targetIds = [sorted[0].instanceId];
    }

    return {
      type: 'play-ability',
      cardInstanceId: cardId,
      userId: validUser.instanceId,
      targetIds,
      essenceCostCardIds: canPayEssence.cardIds,
      xValue: abilityDef.essenceCost.x ? Math.min(2, canPayEssence.cardIds.length) : undefined,
    };
  }

  return null;
}

function checkEssenceCost(
  state: GameState,
  player: PlayerId,
  abilityDef: AbilityCardDef
): { canPay: boolean; cardIds: string[] } {
  const essence = [...state.players[player].essence];
  const toPay: string[] = [];

  // Pay specific symbols first
  for (const specific of abilityDef.essenceCost.specific) {
    for (let i = 0; i < specific.count; i++) {
      const matching = essence.find(
        (id) => !toPay.includes(id) && cardHasSymbol(state, id, specific.symbol)
      );
      if (!matching) return { canPay: false, cardIds: [] };
      toPay.push(matching);
    }
  }

  // Pay neutral
  const neutralNeeded = abilityDef.essenceCost.x
    ? Math.min(2, essence.length - toPay.length) // For X costs, pay 2 if we can
    : abilityDef.essenceCost.neutral;

  for (let i = 0; i < neutralNeeded; i++) {
    const available = essence.find((id) => !toPay.includes(id));
    if (!available) {
      if (abilityDef.essenceCost.x) break; // X can be 0
      return { canPay: false, cardIds: [] };
    }
    toPay.push(available);
  }

  return { canPay: true, cardIds: toPay };
}

// ============================================================
// Showdown Order
// ============================================================

function decideShowdownOrder(state: GameState, player: PlayerId): PlayerAction {
  const attackingTeams = Object.values(state.teams).filter(
    (t) => t.owner === player && t.isAttacking
  );

  // Resolve unblocked teams first (guaranteed BRs)
  const unblocked = attackingTeams.filter((t) => !t.blockedByTeamId);
  const blocked = attackingTeams.filter((t) => t.blockedByTeamId);

  const order = [...unblocked, ...blocked].map((t) => t.id);

  return { type: 'choose-showdown-order', teamIds: order };
}

// ============================================================
// End Phase
// ============================================================

function decideEndPhase(state: GameState, player: PlayerId): PlayerAction {
  const hand = state.players[player].hand;

  if (hand.length > 7) {
    // Discard lowest value cards
    const scored = hand.map((id) => {
      const def = getCardDefForInstance(state, id);
      let value = 5; // default
      if (def.cardType === 'character') {
        const cd = def as CharacterCardDef;
        value = cd.healthyStats.lead + cd.healthyStats.support + cd.turnCost;
      } else if (def.cardType === 'strategy') {
        value = 6;
      } else if (def.cardType === 'ability') {
        value = 4;
      }
      return { id, value };
    });

    scored.sort((a, b) => a.value - b.value);
    const excess = hand.length - 7;
    const toDiscard = scored.slice(0, excess).map((s) => s.id);

    return { type: 'discard-to-hand-limit', cardInstanceIds: toDiscard };
  }

  return { type: 'pass-priority' };
}
