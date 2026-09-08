"""Angle <-> pulse-width conversion math (architecture §5.5.1).

The backend uses this single function for both preview and export so the two
stay consistent. Angles are degrees (REAL); pulse widths are microseconds
(int), rounded.
"""


def angle_to_pulse_us(
    angle: float,
    angle_min: float,
    angle_max: float,
    pulse_min_us: int,
    pulse_max_us: int,
) -> int:
    """Convert a commanded angle (degrees) to a PWM pulse width (microseconds).

    Uses the canonical formula:

        pulse_us = round(
            pulse_min_us
            + (angle - angle_min) * (pulse_max_us - pulse_min_us) / (angle_max - angle_min)
        )
    """
    if angle_max == angle_min:
        # Degenerate range; fall back to the midpoint of the pulse range.
        return round((pulse_min_us + pulse_max_us) / 2)
    scaled = (angle - angle_min) * (pulse_max_us - pulse_min_us) / (angle_max - angle_min)
    return round(pulse_min_us + scaled)
