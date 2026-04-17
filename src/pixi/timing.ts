// ============================================================
// Centralized Animation Timing Constants
// ============================================================
// Tune gameplay "feel" from one place. Durations are in seconds.
// Does NOT replace SPEED_PRESETS.animationSpeed — that flows through
// AnimationQueue for engine events. This module is for direct GSAP
// tweens (hover, press, overlay transitions).
// ============================================================

export const TIMING = {
  hoverIn: 0.15,
  hoverOut: 0.15,
  pressDown: 0.08,
  pressUp: 0.12,
  cardFly: 0.3,
  cardFlyQuick: 0.2,
  overlayFadeIn: 0.25,
  overlayFadeOut: 0.2,
  buttonPulse: 1.2,
  phaseBanner: 0.3,
  selectionFlash: 0.15,

  // Phase 7 polish constants
  phaseBannerHold: 0.6,
  turnBannerHold: 0.8,
  closeUpHold: 0.7,
  damagePopScale: 0.15,
  counterFlashDuration: 0.3,
  passIndicatorHold: 0.4,
  playableGlowPulse: 1.2,
  buttonHoverScale: 1.08,
  buttonHoverDuration: 0.12,
} as const;

/** Scale a named duration by the current speed preset multiplier. */
export function t(key: keyof typeof TIMING, speed = 1): number {
  return TIMING[key] / Math.max(0.25, speed);
}
