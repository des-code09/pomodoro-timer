import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration, parseDurationString } from '../src/duration.js';
import { loadState, saveState } from '../src/storage.js';
import { POMODOROS_PER_CYCLE } from '../src/config.js';

const defaultSettings = {
  workDurationSeconds: 25 * 60,
  breakDurationSeconds: 5 * 60,
  longBreakDurationSeconds: 15 * 60,
};

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
}

function getNextModeAfterCompletion(completedMode, workSessionsSinceLongBreak) {
  if (completedMode === 'work') {
    const nextCount = workSessionsSinceLongBreak + 1;
    return {
      mode: nextCount >= POMODOROS_PER_CYCLE ? 'long-break' : 'break',
      workSessionsSinceLongBreak: nextCount,
    };
  }

  if (completedMode === 'long-break') {
    return { mode: 'work', workSessionsSinceLongBreak: 0 };
  }

  return { mode: 'work', workSessionsSinceLongBreak };
}

function getDayProgress(currentMode, timeRemaining, workDuration) {
  if (currentMode !== 'work') {
    return 1;
  }

  if (workDuration <= 0) {
    return 0;
  }

  const elapsed = workDuration - timeRemaining;
  return Math.min(1, Math.max(0, elapsed / workDuration));
}

function catchUpTimerState(timer, settings, pomodorosPerCycle) {
  let sessions = [];
  let workSessionsSinceLongBreak = 0;

  function getDurationForMode(mode) {
    if (mode === 'work') return settings.workDurationSeconds;
    if (mode === 'long-break') return settings.longBreakDurationSeconds;
    return settings.breakDurationSeconds;
  }

  function advance(completedMode) {
    const next = getNextModeAfterCompletion(completedMode, workSessionsSinceLongBreak);
    if (completedMode === 'work') {
      sessions.push({ completedAt: new Date().toISOString(), workDurationSeconds: settings.workDurationSeconds });
    }
    workSessionsSinceLongBreak = next.workSessionsSinceLongBreak;
    return next.mode;
  }

  if (!timer.isRunning || timer.endsAt === null) {
    return {
      currentMode: timer.currentMode,
      timeRemaining: timer.timeRemaining,
      shouldResume: false,
      sessions,
      workSessionsSinceLongBreak,
    };
  }

  let mode = timer.currentMode;
  let remainingMs = timer.endsAt - Date.now();
  let deadline = timer.endsAt;

  while (remainingMs <= 0) {
    mode = advance(mode);
    deadline += getDurationForMode(mode) * 1000;
    remainingMs = deadline - Date.now();
  }

  return {
    currentMode: mode,
    timeRemaining: Math.ceil(remainingMs / 1000),
    shouldResume: true,
    sessions,
    workSessionsSinceLongBreak,
  };
}

test('loadState returns defaults when storage is empty', () => {
  globalThis.localStorage = createMemoryStorage();
  const state = loadState(defaultSettings, POMODOROS_PER_CYCLE);
  assert.equal(state.timer.currentMode, 'work');
  assert.equal(state.timer.timeRemaining, 25 * 60);
  assert.equal(state.sessions.length, 0);
  assert.equal(state.workSessionsSinceLongBreak, 0);
});

test('loadState resets legacy storage without version', () => {
  globalThis.localStorage = createMemoryStorage();
  localStorage.setItem(
    'pomodoro-timer',
    JSON.stringify({
      settings: {
        workDurationSeconds: 600,
        breakDurationSeconds: 120,
        longBreakDurationSeconds: 900,
      },
      sessions: [{ completedAt: '2026-01-01T12:00:00.000Z', workDurationSeconds: 1500 }],
      workSessionsSinceLongBreak: 76,
      timer: {
        currentMode: 'break',
        timeRemaining: 120,
        isRunning: false,
        endsAt: null,
      },
    }),
  );

  const loaded = loadState(defaultSettings, POMODOROS_PER_CYCLE);
  assert.deepEqual(loaded.settings, defaultSettings);
  assert.equal(loaded.sessions.length, 0);
  assert.equal(loaded.workSessionsSinceLongBreak, 0);
  assert.equal(loaded.timer.currentMode, 'work');
  assert.equal(loaded.timer.timeRemaining, 25 * 60);
  assert.equal(loaded.timer.isRunning, false);
});

test('saveState and loadState round-trip', () => {
  globalThis.localStorage = createMemoryStorage();
  const payload = {
    settings: defaultSettings,
    sessions: [{ completedAt: '2026-01-01T12:00:00.000Z', workDurationSeconds: 1500 }],
    workSessionsSinceLongBreak: 2,
    timer: {
      currentMode: 'break',
      timeRemaining: 120,
      isRunning: false,
      endsAt: null,
    },
  };
  saveState(payload);
  const loaded = loadState(defaultSettings, POMODOROS_PER_CYCLE);
  assert.deepEqual(loaded.settings, defaultSettings);
  assert.equal(loaded.sessions.length, 1);
  assert.equal(loaded.workSessionsSinceLongBreak, 2);
  assert.equal(loaded.timer.currentMode, 'break');
  assert.equal(loaded.timer.timeRemaining, 120);
});

