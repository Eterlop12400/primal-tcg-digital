// ============================================================
// Starter Deck 2: Sea Invasion (Water/Terra — Sea Monster Theme)
// ============================================================

import {
  CharacterCardDef,
  StrategyCardDef,
  FieldCardDef,
  CardDef,
} from '../types';

// --- Character Cards ---

export const C0087: CharacterCardDef = {
  id: 'C0087',
  printNumber: '0087',
  name: 'Rococo',
  cardType: 'character',
  symbols: ['terra'],
  turnCost: 0,
  handCost: 0,
  healthyStats: { lead: 1, support: 0 },
  injuredStats: { lead: 2, support: 0 },
  attributes: ['Animal', 'Stone'],
  characteristics: [],
  imageFile: '2024-04-21T03_34_16.540ZC0087.jpg',
  effects: [
    {
      id: 'C0087-E1',
      type: 'trigger',
      isValid: true,
      triggerCondition: 'showdown-discard',
      effectDescription:
        'When this Character is discarded due to Showdown Damage, if your Field card has the name "Micromon Beach", you may search your deck for 1 "Rococo" and put it in play with a +1/+1 Counter.',
      oncePerTurn: false,
    },
  ],
};

export const C0093: CharacterCardDef = {
  id: 'C0093',
  printNumber: '0093',
  name: 'Linda The Puffer',
  cardType: 'character',
  symbols: ['water', 'terra'],
  turnCost: 0,
  handCost: 0,
  healthyStats: { lead: 0, support: 0 },
  injuredStats: { lead: 3, support: 0 },
  attributes: ['Animal', 'Female', 'Sea Monster', 'Therian'],
  characteristics: [],
  imageFile: '2024-04-21T03_34_38.298ZC0093.jpg',
  effects: [
    {
      id: 'C0093-E1',
      type: 'trigger',
      isValid: false,
      triggerCondition: 'sent-to-attack',
      effectDescription:
        'When this Character is sent out to Attack, if your Field card has a Water or Terra Symbol, you may draw 1 card, and if you do, move 1 card from your hand to the bottom of your deck.',
      oncePerTurn: false,
    },
  ],
};

// --- Field Card ---

export const F0006: FieldCardDef = {
  id: 'F0006',
  printNumber: '0006',
  name: 'Micromon Beach',
  cardType: 'field',
  symbols: ['terra', 'water'],
  imageFile: 'F0006.jpg',
  effects: [
    {
      id: 'F0006-E1',
      type: 'activate',
      isValid: true,
      timing: 'main',
      turnTiming: 'your-turn',
      effectDescription:
        'Apply 1 based on number of Terra/Water characters you control: 2+ → +1/+1 to 1 Character this turn; 4+ → Draw 1; 4+ → Discard 1 from opponent Essence, move 1 from your DP to Essence; 6+ → Ability cards cannot be played this turn.',
      oncePerTurn: true,
    },
  ],
};

// --- Strategy Cards ---

export const S0043: StrategyCardDef = {
  id: 'S0043',
  printNumber: '0043',
  name: 'Heavy Storm',
  cardType: 'strategy',
  symbols: ['water'],
  turnCost: 2,
  handCost: 1,
  keywords: [],
  imageFile: '2024-04-21T03_29_50.050ZS0043.jpg',
  effects: [
    {
      id: 'S0043-E1',
      type: 'trigger',
      isValid: false,
      effectDescription:
        "Discard 2 cards from your opponent's Essence area, then draw 1 card.",
      oncePerTurn: false,
    },
  ],
};

// --- Full Deck Card Pool (Starter Deck 2) ---
export const STARTER_DECK_2_CARDS: CardDef[] = [
  F0006, C0087, C0093, S0043,
];

// --- Pre-built 50-card Deck List (skeleton — to be filled when all cards are added) ---
export const STARTER_DECK_2_LIST: { cardId: string; count: number }[] = [
  { cardId: 'C0087', count: 3 },
  { cardId: 'C0093', count: 3 },
  { cardId: 'S0043', count: 3 },
];
