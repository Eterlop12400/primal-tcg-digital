// ============================================================
// Primal TCG — Essence Picker Overlay
// ============================================================
// Full-screen overlay for selecting essence cards to pay ability costs.
// Shows required symbols, validates selections match cost requirements,
// and provides clear feedback on what still needs to be paid.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CardSprite } from '../CardSprite';
import { COLORS, CARD_SIZES, BoardLayout } from '../layout';
import { FONT } from '../SharedStyles';
import type { GameState, CardDef } from '@/game/types';
import type { UIState, UIAction } from '@/hooks/useGameEngine';
import { getCardDefForInstance } from '@/game/engine';

/** Get all symbols for a card (multi-symbol cards count for any of their symbols) */
function getCardSymbols(state: GameState, id: string): string[] {
  try {
    const def = getCardDefForInstance(state, id);
    return def.symbols ?? [];
  } catch { return []; }
}

/** Check if the current selection satisfies the specific symbol requirements.
 *  Multi-symbol cards (e.g. ['necro','plasma']) can satisfy either symbol cost. */
function validateSymbolCosts(
  selectedIds: string[],
  state: GameState,
  specificCosts: { symbol: string; count: number }[],
  cardSymbols?: string[],
  cardSymbolCount?: number,
): { satisfied: boolean; remaining: { symbol: string; count: number }[] } {
  // Assignment-based approach: track which cards are still unassigned
  const unassigned = new Set(selectedIds);

  const remaining: { symbol: string; count: number }[] = [];

  // Assign cards to specific costs first (most constrained)
  if (specificCosts && specificCosts.length > 0) {
    for (const cost of specificCosts) {
      let filled = 0;
      for (const id of [...unassigned]) {
        if (filled >= cost.count) break;
        const syms = getCardSymbols(state, id);
        if (syms.includes(cost.symbol)) {
          unassigned.delete(id);
          filled++;
        }
      }
      const need = cost.count - filled;
      if (need > 0) {
        remaining.push({ symbol: cost.symbol, count: need });
      }
    }
  }

  // Check cardSymbol cost (N cards matching any of the ability card's symbols)
  if (cardSymbols && cardSymbolCount && cardSymbolCount > 0) {
    let filled = 0;
    for (const id of [...unassigned]) {
      if (filled >= cardSymbolCount) break;
      const syms = getCardSymbols(state, id);
      if (cardSymbols.some(s => syms.includes(s))) {
        unassigned.delete(id);
        filled++;
      }
    }
    if (filled < cardSymbolCount) {
      remaining.push({ symbol: `card:${cardSymbols.join(',')}`, count: cardSymbolCount - filled });
    }
  }

  return { satisfied: remaining.length === 0, remaining };
}

