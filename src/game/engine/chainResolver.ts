// ============================================================
// Chain Resolution — Resolves the chain stack (LIFO)
// ============================================================

import {
  GameState,
  ChainEntry,
  PlayerId,
  CharacterCardDef,
  StrategyCardDef,
} from '../types';
import {
  getCard,
  getCardDefForInstance,
  moveCard,
  addLog,
  getOpponent,
} from './utils';
import { executeEffect } from './effectExecutor';

export function resolveChain(state: GameState): void {
  if (state.chain.length === 0) return;

  state.isChainResolving = true;

  // Resolve in reverse order (LIFO — last in, first out)
  while (state.chain.length > 0) {
    const entry = state.chain[state.chain.length - 1];

    if (entry.resolved) {
      state.chain.pop();
      continue;
    }

    resolveChainEntry(state, entry);
    entry.resolved = true;
    state.chain.pop();
  }

  state.isChainResolving = false;

  // After chain resolves, check for pending triggers
  if (state.pendingTriggers.length > 0) {
    // Turn player's triggers first, then non-turn player's
    const turnPlayerTriggers = state.pendingTriggers.filter(
      (t) => t.owner === state.currentTurn
    );
    const nonTurnPlayerTriggers = state.pendingTriggers.filter(
      (t) => t.owner !== state.currentTurn
    );

    state.pendingTriggers = [];

    // Add them to a new chain
    for (const trigger of [...turnPlayerTriggers, ...nonTurnPlayerTriggers]) {
      state.chain.push(trigger);
    }

    // If new chain formed, it will need priority passes to resolve
    // For now, auto-resolve (will be interactive later)
    if (state.chain.length > 0) {
      resolveChain(state);
    }
  }

  // Turn player regains priority after chain resolves
  state.priorityPlayer = state.currentTurn;
  state.consecutivePasses = 0;
}

/**
 * Flush any pending triggers into the chain and resolve them.
 * Call this after non-chain events that can create triggers
 * (e.g. showdown damage discarding characters).
 */
export function flushPendingTriggers(state: GameState): void {
  if (state.pendingTriggers.length === 0) return;

  const turnPlayerTriggers = state.pendingTriggers.filter(
    (t) => t.owner === state.currentTurn
  );
  const nonTurnPlayerTriggers = state.pendingTriggers.filter(
    (t) => t.owner !== state.currentTurn
  );

  state.pendingTriggers = [];

  for (const trigger of [...turnPlayerTriggers, ...nonTurnPlayerTriggers]) {
    state.chain.push(trigger);
  }

  if (state.chain.length > 0) {
    resolveChain(state);
  }
}

function resolveChainEntry(state: GameState, entry: ChainEntry): void {
  // Check if negated
  if (entry.negated) {
    addLog(state, entry.owner, 'effect-negated', 'Effect was negated', entry.sourceCardInstanceId);
    handlePostResolution(state, entry);
    return;
  }

  switch (entry.type) {
    case 'summon':
      resolveSummon(state, entry);
      break;
    case 'strategy':
      resolveStrategy(state, entry);
      break;
    case 'ability':
      resolveAbility(state, entry);
      break;
    case 'activate-effect':
    case 'trigger-effect':
      resolveCardEffect(state, entry);
      break;
  }
}

function resolveSummon(state: GameState, entry: ChainEntry): void {
  const card = getCard(state, entry.sourceCardInstanceId);
  const def = getCardDefForInstance(state, entry.sourceCardInstanceId);

  // Move character from general play area to kingdom
  moveCard(state, entry.sourceCardInstanceId, 'kingdom');
  card.state = 'healthy';

  addLog(
    state,
    entry.owner,
    'summon-resolve',
    `${def.name} enters the Kingdom`,
    entry.sourceCardInstanceId
  );

  // Check for "put in play" triggers on the summoned character
  checkPutInPlayTriggers(state, entry.sourceCardInstanceId, entry.owner);
}

