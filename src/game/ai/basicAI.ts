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
  FieldCardDef,
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
  oceanicAbyssVirtualCharCount,
} from '../engine/utils';

import { getLegalActions } from '../engine/gameLoop';
import {
  enumerateMainPhaseActions,
  scoreAction,
  simulateAction,
  isWinningState,
  planMainPhase,
} from './simulation';

// ============================================================
// Helper Functions — Board Evaluation & Utilities
// ============================================================

export function getGamePhase(state: GameState): 'early' | 'mid' | 'late' {
  const maxTM = Math.max(state.players.player1.turnMarker, state.players.player2.turnMarker);
  if (maxTM <= 2) return 'early';
  if (maxTM <= 5) return 'mid';
  return 'late';
}

export type AIStance = 'aggro' | 'balanced' | 'defensive' | 'desperate';

export interface GameContext {
  phase: 'early' | 'mid' | 'late';
  stance: AIStance;
  myBRTaken: number;      // BRs opponent earned against us
  oppBRTaken: number;     // BRs we earned against opponent
  myBoardPower: number;   // sum of lead stats (non-injured) in kingdom
  oppBoardPower: number;
  deckOutRisk: boolean;
}

/**
 * Compute game context for the AI player. Used to adjust aggressiveness
 * across multiple decision points (attackers, blockers, strategies, summons).
 */
export function getGameContext(state: GameState, player: PlayerId): GameContext {
  const ps = state.players[player];
  const ops = state.players[getOpponent(player)];

  const sumBoardPower = (chars: string[]): number => {
    let total = 0;
    for (const id of chars) {
      const card = state.cards[id];
      if (!card || card.state === undefined) continue;
      if (card.state === 'injured') continue;
      try {
        const stats = getEffectiveStats(state, id);
        total += stats.lead + stats.support * 0.5;
      } catch { /* ignore */ }
    }
    return total;
  };

  const myBoardPower = sumBoardPower(ps.kingdom);
  const oppBoardPower = sumBoardPower(ops.kingdom);
  const myBRTaken = ps.battleRewards.length;
  const oppBRTaken = ops.battleRewards.length;
  const deckOutRisk = ps.deck.length <= 5;

  // Stance logic
  let stance: AIStance = 'balanced';
  if (myBRTaken >= 6 || (myBRTaken >= 5 && oppBoardPower > myBoardPower * 1.3)) {
    stance = 'desperate';
  } else if (myBRTaken >= 4 || oppBoardPower > myBoardPower * 1.5 || deckOutRisk) {
    stance = 'defensive';
  } else if (oppBRTaken >= 4 || myBoardPower > oppBoardPower * 1.4) {
    stance = 'aggro';
  }

  return {
    phase: getGamePhase(state),
    stance,
    myBRTaken,
    oppBRTaken,
    myBoardPower,
    oppBoardPower,
    deckOutRisk,
  };
}

// ============================================================
// Opponent Model — threat projection from visible info only
// ============================================================
// "Visible info" means: opponent's essence, discard, expel, battleRewards,
// kingdom, battlefield, and field card. We do NOT peek at opponent's hand
// or the face-down order of their deck. We DO use their deck list (which
// cards remain un-revealed) since decklists are public in competitive TCG.

export interface OpponentModel {
  /** Projected max lead stat of a single character they could summon next turn. */
  maxNextTurnLead: number;
  /** Max essence cost of any ability they could currently afford. */
  maxAffordableAbilityCost: number;
  /** Best strategy turnCost they could play right now. */
  maxAffordableStrategyCost: number;
  /** True if they have enough essence + hand to plausibly hold a counter. */
  likelyHasCounter: boolean;
  /** Projected incoming damage next turn (from un-injured kingdom leaders). */
  projectedIncomingDamage: number;
  /** Deck+hand pool size (what they haven't revealed yet). */
  unknownPoolSize: number;
  /** True if opponent has shown they're running strategy counters (based on play history). */
  runsCounterStrategies: boolean;
}

export function buildOpponentModel(
  state: GameState,
  player: PlayerId,
): OpponentModel {
  const opp = getOpponent(player);
  const ops = state.players[opp];

  // Collect all currently visible opponent card IDs
  const visibleIds = new Set<string>([
    ...ops.discard,
    ...ops.expel,
    ...ops.essence,
    ...ops.kingdom,
    ...ops.battlefield,
    ...ops.battleRewards,
  ]);
  if (ops.fieldCard) visibleIds.add(ops.fieldCard);

  // Unknown pool = deck + hand (cards opponent has that we haven't seen)
  const unknownPoolSize = ops.deck.length + ops.hand.length;

  // Essence symbols the opponent owns
  const oppEssenceSymbols = new Set<string>();
  for (const eid of ops.essence) {
    try {
      const d = getCardDefForInstance(state, eid);
      for (const s of d.symbols) oppEssenceSymbols.add(s);
    } catch { /* ignore */ }
  }
  const oppEssenceCount = ops.essence.length;

  // Scan the unknown pool (their deck + hand) for the strongest
  // character they could summon next turn (assuming they have matching essence/symbols).
  // This is an upper-bound threat projection — not a prediction.
  let maxNextTurnLead = 0;
  let maxAffordableAbilityCost = 0;

  const unknownIds = [...ops.deck, ...ops.hand];
  for (const id of unknownIds) {
    let def;
    try { def = getCardDefForInstance(state, id); } catch { continue; }

    if (def.cardType === 'character') {
      const cd = def as CharacterCardDef;
      // They could summon this next turn if they'll have enough turnMarker.
      // Next turn turnMarker ≈ ops.turnMarker + 1.
      if (cd.turnCost <= ops.turnMarker + 1) {
        if (cd.healthyStats.lead > maxNextTurnLead) {
          maxNextTurnLead = cd.healthyStats.lead;
        }
      }
    } else if (def.cardType === 'ability') {
      const ad = def as AbilityCardDef;
      const costTotal = (ad.essenceCost?.neutral ?? 0) +
        (ad.essenceCost?.specific.reduce((sum, sc) => sum + sc.count, 0) ?? 0);
      // Check if affordable with current opponent essence
      if (costTotal <= oppEssenceCount) {
        // Symbol feasibility: at least one specific requirement has matching essence
        const symbolsOk = !ad.essenceCost || ad.essenceCost.specific.length === 0 ||
          ad.essenceCost.specific.some((sc) => oppEssenceSymbols.has(sc.symbol));
        if (symbolsOk && costTotal > maxAffordableAbilityCost) {
          maxAffordableAbilityCost = costTotal;
        }
      }
    }
  }

  // Max affordable strategy cost from unknown pool
  let maxAffordableStrategyCost = 0;
  for (const id of unknownIds) {
    let def;
    try { def = getCardDefForInstance(state, id); } catch { continue; }
    if (def.cardType !== 'strategy') continue;
    const sd = def as StrategyCardDef;
    if (sd.turnCost <= ops.turnMarker + 1 && sd.turnCost > maxAffordableStrategyCost) {
      maxAffordableStrategyCost = sd.turnCost;
    }
  }

  // "Likely has counter": opponent has ≥ 3 hand cards AND ≥ 2 essence
  // AND their deck/discard shows evidence of counter strategies
  let runsCounterStrategies = false;
  for (const id of [...ops.discard, ...ops.deck, ...ops.hand]) {
    try {
      const d = getCardDefForInstance(state, id);
      if (d.cardType === 'strategy' && (d as StrategyCardDef).keywords.includes('counter')) {
        runsCounterStrategies = true;
        break;
      }
    } catch { /* ignore */ }
  }
  const likelyHasCounter = runsCounterStrategies && ops.hand.length >= 3 && oppEssenceCount >= 2;

  // Projected incoming damage: sum of un-injured kingdom leaders' lead stats
  let projectedIncomingDamage = 0;
  for (const id of ops.kingdom) {
    const card = state.cards[id];
    if (!card || card.state === undefined) continue;
    if (card.state === 'injured') continue;
    try {
      const stats = getEffectiveStats(state, id);
      projectedIncomingDamage += stats.lead;
    } catch { /* ignore */ }
  }

  return {
    maxNextTurnLead,
    maxAffordableAbilityCost,
    maxAffordableStrategyCost,
    likelyHasCounter,
    projectedIncomingDamage,
    unknownPoolSize,
    runsCounterStrategies,
  };
}

export function cardValue(state: GameState, cardId: string): number {
  const def = getCardDefForInstance(state, cardId);
  if (def.cardType === 'character') {
    const cd = def as CharacterCardDef;
    return cd.healthyStats.lead * 2 + cd.healthyStats.support + cd.turnCost * 0.5 + cd.effects.length * 1.5;
  }
  if (def.cardType === 'strategy') {
    return 5 + (def as StrategyCardDef).effects.length;
  }
  if (def.cardType === 'ability') {
    return 4 + (def as AbilityCardDef).effects.length;
  }
  return 3;
}

