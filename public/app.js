/**
 * Main Application - Ties together Evaluator, MidiBuffer, and UI
 */
import { Evaluator } from '../src/Evaluator.js';
import { MidiBuffer } from '../src/MidiBuffer.js';

// === State ===
let evaluator = null;
let midiBuffer = null;
let midiAccess = null;
let midiInput = null;
let lessonData = null;
let isPlaying = false;
let scaffoldConfig = { muteLeft: false, muteRight: false };

// === DOM References ===
const $ = (sel) => document.querySelector(sel);
const els = {
  midiStatus: $('#midi-status'),
  vexflowContainer: $('#vexflow-container'),
  valNote: $('#val-note'),
  valTiming: $('#val-timing'),
  valSync: $('#val-sync'),
  valDelta: $('#val-delta'),
  feedbackNote: $('#feedback-note'),
  feedbackTiming: $('#feedback-timing'),
  feedbackSync: $('#feedback-sync'),
  waitModeIndicator: $('#wait-mode-indicator'),
  lessonCompleteIndicator: $('#lesson-complete-indicator'),
  expectedNotes: $('#expected-notes'),
  playedNotes: $('#played-notes'),
  pianoKeys: $('#piano-keys'),
  lessonSelect: $('#lesson-select'),
  bpmSlider: $('#bpm-slider'),
  bpmDisplay: $('#bpm-display'),
  toleranceSlider: $('#tolerance-slider'),
  toleranceDisplay: $('#tolerance-display'),
  waitModeToggle: $('#wait-mode-toggle'),
  muteLeft: $('#mute-left'),
  muteRight: $('#mute-right'),
  btnReset: $('#btn-reset'),
  btnPlay: $('#btn-play'),
  telemetryLog: $('#telemetry-log'),
};

// === MIDI Note to Note Name ===
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return NOTE_NAMES[noteIndex] + octave;
}

// === Initialize Piano Keys ===
function initPianoKeys() {
  els.pianoKeys.innerHTML = '';
  // Show keys from C3 (48) to C5 (72)
  for (let midi = 48; midi <= 72; midi++) {
    const noteName = midiToNoteName(midi);
    const isBlack = noteName.includes('#');
    const key = document.createElement('div');
    key.className = `piano-key${isBlack ? ' black' : ''}`;
    key.dataset.midi = midi;
    key.textContent = noteName;
    key.addEventListener('mousedown', () => handleManualKeyPress(midi));
    els.pianoKeys.appendChild(key);
  }
}

function highlightKey(midi, type) {
  const key = els.pianoKeys.querySelector(`[data-midi="${midi}"]`);
  if (key) {
    key.classList.add(`highlight-${type}`);
    setTimeout(() => {
      key.classList.remove('highlight-correct', 'highlight-incorrect', 'highlight-expected');
    }, 1000);
  }
}

function highlightKeysForExpected(expectedGroup) {
  if (!expectedGroup) return;
  for (const note of expectedGroup.notes) {
    if (!evaluator.shouldMuteHand(note.hand, scaffoldConfig)) {
      highlightKey(note.midiValue, 'expected');
    }
  }
}

// === Manual Key Press (Mouse Click) ===
function handleManualKeyPress(midi) {
  const key = els.pianoKeys.querySelector(`[data-midi="${midi}"]`);
  if (key) key.classList.add('active');
  setTimeout(() => key?.classList.remove('active'), 200);

  // Simulate MIDI event
  const now = performance.now();
  const midiEvent = { midiValue: midi, velocity: 80, timestamp: now };
  processMidiInput(midiEvent);
}

// === Web MIDI API ===
async function initMIDI() {
  if (!navigator.requestMIDIAccess) {
    console.warn('Web MIDI API not available');
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    updateMidiStatus(true);

    // Connect all current inputs
    for (const input of midiAccess.inputs.values()) {
      connectMidiInput(input);
    }

    // Listen for new devices
    midiAccess.onstatechange = (e) => {
      if (e.port.type === 'input' && e.port.state === 'connected') {
        connectMidiInput(e.port);
      }
    };
  } catch (err) {
    console.error('MIDI access denied:', err);
    updateMidiStatus(false);
  }
}

function connectMidiInput(input) {
  console.log(`Connected to MIDI input: ${input.name}`);
  input.onmidimessage = (e) => {
    const [command, midiValue, velocity] = e.data;
    const type = (command & 0xf0) === 0x90 ? 'noteOn' : 'noteOff';

    // Map command to get channel-independent type
    const isNoteOn = (command & 0xf0) === 0x90 && velocity > 0;
    const isNoteOff = (command & 0xf0) === 0x80 || ((command & 0xf0) === 0x90 && velocity === 0);

    if (isNoteOn || isNoteOff) {
      const midiEvent = {
        midiValue,
        velocity: isNoteOn ? velocity : 0,
        timestamp: performance.now(),
      };
      processMidiInput(midiEvent);
    }
  };
}