function resolveStrategy(state: GameState, entry: ChainEntry): void {
  const card = getCard(state, entry.sourceCardInstanceId);
  const def = getCardDefForInstance(state, entry.sourceCardInstanceId) as StrategyCardDef;

  // Execute the strategy's effect
  executeEffect(state, entry);

  // Determine where the strategy goes after resolving
  if (def.keywords.includes('permanent')) {
    // Move to kingdom
    moveCard(state, entry.sourceCardInstanceId, 'kingdom');

    // Add permanent counters if Permanent(X)
    if (def.permanentCount && def.permanentCount > 0) {
      for (let i = 0; i < def.permanentCount; i++) {
        card.counters.push({ type: 'permanent' });
      }
    }

    addLog(
      state,
      entry.owner,
      'strategy-permanent',
      `${def.name} enters the Kingdom as a Permanent${def.permanentCount ? `(${def.permanentCount})` : ''}`,
      entry.sourceCardInstanceId
    );
  } else {
    // Move to essence area
    moveCard(state, entry.sourceCardInstanceId, 'essence');
    addLog(
      state,
      entry.owner,
      'strategy-resolve',
      `${def.name} resolved → Essence Area`,
      entry.sourceCardInstanceId
    );
  }
}

function resolveAbility(state: GameState, entry: ChainEntry): void {
  const def = getCardDefForInstance(state, entry.sourceCardInstanceId);

  // Check if user is still valid
  if (entry.userId) {
    const user = state.cards[entry.userId];
    if (!user || user.zone !== 'battlefield' || user.owner !== entry.owner) {
      addLog(
        state,
        entry.owner,
        'ability-fizzle',
        `${def.name} fizzles — user no longer on battlefield`,
        entry.sourceCardInstanceId
      );
      moveCard(state, entry.sourceCardInstanceId, 'essence');
      return;
    }

    // Check if user still meets requirements
    const userDef = getCardDefForInstance(state, entry.userId) as CharacterCardDef;
    if (user.state === 'injured') {
      // Check if any effects used are Valid
      // For now, abilities themselves don't have Valid — their effects do
      // The requirement check was done at play time, but user might have become injured
    }
  }

  // Check if at least one target is still valid
  if (entry.targetIds && entry.targetIds.length > 0) {
    const hasValidTarget = entry.targetIds.some((id) => {
      const target = state.cards[id];
      return target && target.zone === 'battlefield';
    });

    if (!hasValidTarget) {
      addLog(
        state,
        entry.owner,
        'ability-fizzle',
        `${def.name} fizzles — no valid targets`,
        entry.sourceCardInstanceId
      );
      moveCard(state, entry.sourceCardInstanceId, 'essence');
      return;
    }
  }

  // Execute the ability's effect
  executeEffect(state, entry);

  // Move ability to essence
  moveCard(state, entry.sourceCardInstanceId, 'essence');
  addLog(
    state,
    entry.owner,
    'ability-resolve',
    `${def.name} resolved → Essence Area`,
    entry.sourceCardInstanceId
  );
}

function resolveCardEffect(state: GameState, entry: ChainEntry): void {
  const card = getCard(state, entry.sourceCardInstanceId);
  const def = getCardDefForInstance(state, entry.sourceCardInstanceId);

  // For activate/trigger effects, check if source is still valid
  const inPlayZones = ['kingdom', 'battlefield', 'field-area'];

  // Effects that move themselves as cost are fine
  // Otherwise, card must still be in play
  if (!inPlayZones.includes(card.zone)) {
    // Check if the effect specifies it works from out of play
    // For now, assume it needs to be in play unless cost moved it
    // (This is handled per-card in effectExecutor)
  }

  // Check injured state for non-Valid effects
  if (card.state === 'injured') {
    const effectDef = def.cardType === 'character'
      ? (def as CharacterCardDef).effects.find((e) => e.id === entry.effectId)
      : undefined;

    if (effectDef && !effectDef.isValid) {
      addLog(
        state,
        entry.owner,
        'effect-injured',
        `${def.name} is injured — effect does nothing`
      );
      return;
    }
  }

  executeEffect(state, entry);
}

function handlePostResolution(state: GameState, entry: ChainEntry): void {
  // Move strategies/abilities to appropriate zones even if negated
  const def = getCardDefForInstance(state, entry.sourceCardInstanceId);

  if (entry.type === 'strategy') {
    const stratDef = def as StrategyCardDef;
    if (stratDef.keywords.includes('permanent')) {
      moveCard(state, entry.sourceCardInstanceId, 'kingdom');
    } else {
      moveCard(state, entry.sourceCardInstanceId, 'essence');
    }
  } else if (entry.type === 'ability') {
    moveCard(state, entry.sourceCardInstanceId, 'essence');
  }
}

