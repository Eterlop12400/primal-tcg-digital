// ============================================================
// Primal TCG — Chain Resolution Effect
// ============================================================
// Shows each chain entry's close-up in LIFO order during resolve.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import gsap from 'gsap';
import { COLORS } from '../layout';
import { FONT } from '../SharedStyles';
import { showCardCloseUp } from './CardCloseUp';

/**
 * Show chain resolution sequence: numbered badges pop in order.
 * Each link shows a close-up before resolving.
 */
export async function showChainResolutionSequence(
  parent: Container,
  entries: { defId: string; cardName: string; index: number }[],
  screenW: number,
  screenH: number,
): Promise<void> {
  // Show "RESOLVING CHAIN" banner first
  const banner = new Container();
  const bg = new Graphics();
  const barH = 32;
  bg.roundRect(0, 0, 220, barH, 8);
  bg.fill({ color: 0x0f1729, alpha: 0.95 });
  bg.stroke({ color: COLORS.accentGold, width: 2, alpha: 0.5 });
  banner.addChild(bg);

  const txt = new Text({
    text: 'RESOLVING CHAIN',
    style: new TextStyle({
      fontSize: 13,
      fill: COLORS.accentGold,
      fontFamily: FONT,
      fontWeight: 'bold',
      letterSpacing: 3,
    }),
  });
  txt.anchor.set(0.5, 0.5);
  txt.x = 110;
  txt.y = barH / 2;
  banner.addChild(txt);

  banner.x = screenW / 2 - 110;
  banner.y = screenH / 2 - barH / 2 - 100;
  banner.alpha = 0;
  parent.addChild(banner);

  gsap.to(banner, { alpha: 1, duration: 0.2, ease: 'power2.out' });

  // Show each entry in reverse order (LIFO)
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    await showCardCloseUp(
      parent,
      entry.defId,
      entry.cardName,
      `CHAIN ${entry.index + 1} — RESOLVING`,
      screenW,
      screenH,
    );
  }

  // Clean up banner
  gsap.to(banner, {
    alpha: 0,
    duration: 0.2,
    onComplete: () => {
      parent.removeChild(banner);
      banner.destroy({ children: true });
    },
  });
}
