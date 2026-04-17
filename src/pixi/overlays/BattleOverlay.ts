// ============================================================
// Primal TCG — Battle Overlay (PixiJS)
// ============================================================
// Full-screen overlay during battle phases: attack, block, eoa, showdown.
// Handles blocker assignment (block phase) and showdown ordering.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';
import { CardSprite } from '../CardSprite';
import { COLORS, CARD_SIZES, BoardLayout, CardSize } from '../layout';
import { FONT } from '../SharedStyles';
import type { GameState, PlayerId, CardDef, Team } from '@/game/types';
import type { UIState, UIAction } from '@/hooks/useGameEngine';
import {
  getCardDefForInstance,
  getEffectiveStats,
  calculateTeamPower,
  getLegalActions,
  getOpponent,
} from '@/game/engine';
import { getActingPlayer } from '@/lib/gameHelpers';
import { PHASE_LABELS } from '@/lib/constants';

// Use the engine's calculateTeamPower for accurate power computation
// (including stat modifiers, counters, etc.)
function safeCalculateTeamPower(state: GameState, team: Team): number {
  try {
    return calculateTeamPower(state, team);
  } catch {
    return 0;
  }
}

interface Matchup {
  attackingTeamId: string;
  attackingPower: number;
  blockingTeamId: string | null;
  blockingPower: number;
  attackerOwner: PlayerId;
}

export class BattleOverlay extends Container {
  private blockerAssignments: Record<string, string> = {};
  private selectedBlockerTeamId: string | null = null;
  private showdownOrder: string[] = [];

  private chainGrew: boolean;

  constructor(
    state: GameState,
    ui: UIState,
    layout: BoardLayout,
    dispatch: (action: UIAction) => void,
    chainGrew = false,
  ) {
    super();
    this.chainGrew = chainGrew;

    const phase = state.phase;
    // Phase accent color
    const phaseColor =
      phase === 'battle-attack' ? 0xef4444 :
      phase === 'battle-block' ? 0x3b82f6 :
      phase === 'battle-showdown' ? 0xf59e0b :
      0x8b5cf6;

    // Deep backdrop — visual fill covers full screen, event blocker is shorter
    // during EOA so hand cards beneath remain clickable for playing abilities
    const isEOAPhase = phase === 'battle-eoa';
    const backdropH = layout.height;
    const backdrop = new Graphics();
    backdrop.rect(0, 0, layout.width, backdropH);
    backdrop.fill({ color: 0x050a14, alpha: 0.88 });
    backdrop.eventMode = 'none'; // Visual only — doesn't block clicks
    this.addChild(backdrop);

    // Event blocker — captures clicks to prevent board interaction
    // During EOA, only block the upper portion so hand area stays interactive
    const eventBlocker = new Graphics();
    const blockerH = isEOAPhase ? layout.playerY + 20 : layout.height;
    eventBlocker.rect(0, 0, layout.width, blockerH);
    eventBlocker.fill({ color: 0x000000, alpha: 0.001 });
    eventBlocker.eventMode = 'static';
    this.addChild(eventBlocker);

    // Radial glow using phaseColor
    const glow = new Graphics();
    const glowR = Math.min(layout.width, backdropH) * 0.4;
    glow.circle(layout.width / 2, backdropH * 0.45, glowR);
    glow.fill({ color: phaseColor, alpha: 0.03 });
    this.addChild(glow);

    // Floating ambient particles (added before rebuild so they persist)
    const particleCount = 8;
    for (let p = 0; p < particleCount; p++) {
      const particle = new Graphics();
      const px = Math.random() * layout.width;
      const py = Math.random() * backdropH;
      const pr = 1 + Math.random() * 1.5;
      particle.circle(0, 0, pr);
      particle.fill({ color: phaseColor, alpha: 0.12 + Math.random() * 0.1 });
      particle.x = px;
      particle.y = py;
      this.addChild(particle);

      gsap.to(particle, {
        y: py - 30 - Math.random() * 40,
        alpha: 0,
        duration: 3 + Math.random() * 4,
        repeat: -1,
        ease: 'none',
        onRepeat: () => {
          particle.x = Math.random() * layout.width;
          particle.y = backdropH + 10;
          particle.alpha = 0.12 + Math.random() * 0.1;
        },
      });
    }

    // Static children: backdrop(1) + eventBlocker(1) + glow(1) + particles(8) = 11
    const staticChildCount = 3 + particleCount;

    // Rebuild closure for local state changes
    const rebuild = () => {
      while (this.children.length > staticChildCount) {
        this.removeChildAt(staticChildCount);
      }
      this.renderContent(state, ui, layout, dispatch, rebuild);
    };

    rebuild();

    // Slide-in animation from right
    this.alpha = 0;
    gsap.to(this, { alpha: 1, duration: 0.2, ease: 'power2.out' });
  }

