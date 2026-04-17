// ============================================================
// Primal TCG — Team Organization Overlay
// ============================================================
// Per rules 5.4: During Organization Phase, all kingdom characters
// are separated into teams of 1, then organized into teams of up to 3.
// Every character must always be in a team — no "unassigned" pool.

import { Container, Graphics, Text, TextStyle, FederatedPointerEvent } from 'pixi.js';
import gsap from 'gsap';
import { CardSprite } from '../CardSprite';
import { COLORS, CARD_SIZES, BoardLayout, CardSize } from '../layout';
import { FONT } from '../SharedStyles';
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
  private activeTeamIdx: number | null = null;

  // Drag state
  private dragSprite: CardSprite | null = null;
  private dragCardId: string | null = null;
  private dragOrigin: { teamIdx: number; role: 'lead' | 'support' } | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private teamDropZones: { idx: number; x: number; y: number; w: number; h: number }[] = [];

  constructor(
    state: GameState,
    ui: UIState,
    layout: BoardLayout,
    dispatch: (action: UIAction) => void,
  ) {
    super();

    const humanPlayer = ui.humanPlayer;
    const pState = state.players[humanPlayer];

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

    // Per rules 5.4 step 1: all kingdom characters not in a team get their own solo team
    for (const id of pState.kingdom) {
      if (teamedIds.has(id)) continue;
      const card = state.cards[id];
      if (!card || card.state === undefined) continue; // skip non-characters (permanent strategies)
      try {
        const cDef = getCardDefForInstance(state, id);
        if (cDef.cardType !== 'character') continue;
      } catch { continue; }
      this.teams.push({ leadId: id, supportIds: [] });
    }

    // ---- Backdrop with deep overlay ----
    const backdrop = new Graphics();
    backdrop.rect(0, 0, layout.width, layout.height);
    backdrop.fill({ color: 0x050a14, alpha: 0.88 });
    backdrop.eventMode = 'static';
    this.addChild(backdrop);

    // Subtle radial glow in center
    const glow = new Graphics();
    glow.circle(layout.width / 2, layout.height * 0.45, Math.min(layout.width, layout.height) * 0.4);
    glow.fill({ color: COLORS.accentBlue, alpha: 0.03 });
    this.addChild(glow);

    // Register drag events on the overlay container itself
    this.eventMode = 'static';
    this.on('pointermove', (e: FederatedPointerEvent) => this.onDragMove(e));
    this.on('pointerup', () => this.onDragEnd(state, layout, () => rebuild()));
    this.on('pointerupoutside', () => this.onDragEnd(state, layout, () => rebuild()));

    // ---- Decorative top line ----
    const lineW = layout.width * 0.35;
    const topLine = new Graphics();
    topLine.moveTo(layout.width / 2 - lineW / 2, 16);
    topLine.lineTo(layout.width / 2 + lineW / 2, 16);
    topLine.stroke({ color: COLORS.accentBlue, width: 1, alpha: 0.3 });
    this.addChild(topLine);

    // ---- Title ----
    const title = new Text({
      text: 'ORGANIZE TEAMS',
      style: new TextStyle({
        fontSize: 28,
        fill: COLORS.textBright,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 6,
      }),
    });
    title.anchor.set(0.5, 0);
    title.x = layout.width / 2;
    title.y = 22;
    this.addChild(title);

    // Accent lines flanking title
    for (const dir of [-1, 1]) {
      const accent = new Graphics();
      const ax = layout.width / 2 + dir * (title.width / 2 + 16);
      accent.moveTo(ax, title.y + 16);
      accent.lineTo(ax + dir * 50, title.y + 16);
      accent.stroke({ color: COLORS.accentBlue, width: 2, alpha: 0.4 });
      this.addChild(accent);
    }

    // ---- Subtitle ----
    const sub = new Text({
      text: 'Drag characters between teams. Max 3 per team.',
      style: new TextStyle({
        fontSize: 13,
        fill: COLORS.textMuted,
        fontFamily: FONT,
        fontStyle: 'italic',
      }),
    });
    sub.anchor.set(0.5, 0);
    sub.x = layout.width / 2;
    sub.y = title.y + 40;
    this.addChild(sub);

    // Static children count: backdrop(0), glow(1), topLine(2), title(3), accent(4), accent(5), sub(6) = 7
    const staticCount = this.children.length;

    // Render function (called to rebuild on changes)
    const rebuild = () => {
      while (this.children.length > staticCount) {
        this.removeChildAt(staticCount);
      }
      this.teamDropZones = [];
      this.renderContent(state, humanPlayer, layout, dispatch, rebuild);
    };

    rebuild();

    // Slide-in animation
    this.alpha = 0;
    gsap.to(this, { alpha: 1, duration: 0.25, ease: 'power2.out' });
  }

  private renderContent(
    state: GameState,
    player: PlayerId,
    layout: BoardLayout,
    dispatch: (action: UIAction) => void,
    rebuild: () => void,
  ): void {
    const teamGap = 16;
    const sectionY = 80;

    // Pick a card size that fits
    const availH = layout.height - sectionY - 130; // leave room for buttons
    const maxRows = Math.ceil(this.teams.length / 4);
    const pyramidHBudget = (availH - (maxRows - 1) * 16) / Math.max(maxRows, 1);

    // Choose card size based on available space
    let cardSize: CardSize;
    if (pyramidHBudget >= 230) cardSize = CARD_SIZES.lg;
    else if (pyramidHBudget >= 160) cardSize = CARD_SIZES.md;
    else cardSize = CARD_SIZES.sm;

    // --- Teams section header ---
    const soloCount = this.teams.filter((t) => t.supportIds.length === 0).length;
    const groupCount = this.teams.length - soloCount;

    const teamsLabel = new Text({
      text: `TEAMS`,
      style: new TextStyle({
        fontSize: 12,
        fill: COLORS.accentBlue,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 3,
      }),
    });
    teamsLabel.anchor.set(0.5, 0);
    teamsLabel.x = layout.width / 2;
    teamsLabel.y = sectionY;
    this.addChild(teamsLabel);

    // Team count pill
    const countPill = new Graphics();
    const countText = `${groupCount} group${groupCount !== 1 ? 's' : ''} · ${soloCount} solo`;
    const countTxt = new Text({
      text: countText,
      style: new TextStyle({
        fontSize: 10,
        fill: COLORS.textMuted,
        fontFamily: FONT,
        letterSpacing: 1,
      }),
    });
    countTxt.anchor.set(0.5, 0);
    countTxt.x = layout.width / 2;
    countTxt.y = sectionY + 18;
    this.addChild(countTxt);

    const teamY = sectionY + 36;

    // Pyramid dimensions for team panels
    const pyramidW = cardSize.width * 2.5;
    const pyramidH = cardSize.height * 1.7 + 24;
    const teamsPerRow = Math.max(1, Math.floor((layout.width - 40) / (pyramidW + teamGap)));
    const totalTeamW = Math.min(this.teams.length, teamsPerRow) * (pyramidW + teamGap) - teamGap;
    const offsetX = (layout.width - totalTeamW) / 2;

    this.teams.forEach((team, idx) => {
      const allIds = [team.leadId, ...team.supportIds];
      const colIdx = idx % teamsPerRow;
      const rowIdx = Math.floor(idx / teamsPerRow);
      const teamX = offsetX + colIdx * (pyramidW + teamGap);
      const ty = teamY + rowIdx * (pyramidH + 16);

      // Store drop zone for dragging
      this.teamDropZones.push({ idx, x: teamX, y: ty, w: pyramidW, h: pyramidH });

      const isActive = this.activeTeamIdx === idx;
      const isSolo = allIds.length === 1;

      // Team panel background
      const panel = new Graphics();
      panel.roundRect(teamX, ty, pyramidW, pyramidH, 8);
      panel.fill({ color: isActive ? 0x0f1d35 : 0x0a1020, alpha: 0.85 });

      // Border - different styles for active, group, solo
      if (isActive) {
        panel.stroke({ color: COLORS.accentBlue, width: 2, alpha: 0.8 });
      } else if (!isSolo) {
        panel.stroke({ color: COLORS.accentBlue, width: 1, alpha: 0.25 });
      } else {
        panel.stroke({ color: 0x374151, width: 1, alpha: 0.2 });
      }

      panel.eventMode = 'static';
      panel.cursor = 'pointer';
      panel.on('pointerdown', () => {
        this.activeTeamIdx = this.activeTeamIdx === idx ? null : idx;
        rebuild();
      });
      this.addChild(panel);

      // Active glow effect
      if (isActive) {
        const activeGlow = new Graphics();
        activeGlow.roundRect(teamX - 2, ty - 2, pyramidW + 4, pyramidH + 4, 10);
        activeGlow.stroke({ color: COLORS.accentBlue, width: 1, alpha: 0.15 });
        this.addChild(activeGlow);
      }

      // Team power / solo label pill
      let power = 0;
      for (const cid of allIds) {
        try {
          const stats = getEffectiveStats(state, cid);
          if (allIds.indexOf(cid) === 0) power += stats.lead;
          else power += stats.support;
        } catch { /* skip */ }
      }

      const pillW = isSolo ? 44 : 60;
      const pillH = 18;
      const pillX = teamX + pyramidW / 2 - pillW / 2;
      const pillY = ty + 5;

      const pill = new Graphics();
      pill.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
      pill.fill({ color: isSolo ? 0x1f2937 : 0x1a2744, alpha: 0.9 });
      pill.stroke({ color: isSolo ? 0x374151 : COLORS.accentBlue, width: 1, alpha: 0.3 });
      this.addChild(pill);

      const pwrTxt = new Text({
        text: isSolo ? 'SOLO' : `PWR ${power}`,
        style: new TextStyle({
          fontSize: 9,
          fill: isSolo ? COLORS.textMuted : COLORS.textGold,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 1,
        }),
      });
      pwrTxt.anchor.set(0.5, 0.5);
      pwrTxt.x = pillX + pillW / 2;
      pwrTxt.y = pillY + pillH / 2;
      this.addChild(pwrTxt);

      // Pyramid card positioning
      const teamCenterX = teamX + pyramidW / 2;
      const topCardY = ty + 28;

      // Render supports first (behind), leader last (on top)
      const renderOrder = allIds.length > 1
        ? [...allIds.keys()].sort((a, b) => { if (a === 0) return 1; if (b === 0) return -1; return a - b; })
        : [...allIds.keys()];
      renderOrder.forEach((ci) => {
        const cid = allIds[ci];
        const inst = state.cards[cid];
        if (!inst) return;

        let def: CardDef | undefined;
        let stats: { lead: number; support: number } | undefined;
        try {
          def = getCardDefForInstance(state, cid);
          stats = getEffectiveStats(state, cid);
        } catch { /* skip */ }

        const isInjured = inst.state === 'injured';
        const card = new CardSprite({
          defId: inst.defId,
          size: cardSize,
          cardDef: def,
          instance: inst,
          effectiveStats: stats,
          interactive: true,
          injured: isInjured,
        });

        // Pyramid positioning
        let cardX: number, cardY: number;
        if (ci === 0) {
          // Lead — centered top
          cardX = teamCenterX - cardSize.width / 2;
          cardY = topCardY;
        } else if (allIds.length === 2) {
          // Single support — centered below
          cardX = teamCenterX - cardSize.width / 2;
          cardY = topCardY + cardSize.height * 0.65;
        } else {
          // Two supports — spread below
          const offset = ci === 1 ? -cardSize.width * 0.6 : cardSize.width * 0.6;
          cardX = teamCenterX + offset - cardSize.width / 2;
          cardY = topCardY + cardSize.height * 0.65;
        }

        if (isInjured) {
          // Injured cards use pivot-based rotation, position at center
          card.x = cardX + cardSize.width / 2;
          card.y = cardY + cardSize.height / 2;
        } else {
          card.x = cardX;
          card.y = cardY;
        }

        // Role badge
        const roleIsLead = ci === 0;
        const roleBadgeW = 36;
        const roleBadgeH = 14;
        const roleBg = new Graphics();
        roleBg.roundRect(0, 0, roleBadgeW, roleBadgeH, roleBadgeH / 2);
        roleBg.fill({
          color: roleIsLead ? 0x78350f : 0x1e3a5f,
          alpha: 0.8,
        });
        roleBg.stroke({
          color: roleIsLead ? COLORS.leadColor : COLORS.supportColor,
          width: 1,
          alpha: 0.4,
        });
        roleBg.x = cardX + cardSize.width / 2 - roleBadgeW / 2;
        roleBg.y = cardY + cardSize.height + 3;
        this.addChild(roleBg);

        const roleTxt = new Text({
          text: roleIsLead ? 'LEAD' : 'SUP',
          style: new TextStyle({
            fontSize: 8,
            fill: roleIsLead ? COLORS.leadColor : COLORS.supportColor,
            fontFamily: FONT,
            fontWeight: 'bold',
            letterSpacing: 1,
          }),
        });
        roleTxt.anchor.set(0.5, 0.5);
        roleTxt.x = roleBg.x + roleBadgeW / 2;
        roleTxt.y = roleBg.y + roleBadgeH / 2;
        this.addChild(roleTxt);

        // Drag start
        card.on('pointerdown', (e: FederatedPointerEvent) => {
          e.stopPropagation();
          this.startDrag(e, cid, state, cardSize, { teamIdx: idx, role: ci === 0 ? 'lead' : 'support' });
        });

        this.addChild(card);
      });
    });

    // --- Buttons ---
    const btnY = layout.height - 76;
    const btnW = 150;
    const btnH = 44;
    const btnGap = 16;

    // Auto Organize
    const autoBtn = this.makeButton('AUTO', btnW, btnH, 0x1f2937, COLORS.accentCyan);
    autoBtn.x = layout.width / 2 - btnW * 1.5 - btnGap;
    autoBtn.y = btnY;
    autoBtn.on('pointerdown', () => {
      const aiAction = getAIAction(state, player);
      if (aiAction.type === 'organize-teams') {
        this.teams = aiAction.teams.map((t) => ({
          leadId: t.leadId,
          supportIds: t.supportIds,
        }));
        // Any kingdom characters not in AI teams get solo teams
        const aiTeamedIds = new Set<string>();
        this.teams.forEach((t) => {
          aiTeamedIds.add(t.leadId);
          t.supportIds.forEach((id) => aiTeamedIds.add(id));
        });
        for (const id of state.players[player].kingdom) {
          if (aiTeamedIds.has(id)) continue;
          const c = state.cards[id];
          if (!c || c.state === undefined) continue;
          try {
            const cDef = getCardDefForInstance(state, id);
            if (cDef.cardType !== 'character') continue;
          } catch { continue; }
          this.teams.push({ leadId: id, supportIds: [] });
        }
        this.activeTeamIdx = null;
        rebuild();
      }
    });
    this.addChild(autoBtn);

    // Cancel
    const cancelBtn = this.makeButton('CANCEL', btnW, btnH, 0x1f2937, 0x6b7280);
    cancelBtn.x = layout.width / 2 - btnW / 2;
    cancelBtn.y = btnY;
    cancelBtn.on('pointerdown', () => {
      dispatch({ type: 'CLEAR_SELECTION' });
    });
    this.addChild(cancelBtn);

    // Confirm
    const confirmBtn = this.makeButton('CONFIRM', btnW, btnH, COLORS.buttonPrimary, COLORS.buttonPrimary);
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

    // Button fade-in
    autoBtn.alpha = 0;
    cancelBtn.alpha = 0;
    confirmBtn.alpha = 0;
    gsap.to(autoBtn, { alpha: 1, duration: 0.3, delay: 0.15 });
    gsap.to(cancelBtn, { alpha: 1, duration: 0.3, delay: 0.2 });
    gsap.to(confirmBtn, { alpha: 1, duration: 0.3, delay: 0.25 });

    // ---- Bottom decorative line ----
    const botLine = new Graphics();
    const lineW = layout.width * 0.35;
    botLine.moveTo(layout.width / 2 - lineW / 2, btnY + btnH + 16);
    botLine.lineTo(layout.width / 2 + lineW / 2, btnY + btnH + 16);
    botLine.stroke({ color: COLORS.accentBlue, width: 1, alpha: 0.15 });
    this.addChild(botLine);

    // ---- Floating particles (ambient) ----
    for (let p = 0; p < 8; p++) {
      const particle = new Graphics();
      const px = Math.random() * layout.width;
      const py = Math.random() * layout.height;
      const pr = 1 + Math.random() * 1.5;
      particle.circle(0, 0, pr);
      particle.fill({ color: COLORS.accentBlue, alpha: 0.12 + Math.random() * 0.1 });
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
          particle.y = layout.height + 10;
          particle.alpha = 0.12 + Math.random() * 0.1;
        },
      });
    }
  }

  // ============================================================
  // Drag & Drop
  // ============================================================

  private startDrag(
    e: FederatedPointerEvent,
    cardId: string,
    state: GameState,
    cardSize: CardSize,
    origin: { teamIdx: number; role: 'lead' | 'support' },
  ): void {
    const inst = state.cards[cardId];
    if (!inst) return;

    let def: CardDef | undefined;
    let stats: { lead: number; support: number } | undefined;
    try {
      def = getCardDefForInstance(state, cardId);
      stats = getEffectiveStats(state, cardId);
    } catch { /* skip */ }

    // Create drag sprite
    this.dragSprite = new CardSprite({
      defId: inst.defId,
      size: cardSize,
      cardDef: def,
      instance: inst,
      effectiveStats: stats,
      selected: true,
    });
    this.dragSprite.alpha = 0.85;
    this.dragSprite.zIndex = 1000;

    const pos = e.getLocalPosition(this);
    this.dragOffsetX = cardSize.width / 2;
    this.dragOffsetY = cardSize.height / 2;
    this.dragSprite.x = pos.x - this.dragOffsetX;
    this.dragSprite.y = pos.y - this.dragOffsetY;

    this.dragCardId = cardId;
    this.dragOrigin = origin;
    this.addChild(this.dragSprite);
  }

  private onDragMove(e: FederatedPointerEvent): void {
    if (!this.dragSprite) return;
    const pos = e.getLocalPosition(this);
    this.dragSprite.x = pos.x - this.dragOffsetX;
    this.dragSprite.y = pos.y - this.dragOffsetY;
  }

  private onDragEnd(_state: GameState, _layout: BoardLayout, rebuild: () => void): void {
    if (!this.dragSprite || !this.dragCardId || !this.dragOrigin) return;

    const dropX = this.dragSprite.x + this.dragOffsetX;
    const dropY = this.dragSprite.y + this.dragOffsetY;
    const cardId = this.dragCardId;
    const origin = this.dragOrigin;

    // Clean up drag sprite
    this.removeChild(this.dragSprite);
    this.dragSprite.destroy();
    this.dragSprite = null;
    this.dragCardId = null;
    this.dragOrigin = null;

    // Find drop target team
    const targetZone = this.teamDropZones.find(
      (z) => dropX >= z.x && dropX <= z.x + z.w && dropY >= z.y && dropY <= z.y + z.h
    );

    // Same team — no-op
    if (targetZone && targetZone.idx === origin.teamIdx) {
      rebuild();
      return;
    }

    // Save reference to target team BEFORE modifying the array (splice can shift indices)
    const targetTeamObj = targetZone ? this.teams[targetZone.idx] : null;

    // Check if target team has room (max 3 characters per team)
    if (targetTeamObj) {
      const totalInTarget = 1 + targetTeamObj.supportIds.length; // lead + supports
      if (totalInTarget >= 3) {
        // Target full, snap back
        rebuild();
        return;
      }
    }

    // Remove card from origin team
    const originTeam = this.teams[origin.teamIdx];
    if (!originTeam) { rebuild(); return; }

    if (origin.role === 'lead') {
      if (originTeam.supportIds.length > 0) {
        // Promote first support to lead
        originTeam.leadId = originTeam.supportIds.shift()!;
      } else {
        // Solo team — remove the team entirely
        this.teams.splice(origin.teamIdx, 1);
      }
    } else {
      originTeam.supportIds = originTeam.supportIds.filter((id) => id !== cardId);
    }

    // Place card in target
    if (targetTeamObj) {
      // Add as support to existing team
      targetTeamObj.supportIds.push(cardId);
    } else {
      // Dropped in empty space — create a new solo team
      this.teams.push({ leadId: cardId, supportIds: [] });
    }

    this.activeTeamIdx = null;
    rebuild();
  }

  private makeButton(label: string, w: number, h: number, bgColor: number, accentColor: number): Container {
    const c = new Container();
    c.eventMode = 'static';
    c.cursor = 'pointer';

    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 8);
    bg.fill({ color: bgColor, alpha: 0.85 });
    bg.stroke({ color: accentColor, width: 1, alpha: 0.3 });
    c.addChild(bg);

    // Subtle top highlight
    const highlight = new Graphics();
    highlight.roundRect(1, 1, w - 2, h / 2, 8);
    highlight.fill({ color: 0xffffff, alpha: 0.04 });
    c.addChild(highlight);

    const txt = new Text({
      text: label,
      style: new TextStyle({
        fontSize: 14,
        fill: COLORS.textBright,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 2,
      }),
    });
    txt.anchor.set(0.5, 0.5);
    txt.x = w / 2;
    txt.y = h / 2;
    c.addChild(txt);

    return c;
  }
}
