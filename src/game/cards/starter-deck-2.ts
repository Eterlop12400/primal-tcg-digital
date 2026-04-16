// ============================================================
// Starter Deck 2: Sea Invasion (Water/Terra — Sea Monster Theme)
// ============================================================

import {
  CharacterCardDef,
  StrategyCardDef,
  AbilityCardDef,
  FieldCardDef,
  CardDef,
} from '../types';

// --- Character Cards ---

export const C0074: CharacterCardDef = {
  id: 'C0074',
  printNumber: '0074',
  name: 'Spike the Impaler',
  cardType: 'character',
  symbols: ['terra'],
  turnCost: 2,
  handCost: 0,
  healthyStats: { lead: 3, support: 2 },
  injuredStats: { lead: 2, support: 1 },
  attributes: ['Animal', 'Masked'],
  characteristics: ['prime', 'micromon'],
  imageFile: '2026-02-19T21_15_03.392ZC0074.jpg',
  effects: [
    {
      id: 'C0074-E1',
      type: 'ongoing',
      isValid: true,
      effectDescription:
        'If your Field card is named "Micromon Beach", increase any Showdown Damage dealt to the Team Leader opposing this card by 1.',
      oncePerTurn: false,
    },
    {
      id: 'C0074-E2',
      type: 'activate',
      isValid: true,
      timing: 'main',
      turnTiming: 'your-turn',
      costDescription: 'Expel this card from your hand',
      effectDescription:
        'Expel this card from your hand: If you control 3 or more <MICROMON> Characters, search your deck for 1 <MICROMON> Character card and move it to your hand.',
      oncePerTurn: false,
      activateScope: 'name-turn',
    },
  ],
};

export const C0075: CharacterCardDef = {
  id: 'C0075',
  printNumber: '0075',
  name: 'Aquaconda',
  cardType: 'character',
  symbols: ['terra', 'water'],
  turnCost: 0,
  handCost: 0,
  healthyStats: { lead: 3, support: 0 },
  injuredStats: { lead: 0, support: 0 },
  attributes: ['Animal', 'Sea Monster'],
  characteristics: ['micromon'],
  imageFile: '2024-04-21T03_33_39.604ZC0075.jpg',
  effects: [
    {
      id: 'C0075-E1',
      type: 'activate',
      isValid: true,
      timing: 'main',
      turnTiming: 'your-turn',
      effectDescription:
        'If you control 3 or more other Characters with <MICROMON> and your Field card has the name "Micromon Beach", discard 1 card from your opponent\'s Essence area.',
      oncePerTurn: true,
    },
  ],
};

export const C0076: CharacterCardDef = {
  id: 'C0076',
  printNumber: '0076',
  name: 'Dewzilla',
  cardType: 'character',
  symbols: ['water', 'terra'],
  turnCost: 0,
  handCost: 0,
  healthyStats: { lead: 0, support: 2 },
  injuredStats: { lead: 0, support: 0 },
  attributes: ['Animal', 'Sea Monster'],
  characteristics: ['micromon'],
  imageFile: '2024-04-21T03_33_42.629ZC0076.jpg',
  effects: [
    {
      id: 'C0076-E1',
      type: 'ongoing',
      isValid: true,
      effectDescription:
        'If your Field card has the name "Micromon Beach", all Character cards with [Sea Monster] in your Essence area gain CAMOUFLAGE.',
      oncePerTurn: false,
    },
  ],
};

