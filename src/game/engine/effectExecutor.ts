// ============================================================
// Effect Executor — Implements each card's specific effect logic
// ============================================================

import {
  GameState,
  ChainEntry,
  PlayerId,
  CharacterCardDef,
  CardInstance,
} from '../types';
import {
  getCard,
  getCardDefForInstance,
  moveCard,
  moveCardToBottomOfDeck,
  drawCards,
  addLog,
  getOpponent,
  fieldHasSymbol,
  fieldHasName,
  characterHasAttribute,
  dealDamage,
  getCardsInZone,
  shuffleDeck,
  getEffectiveStats,
  getTeamForCharacter,
  teamHasCharacterWithAttribute,
  isProtectedFromCharacterEffects,
  hasEssenceCamouflage,
  cardMatchesName,
  generateId,
  oceanicAbyssVirtualCharCount,
} from './utils';
import type { EventCollector } from './EventCollector';

// Master effect executor — routes to specific card logic
export function executeEffect(state: GameState, entry: ChainEntry, collector?: EventCollector): void {
  const def = getCardDefForInstance(state, entry.sourceCardInstanceId);
  const effectKey = entry.effectId ?? `${def.id}-resolve`;

  // Route to card-specific effect handler
  const handler = effectHandlers[def.id] ?? effectHandlers[effectKey];

  if (handler) {
    addLog(
      state,
      entry.owner,
      'effect-resolve',
      `${def.name} effect activates`,
      entry.sourceCardInstanceId
    );
    handler(state, entry, collector);
  } else {
    addLog(
      state,
      entry.owner,
      'effect-unimplemented',
      `Effect for ${def.name} (${def.id}) not yet implemented`,
      entry.sourceCardInstanceId
    );
  }
}

// ============================================================
// Card Effect Handlers — keyed by card def ID
// ============================================================

type EffectHandler = (state: GameState, entry: ChainEntry, collector?: EventCollector) => void;

