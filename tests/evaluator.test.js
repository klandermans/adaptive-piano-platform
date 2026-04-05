import { describe, it, expect, beforeEach } from "vitest";
import { Evaluator } from "../src/Evaluator.js";
import { MidiBuffer } from "../src/MidiBuffer.js";

// --- Test fixture ---
function createTestLesson() {
  return {
    id: "test-lesson-001",
    title: "Test Lesson",
    bpm: 120,
    timeSignature: 4,
    notes: [
      // Measure 1, beat 1: Both hands, C4 + C3
      { timestamp: 0, duration: 500, midiValue: 60, velocity: 80, hand: "R", measure: 1, beat: 1 },
      { timestamp: 0, duration: 500, midiValue: 48, velocity: 60, hand: "L", measure: 1, beat: 1 },
      // Measure 1, beat 2: Both hands, D4 + D3
      { timestamp: 500, duration: 500, midiValue: 62, velocity: 80, hand: "R", measure: 1, beat: 2 },
      { timestamp: 500, duration: 500, midiValue: 50, velocity: 60, hand: "L", measure: 1, beat: 2 },
      // Measure 1, beat 3: Right hand only, E4
      { timestamp: 1000, duration: 500, midiValue: 64, velocity: 80, hand: "R", measure: 1, beat: 3 },
      // Measure 1, beat 4: Both hands, F4 + F3
      { timestamp: 1500, duration: 500, midiValue: 65, velocity: 80, hand: "R", measure: 1, beat: 4 },
      { timestamp: 1500, duration: 500, midiValue: 53, velocity: 60, hand: "L", measure: 1, beat: 4 },
    ],
  };
}