  private renderContent(
    state: GameState,
    ui: UIState,
    layout: BoardLayout,
    dispatch: (action: UIAction) => void,
    rebuild: () => void,
  ): void {
    const humanPlayer = ui.humanPlayer;
    const phase = state.phase;
    const actingPlayer = getActingPlayer(state);
    const isMyTurn = actingPlayer === humanPlayer;
    const legalActions = getLegalActions(state, humanPlayer);
    const cardSize = CARD_SIZES.md;

    const allTeams = Object.values(state.teams);
    const attackingTeams = allTeams.filter((t) => t.isAttacking);
    const blockingTeams = allTeams.filter((t) => t.isBlocking);

    // Build matchups
    const matchups: Matchup[] = [];
    for (const atkTeam of attackingTeams) {
      const blockingTeam = blockingTeams.find((bt) => bt.blockingTeamId === atkTeam.id);
      let atkPower = 0;
      try { atkPower = calculateTeamPower(state, atkTeam); } catch { /* skip */ }
      let blkPower = 0;
      if (blockingTeam) {
        try { blkPower = calculateTeamPower(state, blockingTeam); } catch { /* skip */ }
      }
      matchups.push({
        attackingTeamId: atkTeam.id,
        attackingPower: atkPower,
        blockingTeamId: blockingTeam?.id ?? null,
        blockingPower: blkPower,
        attackerOwner: atkTeam.owner,
      });
    }

    const isBlock = phase === 'battle-block';
    const isEOA = phase === 'battle-eoa';
    const isShowdown = phase === 'battle-showdown';
    const isDefender = isBlock && isMyTurn && legalActions.includes('select-blockers');

    const availableBlockerTeams = allTeams.filter(
      (t) => t.owner === humanPlayer && !t.isAttacking && !t.isBlocking,
    );


    const canChooseOrder = isShowdown && isMyTurn && legalActions.includes('choose-showdown-order');
    const myAttackingTeamIds = matchups
      .filter((m) => m.attackerOwner === humanPlayer)
      .map((m) => m.attackingTeamId);
    const needsOrdering = canChooseOrder && myAttackingTeamIds.length > 1;

    // Phase accent color
    const phaseColor =
      phase === 'battle-attack' ? 0xef4444 :
      phase === 'battle-block' ? 0x3b82f6 :
      phase === 'battle-showdown' ? 0xf59e0b :
      0x8b5cf6;

    // --- Content container (centered vertically) ---
    const content = new Container();
    let cy = 0;

    // Top decorative line
    const topLineW = layout.width * 0.35;
    const topLine = new Graphics();
    topLine.moveTo(layout.width / 2 - topLineW / 2, cy);
    topLine.lineTo(layout.width / 2 + topLineW / 2, cy);
    topLine.stroke({ color: phaseColor, width: 1, alpha: 0.3 });
    content.addChild(topLine);
    cy += 14;

    // Header
    const phaseText = PHASE_LABELS[phase] ?? phase;
    const header = new Text({
      text: phaseText.toUpperCase(),
      style: new TextStyle({
        fontSize: 30,
        fill: phaseColor,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 8,
      }),
    });
    header.anchor.set(0.5, 0);
    header.x = layout.width / 2;
    header.y = cy;
    content.addChild(header);

    // Header accent lines
    for (const offsetX of [-1, 1]) {
      const line = new Graphics();
      const lx = layout.width / 2 + offsetX * (header.width / 2 + 20);
      line.moveTo(lx, cy + 16);
      line.lineTo(lx + offsetX * 50, cy + 16);
      line.stroke({ color: phaseColor, width: 2, alpha: 0.4 });
      content.addChild(line);
    }
    cy += 40;

    // Hint text
    let hintText = '';
    if (needsOrdering) {
      hintText = `Tap matchups to choose resolution order (${this.showdownOrder.length}/${myAttackingTeamIds.length})`;
    } else if (isDefender) {
      if (attackingTeams.length === 1) {
        hintText = 'Tap one of your teams below to assign as blocker';
      } else if (this.selectedBlockerTeamId) {
        hintText = 'Now tap an attacking team to assign the block';
      } else {
        hintText = 'Select one of your teams below, then tap an attacker to block';
      }
    }

    // EOA priority hints
    if (isEOA && !hintText) {
      if (isMyTurn) {
        hintText = 'YOUR PRIORITY — Play an ability or pass';
      } else {
        hintText = 'OPPONENT IS DECIDING';
      }
    }

    if (hintText) {
      const hint = new Text({
        text: hintText,
        style: new TextStyle({ fontSize: 14, fill: isEOA && isMyTurn ? 0x22d3ee : COLORS.textMuted, fontFamily: FONT, fontWeight: isEOA ? 'bold' : 'normal' }),
      });
      hint.anchor.set(0.5, 0);
      hint.x = layout.width / 2;
      hint.y = cy;
      content.addChild(hint);

      // Pulsing dots when waiting for opponent during EOA
      if (isEOA && !isMyTurn) {
        for (let di = 0; di < 3; di++) {
          const dot = new Graphics();
          dot.circle(0, 0, 3);
          dot.fill({ color: COLORS.textMuted });
          dot.x = hint.x + hint.width / 2 + 12 + di * 10;
          dot.y = cy + 8;
          dot.alpha = 0.3;
          content.addChild(dot);
          gsap.to(dot, {
            alpha: 1, duration: 0.5, repeat: -1, yoyo: true,
            delay: di * 0.15, ease: 'sine.inOut',
          });
        }
      }

      cy += 26;
    }

    cy += 8;

    // ---- Matchup Panels ----
    const matchupGap = 20;
    const maxMatchupW = 480;
    const matchupW = Math.min(
      maxMatchupW,
      (layout.width - 80 - matchupGap * (matchups.length - 1)) / Math.max(matchups.length, 1),
    );
    const totalMatchupW = matchups.length * matchupW + (matchups.length - 1) * matchupGap;
    const matchupStartX = (layout.width - totalMatchupW) / 2;
    const matchupY = cy;

    // Calculate panel height based on actual content
    // pyramidCardH accounts for stacked teams (leader + supports offset 65% below)
    const pyramidCardH = Math.ceil(cardSize.height * 1.65);
    const vsBarH = 36;
    const panelH = 20 + pyramidCardH + vsBarH + 20 + pyramidCardH + 24 + (isShowdown ? 26 : 0);

    for (let mi = 0; mi < matchups.length; mi++) {
      const matchup = matchups[mi];
      const mx = matchupStartX + mi * (matchupW + matchupGap);

      const assignedBlockerId = isDefender
        ? Object.entries(this.blockerAssignments).find(([, atkId]) => atkId === matchup.attackingTeamId)?.[0] ?? null
        : matchup.blockingTeamId;

      const assignedBlockerPower = assignedBlockerId && state.teams[assignedBlockerId]
        ? safeCalculateTeamPower(state, state.teams[assignedBlockerId])
        : (matchup.blockingTeamId ? matchup.blockingPower : 0);

      const isPlayerAttacker = matchup.attackerOwner === humanPlayer;
      const orderIndex = this.showdownOrder.indexOf(matchup.attackingTeamId);
      const isOrdered = orderIndex !== -1;

      // Showdown winner prediction
      const hasBlocker = !!matchup.blockingTeamId;
      const atkWins = hasBlocker ? matchup.attackingPower > matchup.blockingPower : true;
      const blkWins = hasBlocker ? matchup.blockingPower > matchup.attackingPower : false;
      const winnerGlowColor = isShowdown ? (atkWins ? 0xef4444 : blkWins ? 0x3b82f6 : 0) : 0;

      // Panel outer glow — enhanced during showdown for winner
      const panelGlow = new Graphics();
      panelGlow.roundRect(mx - 3, matchupY - 3, matchupW + 6, panelH + 6, 12);
      if (isShowdown && winnerGlowColor) {
        panelGlow.stroke({ color: winnerGlowColor, width: 2, alpha: 0.3 });
      } else {
        panelGlow.stroke({ color: phaseColor, width: 1, alpha: 0.08 });
      }
      content.addChild(panelGlow);

      // Panel background
      const panel = new Graphics();
      panel.roundRect(mx, matchupY, matchupW, panelH, 10);
      const panelBorderColor = isOrdered ? 0xf59e0b : phaseColor;
      panel.fill({ color: 0x0f1729, alpha: 0.9 });
      panel.stroke({ color: panelBorderColor, width: isOrdered ? 2 : 1, alpha: isOrdered ? 0.6 : 0.15 });

      // Colored side accent bars — red left (attack), blue right (block)
      const accentW = 4;
      const accentInset = 8;
      const atkAccent = new Graphics();
      atkAccent.roundRect(mx + accentInset, matchupY + accentInset, accentW, panelH - accentInset * 2, 2);
      atkAccent.fill({ color: 0xef4444, alpha: 0.5 });
      content.addChild(atkAccent);
      const blkAccent = new Graphics();
      blkAccent.roundRect(mx + matchupW - accentInset - accentW, matchupY + accentInset, accentW, panelH - accentInset * 2, 2);
      blkAccent.fill({ color: 0x3b82f6, alpha: 0.5 });
      content.addChild(blkAccent);

      // Click handlers
      if (needsOrdering && isPlayerAttacker) {
        panel.eventMode = 'static';
        panel.cursor = 'pointer';
        panel.on('pointerdown', () => {
          const idx = this.showdownOrder.indexOf(matchup.attackingTeamId);
          if (idx !== -1) {
            this.showdownOrder.splice(idx, 1);
          } else {
            this.showdownOrder.push(matchup.attackingTeamId);
          }
          rebuild();
        });
      } else if (isDefender && this.selectedBlockerTeamId) {
        panel.eventMode = 'static';
        panel.cursor = 'pointer';
        panel.on('pointerdown', () => {
          this.assignBlockerToAttacker(matchup.attackingTeamId, rebuild);
        });
      }
      content.addChild(panel);

      // Order badge
      if (needsOrdering && isPlayerAttacker && isOrdered) {
        const badge = new Graphics();
        badge.circle(mx + 14, matchupY + 14, 12);
        badge.fill({ color: 0xf59e0b });
        content.addChild(badge);
        const badgeTxt = new Text({
          text: `${orderIndex + 1}`,
          style: new TextStyle({ fontSize: 12, fill: 0x000000, fontFamily: FONT, fontWeight: 'bold' }),
        });
        badgeTxt.anchor.set(0.5, 0.5);
        badgeTxt.x = mx + 14;
        badgeTxt.y = matchupY + 14;
        content.addChild(badgeTxt);
      }

      const contentX = mx + 14;
      const contentW = matchupW - 28;
      let pcy = matchupY + 14;

      // --- Opponent side (top half of panel) ---
      const opponentTeamId = isPlayerAttacker ? assignedBlockerId : matchup.attackingTeamId;
      const opponentLabel = isPlayerAttacker
        ? (assignedBlockerId ? 'BLOCKING' : null)
        : 'ATTACKING';
      const opponentLabelColor = isPlayerAttacker ? 0x60a5fa : 0xef4444;

      if (opponentTeamId && state.teams[opponentTeamId]) {
        if (opponentLabel) {
          // Role pill badge
          const pillW = 90;
          const pillH = 18;
          const pillX = mx + matchupW / 2 - pillW / 2;
          const roleIcon = isPlayerAttacker ? '\u{1F6E1}' : '\u2694';
          const rolePill = new Graphics();
          rolePill.roundRect(pillX, pcy, pillW, pillH, pillH / 2);
          rolePill.fill({ color: opponentLabelColor, alpha: 0.15 });
          rolePill.stroke({ color: opponentLabelColor, width: 1, alpha: 0.4 });
          content.addChild(rolePill);
          const lbl = new Text({
            text: `${roleIcon} ${opponentLabel}`,
            style: new TextStyle({ fontSize: 10, fill: opponentLabelColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
          });
          lbl.anchor.set(0.5, 0.5);
          lbl.x = mx + matchupW / 2;
          lbl.y = pcy + pillH / 2;
          content.addChild(lbl);
          pcy += 22;
        }
        pcy = this.renderTeamCards(content, state, state.teams[opponentTeamId], contentX, pcy, contentW, cardSize);
      } else if (isPlayerAttacker) {
        // Unblocked placeholder with dashed outline
        const placeholderBg = new Graphics();
        placeholderBg.roundRect(contentX, pcy, contentW, cardSize.height, 6);
        placeholderBg.fill({ color: 0x111827, alpha: 0.5 });
        placeholderBg.stroke({ color: 0x1e293b, width: 1, alpha: 0.3 });
        content.addChild(placeholderBg);

        // Dashed outline pill for "UNBLOCKED"
        const ubPillW = 110;
        const ubPillH = 22;
        const ubPillX = mx + matchupW / 2 - ubPillW / 2;
        const ubPillY = pcy + cardSize.height / 2 - ubPillH / 2 - 6;
        const ubPill = new Graphics();
        ubPill.roundRect(ubPillX, ubPillY, ubPillW, ubPillH, ubPillH / 2);
        ubPill.stroke({ color: COLORS.textMuted, width: 1, alpha: 0.4 });
        content.addChild(ubPill);

        const unblockedLabel = isDefender ? 'TAP TO ASSIGN' : '\u2014 UNBLOCKED';
        const unblockedTxt = new Text({
          text: unblockedLabel,
          style: new TextStyle({ fontSize: 10, fill: COLORS.textMuted, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
        });
        unblockedTxt.anchor.set(0.5, 0.5);
        unblockedTxt.x = mx + matchupW / 2;
        unblockedTxt.y = ubPillY + ubPillH / 2;
        content.addChild(unblockedTxt);

        if (isDefender) {
          const tapHint = new Text({
            text: 'Select a team below first',
            style: new TextStyle({ fontSize: 10, fill: COLORS.textMuted, fontFamily: FONT, fontStyle: 'italic' }),
          });
          tapHint.anchor.set(0.5, 0.5);
          tapHint.x = mx + matchupW / 2;
          tapHint.y = ubPillY + ubPillH + 12;
          content.addChild(tapHint);
        }

        pcy += cardSize.height + 4;
      }

      // --- VS power comparison bar ---
      pcy += 4;
      const vsY = pcy;
      const vsCenterY = vsY + vsBarH / 2;

      // VS divider line
      const vsDivider = new Graphics();
      vsDivider.moveTo(mx + 16, vsCenterY);
      vsDivider.lineTo(mx + matchupW - 16, vsCenterY);
      vsDivider.stroke({ color: phaseColor, width: 2, alpha: 0.2 });
      content.addChild(vsDivider);

      const atkPowerTxt = new Text({
        text: `${matchup.attackingPower}`,
        style: new TextStyle({ fontSize: 30, fill: 0xf87171, fontFamily: FONT, fontWeight: 'bold' }),
      });
      atkPowerTxt.anchor.set(1, 0.5);
      atkPowerTxt.x = mx + matchupW / 2 - 30;
      atkPowerTxt.y = vsCenterY;
      content.addChild(atkPowerTxt);

      const atkLabel = new Text({
        text: 'ATK',
        style: new TextStyle({ fontSize: 10, fill: COLORS.textMuted, fontFamily: FONT, fontWeight: 'bold' }),
      });
      atkLabel.anchor.set(1, 0.5);
      atkLabel.x = atkPowerTxt.x - atkPowerTxt.width - 4;
      atkLabel.y = vsCenterY;
      content.addChild(atkLabel);

      const vsCircle = new Graphics();
      vsCircle.circle(mx + matchupW / 2, vsCenterY, 20);
      vsCircle.fill({ color: phaseColor, alpha: 0.12 });
      vsCircle.stroke({ color: phaseColor, width: 1, alpha: 0.35 });
      content.addChild(vsCircle);

      const vsTxt = new Text({
        text: 'VS',
        style: new TextStyle({ fontSize: 13, fill: COLORS.text, fontFamily: FONT, fontWeight: 'bold' }),
      });
      vsTxt.anchor.set(0.5, 0.5);
      vsTxt.x = mx + matchupW / 2;
      vsTxt.y = vsCenterY;
      content.addChild(vsTxt);

      const blkPowerTxt = new Text({
        text: assignedBlockerId ? `${assignedBlockerPower}` : '—',
        style: new TextStyle({ fontSize: 30, fill: 0x60a5fa, fontFamily: FONT, fontWeight: 'bold' }),
      });
      blkPowerTxt.anchor.set(0, 0.5);
      blkPowerTxt.x = mx + matchupW / 2 + 30;
      blkPowerTxt.y = vsCenterY;
      content.addChild(blkPowerTxt);

      const blkLabel = new Text({
        text: 'DEF',
        style: new TextStyle({ fontSize: 10, fill: COLORS.textMuted, fontFamily: FONT, fontWeight: 'bold' }),
      });
      blkLabel.anchor.set(0, 0.5);
      blkLabel.x = blkPowerTxt.x + blkPowerTxt.width + 4;
      blkLabel.y = vsCenterY;
      content.addChild(blkLabel);

      pcy = vsY + vsBarH;

      // --- Player side (bottom half of panel) ---
      const playerTeamId = isPlayerAttacker ? matchup.attackingTeamId : assignedBlockerId;
      const playerLabel = isPlayerAttacker ? 'ATTACKING' : (assignedBlockerId ? 'BLOCKING' : null);
      const playerLabelColor = isPlayerAttacker ? 0xef4444 : 0x60a5fa;

      if (playerTeamId && state.teams[playerTeamId]) {
        if (playerLabel) {
          // Role pill badge
          const pillW = 90;
          const pillH = 18;
          const pillX = mx + matchupW / 2 - pillW / 2;
          const roleIcon = isPlayerAttacker ? '\u2694' : '\u{1F6E1}';
          const rolePill = new Graphics();
          rolePill.roundRect(pillX, pcy, pillW, pillH, pillH / 2);
          rolePill.fill({ color: playerLabelColor, alpha: 0.15 });
          rolePill.stroke({ color: playerLabelColor, width: 1, alpha: 0.4 });
          content.addChild(rolePill);
          const lbl = new Text({
            text: `${roleIcon} ${playerLabel}`,
            style: new TextStyle({ fontSize: 10, fill: playerLabelColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
          });
          lbl.anchor.set(0.5, 0.5);
          lbl.x = mx + matchupW / 2;
          lbl.y = pcy + pillH / 2;
          content.addChild(lbl);
          pcy += 22;
        }
        this.renderTeamCards(content, state, state.teams[playerTeamId], contentX, pcy, contentW, cardSize);
      }

      // Showdown result prediction (uses atkWins/blkWins computed above)
      if (isShowdown) {
        const stalemate = hasBlocker ? matchup.attackingPower === matchup.blockingPower : false;
        const resultLabel = atkWins ? 'ATTACKER WINS' : blkWins ? 'BLOCKER WINS' : stalemate ? 'STALEMATE' : 'UNBLOCKED';
        const resultColor = atkWins ? 0xef4444 : blkWins ? 0x3b82f6 : COLORS.textMuted;

        // Glow bg pill behind result text
        const pillW = 150;
        const pillH = 24;
        const pillX = mx + matchupW / 2 - pillW / 2;
        const pillY = matchupY + panelH - 10 - pillH;
        const resultPill = new Graphics();
        resultPill.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
        resultPill.fill({ color: resultColor, alpha: 0.15 });
        resultPill.stroke({ color: resultColor, width: 1, alpha: 0.3 });
        content.addChild(resultPill);

        const resultTxt = new Text({
          text: resultLabel,
          style: new TextStyle({ fontSize: 12, fill: resultColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
        });
        resultTxt.anchor.set(0.5, 0.5);
        resultTxt.x = mx + matchupW / 2;
        resultTxt.y = pillY + pillH / 2;
        content.addChild(resultTxt);
      }
    }

    cy = matchupY + panelH + 20;

    // ---- Chain Activity Feed (EOA phase) ----
    if (isEOA && state.chain.length > 0) {
      // Divider
      const chainDivider = new Graphics();
      chainDivider.moveTo(layout.width * 0.15, cy);
      chainDivider.lineTo(layout.width * 0.85, cy);
      chainDivider.stroke({ color: phaseColor, width: 1, alpha: 0.2 });
      content.addChild(chainDivider);
      cy += 12;

      // Section label
      const chainLabel = new Text({
        text: 'CHAIN',
        style: new TextStyle({ fontSize: 13, fill: phaseColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 3 }),
      });
      chainLabel.anchor.set(0.5, 0);
      chainLabel.x = layout.width / 2;
      chainLabel.y = cy;
      content.addChild(chainLabel);
      cy += 22;

      // Feed entries — visual card-based layout
      const feedW = Math.min(540, layout.width - 40);
      const feedX = (layout.width - feedW) / 2;
      const miniSize = CARD_SIZES.sm;
      const rowH = miniSize.height + 20; // card height + padding

      for (let ci = 0; ci < state.chain.length; ci++) {
        const entry = state.chain[ci];
        const rowY = cy;

        const isNewest = ci === state.chain.length - 1;
        const isUnresolved = !entry.resolved && !entry.negated;
        const isPlayerOwned = entry.owner === humanPlayer;

        // Row container for slide animation
        const rowContainer = new Container();
        content.addChild(rowContainer);

        // Row background
        const rowBg = new Graphics();
        rowBg.roundRect(feedX, rowY, feedW, rowH, 6);
        rowBg.fill({ color: isUnresolved ? phaseColor : 0xffffff, alpha: isUnresolved ? 0.08 : 0.04 });
        if (isUnresolved) {
          rowBg.stroke({ color: phaseColor, width: 1, alpha: 0.15 });
        }
        rowContainer.addChild(rowBg);

        // Slide newest entry in from left
        if (isNewest && this.chainGrew) {
          rowContainer.x = -120;
          rowContainer.alpha = 0;
          gsap.to(rowContainer, { x: 0, alpha: 1, duration: 0.3, ease: 'back.out(1.2)' });
        }
        if (isUnresolved) {
          gsap.to(rowBg, { alpha: 0.03, duration: 0.8, repeat: -1, yoyo: true, ease: 'sine.inOut' });
        }

        const rowMidY = rowY + rowH / 2;
        let rx = feedX + 10;

        // Owner pill (YOU / OPP)
        const ownerLabel = isPlayerOwned ? 'YOU' : 'OPP';
        const ownerColor = isPlayerOwned ? COLORS.player1Color : COLORS.player2Color;
        const ownerPillW = 36;
        const ownerPillH = 16;
        const ownerPill = new Graphics();
        ownerPill.roundRect(rx, rowMidY - ownerPillH / 2, ownerPillW, ownerPillH, ownerPillH / 2);
        ownerPill.fill({ color: ownerColor, alpha: 0.2 });
        ownerPill.stroke({ color: ownerColor, width: 1, alpha: 0.4 });
        rowContainer.addChild(ownerPill);
        const ownerTxt = new Text({
          text: ownerLabel,
          style: new TextStyle({ fontSize: 9, fill: ownerColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
        });
        ownerTxt.anchor.set(0.5, 0.5);
        ownerTxt.x = rx + ownerPillW / 2;
        ownerTxt.y = rowMidY;
        rowContainer.addChild(ownerTxt);
        rx += ownerPillW + 8;

        // --- User character mini card ---
        if (entry.userId) {
          const userInst = state.cards[entry.userId];
          if (userInst) {
            let userDef: CardDef | undefined;
            let userStats: { lead: number; support: number } | undefined;
            try {
              userDef = getCardDefForInstance(state, entry.userId);
              userStats = getEffectiveStats(state, entry.userId);
            } catch { /* skip */ }

            const userCard = new CardSprite({
              defId: userInst.defId,
              size: miniSize,
              cardDef: userDef,
              instance: userInst,
              effectiveStats: userStats,
            });
            userCard.eventMode = 'none';
            userCard.x = rx;
            userCard.y = rowY + 8;
            rowContainer.addChild(userCard);

            // "USER" label under card
            const userLabel = new Text({
              text: 'USER',
              style: new TextStyle({ fontSize: 10, fill: 0x22d3ee, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
            });
            userLabel.anchor.set(0.5, 0);
            userLabel.x = rx + miniSize.width / 2;
            userLabel.y = rowY + 8 + miniSize.height + 1;
            rowContainer.addChild(userLabel);
          }
          rx += miniSize.width + 8;
        }

        // --- Ability name (center, large) ---
        let abilityName = '???';
        try {
          const abilityDef = getCardDefForInstance(state, entry.sourceCardInstanceId);
          abilityName = abilityDef.name;
        } catch { /* skip */ }

        const nameTxt = new Text({
          text: abilityName,
          style: new TextStyle({ fontSize: 14, fill: phaseColor, fontFamily: FONT, fontWeight: 'bold' }),
        });
        nameTxt.anchor.set(0, 0.5);
        nameTxt.x = rx;
        nameTxt.y = rowMidY - 6;
        rowContainer.addChild(nameTxt);

        // Entry number badge
        const numBadge = new Graphics();
        const numBadgeR = 8;
        numBadge.circle(rx + nameTxt.width + 8 + numBadgeR, rowMidY - 6, numBadgeR);
        numBadge.fill({ color: phaseColor, alpha: 0.15 });
        rowContainer.addChild(numBadge);
        const numTxt = new Text({
          text: `${ci + 1}`,
          style: new TextStyle({ fontSize: 9, fill: phaseColor, fontFamily: FONT, fontWeight: 'bold' }),
        });
        numTxt.anchor.set(0.5, 0.5);
        numTxt.x = rx + nameTxt.width + 8 + numBadgeR;
        numTxt.y = rowMidY - 6;
        rowContainer.addChild(numTxt);

        // Status badge under ability name
        if (entry.resolved || entry.negated) {
          const statusLabel = entry.resolved ? 'RESOLVED' : 'NEGATED';
          const statusColor = entry.resolved ? COLORS.textMuted : 0xef4444;
          const statusTxt = new Text({
            text: statusLabel,
            style: new TextStyle({ fontSize: 9, fill: statusColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
          });
          statusTxt.anchor.set(0, 0);
          statusTxt.x = rx;
          statusTxt.y = rowMidY + 2;
          rowContainer.addChild(statusTxt);
        }

        // --- Arrow + Target card(s) on right side ---
        const targetIds = entry.targetIds ?? [];
        if (targetIds.length > 0) {
          // Position targets from right edge
          let tx = feedX + feedW - 10;

          // Render targets right-to-left
          for (let ti = targetIds.length - 1; ti >= 0; ti--) {
            const tid = targetIds[ti];
            const targetInst = state.cards[tid];
            if (!targetInst) continue;

            let targetDef: CardDef | undefined;
            let targetStats: { lead: number; support: number } | undefined;
            try {
              targetDef = getCardDefForInstance(state, tid);
              targetStats = getEffectiveStats(state, tid);
            } catch { /* skip */ }

            tx -= miniSize.width;
            const targetCard = new CardSprite({
              defId: targetInst.defId,
              size: miniSize,
              cardDef: targetDef,
              instance: targetInst,
              effectiveStats: targetStats,
            });
            targetCard.eventMode = 'none';
            targetCard.x = tx;
            targetCard.y = rowY + 8;
            rowContainer.addChild(targetCard);

            if (ti > 0) tx -= 4;
          }

          // "TARGET" label under rightmost target
          const targetLabel = new Text({
            text: 'TARGET',
            style: new TextStyle({ fontSize: 10, fill: 0xf87171, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
          });
          targetLabel.anchor.set(0.5, 0);
          targetLabel.x = feedX + feedW - 10 - miniSize.width / 2;
          targetLabel.y = rowY + 8 + miniSize.height + 1;
          rowContainer.addChild(targetLabel);

          // Arrow between ability name and targets
          const arrowX = tx - 16;
          const arrowTxt = new Text({
            text: '\u2192',
            style: new TextStyle({ fontSize: 18, fill: phaseColor, fontFamily: FONT, fontWeight: 'bold' }),
          });
          arrowTxt.anchor.set(0.5, 0.5);
          arrowTxt.x = arrowX;
          arrowTxt.y = rowMidY;
          rowContainer.addChild(arrowTxt);
        }

        cy += rowH + 4;
      }

      cy += 10;
    }

    // ---- Chain summary during showdown ----
    if (isShowdown && state.chain.length > 0) {
      const summaryTxt = new Text({
        text: `${state.chain.length} ${state.chain.length === 1 ? 'ability was' : 'abilities were'} played`,
        style: new TextStyle({ fontSize: 12, fill: COLORS.textMuted, fontFamily: FONT, fontStyle: 'italic' }),
      });
      summaryTxt.anchor.set(0.5, 0);
      summaryTxt.x = layout.width / 2;
      summaryTxt.y = cy;
      content.addChild(summaryTxt);
      cy += 22;
    }

    // ---- Available Blockers Section (block phase, defender only) ----
    const assignedBlockerIds = new Set(Object.keys(this.blockerAssignments));
    const unassignedBlockerTeams = availableBlockerTeams.filter((t) => !assignedBlockerIds.has(t.id));

    if (isDefender && unassignedBlockerTeams.length > 0) {
      const divider = new Graphics();
      divider.moveTo(layout.width * 0.15, cy);
      divider.lineTo(layout.width * 0.85, cy);
      divider.stroke({ color: phaseColor, width: 1, alpha: 0.2 });
      content.addChild(divider);
      cy += 12;

      const blockerLabel = new Text({
        text: 'YOUR AVAILABLE TEAMS',
        style: new TextStyle({ fontSize: 13, fill: 0x60a5fa, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 3 }),
      });
      blockerLabel.anchor.set(0.5, 0);
      blockerLabel.x = layout.width / 2;
      blockerLabel.y = cy;
      content.addChild(blockerLabel);
      cy += 22;

      const teamCardSize = CARD_SIZES.md;
      const teamGap = 14;
      const teamPanelW = 170;
      const teamPanelH = teamCardSize.height + 30;
      const teamsW = unassignedBlockerTeams.length * teamPanelW + (unassignedBlockerTeams.length - 1) * teamGap;
      let teamStartX = (layout.width - teamsW) / 2;

      for (const team of unassignedBlockerTeams) {
        const isSelected = this.selectedBlockerTeamId === team.id;
        const teamPower = safeCalculateTeamPower(state, team);

        const teamPanel = new Graphics();
        teamPanel.roundRect(teamStartX, cy, teamPanelW, teamPanelH, 8);
        teamPanel.fill({ color: isSelected ? 0x1e3a5f : 0x111827, alpha: 0.9 });
        teamPanel.stroke({ color: isSelected ? 0x3b82f6 : 0x1e293b, width: isSelected ? 2 : 1, alpha: isSelected ? 1 : 0.5 });
        teamPanel.eventMode = 'static';
        teamPanel.cursor = 'pointer';
        teamPanel.on('pointerdown', () => {
          this.handleSelectBlockerTeam(team.id, attackingTeams, rebuild);
        });
        content.addChild(teamPanel);

        // Render team characters
        const chars = team.characterIds;
        const charGap = 4;
        const charsW = chars.length * teamCardSize.width + (chars.length - 1) * charGap;
        let charX = teamStartX + (teamPanelW - charsW) / 2;

        for (const cid of chars) {
          const inst = state.cards[cid];
          if (!inst) continue;
          let def: CardDef | undefined;
          let stats: { lead: number; support: number } | undefined;
          try { def = getCardDefForInstance(state, cid); stats = getEffectiveStats(state, cid); } catch { /* skip */ }

          const card = new CardSprite({ defId: inst.defId, size: teamCardSize, cardDef: def, instance: inst, effectiveStats: stats });
          card.eventMode = 'none';
          card.x = charX;
          card.y = cy + 6;
          content.addChild(card);
          charX += teamCardSize.width + charGap;
        }

        // Power label
        const pwrTxt = new Text({
          text: `PWR ${teamPower}`,
          style: new TextStyle({ fontSize: 10, fill: 0x60a5fa, fontFamily: FONT, fontWeight: 'bold' }),
        });
        pwrTxt.anchor.set(0.5, 0);
        pwrTxt.x = teamStartX + teamPanelW / 2;
        pwrTxt.y = cy + teamPanelH - 18;
        content.addChild(pwrTxt);

        teamStartX += teamPanelW + teamGap;
      }

      cy += teamPanelH + 10;

      // Assigned count
      if (Object.keys(this.blockerAssignments).length > 0) {
        const countTxt = new Text({
          text: `${Object.keys(this.blockerAssignments).length} blocker(s) assigned`,
          style: new TextStyle({ fontSize: 10, fill: COLORS.textMuted, fontFamily: FONT }),
        });
        countTxt.anchor.set(0.5, 0);
        countTxt.x = layout.width / 2;
        countTxt.y = cy;
        content.addChild(countTxt);
        cy += 18;
      }
    }

    cy += 12;

    // ---- Action Buttons ----
    const btnW = 170;
    const btnH = 46;
    const btnGap = 20;
    const btnY = cy;

    if (isDefender) {
      const assignmentCount = Object.keys(this.blockerAssignments).length;
      const confirmLabel = assignmentCount > 0
        ? `CONFIRM ${assignmentCount} BLOCKER${assignmentCount !== 1 ? 'S' : ''}`
        : 'CONFIRM (NONE)';

      const confirmBtn = this.makeButton(confirmLabel, btnW + 30, btnH, COLORS.buttonPrimary);
      confirmBtn.x = layout.width / 2 - (btnW + 30) - btnGap / 2;
      confirmBtn.y = btnY;
      confirmBtn.on('pointerdown', () => {
        const assignments = Object.entries(this.blockerAssignments).map(([blockingTeamId, attackingTeamId]) => ({
          blockingTeamId,
          attackingTeamId,
        }));
        dispatch({
          type: 'PERFORM_ACTION',
          player: humanPlayer,
          action: { type: 'select-blockers', assignments },
        });
      });
      content.addChild(confirmBtn);

      const noBlockBtn = this.makeButton('NO BLOCKERS', btnW, btnH, 0x374151);
      noBlockBtn.x = layout.width / 2 + btnGap / 2;
      noBlockBtn.y = btnY;
      noBlockBtn.on('pointerdown', () => {
        dispatch({
          type: 'PERFORM_ACTION',
          player: humanPlayer,
          action: { type: 'select-blockers', assignments: [] },
        });
      });
      content.addChild(noBlockBtn);
      cy += btnH;
    }

    if (canChooseOrder) {
      const allOrdered = !needsOrdering || this.showdownOrder.length >= myAttackingTeamIds.length;
      const label = needsOrdering && !allOrdered
        ? `SELECT ORDER (${this.showdownOrder.length}/${myAttackingTeamIds.length})`
        : 'RESOLVE SHOWDOWN';

      const resolveBtn = this.makeButton(label, btnW + 40, btnH, allOrdered ? COLORS.buttonPrimary : 0x374151);
      resolveBtn.x = layout.width / 2 - (btnW + 40) / 2;
      resolveBtn.y = btnY;
      resolveBtn.alpha = allOrdered ? 1 : 0.5;
      if (allOrdered) {
        resolveBtn.on('pointerdown', () => {
          const orderedIds = needsOrdering ? this.showdownOrder : myAttackingTeamIds;
          dispatch({
            type: 'PERFORM_ACTION',
            player: humanPlayer,
            action: { type: 'choose-showdown-order', teamIds: orderedIds },
          });
        });
      }
      content.addChild(resolveBtn);
      cy += btnH;
    }

    if (isEOA && isMyTurn) {
      const hasAbilityCards = state.players[humanPlayer].hand.some((id) => {
        try {
          const def = getCardDefForInstance(state, id);
          return def.cardType === 'ability';
        } catch { return false; }
      });

      const passLabel = hasAbilityCards ? 'PASS (NO ABILITIES)' : 'CONTINUE';
      const passBtn = this.makeButton(passLabel, btnW, btnH, 0x374151);
      passBtn.x = layout.width / 2 - btnW / 2;
      passBtn.y = btnY;
      passBtn.on('pointerdown', () => {
        dispatch({
          type: 'PERFORM_ACTION',
          player: humanPlayer,
          action: { type: 'pass-priority' },
        });
      });
      content.addChild(passBtn);
      cy += btnH;
    }

    // --- Center content vertically within the backdrop area ---
    const totalHeight = cy;
    const backdropHeight = layout.height;
    const topOffset = Math.max(10, (backdropHeight - totalHeight) / 2);
    content.y = topOffset;
    this.addChild(content);
  }

  // ---- Render team characters in pyramid layout (leader on top, supports fanned below) ----
  // Matches TeamOrgOverlay's pyramid style. Injured cards rotated 90° with pivot at center.
  private renderTeamCards(
    parent: Container,
    state: GameState,
    team: Team,
    x: number,
    y: number,
    w: number,
    cardSize: CardSize,
  ): number {
    const chars = team.characterIds;
    if (chars.length === 0) return y;

    const centerX = x + w / 2;

    // Helper: position a card accounting for injured rotation
    const placeCard = (card: CardSprite, cx: number, cy: number, isInj: boolean) => {
      if (isInj) {
        card.x = cx + cardSize.width / 2;
        card.y = cy + cardSize.height / 2;
      } else {
        card.x = cx;
        card.y = cy;
      }
    };

    const makeCard = (cid: string) => {
      const inst = state.cards[cid];
      if (!inst) return null;
      const isInj = inst.state === 'injured';
      let def: CardDef | undefined;
      let stats: { lead: number; support: number } | undefined;
      try { def = getCardDefForInstance(state, cid); stats = getEffectiveStats(state, cid); } catch { /* skip */ }
      const card = new CardSprite({
        defId: inst.defId, size: cardSize, cardDef: def, instance: inst,
        effectiveStats: stats, injured: isInj,
      });
      card.eventMode = 'none';
      return { card, isInj };
    };

    // Solo card — render centered
    if (chars.length === 1) {
      const result = makeCard(chars[0]);
      if (result) {
        const { card, isInj } = result;
        if (isInj) {
          const visualW = cardSize.height;
          placeCard(card, centerX - visualW / 2, y + (cardSize.height - cardSize.width) / 2, true);
        } else {
          placeCard(card, centerX - cardSize.width / 2, y, false);
        }
        parent.addChild(card);
      }
      return y + cardSize.height + 4;
    }

    // Multi-card team — pyramid: leader centered at top, supports fanned below
    const leaderId = chars[0];
    const supportIds = chars.slice(1);
    const supportOffsetY = Math.floor(cardSize.height * 0.65);
    const pyramidH = cardSize.height + supportOffsetY;

    // Render supports first (behind), then leader last (on top)
    for (let i = 0; i < supportIds.length; i++) {
      const result = makeCard(supportIds[i]);
      if (!result) continue;
      const { card, isInj } = result;

      let cardX: number;
      if (supportIds.length === 1) {
        // Single support — centered below
        cardX = centerX - cardSize.width / 2;
      } else {
        // Two supports — spread below
        const offset = i === 0 ? -cardSize.width * 0.6 : cardSize.width * 0.6;
        cardX = centerX + offset - cardSize.width / 2;
      }
      const cardY = y + supportOffsetY;

      if (isInj) {
        placeCard(card, cardX + (cardSize.width - cardSize.height) / 2, cardY + (cardSize.height - cardSize.width) / 2, true);
      } else {
        placeCard(card, cardX, cardY, false);
      }
      parent.addChild(card);
    }

    // Leader — centered at top, drawn last (on top)
    const leaderResult = makeCard(leaderId);
    if (leaderResult) {
      const { card, isInj } = leaderResult;
      if (isInj) {
        const visualW = cardSize.height;
        placeCard(card, centerX - visualW / 2, y + (cardSize.height - cardSize.width) / 2, true);
      } else {
        placeCard(card, centerX - cardSize.width / 2, y, false);
      }
      parent.addChild(card);
    }

    return y + pyramidH + 4;
  }

  // ---- Blocker selection handlers ----
  private handleSelectBlockerTeam(
    teamId: string,
    attackingTeams: Team[],
    rebuild: () => void,
  ): void {
    if (this.blockerAssignments[teamId]) {
      delete this.blockerAssignments[teamId];
      this.selectedBlockerTeamId = null;
      rebuild();
      return;
    }

    if (attackingTeams.length === 1) {
      const attackingTeamId = attackingTeams[0].id;
      const newAssignments: Record<string, string> = {};
      for (const [bId, aId] of Object.entries(this.blockerAssignments)) {
        if (aId !== attackingTeamId) newAssignments[bId] = aId;
      }
      newAssignments[teamId] = attackingTeamId;
      this.blockerAssignments = newAssignments;
      this.selectedBlockerTeamId = null;
      rebuild();
      return;
    }

    this.selectedBlockerTeamId = this.selectedBlockerTeamId === teamId ? null : teamId;
    rebuild();
  }

  private assignBlockerToAttacker(attackingTeamId: string, rebuild: () => void): void {
    if (!this.selectedBlockerTeamId) return;

    const existingBlocker = Object.entries(this.blockerAssignments).find(
      ([, atkId]) => atkId === attackingTeamId,
    );
    if (existingBlocker) {
      delete this.blockerAssignments[existingBlocker[0]];
    }

    this.blockerAssignments[this.selectedBlockerTeamId] = attackingTeamId;
    this.selectedBlockerTeamId = null;
    rebuild();
  }

  // ---- Button helper ----
  private makeButton(label: string, w: number, h: number, color: number): Container {
    const c = new Container();
    c.eventMode = 'static';
    c.cursor = 'pointer';
    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 8);
    bg.fill({ color, alpha: 0.85 });
    bg.stroke({ color: 0xffffff, width: 1, alpha: 0.25 });
    c.addChild(bg);
    // Top highlight layer
    const highlight = new Graphics();
    highlight.roundRect(0, 0, w, h / 2, 8);
    highlight.fill({ color: 0xffffff, alpha: 0.05 });
    c.addChild(highlight);
    const txt = new Text({
      text: label,
      style: new TextStyle({ fontSize: 14, fill: COLORS.textBright, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
    });
    txt.anchor.set(0.5, 0.5);
    txt.x = w / 2;
    txt.y = h / 2;
    c.addChild(txt);
    return c;
  }
}
