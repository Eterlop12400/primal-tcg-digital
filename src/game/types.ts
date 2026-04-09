// ============================================================
// Primal TCG Digital — Core Type Definitions
// ============================================================

// --- Symbols ---
export type Symbol =
  | 'necro'
  | 'water'
  | 'terra'
  | 'fire'
  | 'air'
  | 'plasma';

// --- Card Types ---
export type CardType = 'character' | 'strategy' | 'ability' | 'field';

// --- Character States ---
export type CharacterState = 'healthy' | 'injured';

// --- Effect Types ---
export type EffectType = 'trigger' | 'activate' | 'ongoing';

// --- Timing Windows ---
export type Timing = 'main' | 'eoa' | 'both';

// --- Turn Ownership for Activate Effects ---
export type TurnTiming = 'your-turn' | 'opponent-turn' | 'either';

// --- Battle Designation ---
export type BattleRole = 'team-lead' | 'team-support';

// --- Game Phases ---
export type Phase =
  | 'setup'
  | 'start'
  | 'main'
  | 'organization'
  | 'battle-attack'
  | 'battle-block'
  | 'battle-eoa'
  | 'battle-showdown'
  | 'end';

// --- Showdown Results ---
export type ShowdownResult =
  | 'battle-reward'
  | 'outstanding-battle-reward'
  | 'victory'
  | 'outstanding-victory'
  | 'stalemate';

// --- Card Attributes / Characteristics ---
export type Attribute = string; // e.g., 'Slayer', 'Weapon', 'Mercenary', 'Female', 'Male', etc.
export type Characteristic = string; // e.g., 'Token', 'Masked'

// --- Strategy Keywords ---
export type StrategyKeyword = 'permanent' | 'counter' | 'unique';

// --- Base Card Definition (template, not instance) ---
export interface BaseCardDef {
  id: string;             // e.g., 'C0077'
  printNumber: string;    // e.g., '0077'
  name: string;
  cardType: CardType;
  symbols: Symbol[];
  imageFile?: string;
}

export interface CharacterCardDef extends BaseCardDef {
  cardType: 'character';
  turnCost: number;
  handCost: number;
  healthyStats: { lead: number; support: number };
  injuredStats: { lead: number; support: number };
  attributes: Attribute[];
  characteristics: Characteristic[];
  effects: CardEffectDef[];
}

export interface StrategyCardDef extends BaseCardDef {
  cardType: 'strategy';
  turnCost: number;
  handCost: number;
  keywords: StrategyKeyword[];
  permanentCount?: number; // for Permanent(X)
  effects: CardEffectDef[];
}

export interface AbilityCardDef extends BaseCardDef {
  cardType: 'ability';
  essenceCost: EssenceCost;
  requirements: AbilityRequirement[];
  targetDescription?: string;
  effects: CardEffectDef[];
  expertRequirements?: AbilityRequirement[];
  expertEffects?: CardEffectDef[];
}

export interface FieldCardDef extends BaseCardDef {
  cardType: 'field';
  effects: CardEffectDef[];
}

export type CardDef = CharacterCardDef | StrategyCardDef | AbilityCardDef | FieldCardDef;

// --- Essence Cost ---
export interface EssenceCost {
  specific: { symbol: Symbol; count: number }[];
  neutral: number;        // fixed neutral cost
  x: boolean;             // has X cost component
}

// --- Ability Requirements ---
export interface AbilityRequirement {
  type: 'attribute' | 'characteristic' | 'name' | 'symbol';
  value: string;
}

// --- Card Effect Definitions ---
export interface CardEffectDef {
  id: string;             // unique effect ID within the card
  type: EffectType;
  isValid: boolean;       // can be used while injured
  timing?: Timing;
  turnTiming?: TurnTiming;
  triggerCondition?: string; // human-readable for now, will be enum/function later
  costDescription?: string;
  targetDescription?: string;
  effectDescription: string;
  oncePerTurn: boolean;
  // The actual effect logic will be implemented as functions keyed by card+effect ID
}

// ============================================================
// Game Instance Types (runtime state)
// ============================================================

export type PlayerId = 'player1' | 'player2';

// --- Card Instance (a specific card in the game) ---
export interface CardInstance {
  instanceId: string;     // unique per game instance
  defId: string;          // links to CardDef.id
  owner: PlayerId;
  zone: Zone;
  state?: CharacterState; // only for characters
  counters: Counter[];
  attachedCards: string[]; // instanceIds of cards attached to this
  attachedTo?: string;    // instanceId this card is attached to
  statModifiers: StatModifier[]; // temporary +X/+Y effects
  isNegated: boolean;
  usedEffects: string[];  // effect IDs used this turn
  battleRole?: BattleRole;
  teamId?: string;        // which team this character belongs to
}

// --- Zones ---
export type Zone =
  | 'deck'
  | 'hand'
  | 'kingdom'
  | 'battlefield'
  | 'field-area'
  | 'essence'
  | 'discard'
  | 'expel'
  | 'battle-rewards'
  | 'general-play'
  | 'removed'; // for tokens leaving play

