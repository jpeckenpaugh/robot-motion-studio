/* Angle <-> pulse-width conversion math (ported from backend/app/pulse.py,
 * architecture §5.5.1). Used by both preview and export so the two stay
 * consistent. Angles are degrees; pulse widths are microseconds (rounded).
 */
export function angleToPulseUs(angle, angleMin, angleMax, pulseMinUs, pulseMaxUs) {
  if (angleMax === angleMin) {
    // Degenerate range; fall back to the midpoint of the pulse range.
    return Math.round((pulseMinUs + pulseMaxUs) / 2);
  }
  const scaled =
    ((angle - angleMin) * (pulseMaxUs - pulseMinUs)) / (angleMax - angleMin);
  return Math.round(pulseMinUs + scaled);
}