// --- Trigger Checking ---

function checkPutInPlayTriggers(
  state: GameState,
  cardInstanceId: string,
  owner: PlayerId
): void {
  const card = getCard(state, cardInstanceId);
  const def = getCardDefForInstance(state, cardInstanceId);

  if (def.cardType !== 'character') return;
  const charDef = def as CharacterCardDef;

  for (const effect of charDef.effects) {
    if (
      effect.type === 'trigger' &&
      effect.triggerCondition === 'put-in-play'
    ) {
      // Check if injured and effect is not Valid
      if (card.state === 'injured' && !effect.isValid) continue;

      // Queue the trigger
      state.pendingTriggers.push({
        id: `trigger_${cardInstanceId}_${effect.id}`,
        type: 'trigger-effect',
        sourceCardInstanceId: cardInstanceId,
        effectId: effect.id,
        resolved: false,
        negated: false,
        owner,
      });
    }
  }
}

// Check triggers for "sent to attack"
export function checkSentToAttackTriggers(
  state: GameState,
  characterIds: string[],
  owner: PlayerId
): void {
  for (const charId of characterIds) {
    const card = getCard(state, charId);
    const def = getCardDefForInstance(state, charId);
    if (def.cardType !== 'character') continue;

    const charDef = def as CharacterCardDef;
    for (const effect of charDef.effects) {
      if (
        effect.type === 'trigger' &&
        (effect.triggerCondition === 'sent-to-attack' ||
          effect.triggerCondition === 'sent-to-battle')
      ) {
        if (card.state === 'injured' && !effect.isValid) continue;

        state.pendingTriggers.push({
          id: `trigger_${charId}_${effect.id}`,
          type: 'trigger-effect',
          sourceCardInstanceId: charId,
          effectId: effect.id,
          resolved: false,
          negated: false,
          owner,
        });
      }
    }
  }
}

// Check triggers for "sent to battle while injured"
export function checkSentToBattleTriggers(
  state: GameState,
  characterIds: string[],
  owner: PlayerId
): void {
  for (const charId of characterIds) {
    const card = getCard(state, charId);
    const def = getCardDefForInstance(state, charId);
    if (def.cardType !== 'character') continue;

    const charDef = def as CharacterCardDef;
    for (const effect of charDef.effects) {
      if (
        effect.type === 'trigger' &&
        effect.triggerCondition === 'sent-to-battle-while-injured' &&
        card.state === 'injured' &&
        effect.isValid
      ) {
        state.pendingTriggers.push({
          id: `trigger_${charId}_${effect.id}`,
          type: 'trigger-effect',
          sourceCardInstanceId: charId,
          effectId: effect.id,
          resolved: false,
          negated: false,
          owner,
        });
      }
    }
  }
}

// Check triggers for in-play card discarded (Field: Slayer Guild's Hideout)
export function checkDiscardTriggers(
  state: GameState,
  discardedCardId: string
): void {
  const discardedCard = getCard(state, discardedCardId);

  // Check both players' field cards and in-play cards for discard triggers
  for (const player of ['player1', 'player2'] as PlayerId[]) {
    // Check field card
    const fieldId = state.players[player].fieldCard;
    if (fieldId) {
      const fieldDef = getCardDefForInstance(state, fieldId);
      for (const effect of fieldDef.effects) {
        if (
          effect.type === 'trigger' &&
          effect.triggerCondition === 'in-play-card-discarded' &&
          effect.oncePerTurn
        ) {
          const fieldCard = getCard(state, fieldId);
          if (fieldCard.usedEffects.includes(effect.id)) continue;

          // Only during Main or Battle phase
          if (state.phase !== 'main' && !state.phase.startsWith('battle')) continue;

          state.pendingTriggers.push({
            id: `trigger_${fieldId}_${effect.id}`,
            type: 'trigger-effect',
            sourceCardInstanceId: fieldId,
            effectId: effect.id,
            resolved: false,
            negated: false,
            owner: player,
          });
        }
      }
    }
  }
}