export const C0087: CharacterCardDef = {
  id: 'C0087',
  printNumber: '0087',
  name: 'Rococo',
  cardType: 'character',
  symbols: ['terra'],
  turnCost: 0,
  handCost: 0,
  healthyStats: { lead: 2, support: 0 },
  injuredStats: { lead: 1, support: 0 },
  attributes: ['Animal', 'Stone'],
  characteristics: ['micromon'],
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
  healthyStats: { lead: 3, support: 0 },
  injuredStats: { lead: 0, support: 0 },
  attributes: ['Animal', 'Female', 'Sea Monster', 'Therian'],
  characteristics: ['micromon'],
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

export const C0088: CharacterCardDef = {
  id: 'C0088',
  printNumber: '0088',
  name: 'Hydroon',
  cardType: 'character',
  symbols: ['water', 'terra'],
  turnCost: 3,
  handCost: 0,
  healthyStats: { lead: 3, support: 2 },
  injuredStats: { lead: 0, support: 1 },
  attributes: ['Animal', 'Sea Monster'],
  characteristics: ['micromon'],
  imageFile: '2024-04-21T03_34_19.624ZC0088.jpg',
  effects: [
    {
      id: 'C0088-E1',
      type: 'activate',
      isValid: true,
      timing: 'main',
      turnTiming: 'your-turn',
      effectDescription:
        'If your Field card has the name "Micromon Beach", search your deck for 1 Character card with the name "Krakaan" and put it in play, and if you do, move this Character to your Essence area.',
      oncePerTurn: true,
    },
  ],
};

export const C0089: CharacterCardDef = {
  id: 'C0089',
  printNumber: '0089',
  name: 'Carnodile',
  cardType: 'character',
  symbols: ['terra', 'water'],
  turnCost: 5,
  handCost: 1,
  healthyStats: { lead: 7, support: 0 },
  injuredStats: { lead: 3, support: 0 },
  attributes: ['Animal', 'Sea Monster'],
  characteristics: ['micromon'],
  imageFile: '2024-04-21T03_34_22.892ZC0089.jpg',
  effects: [
    {
      id: 'C0089-E1',
      type: 'trigger',
      isValid: true,
      triggerCondition: 'put-in-play',
      effectDescription:
        'If your Field card has the name "Micromon Beach", if you control 3 or more other Characters with [Sea Monster], you may target 1 Character your opponent controls with a Turn Cost of 3 or less and move it to the bottom of the owner\'s deck.',
      oncePerTurn: false,
    },
  ],
};

export const C0092: CharacterCardDef = {
  id: 'C0092',
  printNumber: '0092',
  name: 'Sea King Krakaan',
  names: ['Krakaan'],
  cardType: 'character',
  symbols: ['water'],
  turnCost: 3,
  handCost: 0,
  healthyStats: { lead: 0, support: 3 },
  injuredStats: { lead: 0, support: 3 },
  attributes: ['Animal', 'Sea Monster'],
  characteristics: ['micromon', 'unique'],
  imageFile: '2024-04-21T03_34_35.104ZC0092.jpg',
  effects: [
    {
      id: 'C0092-E1',
      type: 'ongoing',
      isValid: true,
      effectDescription:
        'Ability cards used by this Character cannot be targeted.',
      oncePerTurn: false,
    },
    {
      id: 'C0092-E2',
      type: 'trigger',
      isValid: true,
      triggerCondition: 'put-in-play-sea-monster',
      effectDescription:
        'When you put in play a Character card with [Sea Monster], you may move the top card of your deck to your Essence area.',
      oncePerTurn: false,
    },
  ],
};

export const C0090: CharacterCardDef = {
  id: 'C0090',
  printNumber: '0090',
  name: 'Megalino',
  cardType: 'character',
  symbols: ['water'],
  turnCost: 0,
  handCost: 0,
  healthyStats: { lead: 0, support: 2 },
  injuredStats: { lead: 0, support: 2 },
  attributes: ['Animal', 'Sea Monster'],
  characteristics: ['micromon'],
  imageFile: '2024-04-21T03_34_25.973ZC0090.jpg',
  effects: [
    {
      id: 'C0090-E1',
      type: 'activate',
      isValid: true,
      timing: 'main',
      turnTiming: 'your-turn',
      effectDescription:
        'If you control a Character with the name "Krakaan", put this Character card from your hand in play.',
      oncePerTurn: true,
    },
    {
      id: 'C0090-E2',
      type: 'ongoing',
      isValid: true,
      effectDescription:
        'If you control 3 or more Characters with [Sea Monster], this Character gets +3/+0.',
      oncePerTurn: false,
    },
  ],
};

export const C0091: CharacterCardDef = {
  id: 'C0091',
  printNumber: '0091',
  name: 'Sea Queen Argelia',
  names: ['Argelia'],
  cardType: 'character',
  symbols: ['water'],
  turnCost: 4,
  handCost: 0,
  healthyStats: { lead: 4, support: 3 },
  injuredStats: { lead: 3, support: 1 },
  attributes: ['Cayne Pirate', 'Female', 'Three Aces', 'Vice Captain'],
  characteristics: ['pirate', 'unique'],
  imageFile: '2024-04-21T03_34_28.808ZC0091.jpg',
  effects: [
    {
      id: 'C0091-E1',
      type: 'trigger',
      isValid: false,
      triggerCondition: 'deals-showdown-damage',
      effectDescription:
        "When this Character deals any Showdown Damage, you may discard 2 cards from your opponent's Essence area.",
      oncePerTurn: false,
    },
    {
      id: 'C0091-E2',
      type: 'ongoing',
      isValid: false,
      effectDescription:
        'All Characters you control with the name "Krakaan" get +6/+0.',
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

export const S0037: StrategyCardDef = {
  id: 'S0037',
  printNumber: '0037',
  name: 'Dangerous Waters',
  cardType: 'strategy',
  symbols: ['terra', 'water'],
  turnCost: 1,
  handCost: 1,
  keywords: [],
  imageFile: '2024-04-21T03_29_31.785ZS0037.jpg',
  effects: [
    {
      id: 'S0037-E1',
      type: 'trigger',
      isValid: false,
      effectDescription:
        'Target 1 Character card with [Sea Monster] and a Turn Cost of 2 or less in your Essence area. If your Field card has a TERRA or WATER Symbol, put in play the target. At end of turn, if target is still in play and Turn Marker is 4 or less, discard the target.',
      oncePerTurn: false,
    },
  ],
};

export const S0042: StrategyCardDef = {
  id: 'S0042',
  printNumber: '0042',
  name: 'Oceanic Abyss',
  cardType: 'strategy',
  symbols: ['water', 'terra'],
  turnCost: 0,
  handCost: 1,
  keywords: ['permanent', 'unique'],
  imageFile: '2024-04-21T03_29_50.050ZS0042.jpg',
  effects: [
    {
      id: 'S0042-E1',
      type: 'ongoing',
      isValid: true,
      effectDescription:
        'When one of your Character cards in play would be discarded, you may move it to your Essence area instead.',
      oncePerTurn: false,
    },
    {
      id: 'S0042-E2',
      type: 'ongoing',
      isValid: true,
      effectDescription:
        'This card is also treated as a Water and Terra Symbol Sea Monster MICROMON Character card.',
      oncePerTurn: false,
    },
  ],
};

export const S0044: StrategyCardDef = {
  id: 'S0044',
  printNumber: '0044',
  name: 'Unknown Pathway',
  cardType: 'strategy',
  symbols: ['terra'],
  turnCost: 2,
  handCost: 1,
  keywords: [],
  imageFile: 'S0044.jpg',
  effects: [
    {
      id: 'S0044-E1',
      type: 'trigger',
      isValid: true,
      effectDescription:
        'If your Field card has a TERRA Symbol, look at the top 3 cards of your deck. Move 1 to your hand, 1 to your Essence area, and 1 to your Discard Pile.',
      oncePerTurn: false,
    },
    {
      id: 'S0044-E2',
      type: 'activate',
      isValid: true,
      timing: 'main',
      turnTiming: 'either',
      costDescription: 'Expel this card from your Essence area',
      effectDescription:
        'Expel this card from your Essence area: Remove 1 counter from any card on the field.',
      oncePerTurn: false,
    },
  ],
};

// --- Ability Cards ---

export const A0035: AbilityCardDef = {
  id: 'A0035',
  printNumber: '0035',
  name: 'Aquabatics',
  cardType: 'ability',
  symbols: ['water'],
  essenceCost: {
    specific: [{ symbol: 'water', count: 1 }],
    neutral: 0,
    x: false,
  },
  requirements: [{ type: 'attribute', value: 'Sea Monster' }],
  imageFile: 'A0035.jpg',
  effects: [
    {
      id: 'A0035-E1',
      type: 'trigger',
      isValid: true,
      effectDescription:
        "Discard 2 cards from your opponent's Essence area, then if you have more cards in your Essence area than your opponent, you win 1 Battle Reward.",
      oncePerTurn: false,
    },
  ],
};

export const A0039: AbilityCardDef = {
  id: 'A0039',
  printNumber: '0039',
  name: 'Torrential Sludge',
  cardType: 'ability',
  symbols: ['water', 'terra'],
  essenceCost: {
    specific: [],
    neutral: 1,
    x: false,
    cardSymbol: 1,
  },
  requirements: [
    { type: 'attribute', value: 'Animal' },
    { type: 'turn-cost-min', value: '2' },
  ],
  targetDescription: '1 Character opposing the user',
  imageFile: 'A0039.jpg',
  effects: [
    {
      id: 'A0039-E1',
      type: 'trigger',
      isValid: true,
      effectDescription:
        "If the target has a lower Leader Value than the user, move the target to the bottom of the owner's deck.",
      oncePerTurn: false,
    },
  ],
  expertRequirements: [{ type: 'name', value: 'Hydroon' }],
  expertEffects: [
    {
      id: 'A0039-EX1',
      type: 'trigger',
      isValid: true,
      effectDescription:
        "Move the target to the owner's Essence area instead.",
      oncePerTurn: false,
    },
  ],
};

export const A0040: AbilityCardDef = {
  id: 'A0040',
  printNumber: '0040',
  name: 'Micromon Rage',
  cardType: 'ability',
  symbols: ['terra'],
  essenceCost: {
    specific: [{ symbol: 'terra', count: 1 }],
    neutral: 1,
    x: false,
  },
  requirements: [{ type: 'attribute', value: 'Animal' }],
  imageFile: 'A0040.jpg',
  effects: [
    {
      id: 'A0040-E1',
      type: 'trigger',
      isValid: true,
      effectDescription:
        "Double the user's current Stat Values this turn, then at the end of this turn, deal 1 Damage to the user.",
      oncePerTurn: false,
    },
  ],
};

// --- Full Deck Card Pool (Starter Deck 2) ---
export const STARTER_DECK_2_CARDS: CardDef[] = [
  F0006, C0074, C0075, C0076, C0087, C0088, C0089, C0090, C0091, C0092, C0093, S0037, S0042, S0043, S0044, A0035, A0039, A0040,
];

// --- Pre-built 50-card Deck List (skeleton — to be filled when all cards are added) ---
export const STARTER_DECK_2_LIST: { cardId: string; count: number }[] = [
  { cardId: 'C0074', count: 3 },
  { cardId: 'C0075', count: 3 },
  { cardId: 'C0076', count: 3 },
  { cardId: 'C0087', count: 3 },
  { cardId: 'C0088', count: 3 },
  { cardId: 'C0089', count: 3 },
  { cardId: 'C0090', count: 3 },
  { cardId: 'C0091', count: 3 },
  { cardId: 'C0092', count: 3 },
  { cardId: 'C0093', count: 3 },
  { cardId: 'S0037', count: 3 },
  { cardId: 'S0042', count: 3 },
  { cardId: 'S0043', count: 3 },
  { cardId: 'S0044', count: 2 },
  { cardId: 'A0035', count: 3 },
  { cardId: 'A0039', count: 3 },
  { cardId: 'A0040', count: 3 },
];
