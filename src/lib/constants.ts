export const AI_MOVE_DELAY_MS = 1200;
export const AUTO_PASS_DELAY_MS = 600; // Delay before auto-passing priority (gives player time to read)
export const AI_VS_AI_MIN_DELAY = 200;
export const AI_VS_AI_MAX_DELAY = 2000;
export const AI_VS_AI_DEFAULT_DELAY = 600;

export const PHASE_LABELS: Record<string, string> = {
  setup: 'Setup',
  start: 'Start Phase',
  main: 'Main Phase',
  organization: 'Organization',
  'battle-attack': 'Attack Step',
  'battle-block': 'Block Step',
  'battle-eoa': 'Exchange of Ability',
  'battle-showdown': 'Showdown',
  end: 'End Phase',
};

export const SYMBOL_COLORS: Record<string, string> = {
  necro: '#8b5cf6',
  plasma: '#f472b6',
  water: '#3b82f6',
  fire: '#ef4444',
  terra: '#84cc16',
  air: '#38bdf8',
};
