// ============================================================
// Primal TCG — Battle Overlay (PixiJS)
// ============================================================
// Full-screen overlay during battle phases: attack, block, eoa, showdown.
// Handles blocker assignment (block phase) and showdown ordering.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CardSprite } from '../CardSprite';
import { COLORS, CARD_SIZES, BoardLayout, CardSize } from '../layout';
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

// Estimate power for teams in kingdom (not on battlefield yet)
function estimateTeamPower(state: GameState, team: Team): number {
  let power = 0;
  for (let i = 0; i < team.characterIds.length; i++) {
    const card = state.cards[team.characterIds[i]];
    if (!card) continue;
    let def: CardDef | undefined;
    try { def = getCardDefForInstance(state, team.characterIds[i]); } catch { continue; }
    if (def.cardType !== 'character') continue;
    const charDef = def as import('@/game/types').CharacterCardDef;
    const stats = card.state === 'injured' ? charDef.injuredStats : charDef.healthyStats;
    if (i === 0 && team.hasLead) {
      power += stats.lead;
    } else {
      power += stats.support;
    }
  }
  return power;
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

    const humanPlayer = ui.humanPlayer;
    const phase = state.phase;
    const cardSize = CARD_SIZES.md;

    // Backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, layout.width, layout.height);
    backdrop.fill({ color: 0x000000, alpha: 0.85 });
    backdrop.eventMode = 'static';
    this.addChild(backdrop);

    // Phase accent colors
    const phaseColor =
      phase === 'battle-attack' ? 0xef4444 :
      phase === 'battle-block' ? 0x3b82f6 :
      phase === 'battle-showdown' ? 0xf59e0b :
      0x8b5cf6;

    // Header
    const phaseText = PHASE_LABELS[phase] ?? phase;
    const header = new Text({
      text: phaseText.toUpperCase(),
      style: new TextStyle({
        fontSize: 16,
        fill: phaseColor,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        letterSpacing: 4,
      }),
    });
    header.anchor.set(0.5, 0);
    header.x = layout.width / 2;
    header.y = 20;
    this.addChild(header);

    // Header lines
    for (const offsetX of [-1, 1]) {
      const line = new Graphics();
      const lx = layout.width / 2 + offsetX * (header.width / 2 + 16);
      line.moveTo(lx, 28);
      line.lineTo(lx + offsetX * 60, 28);
      line.stroke({ color: phaseColor, width: 1, alpha: 0.3 });
      this.addChild(line);
    }

    // Rebuild closure for local state changes
    const rebuild = () => {
      // Remove everything after backdrop + header + 2 lines = 4 children
      while (this.children.length > 4) {
        this.removeChildAt(4);
      }
      this.renderContent(state, ui, layout, cardSize, dispatch, rebuild);
    };

    rebuild();
  }

  private renderContent(
    state: GameState,
    ui: UIState,
    layout: BoardLayout,
    cardSize: CardSize,
    dispatch: (action: UIAction) => void,
    rebuild: () => void,
  ): void {
    const humanPlayer = ui.humanPlayer;
    const phase = state.phase;
    const actingPlayer = getActingPlayer(state);
    const isMyTurn = actingPlayer === humanPlayer;
    const legalActions = getLegalActions(state, humanPlayer);

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

    // Available blocker teams (player's teams not attacking/blocking)
    const availableBlockerTeams = allTeams.filter(
      (t) => t.owner === humanPlayer && !t.isAttacking && !t.isBlocking,
    );

    const canChooseOrder = isShowdown && isMyTurn && legalActions.includes('choose-showdown-order');
    const myAttackingTeamIds = matchups
      .filter((m) => m.attackerOwner === humanPlayer)
      .map((m) => m.attackingTeamId);
    const needsOrdering = canChooseOrder && myAttackingTeamIds.length > 1;

    // ---- Hint text ----
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
        style: new TextStyle({ fontSize: 10, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif' }),
      });
      hint.anchor.set(0.5, 0);
      hint.x = layout.width / 2;
      hint.y = 48;
      this.addChild(hint);
    }

    // ---- Matchups ----
    const matchupY = 70;
    const matchupGap = 20;
    const matchupW = Math.min(400, (layout.width - 80 - matchupGap * (matchups.length - 1)) / Math.max(matchups.length, 1));
    const totalMatchupW = matchups.length * matchupW + (matchups.length - 1) * matchupGap;
    let matchupStartX = (layout.width - totalMatchupW) / 2;

    for (let mi = 0; mi < matchups.length; mi++) {
      const matchup = matchups[mi];
      const mx = matchupStartX + mi * (matchupW + matchupGap);

      // Build display matchup (with blocker assignment preview)
      const assignedBlockerId = isDefender
        ? Object.entries(this.blockerAssignments).find(([, atkId]) => atkId === matchup.attackingTeamId)?.[0] ?? null
        : matchup.blockingTeamId;

      const assignedBlockerPower = assignedBlockerId && state.teams[assignedBlockerId]
        ? estimateTeamPower(state, state.teams[assignedBlockerId])
        : (matchup.blockingTeamId ? matchup.blockingPower : 0);

      const isPlayerAttacker = matchup.attackerOwner === humanPlayer;
      const orderIndex = this.showdownOrder.indexOf(matchup.attackingTeamId);
      const isOrdered = orderIndex !== -1;

      // Matchup panel — compact height
      const panel = new Graphics();
      const panelH = Math.min(360, layout.height - 260);
      panel.roundRect(mx, matchupY, matchupW, panelH, 8);
      const panelBorderColor = isOrdered ? 0xf59e0b : 0x1e293b;
      panel.fill({ color: 0x0f1729, alpha: 0.8 });
      panel.stroke({ color: panelBorderColor, width: isOrdered ? 2 : 1, alpha: 0.5 });

      // Clickable for showdown ordering or blocker assignment
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
      this.addChild(panel);

      // Order badge
      if (needsOrdering && isPlayerAttacker && isOrdered) {
        const badge = new Graphics();
        badge.circle(mx + 14, matchupY + 14, 12);
        badge.fill({ color: 0xf59e0b });
        this.addChild(badge);

        const badgeTxt = new Text({
          text: `${orderIndex + 1}`,
          style: new TextStyle({ fontSize: 12, fill: 0x000000, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
        });
        badgeTxt.anchor.set(0.5, 0.5);
        badgeTxt.x = mx + 14;
        badgeTxt.y = matchupY + 14;
        this.addChild(badgeTxt);
      }

      const contentX = mx + 10;
      const contentW = matchupW - 20;
      let cy = matchupY + 16;

      // Top team (opponent's perspective)
      const opponentTeamId = isPlayerAttacker ? assignedBlockerId : matchup.attackingTeamId;
      const opponentLabel = isPlayerAttacker
        ? (assignedBlockerId ? 'OPPONENT BLOCK' : null)
        : 'OPPONENT ATTACK';

      if (opponentTeamId && state.teams[opponentTeamId]) {
        if (opponentLabel) {
          const lbl = new Text({
            text: opponentLabel,
            style: new TextStyle({ fontSize: 8, fill: isPlayerAttacker ? 0x60a5fa : 0xf87171, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 2 }),
          });
          lbl.anchor.set(0.5, 0);
          lbl.x = mx + matchupW / 2;
          lbl.y = cy;
          this.addChild(lbl);
          cy += 14;
        }
        cy = this.renderTeamCards(state, state.teams[opponentTeamId], contentX, cy, contentW, cardSize);
      } else if (isPlayerAttacker) {
        // Unblocked label
        const unblockedTxt = new Text({
          text: isDefender ? 'TAP TO ASSIGN' : 'UNBLOCKED',
          style: new TextStyle({ fontSize: 10, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif', fontStyle: 'italic' }),
        });
        unblockedTxt.anchor.set(0.5, 0.5);
        unblockedTxt.x = mx + matchupW / 2;
        unblockedTxt.y = cy + 30;
        this.addChild(unblockedTxt);
        cy += 60;
      }

      // VS power comparison
      cy += 8;
      const vsY = cy;

      const atkPowerTxt = new Text({
        text: `${matchup.attackingPower}`,
        style: new TextStyle({ fontSize: 18, fill: 0xf87171, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
      });
      atkPowerTxt.anchor.set(1, 0.5);
      atkPowerTxt.x = mx + matchupW / 2 - 24;
      atkPowerTxt.y = vsY + 12;
      this.addChild(atkPowerTxt);

      const atkLabel = new Text({
        text: 'ATK',
        style: new TextStyle({ fontSize: 7, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
      });
      atkLabel.anchor.set(1, 0.5);
      atkLabel.x = atkPowerTxt.x - atkPowerTxt.width - 4;
      atkLabel.y = vsY + 12;
      this.addChild(atkLabel);

      // VS circle
      const vsCircle = new Graphics();
      vsCircle.circle(mx + matchupW / 2, vsY + 12, 14);
      vsCircle.fill({ color: 0xffffff, alpha: 0.05 });
      vsCircle.stroke({ color: 0xffffff, width: 1, alpha: 0.15 });
      this.addChild(vsCircle);

      const vsTxt = new Text({
        text: 'VS',
        style: new TextStyle({ fontSize: 8, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
      });
      vsTxt.anchor.set(0.5, 0.5);
      vsTxt.x = mx + matchupW / 2;
      vsTxt.y = vsY + 12;
      this.addChild(vsTxt);

      const blkPowerTxt = new Text({
        text: assignedBlockerId ? `${assignedBlockerPower}` : '—',
        style: new TextStyle({ fontSize: 18, fill: 0x60a5fa, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
      });
      blkPowerTxt.anchor.set(0, 0.5);
      blkPowerTxt.x = mx + matchupW / 2 + 24;
      blkPowerTxt.y = vsY + 12;
      this.addChild(blkPowerTxt);

      const blkLabel = new Text({
        text: 'BLK',
        style: new TextStyle({ fontSize: 7, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
      });
      blkLabel.anchor.set(0, 0.5);
      blkLabel.x = blkPowerTxt.x + blkPowerTxt.width + 4;
      blkLabel.y = vsY + 12;
      this.addChild(blkLabel);

      cy = vsY + 32;

      // Bottom team (your perspective)
      const playerTeamId = isPlayerAttacker ? matchup.attackingTeamId : assignedBlockerId;
      const playerLabel = isPlayerAttacker ? 'YOUR ATTACK' : (assignedBlockerId ? 'YOUR BLOCK' : null);

      if (playerTeamId && state.teams[playerTeamId]) {
        if (playerLabel) {
          const lbl = new Text({
            text: playerLabel,
            style: new TextStyle({ fontSize: 8, fill: isPlayerAttacker ? 0xf87171 : 0x60a5fa, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 2 }),
          });
          lbl.anchor.set(0.5, 0);
          lbl.x = mx + matchupW / 2;
          lbl.y = cy;
          this.addChild(lbl);
          cy += 14;
        }
        this.renderTeamCards(state, state.teams[playerTeamId], contentX, cy, contentW, cardSize);
      }

      // Showdown result prediction
      if (isShowdown) {
        const hasBlocker = !!matchup.blockingTeamId;
        const atkWins = hasBlocker ? matchup.attackingPower > matchup.blockingPower : true;
        const blkWins = hasBlocker ? matchup.blockingPower > matchup.attackingPower : false;
        const stalemate = hasBlocker ? matchup.attackingPower === matchup.blockingPower : false;
        const resultLabel = atkWins ? 'Attacker Wins!' : blkWins ? 'Blocker Wins!' : stalemate ? 'Stalemate' : 'Unblocked';
        const resultColor = atkWins ? 0xf87171 : blkWins ? 0x60a5fa : COLORS.textMuted;

        const resultTxt = new Text({
          text: resultLabel.toUpperCase(),
          style: new TextStyle({ fontSize: 9, fill: resultColor, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 1 }),
        });
        resultTxt.anchor.set(0.5, 1);
        resultTxt.x = mx + matchupW / 2;
        resultTxt.y = matchupY + panelH - 10;
        this.addChild(resultTxt);
      }
    }

    // ---- Available Blockers Section (block phase, defender only) ----
    const assignedBlockerIds = new Set(Object.keys(this.blockerAssignments));
    const unassignedBlockerTeams = availableBlockerTeams.filter((t) => !assignedBlockerIds.has(t.id));

    if (isDefender && unassignedBlockerTeams.length > 0) {
      const blockerSectionY = layout.height - 170;

      const divider = new Graphics();
      divider.moveTo(layout.width * 0.15, blockerSectionY - 10);
      divider.lineTo(layout.width * 0.85, blockerSectionY - 10);
      divider.stroke({ color: 0x1e293b, width: 1 });
      this.addChild(divider);

      const blockerLabel = new Text({
        text: 'YOUR AVAILABLE TEAMS',
        style: new TextStyle({ fontSize: 9, fill: 0x60a5fa, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 2 }),
      });
      blockerLabel.anchor.set(0.5, 0);
      blockerLabel.x = layout.width / 2;
      blockerLabel.y = blockerSectionY;
      this.addChild(blockerLabel);

      const teamCardSize = CARD_SIZES.xs;
      const teamGap = 16;
      const teamsW = unassignedBlockerTeams.length * 120 + (unassignedBlockerTeams.length - 1) * teamGap;
      let teamStartX = (layout.width - teamsW) / 2;

      for (const team of unassignedBlockerTeams) {
        const isSelected = this.selectedBlockerTeamId === team.id;
        const teamPower = estimateTeamPower(state, team);

        const teamPanel = new Graphics();
        teamPanel.roundRect(teamStartX, blockerSectionY + 18, 120, 65, 6);
        teamPanel.fill({ color: isSelected ? 0x1e3a5f : 0x111827, alpha: 0.9 });
        teamPanel.stroke({ color: isSelected ? 0x3b82f6 : 0x1e293b, width: isSelected ? 2 : 1, alpha: isSelected ? 1 : 0.5 });
        teamPanel.eventMode = 'static';
        teamPanel.cursor = 'pointer';
        teamPanel.on('pointerdown', () => {
          this.handleSelectBlockerTeam(team.id, attackingTeams, rebuild);
        });
        this.addChild(teamPanel);

        // Render team characters
        const chars = team.characterIds;
        const charGap = 4;
        const charsW = chars.length * teamCardSize.width + (chars.length - 1) * charGap;
        let charX = teamStartX + (120 - charsW) / 2;

        for (const cid of chars) {
          const inst = state.cards[cid];
          if (!inst) continue;
          let def: CardDef | undefined;
          let stats: { lead: number; support: number } | undefined;
          try { def = getCardDefForInstance(state, cid); stats = getEffectiveStats(state, cid); } catch { /* skip */ }

          const card = new CardSprite({ defId: inst.defId, size: teamCardSize, cardDef: def, instance: inst, effectiveStats: stats });
          card.x = charX;
          card.y = blockerSectionY + 22;
          this.addChild(card);
          charX += teamCardSize.width + charGap;
        }

        // Power label
        const pwrTxt = new Text({
          text: `PWR ${teamPower}`,
          style: new TextStyle({ fontSize: 8, fill: 0x60a5fa, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
        });
        pwrTxt.anchor.set(0.5, 0);
        pwrTxt.x = teamStartX + 60;
        pwrTxt.y = blockerSectionY + 70;
        this.addChild(pwrTxt);

        teamStartX += 120 + teamGap;
      }

      // Assigned count
      if (Object.keys(this.blockerAssignments).length > 0) {
        const countTxt = new Text({
          text: `${Object.keys(this.blockerAssignments).length} blocker(s) assigned — tap to remove`,
          style: new TextStyle({ fontSize: 9, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif' }),
        });
        countTxt.anchor.set(0.5, 0);
        countTxt.x = layout.width / 2;
        countTxt.y = blockerSectionY + 88;
        this.addChild(countTxt);
      }
    }

    // ---- Action Buttons ----
    const btnY = layout.height - 55;
    const btnW = 130;
    const btnH = 34;
    const btnGap = 12;

    if (isDefender) {
      const assignmentCount = Object.keys(this.blockerAssignments).length;
      const confirmLabel = assignmentCount > 0
        ? `CONFIRM ${assignmentCount} BLOCKER${assignmentCount !== 1 ? 'S' : ''}`
        : 'CONFIRM (NONE)';

      const confirmBtn = this.makeButton(confirmLabel, btnW + 20, btnH, COLORS.buttonPrimary);
      confirmBtn.x = layout.width / 2 - (btnW + 20) - btnGap / 2;
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
      this.addChild(confirmBtn);

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
      this.addChild(noBlockBtn);
    }

    if (canChooseOrder) {
      const allOrdered = !needsOrdering || this.showdownOrder.length >= myAttackingTeamIds.length;
      const label = needsOrdering && !allOrdered
        ? `SELECT ORDER (${this.showdownOrder.length}/${myAttackingTeamIds.length})`
        : 'RESOLVE SHOWDOWN';

      const resolveBtn = this.makeButton(label, btnW + 30, btnH, allOrdered ? COLORS.buttonPrimary : 0x374151);
      resolveBtn.x = layout.width / 2 - (btnW + 30) / 2;
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
      this.addChild(resolveBtn);
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
      this.addChild(passBtn);
    }
  }

  // ---- Render team characters in a row ----
  private renderTeamCards(
    state: GameState,
    team: Team,
    x: number,
    y: number,
    w: number,
    cardSize: CardSize,
  ): number {
    const chars = team.characterIds;
    const gap = 4;
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
      card.x = startX + i * (cardSize.width + gap);
      card.y = y;
      this.addChild(card);
    }

    return y + cardSize.height + 4;
  }

  // ---- Blocker selection handlers ----
  private handleSelectBlockerTeam(
    teamId: string,
    attackingTeams: Team[],
    rebuild: () => void,
  ): void {
    // If clicking an already-assigned blocker, unassign it
    if (this.blockerAssignments[teamId]) {
      delete this.blockerAssignments[teamId];
      this.selectedBlockerTeamId = null;
      rebuild();
      return;
    }

    // If only one attacking team, auto-assign
    if (attackingTeams.length === 1) {
      const attackingTeamId = attackingTeams[0].id;
      // Remove any existing blocker for this attacker
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

    // Toggle selection for multi-attacker case
    this.selectedBlockerTeamId = this.selectedBlockerTeamId === teamId ? null : teamId;
    rebuild();
  }

  private assignBlockerToAttacker(attackingTeamId: string, rebuild: () => void): void {
    if (!this.selectedBlockerTeamId) return;

    // Remove any existing blocker for this attacker
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
    bg.roundRect(0, 0, w, h, 6);
    bg.fill({ color, alpha: 0.9 });
    bg.stroke({ color: 0xffffff, width: 1, alpha: 0.1 });
    c.addChild(bg);
    const txt = new Text({
      text: label,
      style: new TextStyle({ fontSize: 10, fill: COLORS.textBright, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 1 }),
    });
    txt.anchor.set(0.5, 0.5);
    txt.x = w / 2;
    txt.y = h / 2;
    c.addChild(txt);
    return c;
  }
}
