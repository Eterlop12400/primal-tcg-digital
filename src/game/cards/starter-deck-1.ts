// ============================================================
// Starter Deck 1: Slayer Guild (Necro/Plasma — Weapon Theme)
// ============================================================

import {
  CharacterCardDef,
  StrategyCardDef,
  AbilityCardDef,
  FieldCardDef,
  CardDef,
} from '../types';

// --- Field Card ---

export const F0005: FieldCardDef = {
  id: 'F0005',
  printNumber: '0005',
  name: "Slayer Guild's Hideout",
  cardType: 'field',
  symbols: ['plasma', 'necro'],
  imageFile: '2024-04-21T03_29_42.743ZF0005.jpg',
  effects: [
    {
      id: 'F0005-E1',
      type: 'trigger',
      isValid: false,
      triggerCondition: 'in-play-card-discarded',
      effectDescription:
        'Once per turn, during the Main Phase or Battle Phase, when an in-play card is discarded, you may draw 1 card.',
      oncePerTurn: true,
    },
  ],
};

// --- Character Cards ---

export const C0077: CharacterCardDef = {
  id: 'C0077',
  printNumber: '0077',
  name: 'Vanessa',
  cardType: 'character',
  symbols: ['necro', 'plasma'],
  turnCost: 4,
  handCost: 0,
  healthyStats: { lead: 6, support: 2 },
  injuredStats: { lead: 0, support: 0 },
  attributes: ['Slayer', 'Female', 'Weapon'],
  characteristics: [],
  imageFile: '2024-04-21T03_33_45.722ZC0077.jpg',
  effects: [
    {
      id: 'C0077-E1',
      type: 'trigger',
      isValid: false,
      triggerCondition: 'sent-to-attack',
      effectDescription:
        'When this Character is sent out to Attack, you may look at the top 5 cards of your deck and add 1 Ability card from among them that includes {Weapon} in its Requirements, then discard the rest.',
      oncePerTurn: false,
    },
  ],
};

export const C0078: CharacterCardDef = {
  id: 'C0078',
  printNumber: '0078',
  name: 'Lucian',
  cardType: 'character',
  symbols: ['necro', 'plasma'],
  turnCost: 3,
  handCost: 0,
  healthyStats: { lead: 5, support: 0 },
  injuredStats: { lead: 2, support: 0 },
  attributes: ['Slayer', 'Male', 'Weapon'],
  characteristics: [],
  imageFile: '2024-04-21T03_33_48.966ZC0078.jpg',
  effects: [
    {
      id: 'C0078-E1',
      type: 'activate',
      isValid: false,
      timing: 'main',
      turnTiming: 'your-turn',
      costDescription: 'Discard 1 Character card with {Weapon} from your hand',
      effectDescription:
        'Draw 2 cards, then move 1 card from your hand to the bottom of your deck.',
      oncePerTurn: true,
    },
  ],
};

export const C0079: CharacterCardDef = {
  id: 'C0079',
  printNumber: '0079',
  name: 'Solomon',
  cardType: 'character',
  symbols: ['necro', 'plasma'],
  turnCost: 2,
  handCost: 0,
  healthyStats: { lead: 2, support: 3 },
  injuredStats: { lead: 0, support: 1 },
  attributes: ['Slayer', 'Male', 'Weapon'],
  characteristics: [],
  imageFile: '2024-04-21T03_33_52.085ZC0079.jpg',
  effects: [
    {
      id: 'C0079-E1',
      type: 'activate',
      isValid: false,
      timing: 'main',
      turnTiming: 'your-turn',
      costDescription: 'Expel 2 cards from your Discard Pile',
      effectDescription:
        'All Characters you control with {Slayer} get +1/+1 during this turn, then at the end of this turn, you may discard the top 2 cards of your deck.',
      oncePerTurn: true,
    },
  ],
};

export const C0080: CharacterCardDef = {
  id: 'C0080',
  printNumber: '0080',
  name: 'Twin Sword Karen',
  cardType: 'character',
  symbols: ['plasma'],
  turnCost: 0,
  handCost: 0,
  healthyStats: { lead: 2, support: 0 },
  injuredStats: { lead: 1, support: 0 },
  attributes: ['Female', 'Weapon', 'Mercenary'],
  characteristics: [],
  imageFile: '2024-04-21T03_33_54.925ZC0080.jpg',
  effects: [
    {
      id: 'C0080-E1',
      type: 'trigger',
      isValid: false,
      triggerCondition: 'sent-to-attack',
      costDescription: 'Discard the top 2 cards of your opponent\'s deck',
      effectDescription:
        'This Character gets +1/+1 during this turn.',
      oncePerTurn: false,
    },
  ],
};

