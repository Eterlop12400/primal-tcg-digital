// ============================================================
// Primal TCG — PixiJS Asset Loader
// ============================================================
// Preloads all card images and card back so they're ready for
// instant sprite creation during gameplay.

import { Assets, Texture } from 'pixi.js';
import { CARD_IMAGE_MAP, CARD_BACK_IMAGE } from '@/lib/cardImageMap';

let loaded = false;

/**
 * Preload all card textures. Safe to call multiple times — only loads once.
 */
export async function loadAllAssets(): Promise<void> {
  if (loaded) return;

  // Build the asset manifest: one entry per card + card back
  const bundle: Record<string, string> = {};

  for (const [defId, path] of Object.entries(CARD_IMAGE_MAP)) {
    bundle[defId] = path;
  }
  bundle['card-back'] = CARD_BACK_IMAGE;

  // Load all at once
  await Assets.load(Object.values(bundle).map((src) => ({ alias: getAlias(src), src })));

  loaded = true;
}

function getAlias(path: string): string {
  // Use the filename without extension as alias
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * Get a card texture by definition ID. Falls back to card-back if not found.
 */
export function getCardTexture(defId: string): Texture {
  const path = CARD_IMAGE_MAP[defId];
  if (path) {
    const alias = getAlias(path);
    const texture = Assets.get<Texture>(alias);
    if (texture) return texture;
  }
  return getCardBackTexture();
}

/**
 * Get the card back texture.
 */
export function getCardBackTexture(): Texture {
  return Assets.get<Texture>('card-back') ?? Texture.WHITE;
}
