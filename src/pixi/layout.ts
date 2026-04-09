// ============================================================
// Primal TCG — PixiJS Layout Constants
// ============================================================

export const CARD_ASPECT = 5 / 7;

export interface CardSize {
  width: number;
  height: number;
}

export const CARD_SIZES = {
  xs: { width: 40, height: 56 } as CardSize,
  sm: { width: 56, height: 78 } as CardSize,
  md: { width: 72, height: 101 } as CardSize,
  lg: { width: 96, height: 134 } as CardSize,
  xl: { width: 120, height: 168 } as CardSize,
  preview: { width: 240, height: 336 } as CardSize,
};

export type CardSizeName = keyof typeof CARD_SIZES;

// --- Colors ---

export const COLORS = {
  // Board
  background: 0x080c14,
  panelBg: 0x0f1520,
  panelBorder: 0x1e2a3a,
  divider: 0x1a2535,

  // Glow / accent
  accentBlue: 0x3b82f6,
  accentGold: 0xf59e0b,
  accentCyan: 0x06b6d4,
  glowBlue: 0x1d4ed8,

  // Zones
  zoneBg: 0x111827,
  zoneBorder: 0x1f2937,
  zoneLabel: 0x6b7280,

  // Cards
  cardBorder: 0x374151,
  cardSelectedBorder: 0x3b82f6,
  cardHighlight: 0x2563eb,
  cardBack: 0x111827,
  cardShadow: 0x000000,

  // Stats
  leadColor: 0xfbbf24,
  supportColor: 0x60a5fa,

  // State
  healthyDot: 0x10b981,
  injuredDot: 0xef4444,

  // Text
  text: 0xd1d5db,
  textMuted: 0x6b7280,
  textBright: 0xf9fafb,
  textGold: 0xfbbf24,

  // UI
  buttonBg: 0x1f2937,
  buttonPrimary: 0x059669,
  buttonDanger: 0xdc2626,

  // Players
  player1Color: 0x3b82f6,
  player2Color: 0xf97316,

  // Symbols
  symbols: {
    necro: 0x8b5cf6,
    plasma: 0xf472b6,
    water: 0x3b82f6,
    fire: 0xef4444,
    terra: 0x84cc16,
    air: 0x38bdf8,
  } as Record<string, number>,
};

// --- Board Layout ---

export interface BoardLayout {
  width: number;
  height: number;

  // 3-column widths
  sideColW: number;    // left/right pile columns
  centerColW: number;  // main content column
  centerColX: number;  // x position of center column

  // Vertical sections
  opponentY: number;
  opponentH: number;
  centerBarY: number;
  centerBarH: number;
  playerY: number;
  playerH: number;
  uiBarY: number;
  uiBarH: number;

  // Card sizes
  cardSize: CardSize;      // kingdom/hand cards
  pileSize: CardSize;      // side pile cards (deck/discard/etc)
}

export function computeLayout(width: number, height: number): BoardLayout {
  const uiBarH = 36;
  const centerBarH = 44;
  const playableH = height - uiBarH;
  const halfH = (playableH - centerBarH) / 2;

  // Side columns: narrower, just for pile cards
  const sideColW = Math.min(120, width * 0.08);
  const centerColW = width - sideColW * 2;
  const centerColX = sideColW;

  // Card sizing — bigger cards for the center, smaller for piles
  let cardSize: CardSize;
  let pileSize: CardSize;

  if (height < 600) {
    cardSize = CARD_SIZES.sm;
    pileSize = CARD_SIZES.xs;
  } else if (height < 800) {
    cardSize = CARD_SIZES.md;
    pileSize = CARD_SIZES.sm;
  } else {
    cardSize = CARD_SIZES.lg;
    pileSize = CARD_SIZES.md;
  }

  return {
    width,
    height,
    sideColW,
    centerColW,
    centerColX,
    opponentY: 0,
    opponentH: halfH,
    centerBarY: halfH,
    centerBarH,
    playerY: halfH + centerBarH,
    playerH: halfH,
    uiBarY: height - uiBarH,
    uiBarH,
    cardSize,
    pileSize,
  };
}

// --- Helpers ---

export interface ZoneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutCardsInRow(
  zone: ZoneRect,
  cardSize: CardSize,
  count: number,
  maxWidth?: number,
): { x: number; y: number }[] {
  if (count === 0) return [];

  const availW = maxWidth ?? zone.width;
  const gap = 6;
  const fullW = count * cardSize.width + (count - 1) * gap;

  let effectiveGap = gap;
  let totalW = fullW;

  // Overlap if too wide
  if (fullW > availW) {
    effectiveGap = (availW - cardSize.width) / (count - 1) - cardSize.width;
    if (effectiveGap < -cardSize.width * 0.7) effectiveGap = -cardSize.width * 0.7;
    totalW = cardSize.width + (count - 1) * (cardSize.width + effectiveGap);
  }

  const startX = zone.x + (zone.width - totalW) / 2;
  const y = zone.y + (zone.height - cardSize.height) / 2;

  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * (cardSize.width + effectiveGap),
    y,
  }));
}