test('loadState rejects invalid timer and settings', () => {
  globalThis.localStorage = createMemoryStorage();
  saveState({
    settings: { ...defaultSettings, workDurationSeconds: 99999 },
    sessions: [{ completedAt: 'bad', workDurationSeconds: 1500 }],
    workSessionsSinceLongBreak: 99,
    timer: {
      currentMode: 'work',
      timeRemaining: 99999,
      isRunning: true,
      endsAt: null,
    },
  });
  const loaded = loadState(defaultSettings, POMODOROS_PER_CYCLE);
  assert.deepEqual(loaded.settings, defaultSettings);
  assert.equal(loaded.sessions.length, 0);
  assert.equal(loaded.workSessionsSinceLongBreak, 0);
  assert.equal(loaded.timer.currentMode, 'work');
  assert.equal(loaded.timer.timeRemaining, 25 * 60);
  assert.equal(loaded.timer.isRunning, false);
});

test('classic pomodoro cycle transitions', () => {
  let count = 0;

  for (let i = 0; i < 3; i += 1) {
    const next = getNextModeAfterCompletion('work', count);
    assert.equal(next.mode, 'break');
    count = next.workSessionsSinceLongBreak;
  }

  assert.equal(count, 3);

  const longBreak = getNextModeAfterCompletion('work', count);
  assert.equal(longBreak.mode, 'long-break');
  assert.equal(longBreak.workSessionsSinceLongBreak, 4);

  const backToWork = getNextModeAfterCompletion('long-break', longBreak.workSessionsSinceLongBreak);
  assert.equal(backToWork.mode, 'work');
  assert.equal(backToWork.workSessionsSinceLongBreak, 0);
});

test('day progress tracks work session elapsed time', () => {
  const workDuration = 1500;
  assert.equal(getDayProgress('work', workDuration, workDuration), 0);
  assert.equal(getDayProgress('work', 750, workDuration), 0.5);
  assert.equal(getDayProgress('work', 0, workDuration), 1);
  assert.equal(getDayProgress('break', 300, workDuration), 1);
  assert.equal(getDayProgress('long-break', 900, workDuration), 1);
});

test('catchUpTimerState resumes running timer across elapsed time', () => {
  const settings = { ...defaultSettings, workDurationSeconds: 10, breakDurationSeconds: 5 };
  const endsAt = Date.now() + 7000;
  const result = catchUpTimerState(
    {
      currentMode: 'work',
      timeRemaining: 10,
      isRunning: true,
      endsAt,
    },
    settings,
    POMODOROS_PER_CYCLE,
  );

  assert.equal(result.shouldResume, true);
  assert.equal(result.currentMode, 'work');
  assert.ok(result.timeRemaining >= 6 && result.timeRemaining <= 7);
});

test('catchUpTimerState advances mode when timer expired', () => {
  const settings = { ...defaultSettings, workDurationSeconds: 10, breakDurationSeconds: 5 };
  const result = catchUpTimerState(
    {
      currentMode: 'work',
      timeRemaining: 0,
      isRunning: true,
      endsAt: Date.now() - 1000,
    },
    settings,
    POMODOROS_PER_CYCLE,
  );

  assert.equal(result.shouldResume, true);
  assert.equal(result.currentMode, 'break');
  assert.ok(result.timeRemaining > 0 && result.timeRemaining <= 5);
  assert.equal(result.workSessionsSinceLongBreak, 1);
  assert.equal(result.sessions.length, 1);
});

test('parseDurationString accepts multiple formats', () => {
  assert.equal(parseDurationString('25:00', 1, 7200), 1500);
  assert.equal(parseDurationString('25:30', 1, 7200), 1530);
  assert.equal(parseDurationString('25', 1, 7200), 1500);
  assert.equal(parseDurationString('90s', 1, 7200), 90);
  assert.equal(parseDurationString('45 s', 1, 7200), 45);
  assert.equal(parseDurationString('25m30s', 1, 7200), 1530);
  assert.equal(parseDurationString('1h30m', 1, 7200), 5400);
  assert.equal(parseDurationString('1:30:00', 1, 7200), 5400);
  assert.equal(parseDurationString('0:45', 1, 7200), 45);
  assert.equal(parseDurationString('bad', 1, 7200), null);
});

test('parseDurationString rejects zero and out-of-range values', () => {
  assert.equal(parseDurationString('00:00', 1, 7200), null);
  assert.equal(parseDurationString('0s', 1, 7200), null);
  assert.equal(parseDurationString('00:30', 1, 7200), 30);
});

test('formatDuration shows hours when needed', () => {
  assert.equal(formatDuration(90), '01:30');
  assert.equal(formatDuration(5400), '1:30:00');
});
