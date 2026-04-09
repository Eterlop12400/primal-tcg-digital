// ============================================================
// Primal TCG — PixiJS Game Renderer
// ============================================================

import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
} from 'pixi.js';
import {
  computeLayout,
  BoardLayout,
  COLORS,
  CARD_SIZES,
  CardSize,
  layoutCardsInRow,
} from './layout';
import { CardSprite } from './CardSprite';
import { loadAllAssets } from './AssetLoader';
import { MulliganOverlay } from './overlays/MulliganOverlay';
import { TeamOrgOverlay } from './overlays/TeamOrgOverlay';
import { BattleOverlay } from './overlays/BattleOverlay';
import { CoinFlipOverlay } from './overlays/CoinFlipOverlay';
import {
  showTurnBanner,
  showPhaseBanner,
  showDamageNumber,
  screenShake,
  screenFlash,
  particleBurst,
  showChainNotification,
  animateCardSummon,
} from './effects/Animations';
import type {
  GameState,
  PlayerId,
  Phase,
  CardDef,
  CharacterCardDef,
  StrategyCardDef,
} from '@/game/types';
import type { UIState, UIAction } from '@/hooks/useGameEngine';
import {
  getCardDefForInstance,
  getEffectiveStats,
  getLegalActions,
} from '@/game/engine';
import {
  getActingPlayer,
  canSummonCard,
  canPlayStrategyCard,
  getValidHandCostCards,
} from '@/lib/gameHelpers';
import { PHASE_LABELS } from '@/lib/constants';

export class GameRenderer {
  app: Application;
  private boardLayer = new Container();
  private overlayLayer = new Container();
  private effectsLayer = new Container();
  private uiLayer = new Container();
  private layout!: BoardLayout;
  private initialized = false;
  private currentGameState: GameState | null = null;
  private currentUIState: UIState | null = null;
  private dispatch: ((action: UIAction) => void) | null = null;

  // Animation tracking
  private prevPhase: Phase | null = null;
  private prevTurn: number = 0;
  private prevCurrentTurn: PlayerId | null = null;
  private coinFlipShown = false;

  constructor() {
    this.app = new Application();
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    await loadAllAssets();
    await this.app.init({
      canvas,
      resizeTo: canvas.parentElement ?? undefined,
      backgroundColor: COLORS.background,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    this.app.stage.addChild(this.boardLayer);
    this.app.stage.addChild(this.overlayLayer);
    this.app.stage.addChild(this.effectsLayer);
    this.app.stage.addChild(this.uiLayer);
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height);
    this.initialized = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDispatch(dispatch: (action: any) => void): void {
    this.dispatch = dispatch;
  }

  resize(): void {
    if (!this.initialized) return;
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height);
    if (this.currentGameState && this.currentUIState) {
      this.update(this.currentGameState, this.currentUIState);
    }
  }

  update(gameState: GameState, uiState: UIState): void {
    const prevState = this.currentGameState;
    this.currentGameState = gameState;
    this.currentUIState = uiState;

    this.boardLayer.removeChildren();
    this.overlayLayer.removeChildren();
    // Don't clear effects layer — animations persist across frames
    this.uiLayer.removeChildren();
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height);

    // Trigger animations on state transitions
    this.checkAnimationTriggers(gameState, uiState, prevState);

    this.drawBackground();
    this.renderBoard(gameState, uiState);
    this.renderCenterBar(gameState, uiState);
    this.renderUIBar(gameState, uiState);

    // Render action buttons for human player (pvai only, not during battle overlay)
    if (uiState.mode === 'pvai' && !gameState.gameOver && !this.shouldShowBattle(gameState)) {
      this.renderActionButtons(gameState, uiState);
    }

    // Overlays
    if (gameState.gameOver) {
      this.renderGameOver(gameState, uiState);
    } else if (this.shouldShowMulligan(uiState)) {
      this.renderMulliganOverlay(gameState, uiState);
    } else if (uiState.selectionMode.type === 'team-organize') {
      this.renderTeamOrgOverlay(gameState, uiState);
    } else if (this.shouldShowBattle(gameState)) {
      this.renderBattleOverlay(gameState, uiState);
    }

    // Coin flip overlay (fires once, self-destroys via GSAP)
    this.checkCoinFlip(gameState, uiState);
  }

  // ============================================================
  // Animation Triggers
  // ============================================================

