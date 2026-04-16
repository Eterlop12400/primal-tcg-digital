// ============================================================
// Game Engine Utilities
// ============================================================

import {
  GameState,
  CardInstance,
  PlayerId,
  Zone,
  CharacterCardDef,
  CardDef,
  Symbol,
  StatModifier,
  Counter,
  Team,
} from '../types';
import { getCardDef } from '../cards';

let instanceCounter = 0;

export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${++instanceCounter}`;
}

export function resetIdCounter(): void {
  instanceCounter = 0;
}

export function getOpponent(player: PlayerId): PlayerId {
  return player === 'player1' ? 'player2' : 'player1';
}

// --- Card Instance Helpers ---

export function createCardInstance(
  defId: string,
  owner: PlayerId,
  zone: Zone
): CardInstance {
  const def = getCardDef(defId);
  return {
    instanceId: generateId('card'),
    defId,
    owner,
    zone,
    state: def.cardType === 'character' ? 'healthy' : undefined,
    counters: [],
    attachedCards: [],
    statModifiers: [],
    isNegated: false,
    usedEffects: [],
  };
}

export function getCard(state: GameState, instanceId: string): CardInstance {
  const card = state.cards[instanceId];
  if (!card) {
    throw new Error(`Card instance not found: ${instanceId}`);
  }
  return card;
}

export function getCardDefForInstance(state: GameState, instanceId: string): CardDef {
  const card = getCard(state, instanceId);
  return getCardDef(card.defId);
}

// --- Zone Helpers ---

export function getCardsInZone(
  state: GameState,
  player: PlayerId,
  zone: Zone
): CardInstance[] {
  const playerState = state.players[player];
  let ids: string[];

  switch (zone) {
    case 'deck': ids = playerState.deck; break;
    case 'hand': ids = playerState.hand; break;
    case 'kingdom': ids = playerState.kingdom; break;
    case 'battlefield': ids = playerState.battlefield; break;
    case 'essence': ids = playerState.essence; break;
    case 'discard': ids = playerState.discard; break;
    case 'expel': ids = playerState.expel; break;
    case 'battle-rewards': ids = playerState.battleRewards; break;
    case 'field-area': ids = playerState.fieldCard ? [playerState.fieldCard] : []; break;
    default: ids = []; break;
  }

  return ids.map((id) => getCard(state, id));
}

export function moveCard(
  state: GameState,
  instanceId: string,
  toZone: Zone,
  toPlayer?: PlayerId
): void {
  const card = getCard(state, instanceId);
  const fromPlayer = card.owner;
  const targetPlayer = toPlayer ?? card.owner;

  const fromZone = card.zone;

  // Remove from current zone
  removeFromZone(state, instanceId, fromPlayer, fromZone);

  // Handle new instance rule: moving zones = new instance
  // (except Kingdom <-> Battlefield)
  const isKingdomBattlefieldMove =
    (fromZone === 'kingdom' && toZone === 'battlefield') ||
    (fromZone === 'battlefield' && toZone === 'kingdom');

  if (!isKingdomBattlefieldMove && fromZone !== toZone) {
    // Reset temporary state for new instance
    card.statModifiers = [];
    card.isNegated = false;
    card.usedEffects = [];
    if (card.state !== undefined) {
      card.state = 'healthy';
    }
    card.battleRole = undefined;
    card.teamId = undefined;
  }

  // Update zone
  card.zone = toZone;

  // Add to new zone
  addToZone(state, instanceId, targetPlayer, toZone);

  // Handle attached cards when leaving play
  const inPlayZones: Zone[] = ['kingdom', 'battlefield', 'field-area'];
  if (inPlayZones.includes(fromZone) && !inPlayZones.includes(toZone)) {
    // Detach all attached cards -> discard
    for (const attachedId of [...card.attachedCards]) {
      const attached = getCard(state, attachedId);
      attached.attachedTo = undefined;
      moveCard(state, attachedId, 'discard');
    }
    card.attachedCards = [];

    // Remove counters
    card.counters = [];
  }

  // Check field card discard triggers (in-play card moved to discard)
  if (toZone === 'discard' && inPlayZones.includes(fromZone)) {
    for (const p of ['player1', 'player2'] as PlayerId[]) {
      const fieldId = state.players[p].fieldCard;
      if (!fieldId) continue;
      const fieldDef = getCardDefForInstance(state, fieldId);
      for (const effect of fieldDef.effects) {
        if (
          effect.type === 'trigger' &&
          effect.triggerCondition === 'in-play-card-discarded' &&
          effect.oncePerTurn
        ) {
          const fCard = getCard(state, fieldId);
          if (fCard.usedEffects.includes(effect.id)) continue;
          if (state.phase !== 'main' && !state.phase.startsWith('battle')) continue;
          state.pendingTriggers.push({
            id: `trigger_${fieldId}_${effect.id}`,
            type: 'trigger-effect',
            sourceCardInstanceId: fieldId,
            effectId: effect.id,
            resolved: false,
            negated: false,
            owner: p,
          });
        }
      }
    }
  }

  // Oceanic Abyss (S0042) — character discarded from play → queue for essence redirect prompt
  if (toZone === 'discard' && inPlayZones.includes(fromZone) && card.state !== undefined) {
    // card.state !== undefined means it's a character card
    const owner = card.owner;
    if (hasOceanicAbyssInPlay(state, owner)) {
      if (!state.pendingEssenceRedirects) state.pendingEssenceRedirects = [];
      state.pendingEssenceRedirects.push(instanceId);
    }
  }
}

function removeFromZone(
  state: GameState,
  instanceId: string,
  player: PlayerId,
  zone: Zone
): void {
  const playerState = state.players[player];

  switch (zone) {
    case 'deck':
      playerState.deck = playerState.deck.filter((id) => id !== instanceId);
      break;
    case 'hand':
      playerState.hand = playerState.hand.filter((id) => id !== instanceId);
      break;
    case 'kingdom':
      playerState.kingdom = playerState.kingdom.filter((id) => id !== instanceId);
      break;
    case 'battlefield':
      playerState.battlefield = playerState.battlefield.filter((id) => id !== instanceId);
      break;
    case 'essence':
      playerState.essence = playerState.essence.filter((id) => id !== instanceId);
      break;
    case 'discard':
      playerState.discard = playerState.discard.filter((id) => id !== instanceId);
      break;
    case 'expel':
      playerState.expel = playerState.expel.filter((id) => id !== instanceId);
      break;
    case 'battle-rewards':
      playerState.battleRewards = playerState.battleRewards.filter((id) => id !== instanceId);
      break;
    case 'field-area':
      if (playerState.fieldCard === instanceId) {
        playerState.fieldCard = undefined;
      }
      break;
  }
}

function addToZone(
  state: GameState,
  instanceId: string,
  player: PlayerId,
  zone: Zone
): void {
  const playerState = state.players[player];

  switch (zone) {
    case 'deck':
      playerState.deck.push(instanceId);
      break;
    case 'hand':
      playerState.hand.push(instanceId);
      break;
    case 'kingdom':
      playerState.kingdom.push(instanceId);
      break;
    case 'battlefield':
      playerState.battlefield.push(instanceId);
      break;
    case 'essence':
      playerState.essence.push(instanceId);
      break;
    case 'discard':
      playerState.discard.push(instanceId);
      break;
    case 'expel':
      playerState.expel.push(instanceId);
      break;
    case 'battle-rewards':
      playerState.battleRewards.push(instanceId);
      break;
    case 'field-area':
      playerState.fieldCard = instanceId;
      break;
  }
}

// Move card to top of deck (index 0)
export function moveCardToTopOfDeck(state: GameState, instanceId: string): void {
  const card = getCard(state, instanceId);
  removeFromZone(state, instanceId, card.owner, card.zone);
  card.zone = 'deck';
  state.players[card.owner].deck.unshift(instanceId);
}

// Move card to bottom of deck
export function moveCardToBottomOfDeck(state: GameState, instanceId: string): void {
  const card = getCard(state, instanceId);
  removeFromZone(state, instanceId, card.owner, card.zone);
  card.zone = 'deck';
  state.players[card.owner].deck.push(instanceId);
}

// --- Draw Cards ---

export function drawCards(state: GameState, player: PlayerId, count: number): string[] {
  const drawn: string[] = [];
  const playerState = state.players[player];

  for (let i = 0; i < count; i++) {
    if (playerState.deck.length === 0) break;
    const cardId = playerState.deck.shift()!;
    const card = getCard(state, cardId);
    card.zone = 'hand';
    playerState.hand.push(cardId);
    drawn.push(cardId);
  }

  return drawn;
}

// --- Shuffle ---

export function shuffleDeck(state: GameState, player: PlayerId): void {
  const deck = state.players[player].deck;
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

// --- Character Stat Calculation ---

export function getEffectiveStats(
  state: GameState,
  instanceId: string
): { lead: number; support: number } {
  const card = getCard(state, instanceId);
  const def = getCardDef(card.defId);

  if (def.cardType !== 'character') {
    return { lead: 0, support: 0 };
  }

  const charDef = def as CharacterCardDef;
  const baseStats =
    card.state === 'injured' ? charDef.injuredStats : charDef.healthyStats;

  let lead = baseStats.lead;
  let support = baseStats.support;

  // Apply +1/+1 and -1/-1 counters
  for (const counter of card.counters) {
    if (counter.type === 'plus-one') {
      lead += 1;
      support += 1;
    } else if (counter.type === 'minus-one') {
      lead -= 1;
      support -= 1;
    }
  }

  // Apply stat modifiers
  for (const mod of card.statModifiers) {
    lead += mod.lead;
    support += mod.support;
  }

  // Apply ongoing effects (e.g., Rosita's team-based buffs)
  if (charDef.effects) {
    for (const effect of charDef.effects) {
      if (effect.type !== 'ongoing') continue;

      // Skip ongoing effects that are not Valid when character is injured
      if (card.state === 'injured' && !effect.isValid) continue;

      // Check if card is in a team
      const team = getTeamForCharacter(state, instanceId);
      if (!team) continue;

      // C0086 — Rosita: +1/+1 while teamed with {Mercenary} or {Slayer}
      if (effect.id === 'C0086-E1') {
        if (teamHasCharacterWithAttribute(state, team, 'Mercenary', instanceId)) {
          lead += 1;
          support += 1;
        }
      } else if (effect.id === 'C0086-E2') {
        if (teamHasCharacterWithAttribute(state, team, 'Slayer', instanceId)) {
          lead += 1;
          support += 1;
        }
      }

      // C0090 — Megalino: +3/+0 if controlling 3+ [Sea Monster] characters
      if (effect.id === 'C0090-E2') {
        const ownerKingdom = state.players[card.owner].kingdom;
        const ownerBattlefield = state.players[card.owner].battlefield;
        let seaMonsterCount = 0;
        for (const id of [...ownerKingdom, ...ownerBattlefield]) {
          try {
            const cDef = getCardDef(state.cards[id]?.defId);
            if (cDef.cardType === 'character' && (cDef as CharacterCardDef).attributes.includes('Sea Monster')) {
              seaMonsterCount++;
            }
          } catch { /* skip */ }
        }
        // Oceanic Abyss E2 — virtual Sea Monster character
        seaMonsterCount += oceanicAbyssVirtualCharCount(state, card.owner, { attribute: 'Sea Monster' });
        if (seaMonsterCount >= 3) {
          lead += 3;
        }
      }
    }
  }

  // External ongoing buffs from other characters
  // C0091 — Sea Queen Argelia: Characters named "Krakaan" get +6/+0
  if (cardMatchesName(charDef, 'Krakaan')) {
    const ownerKingdom = state.players[card.owner].kingdom;
    const ownerBattlefield = state.players[card.owner].battlefield;
    for (const otherId of [...ownerKingdom, ...ownerBattlefield]) {
      if (otherId === instanceId) continue;
      const otherCard = state.cards[otherId];
      if (!otherCard || otherCard.isNegated) continue;
      try {
        const otherDef = getCardDef(otherCard.defId);
        if (otherDef.id !== 'C0091') continue;
        const otherCharDef = otherDef as CharacterCardDef;
        const argeliaEffect = otherCharDef.effects.find(e => e.id === 'C0091-E2');
        if (!argeliaEffect) continue;
        // Skip if Argelia is injured and effect is not Valid
        if (otherCard.state === 'injured' && !argeliaEffect.isValid) continue;
        lead += 6;
      } catch { /* skip */ }
    }
  }

  return { lead, support };
}

// --- Team Power ---

export function calculateTeamPower(state: GameState, team: Team): number {
  let power = 0;

  if (team.characterIds.length === 0) return 0;

  for (let i = 0; i < team.characterIds.length; i++) {
    const charId = team.characterIds[i];
    const card = state.cards[charId];
    if (!card || (card.zone !== 'battlefield' && card.zone !== 'kingdom')) continue;

    const stats = getEffectiveStats(state, charId);

    if (i === 0 && team.hasLead) {
      // Team lead contributes lead value
      power += stats.lead;
    } else {
      // Team support contributes support value
      power += stats.support;
    }
  }

  return power;
}

// --- Damage ---

export function dealDamage(
  state: GameState,
  targetId: string,
  amount: number
): { injured: boolean; discarded: boolean } {
  if (amount <= 0) return { injured: false, discarded: false };

  const card = getCard(state, targetId);
  if (card.state === undefined) return { injured: false, discarded: false };

  // Check for damage prevention lingering effects (e.g., Deflection)
  const preventIdx = state.lingeringEffects.findIndex(
    (e) => e.data?.preventNextDamage && e.data?.targetId === targetId
  );
  if (preventIdx !== -1) {
    // Consume the prevention — damage becomes 0
    state.lingeringEffects.splice(preventIdx, 1);
    addLog(state, card.owner, 'damage-prevented', `Damage to ${getCardDef(card.defId).name} was prevented!`);
    return { injured: false, discarded: false };
  }

  if (card.state === 'healthy') {
    if (amount === 1) {
      card.state = 'injured';
      return { injured: true, discarded: false };
    } else {
      // 2+ damage to healthy = discard (NOT injured first)
      moveCard(state, targetId, 'discard');
      return { injured: false, discarded: true };
    }
  } else {
    // Injured + any damage = discard
    moveCard(state, targetId, 'discard');
    return { injured: false, discarded: true };
  }
}

// --- Field Card Helpers ---

export function fieldHasSymbol(
  state: GameState,
  player: PlayerId,
  symbol: Symbol
): boolean {
  const fieldId = state.players[player].fieldCard;
  if (!fieldId) return false;
  const def = getCardDefForInstance(state, fieldId);
  return def.symbols.includes(symbol);
}

export function fieldHasName(
  state: GameState,
  player: PlayerId,
  name: string
): boolean {
  const fieldId = state.players[player].fieldCard;
  if (!fieldId) return false;
  const def = getCardDefForInstance(state, fieldId);
  return cardMatchesName(def, name);
}

/** Check if a card definition matches a given name (checks both name and names[]) */
export function cardMatchesName(def: { name: string; names?: string[] }, name: string): boolean {
  if (def.name === name) return true;
  if (def.names && def.names.includes(name)) return true;
  return false;
}

// --- Oceanic Abyss (S0042) Helpers ---

/** Check if a player has S0042 Oceanic Abyss (permanent, not negated) in play */
export function hasOceanicAbyssInPlay(state: GameState, player: PlayerId): boolean {
  const kingdom = state.players[player].kingdom;
  for (const id of kingdom) {
    const card = state.cards[id];
    if (!card || card.isNegated) continue;
    if (card.defId === 'S0042') return true;
  }
  return false;
}

/**
 * Oceanic Abyss E2 — virtual character count.
 * Returns 1 if player has S0042 in play and the virtual character matches the filter criteria.
 * Virtual character is: Water + Terra symbols, [Sea Monster] attribute, MICROMON characteristic.
 */
export function oceanicAbyssVirtualCharCount(
  state: GameState,
  player: PlayerId,
  opts?: { attribute?: string; characteristic?: string; symbol?: Symbol }
): number {
  if (!hasOceanicAbyssInPlay(state, player)) return 0;
  if (opts?.attribute && opts.attribute !== 'Sea Monster') return 0;
  if (opts?.characteristic && opts.characteristic !== 'micromon') return 0;
  if (opts?.symbol && opts.symbol !== 'water' && opts.symbol !== 'terra') return 0;
  return 1;
}

/**
 * Setup the next essence redirect prompt from the pending queue.
 * Pops the first valid card from pendingEssenceRedirects, creates a lingering effect,
 * and sets pendingOptionalEffect for the player.
 */
export function setupNextEssenceRedirectPrompt(state: GameState): boolean {
  while (state.pendingEssenceRedirects && state.pendingEssenceRedirects.length > 0) {
    const cardId = state.pendingEssenceRedirects.shift()!;
    const card = state.cards[cardId];
    // Skip if card is no longer in discard (already moved by another effect)
    if (!card || card.zone !== 'discard') continue;

    const def = getCardDefForInstance(state, cardId);
    const lingeringId = `oceanic_abyss_redirect_${cardId}`;

    state.lingeringEffects.push({
      id: lingeringId,
      source: cardId,
      effectDescription: `Move ${def.name} to Essence instead of Discard Pile?`,
      duration: 'turn',
      appliedTurn: state.turnNumber,
      data: { redirectCardId: cardId },
    });

    state.pendingOptionalEffect = {
      lingeringEffectId: lingeringId,
      sourceCardId: cardId,
      effectId: 'S0042-E1',
      cardName: 'Oceanic Abyss',
      effectDescription: `Move ${def.name} to your Essence area instead of the Discard Pile?`,
      owner: card.owner,
    };

    return true; // prompt set up
  }

  // Queue exhausted
  state.pendingEssenceRedirects = undefined;
  return false;
}

// --- Character Attribute Check ---

export function characterHasAttribute(
  state: GameState,
  instanceId: string,
  attribute: string
): boolean {
  const def = getCardDefForInstance(state, instanceId);
  if (def.cardType !== 'character') return false;
  return (def as CharacterCardDef).attributes.includes(attribute);
}

// --- Team Helpers ---

export function getTeamForCharacter(
  state: GameState,
  instanceId: string
): Team | undefined {
  const card = getCard(state, instanceId);
  if (!card.teamId) return undefined;
  return state.teams[card.teamId];
}

export function teamHasCharacterWithAttribute(
  state: GameState,
  team: Team,
  attribute: string,
  excludeId?: string
): boolean {
  return team.characterIds.some(
    (id) => id !== excludeId && characterHasAttribute(state, id, attribute)
  );
}

// --- Protection Checks ---

/**
 * Check if a character is protected from opponent character effects.
 * Currently: Omtaba (C0082-E2) is unaffected by opponent's Character effects
 * while in a team with another {Slayer}.
 */
export function isProtectedFromCharacterEffects(
  state: GameState,
  targetId: string,
  effectOwner: PlayerId,
): boolean {
  const targetCard = state.cards[targetId];
  if (!targetCard) return false;
  // Only protects against opponent's effects
  if (targetCard.owner === effectOwner) return false;

  const def = getCardDefForInstance(state, targetId);
  if (def.cardType !== 'character') return false;

  // Check if target has the C0082-E2 ongoing effect
  const charDef = def as CharacterCardDef;
  const hasProtection = charDef.effects.some(
    (e) => e.id === 'C0082-E2' && e.type === 'ongoing'
  );
  if (!hasProtection) return false;

  // Check if teamed with another Slayer
  const team = getTeamForCharacter(state, targetId);
  if (!team) return false;

  return teamHasCharacterWithAttribute(state, team, 'Slayer', targetId);
}

// --- Dewzilla Camouflage Check ---
// C0076 Dewzilla ONGOING: If field is "Micromon Beach", Sea Monster characters
// in your Essence area gain CAMOUFLAGE (can't be targeted/discarded by opponent).

export function hasEssenceCamouflage(
  state: GameState,
  essenceCardId: string,
): boolean {
  const card = state.cards[essenceCardId];
  if (!card || card.zone !== 'essence') return false;

  const def = getCardDefForInstance(state, essenceCardId);
  if (def.cardType !== 'character') return false;

  const charDef = def as CharacterCardDef;
  if (!charDef.attributes.includes('Sea Monster')) return false;

  // Check if the card's owner has a non-negated Dewzilla (C0076) in kingdom/battlefield
  const owner = card.owner;
  const allInPlay = [
    ...state.players[owner].kingdom,
    ...state.players[owner].battlefield,
  ];

  const hasDewzilla = allInPlay.some((id) => {
    const c = state.cards[id];
    if (!c || c.isNegated) return false;
    try {
      const d = getCardDefForInstance(state, id);
      return d.id === 'C0076';
    } catch { return false; }
  });

  if (!hasDewzilla) return false;

  // Check if field card is "Micromon Beach"
  return fieldHasName(state, owner, 'Micromon Beach');
}

// --- Logging ---

export function addLog(
  state: GameState,
  player: PlayerId,
  action: string,
  details?: string,
  cardInstanceId?: string
): void {
  state.log.push({
    timestamp: Date.now(),
    turn: state.turnNumber,
    phase: state.phase,
    player,
    action,
    details,
    cardInstanceId,
  });
}

// --- Card Symbol Check ---

export function cardHasSymbol(state: GameState, instanceId: string, symbol: Symbol): boolean {
  const def = getCardDefForInstance(state, instanceId);
  return def.symbols.includes(symbol);
}

// --- Can Pay Hand Cost ---

export function canPayHandCost(
  state: GameState,
  player: PlayerId,
  cardDefId: string,
  excludeCardId?: string
): boolean {
  const def = getCardDef(cardDefId);
  if (def.cardType !== 'character' && def.cardType !== 'strategy') return false;

  const handCost = 'handCost' in def ? def.handCost : 0;
  if (handCost === 0) return true;

  const hand = state.players[player].hand;
  const availableCards = hand.filter((id) => id !== excludeCardId);

  // Need handCost cards with matching symbols
  const requiredSymbols = def.symbols;
  let matchCount = 0;

  for (const cardId of availableCards) {
    const cardDef = getCardDefForInstance(state, cardId);
    if (requiredSymbols.some((s) => cardDef.symbols.includes(s))) {
      matchCount++;
    }
    if (matchCount >= handCost) return true;
  }

  return false;
}