function updateMidiStatus(connected) {
  if (connected) {
    els.midiStatus.className = 'status-badge connected';
    els.midiStatus.querySelector('.status-text').textContent = 'MIDI Connected';
  } else {
    els.midiStatus.className = 'status-badge disconnected';
    els.midiStatus.querySelector('.status-text').textContent = 'MIDI Disconnected';
  }
}

// === Process MIDI Input ===
function processMidiInput(midiEvent) {
  if (!isPlaying || !evaluator) return;

  // Check if hand should be muted
  // We need to determine hand from midiValue - simplified: assume lower notes = L, higher = R
  // In a real app, this would come from the lesson data
  const expectedGroup = evaluator.getCurrentExpectedGroup();
  if (expectedGroup) {
    const expectedNote = expectedGroup.notes.find(n => n.midiValue === midiEvent.midiValue);
    if (expectedNote && evaluator.shouldMuteHand(expectedNote.hand, scaffoldConfig)) {
      return; // Skip muted hand
    }
  }

  // Add to buffer
  const completedNote = midiBuffer.processMidiEvent(midiEvent);

  // Highlight the key
  if (midiEvent.velocity > 0) {
    const key = els.pianoKeys.querySelector(`[data-midi="${midiEvent.midiValue}"]`);
    if (key) key.classList.add('active');
  } else {
    const key = els.pianoKeys.querySelector(`[data-midi="${midiEvent.midiValue}"]`);
    if (key) key.classList.remove('active');
  }

  // Evaluate - collect recent notes in the buffer window
  if (completedNote || midiEvent.velocity > 0) {
    const recentNotes = midiBuffer.getNotesInWindow(midiEvent.timestamp, 300);
    const eventsToEvaluate = recentNotes.length > 0
      ? recentNotes.map(n => ({ midiValue: n.midiValue, velocity: n.velocity, timestamp: n.noteOnTimestamp }))
      : [{ midiValue: midiEvent.midiValue, velocity: midiEvent.velocity, timestamp: midiEvent.timestamp }];

    const result = evaluator.evaluate(eventsToEvaluate);
    updateUI(result);
  }
}

// === Load Lesson ===
async function loadLesson(lessonId) {
  try {
    const response = await fetch(`./data/lessons/${lessonId}.json`);
    lessonData = await response.json();

    evaluator = new Evaluator(lessonData, {
      waitMode: els.waitModeToggle.checked,
      timingToleranceMs: parseInt(els.toleranceSlider.value),
    });
    midiBuffer = new MidiBuffer({ windowMs: 300 });

    updateBpmDisplay();
    renderSheetMusic();
    updateExpectedNotes();
    resetFeedbackUI();
    clearTelemetry();
    hideLessonComplete();
  } catch (err) {
    console.error('Failed to load lesson:', err);
    alert('Failed to load lesson file');
  }
}