describe("Evaluator", () => {
  let lesson;
  let evaluator;

  beforeEach(() => {
    lesson = createTestLesson();
    evaluator = new Evaluator(lesson, { waitMode: true });
  });

  describe("Initialization", () => {
    it("should group notes by timestamp", () => {
      const group = evaluator.getCurrentExpectedGroup();
      expect(group.timestamp).toBe(0);
      expect(group.notes.length).toBe(2); // L+R at timestamp 0
      expect(group.hands.has("L")).toBe(true);
      expect(group.hands.has("R")).toBe(true);
    });

    it("should start at the first group", () => {
      expect(evaluator.getProgress()).toBe(0);
    });

    it("should use the lesson BPM", () => {
      expect(evaluator.getCurrentBpm()).toBe(120);
    });
  });

  describe("evaluate() - Correct Input", () => {
    it("should return isCorrectNote=true when both expected notes are played", () => {
      const result = evaluator.evaluate([
        { midiValue: 60, velocity: 80, timestamp: 0 },
        { midiValue: 48, velocity: 60, timestamp: 5 },
      ]);
      expect(result.isCorrectNote).toBe(true);
    });

    it("should return isCorrectTiming=true when within tolerance", () => {
      const result = evaluator.evaluate([
        { midiValue: 60, velocity: 80, timestamp: 50 }, // 50ms delta, within 150ms tolerance
        { midiValue: 48, velocity: 60, timestamp: 55 },
      ]);
      expect(result.isCorrectTiming).toBe(true);
      expect(result.timingDeltaMs).toBe(50);
    });

    it("should return isCorrectHandSync=true when hands are within sync tolerance", () => {
      const result = evaluator.evaluate([
        { midiValue: 60, velocity: 80, timestamp: 100 },
        { midiValue: 48, velocity: 60, timestamp: 150 }, // 50ms diff, within 100ms sync tolerance
      ]);
      expect(result.isCorrectHandSync).toBe(true);
    });

    it("should return isCorrectHandSync=false when hands are out of sync", () => {
      const result = evaluator.evaluate([
        { midiValue: 60, velocity: 80, timestamp: 0 },
        { midiValue: 48, velocity: 60, timestamp: 200 }, // 200ms diff, exceeds 100ms sync tolerance
      ]);
      expect(result.isCorrectHandSync).toBe(false);
    });

    it("should return isCorrectNote=false when wrong note is played", () => {
      const result = evaluator.evaluate([
        { midiValue: 60, velocity: 80, timestamp: 0 },
        { midiValue: 99, velocity: 60, timestamp: 5 }, // Wrong note
      ]);
      expect(result.isCorrectNote).toBe(false);
    });

    it("should return isCorrectNote=false when expected note is missing", () => {
      const result = evaluator.evaluate([
        { midiValue: 60, velocity: 80, timestamp: 0 },
        // Missing left hand note (48)
      ]);
      expect(result.isCorrectNote).toBe(false);
    });

    it("should return isCorrectTiming=false when outside tolerance", () => {
      const result = evaluator.evaluate([
        { midiValue: 60, velocity: 80, timestamp: 300 }, // 300ms delta, exceeds 150ms
        { midiValue: 48, velocity: 60, timestamp: 305 },
      ]);
      expect(result.isCorrectTiming).toBe(false);
    });
  });

  describe("Wait Mode", () => {
    it("should not advance when input is incorrect", () => {
      const firstResult = evaluator.evaluate([
        { midiValue: 99, velocity: 80, timestamp: 0 }, // Wrong note
      ]);
      expect(firstResult.waitModeActive).toBe(true);

      // Should still expect the same group
      const group = evaluator.getCurrentExpectedGroup();
      expect(group.timestamp).toBe(0);
    });

    it("should advance when input is correct", () => {
      const result = evaluator.evaluate([
        { midiValue: 60, velocity: 80, timestamp: 10 },
        { midiValue: 48, velocity: 60, timestamp: 15 },
      ]);
      expect(result.waitModeActive).toBe(false);

      // Should have advanced to next group
      const group = evaluator.getCurrentExpectedGroup();
      expect(group.timestamp).toBe(500);
    });
  });

  describe("Single Hand Notes", () => {
    beforeEach(() => {
      // Advance to the right-hand-only group (timestamp 1000)
      evaluator.evaluate([{ midiValue: 60, velocity: 80, timestamp: 0 }, { midiValue: 48, velocity: 60, timestamp: 5 }]);
      evaluator.evaluate([{ midiValue: 62, velocity: 80, timestamp: 500 }, { midiValue: 50, velocity: 60, timestamp: 505 }]);
    });

    it("should return isCorrectHandSync=true for single-hand notes", () => {
      const result = evaluator.evaluate([
        { midiValue: 64, velocity: 80, timestamp: 1000 },
      ]);
      expect(result.isCorrectHandSync).toBe(true);
    });
  });

  describe("Progress Tracking", () => {
    it("should report 0% at start", () => {
      expect(evaluator.getProgress()).toBe(0);
    });

    it("should report progress after advancing groups", () => {
      // 4 groups total: [0, 500, 1000, 1500]
      evaluator.evaluate([{ midiValue: 60, velocity: 80, timestamp: 0 }, { midiValue: 48, velocity: 60, timestamp: 5 }]);
      expect(evaluator.getProgress()).toBe(25); // 1/4 = 25%

      evaluator.evaluate([{ midiValue: 62, velocity: 80, timestamp: 500 }, { midiValue: 50, velocity: 60, timestamp: 505 }]);
      expect(evaluator.getProgress()).toBe(50); // 2/4 = 50%
    });

    it("should report 100% when lesson is complete", () => {
      evaluator.evaluate([{ midiValue: 60, velocity: 80, timestamp: 0 }, { midiValue: 48, velocity: 60, timestamp: 5 }]);
      evaluator.evaluate([{ midiValue: 62, velocity: 80, timestamp: 500 }, { midiValue: 50, velocity: 60, timestamp: 505 }]);
      evaluator.evaluate([{ midiValue: 64, velocity: 80, timestamp: 1000 }]);
      evaluator.evaluate([{ midiValue: 65, velocity: 80, timestamp: 1500 }, { midiValue: 53, velocity: 60, timestamp: 1505 }]);

      expect(evaluator.getProgress()).toBe(100);
      expect(evaluator.getCurrentExpectedGroup()).toBeNull();
    });
  });

  describe("Telemetry", () => {
    it("should log telemetry for each evaluated note", () => {
      evaluator.evaluate([
        { midiValue: 60, velocity: 80, timestamp: 10 },
        { midiValue: 48, velocity: 60, timestamp: 15 },
      ]);
      const log = evaluator.getTelemetryLog();
      expect(log.length).toBe(2); // One entry per expected note
      expect(log[0].lessonId).toBe("test-lesson-001");
      expect(log[0].expectedNote.midiValue).toBe(60);
      expect(log[1].expectedNote.midiValue).toBe(48);
    });

    it("should track correctness in telemetry", () => {
      evaluator.evaluate([
        { midiValue: 60, velocity: 80, timestamp: 10 },
        { midiValue: 48, velocity: 60, timestamp: 15 },
      ]);
      const log = evaluator.getTelemetryLog();
      expect(log[0].wasCorrect).toBe(true);
    });
  });

  describe("Adaptive Tempo", () => {
    it("should decrease BPM when errors are high", () => {
      const recentErrors = [
        { timingDeltaMs: 250 },
        { timingDeltaMs: 300 },
        { timingDeltaMs: 280 },
      ];
      const newBpm = evaluator.calculateAdaptiveTempo(recentErrors);
      expect(newBpm).toBeLessThan(120);
    });

    it("should increase BPM when errors are low", () => {
      const recentErrors = [
        { timingDeltaMs: 20 },
        { timingDeltaMs: 30 },
        { timingDeltaMs: 10 },
      ];
      const newBpm = evaluator.calculateAdaptiveTempo(recentErrors);
      expect(newBpm).toBeGreaterThan(120);
    });

    it("should not go below minimum BPM", () => {
      const recentErrors = Array(20).fill({ timingDeltaMs: 500 });
      const newBpm = evaluator.calculateAdaptiveTempo(recentErrors);
      expect(newBpm).toBeGreaterThanOrEqual(40);
    });

    it("should not go above maximum BPM", () => {
      const evaluator2 = new Evaluator(lesson, { adaptiveTempoStep: 50 });
      const recentErrors = Array(20).fill({ timingDeltaMs: 10 });
      const newBpm = evaluator2.calculateAdaptiveTempo(recentErrors);
      expect(newBpm).toBeLessThanOrEqual(200);
    });
  });

  describe("Skip to Measure", () => {
    it("should skip to the correct group for a given measure", () => {
      const success = evaluator.skipToMeasure(1);
      expect(success).toBe(true);
      // Should still be at measure 1 since lesson starts there
      const group = evaluator.getCurrentExpectedGroup();
      expect(group.notes[0].measure).toBe(1);
    });

    it("should return false for non-existent measure", () => {
      const success = evaluator.skipToMeasure(99);
      expect(success).toBe(false);
    });
  });

  describe("Reset", () => {
    it("should reset progress to the beginning", () => {
      evaluator.evaluate([{ midiValue: 60, velocity: 80, timestamp: 0 }, { midiValue: 48, velocity: 60, timestamp: 5 }]);
      evaluator.reset();
      expect(evaluator.getProgress()).toBe(0);
      expect(evaluator.getCurrentExpectedGroup().timestamp).toBe(0);
    });
  });

  describe("Hand Muting (Scaffolded Play)", () => {
    it("should return true for muted left hand", () => {
      expect(evaluator.shouldMuteHand("L", { muteLeft: true })).toBe(true);
    });

    it("should return true for muted right hand", () => {
      expect(evaluator.shouldMuteHand("R", { muteRight: true })).toBe(true);
    });

    it("should return false when not muted", () => {
      expect(evaluator.shouldMuteHand("L", {})).toBe(false);
      expect(evaluator.shouldMuteHand("R", {})).toBe(false);
    });
  });
});

