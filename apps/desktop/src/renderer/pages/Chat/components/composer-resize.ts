export const COMPOSER_MIN_HEIGHT = 160;
export const COMPOSER_DEFAULT_HEIGHT = 176;
export const COMPOSER_MAX_HEIGHT = 420;

export function resizedComposerHeight(
  startHeight: number,
  startPointerY: number,
  pointerY: number,
) {
  return Math.min(
    COMPOSER_MAX_HEIGHT,
    Math.max(COMPOSER_MIN_HEIGHT, startHeight + startPointerY - pointerY),
  );
}
