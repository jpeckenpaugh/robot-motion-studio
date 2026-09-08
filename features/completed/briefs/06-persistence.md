# Brief 06: Persistence

## Purpose

Store and retrieve the robot configuration, its servos, poses, and authored
motion sequences so that authored work is retained across sessions and is not
lost when the user leaves or reloads the app.

## Expected behavior

- The app retains all authored data — the robot configuration, its servos,
  the poses, and the motion sequences — so that it survives reloading and
  returning to the app in a later session.
- The app presents a consistent, single source of truth for this data: the
  configuration, poses, and sequences that the user views and edits are the same
  persisted records used by every other capability (pose management, sequence
  authoring, preview, export).
- When the user creates, edits, or deletes a servo, pose, or sequence, that
  change is persisted such that the updated state is what is shown and used
  thereafter.
- When a reference is made between persisted objects (a pose setting a servo's
  target, a sequence step referencing a pose or servo), that relationship is
  retained and respected on later load.
- On load/reload, the user is returned to the same current state of data they
  had previously, with all configuration, servos, poses, and sequences intact.
- Persistence is transparent to the user: they author and edit as normal, and
  the app keeps that work safe. No explicit save/load workflow beyond normal
  authoring is required.

## Inputs / outputs

- Inputs: the user's authoring actions (creating/editing/deleting servos, poses,
  and sequences).
- Outputs: a durable store that retains this state and from which the app
  restores the same current state on later sessions.

## User-visible behavior

- Work the user completes (servo configuration, poses, sequences) is still there
  when they reload the page or return in a new session.
- The user does not need to perform a separate save or re-enter their data;
  their edits are kept automatically and appear consistently across features.
- After a reload, previously created servos, poses, and sequences appear exactly
  as they were, including their references (which poses set which servos, and
  which sequences reference which poses/servos).
- If the user edits something and reloads, they see the edited result, not an
  older version.

## Constraints

- Configuration, servos, poses, and sequences must persist across sessions; none
  of these may be lost or reset merely by reloading.
- The persisted state must remain internally consistent: persisted references
  between servos, poses, and sequences must remain valid per the validation
  rules of the configuration, pose, and sequence features.
- The data shown to the user and used by all capabilities must come from the
  same persisted source of truth; there must not be divergent copies.
- Persistence must not weaken the constraints defined by the configuration,
  pose, and sequence features (e.g., it must not silently store an invalid servo
  angle or a broken reference).

## Basic acceptance expectations

- After the user creates or edits a servo, pose, or sequence and reloads, the
  change is still present.
- After a full session restart, previously authored configuration, servos,
  poses, and sequences are restored intact.
- A pose still sets the same servos' targets after reload, and a sequence still
  references the same poses/servos after reload.
- Reloading does not lose, duplicate, or reset any authored data.