describe("MidiBuffer", () => {
  let buffer;

  beforeEach(() => {
    buffer = new MidiBuffer({ windowMs: 200 });
  });

  it("should complete a note on noteOff event", () => {
    buffer.processMidiEvent({ midiValue: 60, velocity: 80, timestamp: 100 });
    const completed = buffer.processMidiEvent({ midiValue: 60, velocity: 0, timestamp: 300 });

    expect(completed).not.toBeNull();
    expect(completed.midiValue).toBe(60);
    expect(completed.duration).toBe(200);
  });

  it("should return null for noteOn events", () => {
    const result = buffer.processMidiEvent({ midiValue: 60, velocity: 80, timestamp: 100 });
    expect(result).toBeNull();
  });

  it("should track active notes", () => {
    buffer.processMidiEvent({ midiValue: 60, velocity: 80, timestamp: 100 });
    expect(buffer.isNoteActive(60)).toBe(true);
    expect(buffer.isNoteActive(61)).toBe(false);
  });

  it("should remove active notes on noteOff", () => {
    buffer.processMidiEvent({ midiValue: 60, velocity: 80, timestamp: 100 });
    buffer.processMidiEvent({ midiValue: 60, velocity: 0, timestamp: 300 });
    expect(buffer.isNoteActive(60)).toBe(false);
  });

  it("should get notes within a time window", () => {
    buffer.processMidiEvent({ midiValue: 60, velocity: 80, timestamp: 100 });
    buffer.processMidiEvent({ midiValue: 60, velocity: 0, timestamp: 200 });
    buffer.processMidiEvent({ midiValue: 62, velocity: 80, timestamp: 500 });
    buffer.processMidiEvent({ midiValue: 62, velocity: 0, timestamp: 600 });

    const notes = buffer.getNotesInWindow(150, 200);
    expect(notes.length).toBe(1);
    expect(notes[0].midiValue).toBe(60);
  });

  it("should clear the buffer", () => {
    buffer.processMidiEvent({ midiValue: 60, velocity: 80, timestamp: 100 });
    buffer.clear();
    expect(buffer.isNoteActive(60)).toBe(false);
    expect(buffer.getNotesInWindow(100, 200).length).toBe(0);
  });

  it("should handle orphan noteOff gracefully", () => {
    const result = buffer.processMidiEvent({ midiValue: 60, velocity: 0, timestamp: 100 });
    expect(result).toBeNull();
  });
});
