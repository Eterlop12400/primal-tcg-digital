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

// ============================================================
// Helper Functions — Board Evaluation & Utilities
// ============================================================

function getGamePhase(state: GameState): 'early' | 'mid' | 'late' {
  const maxTM = Math.max(state.players.player1.turnMarker, state.players.player2.turnMarker);
  if (maxTM <= 2) return 'early';
  if (maxTM <= 5) return 'mid';
  return 'late';
}

function cardValue(state: GameState, cardId: string): number {
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

function evaluateBoard(state: GameState, player: PlayerId): number {
  const ps = state.players[player];
  const opponent = getOpponent(player);
  const ops = state.players[opponent];
  let score = 0;

  // Character stats on board (kingdom + battlefield)
  const myChars = [...ps.kingdom, ...ps.battlefield];
  for (const id of myChars) {
    const card = state.cards[id];
    if (!card || card.state === undefined) continue; // not a character
    const stats = getEffectiveStats(state, id);
    const statScore = stats.lead * 2 + stats.support;
    score += card.state === 'injured' ? statScore * 0.6 : statScore;
  }

  // Essence count
  score += ps.essence.length * 0.8;

  // Hand size (diminishing returns above 5)
  score += Math.min(ps.hand.length, 5) * 0.5 + Math.max(0, ps.hand.length - 5) * 0.2;

  // Battle Reward differential (opponent BRs is good for us — we're winning)
  score += ops.battleRewards.length * 3.0;
  score -= ps.battleRewards.length * 3.0;

  // Turn marker advantage
  score += (ps.turnMarker - ops.turnMarker) * 0.5;

  // Deck-out danger
  if (ps.deck.length <= 5) score -= (6 - ps.deck.length) * 1.5;

  // Permanent strategies in play
  for (const id of ps.kingdom) {
    const def = getCardDefForInstance(state, id);
    if (def.cardType === 'strategy') score += 2;
  }

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
    } else if (def.cardType === 'strategy') {
      const sd = def as StrategyCardDef;
      score = sd.turnCost <= 2 ? 4 : 2;
    } else if (def.cardType === 'ability') {
      score = 2;
    }
    return { id: cardId, score };
  });

  // Check if we have any 0-cost characters
  const hasZeroCost = scored.some((s) => {
    const def = getCardDefForInstance(state, s.id);
    return def.cardType === 'character' && (def as CharacterCardDef).turnCost === 0;
  });

  scored.sort((a, b) => a.score - b.score);

  const cardsToReturn: string[] = [];

  if (!hasZeroCost) {
    // No early plays — return up to 3 lowest scored cards
    for (const s of scored) {
      if (cardsToReturn.length >= 3) break;
      if (s.score <= 3) cardsToReturn.push(s.id);
    }
  } else {
    // Have early plays — return high-cost clunkers (score ≤ 2, up to 2)
    const highCost = scored.filter((s) => s.score <= 2);
    if (highCost.length >= 3) {
      cardsToReturn.push(highCost[0].id, highCost[1].id);
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

  if (hand.length <= 3) return null;
  if (ps.essence.length >= 6) return null;

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

  // Charge the lowest-value card if it's low enough or hand is big
  const lowest = scored[0];
  if (lowest.value < 4 || hand.length > 5) {
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

  if (existingTeams.length > 0) {
    // Teams already organized — choose battle or end
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

  // Overflow strategy: if we have more teams than opponent can block, send extras for free BRs
  const opBlockerCount = opTeams.length;
  let maxToSend = Math.min(teamScores.length, 3);

  // If we can overflow, send at least opBlockerCount + 1
  if (teamScores.length > opBlockerCount) {
    maxToSend = Math.min(teamScores.length, 3);
  }

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
      selected.push(ts.team.id);
    } else if (ts.power >= opBestPower * 0.7 || selected.length < opBlockerCount) {
      selected.push(ts.team.id);
    }
  }

  // Late game: always send at least one team
  if (selected.length === 0 && phase === 'late' && teamScores.length > 0) {
    selected.push(teamScores[0].team.id);
  }

  return { type: 'select-attackers', teamIds: selected };
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

  // Score the damage of an unblocked attacker
  function unblockedDamage(attacker: Team): number {
    const power = calculateTeamPower(state, attacker);
    // Outstanding BR if power >= 5 → counts as extra bad
    return power >= 5 ? 6 : 3;
  }

  // Score for a blocker-vs-attacker matchup (lower = better for us)
  function matchupDamage(blocker: Team, attacker: Team): number {
    const bPower = estimateTeamPower(state, blocker);
    const aPower = calculateTeamPower(state, attacker);
    if (bPower > aPower) return 0;       // we win
    if (bPower === aPower) return 1;     // stalemate
    // we lose — how bad?
    return aPower >= 5 ? 4 : 2;
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

  let bestAssignment: number[] = new Array(attackerCount).fill(-1);
  let bestDamage = Infinity;

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

    if (totalDamage < bestDamage) {
      bestDamage = totalDamage;
      bestAssignment = assignment;
    }
  }

  const assignments: { blockingTeamId: string; attackingTeamId: string }[] = [];
  for (let a = 0; a < attackerCount; a++) {
    if (bestAssignment[a] >= 0) {
      assignments.push({
        blockingTeamId: ourTeams[bestAssignment[a]].id,
        attackingTeamId: attackingTeams[a].id,
      });
    }
  }

  return { type: 'select-blockers', assignments };
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

  // Pick the highest-scored ability
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

  if (hand.length > 7) {
    const scored = hand.map((id) => {
      let value = cardValue(state, id);
      const def = getCardDefForInstance(state, id);

      // Playability penalty: turn cost too far out
      if (def.cardType === 'character') {
        const cd = def as CharacterCardDef;
        if (cd.turnCost > ps.turnMarker + 2) value *= 0.5;
        // Unique already in play → discard it
        if (cd.characteristics.includes('unique')) {
          const inPlay = [...ps.kingdom, ...ps.battlefield].some((kid) => {
            const kd = getCardDefForInstance(state, kid);
            return kd.printNumber === cd.printNumber;
          });
          if (inPlay) value = 0;
        }
      }

      // Abilities without essence to pay
      if (def.cardType === 'ability' && ps.essence.length < 2) value *= 0.5;

      // Strategy too expensive
      if (def.cardType === 'strategy') {
        const sd = def as StrategyCardDef;
        if (sd.turnCost > ps.turnMarker + 1) value *= 0.6;
      }

      // Late game: high-impact cards are more valuable
      if (phase === 'late' && def.cardType === 'character') {
        const cd = def as CharacterCardDef;
        if (cd.healthyStats.lead >= 4) value += 2;
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
