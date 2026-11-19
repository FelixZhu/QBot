/** One finger gesture moves at most one lesson. A fast fling must not skip ahead. */

export function nextFeedPage(current: number, offsetY: number, pageHeight: number, count: number): number {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0 || count <= 0) return 0;
  const page = Math.max(0, Math.min(count - 1, Math.trunc(current)));
  if (!Number.isFinite(offsetY)) return page;
  const delta = offsetY - page * pageHeight;
  let next = page;
  if (delta > pageHeight * 0.08) next = page + 1;
  else if (delta < -pageHeight * 0.08) next = page - 1;
  return Math.max(0, Math.min(count - 1, next));
}
