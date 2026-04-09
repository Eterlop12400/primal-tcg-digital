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

  // Remove from current zone
  removeFromZone(state, instanceId, fromPlayer, card.zone);

  // Handle new instance rule: moving zones = new instance
  // (except Kingdom <-> Battlefield)
  const isKingdomBattlefieldMove =
    (card.zone === 'kingdom' && toZone === 'battlefield') ||
    (card.zone === 'battlefield' && toZone === 'kingdom');

  if (!isKingdomBattlefieldMove && card.zone !== toZone) {
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
  if (inPlayZones.includes(card.zone) && !inPlayZones.includes(toZone)) {
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

  return { lead, support };
}

// --- Team Power ---

export function calculateTeamPower(state: GameState, team: Team): number {
  let power = 0;

  if (team.characterIds.length === 0) return 0;

  for (let i = 0; i < team.characterIds.length; i++) {
    const charId = team.characterIds[i];
    const card = state.cards[charId];
    if (!card || card.zone !== 'battlefield') continue;

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
  return def.name === name;
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

// --- Logging ---

export function addLog(
  state: GameState,
  player: PlayerId,
  action: string,
  details?: string
): void {
  state.log.push({
    timestamp: Date.now(),
    turn: state.turnNumber,
    phase: state.phase,
    player,
    action,
    details,
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