export function evaluateBoard(state: GameState, player: PlayerId): number {
  const ps = state.players[player];
  const opponent = getOpponent(player);
  const ops = state.players[opponent];
  let score = 0;

  // ----- Board character stats (tempo-aware) -----
  // A non-injured character in kingdom is "ready to act" this turn; injured = 0.6x.
  // Leader stats matter more than support because they're the team face-off number.
  const myChars = [...ps.kingdom, ...ps.battlefield];
  let myBoardPower = 0;
  let myReadyCharCount = 0;
  for (const id of myChars) {
    const card = state.cards[id];
    if (!card || card.state === undefined) continue; // not a character
    const stats = getEffectiveStats(state, id);
    const statScore = stats.lead * 2 + stats.support;
    const injured = card.state === 'injured';
    score += injured ? statScore * 0.6 : statScore;
    myBoardPower += injured ? 0 : Math.max(stats.lead, stats.support);
    if (!injured) myReadyCharCount++;
  }

  // ----- Tempo value -----
  // Characters we can ACT with this turn (non-injured) are worth extra because they
  // translate directly to pressure. Diminishing returns after 3 (team limit).
  score += Math.min(myReadyCharCount, 3) * 1.2;

  // ----- Threat assessment -----
  // Opponent's board power hints at defensive pressure on us. If opponent's top
  // team power meaningfully exceeds our best ready character's stats, we're behind.
  let oppMaxLead = 0;
  for (const id of ops.kingdom) {
    const card = state.cards[id];
    if (!card || card.state === undefined) continue;
    if (card.state === 'injured') continue;
    const stats = getEffectiveStats(state, id);
    if (stats.lead > oppMaxLead) oppMaxLead = stats.lead;
  }
  let myMaxLead = 0;
  for (const id of ps.kingdom) {
    const card = state.cards[id];
    if (!card || card.state === undefined || card.state === 'injured') continue;
    const stats = getEffectiveStats(state, id);
    if (stats.lead > myMaxLead) myMaxLead = stats.lead;
  }
  const threatGap = oppMaxLead - myMaxLead;
  if (threatGap > 0) score -= threatGap * 0.8;

  // ----- Essence (ability-aware) -----
  let abilityPoolSize = 0;
  let maxAbilityCost = 0;
  const seenAbilityIds = new Set<string>();
  const essenceCostTotal = (ec: { specific?: { count: number }[]; neutral?: number } | undefined): number => {
    if (!ec) return 0;
    const specific = (ec.specific ?? []).reduce((sum, s) => sum + (s.count || 0), 0);
    return specific + (ec.neutral ?? 0);
  };
  const checkAbilityPool = (id: string) => {
    try {
      const def = getCardDefForInstance(state, id);
      if (seenAbilityIds.has(def.id)) return;
      if (def.cardType === 'ability') {
        abilityPoolSize++;
        seenAbilityIds.add(def.id);
        const cost = essenceCostTotal((def as AbilityCardDef).essenceCost);
        if (cost > maxAbilityCost) maxAbilityCost = cost;
        return;
      }
      const effects = (def as { effects?: { type?: string; essenceCost?: { specific?: { count: number }[]; neutral?: number } }[] }).effects ?? [];
      for (const eff of effects) {
        if (eff.type === 'activate' && eff.essenceCost) {
          abilityPoolSize++;
          seenAbilityIds.add(def.id);
          const cost = essenceCostTotal(eff.essenceCost);
          if (cost > maxAbilityCost) maxAbilityCost = cost;
          break;
        }
      }
    } catch { /* ignore */ }
  };
  for (const id of ps.hand) checkAbilityPool(id);
  for (const id of ps.deck) checkAbilityPool(id);
  for (const id of ps.kingdom) checkAbilityPool(id);
  for (const id of ps.battlefield) checkAbilityPool(id);

  // Essence: valuable up to what abilities actually cost, then saturates sharply.
  const usefulEssenceCap = abilityPoolSize > 0 ? Math.max(maxAbilityCost, 3) : 1;
  const usefulEssence = Math.min(ps.essence.length, usefulEssenceCap);
  const excessEssence = Math.max(0, ps.essence.length - usefulEssenceCap);
  score += usefulEssence * (abilityPoolSize > 0 ? 0.5 : 0.1);
  score += excessEssence * 0.05;

  // ----- Hand value (playability-weighted) -----
  // Affordable cards (turnCost ≤ turnMarker) are worth more than clunkers.
  // Unique dupes of already-in-play cards are near-zero.
  let handValue = 0;
  const inPlayPrintNums = new Set<string>();
  for (const id of [...ps.kingdom, ...ps.battlefield]) {
    try {
      const d = getCardDefForInstance(state, id);
      inPlayPrintNums.add(d.printNumber);
    } catch { /* ignore */ }
  }
  for (const id of ps.hand) {
    try {
      const def = getCardDefForInstance(state, id);
      let v = 0.5; // baseline per-card
      if (def.cardType === 'character') {
        const cd = def as CharacterCardDef;
        const affordable = cd.turnCost <= ps.turnMarker;
        v = affordable ? 0.7 : 0.3;
        if (cd.characteristics.includes('unique') && inPlayPrintNums.has(cd.printNumber)) v = 0.05;
      } else if (def.cardType === 'strategy') {
        const sd = def as StrategyCardDef;
        v = sd.turnCost <= ps.turnMarker ? 0.7 : 0.35;
      } else if (def.cardType === 'ability') {
        v = abilityPoolSize > 0 && ps.essence.length >= 1 ? 0.6 : 0.3;
      }
      handValue += v;
    } catch { handValue += 0.4; }
  }
  // Diminishing returns past 5 cards
  score += Math.min(handValue, 5 * 0.7) + Math.max(0, handValue - 5 * 0.7) * 0.3;

  // ----- BR differential with urgency scaling -----
  // Late in the game (either player at 5+ BR taken against them), each BR is worth more.
  // ops.battleRewards = BRs earned BY us against opponent → opponent is losing.
  // ps.battleRewards = BRs opponent earned against us → we are losing.
  const myBRDanger = ps.battleRewards.length;
  const oppBRDanger = ops.battleRewards.length;
  const danger = Math.max(myBRDanger, oppBRDanger);
  const brWeight = danger >= 5 ? 5.0 : danger >= 3 ? 3.75 : 3.0;
  score += oppBRDanger * brWeight;
  score -= myBRDanger * brWeight;

  // ----- Turn marker advantage -----
  score += (ps.turnMarker - ops.turnMarker) * 0.5;

  // ----- Deck-out danger -----
  if (ps.deck.length <= 5) score -= (6 - ps.deck.length) * 1.5;

  // ----- Permanent strategies in play -----
  for (const id of ps.kingdom) {
    try {
      const def = getCardDefForInstance(state, id);
      if (def.cardType === 'strategy') score += 2;
    } catch { /* ignore */ }
  }

  // ----- Opponent threat modeling -----
  // Discount our position if opponent has unseen powerhouses they could drop next turn.
  // This makes AI more cautious when opponent has a big unplayed curve.
  try {
    const opModel = buildOpponentModel(state, player);
    // Big threats coming = mild discount (opponent upside, not our loss)
    if (opModel.maxNextTurnLead >= 5) score -= 1.2;
    else if (opModel.maxNextTurnLead >= 4) score -= 0.6;

    // Projected incoming damage vs our BR-taken position
    // Each BR toward 7 ends the game; damage is per-attack so weight more in late game
    const brWeight = ps.battleRewards.length >= 5 ? 0.8 : 0.4;
    score -= opModel.projectedIncomingDamage * brWeight * 0.25;

    // Affordable ability threat — they can pop off on our big team
    if (opModel.maxAffordableAbilityCost >= 4) score -= 0.8;

    // Counter strategies known to be in their deck + they have resources
    if (opModel.likelyHasCounter) score -= 0.6;
  } catch { /* best effort */ }

  // Silence unused variable
  void myBoardPower;

  return score;
}

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

  // Count duplicate print numbers for de-duping
  const printCounts: Record<string, number> = {};
  const printNumsByCard: Record<string, string> = {};
  for (const id of hand) {
    try {
      const def = getCardDefForInstance(state, id);
      printCounts[def.printNumber] = (printCounts[def.printNumber] || 0) + 1;
      printNumsByCard[id] = def.printNumber;
    } catch { /* ignore */ }
  }

  // Score each card for opening hand quality
  const scored = hand.map((cardId) => {
    const def = getCardDefForInstance(state, cardId);
    let score = 3; // default

    if (def.cardType === 'character') {
      const cd = def as CharacterCardDef;
      if (cd.turnCost === 0) score = 8;
      else if (cd.turnCost <= 2) score = 5;
      else if (cd.turnCost <= 3) score = 3;
      else score = 1;
      // Bonus for put-in-play triggers
      if (cd.effects.some((e) => e.type === 'trigger' && e.triggerCondition?.includes('put-in-play'))) score += 1;
      // Unique duplicates are worthless (can't summon two)
      if (cd.characteristics.includes('unique') && (printCounts[cd.printNumber] || 1) > 1) {
        score = Math.min(score, 2);
      }
    } else if (def.cardType === 'strategy') {
      const sd = def as StrategyCardDef;
      score = sd.turnCost <= 2 ? 4 : 2;
      if (sd.keywords.includes('unique') && (printCounts[sd.printNumber] || 1) > 1) {
        score = Math.min(score, 2);
      }
    } else if (def.cardType === 'ability') {
      score = 2;
    }

    // Penalize triplicates harder (≥3 copies of same card)
    if ((printCounts[def.printNumber] || 1) >= 3) score -= 1;

    return { id: cardId, score };
  });

  // Check if we have any 0-cost characters
  const hasZeroCost = scored.some((s) => {
    const def = getCardDefForInstance(state, s.id);
    return def.cardType === 'character' && (def as CharacterCardDef).turnCost === 0;
  });

  // Check turn-cost curve: want at least one 1-2 cost card too
  const hasEarlyCurve = scored.some((s) => {
    const def = getCardDefForInstance(state, s.id);
    if (def.cardType !== 'character') return false;
    const cd = def as CharacterCardDef;
    return cd.turnCost >= 1 && cd.turnCost <= 2;
  });

  scored.sort((a, b) => a.score - b.score);

  const cardsToReturn: string[] = [];

  if (!hasZeroCost && !hasEarlyCurve) {
    // Very bad opener — return up to 3 lowest scored cards aggressively
    for (const s of scored) {
      if (cardsToReturn.length >= 3) break;
      if (s.score <= 4) cardsToReturn.push(s.id);
    }
  } else if (!hasZeroCost) {
    // Decent curve but no turn-1 play — return 2-3 lowest
    for (const s of scored) {
      if (cardsToReturn.length >= 3) break;
      if (s.score <= 3) cardsToReturn.push(s.id);
    }
  } else {
    // Have 0-cost — only dump true clunkers (score ≤ 2)
    for (const s of scored) {
      if (cardsToReturn.length >= 2) break;
      if (s.score <= 2) cardsToReturn.push(s.id);
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

  // Activate effects are handled by a specialized picker (Solomon, Lucian, Spike, etc.) —
  // these have card-specific validation that's complex to enumerate, so we keep the
  // dedicated path and try it first.
  if (legalActions.includes('activate-effect')) {
    const activateAction = chooseActivateEffect(state, player);
    if (activateAction) return activateAction;
  }

  // Pre-compute Tier 1 heuristic actions — used as bonus signal layered on simulation
  const heuristicSummon = chooseSummon(state, player);
  const heuristicStrategy = chooseStrategy(state, player);
  const heuristicCharge = chooseCharge(state, player);
  const bonusCtx = { heuristicSummon, heuristicStrategy, heuristicCharge };

  // Tier 2 — depth-2 lookahead planner. Uses heuristicBonus at depth-1 ranking
  // to preserve Tier 1 card-specific intelligence.
  try {
    const planned = planMainPhase(state, player, {
      topK: 5,
      maxSims: 250,
      fullTurn: true,
      maxRolloutDepth: 5,
      heuristicBonusFn: (s, p, a) => heuristicBonus(s, p, a, bonusCtx),
    });
    if (planned) return planned;
  } catch {
    // Fall through to depth-1 scoring safety net
  }

  // Fallback — depth-1 scoring (original Tier 1+simulation logic, safety net)
  const candidates = enumerateMainPhaseActions(state, player);
  if (candidates.length === 0) return { type: 'pass-priority' };

  const scored = candidates.map((action) => {
    const simulated = simulateAction(state, player, action);
    if (simulated && isWinningState(simulated, player)) {
      return { action, score: Number.POSITIVE_INFINITY };
    }
    const simScore = scoreAction(state, player, action);
    const bonus = heuristicBonus(state, player, action, bonusCtx);
    return { action, score: simScore + bonus };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score === Number.NEGATIVE_INFINITY) {
    return { type: 'pass-priority' };
  }

  if (best.action.type === 'pass-priority' && scored.length > 1 && scored[1].score > 0.5) {
    return scored[1].action;
  }

  return best.action;
}

/**
 * Heuristic bonus layered on top of simulation's scoreAction.
 * Preserves Tier 1 card-specific intelligence that `evaluateBoard` can't see
 * (e.g., "this summon enables Spike's activate next turn"). If the Tier 1
 * picker would have chosen this exact action, we add a bonus; otherwise 0.
 */
function heuristicBonus(
  _state: GameState,
  _player: PlayerId,
  action: PlayerAction,
  ctx: {
    heuristicSummon: PlayerAction | null;
    heuristicStrategy: PlayerAction | null;
    heuristicCharge: PlayerAction | null;
  },
): number {
  if (action.type === 'summon') {
    if (ctx.heuristicSummon?.type === 'summon') {
      if (action.cardInstanceId === ctx.heuristicSummon.cardInstanceId) return 2.5;
      return -0.5; // Tier 1 preferred a different summon
    }
    // Tier 1 said "don't summon" — light penalty, but simulation can override for strong plays
    return -1.0;
  }
  if (action.type === 'play-strategy') {
    if (ctx.heuristicStrategy?.type === 'play-strategy') {
      if (action.cardInstanceId === ctx.heuristicStrategy.cardInstanceId) return 2.0;
      return -0.5;
    }
    return -1.0;
  }
  if (action.type === 'charge-essence') {
    if (ctx.heuristicCharge?.type === 'charge-essence') {
      const a = action.cardInstanceIds[0];
      const b = ctx.heuristicCharge.cardInstanceIds[0];
      if (a && a === b) return 1.5;
      return -1.0; // different charge target than Tier 1 picked
    }
    // Tier 1 vetoed charging entirely (hand too small or essence full) — strong penalty
    return -3.0;
  }
  // Slight negative bias on pass so we prefer action when scores are close
  if (action.type === 'pass-priority') return -0.25;
  return 0;
}

function chooseSummon(
  state: GameState,
  player: PlayerId
): PlayerAction | null {
  const playerState = state.players[player];
  const hand = playerState.hand;
  const phase = getGamePhase(state);

  // Gather kingdom character attributes for synergy scoring
  const kingdomAttrs: string[] = [];
  const kingdomChars: string[] = [];
  for (const id of playerState.kingdom) {
    const d = getCardDefForInstance(state, id);
    if (d.cardType === 'character') {
      const cd = d as CharacterCardDef;
      kingdomAttrs.push(...cd.attributes, ...cd.characteristics);
      kingdomChars.push(id);
    }
  }

  // Find all summonable characters, pick the best one
  const summonable: { id: string; score: number }[] = [];

  for (const cardId of hand) {
    const def = getCardDefForInstance(state, cardId);
    if (def.cardType !== 'character') continue;

    const charDef = def as CharacterCardDef;
    if (charDef.turnCost > playerState.turnMarker) continue;

    // Check Unique characteristic
    if (charDef.characteristics.includes('unique')) {
      const inPlay = [...playerState.kingdom, ...playerState.battlefield].some((id) => {
        const d = getCardDefForInstance(state, id);
        return d.printNumber === charDef.printNumber;
      });
      if (inPlay) continue;
    }

    // Check hand cost affordability
    if (charDef.handCost > 0) {
      const matchingInHand = hand.filter((id) => {
        if (id === cardId) return false;
        const d = getCardDefForInstance(state, id);
        return charDef.symbols.some((s) => d.symbols.includes(s));
      });
      if (matchingInHand.length < charDef.handCost) continue;
    }

    // Base: stats
    const stats = charDef.healthyStats;
    let score = stats.lead * 2 + stats.support;

    // Effect type weighting
    for (const eff of charDef.effects) {
      if (eff.type === 'trigger' && eff.triggerCondition?.includes('put-in-play')) score += 3;
      else if (eff.type === 'ongoing') score += 2;
      else if (eff.type === 'activate') score += 2.5;
      else score += 1;
    }

    // Kingdom synergy: shared attributes/characteristics
    const myTraits = [...charDef.attributes, ...charDef.characteristics];
    for (const trait of myTraits) {
      const matches = kingdomAttrs.filter((a) => a === trait).length;
      score += Math.min(matches, 3) * 0.5;
    }

    // Phase adjustments
    if (phase === 'early') {
      if (charDef.turnCost === 0) score += 2;
      if (charDef.turnCost >= 4) score -= 2;
    } else if (phase === 'late') {
      if (charDef.turnCost >= 3) score += 1.5;
    }

    // Hand cost penalty
    score -= charDef.handCost * 1.5;

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
      // Check name-scoped activate restrictions
      if (effect.activateScope === 'name-turn' || effect.activateScope === 'name-game') {
        const nameKey = def.printNumber + ':' + effect.id;
        if (state.players[player].usedActivateNames.includes(nameKey)) continue;
      }

      // Card-specific cost checks
      if (def.id === 'C0088') {
        // Hydroon: needs field "Micromon Beach" + Krakaan in deck
        if (!fieldHasName(state, player, 'Micromon Beach')) continue;
        const hasKrakaan = state.players[player].deck.some((id) => {
          try {
            const d = getCardDefForInstance(state, id);
            if (d.cardType !== 'character') return false;
            return d.name === 'Sea King Krakaan' || (d.names && d.names.includes('Krakaan'));
          } catch { return false; }
        });
        if (!hasKrakaan) continue;

        return {
          type: 'activate-effect',
          cardInstanceId: card.instanceId,
          effectId: effect.id,
        };
      }

      if (def.id === 'C0075') {
        // Aquaconda: needs 3+ other MICROMON + field is Micromon Beach + opponent has essence
        const opponent = getOpponent(player);
        if (state.players[opponent].essence.length === 0) continue;
        if (!fieldHasName(state, player, 'Micromon Beach')) continue;
        const allInPlay = [
          ...getCardsInZone(state, player, 'kingdom'),
          ...getCardsInZone(state, player, 'battlefield'),
        ];
        let otherMicromon = allInPlay.filter((c) => {
          if (c.instanceId === card.instanceId) return false;
          const d = getCardDefForInstance(state, c.instanceId);
          if (d.cardType !== 'character') return false;
          return (d as CharacterCardDef).characteristics.includes('micromon');
        }).length;
        // Oceanic Abyss E2 — virtual MICROMON character
        otherMicromon += oceanicAbyssVirtualCharCount(state, player, { characteristic: 'micromon' });
        if (otherMicromon < 3) continue;

        return {
          type: 'activate-effect',
          cardInstanceId: card.instanceId,
          effectId: effect.id,
        };
      }

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

  // Check hand cards for activate-from-hand effects (e.g., C0074 Spike, C0090 Megalino)
  const handCards = state.players[player].hand.map((id) => state.cards[id]).filter(Boolean);
  for (const card of handCards) {
    const def = getCardDefForInstance(state, card.instanceId);
    if (def.cardType !== 'character') continue;

    const charDef = def as CharacterCardDef;
    for (const effect of charDef.effects) {
      if (effect.type !== 'activate') continue;
      if (effect.timing !== 'main' && effect.timing !== 'both') continue;
      const isExpelFromHand = effect.costDescription?.toLowerCase().includes('expel this card from your hand');
      const isPutInPlayFromHand = effect.effectDescription?.toLowerCase().includes('from your hand in play');
      if (!isExpelFromHand && !isPutInPlayFromHand) continue;
      if (effect.oncePerTurn && card.usedEffects.includes(effect.id)) continue;
      // Check name-scoped activate restrictions
      if (effect.activateScope === 'name-turn' || effect.activateScope === 'name-game') {
        const nameKey = def.printNumber + ':' + effect.id;
        if (state.players[player].usedActivateNames.includes(nameKey)) continue;
      }

      if (def.id === 'C0074') {
        // Spike: needs 3+ MICROMON characters in kingdom/battlefield
        const allInPlay = [
          ...getCardsInZone(state, player, 'kingdom'),
          ...getCardsInZone(state, player, 'battlefield'),
        ];
        let micromonCount = allInPlay.filter((c) => {
          const d = getCardDefForInstance(state, c.instanceId);
          if (d.cardType !== 'character') return false;
          return (d as CharacterCardDef).characteristics.includes('micromon');
        }).length;
        // Oceanic Abyss E2 — virtual MICROMON character
        micromonCount += oceanicAbyssVirtualCharCount(state, player, { characteristic: 'micromon' });

        if (micromonCount >= 3) {
          return {
            type: 'activate-effect',
            cardInstanceId: card.instanceId,
            effectId: effect.id,
          };
        }
      }

      if (def.id === 'C0090') {
        // Megalino: needs a character named "Krakaan" in kingdom/battlefield
        const allInPlay = [
          ...getCardsInZone(state, player, 'kingdom'),
          ...getCardsInZone(state, player, 'battlefield'),
        ];
        const hasKrakaan = allInPlay.some((c) => {
          const d = getCardDefForInstance(state, c.instanceId);
          return d.name === 'Sea King Krakaan' || (d.names && d.names.includes('Krakaan'));
        });

        if (hasKrakaan) {
          return {
            type: 'activate-effect',
            cardInstanceId: card.instanceId,
            effectId: effect.id,
          };
        }
      }
    }
  }

  // Check player's field card for activate effects
  const fieldCardId = state.players[player].fieldCard;
  if (fieldCardId) {
    const fieldInst = state.cards[fieldCardId];
    if (fieldInst && fieldInst.zone === 'field-area') {
      const fDef = getCardDefForInstance(state, fieldCardId);
      if (fDef.cardType === 'field') {
        const fieldDef = fDef as FieldCardDef;
        for (const effect of fieldDef.effects) {
          if (effect.type !== 'activate') continue;
          if (effect.timing !== 'main' && effect.timing !== 'both') continue;
          if (effect.turnTiming === 'opponent-turn') continue;
          if (effect.oncePerTurn && fieldInst.usedEffects.includes(effect.id)) continue;

          if (fDef.id === 'F0006') {
            // Micromon Beach — count Terra/Water characters
            const allInPlay = [
              ...getCardsInZone(state, player, 'kingdom'),
              ...getCardsInZone(state, player, 'battlefield'),
            ];
            let terraWaterCount = allInPlay.filter((c) => {
              const d = getCardDefForInstance(state, c.instanceId);
              if (d.cardType !== 'character') return false;
              return d.symbols.includes('terra') || d.symbols.includes('water');
            }).length;
            // Oceanic Abyss E2 — virtual Water+Terra character
            terraWaterCount += oceanicAbyssVirtualCharCount(state, player);

            if (terraWaterCount < 2) continue;

            // AI heuristic: prefer highest threshold available
            // 6+ > 4+ draw > 2+ buff > 4+ essence swap
            let choice: number;
            if (terraWaterCount >= 6) {
              choice = 3; // Block abilities
            } else if (terraWaterCount >= 4) {
              choice = 1; // Draw 1
            } else {
              choice = 0; // +1/+1 buff
            }

            return {
              type: 'activate-effect',
              cardInstanceId: fieldCardId,
              effectId: effect.id,
              effectSubChoice: choice,
            };
          }
        }
      }
    }
  }

  // Check essence cards for activate-from-essence effects (e.g., S0044 Unknown Pathway)
  const essenceCards = state.players[player].essence.map((id) => state.cards[id]).filter(Boolean);
  for (const card of essenceCards) {
    const def = getCardDefForInstance(state, card.instanceId);
    if (def.cardType !== 'strategy') continue;

    const stratDef = def as StrategyCardDef;
    for (const effect of stratDef.effects) {
      if (effect.type !== 'activate') continue;
      const isExpelFromEssence = effect.costDescription?.toLowerCase().includes('expel this card from your essence');
      if (!isExpelFromEssence) continue;
      if (effect.timing === 'main' && state.phase !== 'main') continue;
      if (effect.oncePerTurn && card.usedEffects.includes(effect.id)) continue;
      // Check name-scoped activate restrictions
      if (effect.activateScope === 'name-turn' || effect.activateScope === 'name-game') {
        const nameKey = def.printNumber + ':' + effect.id;
        if (state.players[player].usedActivateNames.includes(nameKey)) continue;
      }

      // Check turn timing
      const isTurnPlayer = state.currentTurn === player;
      if (effect.turnTiming === 'your-turn' && !isTurnPlayer) continue;
      if (effect.turnTiming === 'opponent-turn' && isTurnPlayer) continue;

      if (def.id === 'S0044') {
        // S0044-E2: Remove 1 counter — prefer removing opponent's plus-one counters
        const opponent = getOpponent(player);
        const opKingdom = state.players[opponent].kingdom;
        const opBattlefield = state.players[opponent].battlefield;
        let bestTarget: string | null = null;

        // First priority: opponent cards with permanent or plus-one counters
        for (const id of [...opKingdom, ...opBattlefield]) {
          const c = state.cards[id];
          if (c && c.counters.length > 0) {
            bestTarget = id;
            break;
          }
        }

        if (!bestTarget) {
          // No opponent targets — check own cards for minus-one counters to remove
          const myKingdom = state.players[player].kingdom;
          const myBattlefield = state.players[player].battlefield;
          for (const id of [...myKingdom, ...myBattlefield]) {
            const c = state.cards[id];
            if (c && c.counters.some((ct) => ct.type === 'minus-one')) {
              bestTarget = id;
              break;
            }
          }
        }

        if (bestTarget) {
          return {
            type: 'activate-effect',
            cardInstanceId: card.instanceId,
            effectId: effect.id,
          };
        }
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

    // Dynamic game-state-aware priority scoring
    const phase = getGamePhase(state);
    const opponentState = state.players[getOpponent(player)];
    const kingdomCharCount = playerState.kingdom.filter((id) => {
      const d = getCardDefForInstance(state, id);
      return d.cardType === 'character';
    }).length;
    let priority = 5;

    if (def.id === 'S0040') {
      // Bounty Board: high value when hand is small
      priority = playerState.hand.length <= 4 ? 10 : 7;
    } else if (def.id === 'S0038') {
      // Secret Meeting: great when kingdom is empty
      priority = kingdomCharCount <= 2 ? 9 : 6;
    } else if (def.id === 'S0039') {
      // Reaped Fear: good early, less valuable late
      priority = phase === 'early' ? 8 : phase === 'mid' ? 6 : 4;
      const opChars = [...opponentState.kingdom, ...opponentState.battlefield].filter((id) => {
        const d = getCardDefForInstance(state, id);
        return d.cardType === 'character';
      }).length;
      if (opChars <= 1) priority -= 2;
    } else if (def.id === 'S0041') {
      // Hard Decision: good if opponent near winning + we have expendable chars
      const cheapChars = playerState.kingdom.filter((id) => {
        const d = getCardDefForInstance(state, id);
        if (d.cardType !== 'character') return false;
        return (d as CharacterCardDef).turnCost === 0;
      });
      if (opponentState.battleRewards.length >= 8 && cheapChars.length > 0) {
        priority = 9;
      } else if (cheapChars.length > 2) {
        priority = 6;
      } else {
        priority = 2;
      }
    } else if (def.id === 'S0043') {
      // Heavy Storm: good when opponent has essence
      const opEss = opponentState.essence.length;
      priority = opEss >= 3 ? 7 : opEss >= 1 ? 5 : 2;
    } else if (def.id === 'S0042') {
      // Oceanic Abyss: strong early/mid, less late
      priority = phase === 'late' ? 5 : 8;
    } else if (def.id === 'S0044') {
      // Unknown Pathway: only play if field has terra and deck has 3+ cards
      if (!fieldHasSymbol(state, player, 'terra')) continue;
      if (state.players[player].deck.length < 3) continue;
      priority = playerState.hand.length <= 4 ? 8 : 6;
    } else if (def.id === 'S0037') {
      // Dangerous Waters: good if Sea Monster in essence
      const hasSeaMonster = playerState.essence.some((id) => {
        const d = getCardDefForInstance(state, id);
        if (d.cardType !== 'character') return false;
        return (d as CharacterCardDef).characteristics.includes('sea monster');
      });
      priority = hasSeaMonster ? 7 : 1;
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
  const ps = state.players[player];
  const hand = ps.hand;

  // Hard guards
  if (hand.length <= 3) return null;
  if (ps.essence.length >= 6) return null;

  // Essence in this game only pays ability essence-costs. Before recommending
  // a charge, check if the player actually benefits from more essence.
  //
  // Count ability cards in hand/deck and highest essence cost seen.
  const essenceCostTotal = (ec: { specific?: { count: number }[]; neutral?: number } | undefined): number => {
    if (!ec) return 0;
    const specific = (ec.specific ?? []).reduce((sum, s) => sum + (s.count || 0), 0);
    return specific + (ec.neutral ?? 0);
  };

  let abilityCount = 0;
  let maxAbilityEssenceCost = 0;
  const checkAbility = (id: string) => {
    try {
      const def = getCardDefForInstance(state, id);
      if (def.cardType === 'ability') {
        abilityCount++;
        const total = essenceCostTotal((def as AbilityCardDef).essenceCost);
        if (total > maxAbilityEssenceCost) maxAbilityEssenceCost = total;
      }
      // Characters/fields/strategies may have activate effects with essence costs
      if (def.cardType === 'character' || def.cardType === 'field' || def.cardType === 'strategy') {
        const effects = (def as { effects?: { essenceCost?: { specific?: { count: number }[]; neutral?: number } }[] }).effects ?? [];
        for (const eff of effects) {
          const total = essenceCostTotal(eff.essenceCost);
          if (total > 0 && total > maxAbilityEssenceCost) maxAbilityEssenceCost = total;
        }
      }
    } catch { /* ignore */ }
  };
  for (const id of hand) checkAbility(id);
  for (const id of ps.deck) checkAbility(id);
  for (const id of ps.kingdom) checkAbility(id);
  for (const id of ps.battlefield) checkAbility(id);

  // Essence is wasted if no abilities exist and we're not overflowing the hand limit.
  const overflowing = hand.length >= 7;
  const needsMoreEssence = ps.essence.length < maxAbilityEssenceCost;

  if (!overflowing && (abilityCount === 0 || !needsMoreEssence)) {
    return null;
  }

  // Count copies of each card in hand for duplicate scoring
  const cardCounts: Record<string, number> = {};
  for (const id of hand) {
    const def = getCardDefForInstance(state, id);
    cardCounts[def.id] = (cardCounts[def.id] || 0) + 1;
  }

  // Score every hand card
  const scored = hand.map((id) => {
    let value = cardValue(state, id);
    const def = getCardDefForInstance(state, id);

    // Playability: turn cost too high → less valuable in hand
    if (def.cardType === 'character') {
      const cd = def as CharacterCardDef;
      if (cd.turnCost > ps.turnMarker + 2) value *= 0.5;
      // Unique already in play → worthless
      if (cd.characteristics.includes('unique')) {
        const inPlay = [...ps.kingdom, ...ps.battlefield].some((kid) => {
          const kd = getCardDefForInstance(state, kid);
          return kd.printNumber === cd.printNumber;
        });
        if (inPlay) value = 0;
      }
    }

    // Duplicate discount
    const copies = cardCounts[def.id] || 1;
    if (copies >= 3) value *= 0.4;
    else if (copies >= 2) value *= 0.6;

    // Abilities without essence to pay → less useful
    if (def.cardType === 'ability' && ps.essence.length < 2) value *= 0.7;

    return { id, value };
  });

  scored.sort((a, b) => a.value - b.value);

  // Charge if we need essence for abilities OR we're over hand limit
  const lowest = scored[0];
  if (overflowing || (abilityCount > 0 && needsMoreEssence && lowest.value < 5)) {
    return { type: 'charge-essence', cardInstanceIds: [lowest.id] };
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

  // If all teams are solo (1 character each) and we have 2+ characters,
  // this is likely the initial auto-created solo teams — fall through to
  // reorganization logic so the AI can combine characters into multi-member teams.
  const allSolo = existingTeams.length >= 2 && existingTeams.every((t) => t.characterIds.length === 1);

  if (existingTeams.length > 0 && !allSolo) {
    // Teams already organized (multi-member) — choose battle or end
    if (state.turnNumber === 0) {
      return { type: 'choose-battle-or-end', choice: 'end' };
    }

    const hasCharacters = existingTeams.some((t) =>
      t.characterIds.some((id) => {
        const card = getCard(state, id);
        return card && (card.zone === 'kingdom' || card.zone === 'battlefield');
      })
    );
    if (!hasCharacters) {
      return { type: 'choose-battle-or-end', choice: 'end' };
    }

    // Compare our total team power vs opponent's
    const opponent = getOpponent(player);
    const opponentTeams = Object.values(state.teams).filter((t) => t.owner === opponent);

    let ourPower = 0;
    let opPower = 0;
    let ourMaxTeam = 0;
    for (const t of existingTeams) {
      const p = estimateTeamPower(state, t);
      ourPower += p;
      if (p > ourMaxTeam) ourMaxTeam = p;
    }
    for (const t of opponentTeams) {
      opPower += estimateTeamPower(state, t);
    }

    // Always battle if opponent is near winning (BR ≥ 8)
    const opponentBR = state.players[player].battleRewards.length; // our BR pile = opponent's earned
    if (opponentBR >= 8) {
      return { type: 'choose-battle-or-end', choice: 'battle' };
    }

    // Always battle if we have more teams than opponent can block (overflow = free BRs)
    if (existingTeams.length > opponentTeams.length + 1) {
      return { type: 'choose-battle-or-end', choice: 'battle' };
    }

    // Skip battle if significantly weaker and no strong team
    if (ourPower < opPower * 0.6 && ourMaxTeam < 5) {
      return { type: 'choose-battle-or-end', choice: 'end' };
    }

    return { type: 'choose-battle-or-end', choice: 'battle' };
  }

  const kingdom = getCardsInZone(state, player, 'kingdom').filter(
    (c) => c.state !== undefined // only characters
  );

  if (kingdom.length === 0) {
    return { type: 'choose-battle-or-end', choice: 'end' };
  }

  // Build team candidates and simulate each — pick the one with best resulting state
  const candidates = generateTeamCandidates(state, player, kingdom);

  const baseEval = evaluateBoard(state, player);
  let bestTeams = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const action: PlayerAction = {
      type: 'organize-teams',
      teams: candidate.map((t) => ({
        leadId: t[0],
        supportIds: t.slice(1),
      })),
    };

    const simulated = simulateAction(state, player, action);
    if (!simulated) continue;

    // Score = evaluateBoard delta + team power distribution bonus
    let score = evaluateBoard(simulated, player) - baseEval;

    // Bonus: favor having at least one strong team (>= 5 power for 5+ BR threshold)
    let hasStrongTeam = false;
    const simTeams = Object.values(simulated.teams).filter((t) => t.owner === player);
    for (const t of simTeams) {
      const p = estimateTeamPower(simulated, t);
      if (p >= 5) hasStrongTeam = true;
    }
    if (hasStrongTeam) score += 0.8;

    // Penalize too many solo teams if we have 4+ chars (usually inefficient)
    if (kingdom.length >= 4 && simTeams.length === kingdom.length) score -= 1;

    if (score > bestScore) {
      bestScore = score;
      bestTeams = candidate;
    }
  }

  return {
    type: 'organize-teams',
    teams: bestTeams.map((t) => ({
      leadId: t[0],
      supportIds: t.slice(1),
    })),
  };
}

/**
 * Generate candidate team arrangements for simulation comparison.
 * Returns up to 5 distinct arrangements covering common strategies.
 */
function generateTeamCandidates(
  state: GameState,
  player: PlayerId,
  characters: CardInstance[],
): string[][][] {
  const candidates: string[][][] = [];

  // Candidate 1: synergy-based (current heuristic)
  candidates.push(buildTeams(state, player, characters));

  // Candidate 2: all chars in one team (if ≤ 3)
  if (characters.length <= 3) {
    const sorted = [...characters].sort((a, b) => {
      const aStats = getEffectiveStats(state, a.instanceId);
      const bStats = getEffectiveStats(state, b.instanceId);
      return bStats.lead - aStats.lead;
    });
    candidates.push([sorted.map((c) => c.instanceId)]);
  }

  // Candidate 3: stacked — best leader gets 2 best supports
  if (characters.length >= 3) {
    const sorted = [...characters].sort((a, b) => {
      const aStats = getEffectiveStats(state, a.instanceId);
      const bStats = getEffectiveStats(state, b.instanceId);
      return bStats.lead - aStats.lead;
    });
    const stacked: string[][] = [sorted.slice(0, 3).map((c) => c.instanceId)];
    // Remaining chars each get their own solo team
    for (let i = 3; i < sorted.length; i++) {
      stacked.push([sorted[i].instanceId]);
    }
    candidates.push(stacked);
  }

  // Candidate 4: all solo teams (useful when few chars with unique effects)
  if (characters.length >= 2 && characters.length <= 5) {
    candidates.push(characters.map((c) => [c.instanceId]));
  }

  // Candidate 5: 3-team split for 4-6 characters (wider coverage)
  if (characters.length >= 4 && characters.length <= 6) {
    const sorted = [...characters].sort((a, b) => {
      const aStats = getEffectiveStats(state, a.instanceId);
      const bStats = getEffectiveStats(state, b.instanceId);
      return bStats.lead - aStats.lead;
    });
    // Top-3 as leads, rest distributed by lead stat (reverse-sorted → strong supports to weaker leads)
    const numLeads = Math.min(3, sorted.length);
    const teams: string[][] = sorted.slice(0, numLeads).map((c) => [c.instanceId]);
    const supports = sorted.slice(numLeads);
    // Distribute supports evenly (round-robin starting from strongest support → weakest leader)
    for (let i = 0; i < supports.length; i++) {
      const teamIdx = (numLeads - 1) - (i % numLeads);
      if (teams[teamIdx].length < 3) teams[teamIdx].push(supports[i].instanceId);
    }
    candidates.push(teams);
  }

  // Deduplicate by serialized team layout
  const seen = new Set<string>();
  const unique: string[][][] = [];
  for (const c of candidates) {
    // Normalize: sort within teams and sort teams by first member
    const normalized = c.map((t) => [...t].sort()).sort((a, b) => a[0].localeCompare(b[0]));
    const key = normalized.map((t) => t.join(',')).join('|');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  return unique;
}

function buildTeams(
  state: GameState,
  player: PlayerId,
  characters: CardInstance[]
): string[][] {
  if (characters.length <= 3) {
    // Small board: one team, best lead first
    const sorted = [...characters].sort((a, b) => {
      const aStats = getEffectiveStats(state, a.instanceId);
      const bStats = getEffectiveStats(state, b.instanceId);
      return bStats.lead - aStats.lead;
    });
    return [sorted.map((c) => c.instanceId)];
  }

  // Sort by lead value to pick leaders
  const sorted = [...characters].sort((a, b) => {
    const aStats = getEffectiveStats(state, a.instanceId);
    const bStats = getEffectiveStats(state, b.instanceId);
    return bStats.lead - aStats.lead;
  });

  // Pick top N as leaders (3 teams if 6+ chars, 2 if 4-5)
  const numTeams = characters.length >= 6 ? 3 : 2;
  const leaders = sorted.slice(0, numTeams);
  const remaining = sorted.slice(numTeams);

  const teams: string[][] = leaders.map((l) => [l.instanceId]);
  const assigned = new Set<string>(leaders.map((l) => l.instanceId));

  // Assign supports by synergy score with leader
  for (const support of remaining) {
    if (assigned.has(support.instanceId)) continue;

    const sDef = getCardDefForInstance(state, support.instanceId);
    const sStats = getEffectiveStats(state, support.instanceId);
    const sCharDef = sDef.cardType === 'character' ? (sDef as CharacterCardDef) : null;

    let bestTeamIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < teams.length; i++) {
      if (teams[i].length >= 3) continue;

      const leadId = teams[i][0];
      const leadDef = getCardDefForInstance(state, leadId);
      const leadCharDef = leadDef.cardType === 'character' ? (leadDef as CharacterCardDef) : null;

      let synergy = sStats.support;

      // Shared attributes/characteristics bonus
      if (sCharDef && leadCharDef) {
        const sTraits = [...sCharDef.attributes, ...sCharDef.characteristics];
        const lTraits = [...leadCharDef.attributes, ...leadCharDef.characteristics];
        for (const trait of sTraits) {
          if (lTraits.includes(trait)) synergy += 1.5;
        }

        // Rosita C0086 bonus when teamed with Mercenary/Slayer
        if (sDef.id === 'C0086') {
          if (leadCharDef.attributes.includes('Mercenary') || leadCharDef.attributes.includes('Slayer')) synergy += 3;
        }
        if (leadDef.id === 'C0086') {
          if (sCharDef.attributes.includes('Mercenary') || sCharDef.attributes.includes('Slayer')) synergy += 3;
        }

        // Omtaba C0082 bonus when teamed with Slayer
        if (sDef.id === 'C0082' && leadCharDef.attributes.includes('Slayer')) synergy += 2;
        if (leadDef.id === 'C0082' && sCharDef.attributes.includes('Slayer')) synergy += 2;
      }

      if (synergy > bestScore) {
        bestScore = synergy;
        bestTeamIdx = i;
      }
    }

    teams[bestTeamIdx].push(support.instanceId);
    assigned.add(support.instanceId);
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

  const opponent = getOpponent(player);
  const opTeams = Object.values(state.teams).filter((t) => t.owner === opponent);
  const phase = getGamePhase(state);
  const ctx = getGameContext(state, player);
  const opModel = buildOpponentModel(state, player);

  // Score each team for attacking
  const teamScores = playerTeams.map((t) => {
    const power = estimateTeamPower(state, t);
    let attackValue = power;

    // Injured character risk
    for (const cid of t.characterIds) {
      const card = state.cards[cid];
      if (card?.state === 'injured') attackValue -= 1;
    }

    // Sent-to-attack trigger bonus
    for (const cid of t.characterIds) {
      const def = getCardDefForInstance(state, cid);
      if (def.cardType !== 'character') continue;
      const charDef = def as CharacterCardDef;
      if (charDef.effects.some((e) => e.type === 'trigger' && e.triggerCondition?.includes('sent-to-attack'))) {
        attackValue += 1.5;
      }
    }

    return { team: t, power, attackValue };
  }).filter((tp) => tp.power > 0);

  teamScores.sort((a, b) => b.attackValue - a.attackValue);

  // Stance-adjusted risk tolerance
  let winThreshold =
    ctx.stance === 'aggro' ? 0.55 :
    ctx.stance === 'defensive' ? 0.9 :
    ctx.stance === 'desperate' ? 1.2 :
    0.7;
  let maxAttackers =
    ctx.stance === 'defensive' ? Math.min(teamScores.length, 1) :
    Math.min(teamScores.length, 3);

  // Opponent model: if counter strategies likely, pull back from overcommitting
  if (opModel.likelyHasCounter) {
    winThreshold *= 1.1;        // require more margin to commit
    maxAttackers = Math.max(1, maxAttackers - 1); // send fewer teams — don't lose multiple to one counter
  }
  // Opponent has big affordable abilities → they'll pump a blocker; send stronger teams only
  if (opModel.maxAffordableAbilityCost >= 4) {
    winThreshold *= 1.05;
  }

  // Overflow strategy: if we have more teams than opponent can block, send extras for free BRs
  const opBlockerCount = opTeams.length;
  const maxToSend = Math.min(maxAttackers, teamScores.length);

  // Evaluate: compare our weakest potential attacker vs opponent's strongest blocker
  const opBestPower = opTeams.length > 0
    ? Math.max(...opTeams.map((t) => estimateTeamPower(state, t)))
    : 0;

  const selected: string[] = [];
  for (const ts of teamScores) {
    if (selected.length >= maxToSend) break;

    // Skip weak teams that would lose unless we're overflowing
    if (ts.power < opBestPower && selected.length >= opBlockerCount) {
      // This would be an overflow team — free BR if unblocked, okay to send
      if (ctx.stance !== 'defensive') selected.push(ts.team.id);
    } else if (ts.power >= opBestPower * winThreshold || selected.length < opBlockerCount) {
      selected.push(ts.team.id);
    }
  }

  // Desperate: attack with everything — we need to stop the opponent's snowball
  if (ctx.stance === 'desperate' && selected.length === 0) {
    for (const ts of teamScores.slice(0, 3)) selected.push(ts.team.id);
  }

  // Late game: always send at least one team (unless defensive)
  if (selected.length === 0 && phase === 'late' && teamScores.length > 0 && ctx.stance !== 'defensive') {
    selected.push(teamScores[0].team.id);
  }

  // Simulation re-scoring (MCTS-lite): consider alternative attack compositions
  // and let the game engine's real simulation adjudicate between them.
  const alternatives: string[][] = [];
  alternatives.push([...selected]); // current heuristic pick
  // Go-wide: send all positive-power teams
  alternatives.push(teamScores.map((ts) => ts.team.id));
  // Go-narrow: send only the strongest team
  if (teamScores.length > 0) alternatives.push([teamScores[0].team.id]);
  // Conservative: no attackers
  alternatives.push([]);

  // Deduplicate by serialized ID list
  const dedup = new Map<string, string[]>();
  for (const alt of alternatives) {
    const key = [...alt].sort().join('|');
    if (!dedup.has(key)) dedup.set(key, alt);
  }

  const baseEval = evaluateBoard(state, player);
  let bestTeams = selected;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [, altTeams] of dedup) {
    const action: PlayerAction = { type: 'select-attackers', teamIds: altTeams };
    const simulated = simulateAction(state, player, action);
    if (!simulated) continue;

    let altScore = evaluateBoard(simulated, player) - baseEval;

    // Stance-adjusted preference: defensive penalizes attacking, aggro rewards it
    if (ctx.stance === 'defensive' && altTeams.length > 0) altScore -= 0.5;
    if (ctx.stance === 'aggro' && altTeams.length > 0) altScore += 0.3;
    // Desperate: must attack (empty selection heavily penalized)
    if (ctx.stance === 'desperate' && altTeams.length === 0) altScore -= 3;

    if (altScore > bestScore) {
      bestScore = altScore;
      bestTeams = altTeams;
    }
  }

  return { type: 'select-attackers', teamIds: bestTeams };
}

function decideBlockers(state: GameState, player: PlayerId): PlayerAction {
  const opponent = getOpponent(player);

  const attackingTeams = Object.values(state.teams).filter(
    (t) => t.owner === opponent && t.isAttacking
  );

  const ourTeams = Object.values(state.teams).filter(
    (t) => t.owner === player && !t.isAttacking && !t.isBlocking
  );

  if (ourTeams.length === 0 || attackingTeams.length === 0) {
    return { type: 'select-blockers', assignments: [] };
  }

  const ctx = getGameContext(state, player);
  const opModel = buildOpponentModel(state, player);
  // When defensive/desperate, unblocked damage costs more (we can't afford BRs).
  // When aggro, let weak chip damage through — we're winning the race.
  let unblockedMult =
    ctx.stance === 'desperate' ? 2.0 :
    ctx.stance === 'defensive' ? 1.5 :
    ctx.stance === 'aggro' ? 0.8 :
    1.0;
  // When defensive, a losing trade is still better than unblocked damage.
  let losingTradeMult =
    ctx.stance === 'desperate' ? 0.6 :
    ctx.stance === 'defensive' ? 0.75 :
    1.0;

  // Opponent model adjustments:
  // If opponent has big affordable abilities, they can pump attackers in EOA —
  // blocking becomes more urgent (unblocked = extra damage from ability boost).
  if (opModel.maxAffordableAbilityCost >= 4) unblockedMult *= 1.15;
  // If likely counter, losing a trade is worse (lose the trade + eat a counter)
  if (opModel.likelyHasCounter) losingTradeMult *= 1.1;

  // Score the damage of an unblocked attacker
  function unblockedDamage(attacker: Team): number {
    const power = calculateTeamPower(state, attacker);
    return (power >= 5 ? 6 : 3) * unblockedMult;
  }

  // Score for a blocker-vs-attacker matchup (lower = better for us)
  function matchupDamage(blocker: Team, attacker: Team): number {
    const bPower = estimateTeamPower(state, blocker);
    const aPower = calculateTeamPower(state, attacker);
    if (bPower > aPower) return 0;       // we win
    if (bPower === aPower) return 1;     // stalemate
    // we lose — how bad?
    const base = aPower >= 5 ? 4 : 2;
    return base * losingTradeMult;
  }

  // Brute-force: for each attacker, try each blocker or "unblocked"
  // Max combinations: (blockers+1)^attackers — typically ≤ 64
  const attackerCount = attackingTeams.length;
  const blockerCount = ourTeams.length;

  // Generate all possible assignment combos
  // For each attacker: assign blocker index 0..blockerCount-1, or -1 for unblocked
  const options = blockerCount + 1; // +1 for "no blocker"
  const totalCombos = Math.pow(options, attackerCount);

  // Cap at reasonable number to prevent lag
  if (totalCombos > 256) {
    // Fall back to greedy for large boards
    return greedyBlock(state, attackingTeams, ourTeams);
  }

  // Pass 1: heuristic scoring — collect all valid assignments with their damage
  interface ScoredAssignment {
    assignment: number[];
    heuristicDamage: number;
  }
  const scored: ScoredAssignment[] = [];

  for (let combo = 0; combo < totalCombos; combo++) {
    const assignment: number[] = [];
    let temp = combo;
    const usedBlockers = new Set<number>();
    let valid = true;

    for (let a = 0; a < attackerCount; a++) {
      const blockerIdx = (temp % options) - 1; // -1 = unblocked, 0..n = blocker index
      temp = Math.floor(temp / options);

      if (blockerIdx >= 0) {
        if (blockerIdx >= blockerCount || usedBlockers.has(blockerIdx)) {
          valid = false;
          break;
        }
        usedBlockers.add(blockerIdx);
      }
      assignment.push(blockerIdx);
    }

    if (!valid) continue;

    // Score this assignment
    let totalDamage = 0;
    for (let a = 0; a < attackerCount; a++) {
      if (assignment[a] === -1) {
        totalDamage += unblockedDamage(attackingTeams[a]);
      } else {
        totalDamage += matchupDamage(ourTeams[assignment[a]], attackingTeams[a]);
      }
    }

    scored.push({ assignment, heuristicDamage: totalDamage });
  }

  if (scored.length === 0) {
    return { type: 'select-blockers', assignments: [] };
  }

  // Pass 2: Simulation re-scoring (MCTS-lite).
  // Take top-K candidates by heuristic, simulate each blocker assignment,
  // score the resulting state with evaluateBoard. Pick best by combined score.
  scored.sort((a, b) => a.heuristicDamage - b.heuristicDamage);
  const topK = Math.min(5, scored.length);
  const candidates = scored.slice(0, topK);

  const makeAssignmentPayload = (assignment: number[]) => {
    const payload: { blockingTeamId: string; attackingTeamId: string }[] = [];
    for (let a = 0; a < attackerCount; a++) {
      if (assignment[a] >= 0) {
        payload.push({
          blockingTeamId: ourTeams[assignment[a]].id,
          attackingTeamId: attackingTeams[a].id,
        });
      }
    }
    return payload;
  };

  const baseEval = evaluateBoard(state, player);
  let bestAssignment = candidates[0].assignment;
  let bestCombinedScore = Number.NEGATIVE_INFINITY;

  for (const cand of candidates) {
    const payload = makeAssignmentPayload(cand.assignment);
    const action: PlayerAction = { type: 'select-blockers', assignments: payload };

    // Simulate just the select-blockers action — evaluates immediate state
    // after triggers (sent-to-battle etc.) resolve. More accurate than heuristic
    // because it reflects real game engine effects.
    const simulated = simulateAction(state, player, action);
    let simEval: number;
    if (simulated) {
      simEval = evaluateBoard(simulated, player);
    } else {
      // Simulation failed — fall back to heuristic-only
      simEval = baseEval - cand.heuristicDamage * 0.3;
    }

    // Combined: simulation delta is primary, heuristic as tiebreaker
    const combined = (simEval - baseEval) - cand.heuristicDamage * 0.15;

    if (combined > bestCombinedScore) {
      bestCombinedScore = combined;
      bestAssignment = cand.assignment;
    }
  }

  return {
    type: 'select-blockers',
    assignments: makeAssignmentPayload(bestAssignment),
  };
}

function greedyBlock(
  state: GameState,
  attackingTeams: Team[],
  ourTeams: Team[]
): PlayerAction {
  const assignments: { blockingTeamId: string; attackingTeamId: string }[] = [];
  const availableBlockers = [...ourTeams];

  // Sort attackers by power descending — block strongest first
  const sortedAttackers = [...attackingTeams].sort(
    (a, b) => calculateTeamPower(state, b) - calculateTeamPower(state, a)
  );

  for (const attacker of sortedAttackers) {
    if (availableBlockers.length === 0) break;
    const attackPower = calculateTeamPower(state, attacker);

    // Find cheapest blocker that can win or stalemate
    let bestBlocker: { team: Team; power: number } | null = null;
    for (const blocker of availableBlockers) {
      const blockPower = estimateTeamPower(state, blocker);
      if (blockPower >= attackPower && (!bestBlocker || blockPower < bestBlocker.power)) {
        bestBlocker = { team: blocker, power: blockPower };
      }
    }

    // Sacrificial block for outstanding BR threats
    if (!bestBlocker && attackPower >= 5) {
      // Pick weakest blocker as sacrifice
      let weakest: { team: Team; power: number } | null = null;
      for (const blocker of availableBlockers) {
        const p = estimateTeamPower(state, blocker);
        if (!weakest || p < weakest.power) weakest = { team: blocker, power: p };
      }
      bestBlocker = weakest;
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

  // Collect all valid ability plays with scores
  interface AbilityCandidate {
    cardId: string;
    userId: string;
    targetIds?: string[];
    essenceCardIds: string[];
    xValue?: number;
    score: number;
  }
  const candidates: AbilityCandidate[] = [];

  for (const cardId of hand) {
    const def = getCardDefForInstance(state, cardId);
    if (def.cardType !== 'ability') continue;

    const abilityDef = def as AbilityCardDef;

    // Find ALL valid users on our battlefield (not just the first)
    const validUsers = battlefield.filter((c) => {
      if (c.state === 'injured') return false;
      const cDef = getCardDefForInstance(state, c.instanceId) as CharacterCardDef;
      return abilityDef.requirements.every((req) => {
        if (req.type === 'attribute') return cDef.attributes.includes(req.value);
        if (req.type === 'turn-cost-min') return cDef.turnCost >= parseInt(req.value, 10);
        return true;
      });
    });

    if (validUsers.length === 0) continue;

    // Check essence cost
    const canPayEssence = checkEssenceCost(state, player, abilityDef);
    if (!canPayEssence.canPay) continue;

    // Card-specific pre-play checks
    if (def.id === 'A0035') {
      if (state.players[opponent].essence.length === 0) continue;
    }

    // Try each valid user
    for (const validUser of validUsers) {
      // Find target (opposing characters)
      let targetIds: string[] | undefined;
      if (abilityDef.targetDescription?.includes('opposing')) {
        const userTeam = Object.values(state.teams).find((t) => t.characterIds.includes(validUser.instanceId));
        if (!userTeam) continue;

        let opposingTeam: typeof userTeam | undefined;
        if (userTeam.isAttacking && userTeam.blockedByTeamId) {
          opposingTeam = state.teams[userTeam.blockedByTeamId];
        } else if (userTeam.isBlocking && userTeam.blockingTeamId) {
          opposingTeam = state.teams[userTeam.blockingTeamId];
        }
        if (!opposingTeam) continue;

        const opposingChars = opposingTeam.characterIds.filter(
          (id) => state.cards[id]?.zone === 'battlefield'
        );
        if (opposingChars.length === 0) continue;

        // Target the strongest opposing character
        const sorted = [...opposingChars].sort((a, b) => {
          const aStats = getEffectiveStats(state, a);
          const bStats = getEffectiveStats(state, b);
          return bStats.lead - aStats.lead;
        });
        targetIds = [sorted[0]];
      }

      // Card-specific post-target checks
      if (def.id === 'A0039' && targetIds && targetIds.length > 0) {
        const userStats = getEffectiveStats(state, validUser.instanceId);
        const targetStats = getEffectiveStats(state, targetIds[0]);
        if (targetStats.lead >= userStats.lead) continue;
      }

      // Score this ability play by estimated impact
      let score = 0;
      const userStats = getEffectiveStats(state, validUser.instanceId);

      if (def.id === 'A0039') {
        // Torrential Sludge — removal
        score = 7;
        if (targetIds && targetIds.length > 0) {
          const tStats = getEffectiveStats(state, targetIds[0]);
          score += tStats.lead * 0.5; // better against strong targets
        }
      } else if (def.id === 'A0040') {
        // Micromon Rage — stat doubling
        score = userStats.lead * 1.5;
      } else if (def.id === 'A0035') {
        // Aquabatics — essence disruption
        score = 3;
        // Extra value if their essence loss could swing the BR race
        const opBR = state.players[player].battleRewards.length; // opponent's earned BRs (on our side)
        if (opBR >= 6) score += 3;
      } else if (def.id === 'A0038') {
        // Swift Strike — pre-showdown damage vs injured target
        if (targetIds && targetIds.length > 0) {
          const target = state.cards[targetIds[0]];
          score = target?.state === 'injured' ? 8 : 5;
        } else {
          score = 5;
        }
      } else if (def.id === 'A0037') {
        // Deflection — defensive buff
        score = 6;
        // Extra if user is team lead
        const userTeam = Object.values(state.teams).find((t) => t.characterIds[0] === validUser.instanceId);
        if (userTeam && userTeam.hasLead) score += 2;
      } else if (def.id === 'A0036') {
        // Stake Gun — variable damage
        score = 4 + canPayEssence.cardIds.length * 0.5;
      } else {
        // Generic ability
        score = 4 + abilityDef.effects.length;
      }

      // Penalize by essence cost (opportunity cost of spending essence)
      score -= canPayEssence.cardIds.length * 0.3;

      const xValue = abilityDef.essenceCost.x
        ? Math.max(0, canPayEssence.cardIds.length - abilityDef.essenceCost.specific.reduce((s, c) => s + c.count, 0) - abilityDef.essenceCost.neutral - (abilityDef.essenceCost.cardSymbol ?? 0))
        : undefined;

      // Simulation term — add board-eval delta as a secondary signal
      try {
        const simScore = scoreAction(state, player, {
          type: 'play-ability',
          cardInstanceId: cardId,
          userId: validUser.instanceId,
          targetIds,
          essenceCostCardIds: canPayEssence.cardIds,
          xValue,
        });
        if (Number.isFinite(simScore)) {
          score += simScore * 0.3;
        }
      } catch { /* ignore sim failures */ }

      candidates.push({
        cardId,
        userId: validUser.instanceId,
        targetIds,
        essenceCardIds: canPayEssence.cardIds,
        xValue,
        score,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Sort by current single-ability score
  candidates.sort((a, b) => b.score - a.score);

  // Phase 8: combo-aware lookahead.
  // For the top candidates, simulate the play and check whether a follow-up
  // ability play is also possible afterward (e.g., buff → damage, Spike activate
  // → another ability, Swift Strike on injured target → second ability combo).
  // Add the follow-up's board-delta as a combo bonus.
  const topK = Math.min(3, candidates.length);
  const comboScores = new Map<number, number>(); // candidate index → combo bonus

  for (let i = 0; i < topK; i++) {
    const cand = candidates[i];
    const action: PlayerAction = {
      type: 'play-ability',
      cardInstanceId: cand.cardId,
      userId: cand.userId,
      targetIds: cand.targetIds,
      essenceCostCardIds: cand.essenceCardIds,
      xValue: cand.xValue,
    };

    const afterFirst = simulateAction(state, player, action);
    if (!afterFirst) continue;

    // In simulation, the chain has the ability + opponent gets priority.
    // Skip if chain is still unresolved or pending interactive prompts.
    if (
      afterFirst.pendingOptionalEffect ||
      afterFirst.pendingTargetChoice ||
      afterFirst.pendingSearch
    ) continue;

    // Recursively check if ANOTHER ability can be played after chain resolves.
    // Simulate opponent passing, chain resolving, then back to us.
    let advanced: GameState | null = afterFirst;
    // Try to advance priority a couple times (opponent may need to pass first)
    for (let step = 0; step < 3; step++) {
      if (!advanced) break;
      if (advanced.chain.length === 0) break;
      const priorityP = advanced.priorityPlayer ?? advanced.currentTurn;
      const next: GameState | null = simulateAction(advanced, priorityP, { type: 'pass-priority' });
      if (!next) break;
      advanced = next;
    }

    if (!advanced) continue;

    // Find best follow-up ability play from the advanced state.
    // Recursion-lite: we don't call chooseAbility recursively (would infinite-loop),
    // just search hand for another playable ability with matching user + essence.
    const baseEval = evaluateBoard(afterFirst, player);
    let bestComboBonus = 0;

    const followHand = advanced.players[player].hand;
    for (const fid of followHand) {
      let fdef;
      try { fdef = getCardDefForInstance(advanced, fid); } catch { continue; }
      if (fdef.cardType !== 'ability') continue;
      const fAbility = fdef as AbilityCardDef;

      // Quick playability check
      const followUsers = getCardsInZone(advanced, player, 'battlefield').filter((c) => {
        if (c.state === 'injured') return false;
        const cDef = getCardDefForInstance(advanced, c.instanceId) as CharacterCardDef;
        return fAbility.requirements.every((req) => {
          if (req.type === 'attribute') return cDef.attributes.includes(req.value);
          if (req.type === 'turn-cost-min') return cDef.turnCost >= parseInt(req.value, 10);
          return true;
        });
      });
      if (followUsers.length === 0) continue;

      const followPay = checkEssenceCost(advanced, player, fAbility);
      if (!followPay.canPay) continue;

      // Pick first valid user + simple target (opposing char if needed)
      const followUser = followUsers[0];
      let followTargetIds: string[] | undefined;
      if (fAbility.targetDescription?.includes('opposing')) {
        const uTeam = Object.values(advanced.teams).find((t) =>
          t.characterIds.includes(followUser.instanceId),
        );
        if (!uTeam) continue;
        let opposing: typeof uTeam | undefined;
        if (uTeam.isAttacking && uTeam.blockedByTeamId) {
          opposing = advanced.teams[uTeam.blockedByTeamId];
        } else if (uTeam.isBlocking && uTeam.blockingTeamId) {
          opposing = advanced.teams[uTeam.blockingTeamId];
        }
        if (!opposing) continue;
        const chars = opposing.characterIds.filter(
          (id) => advanced.cards[id]?.zone === 'battlefield',
        );
        if (chars.length === 0) continue;
        followTargetIds = [chars[0]];
      }

      const followXValue = fAbility.essenceCost.x
        ? Math.max(0, followPay.cardIds.length -
            fAbility.essenceCost.specific.reduce((s, c) => s + c.count, 0) -
            fAbility.essenceCost.neutral -
            (fAbility.essenceCost.cardSymbol ?? 0))
        : undefined;

      const followAction: PlayerAction = {
        type: 'play-ability',
        cardInstanceId: fid,
        userId: followUser.instanceId,
        targetIds: followTargetIds,
        essenceCostCardIds: followPay.cardIds,
        xValue: followXValue,
      };

      const afterSecond = simulateAction(advanced, player, followAction);
      if (!afterSecond) continue;

      const comboDelta = evaluateBoard(afterSecond, player) - baseEval;
      if (comboDelta > bestComboBonus) {
        bestComboBonus = comboDelta;
      }
    }

    if (bestComboBonus > 0) {
      // Combo discount: follow-up needs opponent not to counter — not guaranteed
      comboScores.set(i, bestComboBonus * 0.7);
    }
  }

  // Apply combo bonuses and re-rank
  for (let i = 0; i < candidates.length; i++) {
    const bonus = comboScores.get(i) ?? 0;
    candidates[i].score += bonus;
  }
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];

  return {
    type: 'play-ability',
    cardInstanceId: best.cardId,
    userId: best.userId,
    targetIds: best.targetIds,
    essenceCostCardIds: best.essenceCardIds,
    xValue: best.xValue,
  };
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

  // Pay cardSymbol costs (any of the ability card's symbols)
  const cardSymbolCount = abilityDef.essenceCost.cardSymbol ?? 0;
  for (let i = 0; i < cardSymbolCount; i++) {
    const matching = essence.find(
      (id) => !toPay.includes(id) && abilityDef.symbols.some(sym => cardHasSymbol(state, id, sym))
    );
    if (!matching) return { canPay: false, cardIds: [] };
    toPay.push(matching);
  }

  // Pay neutral (base cost + X if applicable)
  const baseNeutral = abilityDef.essenceCost.neutral;
  const xExtra = abilityDef.essenceCost.x
    ? Math.min(2, essence.length - toPay.length - baseNeutral) // For X costs, pay 2 extra if we can
    : 0;
  const neutralNeeded = baseNeutral + Math.max(0, xExtra);

  for (let i = 0; i < neutralNeeded; i++) {
    const available = essence.find((id) => !toPay.includes(id));
    if (!available) {
      if (i >= baseNeutral && abilityDef.essenceCost.x) break; // X part can be 0, but base is required
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
  const ps = state.players[player];
  const hand = ps.hand;
  const phase = getGamePhase(state);
  const ctx = getGameContext(state, player);

  if (hand.length > 7) {
    // Pre-compute print-number counts in hand (for duplicate detection)
    const handPrintCounts = new Map<string, number>();
    for (const id of hand) {
      const d = getCardDefForInstance(state, id);
      handPrintCounts.set(d.printNumber, (handPrintCounts.get(d.printNumber) ?? 0) + 1);
    }

    // Identify what's already in play (for unique checks)
    const inPlayPrints = new Set<string>();
    for (const id of [...ps.kingdom, ...ps.battlefield]) {
      const d = getCardDefForInstance(state, id);
      inPlayPrints.add(d.printNumber);
    }

    // Turn-cost curve: how many affordable playable characters/strategies do we have?
    const affordablePlayables = hand.filter((id) => {
      const d = getCardDefForInstance(state, id);
      if (d.cardType === 'character') {
        return (d as CharacterCardDef).turnCost <= ps.turnMarker;
      }
      if (d.cardType === 'strategy') {
        return (d as StrategyCardDef).turnCost <= ps.turnMarker;
      }
      return false;
    }).length;
    const curveShortage = affordablePlayables <= 1; // scarce → protect cheap cards

    // Which essence symbols do we currently own?
    const ownedEssenceSymbols = new Set<string>();
    for (const eid of ps.essence) {
      const d = getCardDefForInstance(state, eid);
      for (const s of d.symbols) ownedEssenceSymbols.add(s);
    }

    const scored = hand.map((id) => {
      let value = cardValue(state, id);
      const def = getCardDefForInstance(state, id);
      const dupCount = handPrintCounts.get(def.printNumber) ?? 1;

      // Duplicate handling in hand
      if (dupCount >= 3) value -= 2;
      else if (dupCount === 2) value -= 0.5;

      // Playability penalty: turn cost too far out
      if (def.cardType === 'character') {
        const cd = def as CharacterCardDef;
        const turnsAway = cd.turnCost - ps.turnMarker;
        if (turnsAway >= 3) value *= 0.3;      // won't play soon
        else if (turnsAway === 2) value *= 0.6; // a couple turns out
        else if (turnsAway <= 0) value *= 1.2;  // affordable now: protect it

        // Unique already in play → nearly worthless
        if (cd.characteristics.includes('unique') && inPlayPrints.has(cd.printNumber)) {
          value = 0.1;
        }
        // Unique with duplicate in hand → extra copy is wasted
        if (cd.characteristics.includes('unique') && dupCount >= 2) {
          value -= 1.5;
        }

        // No matching symbols anywhere (essence + hand) → can't cast solo
        if (cd.handCost > 0) {
          const anyMatchInHand = hand.some((oid) => {
            if (oid === id) return false;
            const od = getCardDefForInstance(state, oid);
            return cd.symbols.some((s) => od.symbols.includes(s));
          });
          if (!anyMatchInHand) value *= 0.8;
        }
      }

      // Strategy: weight by affordability and counter-relevance
      if (def.cardType === 'strategy') {
        const sd = def as StrategyCardDef;
        const turnsAway = sd.turnCost - ps.turnMarker;
        if (turnsAway >= 2) value *= 0.5;
        else if (turnsAway === 1) value *= 0.75;

        // Counter strategies are only worth keeping if opponent is threatening
        if (sd.keywords.includes('counter') && ctx.oppBoardPower < 3) {
          value *= 0.5;
        }
        // Can't pay symbols? devalue
        const canPaySymbols = sd.symbols.length === 0 ||
          sd.symbols.some((s) => ownedEssenceSymbols.has(s));
        if (!canPaySymbols && ps.essence.length > 0) value *= 0.7;
      }

      // Abilities: without user characters, useless
      if (def.cardType === 'ability') {
        if (ps.kingdom.length === 0 && ps.battlefield.length === 0) value *= 0.3;
        if (ps.essence.length < 2) value *= 0.7;

        // Can't pay symbols → less useful
        const ad = def as AbilityCardDef;
        if (ad.essenceCost && ad.essenceCost.specific.length > 0) {
          const canPay = ad.essenceCost.specific.some((sc) =>
            ownedEssenceSymbols.has(sc.symbol),
          );
          if (!canPay && ps.essence.length > 0) value *= 0.6;
        }
      }

      // Curve protection: if we're starved for plays, boost cheap cards
      if (curveShortage && (def.cardType === 'character' || def.cardType === 'strategy')) {
        const tc = def.cardType === 'character'
          ? (def as CharacterCardDef).turnCost
          : (def as StrategyCardDef).turnCost;
        if (tc <= ps.turnMarker) value += 1.5;
      }

      // Phase weighting: late game prefers big swings, early prefers curve
      if (phase === 'late' && def.cardType === 'character') {
        const cd = def as CharacterCardDef;
        if (cd.healthyStats.lead >= 4) value += 1.5;
      }
      if (phase === 'early' && def.cardType === 'character') {
        const cd = def as CharacterCardDef;
        if (cd.turnCost <= 1) value += 1;
      }

      // Desperate stance: value immediate impact more
      if (ctx.stance === 'desperate') {
        if (def.cardType === 'character') {
          const cd = def as CharacterCardDef;
          if (cd.turnCost > ps.turnMarker) value *= 0.4; // can't play it in time
        }
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
