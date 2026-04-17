// ============================================================
// Primal TCG — PixiJS Animations & Effects
// ============================================================
// GSAP-powered animations for card game events.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';
import { COLORS } from '../layout';
import { FONT } from '../SharedStyles';

// ============================================================
// Turn Banner — sweeping "YOUR TURN" / "OPPONENT'S TURN" banner
// ============================================================

export function showTurnBanner(
  parent: Container,
  text: string,
  screenW: number,
  screenH: number,
): void {
  const banner = new Container();

  // Background bar
  const bg = new Graphics();
  const barH = 60;
  bg.rect(0, 0, screenW, barH);
  bg.fill({ color: 0x000000, alpha: 0.85 });
  banner.addChild(bg);

  // Accent lines
  for (const y of [0, barH]) {
    const line = new Graphics();
    line.moveTo(0, y);
    line.lineTo(screenW, y);
    line.stroke({ color: COLORS.accentBlue, width: 2, alpha: 0.7 });
    banner.addChild(line);
  }

  // Text
  const txt = new Text({
    text: text.toUpperCase(),
    style: new TextStyle({
      fontSize: 28,
      fill: COLORS.textBright,
      fontFamily: FONT,
      fontWeight: 'bold',
      letterSpacing: 8,
    }),
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = screenW / 2;
  txt.y = barH / 2;
  banner.addChild(txt);

  banner.y = screenH / 2 - barH / 2;
  banner.alpha = 0;
  parent.addChild(banner);

  // Animate
  const tl = gsap.timeline({
    onComplete: () => {
      parent.removeChild(banner);
      banner.destroy();
    },
  });

  tl.fromTo(banner, { alpha: 0, x: -screenW }, { alpha: 1, x: 0, duration: 0.3, ease: 'power2.out' })
    .to(banner, { duration: 0.8 }) // hold
    .to(banner, { alpha: 0, x: screenW, duration: 0.3, ease: 'power2.in' });
}

// ============================================================
// Phase Banner — smaller phase label sweep
// ============================================================

// Phase-to-accent-color mapping
const PHASE_ACCENT_COLORS: Record<string, number> = {
  'Main Phase': COLORS.accentCyan,
  'Organization': COLORS.accentGold,
  'Attack Step': 0xef4444,        // red
  'Block Step': 0x3b82f6,         // blue
  'Exchange of Ability': 0xa855f7, // purple
  'Showdown': 0xf59e0b,           // gold
  'End Phase': 0x6b7280,          // gray
};

export function showPhaseBanner(
  parent: Container,
  text: string,
  screenW: number,
  screenH: number,
): void {
  const banner = new Container();
  const accentColor = PHASE_ACCENT_COLORS[text] ?? COLORS.accentBlue;

  const barH = 38;
  const barW = screenW * 0.55;

  // Skewed background (diagonal wipe look via parallelogram)
  const bg = new Graphics();
  const skew = 12;
  bg.moveTo(skew, 0);
  bg.lineTo(barW + skew, 0);
  bg.lineTo(barW - skew, barH);
  bg.lineTo(-skew, barH);
  bg.closePath();
  bg.fill({ color: 0x0c1425, alpha: 0.92 });
  banner.addChild(bg);

  // Top accent line
  const topLine = new Graphics();
  topLine.moveTo(skew, 0);
  topLine.lineTo(barW + skew, 0);
  topLine.stroke({ color: accentColor, width: 2, alpha: 0.9 });
  banner.addChild(topLine);

  // Bottom accent line
  const botLine = new Graphics();
  botLine.moveTo(-skew, barH);
  botLine.lineTo(barW - skew, barH);
  botLine.stroke({ color: accentColor, width: 2, alpha: 0.9 });
  banner.addChild(botLine);

  // Inner glow band
  const glowBand = new Graphics();
  glowBand.rect(0, 1, barW, barH - 2);
  glowBand.fill({ color: accentColor, alpha: 0.06 });
  banner.addChild(glowBand);

  // Text
  const txt = new Text({
    text: text.toUpperCase(),
    style: new TextStyle({
      fontSize: 17,
      fill: accentColor,
      fontFamily: FONT,
      fontWeight: 'bold',
      letterSpacing: 5,
    }),
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = barW / 2;
  txt.y = barH / 2;
  banner.addChild(txt);

  // Position centered above the center bar
  banner.x = (screenW - barW) / 2;
  banner.y = screenH / 2 - barH / 2 - 60;
  banner.alpha = 0;
  parent.addChild(banner);

  const tl = gsap.timeline({
    onComplete: () => {
      parent.removeChild(banner);
      banner.destroy({ children: true });
    },
  });

  // Screen dim behind banner
  const dim = new Graphics();
  dim.rect(0, 0, screenW, screenH);
  dim.fill({ color: 0x000000, alpha: 0.3 });
  dim.alpha = 0;
  parent.addChild(dim);
  // Make sure banner is above dim
  parent.removeChild(banner);
  parent.addChild(banner);

  // Diagonal wipe entrance: slide in from left with fade
  tl.to(dim, { alpha: 1, duration: 0.15 })
    .fromTo(banner, { alpha: 0, x: -barW * 0.3 }, { alpha: 1, x: (screenW - barW) / 2, duration: 0.25, ease: 'power3.out' }, '<')
    .fromTo(txt.scale, { x: 1.2, y: 1.2 }, { x: 1, y: 1, duration: 0.2, ease: 'back.out(1.5)' }, '<0.05')
    // Particle accents on entrance
    .call(() => {
      particleBurst(parent, screenW / 2, banner.y + barH / 2, accentColor, 16);
    })
    // Hold
    .to(banner, { duration: 0.5 })
    // Diagonal wipe exit: slide out right
    .to(dim, { alpha: 0, duration: 0.2 })
    .to(banner, { alpha: 0, x: screenW * 0.3, duration: 0.2, ease: 'power2.in' }, '<')
    .call(() => {
      parent.removeChild(dim);
      dim.destroy();
    });
}

// ============================================================
// Damage Numbers — floating "-X" text
// ============================================================

export function showDamageNumber(
  parent: Container,
  amount: number,
  x: number,
  y: number,
  isHeavy = false,
): void {
  const fontSize = isHeavy ? 36 : 28;
  const popScale = isHeavy ? 2.2 : 1.6;
  const particleCount = isHeavy ? 12 : 6;
  const floatDist = 70;

  const txt = new Text({
    text: `-${amount}`,
    style: new TextStyle({
      fontSize,
      fill: COLORS.injuredDot,
      fontFamily: FONT,
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 3 },
    }),
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = x;
  txt.y = y;
  parent.addChild(txt);

  // Impact particles on damage
  particleBurst(parent, x, y, COLORS.injuredDot, particleCount);

  gsap.to(txt, {
    y: y - floatDist,
    alpha: 0,
    duration: 1,
    ease: 'power2.out',
    onComplete: () => {
      parent.removeChild(txt);
      txt.destroy();
    },
  });

  gsap.fromTo(txt.scale, { x: popScale, y: popScale }, { x: 1, y: 1, duration: 0.2, ease: 'back.out' });
}

// ============================================================
// Screen Shake
// ============================================================

export function screenShake(target: Container, intensity = 4, duration = 0.3): void {
  const origX = target.x;
  const origY = target.y;

  gsap.to(target, {
    x: origX + intensity,
    duration: 0.03,
    repeat: Math.floor(duration / 0.06),
    yoyo: true,
    ease: 'none',
    onComplete: () => {
      target.x = origX;
      target.y = origY;
    },
    onUpdate: () => {
      target.x = origX + (Math.random() - 0.5) * intensity * 2;
      target.y = origY + (Math.random() - 0.5) * intensity * 2;
    },
  });
}

// ============================================================
// Screen Flash
// ============================================================

export function screenFlash(
  parent: Container,
  screenW: number,
  screenH: number,
  color = 0xffffff,
): void {
  const flash = new Graphics();
  flash.rect(0, 0, screenW, screenH);
  flash.fill({ color, alpha: 0.4 });
  parent.addChild(flash);

  gsap.to(flash, {
    alpha: 0,
    duration: 0.4,
    ease: 'power2.out',
    onComplete: () => {
      parent.removeChild(flash);
      flash.destroy();
    },
  });
}

// ============================================================
// Card Summon Animation — card flies from hand to kingdom
// ============================================================

export function animateCardSummon(
  card: Container,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Promise<void> {
  return new Promise((resolve) => {
    card.x = fromX;
    card.y = fromY;
    card.alpha = 0;
    card.scale.set(0.5);

    gsap.to(card, {
      x: toX,
      y: toY,
      alpha: 1,
      duration: 0.4,
      ease: 'power2.out',
      onComplete: resolve,
    });
    gsap.to(card.scale, {
      x: 1,
      y: 1,
      duration: 0.4,
      ease: 'back.out',
    });
  });
}

// ============================================================
// Card Destroy Animation — card dissolves
// ============================================================

export function animateCardDestroy(card: Container, parent?: Container): Promise<void> {
  return new Promise((resolve) => {
    // Destruction particles at card position
    const burstParent = parent ?? card.parent;
    if (burstParent) {
      const bounds = card.getBounds();
      particleBurst(burstParent, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 0xef4444, 10);
    }

    gsap.to(card, {
      alpha: 0,
      y: card.y + 20,
      duration: 0.4,
      ease: 'power2.in',
      onComplete: () => {
        card.destroy();
        resolve();
      },
    });
    gsap.to(card.scale, {
      x: 0.8,
      y: 0.8,
      duration: 0.4,
    });
  });
}

// ============================================================
// Attack Lunge Animation
// ============================================================

export function animateAttackLunge(
  card: Container,
  targetX: number,
  targetY: number,
): Promise<void> {
  return new Promise((resolve) => {
    const origX = card.x;
    const origY = card.y;

    const tl = gsap.timeline({ onComplete: resolve });

    tl.to(card, {
      x: targetX,
      y: targetY,
      duration: 0.2,
      ease: 'power2.in',
    })
    .to(card, {
      x: origX,
      y: origY,
      duration: 0.3,
      ease: 'power2.out',
    });
  });
}

// ============================================================
// Draw Card Animation — slides from deck
// ============================================================

export function animateDrawCard(
  card: Container,
  fromX: number,
  fromY: number,
): Promise<void> {
  return new Promise((resolve) => {
    const toX = card.x;
    const toY = card.y;
    card.x = fromX;
    card.y = fromY;
    card.alpha = 0;

    gsap.to(card, {
      x: toX,
      y: toY,
      alpha: 1,
      duration: 0.35,
      ease: 'power2.out',
      onComplete: resolve,
    });
  });
}

// ============================================================
// Particle Burst — hit/impact effect
// ============================================================

export function particleBurst(
  parent: Container,
  x: number,
  y: number,
  color = COLORS.accentGold,
  count = 12,
): void {
  for (let i = 0; i < count; i++) {
    const particle = new Graphics();
    const size = 2 + Math.random() * 3;
    particle.circle(0, 0, size);
    particle.fill({ color, alpha: 0.9 });
    particle.x = x;
    particle.y = y;
    parent.addChild(particle);

    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 30 + Math.random() * 40;

    gsap.to(particle, {
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      alpha: 0,
      duration: 0.4 + Math.random() * 0.3,
      ease: 'power2.out',
      onComplete: () => {
        parent.removeChild(particle);
        particle.destroy();
      },
    });

    gsap.to(particle.scale, {
      x: 0,
      y: 0,
      duration: 0.5 + Math.random() * 0.2,
    });
  }
}

// ============================================================
// Chain Notification — card art popup in center
// ============================================================

export function showChainNotification(
  parent: Container,
  text: string,
  screenW: number,
  screenH: number,
): void {
  const c = new Container();

  const bg = new Graphics();
  const w = 200;
  const h = 40;
  bg.roundRect(-w / 2, -h / 2, w, h, 8);
  bg.fill({ color: 0x1a1a2e, alpha: 0.9 });
  bg.stroke({ color: COLORS.accentGold, width: 1, alpha: 0.6 });
  c.addChild(bg);

  const txt = new Text({
    text,
    style: new TextStyle({
      fontSize: 12,
      fill: COLORS.accentGold,
      fontFamily: FONT,
      fontWeight: 'bold',
    }),
  });
  txt.anchor.set(0.5, 0.5);
  c.addChild(txt);

  c.x = screenW / 2;
  c.y = screenH / 2;
  c.alpha = 0;
  c.scale.set(0.8);
  parent.addChild(c);

  const tl = gsap.timeline({
    onComplete: () => {
      parent.removeChild(c);
      c.destroy();
    },
  });

  tl.to(c, { alpha: 1, duration: 0.15 })
    .to(c.scale, { x: 1, y: 1, duration: 0.15, ease: 'back.out' }, '<')
    .to(c, { duration: 0.5 })
    .to(c, { alpha: 0, y: c.y - 30, duration: 0.3 });
}

// ============================================================
// Effect Description Callout — wider panel with multi-line text
// ============================================================

export interface EffectCalloutOptions {
  waitForClick?: boolean;
}

export function showEffectCallout(
  parent: Container,
  cardName: string,
  description: string,
  screenW: number,
  screenH: number,
  options?: EffectCalloutOptions,
): Promise<void> {
  const waitForClick = options?.waitForClick ?? false;

  return new Promise((resolve) => {
    const c = new Container();

    const maxW = Math.min(400, screenW * 0.7);
    const padX = 16;
    const padY = 12;

    // Clickable backdrop (only when waitForClick)
    let backdropHit: Graphics | null = null;
    if (waitForClick) {
      backdropHit = new Graphics();
      backdropHit.rect(-screenW, -screenH, screenW * 2, screenH * 2);
      backdropHit.fill({ color: 0x000000, alpha: 0.001 }); // invisible but clickable
      backdropHit.eventMode = 'static';
      c.addChild(backdropHit);
    }

    // Card name header
    const nameTxt = new Text({
      text: cardName.toUpperCase(),
      style: new TextStyle({
        fontSize: 13,
        fill: COLORS.accentGold,
        fontFamily: FONT,
        fontWeight: 'bold',
        letterSpacing: 2,
      }),
    });
    nameTxt.anchor.set(0.5, 0);
    nameTxt.x = 0;
    nameTxt.y = padY;

    // Description text
    const descTxt = new Text({
      text: description,
      style: new TextStyle({
        fontSize: 11,
        fill: COLORS.text,
        fontFamily: FONT,
        wordWrap: true,
        wordWrapWidth: maxW - padX * 2,
        lineHeight: 16,
      }),
    });
    descTxt.anchor.set(0.5, 0);
    descTxt.x = 0;
    descTxt.y = padY + nameTxt.height + 8;

    let totalH = padY + nameTxt.height + 8 + descTxt.height + padY;

    // "Tap to continue" hint
    let hintTxt: Text | null = null;
    if (waitForClick) {
      hintTxt = new Text({
        text: 'TAP TO CONTINUE',
        style: new TextStyle({
          fontSize: 10,
          fill: COLORS.textMuted,
          fontFamily: FONT,
          fontWeight: 'bold',
          letterSpacing: 2,
        }),
      });
      hintTxt.anchor.set(0.5, 0);
      hintTxt.x = 0;
      hintTxt.y = totalH;
      totalH += hintTxt.height + padY;
    }

    const panelW = Math.max(nameTxt.width + padX * 2, descTxt.width + padX * 2, 200);

    // Background panel
    const bg = new Graphics();
    bg.roundRect(-panelW / 2, 0, panelW, totalH, 10);
    bg.fill({ color: 0x0f1729, alpha: 0.95 });
    bg.stroke({ color: COLORS.accentGold, width: 2, alpha: 0.5 });
    c.addChild(bg);

    // Accent line under card name
    const accent = new Graphics();
    accent.moveTo(-panelW / 2 + padX, padY + nameTxt.height + 4);
    accent.lineTo(panelW / 2 - padX, padY + nameTxt.height + 4);
    accent.stroke({ color: COLORS.accentGold, width: 1, alpha: 0.3 });
    c.addChild(accent);

    c.addChild(nameTxt);
    c.addChild(descTxt);
    if (hintTxt) c.addChild(hintTxt);

    c.x = screenW / 2;
    c.y = screenH / 2 + 80; // Below center
    c.alpha = 0;
    c.scale.set(0.9);
    parent.addChild(c);

    const cleanup = () => {
      parent.removeChild(c);
      c.destroy({ children: true });
      resolve();
    };

    if (waitForClick) {
      // Animate in, then wait for click
      const tl = gsap.timeline();
      tl.to(c, { alpha: 1, duration: 0.2 })
        .to(c.scale, { x: 1, y: 1, duration: 0.2, ease: 'back.out(1.5)' }, '<')
        .call(() => {
          if (hintTxt) {
            gsap.to(hintTxt, {
              alpha: 0.4,
              duration: 0.8,
              repeat: -1,
              yoyo: true,
              ease: 'sine.inOut',
            });
          }

          // Make panel clickable
          bg.eventMode = 'static';
          bg.cursor = 'pointer';
          const dismiss = () => {
            gsap.to(c, {
              alpha: 0,
              y: c.y - 20,
              duration: 0.3,
              ease: 'power2.in',
              onComplete: cleanup,
            });
          };
          bg.on('pointerdown', dismiss);
          if (backdropHit) backdropHit.on('pointerdown', dismiss);
        });
    } else {
      // Original auto-dismiss behavior
      const tl = gsap.timeline({
        onComplete: cleanup,
      });

      tl.to(c, { alpha: 1, duration: 0.2 })
        .to(c.scale, { x: 1, y: 1, duration: 0.2, ease: 'back.out(1.5)' }, '<')
        .to(c, { duration: 0.7 }) // Hold for reading
        .to(c, { alpha: 0, y: c.y - 20, duration: 0.3, ease: 'power2.in' });
    }
  });
}

// ============================================================
// Team Clash Animation — attackers and blockers collide
// ============================================================

export function showTeamClash(
  parent: Container,
  screenW: number,
  screenH: number,
  attackerPower: number,
  blockerPower: number,
): Promise<void> {
  return new Promise((resolve) => {
    const centerX = screenW / 2;
    const centerY = screenH / 2;

    // Attacker indicator (from left/bottom)
    const atkIndicator = new Graphics();
    atkIndicator.roundRect(-30, -20, 60, 40, 8);
    atkIndicator.fill({ color: 0xef4444, alpha: 0.8 });
    atkIndicator.x = -50;
    atkIndicator.y = centerY;
    parent.addChild(atkIndicator);

    const atkTxt = new Text({
      text: `${attackerPower}`,
      style: new TextStyle({ fontSize: 28, fill: 0xffffff, fontFamily: FONT, fontWeight: 'bold' }),
    });
    atkTxt.anchor.set(0.5, 0.5);
    atkIndicator.addChild(atkTxt);

    // Blocker indicator (from right/top)
    const blkIndicator = new Graphics();
    blkIndicator.roundRect(-30, -20, 60, 40, 8);
    blkIndicator.fill({ color: 0x3b82f6, alpha: 0.8 });
    blkIndicator.x = screenW + 50;
    blkIndicator.y = centerY;
    parent.addChild(blkIndicator);

    const blkTxt = new Text({
      text: `${blockerPower}`,
      style: new TextStyle({ fontSize: 28, fill: 0xffffff, fontFamily: FONT, fontWeight: 'bold' }),
    });
    blkTxt.anchor.set(0.5, 0.5);
    blkIndicator.addChild(blkTxt);

    const tl = gsap.timeline({
      onComplete: () => {
        parent.removeChild(atkIndicator);
        parent.removeChild(blkIndicator);
        atkIndicator.destroy({ children: true });
        blkIndicator.destroy({ children: true });
        resolve();
      },
    });

    // Slide toward center
    tl.to(atkIndicator, { x: centerX - 40, duration: 0.3, ease: 'power2.in' })
      .to(blkIndicator, { x: centerX + 40, duration: 0.3, ease: 'power2.in' }, '<')
      // Impact
      .call(() => {
        screenShake(parent, 8, 0.35);
        particleBurst(parent, centerX, centerY, 0xffffff, 40);
        particleBurst(parent, centerX, centerY, COLORS.accentGold, 12);
        screenFlash(parent, screenW, screenH, 0xffffff);
      })
      // Result text
      .call(() => {
        const resultLabel = attackerPower > blockerPower ? 'ATTACKER WINS!'
          : blockerPower > attackerPower ? 'DEFENDER WINS!'
          : 'DRAW!';
        const resultColor = attackerPower > blockerPower ? 0xef4444
          : blockerPower > attackerPower ? 0x3b82f6
          : 0xf59e0b;
        const resultTxt = new Text({
          text: resultLabel,
          style: new TextStyle({ fontSize: 22, fill: resultColor, fontFamily: FONT, fontWeight: 'bold', letterSpacing: 3, stroke: { color: 0x000000, width: 3 } }),
        });
        resultTxt.anchor.set(0.5, 0.5);
        resultTxt.x = centerX;
        resultTxt.y = centerY + 40;
        resultTxt.alpha = 0;
        parent.addChild(resultTxt);
        gsap.to(resultTxt, { alpha: 1, duration: 0.15 });
        gsap.to(resultTxt, { alpha: 0, duration: 0.3, delay: 0.5, onComplete: () => {
          parent.removeChild(resultTxt); resultTxt.destroy();
        }});
      })
      // Hold
      .to({}, { duration: 0.6 })
      // Fade out
      .to(atkIndicator, { alpha: 0, duration: 0.2 })
      .to(blkIndicator, { alpha: 0, duration: 0.2 }, '<');
  });
}

// ============================================================
// Enhanced Battle Reward Celebration
// ============================================================

export function showBattleRewardCelebration(
  parent: Container,
  screenW: number,
  screenH: number,
  rewardCount: number,
): void {
  // Multi-wave particle bursts (center + offset positions)
  particleBurst(parent, screenW / 2, screenH / 2, COLORS.accentGold, 50);
  // Delayed secondary gold bursts at offset positions
  setTimeout(() => particleBurst(parent, screenW * 0.35, screenH / 2 - 20, 0xfbbf24, 18), 100);
  setTimeout(() => particleBurst(parent, screenW * 0.65, screenH / 2 + 20, 0xfbbf24, 18), 200);

  // Screen flash
  screenFlash(parent, screenW, screenH, COLORS.accentGold);

  // Heavier screen shake
  screenShake(parent, 8, 0.5);

  // "BATTLE REWARD!" sweep banner
  const banner = new Container();
  const bg = new Graphics();
  const barH = 44;
  bg.rect(0, 0, screenW * 0.6, barH);
  bg.fill({ color: 0x000000, alpha: 0.85 });
  banner.addChild(bg);

  const topLine = new Graphics();
  topLine.moveTo(0, 0);
  topLine.lineTo(screenW * 0.6, 0);
  topLine.stroke({ color: COLORS.accentGold, width: 2, alpha: 0.8 });
  banner.addChild(topLine);

  const botLine = new Graphics();
  botLine.moveTo(0, barH);
  botLine.lineTo(screenW * 0.6, barH);
  botLine.stroke({ color: COLORS.accentGold, width: 2, alpha: 0.8 });
  banner.addChild(botLine);

  const txt = new Text({
    text: `BATTLE REWARD! ×${rewardCount}`,
    style: new TextStyle({
      fontSize: 22,
      fill: COLORS.accentGold,
      fontFamily: FONT,
      fontWeight: 'bold',
      letterSpacing: 4,
    }),
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = screenW * 0.3;
  txt.y = barH / 2;
  banner.addChild(txt);

  banner.x = screenW * 0.2;
  banner.y = screenH / 2 - barH / 2;
  banner.alpha = 0;
  parent.addChild(banner);

  const tl = gsap.timeline({
    onComplete: () => {
      parent.removeChild(banner);
      banner.destroy({ children: true });
    },
  });

  tl.fromTo(banner, { alpha: 0, x: -screenW * 0.3 }, { alpha: 1, x: screenW * 0.2, duration: 0.3, ease: 'power2.out' })
    .to(banner, { duration: 0.8 }) // hold
    .to(banner, { alpha: 0, x: screenW, duration: 0.3, ease: 'power2.in' });
}

// ============================================================
// Pass Priority Indicator
// ============================================================

export function showPassIndicator(
  parent: Container,
  screenW: number,
  screenH: number,
  isPlayer: boolean,
): void {
  const txt = new Text({
    text: 'PASS',
    style: new TextStyle({
      fontSize: 18,
      fill: 0x6b7280,
      fontFamily: FONT,
      fontWeight: 'bold',
      letterSpacing: 4,
    }),
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = screenW / 2;
  txt.y = isPlayer ? screenH * 0.65 : screenH * 0.35;
  txt.alpha = 0;
  parent.addChild(txt);

  const tl = gsap.timeline({
    onComplete: () => {
      parent.removeChild(txt);
      txt.destroy();
    },
  });

  tl.to(txt, { alpha: 0.8, duration: 0.15 })
    .to(txt, { duration: 0.3 }) // hold
    .to(txt, { alpha: 0, y: txt.y - 20, duration: 0.4, ease: 'power2.out' });
}

// ============================================================
// Active Player Border Glow
// ============================================================

export function drawActivePlayerGlow(
  parent: Container,
  screenW: number,
  dividerY: number,
  isPlayerTurn: boolean,
): Graphics {
  const glow = new Graphics();
  const color = isPlayerTurn ? COLORS.accentCyan : COLORS.player2Color;
  const glowY = isPlayerTurn ? dividerY + 2 : dividerY - 2;

  // Gradient-like glow line
  glow.moveTo(0, glowY);
  glow.lineTo(screenW, glowY);
  glow.stroke({ color, width: 3, alpha: 0.4 });

  // Softer outer glow
  glow.moveTo(0, glowY);
  glow.lineTo(screenW, glowY);
  glow.stroke({ color, width: 8, alpha: 0.1 });

  parent.addChild(glow);

  // Pulse animation
  gsap.to(glow, {
    alpha: 0.6,
    duration: 1,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut',
  });

  return glow;
}