export const C0081: CharacterCardDef = {
  id: 'C0081',
  printNumber: '0081',
  name: 'Professor Sinister',
  cardType: 'character',
  symbols: ['necro', 'plasma'],
  turnCost: 0,
  handCost: 0,
  healthyStats: { lead: 1, support: 0 },
  injuredStats: { lead: 3, support: 0 },
  attributes: ['Slayer', 'Male', 'Weapon'],
  characteristics: [],
  imageFile: '2024-04-21T03_34_01.211ZC0082.jpg',
  effects: [
    {
      id: 'C0081-E1',
      type: 'trigger',
      isValid: true,
      triggerCondition: 'sent-to-battle-while-injured',
      effectDescription:
        'If your Field card has a Necro Symbol, when this Character is sent to Battle while Injured, you may move the top card of your deck to your Essence area.',
      oncePerTurn: false,
    },
  ],
};

export const C0082: CharacterCardDef = {
  id: 'C0082',
  printNumber: '0082',
  name: 'Omtaba',
  cardType: 'character',
  symbols: ['necro', 'plasma'],
  turnCost: 5,
  handCost: 1,
  healthyStats: { lead: 6, support: 3 },
  injuredStats: { lead: 4, support: 1 },
  attributes: ['Slayer', 'Male', 'Animal', 'Weapon', 'Vice Captain', 'Therian'],
  characteristics: [],
  imageFile: '2024-04-21T03_34_01.211ZC0082.jpg',
  effects: [
    {
      id: 'C0082-E1',
      type: 'trigger',
      isValid: false,
      triggerCondition: 'put-in-play',
      effectDescription:
        'When this Character is put in play, you may discard 1 Injured Character your opponent controls.',
      oncePerTurn: false,
    },
    {
      id: 'C0082-E2',
      type: 'ongoing',
      isValid: true,
      effectDescription:
        'While this Character is in a team with another {Slayer} Character, this Character is unaffected by your opponent\'s Character effects.',
      oncePerTurn: false,
    },
  ],
};

export const C0083: CharacterCardDef = {
  id: 'C0083',
  printNumber: '0083',
  name: 'Swordmaster Don',
  cardType: 'character',
  symbols: ['plasma'],
  turnCost: 1,
  handCost: 0,
  healthyStats: { lead: 2, support: 2 },
  injuredStats: { lead: 0, support: 0 },
  attributes: ['Male', 'Weapon', 'Master'],
  characteristics: [],
  imageFile: '2024-04-21T03_34_04.336ZC0083.jpg',
  effects: [
    {
      id: 'C0083-E1',
      type: 'trigger',
      isValid: false,
      triggerCondition: 'put-in-play',
      effectDescription:
        'When this Character card is put in play, if your Field card has a Plasma Symbol, you may move 1 Character card with {Weapon} from your Discard Pile to your hand.',
      oncePerTurn: false,
    },
  ],
};

export const C0084: CharacterCardDef = {
  id: 'C0084',
  printNumber: '0084',
  name: 'Sinbad',
  cardType: 'character',
  symbols: ['plasma'],
  turnCost: 1,
  handCost: 0,
  healthyStats: { lead: 0, support: 2 },
  injuredStats: { lead: 0, support: 0 },
  attributes: ['Male', 'Weapon', 'Mercenary'],
  characteristics: [],
  imageFile: '2024-04-21T03_34_07.327ZC0084.jpg',
  effects: [
    {
      id: 'C0084-E1',
      type: 'trigger',
      isValid: false,
      triggerCondition: 'put-in-play',
      effectDescription:
        'When this Character card is put in play, you may target 1 Character you control with {Weapon} and place a +1/+1 Counter on it.',
      oncePerTurn: false,
    },
  ],
};

export const C0085: CharacterCardDef = {
  id: 'C0085',
  printNumber: '0085',
  name: 'Samanosuke',
  cardType: 'character',
  symbols: ['necro'],
  turnCost: 0,
  handCost: 0,
  healthyStats: { lead: 2, support: 0 },
  injuredStats: { lead: 1, support: 0 },
  attributes: ['Male', 'Weapon', 'Mercenary'],
  characteristics: [],
  imageFile: '2024-04-21T03_34_10.397ZC0085.jpg',
  effects: [
    {
      id: 'C0085-E1',
      type: 'trigger',
      isValid: true,
      triggerCondition: 'sent-to-attack',
      costDescription:
        'Move 1 Character card with {Weapon} from your Discard Pile to the bottom of your deck',
      effectDescription:
        'If your Field card has a Necro Symbol, this Character gets +2/+0 during this turn.',
      oncePerTurn: false,
    },
  ],
};