const effectHandlers: Record<string, EffectHandler> = {
  // --------------------------------------------------------
  // FIELD: F0005 — Slayer Guild's Hideout
  // TRIGGER: Once/turn, Main or Battle Phase, in-play card discarded → may draw 1
  // --------------------------------------------------------
  'F0005': (state, entry) => {
    if (!entry.optionalApproved) {
      state.pendingOptionalEffect = {
        chainEntryId: entry.id,
        sourceCardId: entry.sourceCardInstanceId,
        effectId: 'F0005-E1',
        cardName: "Slayer Guild's Hideout",
        effectDescription: 'You may draw 1 card.',
        owner: entry.owner,
      };
      return;
    }
    const fieldCard = getCard(state, entry.sourceCardInstanceId);
    drawCards(state, entry.owner, 1);
    fieldCard.usedEffects.push('F0005-E1');
    addLog(state, entry.owner, 'effect', "Slayer Guild's Hideout — Drew 1 card");
  },

  // --------------------------------------------------------
  // C0077 — Vanessa
  // TRIGGER: Sent to Attack → may look top 5, add 1 Ability w/ {Weapon} req, discard rest
  // --------------------------------------------------------
  'C0077': (state, entry) => {
    if (!entry.optionalApproved) {
      state.pendingOptionalEffect = {
        chainEntryId: entry.id,
        sourceCardId: entry.sourceCardInstanceId,
        effectId: 'C0077-E1',
        cardName: 'Vanessa',
        effectDescription: 'You may look at the top 5 cards of your deck. Add 1 Ability card with {Weapon} requirement to your hand, discard the rest.',
        owner: entry.owner,
      };
      return;
    }
    const player = entry.owner;
    const deck = state.players[player].deck;
    const topCards = deck.slice(0, Math.min(5, deck.length));

    if (topCards.length === 0) {
      addLog(state, player, 'effect', 'Vanessa — Deck is empty');
      return;
    }

    // Find ability cards with Weapon requirement
    const abilityWithWeapon: string[] = [];

    for (const cardId of topCards) {
      const def = getCardDefForInstance(state, cardId);
      if (
        def.cardType === 'ability' &&
        'requirements' in def &&
        def.requirements.some((r) => r.type === 'attribute' && r.value === 'Weapon')
      ) {
        abilityWithWeapon.push(cardId);
      }
    }

    // Set up interactive search for player to pick from the revealed cards
    state.pendingSearch = {
      effectId: 'C0077-E1',
      owner: player,
      criteria: 'Ability card with {Weapon} requirement',
      validCardIds: abilityWithWeapon,
      displayCardIds: topCards,
      sourceCardName: 'Vanessa',
      discardRest: true,
    };
  },

  // --------------------------------------------------------
  // C0078 — Lucian
  // ACTIVATE [Your Turn|Main] Discard 1 {Weapon} Char from hand: Draw 2, put 1 to deck bottom
  // --------------------------------------------------------
  'C0078': (state, entry) => {
    const player = entry.owner;
    // Cost already paid (weapon character discarded from hand)
    // Effect: Draw 2, then put 1 from hand to bottom of deck
    drawCards(state, player, 2);

    const hand = state.players[player].hand;
    if (hand.length > 0) {
      // Set up interactive choice for which card to put at deck bottom
      state.pendingTargetChoice = {
        effectId: 'C0078-E1',
        sourceCardId: entry.sourceCardInstanceId,
        owner: player,
        description: 'Choose a card from your hand to place at the bottom of your deck',
        validTargetIds: [...hand],
      };
      addLog(state, player, 'effect', 'Lucian — Drew 2, choose 1 to put at deck bottom');
    }
  },

  // --------------------------------------------------------
  // C0079 — Solomon
  // ACTIVATE [Your Turn|Main] Expel 2 from DP: All {Slayer} +1/+1 this turn
  // --------------------------------------------------------
  'C0079': (state, entry) => {
    const player = entry.owner;
    // Cost already paid (2 cards expelled from DP)

    // All Slayer characters get +1/+1
    const kingdom = getCardsInZone(state, player, 'kingdom');
    const battlefield = getCardsInZone(state, player, 'battlefield');
    const allInPlay = [...kingdom, ...battlefield];

    for (const card of allInPlay) {
      if (characterHasAttribute(state, card.instanceId, 'Slayer')) {
        card.statModifiers.push({
          lead: 1,
          support: 1,
          source: 'C0079-Solomon',
          duration: 'turn',
        });
      }
    }

    // At end of turn, may discard top 2 of deck (registered as lingering)
    state.lingeringEffects.push({
      id: `solomon_${entry.id}`,
      source: entry.sourceCardInstanceId,
      effectDescription: 'May discard top 2 cards of your deck',
      duration: 'until-end-of-turn',
      appliedTurn: state.turnNumber,
      data: { player, optional: true },
    });

    addLog(state, player, 'effect', 'Solomon — All {Slayer} get +1/+1 this turn');
  },

  // --------------------------------------------------------
  // C0080 — Twin Sword Karen
  // TRIGGER [Sent To Attack] Discard top 2 of opponent's deck: +1/+1 this turn
  // --------------------------------------------------------
  'C0080': (state, entry) => {
    const player = entry.owner;
    const opponent = getOpponent(player);
    const card = getCard(state, entry.sourceCardInstanceId);

    // Cost: discard top 2 of opponent's deck
    const opponentDeck = state.players[opponent].deck;
    const toDiscard = opponentDeck.splice(0, Math.min(2, opponentDeck.length));
    for (const id of toDiscard) {
      const c = getCard(state, id);
      c.zone = 'discard';
      state.players[opponent].discard.push(id);
    }

    // Effect: +1/+1 this turn
    card.statModifiers.push({
      lead: 1,
      support: 1,
      source: 'C0080-TwinSwordKaren',
      duration: 'turn',
    });

    addLog(state, player, 'effect', 'Twin Sword Karen — Milled 2 from opponent, gained +1/+1');
  },

  // --------------------------------------------------------
  // C0081 — Professor Sinister
  // TRIGGER Valid: Field has Necro, sent to Battle while Injured → top of deck to Essence
  // --------------------------------------------------------
  'C0081': (state, entry) => {
    const player = entry.owner;

    if (!fieldHasSymbol(state, player, 'necro')) {
      addLog(state, player, 'effect', 'Professor Sinister — Field has no Necro symbol');
      return;
    }

    if (!entry.optionalApproved) {
      state.pendingOptionalEffect = {
        chainEntryId: entry.id,
        sourceCardId: entry.sourceCardInstanceId,
        effectId: 'C0081-E1',
        cardName: 'Professor Sinister',
        effectDescription: 'You may move the top card of your deck to your Essence area.',
        owner: entry.owner,
      };
      return;
    }

    const deck = state.players[player].deck;
    if (deck.length > 0) {
      const topCard = deck[0];
      state.players[player].deck.shift();
      moveCard(state, topCard, 'essence');
      addLog(state, player, 'effect', 'Professor Sinister — Moved top of deck to Essence');
    }
  },

  // --------------------------------------------------------
  // C0082 — Omtaba
  // TRIGGER: Put in play → may discard 1 Injured opponent Character
  // (ONGOING handled separately in stat calculation)
  // --------------------------------------------------------
  'C0082': (state, entry) => {
    if (!entry.optionalApproved) {
      state.pendingOptionalEffect = {
        chainEntryId: entry.id,
        sourceCardId: entry.sourceCardInstanceId,
        effectId: 'C0082-E1',
        cardName: 'Omtaba',
        effectDescription: 'You may discard 1 Injured Character your opponent controls.',
        owner: entry.owner,
      };
      return;
    }
    const player = entry.owner;
    const opponent = getOpponent(player);

    // Find injured opponent characters (kingdom and battlefield)
    const opponentKingdom = getCardsInZone(state, opponent, 'kingdom');
    const opponentBattlefield = getCardsInZone(state, opponent, 'battlefield');
    const injuredChars = [...opponentKingdom, ...opponentBattlefield].filter(
      (c) => c.state === 'injured' &&
        !isProtectedFromCharacterEffects(state, c.instanceId, player)
    );

    if (injuredChars.length > 0) {
      // Let the player choose which injured character to discard
      state.pendingTargetChoice = {
        effectId: 'C0082-E1',
        sourceCardId: entry.sourceCardInstanceId,
        owner: player,
        description: 'Choose an injured opponent character to discard',
        validTargetIds: injuredChars.map((c) => c.instanceId),
      };
    } else {
      addLog(state, player, 'effect', 'Omtaba — No injured opponent characters to discard');
    }
  },

  // --------------------------------------------------------
  // C0083 — Swordmaster Don
  // TRIGGER: Put in play, if Field has Plasma → may move 1 {Weapon} from DP to hand
  // --------------------------------------------------------
  'C0083': (state, entry) => {
    const player = entry.owner;

    if (!fieldHasSymbol(state, player, 'plasma')) {
      addLog(state, player, 'effect', 'Swordmaster Don — Field has no Plasma symbol');
      return;
    }

    if (!entry.optionalApproved) {
      state.pendingOptionalEffect = {
        chainEntryId: entry.id,
        sourceCardId: entry.sourceCardInstanceId,
        effectId: 'C0083-E1',
        cardName: 'Swordmaster Don',
        effectDescription: 'You may move 1 {Weapon} Character from your Discard Pile to your hand.',
        owner: entry.owner,
      };
      return;
    }

    const discard = getCardsInZone(state, player, 'discard');
    const weaponChars = discard.filter(
      (c) =>
        getCardDefForInstance(state, c.instanceId).cardType === 'character' &&
        characterHasAttribute(state, c.instanceId, 'Weapon')
    );

    if (weaponChars.length > 0) {
      // Let the player choose which {Weapon} to recover
      state.pendingTargetChoice = {
        effectId: 'C0083-E1',
        sourceCardId: entry.sourceCardInstanceId,
        owner: player,
        description: 'Choose a {Weapon} character from your Discard Pile to add to your hand',
        validTargetIds: weaponChars.map((c) => c.instanceId),
      };
    } else {
      addLog(state, player, 'effect', 'Swordmaster Don — No {Weapon} characters in DP');
    }
  },

  // --------------------------------------------------------
  // C0084 — Sinbad
  // TRIGGER: Put in play → target 1 {Weapon} you control, +1/+1 Counter
  // --------------------------------------------------------
  'C0084': (state, entry) => {
    const player = entry.owner;

    const kingdom = getCardsInZone(state, player, 'kingdom');
    const weaponChars = kingdom.filter(
      (c) =>
        getCardDefForInstance(state, c.instanceId).cardType === 'character' &&
        characterHasAttribute(state, c.instanceId, 'Weapon')
    );

    if (weaponChars.length > 0) {
      // Always let the player choose (even 1 target — "you may" allows declining)
      state.pendingTargetChoice = {
        effectId: 'C0084-E1',
        sourceCardId: entry.sourceCardInstanceId,
        owner: player,
        description: 'You may choose a {Weapon} character to place +1/+1 Counter on',
        validTargetIds: weaponChars.map((c) => c.instanceId),
        allowDecline: true,
      };
    } else {
      addLog(state, player, 'effect', 'Sinbad — No {Weapon} characters to target');
    }
  },

  // --------------------------------------------------------
  // C0085 — Samanosuke
  // TRIGGER [Valid|Sent To Attack] Move 1 {Weapon} from DP to deck bottom:
  //   If Field has Necro → +2/+0 this turn
  // --------------------------------------------------------
  'C0085': (state, entry) => {
    const player = entry.owner;
    const card = getCard(state, entry.sourceCardInstanceId);

    // Cost: Move 1 {Weapon} Character from DP to bottom of deck
    const discard = getCardsInZone(state, player, 'discard');
    const weaponInDP = discard.filter(
      (c) =>
        getCardDefForInstance(state, c.instanceId).cardType === 'character' &&
        characterHasAttribute(state, c.instanceId, 'Weapon')
    );

    if (weaponInDP.length === 0) {
      addLog(state, player, 'effect', 'Samanosuke — No {Weapon} character in DP to pay cost');
      return;
    }

    // Let the player choose which {Weapon} from DP to move to deck bottom
    state.pendingTargetChoice = {
      effectId: 'C0085-E1',
      sourceCardId: entry.sourceCardInstanceId,
      owner: player,
      description: 'Choose a {Weapon} character from your Discard Pile to move to deck bottom',
      validTargetIds: weaponInDP.map((c) => c.instanceId),
    };
  },

  // --------------------------------------------------------
  // C0086 — Rosita (ONGOING — handled in stat calculation, not here)
  // --------------------------------------------------------

  // --------------------------------------------------------
  // S0038 — Secret Meeting
  // If Field is "Slayer Guild's Hideout" → search for {Slayer} or {Mercenary} Character
  // --------------------------------------------------------
  'S0038': (state, entry) => {
    const player = entry.owner;

    if (!fieldHasName(state, player, "Slayer Guild's Hideout")) {
      addLog(state, player, 'effect', 'Secret Meeting — Field is not Slayer Guild\'s Hideout');
      return;
    }

    const deck = state.players[player].deck;
    const validTargets = deck.filter((id) => {
      const def = getCardDefForInstance(state, id);
      if (def.cardType !== 'character') return false;
      const charDef = def as CharacterCardDef;
      return (
        charDef.attributes.includes('Slayer') ||
        charDef.attributes.includes('Mercenary')
      );
    });

    if (validTargets.length > 0) {
      // Set pending search for interactive selection
      state.pendingSearch = {
        effectId: 'S0038',
        owner: player,
        criteria: 'Slayer or Mercenary Character',
        validCardIds: validTargets,
      };
      addLog(state, player, 'effect', 'Secret Meeting — Search your deck for a Slayer or Mercenary Character');
    } else {
      shuffleDeck(state, player);
      addLog(state, player, 'effect', 'Secret Meeting — No valid targets found');
    }
  },

  // --------------------------------------------------------
  // S0039 — Reaped Fear (Permanent 3, Unique)
  // TRIGGER: Once/turn, Slayer team discards opponent via showdown → win 1 BR
  // Only fires from showdown trigger (effectId 'S0039-E1'), not on initial play
  // --------------------------------------------------------
  'S0039': (state, entry) => {
    // No effect on play — this is a permanent with a trigger-only effect.
    // The trigger fires from showdown resolution in gameLoop.ts.
    if (entry.effectId !== 'S0039-E1') return;

    const player = entry.owner;
    const opponent = getOpponent(player);

    // Award 1 additional Battle Reward
    const opponentDeck = state.players[opponent].deck;
    if (opponentDeck.length > 0) {
      const cardId = opponentDeck.shift()!;
      const card = getCard(state, cardId);
      card.zone = 'battle-rewards';
      state.players[opponent].battleRewards.push(cardId);

      const sourceCard = getCard(state, entry.sourceCardInstanceId);
      sourceCard.usedEffects.push('S0039-E1');

      addLog(state, player, 'effect', 'Reaped Fear — Won 1 additional Battle Reward!');
    }
  },

  // --------------------------------------------------------
  // S0040 — Bounty Board
  // If Field is "Slayer Guild's Hideout" → reveal {Weapon} Char from hand,
  // and if you do, move to deck bottom, draw 3
  // --------------------------------------------------------
  'S0040': (state, entry, collector) => {
    const player = entry.owner;

    if (!fieldHasName(state, player, "Slayer Guild's Hideout")) {
      addLog(state, player, 'effect', 'Bounty Board — Field is not Slayer Guild\'s Hideout');
      return;
    }

    const hand = state.players[player].hand;
    const weaponChars = hand.filter((id) => {
      const def = getCardDefForInstance(state, id);
      if (def.cardType !== 'character') return false;
      return characterHasAttribute(state, id, 'Weapon');
    });

    if (weaponChars.length > 0) {
      // Let the player choose which {Weapon} character to reveal
      state.pendingTargetChoice = {
        effectId: 'S0040-E1',
        sourceCardId: entry.sourceCardInstanceId,
        owner: player,
        description: 'Choose a {Weapon} character from your hand to reveal',
        validTargetIds: weaponChars,
      };
    } else {
      addLog(state, player, 'effect', 'Bounty Board — No {Weapon} Character in hand to reveal');
    }
  },

  // --------------------------------------------------------
  // S0041 — Hard Decision
  // Target: 1 Character you control. Discard target → draw 1 + win 1 BR
  // --------------------------------------------------------
  'S0041': (state, entry) => {
    const player = entry.owner;
    const opponent = getOpponent(player);

    if (!entry.targetIds || entry.targetIds.length === 0) {
      addLog(state, player, 'effect', 'Hard Decision — No target');
      return;
    }

    const targetId = entry.targetIds[0];
    const target = state.cards[targetId];
    const targetDef = getCardDefForInstance(state, targetId);

    if (!target || (target.zone !== 'kingdom' && target.zone !== 'battlefield')) {
      addLog(state, player, 'effect', 'Hard Decision — Target no longer valid');
      return;
    }

    // "And if you do" — discard is the condition
    moveCard(state, targetId, 'discard');

    // Draw 1
    drawCards(state, player, 1);

    // Win 1 BR — cards go from opponent's deck to opponent's BR zone
    const opponentDeck = state.players[opponent].deck;
    if (opponentDeck.length > 0) {
      const brCard = opponentDeck.shift()!;
      const brCardInstance = getCard(state, brCard);
      brCardInstance.zone = 'battle-rewards';
      state.players[opponent].battleRewards.push(brCard);
    }

    addLog(
      state,
      player,
      'effect',
      `Hard Decision — Discarded ${targetDef.name}, drew 1 card, won 1 BR`
    );
  },

  // --------------------------------------------------------
  // A0036 — Stake Gun
  // Flip coin X times, 1 dmg per Heads. Expert [{Slayer}]: discard X from opponent's deck
  // --------------------------------------------------------
  'A0036': (state, entry, collector) => {
    const player = entry.owner;
    const opponent = getOpponent(player);
    const xValue = entry.xValue ?? 0;
    const def = getCardDefForInstance(state, entry.sourceCardInstanceId);

    if (!entry.targetIds || entry.targetIds.length === 0) {
      addLog(state, player, 'effect', 'Stake Gun — No target');
      return;
    }

    const targetId = entry.targetIds[0];

    // Check protection (Omtaba E2)
    if (isProtectedFromCharacterEffects(state, targetId, player)) {
      addLog(state, player, 'effect', 'Stake Gun — Target is protected from character effects');
      return;
    }

    // X=0 is valid (e.g., to dodge Swift Strike), just skip coin flips
    if (xValue === 0) {
      addLog(state, player, 'effect', 'Stake Gun — X=0, no coins to flip');
      return;
    }

    // Flip coins
    let heads = 0;
    const results: ('heads' | 'tails')[] = [];
    for (let i = 0; i < xValue; i++) {
      const isHeads = Math.random() < 0.5;
      if (isHeads) heads++;
      results.push(isHeads ? 'heads' : 'tails');
    }

    // Emit coin flip animation event
    collector?.emit({
      type: 'coin-flip',
      player,
      cardName: def.name,
      defId: def.id,
      flipCount: xValue,
      results,
      headsCount: heads,
    });

    addLog(
      state,
      player,
      'effect',
      `Stake Gun — Flipped ${xValue} coins: ${heads} Heads`
    );

    // Deal damage
    if (heads > 0) {
      const result = dealDamage(state, targetId, heads);
      const targetDef = getCardDefForInstance(state, targetId);
      if (result.discarded) {
        addLog(state, player, 'effect', `Stake Gun — ${targetDef.name} was discarded!`);
      } else if (result.injured) {
        addLog(state, player, 'effect', `Stake Gun — ${targetDef.name} was injured`);
      }
    }

    // Expert effect: if user is {Slayer}, may discard X from opponent's deck
    if (entry.userId && xValue > 0) {
      if (characterHasAttribute(state, entry.userId, 'Slayer')) {
        // Add lingering effect for the expert prompt
        const effectId = `stakegun_expert_${Date.now()}`;
        state.lingeringEffects.push({
          id: effectId,
          source: entry.sourceCardInstanceId,
          effectDescription: `Stake Gun Expert: You may discard the top ${xValue} card(s) of your opponent's deck.`,
          duration: 'turn',
          appliedTurn: state.turnNumber,
          data: { player, opponent, xValue },
        });
        state.pendingOptionalEffect = {
          lingeringEffectId: effectId,
          sourceCardId: entry.sourceCardInstanceId,
          effectId: 'A0036-expert',
          cardName: 'Stake Gun',
          effectDescription: `Expert: You may discard the top ${xValue} card(s) of your opponent's deck.`,
          owner: player,
        };
      }
    }
  },

  // --------------------------------------------------------
  // A0037 — Deflection
  // User gets +3/+3, next damage to user this turn becomes 0
  // --------------------------------------------------------
  'A0037': (state, entry) => {
    const player = entry.owner;

    if (!entry.userId) return;

    const user = getCard(state, entry.userId);
    user.statModifiers.push({
      lead: 3,
      support: 3,
      source: 'A0037-Deflection',
      duration: 'turn',
    });

    // Register damage prevention as lingering effect
    state.lingeringEffects.push({
      id: `deflection_${entry.id}`,
      source: entry.userId,
      effectDescription: 'Next damage to this character becomes 0',
      duration: 'turn',
      appliedTurn: state.turnNumber,
      data: { targetId: entry.userId, preventNextDamage: true },
    });

    const userDef = getCardDefForInstance(state, entry.userId);
    addLog(
      state,
      player,
      'effect',
      `Deflection — ${userDef.name} gets +3/+3 and damage prevention`
    );
  },

  // --------------------------------------------------------
  // S0042 — Oceanic Abyss (Permanent, Unique)
  // Ongoing effects only (E1: discard redirect handled by moveCard/actionProcessor,
  // E2: virtual character handled by utility function). No effect on play.
  // --------------------------------------------------------
  'S0042': () => {
    // No effect on play — this is a permanent with ongoing effects only.
  },

  // --------------------------------------------------------
  // S0043 — Heavy Storm
  // Discard 2 cards from opponent's Essence area, then draw 1 card
  // --------------------------------------------------------
  'S0043': (state, entry, collector) => {
    const player = entry.owner;
    const opponent = getOpponent(player);

    // Discard up to 2 from opponent's essence
    // Note: CAMOUFLAGE does NOT protect from discard — it only allows summoning from essence
    const opponentEssence = [...state.players[opponent].essence];
    const toDiscard = opponentEssence.slice(0, Math.min(2, opponentEssence.length));
    for (const id of toDiscard) {
      moveCard(state, id, 'discard');
    }

    if (toDiscard.length > 0) {
      addLog(state, player, 'effect', `Heavy Storm — Discarded ${toDiscard.length} card(s) from opponent's Essence`);
    } else {
      addLog(state, player, 'effect', 'Heavy Storm — Opponent has no Essence cards to discard');
    }

    // Draw 1 card
    drawCards(state, player, 1);
    addLog(state, player, 'effect', 'Heavy Storm — Drew 1 card');
  },

  // --------------------------------------------------------
  // C0087 — Rococo
  // TRIGGER [Valid|showdown-discard]: If Field is "Micromon Beach",
  //   you may search deck for another "Rococo", put in play with +1/+1 counter
  // --------------------------------------------------------
  'C0087': (state, entry) => {
    const player = entry.owner;

    // Check field name
    if (!fieldHasName(state, player, 'Micromon Beach')) {
      addLog(state, player, 'effect', 'Rococo — Field is not Micromon Beach');
      return;
    }

    // Category A "may" pattern
    if (!entry.optionalApproved) {
      state.pendingOptionalEffect = {
        chainEntryId: entry.id,
        sourceCardId: entry.sourceCardInstanceId,
        effectId: 'C0087-E1',
        cardName: 'Rococo',
        effectDescription: 'You may search your deck for 1 "Rococo" and put it in play with a +1/+1 Counter.',
        owner: entry.owner,
      };
      return;
    }

    // Search deck for Rococo cards
    const deck = state.players[player].deck;
    const rococoInDeck = deck.filter((id) => {
      const def = getCardDefForInstance(state, id);
      return def.id === 'C0087';
    });

    if (rococoInDeck.length > 0) {
      state.pendingSearch = {
        effectId: 'C0087-E1',
        owner: player,
        criteria: '"Rococo" Character',
        validCardIds: rococoInDeck,
        sourceCardName: 'Rococo',
      };
    } else {
      addLog(state, player, 'effect', 'Rococo — No Rococo found in deck');
    }
  },

  // --------------------------------------------------------
  // C0093 — Linda The Puffer
  // TRIGGER [Sent to Attack]: If Field has Water or Terra,
  //   you may draw 1 card, then move 1 hand card to deck bottom
  // --------------------------------------------------------
  'C0093': (state, entry) => {
    const player = entry.owner;

    // Check field has water or terra symbol
    if (!fieldHasSymbol(state, player, 'water') && !fieldHasSymbol(state, player, 'terra')) {
      addLog(state, player, 'effect', 'Linda The Puffer — Field has no Water or Terra symbol');
      return;
    }

    // Category A "may" pattern
    if (!entry.optionalApproved) {
      state.pendingOptionalEffect = {
        chainEntryId: entry.id,
        sourceCardId: entry.sourceCardInstanceId,
        effectId: 'C0093-E1',
        cardName: 'Linda The Puffer',
        effectDescription: 'You may draw 1 card. If you do, move 1 card from your hand to the bottom of your deck.',
        owner: entry.owner,
      };
      return;
    }

    // Draw 1 card
    const drawn = drawCards(state, player, 1);
    if (drawn.length === 0) {
      addLog(state, player, 'effect', 'Linda The Puffer — Deck is empty, cannot draw');
      return;
    }

    addLog(state, player, 'effect', 'Linda The Puffer — Drew 1 card');

    // "And if you do" — must put 1 from hand to deck bottom
    const hand = state.players[player].hand;
    if (hand.length > 0) {
      state.pendingTargetChoice = {
        effectId: 'C0093-E1',
        sourceCardId: entry.sourceCardInstanceId,
        owner: player,
        description: 'Choose a card from your hand to place at the bottom of your deck',
        validTargetIds: [...hand],
      };
    }
  },

  // --------------------------------------------------------
  // A0038 — Swift Strike
  // At Showdown start: if target wasn't user of resolved ability → deal 1 dmg.
  // If discarded → draw 1
  // --------------------------------------------------------
  'A0038': (state, entry) => {
    const player = entry.owner;

    if (!entry.targetIds || entry.targetIds.length === 0) return;

    // This is a lingering effect — registers to fire at showdown start
    state.lingeringEffects.push({
      id: `swiftstrike_${entry.id}`,
      source: entry.sourceCardInstanceId,
      effectDescription: 'At showdown start, deal 1 damage to target if they didn\'t use an ability',
      duration: 'turn',
      appliedTurn: state.turnNumber,
      data: {
        targetId: entry.targetIds[0],
        owner: player,
        userId: entry.userId,
      },
    });

    const targetDef = getCardDefForInstance(state, entry.targetIds[0]);
    addLog(
      state,
      player,
      'effect',
      `Swift Strike — Targeting ${targetDef.name} at Showdown`
    );
  },

  // --------------------------------------------------------
  // F0006 — Micromon Beach
  // ACTIVATE [Your Turn|Main] (Once per turn): Apply 1 effect based on
  // number of Terra/Water characters you control:
  //   0: +1/+1 to 1 Character this turn (2+)
  //   1: Draw 1 card (4+)
  //   2: Discard 1 from opponent Essence, move 1 from your DP to Essence (4+)
  //   3: Ability cards cannot be played this turn (6+)
  // --------------------------------------------------------
  'F0006': (state, entry) => {
    const player = entry.owner;
    const opponent = getOpponent(player);
    const choice = entry.effectSubChoice ?? -1;

    switch (choice) {
      case 0: {
        // 2+ → Select 1 Character, +1/+1 this turn
        const kingdom = getCardsInZone(state, player, 'kingdom');
        const battlefield = getCardsInZone(state, player, 'battlefield');
        const validChars = [...kingdom, ...battlefield].filter((c) => {
          const d = getCardDefForInstance(state, c.instanceId);
          return d.cardType === 'character';
        });

        if (validChars.length > 0) {
          state.pendingTargetChoice = {
            effectId: 'F0006-E1-buff',
            sourceCardId: entry.sourceCardInstanceId,
            owner: player,
            description: 'Choose a Character to give +1/+1 this turn',
            validTargetIds: validChars.map((c) => c.instanceId),
          };
        } else {
          addLog(state, player, 'effect', 'Micromon Beach — No characters to buff');
        }
        break;
      }

      case 1: {
        // 4+ → Draw 1 card
        drawCards(state, player, 1);
        addLog(state, player, 'effect', 'Micromon Beach — Drew 1 card');
        break;
      }

      case 2: {
        // 4+ → Discard 1 from opponent Essence, move 1 from your DP to Essence
        const opEssence = [...state.players[opponent].essence];
        if (opEssence.length > 0) {
          moveCard(state, opEssence[0], 'discard');
          addLog(state, player, 'effect', 'Micromon Beach — Discarded 1 from opponent\'s Essence');
        } else {
          addLog(state, player, 'effect', 'Micromon Beach — Opponent has no Essence to discard');
        }

        // Move 1 from player's DP to Essence
        const dp = state.players[player].discard;
        if (dp.length > 0) {
          state.pendingTargetChoice = {
            effectId: 'F0006-E1-dp-to-essence',
            sourceCardId: entry.sourceCardInstanceId,
            owner: player,
            description: 'Choose a card from your Discard Pile to move to Essence',
            validTargetIds: [...dp],
          };
        } else {
          addLog(state, player, 'effect', 'Micromon Beach — No cards in DP to move to Essence');
        }
        break;
      }

      case 3: {
        // 6+ → Ability cards cannot be played this turn
        state.lingeringEffects.push({
          id: `micromon_beach_no_abilities_${entry.id}`,
          source: entry.sourceCardInstanceId,
          effectDescription: 'Ability cards cannot be played during this turn',
          duration: 'turn',
          appliedTurn: state.turnNumber,
          data: {},
        });
        addLog(state, player, 'effect', 'Micromon Beach — Ability cards cannot be played this turn');
        break;
      }

      default:
        addLog(state, player, 'effect', 'Micromon Beach — No valid sub-effect choice');
        break;
    }
  },

  // --------------------------------------------------------
  // C0089 — Carnodile
  // TRIGGER [Put In Play]: If Field is "Micromon Beach" + 3+ other Sea Monsters,
  //   you may target 1 opponent Character with TC ≤ 3 → bottom of owner's deck.
  // --------------------------------------------------------
  'C0089': (state, entry) => {
    if (entry.effectId !== 'C0089-E1') return;

    const player = entry.owner;
    const opponent = getOpponent(player);

    // "you may" — optional prompt
    if (!entry.optionalApproved) {
      // Pre-check conditions before even asking
      if (!fieldHasName(state, player, 'Micromon Beach')) return; // silently skip
      const allInPlay = [
        ...state.players[player].kingdom,
        ...state.players[player].battlefield,
      ];
      let seaMonsterCount = 0;
      for (const id of allInPlay) {
        if (id === entry.sourceCardInstanceId) continue; // "other"
        try {
          const d = getCardDefForInstance(state, id);
          if (d.cardType === 'character' && (d as CharacterCardDef).attributes.includes('Sea Monster')) seaMonsterCount++;
        } catch { /* skip */ }
      }
      if (seaMonsterCount < 3) return; // silently skip

      // Check if opponent has valid targets (TC ≤ 3 characters)
      const opChars = [
        ...state.players[opponent].kingdom,
        ...state.players[opponent].battlefield,
      ];
      const validTargets = opChars.filter((id) => {
        try {
          const d = getCardDefForInstance(state, id);
          if (d.cardType !== 'character') return false;
          return (d as CharacterCardDef).turnCost <= 3;
        } catch { return false; }
      });
      if (validTargets.length === 0) return; // no valid targets

      state.pendingOptionalEffect = {
        chainEntryId: entry.id,
        sourceCardId: entry.sourceCardInstanceId,
        effectId: 'C0089-E1',
        cardName: 'Carnodile',
        effectDescription: 'You may target 1 opponent Character with Turn Cost 3 or less and move it to the bottom of their deck.',
        owner: player,
      };
      return;
    }

    // Approved — validate conditions again and set up target choice
    if (!fieldHasName(state, player, 'Micromon Beach')) {
      addLog(state, player, 'effect', 'Carnodile — Field is not "Micromon Beach". Effect fizzles.');
      return;
    }

    const allInPlay = [
      ...state.players[player].kingdom,
      ...state.players[player].battlefield,
    ];
    let seaMonsterCount = 0;
    for (const id of allInPlay) {
      if (id === entry.sourceCardInstanceId) continue;
      try {
        const d = getCardDefForInstance(state, id);
        if (d.cardType === 'character' && (d as CharacterCardDef).attributes.includes('Sea Monster')) seaMonsterCount++;
      } catch { /* skip */ }
    }
    // Oceanic Abyss E2 — virtual Sea Monster character
    seaMonsterCount += oceanicAbyssVirtualCharCount(state, player, { attribute: 'Sea Monster' });
    if (seaMonsterCount < 3) {
      addLog(state, player, 'effect', `Carnodile — Only ${seaMonsterCount} other Sea Monsters, need 3+. Effect fizzles.`);
      return;
    }

    // Find valid opponent targets (TC ≤ 3)
    const opChars = [
      ...state.players[opponent].kingdom,
      ...state.players[opponent].battlefield,
    ];
    const validTargets = opChars.filter((id) => {
      try {
        const d = getCardDefForInstance(state, id);
        if (d.cardType !== 'character') return false;
        return (d as CharacterCardDef).turnCost <= 3;
      } catch { return false; }
    });

    if (validTargets.length === 0) {
      addLog(state, player, 'effect', 'Carnodile — No valid opponent targets (TC ≤ 3). Effect fizzles.');
      return;
    }

    state.pendingTargetChoice = {
      effectId: 'C0089-E1',
      sourceCardId: entry.sourceCardInstanceId,
      owner: player,
      description: 'Choose 1 opponent Character with Turn Cost 3 or less to move to the bottom of their deck',
      validTargetIds: validTargets,
    };
    addLog(state, player, 'effect', 'Carnodile — Choose an opponent Character to bounce');
  },

  // --------------------------------------------------------
  // C0088 — Hydroon
  // ACTIVATE: If Field is "Micromon Beach", search deck for "Krakaan" → put in play,
  //   then move Hydroon to Essence.
  // --------------------------------------------------------
  'C0088': (state, entry) => {
    if (entry.effectId !== 'C0088-E1') return;

    const player = entry.owner;

    // Validate: Field card is "Micromon Beach"
    if (!fieldHasName(state, player, 'Micromon Beach')) {
      addLog(state, player, 'effect', 'Hydroon — Field card is not "Micromon Beach". Effect fizzles.');
      return;
    }

    // Search deck for a Character with name "Krakaan"
    const deck = state.players[player].deck;
    const validTargets = deck.filter((id) => {
      try {
        const cDef = getCardDefForInstance(state, id);
        if (cDef.cardType !== 'character') return false;
        return cardMatchesName(cDef, 'Krakaan');
      } catch { return false; }
    });

    if (validTargets.length > 0) {
      state.pendingSearch = {
        effectId: 'C0088-E1',
        owner: player,
        criteria: 'Character with the name "Krakaan"',
        validCardIds: validTargets,
        sourceCardName: 'Hydroon',
        sourceCardInstanceId: entry.sourceCardInstanceId,
      };
      addLog(state, player, 'effect', 'Hydroon — Search your deck for a Character named "Krakaan"');
    } else {
      shuffleDeck(state, player);
      addLog(state, player, 'effect', 'Hydroon — No "Krakaan" found in deck');
    }
  },

  // --------------------------------------------------------
  // C0092 — Sea King Krakaan
  // TRIGGER: When you put in play a Character with [Sea Monster],
  //   you may move the top card of your deck to your Essence area.
  // --------------------------------------------------------
  'C0092': (state, entry) => {
    if (entry.effectId !== 'C0092-E2') return;

    // "you may" — use optional effect prompt
    if (!entry.optionalApproved) {
      state.pendingOptionalEffect = {
        chainEntryId: entry.id,
        sourceCardId: entry.sourceCardInstanceId,
        effectId: 'C0092-E2',
        cardName: 'Sea King Krakaan',
        effectDescription: 'You may move the top card of your deck to your Essence area.',
        owner: entry.owner,
      };
      return;
    }

    const player = entry.owner;
    const deck = state.players[player].deck;
    if (deck.length > 0) {
      const topCardId = deck[0];
      moveCard(state, topCardId, 'essence');
      const def = getCardDefForInstance(state, topCardId);
      addLog(state, player, 'effect', `Sea King Krakaan — Moved ${def.name} from deck to Essence`);
    } else {
      addLog(state, player, 'effect', 'Sea King Krakaan — Deck is empty');
    }
  },

  // --------------------------------------------------------
  // C0075 — Aquaconda
  // ACTIVATE: If 3+ other MICROMON characters + Field is "Micromon Beach" → discard 1 from opponent Essence
  // --------------------------------------------------------
  'C0075': (state, entry) => {
    if (entry.effectId !== 'C0075-E1') return;

    const player = entry.owner;
    const opponent = getOpponent(player);

    // Validate: 3+ OTHER MICROMON characters (not counting Aquaconda itself)
    const kingdom = state.players[player].kingdom;
    const battlefield = state.players[player].battlefield;
    let micromonCount = 0;
    for (const id of [...kingdom, ...battlefield]) {
      if (id === entry.sourceCardInstanceId) continue; // "other"
      try {
        const cDef = getCardDefForInstance(state, id);
        if (cDef.cardType !== 'character') continue;
        if ((cDef as CharacterCardDef).characteristics.includes('micromon')) micromonCount++;
      } catch { /* skip */ }
    }
    // Oceanic Abyss E2 — virtual MICROMON character
    micromonCount += oceanicAbyssVirtualCharCount(state, player, { characteristic: 'micromon' });

    if (micromonCount < 3) {
      addLog(state, player, 'effect', `Aquaconda — Only ${micromonCount} other MICROMON character(s), need 3+. Effect fizzles.`);
      return;
    }

    // Validate: Field card is "Micromon Beach"
    if (!fieldHasName(state, player, 'Micromon Beach')) {
      addLog(state, player, 'effect', 'Aquaconda — Field card is not "Micromon Beach". Effect fizzles.');
      return;
    }

    // Validate: Opponent has essence to discard
    const opEssence = [...state.players[opponent].essence];
    if (opEssence.length === 0) {
      addLog(state, player, 'effect', "Aquaconda — Opponent has no Essence to discard. Effect fizzles.");
      return;
    }

    // Choose 1 from opponent's Essence to discard
    if (opEssence.length > 0) {
      state.pendingTargetChoice = {
        effectId: 'C0075-E1',
        sourceCardId: entry.sourceCardInstanceId,
        owner: player,
        description: "Choose 1 card from your opponent's Essence to discard",
        validTargetIds: opEssence,
      };
      addLog(state, player, 'effect', "Aquaconda — Choose a card from opponent's Essence to discard");
    } else {
      addLog(state, player, 'effect', "Aquaconda — Opponent has no Essence to discard");
    }
  },

  // --------------------------------------------------------
  // C0074 — Spike the Impaler
  // ACTIVATE: Expel from hand → if 3+ MICROMON characters, search deck for 1 MICROMON Character → hand
  // --------------------------------------------------------
  'C0074': (state, entry) => {
    if (entry.effectId !== 'C0074-E2') return;

    const player = entry.owner;

    // Count MICROMON characters controlled (kingdom + battlefield)
    const kingdom = state.players[player].kingdom;
    const battlefield = state.players[player].battlefield;
    let micromonCount = 0;
    for (const id of [...kingdom, ...battlefield]) {
      try {
        const cDef = getCardDefForInstance(state, id);
        if (cDef.cardType !== 'character') continue;
        if ((cDef as CharacterCardDef).characteristics.includes('micromon')) micromonCount++;
      } catch { /* skip */ }
    }
    // Oceanic Abyss E2 — virtual MICROMON character
    micromonCount += oceanicAbyssVirtualCharCount(state, player, { characteristic: 'micromon' });

    if (micromonCount < 3) {
      addLog(state, player, 'effect', `Spike the Impaler — Only ${micromonCount} MICROMON character(s), need 3+. Effect fizzles.`);
      return;
    }

    // Search deck for MICROMON characters
    const deck = state.players[player].deck;
    const validTargets = deck.filter((id) => {
      try {
        const cDef = getCardDefForInstance(state, id);
        if (cDef.cardType !== 'character') return false;
        return (cDef as CharacterCardDef).characteristics.includes('micromon');
      } catch { return false; }
    });

    if (validTargets.length > 0) {
      state.pendingSearch = {
        effectId: 'C0074-E2',
        owner: player,
        criteria: 'MICROMON Character',
        validCardIds: validTargets,
        sourceCardName: 'Spike the Impaler',
      };
      addLog(state, player, 'effect', 'Spike the Impaler — Search your deck for a MICROMON Character');
    } else {
      shuffleDeck(state, player);
      addLog(state, player, 'effect', 'Spike the Impaler — No MICROMON characters found in deck');
    }
  },

  // --------------------------------------------------------
  // S0037 — Dangerous Waters
  // Target 1 Sea Monster (TC ≤ 2) in your Essence → put in play
  // End of turn: if still in play and Turn Marker ≤ 4, discard it
  // --------------------------------------------------------
  'S0037': (state, entry) => {
    const player = entry.owner;

    // Check field has terra or water symbol
    if (!fieldHasSymbol(state, player, 'terra') && !fieldHasSymbol(state, player, 'water')) {
      addLog(state, player, 'effect', 'Dangerous Waters — Field card has no Terra or Water symbol. Effect fizzles.');
      return;
    }

    // Find valid targets: Sea Monster characters with TC ≤ 2 in essence
    const essence = state.players[player].essence;
    const validTargets = essence.filter((id) => {
      try {
        const def = getCardDefForInstance(state, id);
        if (def.cardType !== 'character') return false;
        const charDef = def as CharacterCardDef;
        if (!charDef.attributes.includes('Sea Monster')) return false;
        if (charDef.turnCost > 2) return false;
        return true;
      } catch { return false; }
    });

    if (validTargets.length === 0) {
      addLog(state, player, 'effect', 'Dangerous Waters — No valid Sea Monster (TC ≤ 2) in Essence. Effect fizzles.');
      return;
    }

    // Set up target choice
    state.pendingTargetChoice = {
      effectId: 'S0037-E1',
      sourceCardId: entry.sourceCardInstanceId,
      owner: player,
      description: 'Choose a Sea Monster Character (TC ≤ 2) from your Essence to put in play',
      validTargetIds: validTargets,
    };
    addLog(state, player, 'effect', 'Dangerous Waters — Choose a Sea Monster from your Essence');
  },

  // --------------------------------------------------------
  // C0091 — Sea Queen Argelia
  // TRIGGER: When deals showdown damage, may discard 2 from opponent's Essence
  // --------------------------------------------------------
  'C0091': (state, entry) => {
    if (entry.effectId !== 'C0091-E1') return;

    const player = entry.owner;
    const opponent = getOpponent(player);

    // Check opponent has essence to discard
    const opEssence = [...state.players[opponent].essence];

    if (opEssence.length === 0) {
      addLog(state, player, 'effect', "Sea Queen Argelia — Opponent has no Essence. Effect skipped.");
      return;
    }

    // Optional "may" effect — Category A
    if (!entry.optionalApproved) {
      state.pendingOptionalEffect = {
        chainEntryId: entry.id,
        effectId: 'C0091-E1',
        sourceCardId: entry.sourceCardInstanceId,
        cardName: 'Sea Queen Argelia',
        effectDescription: "Discard 2 cards from your opponent's Essence area?",
        owner: player,
      };
      return;
    }

    // Approved — let player choose which cards to discard from opponent's essence
    if (opEssence.length === 1) {
      // Only 1 card — auto-discard it
      moveCard(state, opEssence[0], 'discard');
      const cardName = getCardDefForInstance(state, opEssence[0]).name;
      addLog(state, player, 'effect', `Sea Queen Argelia — Discarded ${cardName} from opponent's Essence`);
    } else {
      // 2+ cards — let player choose
      state.pendingTargetChoice = {
        effectId: 'C0091-E1-pick1',
        sourceCardId: entry.sourceCardInstanceId,
        owner: player,
        description: "Choose a card from your opponent's Essence to discard (1 of 2)",
        validTargetIds: opEssence,
      };
    }
  },

  // --------------------------------------------------------
  // S0044 — Unknown Pathway
  // E1 (on play): If Field has Terra, look at top 3 deck cards → 1 hand, 1 essence, 1 discard
  // E2 (activate from essence): Remove 1 counter from any card on the field
  // --------------------------------------------------------
  'S0044': (state, entry) => {
    const player = entry.owner;

    // E2: Activate from essence — counter removal
    if (entry.effectId === 'S0044-E2') {
      // Find all cards in kingdom+battlefield (both players) that have counters
      const cardsWithCounters: string[] = [];
      for (const p of ['player1', 'player2'] as PlayerId[]) {
        const allInPlay = [
          ...state.players[p].kingdom,
          ...state.players[p].battlefield,
        ];
        for (const id of allInPlay) {
          const card = state.cards[id];
          if (card && card.counters.length > 0) {
            cardsWithCounters.push(id);
          }
        }
      }

      if (cardsWithCounters.length === 0) {
        addLog(state, player, 'effect', 'Unknown Pathway — No cards with counters on the field');
        return;
      }

      state.pendingTargetChoice = {
        effectId: 'S0044-E2',
        sourceCardId: entry.sourceCardInstanceId,
        owner: player,
        description: 'Choose a card to remove 1 counter from',
        validTargetIds: cardsWithCounters,
      };
      addLog(state, player, 'effect', 'Unknown Pathway — Choose a card to remove a counter from');
      return;
    }

    // E1: On play — look at top 3 deck cards, distribute
    if (!fieldHasSymbol(state, player, 'terra')) {
      addLog(state, player, 'effect', 'Unknown Pathway — Field has no Terra symbol. Effect fizzles.');
      return;
    }

    const deck = state.players[player].deck;
    const topCards = deck.slice(0, Math.min(3, deck.length));

    if (topCards.length === 0) {
      addLog(state, player, 'effect', 'Unknown Pathway — Deck is empty');
      return;
    }

    if (topCards.length === 1) {
      // Only 1 card — it goes to hand
      moveCard(state, topCards[0], 'hand');
      const def = getCardDefForInstance(state, topCards[0]);
      addLog(state, player, 'effect', `Unknown Pathway — Only 1 card in deck, ${def.name} moved to hand`);
      return;
    }

    if (topCards.length === 2) {
      // 2 cards — pick 1 for hand, other goes to essence
      state.pendingSearch = {
        effectId: 'S0044-E1-hand',
        owner: player,
        criteria: 'Choose 1 card for your hand (the other goes to Essence)',
        validCardIds: [...topCards],
        displayCardIds: [...topCards],
        sourceCardName: 'Unknown Pathway',
      };
      return;
    }

    // 3 cards — pick 1 for hand, then pick 1 for essence, last auto-discards
    state.pendingSearch = {
      effectId: 'S0044-E1-hand',
      owner: player,
      criteria: 'Choose 1 card for your hand',
      validCardIds: [...topCards],
      displayCardIds: [...topCards],
      sourceCardName: 'Unknown Pathway',
    };
  },

  // --------------------------------------------------------
  // C0090 — Megalino
  // ACTIVATE: If you control "Krakaan", put this card from hand in play
  // --------------------------------------------------------
  'C0090': (state, entry) => {
    if (entry.effectId !== 'C0090-E1') return;

    const player = entry.owner;
    const card = state.cards[entry.sourceCardInstanceId];

    // Validate: card must still be in hand
    if (!card || card.zone !== 'hand') {
      addLog(state, player, 'effect', 'Megalino — Card no longer in hand. Effect fizzles.');
      return;
    }

    // Validate: player controls a character named "Krakaan"
    const kingdom = state.players[player].kingdom;
    const battlefield = state.players[player].battlefield;
    const hasKrakaan = [...kingdom, ...battlefield].some((id) => {
      try {
        const def = getCardDefForInstance(state, id);
        return cardMatchesName(def, 'Krakaan');
      } catch { return false; }
    });

    if (!hasKrakaan) {
      addLog(state, player, 'effect', 'Megalino — No "Krakaan" controlled. Effect fizzles.');
      return;
    }

    // Move from hand to kingdom
    moveCard(state, entry.sourceCardInstanceId, 'kingdom');
    card.state = 'healthy';

    // Create a solo team
    const teamId = generateId('team');
    state.teams[teamId] = {
      id: teamId,
      owner: player,
      characterIds: [entry.sourceCardInstanceId],
      hasLead: true,
      isAttacking: false,
      isBlocking: false,
    };
    card.teamId = teamId;

    addLog(state, player, 'effect', 'Megalino — Put in play from hand');

    // Check for "put-in-play-sea-monster" triggers on other characters (e.g., Krakaan)
    // Megalino is a Sea Monster, so entering play triggers Krakaan's E2
    const allInPlay = [
      ...state.players[player].kingdom,
      ...state.players[player].battlefield,
    ];
    for (const otherId of allInPlay) {
      if (otherId === entry.sourceCardInstanceId) continue;
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
            id: `trigger_${otherId}_${eff.id}_${entry.sourceCardInstanceId}`,
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
  },

  // --------------------------------------------------------
  // A0035 — Aquabatics
  // Discard 2 from opponent's Essence, then if your Essence > opponent's → win 1 BR
  // --------------------------------------------------------
  'A0035': (state, entry) => {
    const player = entry.owner;
    const opponent = getOpponent(player);

    const opEssence = [...state.players[opponent].essence];
    if (opEssence.length === 0) {
      // No essence to discard — still check BR condition (unlikely to win)
      if (state.players[player].essence.length > state.players[opponent].essence.length) {
        // Award 1 BR
        const loserDeck = state.players[opponent].deck;
        if (loserDeck.length > 0) {
          const brCardId = loserDeck.shift()!;
          state.cards[brCardId].zone = 'battle-rewards';
          state.players[opponent].battleRewards.push(brCardId);
          addLog(state, player, 'effect', 'Aquabatics — You win 1 Battle Reward!');
        }
      } else {
        addLog(state, player, 'effect', 'Aquabatics — Essence not greater, no Battle Reward');
      }
      return;
    }

    // Set up interactive pick for first discard
    state.pendingTargetChoice = {
      effectId: 'A0035-E1-pick1',
      sourceCardId: entry.sourceCardInstanceId,
      owner: player,
      description: "Choose a card from your opponent's Essence to discard (1 of 2)",
      validTargetIds: opEssence,
    };
  },

  // --------------------------------------------------------
  // A0039 — Torrential Sludge
  // If target's Leader Value < user's Leader Value → move target to bottom of owner's deck
  // Expert{Hydroon}: move to owner's Essence instead
  // --------------------------------------------------------
  'A0039': (state, entry) => {
    const player = entry.owner;

    if (!entry.userId || !entry.targetIds || entry.targetIds.length === 0) return;

    const user = getCard(state, entry.userId);
    const target = getCard(state, entry.targetIds[0]);

    // Check user still on battlefield
    if (user.zone !== 'battlefield' || user.owner !== player) {
      addLog(state, player, 'effect', 'Torrential Sludge — User no longer on battlefield. Effect fizzles.');
      return;
    }

    // Check target still on battlefield
    if (target.zone !== 'battlefield') {
      addLog(state, player, 'effect', 'Torrential Sludge — Target no longer on battlefield. Effect fizzles.');
      return;
    }

    const userStats = getEffectiveStats(state, entry.userId);
    const targetStats = getEffectiveStats(state, entry.targetIds[0]);

    const userDef = getCardDefForInstance(state, entry.userId);
    const targetDef = getCardDefForInstance(state, entry.targetIds[0]);

    if (targetStats.lead >= userStats.lead) {
      addLog(
        state,
        player,
        'effect',
        `Torrential Sludge — ${targetDef.name} (Lead ${targetStats.lead}) is not lower than ${userDef.name} (Lead ${userStats.lead}). Effect fizzles.`
      );
      return;
    }

    // Check Expert{Hydroon} — user must have name "Hydroon"
    const isExpert = cardMatchesName(userDef, 'Hydroon');

    if (isExpert) {
      // Expert: move target to owner's Essence
      moveCard(state, entry.targetIds[0], 'essence');
      addLog(
        state,
        player,
        'effect',
        `Torrential Sludge (Expert: Hydroon) — Moved ${targetDef.name} to Essence`
      );
    } else {
      // Base: move target to bottom of owner's deck
      moveCardToBottomOfDeck(state, entry.targetIds[0]);
      addLog(
        state,
        player,
        'effect',
        `Torrential Sludge — Moved ${targetDef.name} to bottom of deck`
      );
    }
  },

  // --------------------------------------------------------
  // A0040 — Micromon Rage
  // Double the user's current Stat Values this turn,
  // then at end of turn deal 1 Damage to the user.
  // --------------------------------------------------------
  'A0040': (state, entry) => {
    const player = entry.owner;

    if (!entry.userId) return;

    const user = getCard(state, entry.userId);

    // Check user still on battlefield
    if (user.zone !== 'battlefield' || user.owner !== player) {
      addLog(state, player, 'effect', 'Micromon Rage — User no longer on battlefield. Effect fizzles.');
      return;
    }

    // Get current effective stats and add modifier equal to them (doubling)
    const currentStats = getEffectiveStats(state, entry.userId);
    user.statModifiers.push({
      lead: currentStats.lead,
      support: currentStats.support,
      source: 'A0040-MicromonRage',
      duration: 'until-end-of-turn',
    });

    const userDef = getCardDefForInstance(state, entry.userId);
    addLog(
      state,
      player,
      'effect',
      `Micromon Rage — ${userDef.name} stats doubled (now +${currentStats.lead}/+${currentStats.support})`
    );

    // Register lingering effect for end-of-turn damage
    state.lingeringEffects.push({
      id: `micromon_rage_${entry.id}`,
      source: entry.sourceCardInstanceId,
      effectDescription: 'At end of turn, deal 1 Damage to the user.',
      duration: 'until-end-of-turn',
      appliedTurn: state.turnNumber,
      data: { targetId: entry.userId, owner: player },
    });
  },
};
