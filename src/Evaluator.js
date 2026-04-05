/**
 * Evaluator - State machine that compares incoming MIDI signals
 * against the lesson blueprint JSON data.
 *
 * Outputs:
 *   - isCorrectNote: Pitch matches expected
 *   - isCorrectTiming: Within timing tolerance
 *   - isCorrectHandSync: Both hands played correctly (if required)
 */
export class Evaluator {
  /**
   * @param {Object} lessonBlueprint - The lesson JSON data
   * @param {Object} options - Configuration
   * @param {number} options.timingToleranceMs - Max deviation for timing (default: 150ms)
   * @param {number} options.handSyncToleranceMs - Max deviation for hand sync (default: 100ms)
   * @param {boolean} options.waitMode - Pause timeline until correct input
   * @param {number} options.adaptiveTempoWindow - Number of measures for tempo adaptation
   * @param {number} options.adaptiveTempoStep - BPM adjustment step percentage
   */
  constructor(lessonBlueprint, options = {}) {
    this.lesson = lessonBlueprint;
    this.timingToleranceMs = options.timingToleranceMs || 150;
    this.handSyncToleranceMs = options.handSyncToleranceMs || 100;
    this.waitMode = options.waitMode !== undefined ? options.waitMode : true;
    this.adaptiveTempoWindow = options.adaptiveTempoWindow || 4;
    this.adaptiveTempoStep = options.adaptiveTempoStep || 5;

    // Group notes by their expected timestamp (for hand-sync grouping)
    this._groupedNotes = this._groupNotesByTimestamp(lessonBlueprint.notes);

    // State
    this._currentGroupIndex = 0;
    this._currentBpm = lessonBlueprint.bpm;
    this._telemetryLog = [];
    this._measureErrorLog = []; // {measure, avgErrorMs} for adaptive tempo
    this._isPaused = false;
    this._songStartTime = null;
  }

