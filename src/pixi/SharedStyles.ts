// ============================================================
// Primal TCG — Shared TextStyle Constants
// ============================================================
// Pre-built TextStyle objects to avoid recreating them every frame.

import { TextStyle } from 'pixi.js';
import { COLORS } from './layout';

export const FONT = 'Rajdhani, Arial, sans-serif';
export const FONT_BODY = 'Inter, Arial, sans-serif';

export const STYLES = {
  // --- Headers ---
  headerLarge: new TextStyle({
    fontSize: 28,
    fill: COLORS.textBright,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 8,
  }),

  headerMedium: new TextStyle({
    fontSize: 22,
    fill: COLORS.textBright,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 6,
  }),

  headerSmall: new TextStyle({
    fontSize: 16,
    fill: COLORS.accentBlue,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 3,
  }),

  // --- Phase / Turn labels ---
  phaseLabel: new TextStyle({
    fontSize: 15,
    fill: COLORS.accentBlue,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 2,
  }),

  turnLabel: new TextStyle({
    fontSize: 14,
    fill: COLORS.textMuted,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 2,
  }),

  playerLabel: new TextStyle({
    fontSize: 15,
    fill: COLORS.textBright,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 1,
  }),

  // --- Zone labels ---
  zoneLabel: new TextStyle({
    fontSize: 12,
    fill: COLORS.zoneLabel,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 1,
  }),

  zoneLabelLarge: new TextStyle({
    fontSize: 14,
    fill: COLORS.textMuted,
    fontFamily: FONT,
    letterSpacing: 2,
  }),

  // --- Card stats ---
  statLead: (fontSize: number) => new TextStyle({
    fontSize,
    fill: COLORS.leadColor,
    fontFamily: FONT,
    fontWeight: 'bold',
  }),

  statSupport: (fontSize: number) => new TextStyle({
    fontSize,
    fill: COLORS.supportColor,
    fontFamily: FONT,
    fontWeight: 'bold',
  }),

  statSlash: (fontSize: number) => new TextStyle({
    fontSize: fontSize - 1,
    fill: 0x9ca3af,
    fontFamily: FONT,
  }),

  // --- Card name ---
  cardName: (fontSize: number) => new TextStyle({
    fontSize,
    fill: COLORS.textBright,
    fontFamily: FONT,
    fontWeight: 'bold',
  }),

  // --- Counter badges ---
  counterBadge: (fontSize: number, color: number) => new TextStyle({
    fontSize,
    fill: color,
    fontFamily: FONT,
    fontWeight: 'bold',
  }),

  // --- UI elements ---
  buttonLabel: new TextStyle({
    fontSize: 13,
    fill: COLORS.textBright,
    fontFamily: FONT,
    fontWeight: 'bold',
  }),

  buttonLabelLarge: new TextStyle({
    fontSize: 14,
    fill: COLORS.textBright,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 1,
  }),

  // --- Status / Info ---
  chainCount: new TextStyle({
    fontSize: 13,
    fill: COLORS.textGold,
    fontFamily: FONT,
    fontWeight: 'bold',
  }),

  aiThinking: new TextStyle({
    fontSize: 13,
    fill: COLORS.accentCyan,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 1,
  }),

  errorText: new TextStyle({
    fontSize: 13,
    fill: COLORS.buttonDanger,
    fontFamily: FONT,
  }),

  infoText: new TextStyle({
    fontSize: 13,
    fill: COLORS.textMuted,
    fontFamily: FONT,
  }),

  infoBold: new TextStyle({
    fontSize: 13,
    fill: COLORS.textMuted,
    fontFamily: FONT,
    fontWeight: 'bold',
  }),

  // --- Hand labels ---
  handLabel: new TextStyle({
    fontSize: 13,
    fill: COLORS.textMuted,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 1,
  }),

  handHint: new TextStyle({
    fontSize: 14,
    fill: COLORS.accentCyan,
    fontFamily: FONT,
    fontWeight: 'bold',
  }),

  // --- Power labels ---
  powerLabel: new TextStyle({
    fontSize: 13,
    fill: COLORS.textGold,
    fontFamily: FONT,
    fontWeight: 'bold',
  }),

  // --- Damage numbers ---
  damageNumber: new TextStyle({
    fontSize: 24,
    fill: COLORS.injuredDot,
    fontFamily: FONT,
    fontWeight: 'bold',
    stroke: { color: 0x000000, width: 3 },
  }),

  // --- Chain notification ---
  chainNotification: new TextStyle({
    fontSize: 15,
    fill: COLORS.accentGold,
    fontFamily: FONT,
    fontWeight: 'bold',
  }),

  // --- Game over ---
  gameOverTitle: (isWin: boolean) => new TextStyle({
    fontSize: 36,
    fill: isWin ? COLORS.accentGold : COLORS.buttonDanger,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 4,
  }),

  gameOverReason: new TextStyle({
    fontSize: 16,
    fill: COLORS.text,
    fontFamily: FONT,
  }),

  gameOverStats: new TextStyle({
    fontSize: 14,
    fill: COLORS.textMuted,
    fontFamily: FONT,
  }),

  // --- Phase bar ---
  phaseBarLabel: new TextStyle({
    fontSize: 10,
    fill: COLORS.textMuted,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  }),

  phaseBarLabelActive: new TextStyle({
    fontSize: 10,
    fill: COLORS.accentBlue,
    fontFamily: FONT,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  }),
} as const;