// --- Counters ---
export interface Counter {
  type: 'permanent' | 'plus-one' | 'minus-one' | 'valid' | 'rebirth' | 'poison' | 'masked' | 'custom';
  name?: string; // for custom counters
}

// --- Stat Modifiers ---
export interface StatModifier {
  lead: number;
  support: number;
  source: string;         // what caused this modifier
  duration: 'turn' | 'permanent' | 'until-end-of-turn' | 'until-start-of-turn';
}

// --- Team ---
export interface Team {
  id: string;
  owner: PlayerId;
  characterIds: string[]; // instanceIds, first = lead (if designated)
  hasLead: boolean;       // false if lead was removed
  isAttacking: boolean;
  isBlocking: boolean;
  blockedByTeamId?: string;
  blockingTeamId?: string;
}

// --- Chain Entry ---
export interface ChainEntry {
  id: string;
  type: 'summon' | 'strategy' | 'ability' | 'activate-effect' | 'trigger-effect';
  sourceCardInstanceId: string;
  effectId?: string;      // for activate/trigger effects
  userId?: string;        // for ability cards (the character using it)
  targetIds?: string[];   // instanceIds of targets
  xValue?: number;        // for X cost effects
  resolved: boolean;
  negated: boolean;
  owner: PlayerId;
}

// --- Player State ---
export interface PlayerState {
  id: PlayerId;
  turnMarker: number;
  hasSummonedThisTurn: boolean;
  hasPlayedStrategyThisTurn: boolean;
  hasUsedRushThisTurn: boolean;
  deck: string[];         // instanceIds (order matters — top = index 0)
  hand: string[];         // instanceIds
  kingdom: string[];      // instanceIds
  battlefield: string[];  // instanceIds
  essence: string[];      // instanceIds
  discard: string[];      // instanceIds
  expel: string[];        // instanceIds
  battleRewards: string[];// instanceIds (on opponent's side physically)
  fieldCard?: string;     // instanceId
}

// --- Game State ---
export interface GameState {
  // Core state
  players: Record<PlayerId, PlayerState>;
  cards: Record<string, CardInstance>; // all card instances by instanceId
  teams: Record<string, Team>;

  // Turn tracking
  turnNumber: number;     // overall turn count
  currentTurn: PlayerId;  // whose turn it is
  phase: Phase;
  isFirstTurn: boolean;   // is it P1's very first turn

  // Priority
  priorityPlayer: PlayerId;
  consecutivePasses: number;

  // Chain
  chain: ChainEntry[];
  isChainResolving: boolean;

  // Pending triggers (queued during chain resolution)
  pendingTriggers: ChainEntry[];

  // Lingering effects active this turn
  lingeringEffects: LingeringEffect[];

  // Game status
  gameOver: boolean;
  winner?: PlayerId;
  winReason?: 'battle-rewards' | 'deck-out' | 'concede';

  // RNG
  rngSeed?: number;

  // Action log
  log: GameLogEntry[];
}

// --- Lingering Effects ---
export interface LingeringEffect {
  id: string;
  source: string;         // card instanceId
  effectDescription: string;
  duration: 'turn' | 'until-end-of-turn' | 'until-start-of-turn';
  appliedTurn: number;
  data: Record<string, unknown>; // effect-specific data
}

// --- Game Log ---
export interface GameLogEntry {
  timestamp: number;
  turn: number;
  phase: Phase;
  player: PlayerId;
  action: string;
  details?: string;
  cardInstanceId?: string;
}

// --- Player Action (input from human or AI) ---
export type PlayerAction =
  | { type: 'summon'; cardInstanceId: string; handCostCardIds?: string[] }
  | { type: 'play-strategy'; cardInstanceId: string; handCostCardIds?: string[]; targetIds?: string[] }
  | { type: 'play-ability'; cardInstanceId: string; userId: string; targetIds?: string[]; essenceCostCardIds: string[]; xValue?: number }
  | { type: 'activate-effect'; cardInstanceId: string; effectId: string; targetIds?: string[]; costCardIds?: string[] }
  | { type: 'charge-essence'; cardInstanceIds: string[] }
  | { type: 'pass-priority' }
  | { type: 'organize-teams'; teams: { leadId: string; supportIds: string[] }[] }
  | { type: 'choose-battle-or-end'; choice: 'battle' | 'end' }
  | { type: 'select-attackers'; teamIds: string[] }
  | { type: 'select-blockers'; assignments: { blockingTeamId: string; attackingTeamId: string }[] }
  | { type: 'choose-showdown-order'; teamIds: string[] }
  | { type: 'mulligan'; cardInstanceIds: string[] } // cards to put back
  | { type: 'discard-to-hand-limit'; cardInstanceIds: string[] }
  | { type: 'concede' }
  | { type: 'coin-flip-result'; results: ('heads' | 'tails')[] } // for Stake Gun etc.
  | { type: 'choose-optional-trigger'; effectId: string; activate: boolean }
  | { type: 'search-select'; cardInstanceId: string | null }; // for deck searches
