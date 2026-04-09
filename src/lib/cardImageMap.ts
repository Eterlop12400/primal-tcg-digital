// Maps card definition ID -> public image path

export const CARD_IMAGE_MAP: Record<string, string> = {
  C0077: '/cards/C0077.jpg',
  C0078: '/cards/C0078.jpg',
  C0079: '/cards/C0079.jpg',
  C0080: '/cards/C0080.jpg',
  C0081: '/cards/C0081.jpg',
  C0082: '/cards/C0082.jpg',
  C0083: '/cards/C0083.jpg',
  C0084: '/cards/C0084.jpg',
  C0085: '/cards/C0085.jpg',
  C0086: '/cards/C0086.jpg',
  S0038: '/cards/S0038.jpg',
  S0039: '/cards/S0039.jpg',
  S0040: '/cards/S0040.jpg',
  S0041: '/cards/S0041.jpg',
  A0036: '/cards/A0036.jpg',
  A0037: '/cards/A0037.jpg',
  A0038: '/cards/A0038.jpg',
  F0005: '/cards/F0005.jpg',
};

export const CARD_BACK_IMAGE = '/cards/card-back.png';

export function getCardImagePath(defId: string): string {
  return CARD_IMAGE_MAP[defId] ?? CARD_BACK_IMAGE;
}
