"""Pydantic request/response models for the API contracts (architecture §5)."""
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator


class ServoInput(BaseModel):
    name: str
    pwm_pin: int
    angle_min: float
    angle_max: float
    neutral_angle: float
    pulse_min_us: int
    pulse_max_us: int


class RobotRename(BaseModel):
    name: str


class PoseTarget(BaseModel):
    servo_id: int
    angle: float


class PoseInput(BaseModel):
    name: str
    targets: List[PoseTarget] = Field(min_length=1)

    @model_validator(mode="after")
    def no_duplicate_servos(self):
        seen = set()
        for t in self.targets:
            if t.servo_id in seen:
                raise ValueError(
                    f"Duplicate servo {t.servo_id} in pose targets"
                )
            seen.add(t.servo_id)
        return self


class SequenceRename(BaseModel):
    name: str


class StepInput(BaseModel):
    kind: str
    pose_id: Optional[int] = None
    servo_id: Optional[int] = None
    angle: Optional[float] = None
    duration_ms: int = Field(ge=0)
    hold_ms: Optional[int] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def check_kind_target(self):
        if self.kind == "pose":
            if self.pose_id is None:
                raise ValueError("kind='pose' requires pose_id")
            # servo_id / angle ignored for pose kind
        elif self.kind == "servo":
            if self.servo_id is None or self.angle is None:
                raise ValueError("kind='servo' requires servo_id and angle")
        else:
            raise ValueError("kind must be 'pose' or 'servo'")
        return self


class ReorderBody(BaseModel):
    step_ids: List[int]
