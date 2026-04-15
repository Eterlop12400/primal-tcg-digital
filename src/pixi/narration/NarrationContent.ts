// ============================================================
// Primal TCG — Narration Content
// ============================================================
// Pure data: concept explanations and action narration templates.

import type { AnimationEvent } from '@/game/engine/animationEvents';
import type { Phase } from '@/game/types';

// --- Concept Explanations (shown once per game) ---

export interface ConceptNarration {
  id: string;
  title: string;
  text: string;
  duration: number; // ms to display
}

export const CONCEPT_NARRATIONS: Record<string, ConceptNarration> = {
  summoning: {
    id: 'summoning',
    title: 'SUMMONING',
    text: 'Characters are summoned from your hand to the Kingdom. Pay the hand cost by discarding cards, then the character joins as a new solo team.',
    duration: 5000,
  },
  charging: {
    id: 'charging',
    title: 'CHARGING ESSENCE',
    text: 'Charging places a card from your hand face-down into your Essence zone. Essence is used to pay for abilities and activate effects.',
    duration: 5000,
  },
  chains: {
    id: 'chains',
    title: 'THE CHAIN',
    text: 'Actions are added to a chain and resolve backwards (last in, first out). Both players alternate adding to the chain before it resolves.',
    duration: 5000,
  },
  organization: {
    id: 'organization',
    title: 'ORGANIZATION PHASE',
    text: 'All Kingdom characters must be organized into teams of up to 3. The first character is the Leader (uses lead stat), others are Support (use support stat).',
    duration: 6000,
  },
  battle: {
    id: 'battle',
    title: 'BATTLE PHASE',
    text: 'The turn player selects teams to attack. The defender can assign blocker teams to oppose attackers. Unblocked attackers earn Battle Rewards!',
    duration: 6000,
  },
  blocking: {
    id: 'blocking',
    title: 'BLOCKING',
    text: 'The defending player assigns teams to block attacking teams. Each blocker team opposes one attacker. Teams that aren\'t blocked deal damage directly.',
    duration: 5000,
  },
  eoa: {
    id: 'eoa',
    title: 'EXCHANGE OF ABILITIES',
    text: 'Before the showdown, both players can play ability cards and activate character effects. This is the key moment for combat tricks!',
    duration: 5000,
  },
  showdown: {
    id: 'showdown',
    title: 'SHOWDOWN',
    text: 'Opposing teams compare total power. The weaker team\'s characters are all discarded. If tied, both teams are destroyed!',
    duration: 5000,
  },
  battleRewards: {
    id: 'battleRewards',
    title: 'BATTLE REWARDS',
    text: 'Unblocked attacking teams earn Battle Rewards (top card of opponent\'s deck). Collect 10 Battle Rewards to win the game!',
    duration: 5000,
  },
  handCost: {
    id: 'handCost',
    title: 'HAND COST',
    text: 'Summoning requires discarding cards from your hand equal to the character\'s turn cost. Choose wisely — those cards go to the Discard Pile.',
    duration: 5000,
  },
  abilities: {
    id: 'abilities',
    title: 'ABILITY CARDS',
    text: 'Ability cards are played during the Exchange of Abilities phase. They require a user character on the battlefield, a target, and an essence cost.',
    duration: 5000,
  },
  strategies: {
    id: 'strategies',
    title: 'STRATEGY CARDS',
    text: 'Strategy cards can be played during the main phase. Some are one-shot effects, others become permanent supports on the field.',
    duration: 5000,
  },
  damage: {
    id: 'damage',
    title: 'DAMAGE',
    text: 'When a character takes damage, their stats are reduced. If both lead and support reach 0, the character is destroyed and discarded.',
    duration: 5000,
  },
};

// --- Phase-triggered concept keys ---

export const PHASE_CONCEPTS: Partial<Record<Phase, string>> = {
  organization: 'organization',
  'battle-attack': 'battle',
  'battle-block': 'blocking',
  'battle-eoa': 'eoa',
  'battle-showdown': 'showdown',
};

// --- Action Narration (contextual descriptions) ---

export function getActionNarration(event: AnimationEvent, playerLabel: string): string | null {
  switch (event.type) {
    case 'card-zone-change': {
      if (event.reason === 'summon') {
        return `${playerLabel} summons ${event.cardName} to the Kingdom.`;
      }
      if (event.reason === 'charge') {
        return `${playerLabel} charges a card to Essence.`;
      }
      if (event.reason === 'draw') {
        return `${playerLabel} draws a card.`;
      }
      if (event.reason === 'discard') {
        return `${event.cardName} is discarded.`;
      }
      if (event.reason === 'play') {
        return `${playerLabel} plays ${event.cardName}.`;
      }
      if (event.reason === 'battle-reward') {
        return `${playerLabel} claims a Battle Reward!`;
      }
      return null;
    }
    case 'damage-applied': {
      if (event.isLethal) {
        return `${event.targetCardName} takes ${event.amount} lethal damage and is destroyed!`;
      }
      return `${event.targetCardName} takes ${event.amount} damage.`;
    }
    case 'chain-entry-added': {
      return `${event.cardName} activates: ${event.effectName}`;
    }
    case 'effect-activated': {
      return `${event.cardName}: ${event.effectDescription}`;
    }
    case 'battle-reward': {
      const label = event.gainedBy === event.player ? playerLabel : 'Opponent';
      return `${label} gains a Battle Reward! (${event.newTotal}/10)`;
    }
    case 'card-destroyed': {
      return `${event.cardName} is destroyed!`;
    }
    case 'stat-modified': {
      const diff = event.after.lead - event.before.lead;
      if (diff > 0) return `${event.cardName} gains +${diff} power.`;
      if (diff < 0) return `${event.cardName} loses ${diff} power.`;
      return null;
    }
    case 'counter-changed': {
      const diff = event.newCount - event.prevCount;
      if (diff > 0) return `${event.cardName} gains ${diff} ${event.counterType} counter(s).`;
      return null;
    }
    default:
      return null;
  }
}

// --- Event-triggered concept keys ---

export function getEventConcept(event: AnimationEvent): string | null {
  switch (event.type) {
    case 'card-zone-change':
      if (event.reason === 'summon') return 'summoning';
      if (event.reason === 'charge') return 'charging';
      if (event.reason === 'battle-reward') return 'battleRewards';
      return null;
    case 'chain-entry-added':
      return 'chains';
    case 'damage-applied':
      return 'damage';
    case 'effect-activated':
      return 'abilities';
    default:
      return null;
  }
}
