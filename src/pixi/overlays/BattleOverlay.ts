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

  constructor(
    state: GameState,
    ui: UIState,
    layout: BoardLayout,
    dispatch: (action: UIAction) => void,
  ) {
    super();

    const phase = state.phase;
    const isEOAPhase = phase === 'battle-eoa';

    // Phase accent color
    const phaseColor =
      phase === 'battle-attack' ? 0xef4444 :
      phase === 'battle-block' ? 0x3b82f6 :
      phase === 'battle-showdown' ? 0xf59e0b :
      0x8b5cf6;

    // Deep backdrop with radial glow (matches TeamOrg/Mulligan)
    const backdrop = new Graphics();
    const backdropH = isEOAPhase ? layout.playerY + 20 : layout.height;
    backdrop.rect(0, 0, layout.width, backdropH);
    backdrop.fill({ color: 0x050a14, alpha: 0.88 });
    backdrop.eventMode = 'static';
    this.addChild(backdrop);

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

    // Static children: backdrop(1) + glow(1) + particles(8) = 10
    const staticChildCount = 2 + particleCount;

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
    const cardSize = CARD_SIZES.lg;

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

    if (hintText) {
      const hint = new Text({
        text: hintText,
        style: new TextStyle({ fontSize: 14, fill: COLORS.textMuted, fontFamily: FONT }),
      });
      hint.anchor.set(0.5, 0);
      hint.x = layout.width / 2;
      hint.y = cy;
      content.addChild(hint);
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
    // Top label(20) + top cards(cardSize.height) + VS bar(50) + bottom label(20) + bottom cards(cardSize.height) + padding(32)
    const vsBarH = 46;
    const panelH = 20 + cardSize.height + vsBarH + 20 + cardSize.height + 32 + (isShowdown ? 26 : 0);

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

      // Panel outer glow
      const panelGlow = new Graphics();
      panelGlow.roundRect(mx - 3, matchupY - 3, matchupW + 6, panelH + 6, 12);
      panelGlow.stroke({ color: phaseColor, width: 1, alpha: 0.08 });
      content.addChild(panelGlow);

      // Panel background
      const panel = new Graphics();
      panel.roundRect(mx, matchupY, matchupW, panelH, 10);
      const panelBorderColor = isOrdered ? 0xf59e0b : phaseColor;
      panel.fill({ color: 0x0f1729, alpha: 0.9 });
      panel.stroke({ color: panelBorderColor, width: isOrdered ? 2 : 1, alpha: isOrdered ? 0.6 : 0.15 });

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
        ? (assignedBlockerId ? 'OPPONENT BLOCK' : null)
        : 'OPPONENT ATTACK';

      if (opponentTeamId && state.teams[opponentTeamId]) {
        if (opponentLabel) {
          const lbl = new Text({
            text: opponentLabel,
            style: new TextStyle({ fontSize: 12, fill: isPlayerAttacker ? 0x60a5fa : 0xf87171, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
          });
          lbl.anchor.set(0.5, 0);
          lbl.x = mx + matchupW / 2;
          lbl.y = pcy;
          content.addChild(lbl);
          pcy += 20;
        }
        pcy = this.renderTeamCards(content, state, state.teams[opponentTeamId], contentX, pcy, contentW, cardSize);
      } else if (isPlayerAttacker) {
        // Unblocked placeholder
        const placeholderBg = new Graphics();
        placeholderBg.roundRect(contentX, pcy, contentW, cardSize.height, 6);
        placeholderBg.fill({ color: 0x111827, alpha: 0.5 });
        placeholderBg.stroke({ color: 0x1e293b, width: 1, alpha: 0.3 });
        content.addChild(placeholderBg);

        const unblockedTxt = new Text({
          text: isDefender ? 'TAP TO ASSIGN BLOCKER' : 'UNBLOCKED',
          style: new TextStyle({ fontSize: 14, fill: COLORS.textMuted, fontFamily: FONT, fontStyle: 'italic' }),
        });
        unblockedTxt.anchor.set(0.5, 0.5);
        unblockedTxt.x = mx + matchupW / 2;
        unblockedTxt.y = pcy + cardSize.height / 2;
        content.addChild(unblockedTxt);
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
      const playerLabel = isPlayerAttacker ? 'YOUR ATTACK' : (assignedBlockerId ? 'YOUR BLOCK' : null);

      if (playerTeamId && state.teams[playerTeamId]) {
        if (playerLabel) {
          const lbl = new Text({
            text: playerLabel,
            style: new TextStyle({ fontSize: 12, fill: isPlayerAttacker ? 0xf87171 : 0x60a5fa, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
          });
          lbl.anchor.set(0.5, 0);
          lbl.x = mx + matchupW / 2;
          lbl.y = pcy;
          content.addChild(lbl);
          pcy += 20;
        }
        this.renderTeamCards(content, state, state.teams[playerTeamId], contentX, pcy, contentW, cardSize);
      }

      // Showdown result prediction
      if (isShowdown) {
        const hasBlocker = !!matchup.blockingTeamId;
        const atkWins = hasBlocker ? matchup.attackingPower > matchup.blockingPower : true;
        const blkWins = hasBlocker ? matchup.blockingPower > matchup.attackingPower : false;
        const stalemate = hasBlocker ? matchup.attackingPower === matchup.blockingPower : false;
        const resultLabel = atkWins ? 'Attacker Wins!' : blkWins ? 'Blocker Wins!' : stalemate ? 'Stalemate' : 'Unblocked';
        const resultColor = atkWins ? 0xf87171 : blkWins ? 0x60a5fa : COLORS.textMuted;

        // Glow bg pill behind result text
        const pillW = 140;
        const pillH = 22;
        const pillX = mx + matchupW / 2 - pillW / 2;
        const pillY = matchupY + panelH - 10 - pillH;
        const resultPill = new Graphics();
        resultPill.roundRect(pillX, pillY, pillW, pillH, 11);
        resultPill.fill({ color: resultColor, alpha: 0.12 });
        content.addChild(resultPill);

        const resultTxt = new Text({
          text: resultLabel.toUpperCase(),
          style: new TextStyle({ fontSize: 14, fill: resultColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 2 }),
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

      // Feed entries (rendered in chain order — newest at bottom)
      const feedW = Math.min(520, layout.width - 60);
      const feedX = (layout.width - feedW) / 2;
      const rowH = 32;

      for (let ci = 0; ci < state.chain.length; ci++) {
        const entry = state.chain[ci];
        const rowY = cy;

        // Alternating row background
        const rowBg = new Graphics();
        rowBg.roundRect(feedX, rowY, feedW, rowH, 4);
        rowBg.fill({ color: 0xffffff, alpha: ci % 2 === 0 ? 0.04 : 0.08 });
        content.addChild(rowBg);

        let rx = feedX + 10;
        const rowCenterY = rowY + rowH / 2;

        // Owner color dot
        const dotColor = entry.owner === humanPlayer ? COLORS.player1Color : COLORS.player2Color;
        const dot = new Graphics();
        dot.circle(rx + 4, rowCenterY, 4);
        dot.fill({ color: dotColor });
        content.addChild(dot);
        rx += 16;

        // Entry number
        const numTxt = new Text({
          text: `#${ci + 1}`,
          style: new TextStyle({ fontSize: 11, fill: COLORS.textMuted, fontFamily: FONT }),
        });
        numTxt.anchor.set(0, 0.5);
        numTxt.x = rx;
        numTxt.y = rowCenterY;
        content.addChild(numTxt);
        rx += numTxt.width + 8;

        // Ability card name
        let abilityName = '???';
        try {
          const abilityDef = getCardDefForInstance(state, entry.sourceCardInstanceId);
          abilityName = abilityDef.name;
        } catch { /* skip */ }

        const nameTxt = new Text({
          text: abilityName,
          style: new TextStyle({ fontSize: 13, fill: phaseColor, fontFamily: FONT, fontWeight: 'bold' }),
        });
        nameTxt.anchor.set(0, 0.5);
        nameTxt.x = rx;
        nameTxt.y = rowCenterY;
        content.addChild(nameTxt);
        rx += nameTxt.width + 6;

        // User character
        if (entry.userId) {
          let userName = '???';
          try { userName = getCardDefForInstance(state, entry.userId).name; } catch { /* skip */ }

          const byTxt = new Text({
            text: 'by',
            style: new TextStyle({ fontSize: 11, fill: COLORS.textMuted, fontFamily: FONT }),
          });
          byTxt.anchor.set(0, 0.5);
          byTxt.x = rx;
          byTxt.y = rowCenterY;
          content.addChild(byTxt);
          rx += byTxt.width + 4;

          const userTxt = new Text({
            text: userName,
            style: new TextStyle({ fontSize: 11, fill: COLORS.text, fontFamily: FONT }),
          });
          userTxt.anchor.set(0, 0.5);
          userTxt.x = rx;
          userTxt.y = rowCenterY;
          content.addChild(userTxt);
          rx += userTxt.width + 6;
        }

        // Target(s)
        const targetIds = entry.targetIds ?? [];
        if (targetIds.length > 0) {
          const arrowTxt = new Text({
            text: '\u2192',
            style: new TextStyle({ fontSize: 11, fill: COLORS.textMuted, fontFamily: FONT }),
          });
          arrowTxt.anchor.set(0, 0.5);
          arrowTxt.x = rx;
          arrowTxt.y = rowCenterY;
          content.addChild(arrowTxt);
          rx += arrowTxt.width + 4;

          const targetNames = targetIds.map(id => {
            try { return getCardDefForInstance(state, id).name; } catch { return '???'; }
          });
          const targetTxt = new Text({
            text: targetNames.join(', '),
            style: new TextStyle({ fontSize: 11, fill: COLORS.text, fontFamily: FONT }),
          });
          targetTxt.anchor.set(0, 0.5);
          targetTxt.x = rx;
          targetTxt.y = rowCenterY;
          content.addChild(targetTxt);
          rx += targetTxt.width + 6;
        }

        // Status badge
        if (entry.resolved) {
          const statusTxt = new Text({
            text: 'RESOLVED',
            style: new TextStyle({ fontSize: 9, fill: COLORS.textMuted, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
          });
          statusTxt.anchor.set(0, 0.5);
          statusTxt.x = rx;
          statusTxt.y = rowCenterY;
          content.addChild(statusTxt);
        } else if (entry.negated) {
          const statusTxt = new Text({
            text: 'NEGATED',
            style: new TextStyle({ fontSize: 9, fill: 0xef4444, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 1 }),
          });
          statusTxt.anchor.set(0, 0.5);
          statusTxt.x = rx;
          statusTxt.y = rowCenterY;
          content.addChild(statusTxt);
        }

        cy += rowH;
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

    // --- Center content vertically ---
    const totalHeight = cy;
    const topOffset = Math.max(20, (layout.height - totalHeight) / 2);
    content.y = topOffset;
    this.addChild(content);
  }

  // ---- Render team characters in a row ----
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
    const gap = 6;
    const totalW = chars.length * cardSize.width + (chars.length - 1) * gap;
    const startX = x + (w - totalW) / 2;

    for (let i = 0; i < chars.length; i++) {
      const cid = chars[i];
      const inst = state.cards[cid];
      if (!inst) continue;

      let def: CardDef | undefined;
      let stats: { lead: number; support: number } | undefined;
      try { def = getCardDefForInstance(state, cid); stats = getEffectiveStats(state, cid); } catch { /* skip */ }

      const card = new CardSprite({
        defId: inst.defId,
        size: cardSize,
        cardDef: def,
        instance: inst,
        effectiveStats: stats,
      });
      card.eventMode = 'none';
      card.x = startX + i * (cardSize.width + gap);
      card.y = y;
      parent.addChild(card);
    }

    return y + cardSize.height + 4;
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
