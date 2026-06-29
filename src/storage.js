const STORAGE_KEY = 'pomodoro-timer';
const SESSION_TIMER_KEY = 'pomodoro-timer-session';
const STORAGE_VERSION = 3;

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

function defaultDurable(defaultSettings) {
  return {
    settings: { ...defaultSettings },
    sessions: [],
    workSessionsSinceLongBreak: 0,
  };
}

function parseDurablePayload(parsed, defaultSettings, pomodorosPerCycle) {
  const mergedSettings = {
    ...defaultSettings,
    ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}),
  };
  const settings = isValidSettings(mergedSettings) ? mergedSettings : defaultSettings;

  return {
    settings,
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions.filter(isValidSession) : [],
    workSessionsSinceLongBreak: isValidCycleCount(
      parsed.workSessionsSinceLongBreak,
      pomodorosPerCycle,
    )
      ? parsed.workSessionsSinceLongBreak
      : 0,
  };
}

function readSessionTimer(settings) {
  try {
    const raw = sessionStorage.getItem(SESSION_TIMER_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return isValidTimer(parsed, settings) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSessionTimer(timer) {
  try {
    sessionStorage.setItem(SESSION_TIMER_KEY, JSON.stringify(timer));
  } catch {
    // sessionStorage may be unavailable.
  }
}

function readDurableState(defaultSettings, pomodorosPerCycle) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return defaultDurable(defaultSettings);
    }

    const parsed = JSON.parse(raw);

    if (parsed.version === STORAGE_VERSION || parsed.version === 2) {
      const durable = parseDurablePayload(parsed, defaultSettings, pomodorosPerCycle);

      if (parsed.version === 2) {
        saveState({ ...durable, timer: defaultTimer(durable.settings) });
      }

      return durable;
    }

    const fresh = defaultDurable(defaultSettings);
    saveState({ ...fresh, timer: defaultTimer(defaultSettings) });
    return fresh;
  } catch {
    return defaultDurable(defaultSettings);
  }
}

export function loadState(defaultSettings, pomodorosPerCycle) {
  const durable = readDurableState(defaultSettings, pomodorosPerCycle);
  const timer = readSessionTimer(durable.settings) ?? defaultTimer(durable.settings);

  return { ...durable, timer };
}

export function saveState(state) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        settings: state.settings,
        sessions: state.sessions,
        workSessionsSinceLongBreak: state.workSessionsSinceLongBreak,
      }),
    );
    writeSessionTimer(state.timer);
  } catch {
    // Storage may be unavailable or full.
  }
}
