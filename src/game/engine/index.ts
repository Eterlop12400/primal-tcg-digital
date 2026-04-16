// ============================================================
// Game Engine — Public API
// ============================================================

export { createNewGame, performMulligan } from './gameSetup';
export type { DeckConfig } from './gameSetup';

export {
  advanceToStartPhase,
  advanceToMainPhase,
  advanceToOrganizationPhase,
  advanceToBattlePhase,
  advanceToEndPhase,
  finishEndPhase,
  advanceToEOA,
  advanceToShowdown,
  organizeTeams,
  sendAttackers,
  assignBlockers,
  resolveShowdown,
  returnFromBattlefield,
  handlePassPriority,
  getLegalActions,
} from './gameLoop';

export { resolveChain, flushPendingTriggers } from './chainResolver';
export { executeEffect } from './effectExecutor';
export { processAction } from './actionProcessor';
export { EventCollector } from './EventCollector';
export type { AnimationEvent, AnimationEventType } from './animationEvents';

export {
  getCard,
  getCardDefForInstance,
  getCardsInZone,
  moveCard,
  drawCards,
  shuffleDeck,
  getEffectiveStats,
  calculateTeamPower,
  dealDamage,
  getOpponent,
  fieldHasSymbol,
  fieldHasName,
  characterHasAttribute,
  hasOceanicAbyssInPlay,
  oceanicAbyssVirtualCharCount,
  addLog,
} from './utils';
