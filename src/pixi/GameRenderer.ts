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
import { LoadingScreen } from './LoadingScreen';
import { MulliganOverlay } from './overlays/MulliganOverlay';
import { TeamOrgOverlay } from './overlays/TeamOrgOverlay';
import { BattleOverlay } from './overlays/BattleOverlay';
import { CoinFlipOverlay } from './overlays/CoinFlipOverlay';
import { CardPreviewOverlay } from './overlays/CardPreviewOverlay';
import { PileViewerOverlay } from './overlays/PileViewerOverlay';
import { DeckSearchOverlay } from './overlays/DeckSearchOverlay';
import { EssencePickerOverlay } from './overlays/EssencePickerOverlay';
import { FieldActivateOverlay } from './overlays/FieldActivateOverlay';
import { CardActionMenuOverlay } from './overlays/CardActionMenuOverlay';
import { EssenceActivateOverlay } from './overlays/EssenceActivateOverlay';
import { CharacterActivateOverlay } from './overlays/CharacterActivateOverlay';
import type { CardAction } from './overlays/CardActionMenuOverlay';
import { showCardCloseUp } from './effects/CardCloseUp';
import { showEffectCallout } from './effects/Animations';
import gsap from 'gsap';
import { TIMING } from './timing';
import {
  showTurnBanner,
  showPhaseBanner,
  showDamageNumber,
  screenShake,
  screenFlash,
  particleBurst,
  showChainNotification,
  animateCardSummon,
  showBattleRewardCelebration,
  drawActivePlayerGlow,
  showPassIndicator,
} from './effects/Animations';
import { shatterEffect } from './effects/ShatterEffect';
import { STYLES, FONT } from './SharedStyles';
import type {
  GameState,
  PlayerId,
  Phase,
  CardDef,
  CharacterCardDef,
  StrategyCardDef,
  AbilityCardDef,
  FieldCardDef,
} from '@/game/types';
import type { AnimationEvent } from '@/game/engine/animationEvents';
import { AnimationQueue } from './animation/AnimationQueue';
import { AnimationRouter } from './animation/AnimationRouter';
import type { UIState, UIAction } from '@/hooks/useGameEngine';
import {
  getCardDefForInstance,
  getEffectiveStats,
  getLegalActions,
  characterHasAttribute,
  oceanicAbyssVirtualCharCount,
  fieldHasSymbol,
  calculateTeamPower,
} from '@/game/engine';
import {
  getActingPlayer,
  canSummonCard,
  canPlayStrategyCard,
  getValidHandCostCards,
} from '@/lib/gameHelpers';
import { PHASE_LABELS, SPEED_PRESETS } from '@/lib/constants';
import type { SpeedPreset } from '@/lib/constants';
import { NarrationTracker } from './narration/NarrationTracker';
import { NarrationOverlay } from './narration/NarrationOverlay';

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
  private prevChainLength = 0;
  private prevActingPlayer: PlayerId | null = null;

  // AI thinking indicator
  private aiThinkingContainer: Container | null = null;
  private aiThinkingTween: gsap.core.Tween | null = null;

  // Track card screen positions for zone-change animations
  private cardPositions = new Map<string, { x: number; y: number; w: number; h: number; zone: string }>();

  // Card preview / pile viewer
  private previewOverlay: CardPreviewOverlay | null = null;
  private pileViewerOverlay: PileViewerOverlay | null = null;

  // Animation system
  private animationQueue: AnimationQueue;
  private animationRouter: AnimationRouter | null = null;

  // Cached activatable kingdom character IDs (recalculated each render)
  private activatableKingdomIds: Set<string> | null = null;

  // Deferred PWR pills (rendered after center bar to avoid being covered)
  private deferredPwrPills: { x: number; y: number; w: number; h: number; color: number; text: string }[] = [];

  // Narration system
  private narrationTracker = new NarrationTracker();
  private narrationOverlay: NarrationOverlay | null = null;
  private narrationContainer = new Container(); // persistent, not cleared each frame

  constructor() {
    this.app = new Application();
    this.animationQueue = new AnimationQueue();
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      canvas,
      resizeTo: canvas.parentElement ?? undefined,
      backgroundColor: COLORS.background,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Show loading screen while assets load
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const loadingScreen = new LoadingScreen(screenW, screenH);
    this.app.stage.addChild(loadingScreen);

    await loadAllAssets((progress, label) => {
      loadingScreen.setProgress(progress, label);
    });

    await loadingScreen.fadeOut();

    this.boardLayer.sortableChildren = true;
    this.app.stage.addChild(this.boardLayer);
    this.app.stage.addChild(this.overlayLayer);
    this.app.stage.addChild(this.effectsLayer);
    this.app.stage.addChild(this.uiLayer);
    this.layout = computeLayout(screenW, screenH);
    this.animationRouter = new AnimationRouter(this.effectsLayer, this.boardLayer, this.layout);
    this.animationQueue.setPlayer((event) => this.animationRouter!.play(event));

    // Narration overlay persists across frame rebuilds (not cleared with uiLayer.removeChildren)
    this.narrationOverlay = new NarrationOverlay();
    this.narrationOverlay.updateLayout(screenW, screenH, 44);
    this.narrationContainer.addChild(this.narrationOverlay);
    // narrationContainer is added to stage directly so it's above uiLayer and not cleared
    this.app.stage.addChild(this.narrationContainer);

    this.initialized = true;
  }

  setHumanPlayer(player: PlayerId): void {
    if (this.animationRouter) {
      this.animationRouter.setHumanPlayer(player);
    }
  }

  /** Whether the animation queue is currently playing animations. */
  get isAnimationBusy(): boolean {
    return this.animationQueue.isBusy;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDispatch(dispatch: (action: any) => void): void {
    this.dispatch = dispatch;
  }

  resize(): void {
    if (!this.initialized) return;
    // Manually sync renderer size with parent container to avoid stale dimensions
    const parent = this.app.canvas?.parentElement;
    if (parent) {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w > 0 && h > 0) {
        this.app.renderer.resize(w, h);
        this.layout = computeLayout(w, h);
        if (this.animationRouter) {
          this.animationRouter.updateLayout(this.layout);
        }
        if (this.narrationOverlay) {
          this.narrationOverlay.updateLayout(w, h, 44);
        }
        if (this.currentGameState && this.currentUIState) {
          this.update(this.currentGameState, this.currentUIState);
        }
      }
    }
  }

  update(gameState: GameState, uiState: UIState, events?: AnimationEvent[]): void {
    const prevState = this.currentGameState;
    this.currentGameState = gameState;
    this.currentUIState = uiState;

    // Reset narration tracker on new game
    if (!prevState || (prevState.turnNumber > 0 && gameState.turnNumber === 0)) {
      this.narrationTracker.reset();
    }

    // Update animation router layout
    if (this.animationRouter) {
      this.animationRouter.updateLayout(this.layout);
    }

    // Track whether EventCollector events were provided (to avoid duplicate animations)
    const hasCollectorEvents = events != null && events.length > 0;

    // Pass current card positions to AnimationRouter before enqueueing
    // (positions from previous frame are used for zone-change animations)
    if (this.animationRouter) {
      this.animationRouter.setCardPositions(this.cardPositions);
    }

    // Sync animation queue speed with current speed preset
    const speedConfig = SPEED_PRESETS[uiState.speedPreset];
    this.animationQueue.setSpeed(speedConfig.animationSpeed);

    // Sync AnimationRouter speed for scaled delays
    if (this.animationRouter) {
      this.animationRouter.setSpeed(speedConfig.animationSpeed);
    }

    // Enqueue animation events if provided
    if (hasCollectorEvents) {
      this.animationQueue.enqueue(events);
    }

    // Process narration for new events
    if (hasCollectorEvents && uiState.narrationEnabled && this.narrationOverlay) {
      const narrationItems = this.narrationTracker.processEvents(events, uiState.humanPlayer, uiState.mode);
      if (narrationItems.length > 0) {
        this.narrationOverlay.enqueue(narrationItems);
      }
    }

    // Update narration overlay layout
    if (this.narrationOverlay) {
      this.narrationOverlay.updateLayout(this.app.screen.width, this.app.screen.height, 44);
      this.narrationOverlay.setVoiceEnabled(uiState.narrationEnabled);
      this.narrationOverlay.visible = uiState.narrationEnabled;
      if (!uiState.narrationEnabled) {
        this.narrationOverlay.clear();
      }
    }

    this.boardLayer.removeChildren();
    this.overlayLayer.removeChildren();
    // Don't clear effects layer — animations persist across frames
    this.uiLayer.removeChildren();
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height);

    // Trigger animations on state transitions (skip chain/summon checks if EventCollector already handled them)
    this.checkAnimationTriggers(gameState, uiState, prevState, hasCollectorEvents);

    this.drawBackground();

    // Cache activatable kingdom characters for this frame
    this.activatableKingdomIds = uiState.selectionMode.type === 'none'
      ? this.getActivatableKingdomCharacters(gameState, uiState)
      : null;

    this.deferredPwrPills = [];
    this.renderBoard(gameState, uiState);
    this.renderCenterBar(gameState, uiState);
    this.renderDeferredPwrPills();
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

    // Essence picker overlay (ability/activate cost payment — only for essence-source costs)
    if (this.dispatch && (
      uiState.selectionMode.type === 'ability-essence-cost' ||
      (uiState.selectionMode.type === 'activate-cost-select' && uiState.selectionMode.costSource === 'essence')
    )) {
      this.renderEssencePickerOverlay(gameState, uiState);
    }

    // Deck search overlay (e.g., Secret Meeting)
    if (gameState.pendingSearch && gameState.pendingSearch.owner === uiState.humanPlayer && this.dispatch) {
      this.renderDeckSearchOverlay(gameState, uiState);
    }

    // Target choice overlay (e.g., Sinbad — choose which character gets +1/+1)
    if (gameState.pendingTargetChoice && gameState.pendingTargetChoice.owner === uiState.humanPlayer && this.dispatch) {
      this.renderTargetChoiceOverlay(gameState, uiState);
    }

    // Optional effect overlay (e.g., "you may draw 1 card")
    if (gameState.pendingOptionalEffect && gameState.pendingOptionalEffect.owner === uiState.humanPlayer && this.dispatch) {
      this.renderOptionalEffectOverlay(gameState, uiState);
    }

    // Field activate picker overlay (e.g., Micromon Beach)
    if (uiState.selectionMode.type === 'field-activate-pick' && this.dispatch) {
      this.renderFieldActivateOverlay(gameState, uiState);
    }

    // Card action menu overlay (e.g., Summon vs Activate)
    if (uiState.selectionMode.type === 'card-action-menu' && this.dispatch) {
      this.renderCardActionMenu(gameState, uiState);
    }

    // Essence activate overlay (e.g., Unknown Pathway activate from essence)
    if (uiState.selectionMode.type === 'essence-activate-select' && this.dispatch) {
      this.renderEssenceActivateOverlay(gameState, uiState);
    }

    // Character activate confirmation overlay (preview effect before committing)
    if (uiState.selectionMode.type === 'character-activate-confirm' && this.dispatch) {
      this.renderCharacterActivateOverlay(gameState, uiState);
    }

    // Coin flip overlay (fires once, self-destroys via GSAP)
    this.checkCoinFlip(gameState, uiState);
  }

  // ============================================================
  // Animation Triggers
  // ============================================================

  private checkAnimationTriggers(state: GameState, ui: UIState, prev: GameState | null, hasCollectorEvents = false): void {
    if (!prev) {
      this.prevPhase = state.phase;
      this.prevTurn = state.turnNumber;
      this.prevCurrentTurn = state.currentTurn;
      this.prevActingPlayer = getActingPlayer(state);
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

    // Phase change banner + subtle board scale pulse
    if (state.phase !== this.prevPhase && state.currentTurn === this.prevCurrentTurn) {
      // Phase narration
      if (ui.narrationEnabled && this.narrationOverlay && this.prevPhase) {
        const phaseNarration = this.narrationTracker.processPhaseChange(this.prevPhase, state.phase);
        if (phaseNarration) {
          this.narrationOverlay.enqueue([phaseNarration]);
        }
      }

      const phaseText = PHASE_LABELS[state.phase] ?? state.phase;
      if (state.phase !== 'start' && state.phase !== 'setup') {
        showPhaseBanner(this.effectsLayer, phaseText, L.width, L.height);
        // Brief scale pulse on board for "snap" feel
        gsap.fromTo(this.boardLayer.scale, { x: 1.015, y: 1.015 }, { x: 1, y: 1, duration: 0.3, ease: 'power2.out' });

        // Screen-width color sweep on battle start
        if (state.phase === 'battle-attack' && this.prevPhase !== 'battle-attack') {
          const sweep = new Graphics();
          sweep.rect(0, L.height / 2 - 2, L.width, 4);
          sweep.fill({ color: 0xef4444, alpha: 0.8 });
          this.effectsLayer.addChild(sweep);
          sweep.scale.x = 0;
          gsap.to(sweep.scale, {
            x: 1, duration: 0.3, ease: 'power2.out',
            onComplete: () => {
              gsap.to(sweep, {
                alpha: 0, duration: 0.3,
                onComplete: () => { this.effectsLayer.removeChild(sweep); sweep.destroy(); },
              });
            },
          });
        }

        // Gold sweep on EOA → showdown transition
        if (state.phase === 'battle-showdown' && this.prevPhase === 'battle-eoa') {
          const sweep = new Graphics();
          sweep.rect(0, L.height / 2 - 2, L.width, 4);
          sweep.fill({ color: 0xf59e0b, alpha: 0.8 });
          this.effectsLayer.addChild(sweep);
          sweep.scale.x = 0;
          gsap.to(sweep.scale, {
            x: 1, duration: 0.3, ease: 'power2.out',
            onComplete: () => {
              gsap.to(sweep, {
                alpha: 0, duration: 0.3,
                onComplete: () => { this.effectsLayer.removeChild(sweep); sweep.destroy(); },
              });
            },
          });
        }
      }
    }

    // Battle reward gained — enhanced celebration
    const prevP1BR = prev.players.player1.battleRewards.length;
    const prevP2BR = prev.players.player2.battleRewards.length;
    const curP1BR = state.players.player1.battleRewards.length;
    const curP2BR = state.players.player2.battleRewards.length;

    if (curP1BR > prevP1BR) {
      showBattleRewardCelebration(this.effectsLayer, L.width, L.height, curP1BR - prevP1BR);
    }
    if (curP2BR > prevP2BR) {
      showBattleRewardCelebration(this.effectsLayer, L.width, L.height, curP2BR - prevP2BR);
    }

    // Character discarded — shake + shatter at last known position
    const prevTotalKingdom = prev.players.player1.kingdom.length + prev.players.player2.kingdom.length;
    const curTotalKingdom = state.players.player1.kingdom.length + state.players.player2.kingdom.length;
    if (curTotalKingdom < prevTotalKingdom) {
      screenShake(this.boardLayer, 3, 0.2);
    }

    // Defeated card animations — detect cards that left battlefield/kingdom → discard
    for (const pid of ['player1', 'player2'] as PlayerId[]) {
      const prevOnField = new Set([
        ...prev.players[pid].battlefield,
        ...prev.players[pid].kingdom,
      ]);
      const curOnField = new Set([
        ...state.players[pid].battlefield,
        ...state.players[pid].kingdom,
      ]);
      for (const cardId of prevOnField) {
        if (!curOnField.has(cardId) && state.cards[cardId]?.zone === 'discard') {
          // Card was defeated — play shatter at last known position
          const pos = this.cardPositions.get(cardId);
          if (pos) {
            shatterEffect(this.effectsLayer, pos.x, pos.y, pos.w, pos.h, COLORS.injuredDot);
          }
        }
      }
    }

    // Pass priority indicator — detect acting player change within same phase
    const curActing = getActingPlayer(state);
    if (this.prevActingPlayer && curActing !== this.prevActingPlayer && state.phase === prev.phase) {
      const isPlayerPass = ui.mode === 'pvai' && this.prevActingPlayer === ui.humanPlayer;
      showPassIndicator(this.effectsLayer, L.width, L.height, isPlayerPass);
    }

    // Card drawn — flash effect from deck to hand (skip if EventCollector already handled)
    if (hasCollectorEvents) {
      // EventCollector events handle card-zone-change, chain-entry-added, etc.
      // Skip the duplicate state-diff based animations below.
      this.prevPhase = state.phase;
      this.prevTurn = state.turnNumber;
      this.prevCurrentTurn = state.currentTurn;
      this.prevActingPlayer = curActing;
      return;
    }

    for (const pid of ['player1', 'player2'] as PlayerId[]) {
      const prevHand = prev.players[pid].hand.length;
      const curHand = state.players[pid].hand.length;
      if (curHand > prevHand) {
        const isBottom = (ui.mode === 'aivai' ? pid === 'player1' : pid === ui.humanPlayer);
        const deckX = L.width - L.sideColW / 2;
        const deckY = isBottom ? L.playerY + L.playerH / 2 : L.opponentY + L.opponentH / 2;
        const handY = isBottom ? L.height - L.uiBarH - 80 : 80;
        // Draw flash: a card-shaped sprite flies from deck to hand with landing particle burst
        const drawCount = curHand - prevHand;
        for (let d = 0; d < drawCount; d++) {
          const targetX = L.width / 2 + d * 20;
          const flash = new Graphics();
          flash.roundRect(0, 0, 30, 42, 3);
          flash.fill({ color: COLORS.accentCyan, alpha: 0.7 });
          flash.stroke({ color: COLORS.accentCyan, width: 1 });
          this.effectsLayer.addChild(flash);
          animateCardSummon(flash, deckX, deckY, targetX, handY);
          // Landing burst + cleanup after animation
          const layer = this.effectsLayer;
          setTimeout(() => {
            particleBurst(layer, targetX + 15, handY + 21, COLORS.accentCyan, 6);
          }, 350);
          setTimeout(() => {
            try { layer.removeChild(flash); flash.destroy(); } catch { /* ok */ }
          }, 600);
        }
      }
    }

    // Chain entry — show card close-up (Master Duel style)
    if (state.chain.length > prev.chain.length) {
      const newEntry = state.chain[state.chain.length - 1];
      if (newEntry) {
        let cardName = 'Effect';
        let defId = '';
        let effectDesc = '';
        try {
          const def = getCardDefForInstance(state, newEntry.sourceCardInstanceId);
          cardName = def.name;
          defId = def.id;
          // Get effect description if available
          if (def.cardType === 'field' && newEntry.effectSubChoice !== undefined) {
            // Field card sub-effect — show specific chosen effect
            const subDescs: Record<string, string[]> = {
              'F0006': [
                'Select 1 Character — it gets +1/+1 this turn',
                'Draw 1 card',
                "Discard 1 from opponent's Essence, move 1 from your DP to Essence",
                'Ability cards cannot be played during this turn',
              ],
            };
            const descs = subDescs[def.id];
            if (descs && descs[newEntry.effectSubChoice]) effectDesc = descs[newEntry.effectSubChoice];
          } else if ('effects' in def && def.effects.length > 0) {
            const effectId = newEntry.effectId;
            const effect = effectId ? def.effects.find(e => e.id === effectId) : def.effects[0];
            if (effect) effectDesc = effect.effectDescription;
          }
        } catch { /* skip */ }

        const actionText = newEntry.type === 'summon' ? 'SUMMONED!'
          : newEntry.type === 'strategy' ? 'STRATEGY!'
          : newEntry.type === 'ability' ? 'ABILITY!'
          : 'EFFECT!';

        // Show close-up
        if (defId) {
          showCardCloseUp(this.effectsLayer, defId, cardName, actionText, L.width, L.height);
        } else {
          showChainNotification(this.effectsLayer, `${cardName} activates!`, L.width, L.height);
        }

        // Show effect description callout if available
        if (effectDesc) {
          setTimeout(() => {
            showEffectCallout(this.effectsLayer, cardName, effectDesc, L.width, L.height);
          }, 400);
        }
      }
    }

    // Chain resolution notification
    if (prev.chain.length > 0 && state.chain.length === 0 && !state.isChainResolving) {
      showChainNotification(this.effectsLayer, 'CHAIN RESOLVED', L.width, L.height);
    }

    this.prevPhase = state.phase;
    this.prevTurn = state.turnNumber;
    this.prevCurrentTurn = state.currentTurn;
    this.prevActingPlayer = curActing;
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

    // Subtle grid pattern on play area
    const gridGfx = new Graphics();
    const gridSpacing = 40;
    const gridAlpha = 0.04;
    for (let gx = this.layout.sideColW; gx < width - this.layout.sideColW; gx += gridSpacing) {
      gridGfx.moveTo(gx, 0);
      gridGfx.lineTo(gx, height - this.layout.uiBarH);
    }
    for (let gy = 0; gy < height - this.layout.uiBarH; gy += gridSpacing) {
      gridGfx.moveTo(this.layout.sideColW, gy);
      gridGfx.lineTo(width - this.layout.sideColW, gy);
    }
    gridGfx.stroke({ color: 0x1a2535, width: 1, alpha: gridAlpha });
    this.boardLayer.addChild(gridGfx);

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

    // Soft glow bands instead of thin divider lines
    for (const x of [this.layout.sideColW, width - this.layout.sideColW]) {
      const glowBand = new Graphics();
      glowBand.rect(x - 3, 4, 6, height - this.layout.uiBarH - 8);
      glowBand.fill({ color: COLORS.accentBlue, alpha: 0.03 });
      this.boardLayer.addChild(glowBand);
      const line = new Graphics();
      line.moveTo(x, 4);
      line.lineTo(x, height - this.layout.uiBarH - 4);
      line.stroke({ color: COLORS.accentBlue, width: 1, alpha: 0.15 });
      this.boardLayer.addChild(line);
    }

    // Active player border glow along center divider
    if (this.currentGameState && this.currentUIState) {
      const isPlayerTurn = this.currentUIState.mode === 'pvai'
        ? this.currentGameState.currentTurn === this.currentUIState.humanPlayer
        : this.currentGameState.currentTurn === 'player1';
      drawActivePlayerGlow(
        this.boardLayer,
        width,
        this.layout.centerBarY,
        isPlayerTurn,
      );
    }

    // Spawn floating particles (on effectsLayer so they persist across frames)
    this.spawnBoardParticles();
  }

  // Board particle system — spawns a few dim, slow particles per frame
  private boardParticleCount = 0;
  private spawnBoardParticles(): void {
    const maxParticles = 15;
    if (this.boardParticleCount >= maxParticles) return;

    // Spawn 1 particle per update call, up to max
    const { width, height } = this.layout;
    const x = this.layout.sideColW + Math.random() * (width - this.layout.sideColW * 2);
    const y = Math.random() * (height - this.layout.uiBarH);
    const size = 1 + Math.random() * 1.5;
    const color = Math.random() > 0.7 ? COLORS.accentGold : COLORS.accentCyan;

    const particle = new Graphics();
    particle.circle(0, 0, size);
    particle.fill({ color, alpha: 0.15 });
    particle.x = x;
    particle.y = y;
    this.effectsLayer.addChild(particle);
    this.boardParticleCount++;

    // Slow upward drift + fade out
    const duration = 8 + Math.random() * 12;
    gsap.to(particle, {
      y: y - 60 - Math.random() * 80,
      x: x + (Math.random() - 0.5) * 40,
      alpha: 0,
      duration,
      ease: 'none',
      onComplete: () => {
        try {
          this.effectsLayer.removeChild(particle);
          particle.destroy();
        } catch { /* ok */ }
        this.boardParticleCount--;
      },
    });
  }

  // ============================================================
  // Board
  // ============================================================

  private renderBoard(state: GameState, ui: UIState): void {
    const bottomPlayer: PlayerId = ui.mode === 'aivai' ? 'player1' : ui.humanPlayer;
    const topPlayer: PlayerId = bottomPlayer === 'player1' ? 'player2' : 'player1';
    this.renderPlayerHalf(state, topPlayer, true, ui);
    this.renderPlayerHalf(state, bottomPlayer, false, ui);
    this.renderZoneLabels(state);
  }

  // ============================================================
  // Zone Labels
  // ============================================================

  private renderZoneLabels(state: GameState): void {
    const L = this.layout;
    const phase = state.phase;

    // Determine which zones glow based on current phase
    const activeZones = new Set<string>();
    if (phase === 'main') {
      activeZones.add('hand');
      activeZones.add('kingdom');
      activeZones.add('essence');
    } else if (phase === 'organization') {
      activeZones.add('kingdom');
    } else if (phase === 'battle-attack' || phase === 'battle-block' || phase === 'battle-eoa' || phase === 'battle-showdown') {
      activeZones.add('battlefield');
    } else if (phase === 'end') {
      activeZones.add('hand');
    }

    // Center zone labels for kingdom area
    const centerLabels = [
      { text: 'KINGDOM', y: L.playerY + 2, zone: 'kingdom' },
    ];

    for (const label of centerLabels) {
      const isActive = activeZones.has(label.zone);
      const txt = new Text({
        text: label.text,
        style: new TextStyle({
          fontSize: 13,
          fill: isActive ? COLORS.accentBlue : COLORS.textMuted,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 3,
        }),
      });
      txt.anchor.set(0, 0);
      txt.x = L.centerColX + 8;
      txt.y = label.y;
      txt.alpha = isActive ? 0.6 : 0.2;
      this.boardLayer.addChild(txt);
    }
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
    // Use smaller cards for opponent's hand (face-down anyway) to save space
    const handCardSize = isTop ? L.pileSize : cardSize;
    const pad = 6;
    // Leave room for action buttons below the hand (bottom player only)
    const actionBtnSpace = isTop ? 0 : 38;
    const handH = handCardSize.height + 12;
    const kingdomH = areaH - handH - pad - actionBtnSpace;

    let kingdomY: number, handY: number;
    if (isTop) {
      handY = areaY;
      kingdomY = areaY + handH + pad;
    } else {
      handY = areaY + areaH - handH - actionBtnSpace;
      kingdomY = areaY;
    }

    this.renderKingdom(state, player, L.centerColX, kingdomY, L.centerColW, kingdomH, cardSize);
    this.renderHand(state, player, L.centerColX, handY, L.centerColW, handH, handCardSize, isTop, ui);
  }

  // ============================================================
  // Pile Columns
  // ============================================================

  private renderPileColumn(state: GameState, player: PlayerId, x: number, y: number, w: number, h: number, side: 'left' | 'right'): void {
    const pState = state.players[player];
    const pileSize = this.layout.pileSize;
    const gap = 6;

    type PileInfo = { label: string; zone: string; instanceId?: string; count?: number; faceDown?: boolean; allIds?: string[] };
    const piles: PileInfo[] = side === 'left'
      ? [
          { label: 'FIELD', zone: 'field', instanceId: pState.fieldCard },
          { label: 'BR', zone: 'br', count: pState.battleRewards.length, instanceId: pState.battleRewards[pState.battleRewards.length - 1], faceDown: true },
        ]
      : [
          { label: 'DECK', zone: 'deck', count: pState.deck.length, faceDown: true },
          { label: 'DISCARD', zone: 'discard', count: pState.discard.length, instanceId: pState.discard[pState.discard.length - 1], allIds: [...pState.discard] },
          { label: 'ESSENCE', zone: 'essence', count: pState.essence.length, allIds: [...pState.essence] },
        ];

    const labelH = 12;
    const slotH = pileSize.height + labelH + 4;
    const totalH = piles.length * slotH + (piles.length - 1) * gap;
    const startY = y + (h - totalH) / 2;
    const centerX = x + (w - pileSize.width) / 2;

    piles.forEach((pile, i) => {
      const slotY = startY + i * (slotH + gap);

      // Deck warning color when <= 5 cards
      const isDeckWarning = pile.zone === 'deck' && (pile.count ?? 0) <= 5 && (pile.count ?? 0) > 0;
      const labelColor = isDeckWarning ? 0xf59e0b : COLORS.zoneLabel;

      const lbl = new Text({
        text: pile.count !== undefined ? `${pile.label} (${pile.count})` : pile.label,
        style: new TextStyle({ fontSize: 12, fill: labelColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
      });
      lbl.anchor.set(0.5, 0);
      lbl.x = x + w / 2;
      lbl.y = slotY;
      this.boardLayer.addChild(lbl);

      const cardY = slotY + labelH + 2;

      // Essence: symbol dot summary for at-a-glance reading
      // (During cost selection, the EssencePickerOverlay handles interaction)
      if (pile.zone === 'essence' && pile.allIds && pile.allIds.length > 0) {
        // Symbol dot summary — count each symbol for at-a-glance reading
        const symbolCounts = new Map<string, number>();
        for (const eid of pile.allIds) {
          const eInst = state.cards[eid];
          if (!eInst) continue;
          let eDef: CardDef | undefined;
          try { eDef = getCardDefForInstance(state, eid); } catch { /* skip */ }
          const sym = eDef?.symbols?.[0] ?? 'neutral';
          symbolCounts.set(sym, (symbolCounts.get(sym) ?? 0) + 1);
        }

        // Background panel
        const panelW = pileSize.width + 8;
        const panelH = pileSize.height;
        const panelX = centerX - 4;
        const panelBg = new Graphics();
        panelBg.roundRect(panelX, cardY, panelW, panelH, 6);
        panelBg.fill({ color: 0x0a1020, alpha: 0.7 });
        panelBg.stroke({ color: COLORS.panelBorder, width: 1, alpha: 0.5 });
        this.boardLayer.addChild(panelBg);

        // Render symbol rows: [dot] [symbol] x[count]
        const entries = [...symbolCounts.entries()].sort((a, b) => b[1] - a[1]);
        const rowH = Math.min(16, (panelH - 8) / Math.max(entries.length, 1));
        const startRowY = cardY + (panelH - entries.length * rowH) / 2;

        for (let si = 0; si < entries.length; si++) {
          const [sym, count] = entries[si];
          const rowY = startRowY + si * rowH;
          const dotColor = COLORS.symbols[sym] ?? 0x888888;

          // Colored dot
          const dot = new Graphics();
          dot.circle(panelX + 12, rowY + rowH / 2, 5);
          dot.fill({ color: dotColor });
          this.boardLayer.addChild(dot);

          // Symbol label + count
          const symLabel = sym === 'neutral' ? 'N' : sym.charAt(0).toUpperCase();
          const txt = new Text({
            text: `${symLabel} x${count}`,
            style: new TextStyle({
              fontSize: 11,
              fill: dotColor,
              fontFamily: FONT,
              fontWeight: 'bold',
            }),
          });
          txt.anchor.set(0, 0.5);
          txt.x = panelX + 22;
          txt.y = rowY + rowH / 2;
          this.boardLayer.addChild(txt);
        }

        // Check if this is the human player's essence with activatable cards
        const isHumanEssence = this.currentUIState && player === this.currentUIState.humanPlayer;
        const activatableEssenceCards = isHumanEssence && this.currentUIState
          ? this.getActivatableEssenceCards(state, this.currentUIState)
          : [];
        const hasActivatable = activatableEssenceCards.length > 0
          && this.currentUIState?.selectionMode.type === 'none';

        // Glowing border for activatable essence
        if (hasActivatable) {
          const glowBorder = new Graphics();
          glowBorder.roundRect(panelX - 2, cardY - 2, panelW + 4, panelH + 4, 8);
          glowBorder.stroke({ color: 0xd4a843, width: 2.5, alpha: 0.9 });
          this.boardLayer.addChild(glowBorder);

          // "ACTIVATE" badge below essence panel
          const badgeW = 62;
          const badgeH = 16;
          const badgeX = panelX + (panelW - badgeW) / 2;
          const badgeY = cardY + panelH + 2;
          const badgeBg = new Graphics();
          badgeBg.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
          badgeBg.fill({ color: 0xd4a843, alpha: 0.3 });
          this.boardLayer.addChild(badgeBg);

          const badgeTxt = new Text({
            text: 'ACTIVATE',
            style: new TextStyle({
              fontSize: 9,
              fill: 0xd4a843,
              fontFamily: FONT,
              fontWeight: 'bold',
              letterSpacing: 1,
            }),
          });
          badgeTxt.anchor.set(0.5, 0.5);
          badgeTxt.x = badgeX + badgeW / 2;
          badgeTxt.y = badgeY + badgeH / 2;
          this.boardLayer.addChild(badgeTxt);
        }

        // Clickable area for pile viewer (right-click) and essence activate (left-click)
        const hitArea = new Graphics();
        hitArea.roundRect(panelX, cardY, panelW, panelH, 6);
        hitArea.fill({ color: 0x000000, alpha: 0.001 });
        hitArea.eventMode = 'static';
        hitArea.cursor = 'pointer';
        hitArea.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
          if (e.button === 2) {
            e.preventDefault?.();
            this.showPileViewer('ESSENCE', pile.allIds!);
          } else if (hasActivatable && this.dispatch && this.currentUIState) {
            // Left-click opens essence activate overlay
            this.dispatch({
              type: 'SET_SELECTION_MODE',
              mode: {
                type: 'essence-activate-select',
                validCardIds: activatableEssenceCards.map((c) => c.instanceId),
              },
            });
          }
        });
        this.boardLayer.addChild(hitArea);
        return;
      }

      // Battle Rewards: horizontal cards stacking vertically downward
      if (pile.zone === 'br' && (pile.count ?? 0) > 0) {
        const brCount = pile.count ?? 0;
        const brCardW = pileSize.height; // rotated: height becomes visual width
        const brCardH = pileSize.width;  // rotated: width becomes visual height
        const overlapY = Math.min(14, (pileSize.height - 10) / Math.max(brCount, 1));
        const maxShow = Math.min(brCount, 10);

        // Center the rotated cards horizontally in the column
        const brCenterX = x + w / 2;

        for (let bi = 0; bi < maxShow; bi++) {
          const brCard = new CardSprite({ defId: '', size: pileSize, faceDown: true });
          brCard.pivot.set(pileSize.width / 2, pileSize.height / 2);
          brCard.rotation = Math.PI / 2; // 90° clockwise
          brCard.x = brCenterX;
          brCard.y = cardY + brCardH / 2 + bi * overlapY;
          brCard.alpha = bi === 0 ? 1 : 0.8;
          this.boardLayer.addChild(brCard);
        }

        // Count badge
        const badgeSize = 22;
        const badgeX = brCenterX + brCardW / 2 - badgeSize / 2 + 2;
        const badgeY = cardY - 2;
        const badge = new Graphics();
        badge.circle(badgeX, badgeY, badgeSize / 2);
        badge.fill({ color: brCount >= 7 ? COLORS.injuredDot : COLORS.accentGold, alpha: 0.9 });
        this.boardLayer.addChild(badge);

        const badgeTxt = new Text({
          text: `${brCount}`,
          style: new TextStyle({
            fontSize: 13,
            fill: 0xffffff,
            fontFamily: FONT,
            fontWeight: 'bold',
          }),
        });
        badgeTxt.anchor.set(0.5, 0.5);
        badgeTxt.x = badgeX;
        badgeTxt.y = badgeY;
        this.boardLayer.addChild(badgeTxt);

        // "/ 10" label under the badge
        const goalTxt = new Text({
          text: `/ 10`,
          style: new TextStyle({
            fontSize: 10,
            fill: COLORS.textMuted,
            fontFamily: FONT,
            fontWeight: 'bold',
          }),
        });
        goalTxt.anchor.set(0.5, 0);
        goalTxt.x = badgeX;
        goalTxt.y = badgeY + badgeSize / 2 + 2;
        this.boardLayer.addChild(goalTxt);

        return;
      }

      // Discard: show top card + right-click opens pile viewer
      if (pile.zone === 'discard' && pile.instanceId) {
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

          // Right-click opens full discard pile viewer
          card.eventMode = 'static';
          card.cursor = 'pointer';
          card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
            if (e.button === 2) {
              e.preventDefault?.();
              this.showPileViewer('DISCARD', pile.allIds!);
            }
          });

          this.boardLayer.addChild(card);
          return;
        }
      }

      // Field card + other face-up single cards
      if (pile.instanceId && !pile.faceDown) {
        const inst = state.cards[pile.instanceId];
        if (inst) {
          let def: CardDef | undefined;
          let stats: { lead: number; support: number } | undefined;
          try {
            def = getCardDefForInstance(state, pile.instanceId);
            if (def.cardType === 'character') stats = getEffectiveStats(state, pile.instanceId);
          } catch { /* skip */ }

          // Determine if field card is clickable for activate effect
          const isFieldActivatable = !!(def?.cardType === 'field' && pile.zone === 'field'
            && this.dispatch && this.currentUIState
            && this.isFieldCardActivatable(state, this.currentUIState, pile.instanceId!, def as FieldCardDef));
          const card = new CardSprite({
            defId: inst.defId,
            size: pileSize,
            cardDef: def,
            instance: inst,
            effectiveStats: stats,
            showName: pileSize.width >= 56,
            highlighted: isFieldActivatable,
            highlightColor: isFieldActivatable ? COLORS.accentCyan : undefined,
          });
          card.x = centerX;
          card.y = cardY;

          if (def) {
            card.eventMode = 'static';
            card.cursor = 'pointer';
            card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
              if (e.button === 2) {
                e.preventDefault?.();
                this.showCardPreview(inst.defId, inst, stats);
                return;
              }
              // Left-click: field card activate
              if (isFieldActivatable && this.dispatch && this.currentUIState) {
                this.handleFieldCardClick(state, this.currentUIState, pile.instanceId!, def as FieldCardDef, this.dispatch);
              }
            });
          }

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
    const teamedIds = new Set(teams.flatMap((t) => t.characterIds.filter((cid) => {
      const inst = state.cards[cid];
      return inst && (inst.zone === 'kingdom' || inst.zone === 'battlefield');
    })));
    const soloChars = pState.kingdom.filter((id) => {
      if (teamedIds.has(id)) return false;
      try {
        const def = getCardDefForInstance(state, id);
        if (def.cardType === 'strategy') return false;
      } catch { /* skip */ }
      return true;
    });
    const permStrategies = pState.kingdom.filter((id) => {
      try {
        const def = getCardDefForInstance(state, id);
        return def.cardType === 'strategy';
      } catch { return false; }
    });

    if (teams.length === 0 && soloChars.length === 0 && permStrategies.length === 0) {
      const txt = new Text({
        text: 'KINGDOM',
        style: new TextStyle({ fontSize: 14, fill: COLORS.textMuted, fontFamily: FONT, letterSpacing: 2 }),
      });
      txt.anchor.set(0.5, 0.5);
      txt.x = x + w / 2;
      txt.y = y + h / 2;
      txt.alpha = 0.4;
      this.boardLayer.addChild(txt);
      return;
    }

    type Group = { label: string; charIds: string[]; power: number; isTeam: boolean; teamId?: string };
    const groups: Group[] = [];

    for (const team of teams) {
      // Filter to only characters still in kingdom (discard/expel removes from play)
      const aliveChars = team.characterIds.filter((cid) => {
        const inst = state.cards[cid];
        return inst && (inst.zone === 'kingdom' || inst.zone === 'battlefield');
      });
      if (aliveChars.length === 0) continue; // Skip empty teams

      let power = 0;
      for (const cid of aliveChars) {
        try {
          const stats = getEffectiveStats(state, cid);
          const inst = state.cards[cid];
          if (inst?.battleRole === 'team-lead') power += stats.lead;
          else power += stats.support;
        } catch { /* skip */ }
      }
      groups.push({ label: `${power}`, charIds: aliveChars, power, isTeam: true, teamId: team.id });
    }

    if (soloChars.length > 0) groups.push({ label: '', charIds: soloChars, power: 0, isTeam: false });

    // During battle phases, use split-row layout showing attackers vs blockers
    const isBattlePhase = state.phase.startsWith('battle') && groups.some(g => {
      const team = g.teamId ? state.teams[g.teamId] : null;
      return team?.isAttacking || team?.isBlocking;
    });

    if (isBattlePhase) {
      this.renderBattleKingdom(state, player, groups, x, y, w, h, cardSize, permStrategies);
      return;
    }

    const groupGap = 24;

    // Calculate pyramid-based widths for teams
    let actualSize = cardSize;
    const getGroupW = (g: Group, sz: CardSize) => {
      if (g.isTeam) {
        // Pyramid width: enough for 2 cards side-by-side below leader
        return g.charIds.length <= 1 ? sz.width : sz.width * 2.3;
      }
      // Solo chars: horizontal row
      return g.charIds.length * sz.width + (g.charIds.length - 1) * 4;
    };

    let totalW = 0;
    for (const g of groups) totalW += getGroupW(g, cardSize);
    totalW += (groups.length - 1) * groupGap;

    if (totalW > w - 20) {
      const scale = (w - 20) / totalW;
      actualSize = { width: Math.floor(cardSize.width * scale), height: Math.floor(cardSize.height * scale) };
      totalW = 0;
      for (const g of groups) totalW += getGroupW(g, actualSize);
      totalW += (groups.length - 1) * groupGap;
    }

    let curX = x + (w - totalW) / 2;
    // Pyramid layout needs more vertical space; compress if kingdom area is too short
    // Use 0.65 * height offset so only ~35% of the support card is hidden
    const idealPyramidH = actualSize.height * 1.65;
    const pyramidH = Math.min(idealPyramidH, h);
    const supportVOffset = Math.max(0, pyramidH - actualSize.height);
    const baseCardY = y + (h - pyramidH) / 2;

    for (const group of groups) {
      const groupW = getGroupW(group, actualSize);
      const groupCenterX = curX + groupW / 2;

      if (group.label) {
        const panelPad = 6;
        const uiSt = this.currentUIState;
        const isSelectingAttackers = uiSt?.selectionMode.type === 'select-attackers'
          && player === uiSt.humanPlayer && group.teamId;
        const isTeamSelected = isSelectingAttackers && uiSt!.selectedTeamIds.includes(group.teamId!);
        const maxAttackers = 3;
        const atLimit = isSelectingAttackers && uiSt!.selectedTeamIds.length >= maxAttackers && !isTeamSelected;

        // Panel wraps around the team's cards
        const isSoloTeam = group.charIds.length <= 1;
        const panelContentH = isSoloTeam ? actualSize.height + 14 : pyramidH + 14;
        const panelTopY = baseCardY - 6;

        const panelBg = new Graphics();
        panelBg.roundRect(curX - panelPad, panelTopY, groupW + panelPad * 2, panelContentH, 6);
        panelBg.fill({ color: isTeamSelected ? 0x1e1020 : 0x111827, alpha: isTeamSelected ? 0.6 : 0.3 });
        panelBg.stroke({
          color: isTeamSelected ? COLORS.buttonDanger : COLORS.panelBorder,
          width: isTeamSelected ? 2 : 1,
          alpha: isTeamSelected ? 1 : 0.25,
        });

        // Make team panels clickable for attacker selection
        if (isSelectingAttackers && this.dispatch && !atLimit) {
          panelBg.eventMode = 'static';
          panelBg.cursor = 'pointer';
          const tId = group.teamId!;
          panelBg.on('pointerdown', () => {
            this.dispatch!({ type: 'TOGGLE_TEAM_SELECTION', teamId: tId });
          });
        }
        this.boardLayer.addChild(panelBg);

        // Defer PWR pill rendering (rendered after center bar to avoid being covered)
        const pwrColor = isTeamSelected ? COLORS.buttonDanger : COLORS.textGold;
        const pwrPillH = 16;
        // Measure text width to compute pill width
        const tmpTxt = new Text({
          text: `PWR ${group.power}`,
          style: new TextStyle({ fontSize: 11, fill: pwrColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
        });
        this.deferredPwrPills.push({
          x: groupCenterX,
          y: Math.max(panelTopY - pwrPillH / 2, y + 2),
          w: tmpTxt.width + 12,
          h: pwrPillH,
          color: pwrColor,
          text: `PWR ${group.power}`,
        });
        tmpTxt.destroy();
      }

      // Render supports first (behind), then leader last (on top) for teams
      const renderOrder = group.isTeam && group.charIds.length > 1
        ? [...group.charIds.keys()].sort((a, b) => {
            // Leader (index 0) goes last so it draws on top
            if (a === 0) return 1;
            if (b === 0) return -1;
            return a - b;
          })
        : [...group.charIds.keys()];

      for (const i of renderOrder) {
        const cid = group.charIds[i];
        const inst = state.cards[cid];
        if (!inst) continue;

        let def: CardDef | undefined;
        let stats: { lead: number; support: number } | undefined;
        try { def = getCardDefForInstance(state, cid); stats = getEffectiveStats(state, cid); } catch { /* skip */ }

        const isInjured = inst.state === 'injured';
        const smType = this.currentUIState?.selectionMode.type;
        const isTargetMode = !!(this.currentUIState &&
          (smType === 'ability-target-select' || smType === 'activate-target-select' || smType === 'strategy-target-select'));
        const isUserSelectMode = !!(this.currentUIState && smType === 'ability-user-select');
        const isKingdomSelected = this.currentUIState?.selectedCardIds.includes(cid) ?? false;

        // Determine if this card should be highlighted as a valid target
        let isKingdomHighlighted = false;
        if ((isTargetMode || isUserSelectMode) && (inst.zone === 'battlefield' || inst.zone === 'kingdom')) {
          if (isTargetMode && smType === 'strategy-target-select') {
            const sm3 = this.currentUIState!.selectionMode as { type: 'strategy-target-select'; validTargetIds: string[] };
            isKingdomHighlighted = sm3.validTargetIds.includes(cid);
          } else if (isTargetMode && smType === 'ability-target-select') {
            // Check if ability requires opposing targets — only highlight valid opposing chars
            const sm2 = this.currentUIState!.selectionMode as { type: 'ability-target-select'; abilityCardId: string; userId: string; needed: number };
            try {
              const abDef3 = getCardDefForInstance(state, sm2.abilityCardId) as AbilityCardDef;
              if (abDef3.targetDescription && abDef3.targetDescription.toLowerCase().includes('opposing')) {
                const userTeam2 = Object.values(state.teams).find((t) => t.characterIds.includes(sm2.userId));
                const targetTeam2 = Object.values(state.teams).find((t) => t.characterIds.includes(cid));
                if (userTeam2 && targetTeam2) {
                  isKingdomHighlighted = (userTeam2.isAttacking && targetTeam2.blockingTeamId === userTeam2.id) ||
                    (userTeam2.isBlocking && userTeam2.blockingTeamId === targetTeam2.id) ||
                    (userTeam2.isAttacking && userTeam2.blockedByTeamId === targetTeam2.id) ||
                    (targetTeam2.isAttacking && targetTeam2.blockedByTeamId === userTeam2.id);
                }
              } else {
                isKingdomHighlighted = true; // Non-opposing target — highlight all
              }
            } catch {
              isKingdomHighlighted = true; // Fallback — highlight all
            }
          } else {
            isKingdomHighlighted = true; // User select or activate target — highlight all
          }
        }
        // Dim non-valid kingdom chars during target/user selection modes
        const isKingdomDimmed = (isTargetMode || isUserSelectMode)
          && !isKingdomHighlighted
          && !isKingdomSelected;

        // Check if character has activatable effects (gold glow)
        const isActivatable = !isKingdomDimmed && !isTargetMode && !isUserSelectMode
          && this.activatableKingdomIds?.has(cid) === true;

        const card = new CardSprite({ defId: inst.defId, size: actualSize, cardDef: def, instance: inst, effectiveStats: stats, injured: isInjured, highlighted: isKingdomHighlighted, selected: isKingdomSelected, interactive: isKingdomHighlighted || isActivatable, dimmed: isKingdomDimmed, activatable: isActivatable });

        if (group.isTeam) {
          // Pyramid positioning
          let cardX: number, cardY: number;
          if (i === 0) {
            // Leader: top center
            cardX = groupCenterX - actualSize.width / 2;
            cardY = baseCardY;
          } else if (group.charIds.length === 2) {
            // 2-card team: support centered below
            cardX = groupCenterX - actualSize.width / 2;
            cardY = baseCardY + supportVOffset;
          } else {
            // 3-card team: supports fanned left/right below
            const offset = i === 1 ? -actualSize.width * 0.6 : actualSize.width * 0.6;
            cardX = groupCenterX + offset - actualSize.width / 2;
            cardY = baseCardY + supportVOffset;
          }

          if (isInjured) {
            card.x = cardX + actualSize.width / 2;
            card.y = cardY + actualSize.height / 2;
          } else {
            card.x = cardX;
            card.y = cardY;
          }
        } else {
          // Solo chars: horizontal row
          if (isInjured) {
            card.x = curX + i * (actualSize.width + 4) + actualSize.width / 2;
            card.y = baseCardY + actualSize.height / 2;
          } else {
            card.x = curX + i * (actualSize.width + 4);
            card.y = baseCardY;
          }
        }

        // Right-click preview + left-click for ability/activate selection
        // During attacker selection, let clicks pass through to team panels
        const isInAttackerSelect = this.currentUIState?.selectionMode.type === 'select-attackers';
        if (def && !isInAttackerSelect) {
          card.eventMode = 'static';
          card.cursor = 'pointer';
          card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
            if (e.button === 2) {
              e.preventDefault?.();
              this.showCardPreview(inst.defId, inst, stats);
              return;
            }
            // Left-click: handle kingdom card selection for ability/activate flows
            if (this.dispatch && this.currentUIState) {
              this.handleKingdomCardClick(state, this.currentUIState, cid, def!, this.dispatch);
            }
          });
        } else if (isInAttackerSelect) {
          card.eventMode = 'none';
        }

        this.boardLayer.addChild(card);

        // Track card screen position for zone-change animations
        this.cardPositions.set(cid, { x: card.x, y: card.y, w: actualSize.width, h: actualSize.height, zone: 'kingdom' });
      }

      curX += groupW + groupGap;
    }

    // Render permanent strategy cards on right edge of kingdom
    if (permStrategies.length > 0) {
      const permSize = CARD_SIZES.sm;
      const permGap = 6;
      const permX = x + w - permSize.width - 8;
      let permY = y + 4;

      for (const pid of permStrategies) {
        const inst = state.cards[pid];
        if (!inst) continue;

        let def: CardDef | undefined;
        try { def = getCardDefForInstance(state, pid); } catch { /* skip */ }

        const card = new CardSprite({ defId: inst.defId, size: permSize, cardDef: def, instance: inst, interactive: false });

        card.x = permX;
        card.y = permY;

        // Right-click preview only (not selectable for attack/block)
        if (def) {
          card.eventMode = 'static';
          card.cursor = 'pointer';
          card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
            if (e.button === 2) {
              e.preventDefault?.();
              this.showCardPreview(inst.defId, inst);
            }
          });
        }

        this.boardLayer.addChild(card);

        // Permanent counter badge (larger, more visible)
        const permCount = inst.counters.filter((c) => c.type === 'permanent').length;
        if (permCount > 0) {
          const badgeW = 40;
          const badgeH = 22;
          const badgeBg = new Graphics();
          badgeBg.roundRect(permX + permSize.width - badgeW + 6, permY - 6, badgeW, badgeH, 5);
          badgeBg.fill({ color: 0x2a1f00, alpha: 0.95 });
          badgeBg.stroke({ color: COLORS.textGold, width: 2, alpha: 0.9 });
          this.boardLayer.addChild(badgeBg);

          const badgeTxt = new Text({
            text: `\u23F3${permCount}`,
            style: new TextStyle({ fontSize: 13, fill: COLORS.textGold, fontFamily: FONT, fontWeight: 'bold' }),
          });
          badgeTxt.anchor.set(0.5, 0.5);
          badgeTxt.x = permX + permSize.width - badgeW / 2 + 6;
          badgeTxt.y = permY - 6 + badgeH / 2;
          this.boardLayer.addChild(badgeTxt);
        }

        // Track position for animations
        this.cardPositions.set(pid, { x: card.x, y: card.y, w: permSize.width, h: permSize.height, zone: 'kingdom' });

        permY += permSize.height + permGap;
      }
    }
  }

  // ============================================================
  // Battle Kingdom — Split row layout for attacking/blocking teams
  // ============================================================

  private renderBattleKingdom(
    state: GameState,
    player: PlayerId,
    groups: { label: string; charIds: string[]; power: number; isTeam: boolean; teamId?: string }[],
    x: number, y: number, w: number, h: number,
    cardSize: CardSize,
    permStrategies: string[],
  ): void {
    // Separate groups into attacking, blocking, and idle
    const attackingGroups = groups.filter(g => {
      const team = g.teamId ? state.teams[g.teamId] : null;
      return team?.isAttacking;
    });
    const blockingGroups = groups.filter(g => {
      const team = g.teamId ? state.teams[g.teamId] : null;
      return team?.isBlocking;
    });
    const idleGroups = groups.filter(g => {
      if (!g.teamId) return true;
      const team = state.teams[g.teamId];
      return team && !team.isAttacking && !team.isBlocking;
    });

    // Compute scaled card size to fit within available space
    const groupGap = 20;
    const rowGap = 6;
    const dividerH = 18;

    // Calculate how many rows we need
    const hasAttackers = attackingGroups.length > 0;
    const hasBlockers = blockingGroups.length > 0;
    const hasIdle = idleGroups.length > 0;
    const rowCount = (hasAttackers ? 1 : 0) + (hasBlockers ? 1 : 0) + (hasIdle ? 1 : 0);
    const dividerCount = (hasAttackers && hasBlockers ? 1 : 0) + ((hasAttackers || hasBlockers) && hasIdle ? 1 : 0);

    // Scale card size to fit vertically
    const availableH = h - dividerCount * dividerH - (rowCount - 1) * rowGap - 12;
    const maxRowH = availableH / Math.max(rowCount, 1);
    let actualSize = cardSize;
    if (cardSize.height > maxRowH) {
      const scale = maxRowH / cardSize.height;
      actualSize = { width: Math.floor(cardSize.width * scale), height: Math.floor(cardSize.height * scale) };
    }

    // Also scale horizontally for the widest row
    const allRows = [attackingGroups, blockingGroups, idleGroups].filter(r => r.length > 0);
    for (const row of allRows) {
      let totalRowW = 0;
      for (const g of row) {
        totalRowW += g.charIds.length <= 1 ? actualSize.width : actualSize.width * 2.3;
      }
      totalRowW += (row.length - 1) * groupGap;
      if (totalRowW > w - 40) {
        const scale = (w - 40) / totalRowW;
        actualSize = { width: Math.floor(actualSize.width * scale), height: Math.floor(actualSize.height * scale) };
      }
    }

    let curY = y + 4;

    // Helper: render a row of team groups with badges
    const renderRow = (
      rowGroups: typeof groups,
      role: 'attack' | 'block' | 'idle',
    ) => {
      const roleColor = role === 'attack' ? 0xef4444 : role === 'block' ? 0x3b82f6 : COLORS.textMuted;
      const roleLabel = role === 'attack' ? 'ATK' : role === 'block' ? 'DEF' : '';

      // Calculate total width for centering
      let totalW = 0;
      for (const g of rowGroups) {
        totalW += g.charIds.length <= 1 ? actualSize.width : actualSize.width * 2.3;
      }
      totalW += (rowGroups.length - 1) * groupGap;

      let gx = x + (w - totalW) / 2;

      for (const group of rowGroups) {
        const groupW = group.charIds.length <= 1 ? actualSize.width : actualSize.width * 2.3;
        const groupCenterX = gx + groupW / 2;

        // Panel background with role-colored border
        if (group.isTeam) {
          const panelPad = 6;
          const panelBg = new Graphics();
          panelBg.roundRect(gx - panelPad, curY - 4, groupW + panelPad * 2, actualSize.height + 10, 6);
          panelBg.fill({ color: 0x111827, alpha: role === 'idle' ? 0.3 : 0.6 });
          panelBg.stroke({ color: roleColor, width: 1.5, alpha: role === 'idle' ? 0.2 : 0.5 });
          this.boardLayer.addChild(panelBg);

          // Role badge pill
          if (roleLabel) {
            const team = state.teams[group.teamId!];
            let power = 0;
            try { power = calculateTeamPower(state, team!); } catch { /* skip */ }

            const badgeW = 50;
            const badgeH = 14;
            const badgeBg = new Graphics();
            badgeBg.roundRect(groupCenterX - badgeW / 2, curY - 18, badgeW, badgeH, badgeH / 2);
            badgeBg.fill({ color: roleColor, alpha: 0.2 });
            badgeBg.stroke({ color: roleColor, width: 1, alpha: 0.5 });
            this.boardLayer.addChild(badgeBg);

            const badgeTxt = new Text({
              text: `${roleLabel} ${power}`,
              style: new TextStyle({ fontSize: 9, fill: roleColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
            });
            badgeTxt.anchor.set(0.5, 0.5);
            badgeTxt.x = groupCenterX;
            badgeTxt.y = curY - 18 + badgeH / 2;
            this.boardLayer.addChild(badgeTxt);
          } else {
            // Idle teams: defer PWR pill rendering
            const tmpTxt2 = new Text({
              text: `PWR ${group.power}`,
              style: new TextStyle({ fontSize: 11, fill: COLORS.textGold, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
            });
            const pillH2 = 16;
            this.deferredPwrPills.push({
              x: groupCenterX,
              y: curY - pillH2 / 2,
              w: tmpTxt2.width + 12,
              h: pillH2,
              color: COLORS.textGold,
              text: `PWR ${group.power}`,
            });
            tmpTxt2.destroy();
          }
        }

        // Render cards
        for (let i = 0; i < group.charIds.length; i++) {
          const cid = group.charIds[i];
          const inst = state.cards[cid];
          if (!inst) continue;

          let def: CardDef | undefined;
          let stats: { lead: number; support: number } | undefined;
          try { def = getCardDefForInstance(state, cid); stats = getEffectiveStats(state, cid); } catch { /* skip */ }

          const isInjured = inst.state === 'injured';
          const smType = this.currentUIState?.selectionMode.type;
          const isTargetMode = !!(this.currentUIState && (smType === 'ability-target-select' || smType === 'activate-target-select' || smType === 'strategy-target-select'));
          const isUserSelectMode = !!(this.currentUIState && smType === 'ability-user-select');
          const isKingdomSelected = this.currentUIState?.selectedCardIds.includes(cid) ?? false;

          let isKingdomHighlighted = false;
          if ((isTargetMode || isUserSelectMode) && (inst.zone === 'battlefield' || inst.zone === 'kingdom')) {
            if (isTargetMode && smType === 'ability-target-select') {
              const sm2 = this.currentUIState!.selectionMode as { type: 'ability-target-select'; abilityCardId: string; userId: string; needed: number };
              try {
                const abDef3 = getCardDefForInstance(state, sm2.abilityCardId) as AbilityCardDef;
                if (abDef3.targetDescription && abDef3.targetDescription.toLowerCase().includes('opposing')) {
                  const userTeam2 = Object.values(state.teams).find(t => t.characterIds.includes(sm2.userId));
                  const targetTeam2 = Object.values(state.teams).find(t => t.characterIds.includes(cid));
                  if (userTeam2 && targetTeam2) {
                    isKingdomHighlighted = (userTeam2.isAttacking && targetTeam2.blockingTeamId === userTeam2.id) ||
                      (userTeam2.isBlocking && userTeam2.blockingTeamId === targetTeam2.id) ||
                      (userTeam2.isAttacking && userTeam2.blockedByTeamId === targetTeam2.id) ||
                      (targetTeam2.isAttacking && targetTeam2.blockedByTeamId === userTeam2.id);
                  }
                } else {
                  isKingdomHighlighted = true;
                }
              } catch {
                isKingdomHighlighted = true;
              }
            } else {
              isKingdomHighlighted = true;
            }
          }
          const isKingdomDimmed = (isTargetMode || isUserSelectMode) && !isKingdomHighlighted && !isKingdomSelected;

          const card = new CardSprite({ defId: inst.defId, size: actualSize, cardDef: def, instance: inst, effectiveStats: stats, injured: isInjured, highlighted: isKingdomHighlighted, selected: isKingdomSelected, interactive: isKingdomHighlighted, dimmed: isKingdomDimmed || (role === 'idle' && (hasAttackers || hasBlockers)) });

          let cardX: number, cardY: number;
          if (group.isTeam && i === 0) {
            cardX = groupCenterX - actualSize.width / 2;
            cardY = curY;
          } else if (group.isTeam && group.charIds.length === 2) {
            cardX = groupCenterX - actualSize.width / 2;
            cardY = curY + actualSize.height * 0.35;
          } else if (group.isTeam) {
            const offset = i === 1 ? -actualSize.width * 0.6 : actualSize.width * 0.6;
            cardX = groupCenterX + offset - actualSize.width / 2;
            cardY = curY + actualSize.height * 0.35;
          } else {
            cardX = gx + i * (actualSize.width + 4);
            cardY = curY;
          }

          if (isInjured) {
            card.x = cardX + actualSize.width / 2;
            card.y = cardY + actualSize.height / 2;
          } else {
            card.x = cardX;
            card.y = cardY;
          }

          const isInAttackerSelect = this.currentUIState?.selectionMode.type === 'select-attackers';
          if (def && !isInAttackerSelect) {
            card.eventMode = 'static';
            card.cursor = 'pointer';
            card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
              if (e.button === 2) {
                e.preventDefault?.();
                this.showCardPreview(inst.defId, inst, stats);
                return;
              }
              if (this.dispatch && this.currentUIState) {
                this.handleKingdomCardClick(state, this.currentUIState, cid, def!, this.dispatch);
              }
            });
          } else if (isInAttackerSelect) {
            card.eventMode = 'none';
          }

          this.boardLayer.addChild(card);
          this.cardPositions.set(cid, { x: card.x, y: card.y, w: actualSize.width, h: actualSize.height, zone: 'kingdom' });
        }

        gx += groupW + groupGap;
      }

      curY += actualSize.height + rowGap;
    };

    // Render attacker row
    if (hasAttackers) {
      renderRow(attackingGroups, 'attack');
    }

    // VS divider between attackers and blockers
    if (hasAttackers && hasBlockers) {
      const divY = curY + dividerH / 2;
      const lineW = w * 0.6;
      const lineX = x + (w - lineW) / 2;

      const divLine = new Graphics();
      divLine.moveTo(lineX, divY);
      divLine.lineTo(lineX + lineW, divY);
      divLine.stroke({ color: 0xf59e0b, width: 1, alpha: 0.3 });
      this.boardLayer.addChild(divLine);

      const vsLabel = new Text({
        text: 'VS',
        style: new TextStyle({ fontSize: 10, fill: 0xf59e0b, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
      });
      vsLabel.anchor.set(0.5, 0.5);
      vsLabel.x = x + w / 2;
      vsLabel.y = divY;

      // Small bg behind VS
      const vsBg = new Graphics();
      vsBg.roundRect(vsLabel.x - 14, vsLabel.y - 8, 28, 16, 8);
      vsBg.fill({ color: 0x080c14 });
      this.boardLayer.addChild(vsBg);
      this.boardLayer.addChild(vsLabel);

      // Connection lines from each attacker to their blocker
      for (const atkGroup of attackingGroups) {
        const atkTeam = atkGroup.teamId ? state.teams[atkGroup.teamId] : null;
        if (!atkTeam?.blockedByTeamId) {
          // Unblocked label
          let atkTotalW = 0;
          for (const g of attackingGroups) {
            atkTotalW += g.charIds.length <= 1 ? actualSize.width : actualSize.width * 2.3;
          }
          atkTotalW += (attackingGroups.length - 1) * groupGap;
          let atkGx = x + (w - atkTotalW) / 2;
          for (const g of attackingGroups) {
            if (g === atkGroup) break;
            atkGx += (g.charIds.length <= 1 ? actualSize.width : actualSize.width * 2.3) + groupGap;
          }
          const atkGroupW = atkGroup.charIds.length <= 1 ? actualSize.width : actualSize.width * 2.3;
          const unblockedTxt = new Text({
            text: 'UNBLOCKED',
            style: new TextStyle({ fontSize: 8, fill: 0xf59e0b, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
          });
          unblockedTxt.anchor.set(0.5, 0);
          unblockedTxt.x = atkGx + atkGroupW / 2;
          unblockedTxt.y = divY + 3;
          this.boardLayer.addChild(unblockedTxt);
        }
      }

      curY += dividerH;
    }

    // Render blocker row
    if (hasBlockers) {
      renderRow(blockingGroups, 'block');
    }

    // Separator before idle teams
    if ((hasAttackers || hasBlockers) && hasIdle) {
      const sepY = curY + dividerH / 2;
      const sepLine = new Graphics();
      sepLine.moveTo(x + w * 0.25, sepY);
      sepLine.lineTo(x + w * 0.75, sepY);
      sepLine.stroke({ color: COLORS.textMuted, width: 1, alpha: 0.15 });
      this.boardLayer.addChild(sepLine);
      curY += dividerH;
    }

    // Render idle teams
    if (hasIdle) {
      renderRow(idleGroups, 'idle');
    }

    // Render permanent strategy cards (same as non-battle layout)
    if (permStrategies.length > 0) {
      const permSize = CARD_SIZES.sm;
      const permGap = 6;
      const permX = x + w - permSize.width - 8;
      let permY = y + 4;

      for (const pid of permStrategies) {
        const inst = state.cards[pid];
        if (!inst) continue;

        let def: CardDef | undefined;
        try { def = getCardDefForInstance(state, pid); } catch { /* skip */ }

        const card = new CardSprite({ defId: inst.defId, size: permSize, cardDef: def, instance: inst, interactive: false });
        card.x = permX;
        card.y = permY;

        if (def) {
          card.eventMode = 'static';
          card.cursor = 'pointer';
          card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
            if (e.button === 2) {
              e.preventDefault?.();
              this.showCardPreview(inst.defId, inst);
            }
          });
        }
        this.boardLayer.addChild(card);
        this.cardPositions.set(pid, { x: card.x, y: card.y, w: permSize.width, h: permSize.height, zone: 'kingdom' });
        permY += permSize.height + permGap;
      }
    }
  }

  // ============================================================
  // Hand (with interactivity for bottom player in pvai)
  // ============================================================

  private renderHand(state: GameState, player: PlayerId, x: number, y: number, w: number, h: number, cardSize: CardSize, isTop: boolean, ui: UIState): void {
    const pState = state.players[player];
    const playerLabel = ui.mode === 'aivai' ? (player === 'player1' ? 'P1' : 'P2') : (isTop ? 'OPP' : 'YOUR');

    if (pState.hand.length === 0) {
      const txt = new Text({
        text: `${playerLabel} HAND — EMPTY`,
        style: new TextStyle({ fontSize: 14, fill: COLORS.textMuted, fontFamily: FONT, letterSpacing: 1 }),
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
        'ability-select': 'Select an ability card from hand',
        'ability-user-select': 'Select a character on battlefield to use the ability',
        'ability-target-select': `Select ${(ui.selectionMode as { needed: number }).needed} target(s)`,
        'ability-essence-cost': `Select ${(ui.selectionMode as { needed: number }).needed} essence card(s) to pay cost`,
        'activate-effect-select': 'Select a character with an activate effect',
        'activate-pick-effect': 'Select which effect to activate',
        'activate-target-select': `Select ${(ui.selectionMode as { needed: number }).needed} target(s)`,
        'activate-cost-select': (ui.selectionMode as { costDescription?: string }).costDescription || `Select ${(ui.selectionMode as { needed: number }).needed} card(s) to pay cost`,
        'strategy-target-select': 'Select a character to target',
      };
      const hint = hints[ui.selectionMode.type];
      if (hint) {
        const hintTxt = new Text({
          text: hint,
          style: new TextStyle({ fontSize: 14, fill: COLORS.accentCyan, fontFamily: FONT, fontWeight: 'bold' }),
        });
        hintTxt.anchor.set(0.5, 0);
        hintTxt.x = x + w / 2;
        hintTxt.y = y - 2;
        this.boardLayer.addChild(hintTxt);
      }
    }

    // Hand count with warning colors
    const handCount = pState.hand.length;
    const handColor = handCount >= 7 ? COLORS.injuredDot : handCount === 6 ? 0xf59e0b : COLORS.textMuted;
    const lbl = new Text({
      text: `${playerLabel} HAND ${handCount}/7`,
      style: new TextStyle({ fontSize: 13, fill: handColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
    });
    lbl.x = x + 12;
    lbl.y = isTop ? y + h - 10 : y + 2;
    lbl.alpha = handCount >= 6 ? 0.9 : 0.6;
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

      // Dim non-selectable cards during active hand selection modes
      const handSelectionModes = new Set([
        'summon-select', 'strategy-select', 'hand-cost',
        'charge-essence', 'discard-to-hand-limit',
        'ability-select', 'ability-essence-cost',
        'activate-cost-select',
      ]);
      const isDimmed = isHumanHand
        && handSelectionModes.has(ui.selectionMode.type)
        && !isHighlighted
        && !isSelected;

      // Type-based highlight color
      const highlightColor = def?.cardType === 'character' ? 0x3b82f6  // blue
        : def?.cardType === 'strategy' ? 0x10b981  // green
        : def?.cardType === 'ability' ? 0xf59e0b   // amber
        : 0x6b7280; // gray (charge fallback)

      // Determine if card is playable in 'none' mode (glow hint for player)
      let isPlayable = false;
      if (isHumanHand && ui.selectionMode.type === 'none' && def && !state.gameOver) {
        if (state.phase === 'main' && state.currentTurn === player) {
          if (def.cardType === 'character') isPlayable = canSummonCard(state, player, instanceId);
          else if (def.cardType === 'strategy') isPlayable = canPlayStrategyCard(state, player, instanceId);
          else if (def.cardType !== 'ability') isPlayable = true; // charge is always available (but not abilities)
        } else if ((state.phase === 'battle-eoa') && def.cardType === 'ability') {
          isPlayable = true;
        }
      }

      const card = new CardSprite({
        defId: inst.defId,
        size: cardSize,
        faceDown: isFaceDown,
        cardDef: isFaceDown ? undefined : def,
        instance: isFaceDown ? undefined : inst,
        effectiveStats: stats,
        selected: isSelected,
        highlighted: isHighlighted,
        highlightColor: isHighlighted ? highlightColor : undefined,
        interactive: isInteractive,
        showName: !isFaceDown,
        dimmed: isDimmed,
        playable: isPlayable,
        playableColor: isPlayable ? highlightColor : undefined,
      });
      card.x = positions[i]?.x ?? 0;
      card.y = positions[i]?.y ?? 0;

      // Lift selected cards up
      if (isSelected) card.y -= 8;

      // Click handler
      if (isInteractive && this.dispatch) {
        const d = this.dispatch;
        card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
          // Right-click → preview
          if (e.button === 2) {
            e.preventDefault?.();
            this.showCardPreview(inst.defId, inst, stats);
            return;
          }
          this.handleHandCardClick(state, ui, instanceId, def, d);
        });
      } else if (!isFaceDown && def) {
        // Even non-interactive cards support right-click preview
        card.eventMode = 'static';
        card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
          if (e.button === 2) {
            e.preventDefault?.();
            this.showCardPreview(inst.defId, inst, stats);
          }
        });
      }

      this.boardLayer.addChild(card);

      // Track hand card positions for zone-change animations
      this.cardPositions.set(instanceId, { x: card.x, y: card.y, w: cardSize.width, h: cardSize.height, zone: 'hand' });
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
          } else if (this.strategyNeedsTarget(state, hp, def.id)) {
            const validTargets = this.getStrategyValidTargets(state, hp, def.id);
            if (validTargets.length > 0) {
              dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'strategy-target-select', strategyCardId: instanceId, handCostCardIds: [], validTargetIds: validTargets } });
            }
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
            if (this.strategyNeedsTarget(state, hp, forDef.id)) {
              const validTargets = this.getStrategyValidTargets(state, hp, forDef.id);
              if (validTargets.length > 0) {
                dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'strategy-target-select', strategyCardId: sm.forCardId, handCostCardIds: newSelected, validTargetIds: validTargets } });
              } else {
                dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'play-strategy', cardInstanceId: sm.forCardId, handCostCardIds: newSelected } });
              }
            } else {
              dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'play-strategy', cardInstanceId: sm.forCardId, handCostCardIds: newSelected } });
            }
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

      case 'ability-select': {
        // Pick an ability card from hand
        if (def?.cardType === 'ability') {
          dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'ability-user-select', abilityCardId: instanceId } });
        }
        break;
      }

      case 'ability-essence-cost': {
        // Toggle essence cost selection from essence zone (handled in kingdom click)
        // But also allow selecting essence cards if they happen to be in hand (unlikely)
        break;
      }

      case 'activate-cost-select': {
        // Only handle if cost source is 'hand'
        if (sm.costSource !== 'hand') break;
        if (!this.isValidActivateHandCost(state, instanceId, sm.effectId)) return;

        dispatch({ type: 'TOGGLE_CARD_SELECTION', cardId: instanceId });

        const newSelected = ui.selectedCardIds.includes(instanceId)
          ? ui.selectedCardIds.filter((id) => id !== instanceId)
          : [...ui.selectedCardIds, instanceId];

        if (newSelected.length >= sm.needed) {
          dispatch({
            type: 'PERFORM_ACTION',
            player: hp,
            action: {
              type: 'activate-effect',
              cardInstanceId: sm.cardId,
              effectId: sm.effectId,
              targetIds: sm.targetIds,
              costCardIds: newSelected,
            },
          });
        }
        break;
      }

      case 'none': {
        const isMainPhase = state.phase === 'main' && state.currentTurn === hp;
        const isEOAPhase = state.phase === 'battle-eoa';
        const isActing = getActingPlayer(state) === hp;

        // Direct ability — ability cards (only during battle-eoa)
        if (def?.cardType === 'ability' && isEOAPhase && isActing) {
          const abilityDef = def as AbilityCardDef;

          // Check that at least one battlefield character meets the ability requirements
          const playerCards = Object.values(state.cards).filter(
            (c) => c.owner === hp && c.zone === 'battlefield'
          );
          const hasValidUser = playerCards.some((c) => {
            try {
              const cDef = getCardDefForInstance(state, c.instanceId);
              if (cDef.cardType !== 'character') return false;
              const charDef = cDef as CharacterCardDef;
              return abilityDef.requirements.every((req) => {
                if (req.type === 'attribute') return charDef.attributes.includes(req.value);
                return true;
              });
            } catch { return false; }
          });

          if (!hasValidUser) break; // No valid user on battlefield — can't play this ability

          dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'ability-user-select', abilityCardId: instanceId } });
          break;
        }

        if (!isMainPhase) break;

        // Direct summon — character cards (check for activate-from-hand too)
        if (def?.cardType === 'character') {
          const charDef = def as CharacterCardDef;
          const canSummon = canSummonCard(state, hp, instanceId);

          // Check for activate-from-hand effects
          const activateFromHandEffects = charDef.effects.filter((e) => {
            if (e.type !== 'activate') return false;
            if (e.timing !== 'main') return false;
            const isExpelFromHand = e.costDescription?.toLowerCase().includes('expel this card from your hand');
            const isPutInPlayFromHand = e.effectDescription?.toLowerCase().includes('from your hand in play');
            if (!isExpelFromHand && !isPutInPlayFromHand) return false;
            // Check name-turn scope (yellow activate — blocked if any copy already used this turn)
            if (e.activateScope === 'name-turn') {
              const nameKey = charDef.printNumber + ':' + e.id;
              if (state.players[hp].usedActivateNames.includes(nameKey)) return false;
            }
            if (e.activateScope === 'name-game') {
              const nameKey = charDef.printNumber + ':' + e.id;
              if (state.players[hp].usedActivateNames.includes(nameKey)) return false;
            }
            return true;
          });

          if (activateFromHandEffects.length > 0 && canSummon) {
            // Multiple options — show action menu
            const actions: { label: string; description: string; action: 'summon' | 'activate'; effectId?: string }[] = [
              { label: 'SUMMON', description: `TC${charDef.turnCost} HC${charDef.handCost}`, action: 'summon' },
            ];
            for (const eff of activateFromHandEffects) {
              actions.push({ label: 'ACTIVATE', description: eff.effectDescription.slice(0, 40) + '...', action: 'activate', effectId: eff.id });
            }
            dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'card-action-menu', cardId: instanceId, zone: 'hand', actions } });
          } else if (activateFromHandEffects.length > 0 && !canSummon) {
            // Can only activate from hand, not summon
            const eff = activateFromHandEffects[0];
            this.handleActivateFromHand(state, hp, instanceId, eff.id, dispatch);
          } else if (canSummon) {
            // Normal summon only
            if (charDef.handCost > 0) {
              dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'hand-cost', forCardId: instanceId, needed: charDef.handCost } });
            } else {
              dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'summon', cardInstanceId: instanceId } });
            }
          }
          // Character cards never fall through to charge — click does nothing if can't summon/activate
          break;
        }

        // Direct play — strategy cards
        if (def?.cardType === 'strategy') {
          if (canPlayStrategyCard(state, hp, instanceId)) {
            const stratDef = def as StrategyCardDef;
            if (stratDef.handCost > 0) {
              dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'hand-cost', forCardId: instanceId, needed: stratDef.handCost } });
            } else if (this.strategyNeedsTarget(state, hp, def.id)) {
              const validTargets = this.getStrategyValidTargets(state, hp, def.id);
              if (validTargets.length > 0) {
                dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'strategy-target-select', strategyCardId: instanceId, handCostCardIds: [], validTargetIds: validTargets } });
              }
            } else {
              dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'play-strategy', cardInstanceId: instanceId } });
            }
          }
          // Strategy cards never fall through to charge — click does nothing if can't play
          break;
        }

        // Ability cards should NOT charge — they can only be played during battle-eoa
        if (def?.cardType === 'ability') break;

        // Direct charge — only non-character, non-strategy, non-ability cards
        // (In practice this means field cards or other types charge on click)
        if (state.chain.length === 0) {
          dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'charge-essence', cardInstanceIds: [instanceId] } });
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
      case 'ability-select':
        return def?.cardType === 'ability';
      case 'activate-cost-select': {
        if (sm.costSource === 'hand') {
          return this.isValidActivateHandCost(state, instanceId, sm.effectId);
        }
        return false;
      }
      case 'none': {
        // Highlight ability cards during battle-eoa (only if valid user + can pay cost)
        if (state.phase === 'battle-eoa' && getActingPlayer(state) === hp) {
          if (def?.cardType === 'ability') {
            const abilityDef = def as AbilityCardDef;

            // Check essence cost is payable (base cost — non-X portion)
            {
              const baseCost = abilityDef.essenceCost.specific.reduce((sum, s) => sum + s.count, 0) + abilityDef.essenceCost.neutral + (abilityDef.essenceCost.cardSymbol ?? 0);
              const essenceCount = state.players[hp].essence.length;
              if (baseCost > 0 && essenceCount < baseCost) return false;

              // Also check specific symbol requirements
              if (abilityDef.essenceCost.specific.length > 0 || (abilityDef.essenceCost.cardSymbol ?? 0) > 0) {
                // Build list of all symbols each essence card has (multi-symbol cards count for any)
                const essenceSymbols: string[][] = [];
                for (const eid of state.players[hp].essence) {
                  try {
                    const eDef = getCardDefForInstance(state, eid);
                    essenceSymbols.push(eDef.symbols ?? []);
                  } catch { essenceSymbols.push([]); }
                }
                // Assignment-based check: greedily assign cards to specific costs
                const assigned = new Set<number>();
                for (const c of abilityDef.essenceCost.specific) {
                  let filled = 0;
                  for (let ei = 0; ei < essenceSymbols.length; ei++) {
                    if (filled >= c.count) break;
                    if (assigned.has(ei)) continue;
                    if (essenceSymbols[ei].includes(c.symbol)) {
                      assigned.add(ei);
                      filled++;
                    }
                  }
                  if (filled < c.count) return false;
                }
                // Check cardSymbol costs (any of the ability's symbols)
                if (abilityDef.essenceCost.cardSymbol && abilityDef.essenceCost.cardSymbol > 0) {
                  let filled = 0;
                  for (let ei = 0; ei < essenceSymbols.length; ei++) {
                    if (filled >= abilityDef.essenceCost.cardSymbol) break;
                    if (assigned.has(ei)) continue;
                    if (abilityDef.symbols.some(s => essenceSymbols[ei].includes(s))) {
                      assigned.add(ei);
                      filled++;
                    }
                  }
                  if (filled < abilityDef.essenceCost.cardSymbol) return false;
                }
              }
            }

            // Check that at least one battlefield character meets the ability requirements
            const playerBattleCards = Object.values(state.cards).filter(
              (c) => c.owner === hp && c.zone === 'battlefield'
            );
            return playerBattleCards.some((c) => {
              try {
                const cDef = getCardDefForInstance(state, c.instanceId);
                if (cDef.cardType !== 'character') return false;
                const charDef = cDef as CharacterCardDef;
                return abilityDef.requirements.every((req) => {
                  if (req.type === 'attribute') return charDef.attributes.includes(req.value);
                  return true;
                });
              } catch { return false; }
            });
          }
          return false;
        }
        // Highlight playable cards during main phase
        if (state.phase !== 'main' || state.currentTurn !== hp) return false;
        if (def?.cardType === 'character') return canSummonCard(state, hp, instanceId);
        if (def?.cardType === 'strategy') return canPlayStrategyCard(state, hp, instanceId);
        return false;
      }
      default:
        return false;
    }
  }

  // ============================================================
  // Activate Cost Info Helper
  // ============================================================

  private getActivateCostInfo(effectId: string, costDescription: string): { source: 'hand' | 'discard' | 'essence'; needed: number } {
    switch (effectId) {
      case 'C0078-E1': // Lucian — Discard 1 Character card with {Weapon} from your hand
        return { source: 'hand', needed: 1 };
      case 'C0079-E1': // Solomon — Expel 2 cards from your Discard Pile
        return { source: 'discard', needed: 2 };
      default:
        // Parse needed count from cost description if possible
        const match = costDescription.match(/(\d+)/);
        return { source: 'essence', needed: match ? parseInt(match[1], 10) : 1 };
    }
  }

  /** Check if a hand card is a valid cost for the current activate-cost-select */
  private isValidActivateHandCost(state: GameState, instanceId: string, effectId: string): boolean {
    try {
      const def = getCardDefForInstance(state, instanceId);
      switch (effectId) {
        case 'C0078-E1': // Lucian — must be a Character with {Weapon}
          return def.cardType === 'character' && characterHasAttribute(state, instanceId, 'Weapon');
        default:
          return true;
      }
    } catch { return false; }
  }

  // ============================================================
  // Strategy Target Helpers
  // ============================================================

  private strategyNeedsTarget(state: GameState, player: PlayerId, cardDefId: string): boolean {
    return cardDefId === 'S0041'; // Hard Decision — target 1 Character you control
  }

  private getStrategyValidTargets(state: GameState, player: PlayerId, cardDefId: string): string[] {
    if (cardDefId === 'S0041') {
      // Hard Decision: any character you control in kingdom or battlefield
      return [...state.players[player].kingdom, ...state.players[player].battlefield].filter((id) => {
        const card = state.cards[id];
        if (!card || card.state === undefined) return false; // not a character
        try {
          const def = getCardDefForInstance(state, id);
          return def.cardType === 'character';
        } catch { return false; }
      });
    }
    return [];
  }

  // ============================================================
  // Field Card Activate Logic
  // ============================================================

  /** Count Terra/Water characters a player controls (kingdom + battlefield) */
  private countTerraWaterChars(state: GameState, player: PlayerId): number {
    const kingdom = state.players[player].kingdom;
    const battlefield = state.players[player].battlefield;
    let count = 0;
    for (const id of [...kingdom, ...battlefield]) {
      try {
        const def = getCardDefForInstance(state, id);
        if (def.cardType !== 'character') continue;
        if (def.symbols.includes('terra') || def.symbols.includes('water')) count++;
      } catch { /* skip */ }
    }
    // Oceanic Abyss E2 — virtual Water+Terra character
    count += oceanicAbyssVirtualCharCount(state, player);
    return count;
  }

  /** Check if a field card's activate effect can be used right now */
  private isFieldCardActivatable(state: GameState, ui: UIState, instanceId: string, def: FieldCardDef): boolean {
    const hp = ui.humanPlayer;
    if (state.phase !== 'main') return false;
    if (state.currentTurn !== hp) return false;
    if (ui.selectionMode.type !== 'none') return false;

    const inst = state.cards[instanceId];
    if (!inst || inst.zone !== 'field-area') return false;

    const effect = def.effects.find((e) => e.type === 'activate');
    if (!effect) return false;
    if (effect.oncePerTurn && inst.usedEffects.includes(effect.id)) return false;

    // Check that at least one sub-effect is available
    const count = this.countTerraWaterChars(state, hp);
    return count >= 2;
  }

  /** Handle left-click on a field card to open the activate picker */
  private handleFieldCardClick(state: GameState, ui: UIState, instanceId: string, def: FieldCardDef, dispatch: (action: UIAction) => void): void {
    const hp = ui.humanPlayer;
    const effect = def.effects.find((e) => e.type === 'activate');
    if (!effect) return;

    const count = this.countTerraWaterChars(state, hp);

    const effects = [
      { index: 0, threshold: '2+', desc: 'Select 1 Character — it gets +1/+1 this turn', available: count >= 2 },
      { index: 1, threshold: '4+', desc: 'Draw 1 card', available: count >= 4 },
      { index: 2, threshold: '4+', desc: "Discard 1 from opponent's Essence, move 1 from your DP to Essence", available: count >= 4 },
      { index: 3, threshold: '6+', desc: 'Ability cards cannot be played during this turn', available: count >= 6 },
    ];

    dispatch({
      type: 'SET_SELECTION_MODE',
      mode: {
        type: 'field-activate-pick',
        cardId: instanceId,
        effectId: effect.id,
        effects,
      },
    });
  }

  /** Render the field activate picker overlay */
  private renderFieldActivateOverlay(state: GameState, ui: UIState): void {
    const sm = ui.selectionMode;
    if (sm.type !== 'field-activate-pick' || !this.dispatch) return;

    const count = this.countTerraWaterChars(state, ui.humanPlayer);

    // Get card name
    let cardName = 'FIELD CARD';
    try {
      const def = getCardDefForInstance(state, sm.cardId);
      cardName = def.name;
    } catch { /* skip */ }

    const overlay = new FieldActivateOverlay(
      this.layout,
      cardName,
      count,
      sm.effectId,
      sm.cardId,
      sm.effects,
      this.dispatch,
      ui.humanPlayer,
    );
    this.overlayLayer.addChild(overlay);
  }

  /** Handle activate-from-hand action (e.g., Spike the Impaler expel + search) */
  private handleActivateFromHand(state: GameState, hp: PlayerId, instanceId: string, effectId: string, dispatch: (action: UIAction) => void): void {
    dispatch({
      type: 'PERFORM_ACTION',
      player: hp,
      action: {
        type: 'activate-effect',
        cardInstanceId: instanceId,
        effectId,
      },
    });
  }

  /** Render the card action menu overlay (Summon vs Activate etc.) */
  private renderCardActionMenu(state: GameState, ui: UIState): void {
    const sm = ui.selectionMode;
    if (sm.type !== 'card-action-menu' || !this.dispatch) return;

    const pos = this.cardPositions.get(sm.cardId);
    if (!pos) return;

    const dispatch = this.dispatch;
    const hp = ui.humanPlayer;
    const cardId = sm.cardId;

    const overlay = new CardActionMenuOverlay(
      this.layout,
      pos.x,
      pos.y,
      pos.w,
      pos.h,
      sm.actions,
      (action: CardAction) => {
        dispatch({ type: 'CLEAR_SELECTION' });
        if (action.action === 'summon') {
          // Re-do the summon flow
          try {
            const def = getCardDefForInstance(state, cardId);
            if (def.cardType === 'character') {
              const charDef = def as CharacterCardDef;
              if (charDef.handCost > 0) {
                dispatch({ type: 'SET_SELECTION_MODE', mode: { type: 'hand-cost', forCardId: cardId, needed: charDef.handCost } });
              } else {
                dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'summon', cardInstanceId: cardId } });
              }
            }
          } catch { /* skip */ }
        } else if (action.action === 'activate' && action.effectId) {
          this.handleActivateFromHand(state, hp, cardId, action.effectId, dispatch);
        } else if (action.action === 'charge') {
          dispatch({ type: 'PERFORM_ACTION', player: hp, action: { type: 'charge-essence', cardInstanceIds: [cardId] } });
        }
      },
      () => {
        dispatch({ type: 'CLEAR_SELECTION' });
      },
    );
    this.overlayLayer.addChild(overlay);
  }

  /** Check if any strategy card in player's essence zone has an activatable effect */
  private getActivatableEssenceCards(state: GameState, ui: UIState): { instanceId: string; defId: string; name: string; effectId: string; effectDescription: string }[] {
    const hp = ui.humanPlayer;
    const result: { instanceId: string; defId: string; name: string; effectId: string; effectDescription: string }[] = [];

    const essence = state.players[hp].essence;
    for (const id of essence) {
      const card = state.cards[id];
      if (!card || card.zone !== 'essence') continue;

      let def;
      try { def = getCardDefForInstance(state, id); } catch { continue; }
      if (def.cardType !== 'strategy') continue;

      const stratDef = def as StrategyCardDef;
      for (const effect of stratDef.effects) {
        if (effect.type !== 'activate') continue;
        const isExpelFromEssence = effect.costDescription?.toLowerCase().includes('expel this card from your essence');
        if (!isExpelFromEssence) continue;

        // Check timing
        if (effect.timing === 'main' && state.phase !== 'main') continue;
        if (effect.timing === 'eoa' && state.phase !== 'battle-eoa') continue;

        // Check turn timing
        const isTurnPlayer = state.currentTurn === hp;
        if (effect.turnTiming === 'your-turn' && !isTurnPlayer) continue;
        if (effect.turnTiming === 'opponent-turn' && isTurnPlayer) continue;

        // Check once per turn
        if (effect.oncePerTurn && card.usedEffects.includes(effect.id)) continue;

        // Check name-scoped activate restrictions
        if (effect.activateScope === 'name-turn' || effect.activateScope === 'name-game') {
          const nameKey = def.printNumber + ':' + effect.id;
          if (state.players[hp].usedActivateNames.includes(nameKey)) continue;
        }

        // Card-specific checks
        if (def.id === 'S0044' && effect.id === 'S0044-E2') {
          // Only valid if any card on the field has counters
          let hasCounters = false;
          for (const p of ['player1', 'player2'] as PlayerId[]) {
            const allInPlay = [...state.players[p].kingdom, ...state.players[p].battlefield];
            for (const cid of allInPlay) {
              const c = state.cards[cid];
              if (c && c.counters.length > 0) { hasCounters = true; break; }
            }
            if (hasCounters) break;
          }
          if (!hasCounters) continue;
        }

        result.push({
          instanceId: id,
          defId: def.id,
          name: def.name,
          effectId: effect.id,
          effectDescription: effect.effectDescription,
        });
      }
    }

    return result;
  }

  /** Get kingdom characters with usable activate effects for the human player. */
  private getActivatableKingdomCharacters(state: GameState, ui: UIState): Set<string> {
    const hp = ui.humanPlayer;
    const result = new Set<string>();
    const isMainPhase = state.phase === 'main' && state.currentTurn === hp;
    const isEOAPhase = state.phase === 'battle-eoa';
    const isActing = getActingPlayer(state) === hp;

    if (!isMainPhase && !(isEOAPhase && isActing)) return result;

    const timing = isEOAPhase ? 'eoa' : 'main';
    const kingdom = state.players[hp].kingdom;

    for (const id of kingdom) {
      const inst = state.cards[id];
      if (!inst || inst.zone !== 'kingdom' || inst.owner !== hp) continue;

      let def: CardDef;
      try { def = getCardDefForInstance(state, id); } catch { continue; }
      if (def.cardType !== 'character') continue;

      const charDef = def as CharacterCardDef;
      const hasUsableEffect = charDef.effects.some((e) => {
        if (e.type !== 'activate') return false;
        if (e.oncePerTurn && inst.usedEffects.includes(e.id)) return false;
        if (e.timing !== timing && e.timing !== 'both') return false;
        if (inst.state === 'injured' && !e.isValid) return false;

        // Check name-scoped activate restrictions
        if (e.activateScope === 'name-turn' || e.activateScope === 'name-game') {
          const nameKey = def.printNumber + ':' + e.id;
          if (state.players[hp].usedActivateNames.includes(nameKey)) return false;
        }

        return true;
      });

      if (hasUsableEffect) result.add(id);
    }

    return result;
  }

  /** Render the essence activate overlay */
  private renderEssenceActivateOverlay(state: GameState, ui: UIState): void {
    const sm = ui.selectionMode;
    if (sm.type !== 'essence-activate-select' || !this.dispatch) return;

    const activatable = this.getActivatableEssenceCards(state, ui);
    if (activatable.length === 0) {
      this.dispatch({ type: 'CLEAR_SELECTION' });
      return;
    }

    const overlay = new EssenceActivateOverlay(
      this.layout,
      state,
      activatable,
      this.dispatch,
      ui.humanPlayer,
    );
    this.overlayLayer.addChild(overlay);
  }

  /** Render the character activate confirmation overlay */
  private renderCharacterActivateOverlay(state: GameState, ui: UIState): void {
    const sm = ui.selectionMode;
    if (sm.type !== 'character-activate-confirm' || !this.dispatch) return;

    const inst = state.cards[sm.cardId];
    if (!inst) { this.dispatch({ type: 'CLEAR_SELECTION' }); return; }

    let charDef: CharacterCardDef;
    try {
      const raw = getCardDefForInstance(state, sm.cardId);
      if (raw.cardType !== 'character') { this.dispatch({ type: 'CLEAR_SELECTION' }); return; }
      charDef = raw as CharacterCardDef;
    } catch { this.dispatch({ type: 'CLEAR_SELECTION' }); return; }

    const hp = ui.humanPlayer;
    const isEOAPhase = state.phase === 'battle-eoa';
    const timing = isEOAPhase ? 'eoa' : 'main';

    const usableEffects = charDef.effects.filter((e) => {
      if (e.type !== 'activate') return false;
      if (e.oncePerTurn && inst.usedEffects.includes(e.id)) return false;
      if (e.timing !== timing && e.timing !== 'both') return false;
      if (inst.state === 'injured' && !e.isValid) return false;
      if (e.activateScope === 'name-turn' || e.activateScope === 'name-game') {
        const nameKey = charDef.printNumber + ':' + e.id;
        if (state.players[hp].usedActivateNames.includes(nameKey)) return false;
      }
      return true;
    });

    if (usableEffects.length === 0) { this.dispatch({ type: 'CLEAR_SELECTION' }); return; }

    const dispatch = this.dispatch;
    const cardId = sm.cardId;

    const overlay = new CharacterActivateOverlay(
      this.layout,
      charDef.name,
      cardId,
      usableEffects.map((e) => ({
        effectId: e.id,
        effectDescription: e.effectDescription,
        costDescription: e.costDescription,
        scope: e.activateScope,
      })),
      dispatch,
      hp,
      (effectId: string) => {
        // Player confirmed — transition to cost selection or direct submit
        const effect = usableEffects.find((e) => e.id === effectId);
        if (!effect) return;

        const hasCost = !!effect.costDescription;
        if (hasCost) {
          const costInfo = this.getActivateCostInfo(effect.id, effect.costDescription || '');
          dispatch({
            type: 'SET_SELECTION_MODE',
            mode: {
              type: 'activate-cost-select',
              cardId,
              effectId: effect.id,
              targetIds: [],
              needed: costInfo.needed,
              costSource: costInfo.source,
              costDescription: effect.costDescription,
            },
          });
        } else {
          dispatch({
            type: 'PERFORM_ACTION',
            player: hp,
            action: {
              type: 'activate-effect',
              cardInstanceId: cardId,
              effectId: effect.id,
            },
          });
        }
      },
    );
    this.overlayLayer.addChild(overlay);
  }

  // ============================================================
  // Kingdom/Battlefield Card Click Logic (for ability/activate flows)
  // ============================================================

  private handleKingdomCardClick(state: GameState, ui: UIState, instanceId: string, def: CardDef, dispatch: (action: UIAction) => void): void {
    const hp = ui.humanPlayer;
    const sm = ui.selectionMode;
    const inst = state.cards[instanceId];
    if (!inst) return;

    switch (sm.type) {
      case 'ability-user-select': {
        // Click character on battlefield/kingdom to use ability
        if (inst.owner !== hp) return;
        if (inst.zone !== 'battlefield' && inst.zone !== 'kingdom') return;
        if (def.cardType !== 'character') return;

        // Validate user meets ability requirements
        const abilityInst = state.cards[sm.abilityCardId];
        if (!abilityInst) return;
        let abilityDef: AbilityCardDef;
        try {
          const rawDef = getCardDefForInstance(state, sm.abilityCardId);
          if (rawDef.cardType !== 'ability') return;
          abilityDef = rawDef as AbilityCardDef;
        } catch { return; }

        // Check requirements
        const charDef = def as CharacterCardDef;
        for (const req of abilityDef.requirements) {
          if (req.type === 'attribute') {
            if (!charDef.attributes.includes(req.value)) return;
          }
          if (req.type === 'turn-cost-min') {
            if (charDef.turnCost < parseInt(req.value, 10)) return;
          }
        }

        // Check if ability needs targets
        const needsTargets = !!abilityDef.targetDescription;
        const numTargets = 1; // Most abilities target 1; extend if needed

        if (needsTargets) {
          // Go to target selection step first
          dispatch({
            type: 'SET_SELECTION_MODE',
            mode: {
              type: 'ability-target-select',
              abilityCardId: sm.abilityCardId,
              userId: instanceId,
              needed: numTargets,
            },
          });
        } else {
          // No targets needed — go to essence cost or submit
          const totalEssenceCost = abilityDef.essenceCost.specific.reduce((sum, s) => sum + s.count, 0) + abilityDef.essenceCost.neutral + (abilityDef.essenceCost.cardSymbol ?? 0);
          const hasXCost = !!abilityDef.essenceCost.x;

          if (totalEssenceCost > 0 || hasXCost) {
            dispatch({
              type: 'SET_SELECTION_MODE',
              mode: {
                type: 'ability-essence-cost',
                abilityCardId: sm.abilityCardId,
                userId: instanceId,
                targetIds: [],
                needed: totalEssenceCost,
                isXCost: hasXCost,
                specificCosts: abilityDef.essenceCost.specific,
                cardSymbols: abilityDef.essenceCost.cardSymbol ? abilityDef.symbols : undefined,
              },
            });
          } else {
            dispatch({
              type: 'PERFORM_ACTION',
              player: hp,
              action: {
                type: 'play-ability',
                cardInstanceId: sm.abilityCardId,
                userId: instanceId,
                essenceCostCardIds: [],
              },
            });
          }
        }
        break;
      }

      case 'ability-target-select': {
        // Validate target is opposing the user (if ability requires opposing targets)
        try {
          const abDef2 = getCardDefForInstance(state, sm.abilityCardId) as AbilityCardDef;
          if (abDef2.targetDescription && abDef2.targetDescription.toLowerCase().includes('opposing')) {
            const userTeam = Object.values(state.teams).find((t) => t.characterIds.includes(sm.userId));
            const targetTeam = Object.values(state.teams).find((t) => t.characterIds.includes(instanceId));
            // If either team can't be found, reject — opposing requires both to be in battle teams
            if (!userTeam || !targetTeam) return;
            const isOpposing = (userTeam.isAttacking && targetTeam.blockingTeamId === userTeam.id) ||
              (userTeam.isBlocking && userTeam.blockingTeamId === targetTeam.id) ||
              // Also check the reverse direction (attacker's blockedBy)
              (userTeam.isAttacking && userTeam.blockedByTeamId === targetTeam.id) ||
              (targetTeam.isAttacking && targetTeam.blockedByTeamId === userTeam.id);
            if (!isOpposing) return; // Target is not opposing the user — ignore click
          }
        } catch { return; }

        // Select a target for the ability
        dispatch({ type: 'TOGGLE_CARD_SELECTION', cardId: instanceId });
        const newSelected = ui.selectedCardIds.includes(instanceId)
          ? ui.selectedCardIds.filter((id) => id !== instanceId)
          : [...ui.selectedCardIds, instanceId];

        if (newSelected.length >= sm.needed) {
          // Calculate essence cost from the ability def
          let totalCost = 0;
          let hasXCost = false;
          let abSpecificCosts: { symbol: string; count: number }[] = [];
          try {
            const rawDef = getCardDefForInstance(state, sm.abilityCardId);
            if (rawDef.cardType === 'ability') {
              const abDef = rawDef as AbilityCardDef;
              totalCost = abDef.essenceCost.specific.reduce((sum, s) => sum + s.count, 0) + abDef.essenceCost.neutral + (abDef.essenceCost.cardSymbol ?? 0);
              hasXCost = !!abDef.essenceCost.x;
              abSpecificCosts = abDef.essenceCost.specific;
            }
          } catch { /* skip */ }

          if (totalCost > 0 || hasXCost) {
            let abCardSymbols: string[] | undefined;
            try {
              const rawDef2 = getCardDefForInstance(state, sm.abilityCardId);
              if (rawDef2.cardType === 'ability') {
                const abDef2 = rawDef2 as AbilityCardDef;
                if (abDef2.essenceCost.cardSymbol) {
                  abCardSymbols = abDef2.symbols;
                }
              }
            } catch { /* skip */ }
            dispatch({
              type: 'SET_SELECTION_MODE',
              mode: {
                type: 'ability-essence-cost',
                abilityCardId: sm.abilityCardId,
                userId: sm.userId,
                targetIds: newSelected,
                needed: totalCost,
                isXCost: hasXCost,
                specificCosts: abSpecificCosts,
                cardSymbols: abCardSymbols,
              },
            });
          } else {
            dispatch({
              type: 'PERFORM_ACTION',
              player: hp,
              action: {
                type: 'play-ability',
                cardInstanceId: sm.abilityCardId,
                userId: sm.userId,
                targetIds: newSelected,
                essenceCostCardIds: [],
              },
            });
          }
        }
        break;
      }

      case 'activate-effect-select': {
        // Click own character with activate effect
        if (inst.owner !== hp) return;
        if (def.cardType !== 'character') return;
        const charDef = def as CharacterCardDef;

        // Find usable activate effects
        const usableEffects = charDef.effects.filter((e) => {
          if (e.type !== 'activate') return false;
          if (e.oncePerTurn && inst.usedEffects.includes(e.id)) return false;
          if (e.timing === 'main' && state.phase !== 'main') return false;
          if (e.timing === 'eoa' && state.phase !== 'battle-eoa') return false;
          if (inst.state === 'injured' && !e.isValid) return false;
          return true;
        });

        if (usableEffects.length === 0) return;

        if (usableEffects.length === 1) {
          const effect = usableEffects[0];
          // Determine if cost cards are needed
          const hasCost = !!effect.costDescription;
          if (hasCost) {
            const costInfo = this.getActivateCostInfo(effect.id, effect.costDescription || '');
            dispatch({
              type: 'SET_SELECTION_MODE',
              mode: {
                type: 'activate-cost-select',
                cardId: instanceId,
                effectId: effect.id,
                targetIds: [],
                needed: costInfo.needed,
                costSource: costInfo.source,
                costDescription: effect.costDescription,
              },
            });
          } else {
            // No cost, submit directly
            dispatch({
              type: 'PERFORM_ACTION',
              player: hp,
              action: {
                type: 'activate-effect',
                cardInstanceId: instanceId,
                effectId: effect.id,
              },
            });
          }
        } else {
          // Multiple effects — show picker
          dispatch({
            type: 'SET_SELECTION_MODE',
            mode: {
              type: 'activate-pick-effect',
              cardId: instanceId,
              effects: usableEffects.map((e) => ({ id: e.id, desc: e.effectDescription })),
            },
          });
        }
        break;
      }

      case 'activate-target-select': {
        dispatch({ type: 'TOGGLE_CARD_SELECTION', cardId: instanceId });
        const newSelected = ui.selectedCardIds.includes(instanceId)
          ? ui.selectedCardIds.filter((id) => id !== instanceId)
          : [...ui.selectedCardIds, instanceId];

        if (newSelected.length >= sm.needed) {
          dispatch({
            type: 'PERFORM_ACTION',
            player: hp,
            action: {
              type: 'activate-effect',
              cardInstanceId: sm.cardId,
              effectId: sm.effectId,
              targetIds: newSelected,
            },
          });
        }
        break;
      }

      case 'none': {
        // Direct activate-effect during main or EOA: click own character with effects
        if (inst.owner !== hp) return;
        if (def.cardType !== 'character') return;
        const isMainPhase = state.phase === 'main' && state.currentTurn === hp;
        const isEOAPhase = state.phase === 'battle-eoa';
        const isActing = getActingPlayer(state) === hp;
        if (!isMainPhase && !(isEOAPhase && isActing)) return;

        const charDef = def as CharacterCardDef;
        const timing = isEOAPhase ? 'eoa' : 'main';
        const usableEffects = charDef.effects.filter((e) => {
          if (e.type !== 'activate') return false;
          if (e.oncePerTurn && inst.usedEffects.includes(e.id)) return false;
          if (e.timing !== timing && e.timing !== 'both') return false;
          if (inst.state === 'injured' && !e.isValid) return false;
          // Check name-scoped activate restrictions
          if (e.activateScope === 'name-turn' || e.activateScope === 'name-game') {
            const nameKey = def.printNumber + ':' + e.id;
            if (state.players[hp].usedActivateNames.includes(nameKey)) return false;
          }
          return true;
        });

        if (usableEffects.length === 0) return;

        // Show confirmation overlay so player can see effect details before committing
        const firstEffect = usableEffects[0];
        dispatch({
          type: 'SET_SELECTION_MODE',
          mode: {
            type: 'character-activate-confirm',
            cardId: instanceId,
            effectId: firstEffect.id,
          },
        });
        break;
      }

      case 'strategy-target-select': {
        // Click a character in our kingdom to sacrifice (e.g., Hard Decision)
        if (inst.owner !== hp) return;
        if (inst.zone !== 'kingdom' && inst.zone !== 'battlefield') return;
        if (!sm.validTargetIds.includes(instanceId)) return;

        dispatch({
          type: 'PERFORM_ACTION',
          player: hp,
          action: {
            type: 'play-strategy',
            cardInstanceId: sm.strategyCardId,
            handCostCardIds: sm.handCostCardIds.length > 0 ? sm.handCostCardIds : undefined,
            targetIds: [instanceId],
          },
        });
        break;
      }
    }
  }

  // ============================================================
  // Essence Card Click Logic (for paying ability costs)
  // ============================================================

  private handleEssenceCardClick(state: GameState, ui: UIState, instanceId: string, dispatch: (action: UIAction) => void): void {
    const hp = ui.humanPlayer;
    const sm = ui.selectionMode;

    if (sm.type === 'ability-essence-cost') {
      const isDeselecting = ui.selectedCardIds.includes(instanceId);
      const isXCost = !!sm.isXCost;

      // For non-X costs, prevent selecting more cards than needed
      if (!isXCost && !isDeselecting && ui.selectedCardIds.length >= sm.needed) {
        return;
      }

      dispatch({ type: 'TOGGLE_CARD_SELECTION', cardId: instanceId });

      const newSelected = isDeselecting
        ? ui.selectedCardIds.filter((id) => id !== instanceId)
        : [...ui.selectedCardIds, instanceId];

      if (newSelected.length >= sm.needed) {
        dispatch({
          type: 'PERFORM_ACTION',
          player: hp,
          action: {
            type: 'play-ability',
            cardInstanceId: sm.abilityCardId,
            userId: sm.userId,
            targetIds: sm.targetIds,
            essenceCostCardIds: newSelected,
          },
        });
      }
    } else if (sm.type === 'activate-cost-select') {
      dispatch({ type: 'TOGGLE_CARD_SELECTION', cardId: instanceId });

      const newSelected = ui.selectedCardIds.includes(instanceId)
        ? ui.selectedCardIds.filter((id) => id !== instanceId)
        : [...ui.selectedCardIds, instanceId];

      if (newSelected.length >= sm.needed) {
        dispatch({
          type: 'PERFORM_ACTION',
          player: hp,
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
    const btnY = L.uiBarY - 48;
    const btnH = 36;
    const btnGap = 8;
    const buttons: { label: string; color: number; onClick: () => void; pulse?: boolean }[] = [];

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
    } else if (
      sm.type === 'ability-select' || sm.type === 'ability-user-select' ||
      sm.type === 'ability-target-select' || sm.type === 'ability-essence-cost' ||
      sm.type === 'activate-effect-select' || sm.type === 'activate-pick-effect' ||
      sm.type === 'activate-target-select' || sm.type === 'activate-cost-select' ||
      sm.type === 'field-activate-pick' || sm.type === 'card-action-menu'
    ) {
      buttons.push({ label: 'CANCEL', color: 0x374151, onClick: () => d({ type: 'CLEAR_SELECTION' }) });
    } else if (sm.type === 'select-attackers') {
      // Attacker selection mode — tap teams to toggle, then confirm
      const selectedCount = ui.selectedTeamIds.length;
      buttons.push({
        label: selectedCount > 0 ? `ATTACK (${selectedCount})` : 'ATTACK',
        color: selectedCount > 0 ? COLORS.buttonDanger : 0x374151,
        onClick: () => {
          if (selectedCount > 0) {
            d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'select-attackers', teamIds: ui.selectedTeamIds } });
          }
        },
        pulse: selectedCount > 0,
      });
      buttons.push({
        label: 'SKIP',
        color: 0x374151,
        onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'select-attackers', teamIds: [] } }),
      });
    } else if (sm.type === 'discard-to-hand-limit') {
      const count = sm.count;
      const selected = ui.selectedCardIds.length;
      buttons.push({
        label: `DISCARD (${selected}/${count})`,
        color: selected >= count ? COLORS.buttonDanger : 0x374151,
        onClick: () => {
          if (selected >= count) {
            d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'discard-to-hand-limit', cardInstanceIds: ui.selectedCardIds } });
          }
        },
        pulse: selected >= count,
      });
    } else if (sm.type === 'none') {
      // Phase-specific buttons
      if (state.phase === 'main' && state.currentTurn === hp) {
        // Direct interaction: cards are clicked directly for summon/strategy
        buttons.push({ label: 'CHARGE', color: COLORS.accentCyan, onClick: () => d({ type: 'SET_SELECTION_MODE', mode: { type: 'charge-essence' } }) });
        buttons.push({ label: 'PASS', color: 0x374151, onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'pass-priority' } }), pulse: true });
      } else if (state.phase === 'organization') {
        buttons.push({ label: 'ORGANIZE', color: COLORS.accentBlue, onClick: () => d({ type: 'SET_SELECTION_MODE', mode: { type: 'team-organize' } }) });
        // First turn of the game — cannot battle
        if (state.turnNumber > 0) {
          buttons.push({ label: 'BATTLE', color: COLORS.buttonPrimary, onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'choose-battle-or-end', choice: 'battle' } }), pulse: true });
        }
        buttons.push({ label: 'END TURN', color: 0x374151, onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'choose-battle-or-end', choice: 'end' } }) });
      } else if (state.phase === 'battle-attack') {
        // Auto-enter attacker selection mode — teams are immediately clickable
        d({ type: 'SET_SELECTION_MODE', mode: { type: 'select-attackers' } });
      } else if (state.phase === 'battle-eoa') {
        // Direct interaction: ability cards are clicked directly from hand,
        // activate effects by clicking kingdom characters. Only PASS needed.
        buttons.push({ label: 'PASS PRIORITY', color: 0x374151, onClick: () => d({ type: 'PERFORM_ACTION', player: hp, action: { type: 'pass-priority' } }), pulse: true });
      } else if (state.phase === 'end') {
        // Auto-enter discard mode if hand > 7
        if (state.players[hp].hand.length > 7) {
          const excess = state.players[hp].hand.length - 7;
          d({ type: 'SET_SELECTION_MODE', mode: { type: 'discard-to-hand-limit', count: excess } });
        }
      }
    }

    if (buttons.length === 0) return;

    // Suppress pulse when a modal overlay is open (don't distract from modal)
    const modalOpen =
      !!(state.pendingSearch && state.pendingSearch.owner === hp) ||
      !!(state.pendingTargetChoice && state.pendingTargetChoice.owner === hp) ||
      !!(state.pendingOptionalEffect && state.pendingOptionalEffect.owner === hp) ||
      ui.selectionMode.type === 'mulligan' ||
      ui.selectionMode.type === 'team-organize' ||
      ui.selectionMode.type === 'ability-essence-cost' ||
      ui.selectionMode.type === 'field-activate-pick' ||
      ui.selectionMode.type === 'essence-activate-select' ||
      ui.selectionMode.type === 'card-action-menu';

    const totalW = buttons.length * 100 + (buttons.length - 1) * btnGap;
    let curX = L.width / 2 - totalW / 2;

    for (const btn of buttons) {
      const container = this.makeButton(btn.label, 100, btnH, btn.color);
      container.x = curX;
      container.y = btnY;
      container.on('pointerdown', () => {
        gsap.killTweensOf(container);
        container.alpha = 1;
        btn.onClick();
      });
      this.uiLayer.addChild(container);

      if (btn.pulse && !modalOpen) {
        gsap.to(container, {
          alpha: 0.7,
          duration: TIMING.buttonPulse / 2,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        });
      }

      curX += 100 + btnGap;
    }
  }

  // ============================================================
  // Center Bar
  // ============================================================

  private renderCenterBar(state: GameState, ui: UIState): void {
    const L = this.layout;

    // Gradient center bar — darker edges, slightly lighter center
    const barBg = new Graphics();
    barBg.rect(0, L.centerBarY, L.width, L.centerBarH);
    barBg.fill({ color: 0x0c1425 });
    this.boardLayer.addChild(barBg);

    // Center highlight band
    const centerGlow = new Graphics();
    const glowW = L.width * 0.4;
    centerGlow.rect(L.width / 2 - glowW / 2, L.centerBarY, glowW, L.centerBarH);
    centerGlow.fill({ color: COLORS.accentBlue, alpha: 0.04 });
    this.boardLayer.addChild(centerGlow);

    for (const lineY of [L.centerBarY, L.centerBarY + L.centerBarH]) {
      // Soft glow band
      const glowLine = new Graphics();
      glowLine.rect(0, lineY - 2, L.width, 4);
      glowLine.fill({ color: COLORS.accentBlue, alpha: 0.03 });
      this.boardLayer.addChild(glowLine);
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

    // Active player's Turn Markers (TM) — prominent center bar display
    const activePlayer = state.currentTurn;
    const activeTM = state.players[activePlayer].turnMarker;
    const tmTxt = new Text({
      text: `Turn Marker: ${activeTM}`,
      style: new TextStyle({ fontSize: 15, fill: COLORS.textBright, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
    });
    tmTxt.anchor.set(0, 0.5);
    tmTxt.x = L.centerColX + 16;
    tmTxt.y = L.centerBarY + L.centerBarH / 2;
    this.boardLayer.addChild(tmTxt);

    // Player indicator pill (left-center)
    const isPlayerTurn = ui.mode === 'pvai' ? state.currentTurn === ui.humanPlayer : state.currentTurn === 'player1';
    const pillColor = isPlayerTurn ? COLORS.accentCyan : 0xf59e0b;
    const playerTxt = new Text({
      text: playerLabel,
      style: new TextStyle({ fontSize: 15, fill: COLORS.textBright, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
    });
    playerTxt.anchor.set(0.5, 0.5);
    const pillX = L.width / 2 - 80;
    const pillY = L.centerBarY + L.centerBarH / 2;
    const pillW = playerTxt.width + 20;
    const pillH = 24;
    const pill = new Graphics();
    pill.roundRect(pillX - pillW / 2, pillY - pillH / 2, pillW, pillH, pillH / 2);
    pill.fill({ color: pillColor, alpha: 0.15 });
    pill.stroke({ color: pillColor, width: 1, alpha: 0.5 });
    this.boardLayer.addChild(pill);
    playerTxt.x = pillX;
    playerTxt.y = pillY;
    this.boardLayer.addChild(playerTxt);

    // Phase label (right-center)
    const phaseTxt = new Text({
      text: phaseText.toUpperCase(),
      style: new TextStyle({ fontSize: 15, fill: COLORS.accentBlue, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
    });
    phaseTxt.anchor.set(0.5, 0.5);
    phaseTxt.x = L.width / 2 + 80;
    phaseTxt.y = L.centerBarY + L.centerBarH / 2;
    this.boardLayer.addChild(phaseTxt);

    if (state.chain.length > 0) {
      // ── Chain Display — Premium Horizontal Panel ───────────────
      const thumbW = 56;
      const thumbH = 78;
      const connW = 28;           // connector space between cards
      const padX = 20;
      const padTop = 8;
      const descBarH = 22;       // single-line effect description bar

      // Helper: get effect description for a chain entry
      const getEntryEffectDesc = (entry: typeof state.chain[0], cDef: CardDef | undefined): string => {
        if (!cDef) return '';
        if (entry.type === 'summon') return `Summon ${cDef.name} to the kingdom`;
        // For field cards with a sub-choice, show the specific sub-effect description
        if (cDef.cardType === 'field' && entry.effectSubChoice !== undefined) {
          const subDescs: Record<string, string[]> = {
            'F0006': [
              'Select 1 Character — it gets +1/+1 this turn',
              'Draw 1 card',
              "Discard 1 from opponent's Essence, move 1 from your DP to Essence",
              'Ability cards cannot be played during this turn',
            ],
          };
          const descs = subDescs[cDef.id];
          if (descs && descs[entry.effectSubChoice]) return descs[entry.effectSubChoice];
        }
        const effects = (cDef as { effects?: { id: string; effectDescription: string }[] }).effects;
        if (!effects || effects.length === 0) return cDef.name;
        if (entry.effectId) {
          const match = effects.find((e: { id: string }) => e.id === entry.effectId);
          if (match) return match.effectDescription;
        }
        return effects[0].effectDescription;
      };

      // Pre-compute latest entry info
      const latestEntry = state.chain[state.chain.length - 1];
      let latestDef: CardDef | undefined;
      try { latestDef = getCardDefForInstance(state, latestEntry.sourceCardInstanceId); } catch { /* skip */ }
      const activeEffectDesc = getEntryEffectDesc(latestEntry, latestDef);

      // Panel sizing
      const totalCardsW = state.chain.length * thumbW
        + Math.max(0, state.chain.length - 1) * connW;
      const panelW = Math.max(totalCardsW + padX * 2, 200);
      const panelH = padTop + thumbH + 10 + descBarH + 8;
      const panelX = L.width / 2 - panelW / 2;
      // Always position at top so it doesn't block kingdom cards or battle overlay
      const panelY = 10;

      // ── Panel container with mask for clean clipping ──
      const chainContainer = new Container();
      this.uiLayer.addChild(chainContainer);

      // Backdrop — dark frosted glass
      const bg = new Graphics();
      bg.roundRect(panelX, panelY, panelW, panelH, 10);
      bg.fill({ color: 0x0a0f1e, alpha: 0.95 });
      chainContainer.addChild(bg);

      // Gold accent line at top edge
      const topLine = new Graphics();
      topLine.moveTo(panelX + 20, panelY);
      topLine.lineTo(panelX + panelW - 20, panelY);
      topLine.stroke({ color: COLORS.accentGold, width: 2, alpha: 0.6 });
      chainContainer.addChild(topLine);

      // Subtle outer glow
      const outerGlow = new Graphics();
      outerGlow.roundRect(panelX - 2, panelY - 2, panelW + 4, panelH + 4, 12);
      outerGlow.stroke({ color: COLORS.accentGold, width: 1, alpha: 0.08 });
      chainContainer.addChild(outerGlow);

      // Card row area
      const rowX = L.width / 2 - totalCardsW / 2;
      const rowY = panelY + padTop;

      const typeColors: Record<string, number> = {
        character: 0x3b82f6, ability: 0xf59e0b, strategy: 0x10b981, field: 0xa855f7,
      };

      for (let i = 0; i < state.chain.length; i++) {
        const tx = rowX + i * (thumbW + connW);
        const isLatest = i === state.chain.length - 1;
        const entry = state.chain[i];

        let defId = '';
        let cardDef: CardDef | undefined;
        try {
          cardDef = getCardDefForInstance(state, entry.sourceCardInstanceId);
          defId = cardDef.id;
        } catch { /* skip */ }

        const typeColor = cardDef ? (typeColors[cardDef.cardType] ?? 0x6b7280) : 0x6b7280;

        // ── Chain connector (gold line + diamond between entries) ──
        if (i > 0) {
          const lineY = rowY + thumbH / 2;
          const lineStartX = tx - connW;
          const lineEndX = tx;
          const lineMidX = lineStartX + connW / 2;

          const conn = new Graphics();
          // Horizontal gold line
          conn.moveTo(lineStartX + 2, lineY);
          conn.lineTo(lineEndX - 2, lineY);
          conn.stroke({ color: COLORS.accentGold, width: 1.5, alpha: 0.4 });
          // Diamond shape at midpoint
          const d = 4;
          conn.moveTo(lineMidX, lineY - d);
          conn.lineTo(lineMidX + d, lineY);
          conn.lineTo(lineMidX, lineY + d);
          conn.lineTo(lineMidX - d, lineY);
          conn.closePath();
          conn.fill({ color: COLORS.accentGold, alpha: 0.5 });
          conn.stroke({ color: COLORS.accentGold, width: 1, alpha: 0.7 });
          chainContainer.addChild(conn);
        }

        if (defId && cardDef) {
          // Latest card glow
          if (isLatest) {
            const glow = new Graphics();
            glow.roundRect(tx - 4, rowY - 4, thumbW + 8, thumbH + 8, 7);
            glow.fill({ color: COLORS.accentGold, alpha: 0.08 });
            chainContainer.addChild(glow);
          }

          // Card thumbnail
          const card = new CardSprite({
            defId,
            size: { width: thumbW, height: thumbH } as CardSize,
            cardDef,
            showName: true,
          });
          card.x = tx;
          card.y = rowY;
          card.eventMode = 'none';
          if (!isLatest) card.alpha = 0.5;
          chainContainer.addChild(card);

          // Border — gold for latest, type-colored for others
          const border = new Graphics();
          border.roundRect(tx - 1.5, rowY - 1.5, thumbW + 3, thumbH + 3, 5);
          border.stroke({
            color: isLatest ? COLORS.accentGold : typeColor,
            width: isLatest ? 2 : 1,
            alpha: isLatest ? 0.9 : 0.35,
          });
          chainContainer.addChild(border);

          // Number badge — small, top-right
          const badgeR = 9;
          const badgeCX = tx + thumbW - 1;
          const badgeCY = rowY + 1;
          const numBg = new Graphics();
          numBg.circle(badgeCX, badgeCY, badgeR);
          numBg.fill({ color: isLatest ? COLORS.accentGold : 0x111827 });
          numBg.stroke({ color: isLatest ? 0xfef3c7 : 0x4b5563, width: 1.5 });
          chainContainer.addChild(numBg);

          const numTxt = new Text({
            text: `${i + 1}`,
            style: new TextStyle({ fontSize: 10, fill: isLatest ? 0x1a0800 : 0x9ca3af, fontFamily: FONT, fontWeight: 'bold' }),
          });
          numTxt.anchor.set(0.5, 0.5);
          numTxt.x = badgeCX;
          numTxt.y = badgeCY;
          chainContainer.addChild(numTxt);

          // Pulse on latest
          if (isLatest) {
            gsap.to(border, { alpha: 0.3, duration: 0.7, repeat: -1, yoyo: true, ease: 'sine.inOut' });
          }
        } else {
          // Fallback numbered placeholder
          const badge = new Graphics();
          badge.roundRect(tx, rowY, thumbW, thumbH, 6);
          badge.fill({ color: 0x111827, alpha: 0.8 });
          badge.stroke({ color: 0x374151, width: 1 });
          chainContainer.addChild(badge);

          const numTxt = new Text({
            text: `${i + 1}`,
            style: new TextStyle({ fontSize: 16, fill: 0x6b7280, fontFamily: FONT, fontWeight: 'bold' }),
          });
          numTxt.anchor.set(0.5, 0.5);
          numTxt.x = tx + thumbW / 2;
          numTxt.y = rowY + thumbH / 2;
          chainContainer.addChild(numTxt);
        }
      }

      // ── Effect description bar — single line, properly clipped ──
      if (activeEffectDesc) {
        const descBarY = rowY + thumbH + 6;
        const maxDescW = panelW - padX * 2;

        // Separator line
        const sep = new Graphics();
        sep.moveTo(panelX + padX, descBarY - 1);
        sep.lineTo(panelX + panelW - padX, descBarY - 1);
        sep.stroke({ color: 0x1e293b, width: 1, alpha: 0.6 });
        chainContainer.addChild(sep);

        // Truncate to fit single line (~55 chars max)
        const maxChars = 55;
        const displayDesc = activeEffectDesc.length > maxChars
          ? activeEffectDesc.slice(0, maxChars - 1).trimEnd() + '\u2026'
          : activeEffectDesc;

        const descTxt = new Text({
          text: `\u25B8 ${displayDesc}`,
          style: new TextStyle({
            fontSize: 10,
            fill: 0xd1d5db,
            fontFamily: FONT,
            fontWeight: '600',
          }),
        });
        descTxt.anchor.set(0.5, 0.5);
        descTxt.x = L.width / 2;
        descTxt.y = descBarY + descBarH / 2;
        // Hard clip: if text is still too wide, scale it down
        if (descTxt.width > maxDescW) {
          descTxt.scale.x = maxDescW / descTxt.width;
        }
        chainContainer.addChild(descTxt);
      }

      // Clip mask — nothing renders outside the panel
      const clipMask = new Graphics();
      clipMask.roundRect(panelX, panelY, panelW, panelH, 10);
      clipMask.fill({ color: 0xffffff });
      chainContainer.mask = clipMask;
      chainContainer.addChild(clipMask);
    }

    if (ui.isAIThinking) {
      // Animated AI thinking indicator
      const aiContainer = new Container();

      // Pulsing dot
      const dot = new Graphics();
      dot.circle(0, 0, 4);
      dot.fill({ color: COLORS.accentCyan });
      aiContainer.addChild(dot);

      // Animated text with ellipsis
      const thinkTxt = new Text({
        text: 'AI THINKING',
        style: STYLES.aiThinking,
      });
      thinkTxt.anchor.set(0, 0.5);
      thinkTxt.x = 10;
      thinkTxt.y = 0;
      aiContainer.addChild(thinkTxt);

      aiContainer.x = L.width - L.sideColW - 16 - thinkTxt.width - 14;
      aiContainer.y = L.centerBarY + L.centerBarH / 2;
      this.boardLayer.addChild(aiContainer);

      // Pulse the dot
      if (this.aiThinkingTween) this.aiThinkingTween.kill();
      this.aiThinkingTween = gsap.to(dot, {
        alpha: 0.2,
        duration: 0.5,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
      this.aiThinkingContainer = aiContainer;
    } else {
      // Clean up AI thinking animation
      if (this.aiThinkingTween) {
        this.aiThinkingTween.kill();
        this.aiThinkingTween = null;
      }
      this.aiThinkingContainer = null;
    }
  }

  // ============================================================
  // Deferred PWR Pills (rendered after center bar)
  // ============================================================

  private renderDeferredPwrPills(): void {
    for (const p of this.deferredPwrPills) {
      const pill = new Graphics();
      pill.roundRect(p.x - p.w / 2, p.y, p.w, p.h, p.h / 2);
      pill.fill({ color: 0x0a0e18, alpha: 0.9 });
      pill.stroke({ color: p.color, width: 1, alpha: 0.5 });
      this.boardLayer.addChild(pill);

      const txt = new Text({
        text: p.text,
        style: new TextStyle({ fontSize: 11, fill: p.color, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
      });
      txt.anchor.set(0.5, 0.5);
      txt.x = p.x;
      txt.y = p.y + p.h / 2;
      this.boardLayer.addChild(txt);
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
    const phaseShortLabels: Record<Phase, string> = {
      'setup': 'SET',
      'start': 'STR',
      'main': 'MN',
      'organization': 'ORG',
      'battle-attack': 'ATK',
      'battle-block': 'BLK',
      'battle-eoa': 'EOA',
      'battle-showdown': 'SHD',
      'end': 'END',
    };
    const segW = 36;
    const segH = 18;
    const segGap = 2;
    const totalSegW = phases.length * segW + (phases.length - 1) * segGap;
    const segStartX = L.width / 2 - totalSegW / 2;
    const activeIdx = phases.indexOf(state.phase);

    phases.forEach((phase, i) => {
      const sx = segStartX + i * (segW + segGap);
      const isActive = phase === state.phase;
      const isPast = i < activeIdx;

      const seg = new Graphics();
      seg.roundRect(sx, centerY - segH / 2, segW, segH, 3);

      if (isActive) {
        seg.fill({ color: COLORS.accentBlue, alpha: 0.8 });
      } else if (isPast) {
        seg.fill({ color: COLORS.accentBlue, alpha: 0.15 });
      } else {
        seg.fill({ color: 0x1a2535, alpha: 0.4 });
      }
      this.uiLayer.addChild(seg);

      // Active segment glow
      if (isActive) {
        const glow = new Graphics();
        glow.roundRect(sx - 1, centerY - segH / 2 - 1, segW + 2, segH + 2, 4);
        glow.stroke({ color: COLORS.accentBlue, width: 1, alpha: 0.5 });
        this.uiLayer.addChild(glow);

        // Triangle marker above
        const tri = new Graphics();
        tri.moveTo(sx + segW / 2 - 4, centerY - segH / 2 - 4);
        tri.lineTo(sx + segW / 2 + 4, centerY - segH / 2 - 4);
        tri.lineTo(sx + segW / 2, centerY - segH / 2 - 1);
        tri.closePath();
        tri.fill({ color: COLORS.accentBlue });
        this.uiLayer.addChild(tri);
      }

      // Label
      const lbl = new Text({
        text: phaseShortLabels[phase] ?? phase.substring(0, 3).toUpperCase(),
        style: new TextStyle({
          fontSize: 10,
          fill: isActive ? 0xffffff : (isPast ? COLORS.accentBlue : COLORS.textMuted),
          fontFamily: FONT,
          fontWeight: isActive ? 'bold' : 'normal',
          letterSpacing: 0.5,
        }),
      });
      lbl.anchor.set(0.5, 0.5);
      lbl.x = sx + segW / 2;
      lbl.y = centerY;
      lbl.alpha = isActive ? 1 : (isPast ? 0.6 : 0.4);
      this.uiLayer.addChild(lbl);
    });

    const opp = ui.humanPlayer === 'player1' ? 'player2' : 'player1';
    const bottomTmStr = ui.mode === 'aivai'
      ? `Turn ${state.turnNumber}  ·  P1 Turn Marker: ${state.players.player1.turnMarker}  P2 Turn Marker: ${state.players.player2.turnMarker}`
      : `Turn ${state.turnNumber}  ·  Turn Marker: ${state.players[ui.humanPlayer].turnMarker}  Opp Turn Marker: ${state.players[opp].turnMarker}`;
    const bottomTmTxt = new Text({ text: bottomTmStr, style: new TextStyle({ fontSize: 13, fill: COLORS.textMuted, fontFamily: FONT }) });
    bottomTmTxt.anchor.set(0, 0.5);
    bottomTmTxt.x = 16;
    bottomTmTxt.y = centerY;
    this.uiLayer.addChild(bottomTmTxt);

    const brStr = ui.mode === 'aivai'
      ? `P1 BR:${state.players.player1.battleRewards.length}/10  P2 BR:${state.players.player2.battleRewards.length}/10`
      : `BR:${state.players[ui.humanPlayer].battleRewards.length}/10  OPP:${state.players[ui.humanPlayer === 'player1' ? 'player2' : 'player1'].battleRewards.length}/10`;
    const brTxt = new Text({ text: brStr, style: new TextStyle({ fontSize: 13, fill: COLORS.textMuted, fontFamily: FONT }) });
    brTxt.anchor.set(1, 0.5);
    brTxt.x = L.width - 16;
    brTxt.y = centerY;
    this.uiLayer.addChild(brTxt);

    if (ui.lastError) {
      const errTxt = new Text({ text: ui.lastError, style: new TextStyle({ fontSize: 13, fill: COLORS.buttonDanger, fontFamily: FONT }) });
      errTxt.anchor.set(0.5, 0.5);
      errTxt.x = L.width / 2;
      errTxt.y = centerY - 12;
      this.uiLayer.addChild(errTxt);
    }

    // Speed + narration controls
    this.renderSettingsControls(state, ui);
  }

  // ============================================================
  // Settings Controls (Speed + Narration)
  // ============================================================

  private renderSettingsControls(_state: GameState, ui: UIState): void {
    if (!this.dispatch) return;
    const L = this.layout;
    const d = this.dispatch;

    const btnW = 36;
    const btnH = 20;
    const gap = 4;
    const centerY = L.uiBarY + L.uiBarH / 2;

    // Position: right side, to the left of BR text
    const startX = L.width - 200;

    const presets: { label: string; key: SpeedPreset }[] = [
      { label: 'SLW', key: 'slow' },
      { label: 'NRM', key: 'normal' },
      { label: 'FST', key: 'fast' },
    ];

    presets.forEach((preset, i) => {
      const x = startX + i * (btnW + gap);
      const isActive = ui.speedPreset === preset.key;

      const btn = new Graphics();
      btn.roundRect(x, centerY - btnH / 2, btnW, btnH, 3);
      if (isActive) {
        btn.fill({ color: COLORS.accentCyan, alpha: 0.8 });
      } else {
        btn.fill({ color: 0x1a2535, alpha: 0.6 });
      }
      btn.eventMode = 'static';
      btn.cursor = 'pointer';
      btn.on('pointerdown', () => {
        d({ type: 'SET_SPEED_PRESET', preset: preset.key });
      });
      this.uiLayer.addChild(btn);

      const lbl = new Text({
        text: preset.label,
        style: new TextStyle({
          fontSize: 9,
          fill: isActive ? 0x000000 : COLORS.textMuted,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 0.5,
        }),
      });
      lbl.anchor.set(0.5, 0.5);
      lbl.x = x + btnW / 2;
      lbl.y = centerY;
      lbl.eventMode = 'none';
      this.uiLayer.addChild(lbl);
    });

    // Narration toggle
    const narX = startX + presets.length * (btnW + gap) + gap;
    const isNarActive = ui.narrationEnabled;

    const narBtn = new Graphics();
    narBtn.roundRect(narX, centerY - btnH / 2, btnW, btnH, 3);
    if (isNarActive) {
      narBtn.fill({ color: COLORS.accentCyan, alpha: 0.8 });
    } else {
      narBtn.fill({ color: 0x1a2535, alpha: 0.6 });
    }
    narBtn.eventMode = 'static';
    narBtn.cursor = 'pointer';
    narBtn.on('pointerdown', () => {
      d({ type: 'SET_NARRATION_ENABLED', enabled: !ui.narrationEnabled });
    });
    this.uiLayer.addChild(narBtn);

    const narLbl = new Text({
      text: 'NAR',
      style: new TextStyle({
        fontSize: 9,
        fill: isNarActive ? 0x000000 : COLORS.textMuted,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 0.5,
      }),
    });
    narLbl.anchor.set(0.5, 0.5);
    narLbl.x = narX + btnW / 2;
    narLbl.y = centerY;
    narLbl.eventMode = 'none';
    this.uiLayer.addChild(narLbl);
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

  private isAbilitySelectionActive(): boolean {
    const sm = this.currentUIState?.selectionMode.type;
    return sm === 'ability-user-select' || sm === 'ability-target-select' ||
        sm === 'ability-essence-cost' || sm === 'activate-effect-select' ||
        sm === 'activate-pick-effect' || sm === 'activate-target-select' ||
        sm === 'activate-cost-select';
  }

  private shouldShowBattle(state: GameState): boolean {
    const phase = state.phase;
    const isBattlePhase = phase === 'battle-attack' || phase === 'battle-block'
      || phase === 'battle-eoa' || phase === 'battle-showdown';
    if (!isBattlePhase) return false;

    const attackingTeams = Object.values(state.teams).filter((t) => t.isAttacking);
    return attackingTeams.length > 0;
  }

  private renderBattleOverlay(state: GameState, ui: UIState): void {
    if (!this.dispatch) return;
    const abilityActive = this.isAbilitySelectionActive();
    const chainGrew = state.chain.length > this.prevChainLength;
    this.prevChainLength = state.chain.length;

    // Hide overlay entirely during ability selection so board is fully interactive
    if (!abilityActive) {
      const overlay = new BattleOverlay(state, ui, this.layout, this.dispatch, chainGrew);
      this.overlayLayer.addChild(overlay);
    }

    // Status pill on uiLayer during ability selection
    if (abilityActive) {
      const sm = ui.selectionMode.type;
      let statusText = '';
      if (sm === 'ability-user-select') statusText = 'SELECT ABILITY USER...';
      else if (sm === 'ability-target-select') statusText = 'SELECT TARGET...';
      else if (sm === 'ability-essence-cost') statusText = 'PAY ESSENCE COST...';
      else if (sm === 'activate-effect-select' || sm === 'activate-pick-effect') statusText = 'SELECT EFFECT...';
      else if (sm === 'activate-target-select') statusText = 'SELECT TARGET...';
      else if (sm === 'activate-cost-select') statusText = 'PAY COST...';

      if (statusText) {
        const pillW = 220;
        const pillH = 32;
        const pillX = this.layout.width / 2 - pillW / 2;
        const pillY = 18;
        const pill = new Graphics();
        pill.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
        pill.fill({ color: 0x7c3aed, alpha: 0.85 });
        pill.stroke({ color: 0xa78bfa, width: 1, alpha: 0.5 });
        this.uiLayer.addChild(pill);

        const txt = new Text({
          text: statusText,
          style: new TextStyle({ fontSize: 13, fill: 0xffffff, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
        });
        txt.anchor.set(0.5, 0.5);
        txt.x = pillX + pillW / 2;
        txt.y = pillY + pillH / 2;
        this.uiLayer.addChild(txt);
      }
    }
  }

  private renderDeckSearchOverlay(state: GameState, ui: UIState): void {
    if (!this.dispatch || !state.pendingSearch) return;
    const d = this.dispatch;
    const hp = ui.humanPlayer;
    const search = state.pendingSearch;

    const overlay = new DeckSearchOverlay(
      state,
      search.owner,
      search.criteria,
      search.validCardIds,
      this.layout,
      (cardId: string | null) => {
        d({
          type: 'PERFORM_ACTION',
          player: hp,
          action: { type: 'search-select', cardInstanceId: cardId },
        });
      },
      search.displayCardIds,
      search.sourceCardName,
      (defId, inst, stats) => this.showCardPreview(defId, inst, stats),
    );
    this.overlayLayer.addChild(overlay);
  }

  private renderEssencePickerOverlay(state: GameState, ui: UIState): void {
    if (!this.dispatch) return;
    const overlay = new EssencePickerOverlay(state, ui, this.layout, this.dispatch);
    this.overlayLayer.addChild(overlay);
  }

  private renderTargetChoiceOverlay(state: GameState, ui: UIState): void {
    if (!this.dispatch || !state.pendingTargetChoice) return;
    const d = this.dispatch;
    const hp = ui.humanPlayer;
    const choice = state.pendingTargetChoice;
    const L = this.layout;

    const container = new Container();

    // Backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, L.width, L.height);
    backdrop.fill({ color: 0x000000, alpha: 0.7 });
    backdrop.eventMode = 'static';
    container.addChild(backdrop);

    // Title
    const title = new Text({
      text: 'CHOOSE TARGET',
      style: new TextStyle({ fontSize: 20, fill: COLORS.accentGold, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 3 }),
    });
    title.anchor.set(0.5, 0);
    title.x = L.width / 2;
    title.y = L.height * 0.15;
    container.addChild(title);

    // Description
    const desc = new Text({
      text: choice.description,
      style: new TextStyle({ fontSize: 14, fill: COLORS.textBright, fontFamily: FONT, wordWrap: true, wordWrapWidth: L.width * 0.6, align: 'center' }),
    });
    desc.anchor.set(0.5, 0);
    desc.x = L.width / 2;
    desc.y = title.y + title.height + 10;
    container.addChild(desc);

    // Render valid target cards — use large size to fill space
    const targetSize = CARD_SIZES.lg;
    const cardW = targetSize.width;
    const cardH = targetSize.height;
    const gap = 16;
    const totalW = choice.validTargetIds.length * cardW + (choice.validTargetIds.length - 1) * gap;
    let curX = L.width / 2 - totalW / 2;
    const cardY = L.height / 2 - cardH / 2;

    for (const targetId of choice.validTargetIds) {
      let def: CardDef | undefined;
      let stats: { lead: number; support: number } | undefined;
      try {
        def = getCardDefForInstance(state, targetId);
        if (def.cardType === 'character') stats = getEffectiveStats(state, targetId);
      } catch { /* skip */ }

      const card = new CardSprite({
        defId: state.cards[targetId]?.defId ?? '',
        size: targetSize,
        faceDown: false,
        cardDef: def,
        instance: state.cards[targetId],
        effectiveStats: stats,
        highlighted: true,
        highlightColor: COLORS.accentGold,
        interactive: true,
        showName: true,
      });
      card.x = curX;
      card.y = cardY;
      card.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
        if (e.button === 2) {
          e.preventDefault?.();
          this.showCardPreview(state.cards[targetId]?.defId ?? '', state.cards[targetId], stats);
          return;
        }
        d({
          type: 'PERFORM_ACTION',
          player: hp,
          action: { type: 'resolve-target-choice', cardInstanceId: targetId },
        });
      });
      container.addChild(card);
      curX += cardW + gap;
    }

    // SKIP button for "you may" effects
    if (choice.allowDecline) {
      const btnW = 100;
      const btnH = 34;
      const btnBg = new Graphics();
      const btnX = L.width / 2 - btnW / 2;
      const btnY = cardY + cardH + 30;
      btnBg.roundRect(btnX, btnY, btnW, btnH, 6);
      btnBg.fill({ color: 0x374151, alpha: 0.9 });
      btnBg.stroke({ color: COLORS.textMuted, width: 1, alpha: 0.3 });
      btnBg.eventMode = 'static';
      btnBg.cursor = 'pointer';
      btnBg.on('pointerdown', () => {
        d({
          type: 'PERFORM_ACTION',
          player: hp,
          action: { type: 'resolve-target-choice', cardInstanceId: null },
        });
      });
      container.addChild(btnBg);

      const btnTxt = new Text({
        text: 'SKIP',
        style: new TextStyle({ fontSize: 14, fill: COLORS.textMuted, fontFamily: FONT, fontWeight: 'bold' }),
      });
      btnTxt.anchor.set(0.5, 0.5);
      btnTxt.x = btnX + btnW / 2;
      btnTxt.y = btnY + btnH / 2;
      container.addChild(btnTxt);
    }

    this.overlayLayer.addChild(container);
  }

  private renderOptionalEffectOverlay(state: GameState, ui: UIState): void {
    if (!this.dispatch || !state.pendingOptionalEffect) return;
    const d = this.dispatch;
    const hp = ui.humanPlayer;
    const pending = state.pendingOptionalEffect;
    const L = this.layout;

    const container = new Container();

    // Backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, L.width, L.height);
    backdrop.fill({ color: 0x000000, alpha: 0.8 });
    backdrop.eventMode = 'static';
    container.addChild(backdrop);

    // Card name title
    const title = new Text({
      text: pending.cardName.toUpperCase(),
      style: new TextStyle({
        fontSize: 22,
        fill: COLORS.accentGold,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 3,
      }),
    });
    title.anchor.set(0.5, 0);
    title.x = L.width / 2;
    title.y = L.height * 0.3;
    container.addChild(title);

    // Effect description
    const desc = new Text({
      text: pending.effectDescription,
      style: new TextStyle({
        fontSize: 16,
        fill: COLORS.textBright,
        fontFamily: FONT,
        wordWrap: true,
        wordWrapWidth: L.width * 0.6,
        align: 'center',
      }),
    });
    desc.anchor.set(0.5, 0);
    desc.x = L.width / 2;
    desc.y = title.y + title.height + 16;
    container.addChild(desc);

    // Buttons
    const btnY = desc.y + desc.height + 30;
    const btnW = 120;
    const btnH = 40;
    const gap = 20;

    // ACTIVATE button (green)
    const activateBtn = new Graphics();
    activateBtn.roundRect(L.width / 2 - btnW - gap / 2, btnY, btnW, btnH, 6);
    activateBtn.fill({ color: 0x22c55e, alpha: 0.9 });
    activateBtn.eventMode = 'static';
    activateBtn.cursor = 'pointer';
    activateBtn.on('pointerdown', () => {
      d({
        type: 'PERFORM_ACTION',
        player: hp,
        action: { type: 'choose-optional-trigger', effectId: pending.effectId, activate: true },
      });
    });
    container.addChild(activateBtn);

    const activateText = new Text({
      text: 'ACTIVATE',
      style: new TextStyle({
        fontSize: 14,
        fill: 0xffffff,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 1,
      }),
    });
    activateText.anchor.set(0.5, 0.5);
    activateText.x = L.width / 2 - btnW / 2 - gap / 2;
    activateText.y = btnY + btnH / 2;
    container.addChild(activateText);

    // DECLINE button (gray)
    const declineBtn = new Graphics();
    declineBtn.roundRect(L.width / 2 + gap / 2, btnY, btnW, btnH, 6);
    declineBtn.fill({ color: 0x4b5563, alpha: 0.9 });
    declineBtn.eventMode = 'static';
    declineBtn.cursor = 'pointer';
    declineBtn.on('pointerdown', () => {
      d({
        type: 'PERFORM_ACTION',
        player: hp,
        action: { type: 'choose-optional-trigger', effectId: pending.effectId, activate: false },
      });
    });
    container.addChild(declineBtn);

    const declineText = new Text({
      text: 'DECLINE',
      style: new TextStyle({
        fontSize: 14,
        fill: 0xffffff,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 1,
      }),
    });
    declineText.anchor.set(0.5, 0.5);
    declineText.x = L.width / 2 + gap / 2 + btnW / 2;
    declineText.y = btnY + btnH / 2;
    container.addChild(declineText);

    // Render on uiLayer (topmost) so UI buttons don't intercept clicks
    this.uiLayer.addChild(container);
  }

  private checkCoinFlip(state: GameState, ui: UIState): void {
    if (this.coinFlipShown) return;
    if (state.turnNumber === 0 && state.phase !== 'setup' && ui.gameStarted) {
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
    const isWin = ui.mode === 'aivai' || state.winner === ui.humanPlayer;
    const accentColor = isWin ? COLORS.accentGold : COLORS.buttonDanger;

    const backdrop = new Graphics();
    backdrop.rect(0, 0, L.width, L.height);
    backdrop.fill({ color: 0x000000, alpha: 0.85 });
    backdrop.eventMode = 'static';
    this.overlayLayer.addChild(backdrop);

    // Content container for animation
    const content = new Container();
    content.x = L.width / 2;
    content.y = L.height / 2;

    // Decorative lines
    const glowLine = new Graphics();
    glowLine.moveTo(-L.width * 0.3, -60);
    glowLine.lineTo(L.width * 0.3, -60);
    glowLine.stroke({ color: accentColor, width: 2, alpha: 0.5 });
    content.addChild(glowLine);

    const glowLine2 = new Graphics();
    glowLine2.moveTo(-L.width * 0.3, 80);
    glowLine2.lineTo(L.width * 0.3, 80);
    glowLine2.stroke({ color: accentColor, width: 2, alpha: 0.5 });
    content.addChild(glowLine2);

    const winnerLabel = ui.mode === 'aivai'
      ? (state.winner === 'player1' ? 'PLAYER 1 WINS' : 'PLAYER 2 WINS')
      : (state.winner === ui.humanPlayer ? 'VICTORY' : 'DEFEAT');

    const title = new Text({
      text: winnerLabel,
      style: STYLES.gameOverTitle(isWin),
    });
    title.anchor.set(0.5, 0.5);
    title.y = -20;
    content.addChild(title);

    const reasonMap: Record<string, string> = { 'battle-rewards': 'Battle Rewards (10+)', 'deck-out': 'Deck Out', 'concede': 'Concession' };
    const reason = new Text({
      text: reasonMap[state.winReason ?? ''] ?? '',
      style: STYLES.gameOverReason,
    });
    reason.anchor.set(0.5, 0.5);
    reason.y = 20;
    content.addChild(reason);

    // Extended stats
    const p1BR = state.players.player1.battleRewards.length;
    const p2BR = state.players.player2.battleRewards.length;
    const p1Deck = state.players.player1.deck.length;
    const p2Deck = state.players.player2.deck.length;
    const statsStr = `Turn ${state.turnNumber}  ·  P1 BR: ${p1BR}/10  ·  P2 BR: ${p2BR}/10  ·  P1 Deck: ${p1Deck}  ·  P2 Deck: ${p2Deck}`;
    const statsTxt = new Text({
      text: statsStr,
      style: STYLES.gameOverStats,
    });
    statsTxt.anchor.set(0.5, 0.5);
    statsTxt.y = 55;
    content.addChild(statsTxt);

    // Animate entrance
    content.alpha = 0;
    content.scale.set(0.8);
    this.overlayLayer.addChild(content);

    const tl = gsap.timeline();
    tl.to(content, { alpha: 1, duration: 0.3, ease: 'power2.out' })
      .to(content.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(1.5)' }, '<');

    // Particle effects
    if (isWin) {
      particleBurst(this.effectsLayer, L.width / 2, L.height / 2, COLORS.accentGold, 30);
      setTimeout(() => particleBurst(this.effectsLayer, L.width / 2 - 80, L.height / 2, COLORS.accentGold, 15), 200);
      setTimeout(() => particleBurst(this.effectsLayer, L.width / 2 + 80, L.height / 2, COLORS.accentGold, 15), 400);
    } else {
      particleBurst(this.effectsLayer, L.width / 2, L.height / 2, COLORS.buttonDanger, 20);
    }
  }

  // ============================================================
  // Card Preview
  // ============================================================

  private showCardPreview(defId: string, instance?: import('@/game/types').CardInstance, effectiveStats?: { lead: number; support: number }): void {
    if (!this.currentGameState) return;
    if (this.previewOverlay) {
      this.closeCardPreview();
      return;
    }
    let def: CardDef | undefined;
    try {
      def = getCardDefForInstance(this.currentGameState, instance?.instanceId ?? defId);
    } catch {
      return;
    }

    this.previewOverlay = new CardPreviewOverlay(def, instance, effectiveStats, this.layout, () => {
      this.closeCardPreview();
    });
    this.overlayLayer.addChild(this.previewOverlay);
  }

  private closeCardPreview(): void {
    if (this.previewOverlay) {
      this.previewOverlay.dispose();
      this.overlayLayer.removeChild(this.previewOverlay);
      this.previewOverlay.destroy({ children: true });
      this.previewOverlay = null;
    }
  }

  private showPileViewer(title: string, cardIds: string[]): void {
    if (!this.currentGameState) return;
    if (this.pileViewerOverlay) {
      this.closePileViewer();
      return;
    }
    this.pileViewerOverlay = new PileViewerOverlay(title, cardIds, this.currentGameState, this.layout, () => {
      this.closePileViewer();
    });
    this.overlayLayer.addChild(this.pileViewerOverlay);
  }

  private closePileViewer(): void {
    if (this.pileViewerOverlay) {
      this.pileViewerOverlay.dispose();
      this.overlayLayer.removeChild(this.pileViewerOverlay);
      this.pileViewerOverlay.destroy({ children: true });
      this.pileViewerOverlay = null;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private makeButton(label: string, w: number, h: number, color: number): Container {
    // Outer wrapper for scale-from-center
    const wrapper = new Container();
    wrapper.eventMode = 'static';
    wrapper.cursor = 'pointer';

    const inner = new Container();

    // Glow behind button (hidden, shown on hover)
    const glowBg = new Graphics();
    glowBg.roundRect(-2, -2, w + 4, h + 4, 6);
    glowBg.stroke({ color, width: 2, alpha: 0.6 });
    glowBg.alpha = 0;
    inner.addChild(glowBg);

    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 4);
    bg.fill({ color, alpha: 0.9 });
    bg.stroke({ color: 0xffffff, width: 1, alpha: 0.1 });
    inner.addChild(bg);
    const txt = new Text({
      text: label,
      style: new TextStyle({ fontSize: 13, fill: COLORS.textBright, fontFamily: FONT, fontWeight: 'bold' }),
    });
    txt.anchor.set(0.5, 0.5);
    txt.x = w / 2;
    txt.y = h / 2;
    inner.addChild(txt);

    // Set pivot for scale-from-center
    inner.pivot.set(w / 2, h / 2);
    inner.x = w / 2;
    inner.y = h / 2;
    wrapper.addChild(inner);

    // Hover effects
    wrapper.on('pointerover', () => {
      gsap.to(inner.scale, { x: TIMING.buttonHoverScale, y: TIMING.buttonHoverScale, duration: TIMING.buttonHoverDuration, ease: 'back.out(2)' });
      gsap.to(glowBg, { alpha: 1, duration: 0.1 });
    });
    wrapper.on('pointerout', () => {
      gsap.to(inner.scale, { x: 1, y: 1, duration: 0.1, ease: 'power2.out' });
      gsap.to(glowBg, { alpha: 0, duration: 0.1 });
    });
    wrapper.on('pointerdown', () => {
      gsap.to(inner.scale, { x: 0.95, y: 0.95, duration: 0.06, ease: 'power2.out' });
    });
    wrapper.on('pointerup', () => {
      gsap.to(inner.scale, { x: TIMING.buttonHoverScale, y: TIMING.buttonHoverScale, duration: 0.1, ease: 'back.out(2)' });
    });
    wrapper.on('pointerupoutside', () => {
      gsap.to(inner.scale, { x: 1, y: 1, duration: 0.1 });
      gsap.to(glowBg, { alpha: 0, duration: 0.1 });
    });

    return wrapper;
  }

  destroy(): void {
    if (this.narrationOverlay) {
      this.narrationOverlay.clear();
    }
    if (this.initialized) {
      this.app.destroy(true);
    }
  }
}
