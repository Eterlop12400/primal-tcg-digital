// ============================================================
// Primal TCG — Team Organization Overlay
// ============================================================

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CardSprite } from '../CardSprite';
import { COLORS, CARD_SIZES, BoardLayout, CardSize } from '../layout';
import type { GameState, PlayerId, CardDef } from '@/game/types';
import type { UIState, UIAction } from '@/hooks/useGameEngine';
import { getCardDefForInstance, getEffectiveStats } from '@/game/engine';
import { getAIAction } from '@/game/ai';

interface LocalTeam {
  leadId: string;
  supportIds: string[];
}

export class TeamOrgOverlay extends Container {
  private teams: LocalTeam[] = [];
  private unassigned: string[] = [];
  private activeTeamIdx: number | null = null;

  constructor(
    state: GameState,
    ui: UIState,
    layout: BoardLayout,
    dispatch: (action: UIAction) => void,
  ) {
    super();

    const humanPlayer = ui.humanPlayer;
    const pState = state.players[humanPlayer];
    const cardSize = CARD_SIZES.md;

    // Initialize from existing teams
    const existingTeams = Object.values(state.teams).filter((t) => t.owner === humanPlayer);
    const teamedIds = new Set<string>();

    for (const team of existingTeams) {
      if (team.characterIds.length > 0) {
        this.teams.push({
          leadId: team.characterIds[0],
          supportIds: team.characterIds.slice(1),
        });
        team.characterIds.forEach((id) => teamedIds.add(id));
      }
    }

    // Unassigned kingdom characters
    this.unassigned = pState.kingdom.filter((id) => !teamedIds.has(id));

    // Backdrop
    const backdrop = new Graphics();
    backdrop.rect(0, 0, layout.width, layout.height);
    backdrop.fill({ color: 0x000000, alpha: 0.85 });
    backdrop.eventMode = 'static';
    this.addChild(backdrop);

    // Title
    const title = new Text({
      text: 'ORGANIZE TEAMS',
      style: new TextStyle({
        fontSize: 24,
        fill: COLORS.textBright,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        letterSpacing: 4,
      }),
    });
    title.anchor.set(0.5, 0);
    title.x = layout.width / 2;
    title.y = 20;
    this.addChild(title);

    const sub = new Text({
      text: 'Click an unassigned character to create a team, then click supports to add (max 3 per team)',
      style: new TextStyle({ fontSize: 11, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif' }),
    });
    sub.anchor.set(0.5, 0);
    sub.x = layout.width / 2;
    sub.y = 52;
    this.addChild(sub);

    // Render function (called to rebuild on changes)
    const rebuild = () => {
      // Remove everything after the subtitle
      while (this.children.length > 3) {
        this.removeChildAt(3);
      }
      this.renderContent(state, humanPlayer, layout, cardSize, dispatch, rebuild);
    };

    rebuild();
  }

  private renderContent(
    state: GameState,
    player: PlayerId,
    layout: BoardLayout,
    cardSize: CardSize,
    dispatch: (action: UIAction) => void,
    rebuild: () => void,
  ): void {
    const gap = 8;
    const teamGap = 20;
    const sectionY = 80;

    // --- Teams Section ---
    const teamsLabel = new Text({
      text: `TEAMS (${this.teams.length})`,
      style: new TextStyle({ fontSize: 12, fill: COLORS.accentBlue, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 2 }),
    });
    teamsLabel.x = 30;
    teamsLabel.y = sectionY;
    this.addChild(teamsLabel);

    let teamY = sectionY + 24;
    const teamsPerRow = Math.max(1, Math.floor((layout.width - 60) / (cardSize.width * 4 + teamGap * 2)));

    this.teams.forEach((team, idx) => {
      const allIds = [team.leadId, ...team.supportIds];
      const teamW = allIds.length * (cardSize.width + gap) - gap + 24;
      const teamX = 30 + (idx % teamsPerRow) * (teamW + teamGap);
      const rowIdx = Math.floor(idx / teamsPerRow);
      const ty = teamY + rowIdx * (cardSize.height + 50);

      // Team panel
      const isActive = this.activeTeamIdx === idx;
      const panel = new Graphics();
      panel.roundRect(teamX - 8, ty - 4, teamW + 16, cardSize.height + 30, 6);
      panel.fill({ color: isActive ? 0x1a2744 : 0x111827, alpha: 0.8 });
      panel.stroke({ color: isActive ? COLORS.accentBlue : COLORS.panelBorder, width: isActive ? 2 : 1, alpha: 0.6 });
      panel.eventMode = 'static';
      panel.cursor = 'pointer';
      panel.on('pointerdown', () => {
        this.activeTeamIdx = this.activeTeamIdx === idx ? null : idx;
        rebuild();
      });
      this.addChild(panel);

      // Team power label
      let power = 0;
      for (const cid of allIds) {
        try {
          const stats = getEffectiveStats(state, cid);
          const inst = state.cards[cid];
          if (inst && allIds.indexOf(cid) === 0) power += stats.lead;
          else power += stats.support;
        } catch { /* skip */ }
      }

      const pwrTxt = new Text({
        text: `PWR ${power}`,
        style: new TextStyle({ fontSize: 9, fill: COLORS.textGold, fontFamily: 'Arial, sans-serif', fontWeight: 'bold' }),
      });
      pwrTxt.x = teamX;
      pwrTxt.y = ty - 2;
      this.addChild(pwrTxt);

      // Characters
      allIds.forEach((cid, ci) => {
        const inst = state.cards[cid];
        if (!inst) return;

        let def: CardDef | undefined;
        let stats: { lead: number; support: number } | undefined;
        try {
          def = getCardDefForInstance(state, cid);
          stats = getEffectiveStats(state, cid);
        } catch { /* skip */ }

        const card = new CardSprite({
          defId: inst.defId,
          size: cardSize,
          cardDef: def,
          instance: inst,
          effectiveStats: stats,
          interactive: true,
        });
        card.x = teamX + ci * (cardSize.width + gap);
        card.y = ty + 12;

        // Role label
        const roleTxt = new Text({
          text: ci === 0 ? 'LEAD' : 'SUP',
          style: new TextStyle({
            fontSize: 7,
            fill: ci === 0 ? COLORS.leadColor : COLORS.supportColor,
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
          }),
        });
        roleTxt.anchor.set(0.5, 0);
        roleTxt.x = card.x + cardSize.width / 2;
        roleTxt.y = card.y + cardSize.height + 2;
        this.addChild(roleTxt);

        // Click to remove from team
        card.on('pointerdown', (e: Event) => {
          e.stopPropagation();
          if (ci === 0) {
            // Remove lead: dissolve team, move all back to unassigned
            this.unassigned.push(...allIds);
            this.teams.splice(idx, 1);
          } else {
            // Remove support
            team.supportIds = team.supportIds.filter((id) => id !== cid);
            this.unassigned.push(cid);
          }
          this.activeTeamIdx = null;
          rebuild();
        });

        this.addChild(card);
      });
    });

    // --- Unassigned Section ---
    const unassignedY = teamY + (Math.ceil(this.teams.length / teamsPerRow) || 1) * (cardSize.height + 50) + 10;

    const unLabel = new Text({
      text: `UNASSIGNED (${this.unassigned.length})`,
      style: new TextStyle({ fontSize: 12, fill: COLORS.textMuted, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 2 }),
    });
    unLabel.x = 30;
    unLabel.y = unassignedY;
    this.addChild(unLabel);

    this.unassigned.forEach((cid, i) => {
      const inst = state.cards[cid];
      if (!inst) return;

      let def: CardDef | undefined;
      let stats: { lead: number; support: number } | undefined;
      try {
        def = getCardDefForInstance(state, cid);
        stats = getEffectiveStats(state, cid);
      } catch { /* skip */ }

      const card = new CardSprite({
        defId: inst.defId,
        size: cardSize,
        cardDef: def,
        instance: inst,
        effectiveStats: stats,
        interactive: true,
      });
      card.x = 30 + i * (cardSize.width + gap);
      card.y = unassignedY + 22;

      card.on('pointerdown', () => {
        if (this.activeTeamIdx !== null) {
          // Add as support to active team
          const team = this.teams[this.activeTeamIdx];
          if (team && team.supportIds.length < 2) { // max 3 total (1 lead + 2 supports)
            team.supportIds.push(cid);
            this.unassigned = this.unassigned.filter((id) => id !== cid);
            rebuild();
          }
        } else {
          // Create new team with this as lead
          this.teams.push({ leadId: cid, supportIds: [] });
          this.unassigned = this.unassigned.filter((id) => id !== cid);
          this.activeTeamIdx = this.teams.length - 1;
          rebuild();
        }
      });

      this.addChild(card);
    });

    // --- Buttons ---
    const btnY = layout.height - 70;
    const btnW = 140;
    const btnH = 38;
    const btnGap = 16;

    // Auto Organize
    const autoBtn = this.makeButton('AUTO', btnW, btnH, 0x374151);
    autoBtn.x = layout.width / 2 - btnW * 1.5 - btnGap;
    autoBtn.y = btnY;
    autoBtn.on('pointerdown', () => {
      const aiAction = getAIAction(state, player);
      if (aiAction.type === 'organize-teams') {
        this.teams = aiAction.teams.map((t) => ({
          leadId: t.leadId,
          supportIds: t.supportIds,
        }));
        this.unassigned = state.players[player].kingdom.filter(
          (id) => !this.teams.some((t) => t.leadId === id || t.supportIds.includes(id))
        );
        this.activeTeamIdx = null;
        rebuild();
      }
    });
    this.addChild(autoBtn);

    // Cancel
    const cancelBtn = this.makeButton('CANCEL', btnW, btnH, 0x374151);
    cancelBtn.x = layout.width / 2 - btnW / 2;
    cancelBtn.y = btnY;
    cancelBtn.on('pointerdown', () => {
      dispatch({ type: 'CLEAR_SELECTION' });
    });
    this.addChild(cancelBtn);

    // Confirm
    const confirmBtn = this.makeButton('CONFIRM', btnW, btnH, COLORS.buttonPrimary);
    confirmBtn.x = layout.width / 2 + btnW / 2 + btnGap;
    confirmBtn.y = btnY;
    confirmBtn.on('pointerdown', () => {
      dispatch({
        type: 'PERFORM_ACTION',
        player,
        action: {
          type: 'organize-teams',
          teams: this.teams.map((t) => ({ leadId: t.leadId, supportIds: t.supportIds })),
        },
      });
      dispatch({ type: 'CLEAR_SELECTION' });
    });
    this.addChild(confirmBtn);
  }

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
      style: new TextStyle({ fontSize: 12, fill: COLORS.textBright, fontFamily: 'Arial, sans-serif', fontWeight: 'bold', letterSpacing: 1 }),
    });
    txt.anchor.set(0.5, 0.5);
    txt.x = w / 2;
    txt.y = h / 2;
    c.addChild(txt);
    return c;
  }
}
