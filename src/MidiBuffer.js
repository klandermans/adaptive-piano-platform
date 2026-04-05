/**
 * MidiBuffer - Manages a rolling buffer of incoming MIDI events
 * Groups noteOn/noteOff pairs and tracks active notes for evaluation
 */
export class MidiBuffer {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 200; // Timing evaluation window
    this._pendingNoteOns = new Map(); // midiValue -> timestamp
    this._completedNotes = [];
    this._maxCompletedSize = options.maxCompletedSize || 50;
  }

  /**
   * Process an incoming MIDI event
   * @param {Object} event - Raw MIDI event
   * @param {number} event.midiValue - MIDI note number
   * @param {number} event.velocity - MIDI velocity
   * @param {number} event.timestamp - Performance timing timestamp
   * @returns {Object|null} Completed note or null
   */
  processMidiEvent(event) {
    const { midiValue, velocity, timestamp } = event;

    if (velocity > 0) {
      // Note On
      this._pendingNoteOns.set(midiValue, {
        midiValue,
        velocity,
        noteOnTimestamp: timestamp,
      });
      return null;
    } else {
      // Note Off - complete the note
      const noteOn = this._pendingNoteOns.get(midiValue);
      if (noteOn) {
        this._pendingNoteOns.delete(midiValue);
        const completedNote = {
          midiValue,
          velocity: noteOn.velocity,
          noteOnTimestamp: noteOn.noteOnTimestamp,
          noteOffTimestamp: timestamp,
          duration: timestamp - noteOn.noteOnTimestamp,
        };
        this._addCompleted(completedNote);
        return completedNote;
      }
      return null;
    }
  }

  _addCompleted(note) {
    this._completedNotes.push(note);
    if (this._completedNotes.length > this._maxCompletedSize) {
      this._completedNotes.shift();
    }
  }

  /**
   * Get all completed notes within a time window
   */
  getNotesInWindow(centerTimestamp, windowMs) {
    const start = centerTimestamp - windowMs / 2;
    const end = centerTimestamp + windowMs / 2;
    return this._completedNotes.filter(
      (n) =>
        n.noteOnTimestamp >= start && n.noteOnTimestamp <= end
    );
  }

  /**
   * Check if a specific MIDI note is currently held down
   */
  isNoteActive(midiValue) {
    return this._pendingNoteOns.has(midiValue);
  }

  /**
   * Clear the buffer (e.g., when switching lessons)
   */
  clear() {
    this._pendingNoteOns.clear();
    this._completedNotes.length = 0;
  }

  /**
   * Get recent notes for adaptive tempo calculation
   */
  getRecentNotes(count) {
    return this._completedNotes.slice(-count);
  }
}