export const C0086: CharacterCardDef = {
  id: 'C0086',
  printNumber: '0086',
  name: 'Rosita',
  cardType: 'character',
  symbols: ['necro'],
  turnCost: 0,
  handCost: 0,
  healthyStats: { lead: 1, support: 1 },
  injuredStats: { lead: 1, support: 1 },
  attributes: ['Female', 'Weapon', 'Mercenary'],
  characteristics: [],
  imageFile: '2024-04-21T03_34_13.434ZC0086.jpg',
  effects: [
    {
      id: 'C0086-E1',
      type: 'ongoing',
      isValid: false,
      effectDescription:
        'This Character gets +1/+1 while in the same Team as another Character with {Mercenary}.',
      oncePerTurn: false,
    },
    {
      id: 'C0086-E2',
      type: 'ongoing',
      isValid: false,
      effectDescription:
        'This Character gets +1/+1 while in the same Team as another Character with {Slayer}.',
      oncePerTurn: false,
    },
  ],
};

// --- Strategy Cards ---

export const S0038: StrategyCardDef = {
  id: 'S0038',
  printNumber: '0038',
  name: 'Secret Meeting',
  cardType: 'strategy',
  symbols: ['plasma', 'necro'],
  turnCost: 2,
  handCost: 1,
  keywords: [],
  imageFile: '2024-04-21T03_29_35.092ZS0038.jpg',
  effects: [
    {
      id: 'S0038-E1',
      type: 'trigger', // one-shot on resolve
      isValid: false,
      effectDescription:
        "If your Field card has the name 'Slayer Guild\\'s Hideout', search your deck for 1 Character card with {Slayer} or {Mercenary} and add it to your hand.",
      oncePerTurn: false,
    },
  ],
};

export const S0039: StrategyCardDef = {
  id: 'S0039',
  printNumber: '0039',
  name: 'Reaped Fear',
  cardType: 'strategy',
  symbols: ['necro', 'plasma'],
  turnCost: 2,
  handCost: 1,
  keywords: ['permanent', 'unique'],
  permanentCount: 3,
  imageFile: '2024-04-21T03_29_37.976ZS0039.jpg',
  effects: [
    {
      id: 'S0039-E1',
      type: 'trigger',
      isValid: false,
      triggerCondition: 'slayer-team-discards-opponent-via-showdown',
      effectDescription:
        "Once per turn, when any of your Teams with 1 or more Characters with {Slayer} discards 1 of your opponent's Characters due to Showdown Damage, you win 1 Battle Reward.",
      oncePerTurn: true,
    },
  ],
};

export const S0040: StrategyCardDef = {
  id: 'S0040',
  printNumber: '0040',
  name: 'Bounty Board',
  cardType: 'strategy',
  symbols: ['necro'],
  turnCost: 3,
  handCost: 1,
  keywords: [],
  imageFile: '2024-04-21T03_29_41.169ZS0040.jpg',
  effects: [
    {
      id: 'S0040-E1',
      type: 'trigger', // one-shot on resolve
      isValid: false,
      effectDescription:
        "If your Field card has the name 'Slayer Guild\\'s Hideout', reveal 1 Character card with {Weapon} from your hand, and if you do, move the revealed card to the bottom of your deck and draw 3 cards.",
      oncePerTurn: false,
    },
  ],
};

export const S0041: StrategyCardDef = {
  id: 'S0041',
  printNumber: '0041',
  name: 'Hard Decision',
  cardType: 'strategy',
  symbols: ['plasma'],
  turnCost: 4,
  handCost: 1,
  keywords: [],
  imageFile: '2024-04-21T03_29_43.891ZS0041.jpg',
  effects: [
    {
      id: 'S0041-E1',
      type: 'trigger', // one-shot on resolve
      isValid: false,
      targetDescription: '1 Character you control',
      effectDescription:
        'Discard the target, and if you do, draw 1 card and win 1 Battle Reward.',
      oncePerTurn: false,
    },
  ],
};

// --- Ability Cards ---

