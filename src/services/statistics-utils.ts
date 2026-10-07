/**
 * Get today's timestamp at midnight (ms since epoch)
 */
export function getTodayTimestamp(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