  private checkAnimationTriggers(state: GameState, ui: UIState, prev: GameState | null): void {
    if (!prev) {
      this.prevPhase = state.phase;
      this.prevTurn = state.turnNumber;
      this.prevCurrentTurn = state.currentTurn;
      return;
    }

    const L = this.layout;

    // Turn change banner
    if (state.currentTurn !== this.prevCurrentTurn && state.phase === 'start') {
      const label = ui.mode === 'aivai'
        ? (state.currentTurn === 'player1' ? 'PLAYER 1 TURN' : 'PLAYER 2 TURN')
        : (state.currentTurn === ui.humanPlayer ? 'YOUR TURN' : "OPPONENT'S TURN");
      showTurnBanner(this.effectsLayer, label, L.width, L.height);
    }

    // Phase change banner
    if (state.phase !== this.prevPhase && state.currentTurn === this.prevCurrentTurn) {
      const phaseText = PHASE_LABELS[state.phase] ?? state.phase;
      if (state.phase !== 'start' && state.phase !== 'setup') {
        showPhaseBanner(this.effectsLayer, phaseText, L.width, L.height);
      }
    }

    // Battle reward gained — screen flash + particles
    const prevP1BR = prev.players.player1.battleRewards.length;
    const prevP2BR = prev.players.player2.battleRewards.length;
    const curP1BR = state.players.player1.battleRewards.length;
    const curP2BR = state.players.player2.battleRewards.length;

    if (curP1BR > prevP1BR || curP2BR > prevP2BR) {
      screenFlash(this.effectsLayer, L.width, L.height, COLORS.accentGold);
      particleBurst(this.effectsLayer, L.width / 2, L.height / 2, COLORS.accentGold, 20);
    }

    // Character discarded — shake
    const prevTotalKingdom = prev.players.player1.kingdom.length + prev.players.player2.kingdom.length;
    const curTotalKingdom = state.players.player1.kingdom.length + state.players.player2.kingdom.length;
    if (curTotalKingdom < prevTotalKingdom) {
      screenShake(this.boardLayer, 3, 0.2);
    }

    // Card drawn — flash effect from deck to hand
    for (const pid of ['player1', 'player2'] as PlayerId[]) {
      const prevHand = prev.players[pid].hand.length;
      const curHand = state.players[pid].hand.length;
      if (curHand > prevHand) {
        const isBottom = (ui.mode === 'aivai' ? pid === 'player1' : pid === ui.humanPlayer);
        const deckX = L.width - L.sideColW / 2;
        const deckY = isBottom ? L.playerY + L.playerH / 2 : L.opponentY + L.opponentH / 2;
        const handY = isBottom ? L.height - L.uiBarH - 80 : 80;
        // Draw flash: a small card-like shape flies from deck to hand
        const drawCount = curHand - prevHand;
        for (let d = 0; d < drawCount; d++) {
          const flash = new Graphics();
          flash.roundRect(0, 0, 30, 42, 3);
          flash.fill({ color: COLORS.accentCyan, alpha: 0.7 });
          flash.stroke({ color: COLORS.accentCyan, width: 1 });
          this.effectsLayer.addChild(flash);
          animateCardSummon(flash, deckX, deckY, L.width / 2 + d * 20, handY);
          // Auto-cleanup after animation
          setTimeout(() => {
            try { this.effectsLayer.removeChild(flash); flash.destroy(); } catch { /* ok */ }
          }, 600);
        }
      }
    }

    // Chain entry — show what's activating
    if (state.chain.length > prev.chain.length) {
      const newEntry = state.chain[state.chain.length - 1];
      if (newEntry) {
        let cardName = 'Effect';
        try {
          const def = getCardDefForInstance(state, newEntry.sourceCardInstanceId);
          cardName = def.name;
        } catch { /* skip */ }
        showChainNotification(this.effectsLayer, `${cardName} activates!`, L.width, L.height);
      }
    }

    // Chain resolution notification
    if (prev.chain.length > 0 && state.chain.length === 0 && !state.isChainResolving) {
      showChainNotification(this.effectsLayer, 'CHAIN RESOLVED', L.width, L.height);
    }

    this.prevPhase = state.phase;
    this.prevTurn = state.turnNumber;
    this.prevCurrentTurn = state.currentTurn;
  }

  // ============================================================
  // Background
  // ============================================================

  private drawBackground(): void {
    const { width, height } = this.layout;
    const bg = new Graphics();
    bg.rect(0, 0, width, height);
    bg.fill({ color: COLORS.background });
    this.boardLayer.addChild(bg);

    const topPanel = new Graphics();
    topPanel.rect(0, 0, width, this.layout.centerBarY);
    topPanel.fill({ color: 0x0a1020, alpha: 0.5 });
    this.boardLayer.addChild(topPanel);

    const botPanel = new Graphics();
    botPanel.rect(0, this.layout.playerY, width, this.layout.playerH);
    botPanel.fill({ color: 0x0a1020, alpha: 0.5 });
    this.boardLayer.addChild(botPanel);

    for (const x of [0, width - this.layout.sideColW]) {
      const sidePanel = new Graphics();
      sidePanel.rect(x, 0, this.layout.sideColW, height - this.layout.uiBarH);
      sidePanel.fill({ color: 0x060a12, alpha: 0.6 });
      this.boardLayer.addChild(sidePanel);
    }

    for (const x of [this.layout.sideColW, width - this.layout.sideColW]) {
      const line = new Graphics();
      line.moveTo(x, 4);
      line.lineTo(x, height - this.layout.uiBarH - 4);
      line.stroke({ color: 0x1a2535, width: 1, alpha: 0.5 });
      this.boardLayer.addChild(line);
    }
  }

  // ============================================================
  // Board
  // ============================================================

  private renderBoard(state: GameState, ui: UIState): void {
    const bottomPlayer: PlayerId = ui.mode === 'aivai' ? 'player1' : ui.humanPlayer;
    const topPlayer: PlayerId = bottomPlayer === 'player1' ? 'player2' : 'player1';
    this.renderPlayerHalf(state, topPlayer, true, ui);
    this.renderPlayerHalf(state, bottomPlayer, false, ui);
  }

  // ============================================================
  // Player Half
  // ============================================================

