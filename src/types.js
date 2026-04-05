/**
 * @typedef {Object} NoteEvent
 * @property {number} timestamp    - Start time in milliseconds from song start
 * @property {number} duration     - Note duration in milliseconds
 * @property {number} midiValue    - MIDI note number (21-108 for piano)
 * @property {number} velocity     - MIDI velocity (0-127)
 * @property {'L'|'R'} hand       - Hand indicator
 * @property {number} measure      - Measure number (1-based)
 * @property {number} beat         - Beat position within measure
 */

/**
 * @typedef {Object} LessonBlueprint
 * @property {string} id           - Unique lesson identifier
 * @property {string} title        - Human-readable title
 * @property {number} bpm          - Base tempo in BPM
 * @property {number} timeSignature - Time signature (e.g., 4 for 4/4)
 * @property {NoteEvent[]} notes   - Array of note events
 */

/**
 * @typedef {Object} MidiInputEvent
 * @property {number} timestamp    - Absolute timestamp of MIDI event
 * @property {number} midiValue    - MIDI note number
 * @property {number} velocity     - MIDI velocity
 * @property {'noteOn'|'noteOff'} type - MIDI message type
 */

/**
 * @typedef {Object} EvaluationResult
 * @property {boolean} isCorrectNote     - Pitch matches expected
 * @property {boolean} isCorrectTiming   - Within timing tolerance
 * @property {boolean} isCorrectHandSync - Both hands played correctly (if required)
 * @property {number} timingDeltaMs     - Timing deviation in milliseconds
 * @property {NoteEvent|null} expectedNote - The note that was expected
 * @property {MidiInputEvent|null} playedNote - The note that was actually played
 */

/**
 * @typedef {Object} TelemetryRecord
 * @property {string} lessonId       - Lesson identifier
 * @property {number} measure        - Measure number
 * @property {NoteEvent} expectedNote - What was expected
 * @property {MidiInputEvent|null} playedNote - What was played (null if missed)
 * @property {number} timingDeltaMs  - Timing deviation
 * @property {boolean} wasCorrect    - Overall correctness
 * @property {number} timestamp      - Wall clock timestamp
 */