  /**
   * Group notes that share the same timestamp (typically L+R pairs)
   */
  _groupNotesByTimestamp(notes) {
    const groups = new Map();
    for (const note of notes) {
      const key = note.timestamp;
      if (!groups.has(key)) {
        groups.set(key, {
          timestamp: note.timestamp,
          notes: [],
          hands: new Set(),
        });
      }
      const group = groups.get(key);
      group.notes.push(note);
      group.hands.add(note.hand);
    }
    return Array.from(groups.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }

  /**
   * Get the current expected note group
   */
  getCurrentExpectedGroup() {
    if (this._currentGroupIndex >= this._groupedNotes.length) {
      return null; // Lesson complete
    }
    return this._groupedNotes[this._currentGroupIndex];
  }

  /**
   * Evaluate incoming MIDI events against expected notes
   * @param {Array} midiEvents - Array of {midiValue, velocity, timestamp}
   * @returns {Object} EvaluationResult
   */
  evaluate(midiEvents) {
    const expectedGroup = this.getCurrentExpectedGroup();

    if (!expectedGroup) {
      return {
        isCorrectNote: false,
        isCorrectTiming: false,
        isCorrectHandSync: true, // No notes expected = nothing to sync
        timingDeltaMs: 0,
        expectedNote: null,
        playedNote: null,
        isLessonComplete: true,
        waitModeActive: false,
      };
    }

    // Build a set of played MIDI values
    const playedMidiValues = new Set(midiEvents.map((e) => e.midiValue));
    const expectedMidiValues = new Set(
      expectedGroup.notes.map((n) => n.midiValue)
    );

    // --- isCorrectNote ---
    const allExpectedNotesPlayed = expectedGroup.notes.every((note) =>
      playedMidiValues.has(note.midiValue)
    );
    const noExtraNotesPlayed = midiEvents.every((e) =>
      expectedMidiValues.has(e.midiValue)
    );
    const isCorrectNote = allExpectedNotesPlayed && noExtraNotesPlayed;

    // --- isCorrectTiming ---
    let timingDeltaMs = 0;
    let isCorrectTiming = false;

    if (midiEvents.length > 0 && expectedGroup.notes.length > 0) {
      // Use the first played event's timestamp relative to expected
      const firstPlayedTimestamp = midiEvents[0].timestamp;
      timingDeltaMs = Math.abs(
        firstPlayedTimestamp - expectedGroup.timestamp
      );
      isCorrectTiming = timingDeltaMs <= this.timingToleranceMs;
    }

    // --- isCorrectHandSync ---
    let isCorrectHandSync = true;
    const rightHandNotes = expectedGroup.notes.filter((n) => n.hand === "R");
    const leftHandNotes = expectedGroup.notes.filter((n) => n.hand === "L");

    // Only evaluate hand sync if both hands are expected
    if (rightHandNotes.length > 0 && leftHandNotes.length > 0) {
      const rightPlayed = midiEvents.filter((e) =>
        rightHandNotes.some((n) => n.midiValue === e.midiValue)
      );
      const leftPlayed = midiEvents.filter((e) =>
        leftHandNotes.some((n) => n.midiValue === e.midiValue)
      );

      if (rightPlayed.length > 0 && leftPlayed.length > 0) {
        const syncDelta = Math.abs(
          rightPlayed[0].timestamp - leftPlayed[0].timestamp
        );
        isCorrectHandSync = syncDelta <= this.handSyncToleranceMs;
      } else if (
        rightHandNotes.every((n) => playedMidiValues.has(n.midiValue)) &&
        leftHandNotes.every((n) => playedMidiValues.has(n.midiValue))
      ) {
        // Both hands played but timestamps not available (edge case)
        isCorrectHandSync = true;
      } else {
        isCorrectHandSync = false;
      }
    }

    // --- Overall correctness ---
    const wasFullyCorrect = isCorrectNote && isCorrectTiming && isCorrectHandSync;

    // --- Telemetry ---
    this._logTelemetry(expectedGroup, midiEvents, {
      isCorrectNote,
      isCorrectTiming,
      isCorrectHandSync,
      timingDeltaMs,
      wasFullyCorrect,
    });

    // --- Advance state if correct ---
    const waitModeActive = this.waitMode && !wasFullyCorrect;

    if (wasFullyCorrect || !this.waitMode) {
      this._advanceGroup();
    }

    return {
      isCorrectNote,
      isCorrectTiming,
      isCorrectHandSync,
      timingDeltaMs,
      expectedNote: expectedGroup,
      playedNote: midiEvents.length > 0 ? midiEvents[0] : null,
      isLessonComplete: this._currentGroupIndex >= this._groupedNotes.length,
      waitModeActive,
      currentMeasure: expectedGroup.notes[0]?.measure || 0,
    };
  }

  /**
   * Advance to the next expected note group
   */
  _advanceGroup() {
    // Log measure error for adaptive tempo
    const currentGroup = this._groupedNotes[this._currentGroupIndex];
    if (currentGroup) {
      const measure = currentGroup.notes[0].measure;
      // We'd need actual played timestamps for real error calculation
      // This is simplified - the external caller should pass actual play times
    }

    this._currentGroupIndex++;
  }

  /**
   * Log telemetry data for analysis
   */
  _logTelemetry(expectedGroup, midiEvents, result) {
    const measure = expectedGroup.notes[0]?.measure || 0;

    for (const expectedNote of expectedGroup.notes) {
      const wasPlayed = midiEvents.some(
        (e) => e.midiValue === expectedNote.midiValue
      );
      const playedEvent = wasPlayed
        ? midiEvents.find((e) => e.midiValue === expectedNote.midiValue)
        : null;

      this._telemetryLog.push({
        lessonId: this.lesson.id,
        measure,
        expectedNote,
        playedNote: playedEvent,
        timingDeltaMs: result.timingDeltaMs,
        wasCorrect: result.wasFullyCorrect,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get telemetry log
   */
  getTelemetryLog() {
    return this._telemetryLog;
  }

  /**
   * Calculate adaptive tempo based on recent performance
   * Returns new suggested BPM
   */
  calculateAdaptiveTempo(recentErrors) {
    if (recentErrors.length === 0) return this._currentBpm;

    const avgError =
      recentErrors.reduce((sum, e) => sum + Math.abs(e.timingDeltaMs), 0) /
      recentErrors.length;

    // Simple heuristic: if avg error > 200ms, slow down; if < 50ms, speed up
    const step = this._currentBpm * (this.adaptiveTempoStep / 100);

    if (avgError > 200) {
      this._currentBpm = Math.max(40, this._currentBpm - step);
    } else if (avgError < 50) {
      this._currentBpm = Math.min(200, this._currentBpm + step);
    }

    return Math.round(this._currentBpm);
  }

  /**
   * Reset the evaluator to the beginning
   */
  reset() {
    this._currentGroupIndex = 0;
    this._currentBpm = this.lesson.bpm;
    this._telemetryLog = [];
    this._isPaused = false;
    this._songStartTime = null;
  }

  /**
   * Skip to a specific measure
   */
  skipToMeasure(measureNumber) {
    for (let i = 0; i < this._groupedNotes.length; i++) {
      if (this._groupedNotes[i].notes[0].measure === measureNumber) {
        this._currentGroupIndex = i;
        return true;
      }
    }
    return false;
  }

  /**
   * Get progress percentage
   */
  getProgress() {
    if (this._groupedNotes.length === 0) return 100;
    return Math.round(
      (this._currentGroupIndex / this._groupedNotes.length) * 100
    );
  }

  /**
   * Get current BPM (possibly adjusted by adaptive tempo)
   */
  getCurrentBpm() {
    return this._currentBpm;
  }

  /**
   * Check if a specific hand should be muted (scaffolded play)
   * @param {'L'|'R'} hand - The hand to check
   * @param {Object} scaffoldConfig - { muteLeft: bool, muteRight: bool }
   */
  shouldMuteHand(hand, scaffoldConfig = {}) {
    if (hand === "L" && scaffoldConfig.muteLeft) return true;
    if (hand === "R" && scaffoldConfig.muteRight) return true;
    return false;
  }
}