  private renderPlayerHalf(state: GameState, player: PlayerId, isTop: boolean, ui: UIState): void {
    const L = this.layout;
    const areaY = isTop ? L.opponentY : L.playerY;
    const areaH = isTop ? L.opponentH : L.playerH;

    this.renderPileColumn(state, player, 0, areaY, L.sideColW, areaH, 'left');
    this.renderPileColumn(state, player, L.width - L.sideColW, areaY, L.sideColW, areaH, 'right');

    const cardSize = L.cardSize;
    const pad = 8;
    const handH = cardSize.height + 16;
    const kingdomH = areaH - handH - pad;

    let kingdomY: number, handY: number;
    if (isTop) {
      kingdomY = areaY + pad;
      handY = areaY + kingdomH + pad;
    } else {
      handY = areaY + areaH - handH;
      kingdomY = areaY;
    }

    this.renderKingdom(state, player, L.centerColX, kingdomY, L.centerColW, kingdomH, cardSize);
    this.renderHand(state, player, L.centerColX, handY, L.centerColW, handH, cardSize, isTop, ui);
  }

  // ============================================================
  // Pile Columns
  // ============================================================

  private renderPileColumn(state: GameState, player: PlayerId, x: number, y: number, w: number, h: number, side: 'left' | 'right'): void {
    const pState = state.players[player];
    const pileSize = this.layout.pileSize;
    const gap = 6;

    type PileInfo = { label: string; instanceId?: string; count?: number; faceDown?: boolean };
    const piles: PileInfo[] = side === 'left'
      ? [
          { label: 'FIELD', instanceId: pState.fieldCard },
          { label: 'BR', count: pState.battleRewards.length, instanceId: pState.battleRewards[pState.battleRewards.length - 1], faceDown: true },
        ]
      : [
          { label: 'DECK', count: pState.deck.length, faceDown: true },
          { label: 'DISCARD', count: pState.discard.length, instanceId: pState.discard[pState.discard.length - 1] },
          { label: 'ESSENCE', count: pState.essence.length, instanceId: pState.essence[0] },
        ];

    const labelH = 12;
    const slotH = pileSize.height + labelH + 4;
    const totalH = piles.length * slotH + (piles.length - 1) * gap;
    const startY = y + (h - totalH) / 2;
    const centerX = x + (w - pileSize.width) / 2;

    piles.forEach((pile, i) => {
      const slotY = startY + i * (slotH + gap);

      const lbl = new Text({
        text: pile.count !== undefined ? `${pile.label} (${pile.count})` : pile.label,
        style: new TextStyle({ fontSize: 8, fill: COLORS.zoneLabel, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 1 }),
      });
      lbl.anchor.set(0.5, 0);
      lbl.x = x + w / 2;
      lbl.y = slotY;
      this.boardLayer.addChild(lbl);

      const cardY = slotY + labelH + 2;

      if (pile.instanceId && !pile.faceDown) {
        const inst = state.cards[pile.instanceId];
        if (inst) {
          let def: CardDef | undefined;
          let stats: { lead: number; support: number } | undefined;
          try {
            def = getCardDefForInstance(state, pile.instanceId);
            if (def.cardType === 'character') stats = getEffectiveStats(state, pile.instanceId);
          } catch { /* skip */ }
          const card = new CardSprite({ defId: inst.defId, size: pileSize, cardDef: def, instance: inst, effectiveStats: stats, showName: pileSize.width >= 56 });
          card.x = centerX;
          card.y = cardY;
          this.boardLayer.addChild(card);
          return;
        }
      }

      if (pile.faceDown && ((pile.count ?? 0) > 0 || pile.instanceId)) {
        const stackCount = Math.min(pile.count ?? 1, 3);
        for (let s = stackCount - 1; s >= 0; s--) {
          const offset = s * 2;
          const stackCard = new CardSprite({ defId: '', size: pileSize, faceDown: true });
          stackCard.x = centerX + offset;
          stackCard.y = cardY + offset;
          stackCard.alpha = s === 0 ? 1 : 0.6;
          this.boardLayer.addChild(stackCard);
        }
        return;
      }

      const emptySlot = new Graphics();
      emptySlot.roundRect(centerX, cardY, pileSize.width, pileSize.height, 4);
      emptySlot.stroke({ color: COLORS.zoneBorder, width: 1, alpha: 0.3 });
      this.boardLayer.addChild(emptySlot);
    });
  }

  // ============================================================
  // Kingdom
  // ============================================================

