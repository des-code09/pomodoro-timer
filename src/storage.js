const STORAGE_KEY = 'pomodoro-timer';

const WORK_MIN_SECONDS = 1;
const WORK_MAX_SECONDS = 7200;
const BREAK_MIN_SECONDS = 1;
const BREAK_MAX_SECONDS = 3600;

function isValidDuration(seconds, min, max) {
  return Number.isInteger(seconds) && seconds >= min && seconds <= max;
}

function isValidSettings(settings) {
  return (
    settings &&
    typeof settings === 'object' &&
    isValidDuration(settings.workDurationSeconds, WORK_MIN_SECONDS, WORK_MAX_SECONDS) &&
    isValidDuration(settings.breakDurationSeconds, BREAK_MIN_SECONDS, BREAK_MAX_SECONDS) &&
    isValidDuration(settings.longBreakDurationSeconds, BREAK_MIN_SECONDS, BREAK_MAX_SECONDS)
  );
}

function isValidSession(session) {
  return (
    session &&
    typeof session === 'object' &&
    typeof session.completedAt === 'string' &&
    !Number.isNaN(Date.parse(session.completedAt)) &&
    isValidDuration(session.workDurationSeconds, WORK_MIN_SECONDS, WORK_MAX_SECONDS)
  );
}

function maxDurationForMode(mode, settings) {
  if (mode === 'work') {
    return settings.workDurationSeconds;
  }

  if (mode === 'long-break') {
    return settings.longBreakDurationSeconds;
  }

  return settings.breakDurationSeconds;
}

function isValidTimer(timer, settings) {
  if (!timer || typeof timer !== 'object') {
    return false;
  }

  if (
    timer.currentMode !== 'work' &&
    timer.currentMode !== 'break' &&
    timer.currentMode !== 'long-break'
  ) {
    return false;
  }

  if (typeof timer.isRunning !== 'boolean') {
    return false;
  }

  const maxDuration = maxDurationForMode(timer.currentMode, settings);

  if (!isValidDuration(timer.timeRemaining, 0, maxDuration)) {
    return false;
  }

  if (timer.isRunning) {
    return typeof timer.endsAt === 'number' && timer.endsAt > 0;
  }

  return timer.endsAt === null || timer.endsAt === undefined;
}

function isValidCycleCount(count, maxPerCycle) {
  return Number.isInteger(count) && count >= 0 && count <= maxPerCycle;
}

function defaultTimer(settings) {
  return {
    currentMode: 'work',
    timeRemaining: settings.workDurationSeconds,
    isRunning: false,
    endsAt: null,
  };
}

function defaultState(defaultSettings) {
  return {
    settings: { ...defaultSettings },
    sessions: [],
    workSessionsSinceLongBreak: 0,
    timer: defaultTimer(defaultSettings),
  };
}

export function loadState(defaultSettings, pomodorosPerCycle) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return defaultState(defaultSettings);
    }

    const parsed = JSON.parse(raw);
    const mergedSettings = {
      ...defaultSettings,
      ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}),
    };
    const settings = isValidSettings(mergedSettings)
      ? mergedSettings
      : defaultSettings;
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.filter(isValidSession)
      : [];
    const timer = isValidTimer(parsed.timer, settings)
      ? parsed.timer
      : defaultTimer(settings);
    const workSessionsSinceLongBreak = isValidCycleCount(
      parsed.workSessionsSinceLongBreak,
      pomodorosPerCycle,
    )
      ? parsed.workSessionsSinceLongBreak
      : 0;

    return { settings, sessions, workSessionsSinceLongBreak, timer };
  } catch {
    return defaultState(defaultSettings);
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable or full.
  }
}
