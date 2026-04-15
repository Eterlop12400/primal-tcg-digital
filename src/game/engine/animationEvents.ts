// ============================================================
// Primal TCG — Animation Event Types
// ============================================================
// Discriminated union of events emitted during engine mutations.
// Each carries all data needed to drive animations.

import type { PlayerId, Phase, Zone } from '../types';

// --- Timing hints for the animation system ---
export interface AnimationTiming {
  delay?: number;      // ms delay before playing
  duration?: number;   // suggested duration override
  concurrent?: boolean; // play simultaneously with previous event
}

// --- Base event ---
interface BaseAnimationEvent {
  sequenceId: number;
  order: number;
  timestamp: number;
  player: PlayerId;
  timing?: AnimationTiming;
}

// --- Event types ---

export interface CardZoneChangeEvent extends BaseAnimationEvent {
  type: 'card-zone-change';
  cardId: string;
  cardName: string;
  defId: string;
  fromZone: Zone;
  toZone: Zone;
  reason: 'summon' | 'draw' | 'discard' | 'destroy' | 'charge' | 'play' | 'return' | 'battle-reward' | 'other';
}

export interface DamageAppliedEvent extends BaseAnimationEvent {
  type: 'damage-applied';
  targetCardId: string;
  targetCardName: string;
  amount: number;
  isLethal: boolean;
  source: string; // description of source
}

export interface StatModifiedEvent extends BaseAnimationEvent {
  type: 'stat-modified';
  cardId: string;
  cardName: string;
  stat: 'lead' | 'support' | 'both';
  before: { lead: number; support: number };
  after: { lead: number; support: number };
}

export interface CounterChangedEvent extends BaseAnimationEvent {
  type: 'counter-changed';
  cardId: string;
  cardName: string;
  counterType: string;
  prevCount: number;
  newCount: number;
}

export interface ChainEntryAddedEvent extends BaseAnimationEvent {
  type: 'chain-entry-added';
  chainIndex: number;
  cardName: string;
  defId: string;
  effectName: string;
  targets: string[];
}

export interface ChainEntryResolvedEvent extends BaseAnimationEvent {
  type: 'chain-entry-resolved';
  chainIndex: number;
  cardName: string;
  defId: string;
  outcome: 'resolved' | 'negated' | 'fizzled';
}

export interface EffectActivatedEvent extends BaseAnimationEvent {
  type: 'effect-activated';
  cardName: string;
  defId: string;
  effectName: string;
  effectDescription: string;
  targets: string[];
}

export interface BattleRewardEvent extends BaseAnimationEvent {
  type: 'battle-reward';
  gainedBy: PlayerId;
  lostBy: PlayerId;
  gained: number;
  newTotal: number;
}

export interface PhaseChangeEvent extends BaseAnimationEvent {
  type: 'phase-change';
  fromPhase: Phase;
  toPhase: Phase;
}

export interface TurnChangeEvent extends BaseAnimationEvent {
  type: 'turn-change';
  turn: number;
  activePlayer: PlayerId;
}

export interface CardRevealedEvent extends BaseAnimationEvent {
  type: 'card-revealed';
  cardId: string;
  cardName: string;
  defId: string;
  zone: Zone;
}

export interface CardTargetedEvent extends BaseAnimationEvent {
  type: 'card-targeted';
  cardId: string;
  cardName: string;
  sourceCardId: string;
  sourceCardName: string;
}

export interface CardDestroyedEvent extends BaseAnimationEvent {
  type: 'card-destroyed';
  cardId: string;
  cardName: string;
  defId: string;
  reason: 'battle' | 'effect' | 'other';
}

export interface PlayerNotificationEvent extends BaseAnimationEvent {
  type: 'player-notification';
  message: string;
  severity: 'info' | 'warning' | 'dramatic';
}

export interface CoinFlipEvent extends BaseAnimationEvent {
  type: 'coin-flip';
  cardName: string;
  defId: string;
  flipCount: number;
  results: ('heads' | 'tails')[];
  headsCount: number;
}

// --- Discriminated union ---

export type AnimationEvent =
  | CardZoneChangeEvent
  | DamageAppliedEvent
  | StatModifiedEvent
  | CounterChangedEvent
  | ChainEntryAddedEvent
  | ChainEntryResolvedEvent
  | EffectActivatedEvent
  | BattleRewardEvent
  | PhaseChangeEvent
  | TurnChangeEvent
  | CardRevealedEvent
  | CardTargetedEvent
  | CardDestroyedEvent
  | PlayerNotificationEvent
  | CoinFlipEvent;

export type AnimationEventType = AnimationEvent['type'];
