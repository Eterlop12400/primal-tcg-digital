// Card registry — all card definitions accessible by ID
import { CardDef } from '../types';
import { STARTER_DECK_1_CARDS } from './starter-deck-1';

const cardRegistry: Record<string, CardDef> = {};

// Register all starter deck 1 cards
for (const card of STARTER_DECK_1_CARDS) {
  cardRegistry[card.id] = card;
}

export function getCardDef(id: string): CardDef {
  const def = cardRegistry[id];
  if (!def) {
    throw new Error(`Card definition not found: ${id}`);
  }
  return def;
}

export function getAllCardDefs(): CardDef[] {
  return Object.values(cardRegistry);
}

export function registerCardDef(card: CardDef): void {
  cardRegistry[card.id] = card;
}