export const A0036: AbilityCardDef = {
  id: 'A0036',
  printNumber: '0036',
  name: 'Stake Gun',
  cardType: 'ability',
  symbols: ['necro', 'plasma'],
  essenceCost: {
    specific: [],
    neutral: 0,
    x: true,
    cardSymbol: 1, // 1 Necro or 1 Plasma + X
  },
  requirements: [{ type: 'attribute', value: 'Weapon' }],
  targetDescription: '1 Character opposing the user',
  imageFile: '2024-04-21T03_30_59.423ZA0036.jpg',
  effects: [
    {
      id: 'A0036-E1',
      type: 'trigger', // one-shot on resolve
      isValid: false,
      effectDescription:
        'Flip a coin X times. Deal 1 damage to the target for each coin flip that resulted in Heads.',
      oncePerTurn: false,
    },
  ],
  expertRequirements: [{ type: 'attribute', value: 'Slayer' }],
  expertEffects: [
    {
      id: 'A0036-EX1',
      type: 'trigger',
      isValid: false,
      effectDescription:
        "You may discard X cards from the top of your opponent's deck.",
      oncePerTurn: false,
    },
  ],
};

export const A0037: AbilityCardDef = {
  id: 'A0037',
  printNumber: '0037',
  name: 'Deflection',
  cardType: 'ability',
  symbols: ['necro'],
  essenceCost: {
    specific: [{ symbol: 'necro', count: 1 }],
    neutral: 1,
    x: false,
  },
  requirements: [{ type: 'attribute', value: 'Weapon' }],
  imageFile: '2024-04-21T03_31_02.479ZA0037.jpg',
  effects: [
    {
      id: 'A0037-E1',
      type: 'trigger', // one-shot on resolve
      isValid: false,
      effectDescription:
        'The user gets +3/+3 during this turn, then the next Damage the user is dealt during this turn becomes 0 instead.',
      oncePerTurn: false,
    },
  ],
};

export const A0038: AbilityCardDef = {
  id: 'A0038',
  printNumber: '0038',
  name: 'Swift Strike',
  cardType: 'ability',
  symbols: ['plasma'],
  essenceCost: {
    specific: [{ symbol: 'plasma', count: 1 }],
    neutral: 1,
    x: false,
  },
  requirements: [{ type: 'attribute', value: 'Weapon' }],
  targetDescription: '1 Character opposing the user',
  imageFile: '2024-04-21T03_31_05.518ZA0038.jpg',
  effects: [
    {
      id: 'A0038-E1',
      type: 'trigger', // lingers until showdown
      isValid: false,
      effectDescription:
        'At the start of the Showdown, if the target was not the user of an ability card that resolved successfully during this turn, deal 1 Damage to the target. If the target was discarded due to this Damage, you may draw 1 card.',
      oncePerTurn: false,
    },
  ],
};

// --- Full Deck Card Pool ---
export const STARTER_DECK_1_CARDS: CardDef[] = [
  F0005,
  C0077, C0078, C0079, C0080, C0081,
  C0082, C0083, C0084, C0085, C0086,
  S0038, S0039, S0040, S0041,
  A0036, A0037, A0038,
];

// --- Pre-built 50-card Deck List (3 copies of most, balanced) ---
// Field card is separate (1 copy always)
export const STARTER_DECK_1_LIST: { cardId: string; count: number }[] = [
  // Field (always 1, separate from main deck)
  // Characters (30 cards)
  { cardId: 'C0077', count: 2 }, // Vanessa — strong but TC:4
  { cardId: 'C0078', count: 3 }, // Lucian — draw engine
  { cardId: 'C0079', count: 3 }, // Solomon — Slayer buff
  { cardId: 'C0080', count: 3 }, // Twin Sword Karen — aggressive 0-cost
  { cardId: 'C0081', count: 3 }, // Professor Sinister — essence ramp when injured
  { cardId: 'C0082', count: 2 }, // Omtaba — boss card TC:5
  { cardId: 'C0083', count: 3 }, // Swordmaster Don — recursion
  { cardId: 'C0084', count: 3 }, // Sinbad — +1/+1 counter support
  { cardId: 'C0085', count: 3 }, // Samanosuke — aggressive with recursion
  { cardId: 'C0086', count: 3 }, // Rosita — synergy payoff
  // Strategies (10 cards)
  { cardId: 'S0038', count: 3 }, // Secret Meeting — search
  { cardId: 'S0039', count: 2 }, // Reaped Fear — Unique so max 1 in play but 2 for consistency
  { cardId: 'S0040', count: 3 }, // Bounty Board — draw 3
  { cardId: 'S0041', count: 2 }, // Hard Decision — sac for BR
  // Abilities (10 cards)
  { cardId: 'A0036', count: 3 }, // Stake Gun — removal
  { cardId: 'A0037', count: 3 }, // Deflection — protection
  { cardId: 'A0038', count: 3 }, // Swift Strike — pre-showdown damage
];
// Total: 2+3+3+3+3+2+3+3+3+3 + 3+2+3+2 + 3+3+3 = 50 cards + 1 Field
