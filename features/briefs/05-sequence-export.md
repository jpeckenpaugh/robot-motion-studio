# Brief 05: Sequence Export

## Purpose

Generate a structured JSON representation of the robot configuration and its
motion sequences so the data can be consumed later by Arduino firmware or other
robot-control software. It is the app's mechanism for getting authored work out
in a machine-readable form.

## Expected behavior

- The user can request an export of the current robot configuration and the
  motion sequences.
- The export produces a single structured JSON document containing both the
  robot configuration (the robot and its servos with all their configuration
  fields) and the authored motion sequences (each sequence's ordered steps with
  their targets and timing).
- The exported JSON must accurately reflect the current, saved state of the
  robot configuration, its servos, and the sequences at the moment of export; it
  must not include stale or partial data.
- The export is self-contained: the resulting JSON is a complete representation
  that a downstream consumer can use on its own, without needing further access
  to the app.
- The user can obtain the export as a downloadable/retrievable JSON artifact
  they can save for later use.
- Export must resolve references to named poses into concrete, usable data so a
  downstream consumer that only has this JSON does not depend on the app to
  interpret pose names. The JSON must therefore express each sequence step's
  concrete effect (which servos move to which positions, with what timing)
  rather than leaving pose references unresolved.

## Inputs / outputs

- Inputs: a user request to export the robot configuration and sequences.
- Outputs: one structured JSON document representing the robot configuration
  and its motion sequences, provided to the user as a downloadable artifact.

## User-visible behavior

- The user chooses to export and receives a JSON document that they can
  download/save.
- Inspecting the exported JSON shows the robot's servos and settings, and each
  authored sequence with its ordered steps and timing.
- The exported data matches what is currently configured in the app.
- A pose referenced by a step appears in the JSON as concrete servo target data,
  so the JSON is usable on its own.

## Constraints

- The export must be in JSON format (structured JSON).
- The export must include the robot configuration (including every servo and
  its required fields) and the authored motion sequences; it must not silently
  omit configuration or any sequence/step.
- The export must be self-contained and not depend on the app at read time.
- The exported values must stay consistent with the app's validation rules, so
  that anything written into the JSON corresponds to a state the app itself
  would consider valid.
- Export must produce data usable by Arduino firmware or other robot-control
  software; it must not embed app-only implementation details.

## Basic acceptance expectations

- The user can generate an export and receive a downloadable JSON file.
- The JSON contains the full robot configuration (all servos and their fields)
  and all authored sequences with ordered steps.
- Sequence steps that reference poses are expressed as concrete servo target
  data in the JSON.
- The exported JSON matches the current state of the app at the time of export.

## Notes / Clarifications

- The upstream feature/concept require "a structured JSON representation" and
  "usable by Arduino firmware or other robot-control software" but do not define
  the exact JSON schema. The exact shape of the JSON must be fixed in a later
  (architecture/export) stage. This brief only fixes the behavioral contract:
  self-contained JSON covering robot config plus sequences, with concrete servo
  target data. This should be flagged so the schema is decided before
  implementation.
