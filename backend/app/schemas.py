"""Pydantic request/response models for the API contracts (architecture §5, §9)."""
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator

from .validation import EASING_VALUES


class ServoInput(BaseModel):
    name: str
    pwm_pin: int
    angle_min: float
    angle_max: float
    neutral_angle: float
    pulse_min_us: int
    pulse_max_us: int


class RobotCreate(BaseModel):
    name: str
    description: str = ""


class RobotUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

    @model_validator(mode="after")
    def at_least_one_field(self):
        if self.name is None and self.description is None:
            raise ValueError("Provide at least one of name or description")
        return self


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


class SequenceInput(BaseModel):
    name: str
    repeat_count: Optional[int] = None
    repeat_forever: bool = False


class SequenceUpdate(BaseModel):
    name: Optional[str] = None
    repeat_count: Optional[int] = None
    repeat_forever: Optional[bool] = None

    @model_validator(mode="after")
    def at_least_one_field(self):
        if (self.name is None and self.repeat_count is None
                and self.repeat_forever is None):
            raise ValueError("Provide at least one of name, repeat_count, "
                             "repeat_forever")
        return self


class StepInput(BaseModel):
    kind: str
    pose_id: Optional[int] = None
    servo_id: Optional[int] = None
    angle: Optional[float] = None
    duration_ms: Optional[int] = Field(default=None, ge=0)
    hold_ms: Optional[int] = Field(default=None, ge=0)
    position: Optional[int] = Field(default=None, ge=0)
    speed: Optional[float] = Field(default=None, gt=0)
    easing: Optional[str] = None

    @model_validator(mode="after")
    def check_kind_target(self):
        if self.kind == "pose":
            if self.pose_id is None:
                raise ValueError("kind='pose' requires pose_id")
        elif self.kind == "servo":
            if self.servo_id is None or self.angle is None:
                raise ValueError("kind='servo' requires servo_id and angle")
        else:
            raise ValueError("kind must be 'pose' or 'servo'")
        if self.easing is not None and self.easing not in EASING_VALUES:
            raise ValueError(
                f"easing must be one of {', '.join(EASING_VALUES)}"
            )
        if self.duration_ms is None and self.speed is None:
            raise ValueError("Provide at least one of duration_ms or speed")
        return self


class ReorderBody(BaseModel):
    step_ids: List[int]


class GroupInput(BaseModel):
    name: Optional[str] = None
    step_ids: List[int] = Field(min_length=1)
    repeat_count: Optional[int] = None
    repeat_forever: bool = False


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    repeat_count: Optional[int] = None
    repeat_forever: Optional[bool] = None

    @model_validator(mode="after")
    def at_least_one_field(self):
        if (self.name is None and self.repeat_count is None
                and self.repeat_forever is None):
            raise ValueError("Provide at least one of name, repeat_count, "
                             "repeat_forever")
        return self


class CurrentRobotSet(BaseModel):
    robot_id: int