export class EssencePickerOverlay extends Container {
  constructor(
    state: GameState,
    ui: UIState,
    layout: BoardLayout,
    dispatch: (action: UIAction) => void,
  ) {
    super();

    const sm = ui.selectionMode;
    if (sm.type !== 'ability-essence-cost' && sm.type !== 'activate-cost-select') return;

    const needed = sm.needed;
    const isXCost = sm.type === 'ability-essence-cost' && !!sm.isXCost;
    const specificCosts = (sm.type === 'ability-essence-cost' && sm.specificCosts) ? sm.specificCosts : [];
    const cardSymbols = (sm.type === 'ability-essence-cost' && sm.cardSymbols) ? sm.cardSymbols : undefined;
    const humanPlayer = ui.humanPlayer;
    const essenceIds = state.players[humanPlayer].essence;
    const selected = ui.selectedCardIds.length;

    // Derive cardSymbolCount from ability def if cardSymbols present
    let cardSymbolCount = 0;
    if (cardSymbols && sm.type === 'ability-essence-cost') {
      try {
        const abDef = getCardDefForInstance(state, sm.abilityCardId);
        if (abDef.cardType === 'ability') {
          cardSymbolCount = (abDef as import('@/game/types').AbilityCardDef).essenceCost.cardSymbol ?? 0;
        }
      } catch { /* skip */ }
    }

    // Validate current selection against symbol requirements
    const validation = validateSymbolCosts(ui.selectedCardIds, state, specificCosts, cardSymbols, cardSymbolCount);
    const hasEnoughCards = isXCost ? selected >= Math.max(needed, 1) : selected >= needed;
    const xValue = Math.max(0, selected - needed);
    const isValid = hasEnoughCards && validation.satisfied;

    // Dimmed backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, layout.width, layout.height);
    backdrop.fill({ color: 0x000000, alpha: 0.8 });
    backdrop.eventMode = 'static';
    this.addChild(backdrop);

    // Panel dimensions
    const cardSize = CARD_SIZES.lg;
    const cardGap = 12;
    const cols = Math.min(essenceIds.length, 5);
    const rows = Math.ceil(essenceIds.length / cols);
    const gridW = cols * cardSize.width + (cols - 1) * cardGap;
    const gridH = rows * cardSize.height + (rows - 1) * cardGap;
    const panelPadX = 32;
    const hasRequirements = specificCosts.length > 0 || (cardSymbols && cardSymbolCount > 0);
    const requirementsH = hasRequirements ? 50 : 0;
    const panelPadTop = 60 + requirementsH;
    const panelPadBot = 70;
    const panelW = Math.max(gridW + panelPadX * 2, 320);
    const panelH = gridH + panelPadTop + panelPadBot;
    const panelX = (layout.width - panelW) / 2;
    const panelY = (layout.height - panelH) / 2;

    // Panel background
    const panel = new Graphics();
    panel.roundRect(panelX, panelY, panelW, panelH, 12);
    panel.fill({ color: 0x0f1520, alpha: 0.95 });
    panel.stroke({ color: COLORS.accentCyan, width: 2, alpha: 0.6 });
    this.addChild(panel);

    // Title
    const remaining = needed - selected;
    const titleText = isXCost
      ? `Pay X Essence (${selected} selected)`
      : remaining > 0
        ? `Select ${remaining} more essence card${remaining > 1 ? 's' : ''}`
        : validation.satisfied
          ? 'Cost paid!'
          : 'Wrong symbols selected';
    const titleColor = (hasEnoughCards && !validation.satisfied)
      ? 0xef4444  // Red when enough cards but wrong symbols
      : COLORS.accentCyan;
    const title = new Text({
      text: titleText,
      style: new TextStyle({
        fontSize: 20,
        fill: titleColor,
        fontFamily: FONT,
        fontWeight: 'bold',
      }),
    });
    title.anchor.set(0.5, 0);
    title.x = layout.width / 2;
    title.y = panelY + 18;
    this.addChild(title);

    // Subtitle
    const subtitle = new Text({
      text: isXCost
        ? needed > 0
          ? `${Math.min(selected, needed)}/${needed} base + X = ${xValue}`
          : `X = ${xValue} (select any amount)`
        : `${selected} / ${needed} selected`,
      style: new TextStyle({
        fontSize: 14,
        fill: COLORS.textMuted,
        fontFamily: FONT,
      }),
    });
    subtitle.anchor.set(0.5, 0);
    subtitle.x = layout.width / 2;
    subtitle.y = panelY + 42;
    this.addChild(subtitle);

    // Symbol requirements display
    if (hasRequirements) {
      const reqY = panelY + 62;
      // Build display costs: specific + cardSymbol + neutral remainder
      const allCosts: { symbol: string; count: number; isCardSymbol?: boolean }[] = [...specificCosts];
      // Add cardSymbol cost (e.g., "1 NECRO or PLAS")
      if (cardSymbols && cardSymbolCount > 0) {
        allCosts.push({ symbol: `card:${cardSymbols.join(',')}`, count: cardSymbolCount, isCardSymbol: true });
      }
      // Also show neutral cost if any
      const specificTotal = specificCosts.reduce((sum, s) => sum + s.count, 0) + cardSymbolCount;
      const neutralCost = needed - specificTotal;
      if (neutralCost > 0) {
        allCosts.push({ symbol: 'neutral', count: neutralCost });
      }
      const totalWidth = allCosts.length * 80 - 12;
      let reqX = (layout.width - totalWidth) / 2;

      for (const cost of allCosts) {
        const isCardSymbolCost = !!(cost as { isCardSymbol?: boolean }).isCardSymbol;

        // Determine display color
        let symColor: number;
        if (isCardSymbolCost && cardSymbols) {
          // Use first symbol's color
          symColor = COLORS.symbols[cardSymbols[0]] ?? COLORS.textMuted;
        } else if (cost.symbol !== 'neutral') {
          symColor = COLORS.symbols[cost.symbol] ?? COLORS.textMuted;
        } else {
          symColor = COLORS.textMuted;
        }

        // Count how many of this symbol are in selection (check ALL symbols per card)
        let selectedOfSymbol = 0;
        for (const id of ui.selectedCardIds) {
          const syms = getCardSymbols(state, id);
          if (isCardSymbolCost && cardSymbols) {
            if (cardSymbols.some(s => syms.includes(s))) selectedOfSymbol++;
          } else if (cost.symbol === 'neutral') {
            // Neutral — simplified counting
          } else if (syms.includes(cost.symbol)) {
            selectedOfSymbol++;
          }
        }
        // Cap at needed
        if (cost.symbol !== 'neutral') {
          selectedOfSymbol = Math.min(selectedOfSymbol, cost.count);
        }

        const isMet = cost.symbol === 'neutral'
          ? validation.satisfied
          : selectedOfSymbol >= cost.count;

        // Requirement pill
        const pillW = isCardSymbolCost ? 90 : 68;
        const pillH = 28;
        const pill = new Graphics();
        pill.roundRect(reqX, reqY, pillW, pillH, 6);
        pill.fill({ color: isMet ? symColor : 0x1a2535, alpha: isMet ? 0.3 : 0.8 });
        pill.stroke({ color: symColor, width: 1.5, alpha: isMet ? 1 : 0.4 });
        this.addChild(pill);

        // Symbol dot(s) — for cardSymbol, show multi-colored dot
        if (isCardSymbolCost && cardSymbols && cardSymbols.length > 1) {
          // Split dot — half/half colors
          const dotX = reqX + 14;
          const dotY = reqY + pillH / 2;
          const c1 = COLORS.symbols[cardSymbols[0]] ?? COLORS.textMuted;
          const c2 = COLORS.symbols[cardSymbols[1]] ?? COLORS.textMuted;
          const dot1 = new Graphics();
          dot1.circle(dotX - 2, dotY, 4);
          dot1.fill({ color: c1, alpha: isMet ? 1 : 0.5 });
          this.addChild(dot1);
          const dot2 = new Graphics();
          dot2.circle(dotX + 3, dotY, 4);
          dot2.fill({ color: c2, alpha: isMet ? 1 : 0.5 });
          this.addChild(dot2);
        } else {
          const dot = new Graphics();
          dot.circle(reqX + 14, reqY + pillH / 2, 5);
          dot.fill({ color: symColor, alpha: isMet ? 1 : 0.5 });
          this.addChild(dot);
        }

        // Label
        let labelText: string;
        if (isCardSymbolCost && cardSymbols) {
          labelText = `${cost.count} ${cardSymbols.map(s => s.toUpperCase().slice(0, 4)).join('/')}`;
        } else if (cost.symbol === 'neutral') {
          labelText = `${cost.count} ANY`;
        } else {
          labelText = `${cost.count} ${cost.symbol.toUpperCase().slice(0, 4)}`;
        }
        const reqLabel = new Text({
          text: labelText,
          style: new TextStyle({
            fontSize: 11,
            fill: isMet ? COLORS.textBright : COLORS.textMuted,
            fontFamily: FONT,
            fontWeight: 'bold',
          }),
        });
        reqLabel.anchor.set(0, 0.5);
        reqLabel.x = reqX + 22;
        reqLabel.y = reqY + pillH / 2;
        this.addChild(reqLabel);

        // Checkmark
        if (isMet) {
          const check = new Text({
            text: '\u2713',
            style: new TextStyle({ fontSize: 14, fill: 0x10b981, fontFamily: FONT, fontWeight: 'bold' }),
          });
          check.anchor.set(0.5, 0.5);
          check.x = reqX + pillW - 10;
          check.y = reqY + pillH / 2;
          this.addChild(check);
        }

        reqX += (isCardSymbolCost ? 102 : 80);
      }
    }

    // Card grid
    const gridStartX = panelX + (panelW - gridW) / 2;
    const gridStartY = panelY + panelPadTop;

    for (let i = 0; i < essenceIds.length; i++) {
      const eid = essenceIds[i];
      const eInst = state.cards[eid];
      if (!eInst) continue;

      let eDef: CardDef | undefined;
      try { eDef = getCardDefForInstance(state, eid); } catch { /* skip */ }

      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = gridStartX + col * (cardSize.width + cardGap);
      const cy = gridStartY + row * (cardSize.height + cardGap);

      const isSelected = ui.selectedCardIds.includes(eid);

      // Determine if this card's symbol is needed
      const cardSymbol = eDef?.symbols?.[0] ?? 'neutral';
      const isNeededSymbol = specificCosts.some(c => c.symbol === cardSymbol) || true; // All essence is potentially useful

      // Selection highlight behind card
      if (isSelected) {
        const highlight = new Graphics();
        highlight.roundRect(cx - 4, cy - 4, cardSize.width + 8, cardSize.height + 8, 8);
        highlight.fill({ color: COLORS.accentCyan, alpha: 0.2 });
        highlight.stroke({ color: COLORS.accentCyan, width: 2, alpha: 0.8 });
        this.addChild(highlight);
      }

      // Symbol color border
      const symColor = eDef?.symbols?.[0] ? (COLORS.symbols[eDef.symbols[0]] ?? COLORS.textMuted) : COLORS.textMuted;
      const symBorder = new Graphics();
      symBorder.roundRect(cx - 2, cy - 2, cardSize.width + 4, cardSize.height + 4, 6);
      symBorder.stroke({ color: symColor, width: isSelected ? 0 : 2, alpha: 0.6 });
      this.addChild(symBorder);

      const card = new CardSprite({
        defId: eInst.defId,
        size: cardSize,
        cardDef: eDef,
        instance: eInst,
        showName: true,
        selected: isSelected,
        highlighted: true,
        interactive: true,
      });
      card.x = cx;
      card.y = cy;
      if (!isSelected) card.alpha = 0.7;

      card.on('pointerdown', () => {
        const isDeselecting = ui.selectedCardIds.includes(eid);

        // For non-X costs, prevent selecting more cards than needed
        if (!isXCost && !isDeselecting && ui.selectedCardIds.length >= needed) {
          return; // Already at max selection
        }

        dispatch({ type: 'TOGGLE_CARD_SELECTION', cardId: eid });

        // Auto-submit ONLY when enough cards selected AND symbol requirements met (skip for X costs)
        if (!isXCost) {
          const newSelected = isDeselecting
            ? ui.selectedCardIds.filter((id) => id !== eid)
            : [...ui.selectedCardIds, eid];

          if (newSelected.length >= needed) {
            // Validate symbol requirements before auto-submitting
            const newValidation = validateSymbolCosts(newSelected, state, specificCosts, cardSymbols, cardSymbolCount);
            if (!newValidation.satisfied) {
              // Don't auto-submit — wrong symbols. Player needs to swap cards.
              return;
            }

            if (sm.type === 'ability-essence-cost') {
              dispatch({
                type: 'PERFORM_ACTION',
                player: humanPlayer,
                action: {
                  type: 'play-ability',
                  cardInstanceId: sm.abilityCardId,
                  userId: sm.userId,
                  targetIds: sm.targetIds,
                  essenceCostCardIds: newSelected,
                },
              });
            } else if (sm.type === 'activate-cost-select') {
              dispatch({
                type: 'PERFORM_ACTION',
                player: humanPlayer,
                action: {
                  type: 'activate-effect',
                  cardInstanceId: sm.cardId,
                  effectId: sm.effectId,
                  targetIds: sm.targetIds,
                  costCardIds: newSelected,
                },
              });
            }
          }
        }
      });

      this.addChild(card);

      // Symbol label under card
      const symName = eDef?.symbols?.[0] ?? 'neutral';
      const symLbl = new Text({
        text: symName.toUpperCase(),
        style: new TextStyle({
          fontSize: 10,
          fill: symColor,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 1,
        }),
      });
      symLbl.anchor.set(0.5, 0);
      symLbl.x = cx + cardSize.width / 2;
      symLbl.y = cy + cardSize.height + 2;
      this.addChild(symLbl);
    }

    // Buttons
    const btnW = 120;
    const btnH = 36;
    const btnGap = 16;
    const btnY = panelY + panelH - panelPadBot + 12;

    // Show CONFIRM + CANCEL for X costs OR when player has enough cards but needs to manually confirm
    const showConfirmCancel = isXCost || (hasEnoughCards && !validation.satisfied);

    if (showConfirmCancel && sm.type === 'ability-essence-cost') {
      // CONFIRM button
      const confirmX = layout.width / 2 - btnW - btnGap / 2;
      const canConfirm = isXCost ? selected >= Math.max(needed, 1) && validation.satisfied : isValid;
      const confirmBg = new Graphics();
      confirmBg.roundRect(confirmX, btnY, btnW, btnH, 8);
      confirmBg.fill({ color: canConfirm ? COLORS.buttonPrimary : 0x1a2535, alpha: 0.9 });
      confirmBg.stroke({ color: canConfirm ? COLORS.buttonPrimary : COLORS.textMuted, width: 1, alpha: 0.5 });
      confirmBg.eventMode = 'static';
      confirmBg.cursor = canConfirm ? 'pointer' : 'not-allowed';
      confirmBg.on('pointerdown', () => {
        if (!canConfirm) return;
        dispatch({
          type: 'PERFORM_ACTION',
          player: humanPlayer,
          action: {
            type: 'play-ability',
            cardInstanceId: sm.abilityCardId,
            userId: sm.userId,
            targetIds: sm.targetIds,
            essenceCostCardIds: ui.selectedCardIds,
            ...(isXCost ? { xValue: Math.max(0, ui.selectedCardIds.length - needed) } : {}),
          },
        });
      });
      this.addChild(confirmBg);

      const confirmTxt = new Text({
        text: 'CONFIRM',
        style: new TextStyle({ fontSize: 14, fill: canConfirm ? COLORS.textBright : COLORS.textMuted, fontFamily: FONT, fontWeight: 'bold' }),
      });
      confirmTxt.anchor.set(0.5, 0.5);
      confirmTxt.x = confirmX + btnW / 2;
      confirmTxt.y = btnY + btnH / 2;
      this.addChild(confirmTxt);

      // Cancel button
      const cancelX = layout.width / 2 + btnGap / 2;
      const cancelBg = new Graphics();
      cancelBg.roundRect(cancelX, btnY, btnW, btnH, 8);
      cancelBg.fill({ color: 0x1e2a3a, alpha: 0.9 });
      cancelBg.stroke({ color: COLORS.textMuted, width: 1, alpha: 0.5 });
      cancelBg.eventMode = 'static';
      cancelBg.cursor = 'pointer';
      cancelBg.on('pointerdown', () => dispatch({ type: 'CLEAR_SELECTION' }));
      this.addChild(cancelBg);

      const cancelTxt = new Text({
        text: 'CANCEL',
        style: new TextStyle({ fontSize: 14, fill: COLORS.textMuted, fontFamily: FONT, fontWeight: 'bold' }),
      });
      cancelTxt.anchor.set(0.5, 0.5);
      cancelTxt.x = cancelX + btnW / 2;
      cancelTxt.y = btnY + btnH / 2;
      this.addChild(cancelTxt);
    } else {
      // Standard cancel-only button (centered)
      const btnX = layout.width / 2 - btnW / 2;
      const btnBg = new Graphics();
      btnBg.roundRect(btnX, btnY, btnW, btnH, 8);
      btnBg.fill({ color: 0x1e2a3a, alpha: 0.9 });
      btnBg.stroke({ color: COLORS.textMuted, width: 1, alpha: 0.5 });
      btnBg.eventMode = 'static';
      btnBg.cursor = 'pointer';
      btnBg.on('pointerdown', () => dispatch({ type: 'CLEAR_SELECTION' }));
      this.addChild(btnBg);

      const btnTxt = new Text({
        text: 'CANCEL',
        style: new TextStyle({ fontSize: 14, fill: COLORS.textMuted, fontFamily: FONT, fontWeight: 'bold' }),
      });
      btnTxt.anchor.set(0.5, 0.5);
      btnTxt.x = btnX + btnW / 2;
      btnTxt.y = btnY + btnH / 2;
      this.addChild(btnTxt);
    }

    // Validation error message when wrong symbols selected
    if (hasEnoughCards && !validation.satisfied) {
      const errorY = btnY + btnH + 8;
      const missingText = validation.remaining
        .map(r => {
          if (r.symbol.startsWith('card:')) {
            const syms = r.symbol.replace('card:', '').split(',');
            return `${r.count} ${syms.map(s => s.toUpperCase().slice(0, 4)).join('/')}`;
          }
          return `${r.count} ${r.symbol.toUpperCase()}`;
        })
        .join(', ');
      const errorMsg = new Text({
        text: `Still need: ${missingText}`,
        style: new TextStyle({
          fontSize: 13,
          fill: 0xef4444,
          fontFamily: FONT,
          fontWeight: 'bold',
        }),
      });
      errorMsg.anchor.set(0.5, 0);
      errorMsg.x = layout.width / 2;
      errorMsg.y = errorY;
      this.addChild(errorMsg);
    }
  }
}