// === VexFlow Rendering ===
function renderSheetMusic() {
  if (!lessonData || !els.vexflowContainer) return;

  const { VF } = window;
  if (!VF) {
    console.warn('VexFlow not loaded yet');
    return;
  }

  els.vexflowContainer.innerHTML = '';

  // Group notes by measure
  const measures = {};
  for (const note of lessonData.notes) {
    if (!measures[note.measure]) {
      measures[note.measure] = { left: [], right: [] };
    }
    if (note.hand === 'L') {
      measures[note.measure].left.push(note);
    } else {
      measures[note.measure].right.push(note);
    }
  }

  const measureNumbers = Object.keys(measures).map(Number).sort((a, b) => a - b);
  const widthPerMeasure = 250;
  const totalWidth = Math.max(800, measureNumbers.length * widthPerMeasure);
  const height = 200;

  const renderer = new VF.Renderer(els.vexflowContainer, VF.Renderer.Backends.SVG);
  renderer.resize(totalWidth, height);
  const context = renderer.getContext();

  const staveSpacing = 100;
  let x = 10;

  for (const measureNum of measureNumbers) {
    const measure = measures[measureNum];

    // Create treble stave (right hand)
    const trebleStave = new VF.Stave(x, 20, widthPerMeasure - 20);
    if (measureNum === 1) {
      trebleStave.addClef('treble');
    }
    trebleStave.setContext(context).draw();

    // Create bass stave (left hand)
    const bassStave = new VF.Stave(x, 20 + staveSpacing, widthPerMeasure - 20);
    if (measureNum === 1) {
      bassStave.addClef('bass');
    }
    bassStave.setContext(context).draw();

    // Draw brace connecting staves
    if (measureNum === 1) {
      const brace = new VF.StaveConnector(trebleStave, bassStave);
      brace.setType(VF.StaveConnector.type.BRACE);
      brace.setContext(context).draw();
    }

    // Create notes for treble stave
    if (measure.right.length > 0) {
      const vfNotes = measure.right.map(note => {
        const noteName = midiToNoteName(note.midiValue);
        const duration = getVexflowDuration(note.duration);
        return new VF.StaveNote({
          keys: [noteName.toLowerCase().replace('#', '#/')],
          duration: duration,
        });
      });

      const voice = new VF.Voice({ num_beats: measure.right.length, beat_value: 4 });
      voice.setMode(VF.Voice.Mode.SOFT);
      voice.addTickables(vfNotes);

      const formatter = new VF.Formatter().joinVoices([voice]).format([voice], widthPerMeasure - 40);
      voice.draw(context, trebleStave);
    }

    // Create notes for bass stave
    if (measure.left.length > 0) {
      const vfNotes = measure.left.map(note => {
        const noteName = midiToNoteName(note.midiValue);
        const duration = getVexflowDuration(note.duration);
        return new VF.StaveNote({
          keys: [noteName.toLowerCase().replace('#', '#/')],
          duration: duration,
        });
      });

      const voice = new VF.Voice({ num_beats: measure.left.length, beat_value: 4 });
      voice.setMode(VF.Voice.Mode.SOFT);
      voice.addTickables(vfNotes);

      const formatter = new VF.Formatter().joinVoices([voice]).format([voice], widthPerMeasure - 40);
      voice.draw(context, bassStave);
    }

    x += widthPerMeasure;
  }
}

function getVexflowDuration(durationMs) {
  // Simplified: map duration to quarter/half/whole notes
  if (durationMs >= 1900) return 'w';
  if (durationMs >= 900) return 'h';
  return 'q';
}

// === Update UI ===
function updateUI(result) {
  // Note correctness
  els.valNote.textContent = result.isCorrectNote ? '✓' : '✗';
  els.feedbackNote.className = `feedback-item ${result.isCorrectNote ? 'correct' : 'incorrect'}`;

  // Timing
  els.valTiming.textContent = result.isCorrectTiming ? '✓' : '✗';
  els.feedbackTiming.className = `feedback-item ${result.isCorrectTiming ? 'correct' : 'incorrect'}`;

  // Hand sync
  els.valSync.textContent = result.isCorrectHandSync ? '✓' : '✗';
  els.feedbackSync.className = `feedback-item ${result.isCorrectHandSync ? 'correct' : 'incorrect'}`;

  // Delta
  els.valDelta.textContent = `${result.timingDeltaMs}ms`;

  // Wait mode
  if (result.waitModeActive) {
    els.waitModeIndicator.classList.remove('hidden');
  } else {
    els.waitModeIndicator.classList.add('hidden');
  }

  // Lesson complete
  if (result.isLessonComplete) {
    els.lessonCompleteIndicator.classList.remove('hidden');
  }

  // Expected notes
  updateExpectedNotes();

  // Played notes
  updatePlayedNotes(result);

  // Piano key highlights
  if (result.expectedNote) {
    for (const note of result.expectedNote.notes) {
      const wasPlayed = result.playedNote && result.playedNote.midiValue === note.midiValue;
      highlightKey(note.midiValue, result.isCorrectNote ? 'correct' : 'incorrect');
    }
  }

  // Telemetry
  updateTelemetryLog();
}

function updateExpectedNotes() {
  const expectedGroup = evaluator?.getCurrentExpectedGroup();
  if (!expectedGroup) {
    els.expectedNotes.innerHTML = '<em>No more notes expected</em>';
    return;
  }

  els.expectedNotes.innerHTML = expectedGroup.notes
    .map(note => {
      const isMuted = evaluator.shouldMuteHand(note.hand, scaffoldConfig);
      return `<span class="note-tag ${note.hand === 'L' ? 'left' : 'right'}${isMuted ? ' muted' : ''}">
        ${midiToNoteName(note.midiValue)} (${note.hand}${isMuted ? ' - MUTED' : ''})
      </span>`;
    })
    .join('');
}

