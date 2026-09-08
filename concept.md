A simple Robot Servo Sequence Designer Web App for creating and managing PWM servo motor control sequences for Arduino-based robots. Use a SPA frontend with FastAPI+SQLite for the backend. Start with a sample robot containing several servo motors, basic calibration values, a few named poses, and example motion sequences as seed data.

The app lets the user configure servo motors with names, PWM pins/channels, angle limits, neutral positions, and pulse-width calibration; create reusable poses made from servo target positions; and combine poses or direct servo movements into ordered, timed sequences.

Provide a simple sequence editor where the user can add, reorder, edit, and remove steps. Each step should support a target pose or individual servo position, movement duration, and optional hold time.

Include basic preview/inspection of the resulting sequence and an export feature that can generate a structured JSON representation of the robot configuration and motion sequences for later use by Arduino firmware or other robot-control software.

For the initial POC, focus on configuration, poses, sequence authoring, persistence, and export. Do not require direct communication with physical Arduino hardware, sensors, autonomous behavior, or real-time robot control.