  private renderKingdom(state: GameState, player: PlayerId, x: number, y: number, w: number, h: number, cardSize: CardSize): void {
    const pState = state.players[player];
    const teams = Object.values(state.teams).filter((t) => t.owner === player);
    const teamedIds = new Set(teams.flatMap((t) => t.characterIds));
    const soloChars = pState.kingdom.filter((id) => !teamedIds.has(id));

    if (teams.length === 0 && soloChars.length === 0) {
      const txt = new Text({
        text: 'KINGDOM',
        style: new TextStyle({ fontSize: 11, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif', letterSpacing: 2 }),
      });
      txt.anchor.set(0.5, 0.5);
      txt.x = x + w / 2;
      txt.y = y + h / 2;
      txt.alpha = 0.4;
      this.boardLayer.addChild(txt);
      return;
    }

    type Group = { label: string; charIds: string[]; power: number };
    const groups: Group[] = [];

    for (const team of teams) {
      let power = 0;
      for (const cid of team.characterIds) {
        try {
          const stats = getEffectiveStats(state, cid);
          const inst = state.cards[cid];
          if (inst?.battleRole === 'team-lead') power += stats.lead;
          else power += stats.support;
        } catch { /* skip */ }
      }
      groups.push({ label: `${power}`, charIds: team.characterIds, power });
    }

    if (soloChars.length > 0) groups.push({ label: '', charIds: soloChars, power: 0 });

    const groupGap = 24;
    const cardGap = 4;

    let totalW = 0;
    for (const g of groups) totalW += g.charIds.length * cardSize.width + (g.charIds.length - 1) * cardGap;
    totalW += (groups.length - 1) * groupGap;

    let actualSize = cardSize;
    if (totalW > w - 20) {
      const scale = (w - 20) / totalW;
      actualSize = { width: Math.floor(cardSize.width * scale), height: Math.floor(cardSize.height * scale) };
      totalW = 0;
      for (const g of groups) totalW += g.charIds.length * actualSize.width + (g.charIds.length - 1) * cardGap;
      totalW += (groups.length - 1) * groupGap;
    }

    let curX = x + (w - totalW) / 2;
    const cardY = y + (h - actualSize.height) / 2;

    for (const group of groups) {
      const groupW = group.charIds.length * actualSize.width + (group.charIds.length - 1) * cardGap;

      if (group.label) {
        const panelPad = 6;
        const panelBg = new Graphics();
        panelBg.roundRect(curX - panelPad, cardY - 18, groupW + panelPad * 2, actualSize.height + 24, 6);
        panelBg.fill({ color: 0x111827, alpha: 0.6 });
        panelBg.stroke({ color: COLORS.panelBorder, width: 1, alpha: 0.4 });
        this.boardLayer.addChild(panelBg);

        const pwrTxt = new Text({
          text: `PWR ${group.power}`,
          style: new TextStyle({ fontSize: 9, fill: COLORS.textGold, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
        });
        pwrTxt.anchor.set(0.5, 1);
        pwrTxt.x = curX + groupW / 2;
        pwrTxt.y = cardY - 4;
        this.boardLayer.addChild(pwrTxt);
      }

      for (let i = 0; i < group.charIds.length; i++) {
        const cid = group.charIds[i];
        const inst = state.cards[cid];
        if (!inst) continue;

        let def: CardDef | undefined;
        let stats: { lead: number; support: number } | undefined;
        try { def = getCardDefForInstance(state, cid); stats = getEffectiveStats(state, cid); } catch { /* skip */ }

        const isInjured = inst.state === 'injured';
        const card = new CardSprite({ defId: inst.defId, size: actualSize, cardDef: def, instance: inst, effectiveStats: stats, injured: isInjured });

        if (isInjured) {
          card.x = curX + i * (actualSize.width + cardGap) + actualSize.width / 2;
          card.y = cardY + actualSize.height / 2;
        } else {
          card.x = curX + i * (actualSize.width + cardGap);
          card.y = cardY;
        }
        this.boardLayer.addChild(card);
      }

      curX += groupW + groupGap;
    }
  }

  // ============================================================
  // Hand (with interactivity for bottom player in pvai)
  // ============================================================

  private renderHand(state: GameState, player: PlayerId, x: number, y: number, w: number, h: number, cardSize: CardSize, isTop: boolean, ui: UIState): void {
    const pState = state.players[player];
    const playerLabel = ui.mode === 'aivai' ? (player === 'player1' ? 'P1' : 'P2') : (isTop ? 'OPP' : 'YOU');

    if (pState.hand.length === 0) {
      const txt = new Text({
        text: `${playerLabel} HAND — EMPTY`,
        style: new TextStyle({ fontSize: 10, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif', letterSpacing: 1 }),
      });
      txt.anchor.set(0.5, 0.5);
      txt.x = x + w / 2;
      txt.y = y + h / 2;
      txt.alpha = 0.5;
      this.boardLayer.addChild(txt);
      return;
    }

    const isFaceDown = isTop && ui.mode === 'pvai';
    const isHumanHand = !isTop && ui.mode === 'pvai';

    // Hint text for selection modes
    if (isHumanHand && ui.selectionMode.type !== 'none' && ui.selectionMode.type !== 'mulligan') {
      const hints: Record<string, string> = {
        'summon-select': 'Select a character to summon',
        'strategy-select': 'Select a strategy to play',
        'hand-cost': `Select ${(ui.selectionMode as { needed: number }).needed} card(s) to pay hand cost`,
        'charge-essence': 'Select cards to charge as essence',
        'discard-to-hand-limit': `Discard ${(ui.selectionMode as { count: number }).count} card(s)`,
      };
      const hint = hints[ui.selectionMode.type];
      if (hint) {
        const hintTxt = new Text({
          text: hint,
          style: new TextStyle({ fontSize: 10, fill: COLORS.accentCyan, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
        });
        hintTxt.anchor.set(0.5, 0);
        hintTxt.x = x + w / 2;
        hintTxt.y = y - 2;
        this.boardLayer.addChild(hintTxt);
      }
    }

    const lbl = new Text({
      text: `${playerLabel} HAND (${pState.hand.length})`,
      style: new TextStyle({ fontSize: 9, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 1 }),
    });
    lbl.x = x + 12;
    lbl.y = isTop ? y + h - 10 : y + 2;
    lbl.alpha = 0.6;
    this.boardLayer.addChild(lbl);

    const positions = layoutCardsInRow(
      { x: x + 8, y: y + (isTop ? 0 : 12), width: w - 16, height: h - 14 },
      cardSize, pState.hand.length, w - 16,
    );

    for (let i = 0; i < pState.hand.length; i++) {
      const instanceId = pState.hand[i];
      const inst = state.cards[instanceId];
      if (!inst) continue;

      let def: CardDef | undefined;
      let stats: { lead: number; support: number } | undefined;
      if (!isFaceDown) {
        try { def = getCardDefForInstance(state, instanceId); if (def.cardType === 'character') stats = getEffectiveStats(state, instanceId); } catch { /* skip */ }
      }

      // Determine highlights and interactivity
      const isSelected = ui.selectedCardIds.includes(instanceId);
      const isHighlighted = isHumanHand && this.isCardHighlighted(state, ui, instanceId, def);
      const isInteractive = isHumanHand && !state.gameOver;

      const card = new CardSprite({
        defId: inst.defId,
        size: cardSize,
        faceDown: isFaceDown,
        cardDef: isFaceDown ? undefined : def,
        instance: isFaceDown ? undefined : inst,
        effectiveStats: stats,
        selected: isSelected,
        highlighted: isHighlighted,
        interactive: isInteractive,
      });
      card.x = positions[i]?.x ?? 0;
      card.y = positions[i]?.y ?? 0;

      // Lift selected cards up
      if (isSelected) card.y -= 8;

      // Click handler
      if (isInteractive && this.dispatch) {
        const d = this.dispatch;
        card.on('pointerdown', () => this.handleHandCardClick(state, ui, instanceId, def, d));
      }

      this.boardLayer.addChild(card);
    }
  }

  // ============================================================
  // Hand Card Click Logic (ported from PlayerArea.tsx)
  // ============================================================

  private handleHandCardClick(state: GameState, ui: UIState, instanceId: string, def: CardDef | undefined, dispatch: (action: UIAction) => void): void {
    const hp = ui.humanPlayer;
    const sm = ui.selectionMode;

    switch (sm.type) {
      case 'summon-select': {
        if (def?.cardType === 'character' && canSummonCard(state, hp, instanceId)) {
          const charDef = def as CharacterCardDef;
          if (charDef.handCost > 0) {
            dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'hand-cost', forCardId: instanceId, needed: charDef.handCost } });
          } else {
            dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'summon', cardInstanceId: instanceId } });
          }
        }
        break;
      }

      case 'strategy-select': {
        if (def?.cardType === 'strategy' && canPlayStrategyCard(state, hp, instanceId)) {
          const stratDef = def as StrategyCardDef;
          if (stratDef.handCost > 0) {
            dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'hand-cost', forCardId: instanceId, needed: stratDef.handCost } });
          } else {
            dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'play-strategy', cardInstanceId: instanceId } });
          }
        }
        break;
      }

      case 'hand-cost': {
        const validIds = getValidHandCostCards(state, hp, sm.forCardId);
        if (!validIds.includes(instanceId)) return;

        dispatch({ type: 'TOGGLE_CARD_SELECTION', cardId: instanceId });

        // Check for auto-submit
        const newSelected = ui.selectedCardIds.includes(instanceId)
          ? ui.selectedCardIds.filter((id) => id !== instanceId)
          : [...ui.selectedCardIds, instanceId];

        if (newSelected.length >= sm.needed) {
          // Determine if summoning or playing strategy
          const forDef = getCardDefForInstance(state, sm.forCardId);
          if (forDef.cardType === 'character') {
            dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'summon', cardInstanceId: sm.forCardId, handCostCardIds: newSelected } });
          } else if (forDef.cardType === 'strategy') {
            dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'play-strategy', cardInstanceId: sm.forCardId, handCostCardIds: newSelected } });
          }
        }
        break;
      }

      case 'charge-essence': {
        dispatch({ type: 'TOGGLE_CARD_SELECTION', cardId: instanceId });
        break;
      }

      case 'discard-to-hand-limit': {
        dispatch({ type: 'TOGGLE_CARD_SELECTION', cardId: instanceId });

        const newSelected = ui.selectedCardIds.includes(instanceId)
          ? ui.selectedCardIds.filter((id) => id !== instanceId)
          : [...ui.selectedCardIds, instanceId];

        if (newSelected.length >= sm.count) {
          dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'discard-to-hand-limit', cardInstanceIds: newSelected } });
        }
        break;
      }

      case 'none': {
        // Direct summon during main phase
        if (def?.cardType === 'character' && canSummonCard(state, hp, instanceId)) {
          const charDef = def as CharacterCardDef;
          if (charDef.handCost > 0) {
            dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'hand-cost', forCardId: instanceId, needed: charDef.handCost } });
          } else {
            dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'summon', cardInstanceId: instanceId } });
          }
        }
        break;
      }
    }
  }

  // ============================================================
  // Card Highlighting
  // ============================================================

  private isCardHighlighted(state: GameState, ui: UIState, instanceId: string, def?: CardDef): boolean {
    const hp = ui.humanPlayer;
    const sm = ui.selectionMode;

    switch (sm.type) {
      case 'summon-select':
        return def?.cardType === 'character' && canSummonCard(state, hp, instanceId);
      case 'strategy-select':
        return def?.cardType === 'strategy' && canPlayStrategyCard(state, hp, instanceId);
      case 'hand-cost': {
        const valid = getValidHandCostCards(state, hp, sm.forCardId);
        return valid.includes(instanceId);
      }
      case 'charge-essence':
      case 'discard-to-hand-limit':
        return true;
      case 'none':
        // Highlight summonable during main phase
        return state.phase === 'main' && state.currentTurn === hp && def?.cardType === 'character' && canSummonCard(state, hp, instanceId);
      default:
        return false;
    }
  }

  // ============================================================
  // Action Buttons (above UI bar for human player)
  // ============================================================

  private renderActionButtons(state: GameState, ui: UIState): void {
    const L = this.layout;
    const hp = ui.humanPlayer;
    const actingPlayer = getActingPlayer(state);
    const isMyTurn = actingPlayer === hp;
    if (!isMyTurn || !this.dispatch) return;

    const sm = ui.selectionMode;
    const d = this.dispatch;
    const btnY = L.uiBarY - 44;
    const btnH = 32;
    const btnGap = 8;
    const buttons: { label: string; color: number; onClick: () => void }[] = [];

    // Selection mode buttons
    if (sm.type === 'charge-essence') {
      buttons.push({
        label: `CHARGE (${ui.selectedCardIds.length})`,
        color: COLORS.buttonPrimary,
        onClick: () => {
          if (ui.selectedCardIds.length > 0) {
            d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'charge-essence', cardInstanceIds: ui.selectedCardIds } });
          }
        },
      });
      buttons.push({ label: 'CANCEL', color: 0x374151, onClick: () => d({ type: 'CLEAR_SELECTION' }) });
    } else if (sm.type === 'summon-select' || sm.type === 'strategy-select' || sm.type === 'hand-cost') {
      buttons.push({ label: 'CANCEL', color: 0x374151, onClick: () => d({ type: 'CLEAR_SELECTION' }) });
    } else if (sm.type === 'none') {
      // Phase-specific buttons
      if (state.phase === 'main' && state.currentTurn === hp) {
        buttons.push({ label: 'SUMMON', color: COLORS.accentBlue, onClick: () => d({ type: 'SET_SELECTION_MODE', mode: { type: 'summon-select' } }) });
        buttons.push({ label: 'STRATEGY', color: 0x7c3aed, onClick: () => d({ type: 'SET_SELECTION_MODE', mode: { type: 'strategy-select' } }) });
        buttons.push({ label: 'CHARGE', color: 0x0891b2, onClick: () => d({ type: 'SET_SELECTION_MODE', mode: { type: 'charge-essence' } }) });
        buttons.push({ label: 'PASS', color: 0x374151, onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'pass-priority' } }) });
      } else if (state.phase === 'organization') {
        buttons.push({ label: 'ORGANIZE', color: COLORS.accentBlue, onClick: () => d({ type: 'SET_SELECTION_MODE', mode: { type: 'team-organize' } }) });
        buttons.push({ label: 'BATTLE', color: COLORS.buttonPrimary, onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'choose-battle-or-end', choice: 'battle' } }) });
        buttons.push({ label: 'END TURN', color: 0x374151, onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'choose-battle-or-end', choice: 'end' } }) });
      } else if (state.phase === 'battle-attack') {
        const myTeams = Object.values(state.teams).filter((t) => t.owner === hp);
        buttons.push({
          label: 'ATTACK',
          color: COLORS.buttonDanger,
          onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'select-attackers', teamIds: myTeams.slice(0, 3).map((t) => t.id) } }),
        });
        buttons.push({
          label: 'SKIP',
          color: 0x374151,
          onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'select-attackers', teamIds: [] } }),
        });
      } else if (state.phase === 'end') {
        buttons.push({ label: 'PASS', color: 0x374151, onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'pass-priority' } }) });
      }
    }

    if (buttons.length === 0) return;

    const totalW = buttons.length * 90 + (buttons.length - 1) * btnGap;
    let curX = L.width / 2 - totalW / 2;

    for (const btn of buttons) {
      const container = this.makeButton(btn.label, 90, btnH, btn.color);
      container.x = curX;
      container.y = btnY;
      container.on('pointerdown', btn.onClick);
      this.uiLayer.addChild(container);
      curX += 90 + btnGap;
    }
  }

  // ============================================================
  // Center Bar
  // ============================================================

  private renderCenterBar(state: GameState, ui: UIState): void {
    const L = this.layout;

    const barBg = new Graphics();
    barBg.rect(0, L.centerBarY, L.width, L.centerBarH);
    barBg.fill({ color: 0x0c1425 });
    this.boardLayer.addChild(barBg);

    for (const lineY of [L.centerBarY, L.centerBarY + L.centerBarH]) {
      const line = new Graphics();
      line.moveTo(0, lineY);
      line.lineTo(L.width, lineY);
      line.stroke({ color: COLORS.accentBlue, width: 1, alpha: 0.4 });
      this.boardLayer.addChild(line);
    }

    const phaseText = PHASE_LABELS[state.phase] ?? state.phase;
    const playerLabel = ui.mode === 'aivai'
      ? (state.currentTurn === 'player1' ? 'PLAYER 1' : 'PLAYER 2')
      : (state.currentTurn === ui.humanPlayer ? 'YOUR TURN' : "OPPONENT'S TURN");

    const turnTxt = new Text({
      text: `TURN ${state.turnNumber}`,
      style: new TextStyle({ fontSize: 11, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 2 }),
    });
    turnTxt.anchor.set(0, 0.5);
    turnTxt.x = L.centerColX + 16;
    turnTxt.y = L.centerBarY + L.centerBarH / 2;
    this.boardLayer.addChild(turnTxt);

    // Player indicator (left-center)
    const playerTxt = new Text({
      text: playerLabel,
      style: new TextStyle({ fontSize: 12, fill: COLORS.textBright, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 1 }),
    });
    playerTxt.anchor.set(0.5, 0.5);
    playerTxt.x = L.width / 2 - 60;
    playerTxt.y = L.centerBarY + L.centerBarH / 2;
    this.boardLayer.addChild(playerTxt);

    // Phase label (right-center)
    const phaseTxt = new Text({
      text: phaseText.toUpperCase(),
      style: new TextStyle({ fontSize: 12, fill: COLORS.accentBlue, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 2 }),
    });
    phaseTxt.anchor.set(0.5, 0.5);
    phaseTxt.x = L.width / 2 + 60;
    phaseTxt.y = L.centerBarY + L.centerBarH / 2;
    this.boardLayer.addChild(phaseTxt);

    if (state.chain.length > 0) {
      const chainTxt = new Text({
        text: `CHAIN ×${state.chain.length}`,
        style: new TextStyle({ fontSize: 10, fill: COLORS.textGold, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
      });
      chainTxt.anchor.set(0.5, 0);
      chainTxt.x = L.width / 2;
      chainTxt.y = L.centerBarY + L.centerBarH / 2 + 10;
      this.boardLayer.addChild(chainTxt);
    }

    if (ui.isAIThinking) {
      const thinkTxt = new Text({
        text: '● AI',
        style: new TextStyle({ fontSize: 10, fill: COLORS.accentCyan, fontFamily: 'Arial, sans-serif', fontStyle: 'italic' }),
      });
      thinkTxt.anchor.set(1, 0.5);
      thinkTxt.x = L.width - L.sideColW - 16;
      thinkTxt.y = L.centerBarY + L.centerBarH / 2;
      this.boardLayer.addChild(thinkTxt);
    }
  }

  // ============================================================
  // UI Bar
  // ============================================================

  private renderUIBar(state: GameState, ui: UIState): void {
    const L = this.layout;

    const bg = new Graphics();
    bg.rect(0, L.uiBarY, L.width, L.uiBarH);
    bg.fill({ color: 0x080c14 });
    this.uiLayer.addChild(bg);

    const border = new Graphics();
    border.moveTo(0, L.uiBarY);
    border.lineTo(L.width, L.uiBarY);
    border.stroke({ color: COLORS.panelBorder, width: 1 });
    this.uiLayer.addChild(border);

    const centerY = L.uiBarY + L.uiBarH / 2;
    const phases: Phase[] = ['start', 'main', 'organization', 'battle-attack', 'battle-block', 'battle-eoa', 'battle-showdown', 'end'];
    const dotR = 3;
    const dotGap = 16;
    const dotsW = phases.length * dotGap;
    const dotsStartX = L.width / 2 - dotsW / 2;

    phases.forEach((phase, i) => {
      const cx = dotsStartX + i * dotGap;
      const isActive = phase === state.phase;
      const dot = new Graphics();
      dot.circle(cx, centerY, isActive ? dotR + 1 : dotR);
      dot.fill({ color: isActive ? COLORS.accentBlue : COLORS.textMuted, alpha: isActive ? 1 : 0.3 });
      this.uiLayer.addChild(dot);
      if (isActive) {
        const glow = new Graphics();
        glow.circle(cx, centerY, dotR + 4);
        glow.stroke({ color: COLORS.accentBlue, width: 1, alpha: 0.3 });
        this.uiLayer.addChild(glow);
      }
    });

    const tmStr = ui.mode === 'aivai'
      ? `P1 TM:${state.players.player1.turnMarker}  P2 TM:${state.players.player2.turnMarker}`
      : `TM:${state.players[ui.humanPlayer].turnMarker}  OPP TM:${state.players[ui.humanPlayer === 'player1' ? 'player2' : 'player1'].turnMarker}`;
    const tmTxt = new Text({ text: tmStr, style: new TextStyle({ fontSize: 10, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif' }) });
    tmTxt.anchor.set(0, 0.5);
    tmTxt.x = 16;
    tmTxt.y = centerY;
    this.uiLayer.addChild(tmTxt);

    const brStr = ui.mode === 'aivai'
      ? `P1 BR:${state.players.player1.battleRewards.length}/10  P2 BR:${state.players.player2.battleRewards.length}/10`
      : `BR:${state.players[ui.humanPlayer].battleRewards.length}/10  OPP:${state.players[ui.humanPlayer === 'player1' ? 'player2' : 'player1'].battleRewards.length}/10`;
    const brTxt = new Text({ text: brStr, style: new TextStyle({ fontSize: 10, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif' }) });
    brTxt.anchor.set(1, 0.5);
    brTxt.x = L.width - 16;
    brTxt.y = centerY;
    this.uiLayer.addChild(brTxt);

    if (ui.lastError) {
      const errTxt = new Text({ text: ui.lastError, style: new TextStyle({ fontSize: 10, fill: COLORS.buttonDanger, fontFamily: 'Arial, sans-serif' }) });
      errTxt.anchor.set(0.5, 0.5);
      errTxt.x = L.width / 2;
      errTxt.y = centerY - 12;
      this.uiLayer.addChild(errTxt);
    }
  }

  // ============================================================
  // Overlays
  // ============================================================

  private shouldShowMulligan(ui: UIState): boolean {
    return ui.mode === 'pvai' && !ui.gameStarted && ui.selectionMode.type === 'mulligan' && !ui.mulliganDone[ui.humanPlayer];
  }

  private renderMulliganOverlay(state: GameState, ui: UIState): void {
    if (!this.dispatch) return;
    const overlay = new MulliganOverlay(state, ui, this.layout, this.dispatch);
    this.overlayLayer.addChild(overlay);
  }

  private renderTeamOrgOverlay(state: GameState, ui: UIState): void {
    if (!this.dispatch) return;
    const overlay = new TeamOrgOverlay(state, ui, this.layout, this.dispatch);
    this.overlayLayer.addChild(overlay);
  }

  private shouldShowBattle(state: GameState): boolean {
    const phase = state.phase;
    const isBattlePhase = phase === 'battle-attack' || phase === 'battle-block' || phase === 'battle-eoa' || phase === 'battle-showdown';
    if (!isBattlePhase) return false;
    const attackingTeams = Object.values(state.teams).filter((t) => t.isAttacking);
    return attackingTeams.length > 0;
  }

  private renderBattleOverlay(state: GameState, ui: UIState): void {
    if (!this.dispatch) return;
    const overlay = new BattleOverlay(state, ui, this.layout, this.dispatch);
    this.overlayLayer.addChild(overlay);
  }

  private checkCoinFlip(state: GameState, ui: UIState): void {
    if (this.coinFlipShown) return;
    if (state.turnNumber === 1 && state.phase !== 'setup' && ui.gameStarted) {
      this.coinFlipShown = true;
      const overlay = new CoinFlipOverlay(state, ui.mode, ui.humanPlayer, this.layout);
      this.effectsLayer.addChild(overlay);
    }
  }

  // ============================================================
  // Game Over
  // ============================================================

  private renderGameOver(state: GameState, ui: UIState): void {
    const L = this.layout;

    const backdrop = new Graphics();
    backdrop.rect(0, 0, L.width, L.height);
    backdrop.fill({ color: 0x000000, alpha: 0.75 });
    backdrop.eventMode = 'static';
    this.overlayLayer.addChild(backdrop);

    const glowLine = new Graphics();
    glowLine.moveTo(L.width * 0.2, L.height / 2 - 50);
    glowLine.lineTo(L.width * 0.8, L.height / 2 - 50);
    glowLine.stroke({ color: COLORS.accentGold, width: 2, alpha: 0.5 });
    this.overlayLayer.addChild(glowLine);

    const winnerLabel = ui.mode === 'aivai'
      ? (state.winner === 'player1' ? 'PLAYER 1' : 'PLAYER 2')
      : (state.winner === ui.humanPlayer ? 'YOU WIN' : 'DEFEAT');

    const title = new Text({
      text: winnerLabel,
      style: new TextStyle({
        fontSize: 36,
        fill: state.winner === ui.humanPlayer || ui.mode === 'aivai' ? COLORS.accentGold : COLORS.buttonDanger,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        letterSpacing: 4,
      }),
    });
    title.anchor.set(0.5, 0.5);
    title.x = L.width / 2;
    title.y = L.height / 2 - 20;
    this.overlayLayer.addChild(title);

    const reasonMap: Record<string, string> = { 'battle-rewards': 'Battle Rewards (10+)', 'deck-out': 'Deck Out', 'concede': 'Concession' };
    const reason = new Text({
      text: reasonMap[state.winReason ?? ''] ?? '',
      style: new TextStyle({ fontSize: 14, fill: COLORS.text, fontFamily: 'Arial, sans-serif' }),
    });
    reason.anchor.set(0.5, 0.5);
    reason.x = L.width / 2;
    reason.y = L.height / 2 + 20;
    this.overlayLayer.addChild(reason);

    const statsTxt = new Text({
      text: `Turn ${state.turnNumber}  ·  P1 BR: ${state.players.player1.battleRewards.length}  ·  P2 BR: ${state.players.player2.battleRewards.length}`,
      style: new TextStyle({ fontSize: 11, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif' }),
    });
    statsTxt.anchor.set(0.5, 0.5);
    statsTxt.x = L.width / 2;
    statsTxt.y = L.height / 2 + 50;
    this.overlayLayer.addChild(statsTxt);

    const glowLine2 = new Graphics();
    glowLine2.moveTo(L.width * 0.2, L.height / 2 + 70);
    glowLine2.lineTo(L.width * 0.8, L.height / 2 + 70);
    glowLine2.stroke({ color: COLORS.accentGold, width: 2, alpha: 0.5 });
    this.overlayLayer.addChild(glowLine2);
  }

  // ============================================================
  // Helpers
  // ============================================================

  private makeButton(label: string, w: number, h: number, color: number): Container {
    const c = new Container();
    c.eventMode = 'static';
    c.cursor = 'pointer';
    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 4);
    bg.fill({ color, alpha: 0.9 });
    bg.stroke({ color: 0xffffff, width: 1, alpha: 0.1 });
    c.addChild(bg);
    const txt = new Text({
      text: label,
      style: new TextStyle({ fontSize: 10, fill: COLORS.textBright, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
    });
    txt.anchor.set(0.5, 0.5);
    txt.x = w / 2;
    txt.y = h / 2;
    c.addChild(txt);
    return c;
  }

  destroy(): void {
    this.app.destroy(true);
  }
}