function updatePlayedNotes(result) {
  if (!result.playedNote) {
    els.playedNotes.innerHTML = '<em>No notes played yet</em>';
    return;
  }

  const note = result.playedNote;
  const expectedGroup = result.expectedNote;
  const wasCorrect = result.isCorrectNote && expectedGroup?.notes.some(n => n.midiValue === note.midiValue);

  els.playedNotes.innerHTML = `<span class="note-tag ${wasCorrect ? 'played-correct' : 'played-incorrect'}">
    ${midiToNoteName(note.midiValue)} (${note.velocity})
  </span>`;
}

function updateTelemetryLog() {
  if (!evaluator) return;

  const log = evaluator.getTelemetryLog();
  const lastEntry = log[log.length - 1];
  if (!lastEntry) return;

  const entry = document.createElement('div');
  entry.className = `telemetry-entry ${lastEntry.wasCorrect ? 'correct' : 'incorrect'}`;
  entry.innerHTML = `
    <span>Measure ${lastEntry.measure}</span>
    <span>${midiToNoteName(lastEntry.expectedNote.midiValue)}</span>
    <span>${lastEntry.playedNote ? midiToNoteName(lastEntry.playedNote.midiValue) : '—'}</span>
    <span>${lastEntry.timingDeltaMs}ms</span>
    <span>${new Date(lastEntry.timestamp).toLocaleTimeString()}</span>
    <span>${lastEntry.wasCorrect ? '✓ Correct' : '✗ Incorrect'}</span>
  `;

  els.telemetryLog.appendChild(entry);
  els.telemetryLog.scrollTop = els.telemetryLog.scrollHeight;
}

function resetFeedbackUI() {
  els.valNote.textContent = '—';
  els.valTiming.textContent = '—';
  els.valSync.textContent = '—';
  els.valDelta.textContent = '—';
  els.feedbackNote.className = 'feedback-item';
  els.feedbackTiming.className = 'feedback-item';
  els.feedbackSync.className = 'feedback-item';
  els.waitModeIndicator.classList.add('hidden');
  els.expectedNotes.innerHTML = 'No notes expected yet';
  els.playedNotes.innerHTML = 'No notes played yet';
}

function clearTelemetry() {
  els.telemetryLog.innerHTML = '';
}

function hideLessonComplete() {
  els.lessonCompleteIndicator.classList.add('hidden');
}

function updateBpmDisplay() {
  els.bpmDisplay.textContent = evaluator?.getCurrentBpm() || lessonData?.bpm || 120;
}

// === Event Listeners ===
function initEventListeners() {
  // Lesson select
  els.lessonSelect.addEventListener('change', (e) => {
    isPlaying = false;
    els.btnPlay.textContent = '▶ Play';
    loadLesson(e.target.value);
  });

  // BPM slider
  els.bpmSlider.addEventListener('input', (e) => {
    if (evaluator) {
      // In a full implementation, this would adjust playback speed
      els.bpmDisplay.textContent = e.target.value;
    }
  });

  // Tolerance slider
  els.toleranceSlider.addEventListener('input', (e) => {
    els.toleranceDisplay.textContent = e.target.value;
    if (evaluator) {
      evaluator.timingToleranceMs = parseInt(e.target.value);
    }
  });

  // Wait mode toggle
  els.waitModeToggle.addEventListener('change', (e) => {
    if (evaluator) {
      evaluator.waitMode = e.target.checked;
    }
  });

  // Scaffold buttons
  els.muteLeft.addEventListener('click', () => {
    scaffoldConfig.muteLeft = !scaffoldConfig.muteLeft;
    els.muteLeft.classList.toggle('active', scaffoldConfig.muteLeft);
    updateExpectedNotes();
  });

  els.muteRight.addEventListener('click', () => {
    scaffoldConfig.muteRight = !scaffoldConfig.muteRight;
    els.muteRight.classList.toggle('active', scaffoldConfig.muteRight);
    updateExpectedNotes();
  });

  // Reset button
  els.btnReset.addEventListener('click', () => {
    if (evaluator) {
      evaluator.reset();
      midiBuffer?.clear();
      resetFeedbackUI();
      clearTelemetry();
      hideLessonComplete();
      updateExpectedNotes();
    }
  });

  // Play button
  els.btnPlay.addEventListener('click', () => {
    isPlaying = !isPlaying;
    els.btnPlay.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
    if (isPlaying) {
      // Show expected notes
      highlightKeysForExpected(evaluator?.getCurrentExpectedGroup());
    }
  });
}

// === Init ===
async function init() {
  initPianoKeys();
  initEventListeners();
  await initMIDI();
  await loadLesson('twinkle-twinkle');
  console.log('🎹 Adaptive Piano Platform initialized');
}

init();
