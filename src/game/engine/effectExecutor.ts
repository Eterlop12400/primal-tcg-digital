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
  // (This is checked during showdown resolution, not here)
  // --------------------------------------------------------
  'S0039': (state, entry) => {
    const player = entry.owner;
    const opponent = getOpponent(player);

    // Award 1 additional Battle Reward — cards go from opponent's deck to opponent's BR zone
    // (when opponent's BR reaches 10, the current player wins)
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
};
