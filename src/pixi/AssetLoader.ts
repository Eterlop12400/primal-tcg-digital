// ============================================================
// Primal TCG — PixiJS Asset Loader
// ============================================================
// Preloads all card images and card back so they're ready for
// instant sprite creation during gameplay.

import { Assets, Texture } from 'pixi.js';
import { CARD_IMAGE_MAP, CARD_BACK_IMAGE } from '@/lib/cardImageMap';

let loaded = false;

export type AssetProgressCallback = (progress: number, label: string) => void;

/**
 * Preload all card textures. Safe to call multiple times — only loads once.
 * Optional onProgress callback receives (0-1 fraction, label string).
 */
export async function loadAllAssets(onProgress?: AssetProgressCallback): Promise<void> {
  if (loaded) {
    onProgress?.(1, 'Ready');
    return;
  }

  onProgress?.(0, 'Loading fonts...');

  // Load Google Fonts (Rajdhani for headers, Inter for body)
  await loadGoogleFonts();

  // Build the asset manifest: one entry per card + card back
  const entries = Object.entries(CARD_IMAGE_MAP);
  const allAssets = [...entries.map(([, path]) => path), CARD_BACK_IMAGE];
  const total = allAssets.length;
  let completed = 0;

  onProgress?.(0.05, 'Loading card assets...');

  // Load assets one by one to report progress
  for (const src of allAssets) {
    const alias = getAlias(src);
    await Assets.load({ alias, src });
    completed++;
    onProgress?.(0.05 + (completed / total) * 0.95, `Loading assets (${completed}/${total})`);
  }

  loaded = true;
  onProgress?.(1, 'Ready');
}

async function loadGoogleFonts(): Promise<void> {
  // Inject Google Fonts stylesheet
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap';
  document.head.appendChild(link);

  // Wait for fonts to actually load
  try {
    await Promise.all([
      document.fonts.load('700 16px Rajdhani'),
      document.fonts.load('400 16px Inter'),
    ]);
  } catch {
    // Fonts will fall back to Arial — non-critical
  }
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
