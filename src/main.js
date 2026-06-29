import './style.css';
import {
  DEFAULT_WORK_MINUTES,
  DEFAULT_BREAK_MINUTES,
  DEFAULT_LONG_BREAK_MINUTES,
  POMODOROS_PER_CYCLE,
} from './config.js';
import { formatDuration, parseDurationInputDetailed, formatDurationBoundsMessage } from './duration.js';
import { loadState, saveState } from './storage.js';

const defaultSettings = {
  workDurationSeconds: DEFAULT_WORK_MINUTES * 60,
  breakDurationSeconds: DEFAULT_BREAK_MINUTES * 60,
  longBreakDurationSeconds: DEFAULT_LONG_BREAK_MINUTES * 60,
};

const persisted = loadState(defaultSettings, POMODOROS_PER_CYCLE);

const app = document.getElementById('app');
const modeIndicator = document.getElementById('mode-indicator');
const timeDisplay = document.getElementById('time-display');
const startPauseBtn = document.getElementById('start-pause-btn');
const resetBtn = document.getElementById('reset-btn');
const workDurationInput = document.getElementById('work-duration');
const breakDurationInput = document.getElementById('break-duration');
const longBreakDurationInput = document.getElementById('long-break-duration');
const applySettingsBtn = document.getElementById('apply-settings-btn');
const settingsFeedbackEl = document.getElementById('settings-feedback');
const pomodoroCountEl = document.getElementById('pomodoro-count');
const cycleCountEl = document.getElementById('cycle-count');

const requiredElements = {
  app,
  modeIndicator,
  timeDisplay,
  startPauseBtn,
  resetBtn,
  workDurationInput,
  breakDurationInput,
  longBreakDurationInput,
  applySettingsBtn,
  settingsFeedbackEl,
  pomodoroCountEl,
  cycleCountEl,
};

for (const [name, element] of Object.entries(requiredElements)) {
  if (!element) {
    throw new Error(`Missing required element: ${name}`);
  }
}

let workDuration = persisted.settings.workDurationSeconds;
let breakDuration = persisted.settings.breakDurationSeconds;
let longBreakDuration = persisted.settings.longBreakDurationSeconds;
let sessions = persisted.sessions;
let workSessionsSinceLongBreak = persisted.workSessionsSinceLongBreak;
let currentMode = persisted.timer.currentMode;
let timeRemaining = persisted.timer.timeRemaining;
const UI_THEME_SWITCH_PROGRESS = 0.58;

let isRunning = false;
let endsAt = null;
let intervalId = null;
let progressFrameId = null;
let notificationTimeoutId = null;
let settingsFeedbackTimeoutId = null;
let audioContext = null;

function getTimerSnapshot() {
  return {
    currentMode,
    timeRemaining,
    isRunning,
    endsAt: isRunning && endsAt !== null ? endsAt : null,
  };
}

function syncTimeRemainingFromDeadline() {
  if (isRunning && endsAt !== null) {
    timeRemaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  }
}

function persistState() {
  saveState({
    settings: {
      workDurationSeconds: workDuration,
      breakDurationSeconds: breakDuration,
      longBreakDurationSeconds: longBreakDuration,
    },
    sessions,
    workSessionsSinceLongBreak,
    timer: getTimerSnapshot(),
  });
}

function addCompletedSession(completedAt) {
  sessions.push({
    completedAt,
    workDurationSeconds: workDuration,
  });
}

function getNextModeAfterCompletion(completedMode, completedAt) {
  if (completedMode === 'work') {
    addCompletedSession(completedAt);
    workSessionsSinceLongBreak += 1;

    return workSessionsSinceLongBreak >= POMODOROS_PER_CYCLE ? 'long-break' : 'break';
  }

  if (completedMode === 'long-break') {
    workSessionsSinceLongBreak = 0;
    return 'work';
  }

  return 'work';
}

function catchUpTimerState(timer) {
  if (!timer.isRunning || timer.endsAt === null) {
    return {
      currentMode: timer.currentMode,
      timeRemaining: timer.timeRemaining,
      shouldResume: false,
      endsAt: null,
    };
  }

  let mode = timer.currentMode;
  let remainingMs = timer.endsAt - Date.now();
  let deadline = timer.endsAt;

  while (remainingMs <= 0) {
    mode = getNextModeAfterCompletion(mode, new Date(deadline).toISOString());
    deadline += getDurationForMode(mode) * 1000;
    remainingMs = deadline - Date.now();
  }

  return {
    currentMode: mode,
    timeRemaining: Math.ceil(remainingMs / 1000),
    shouldResume: true,
    endsAt: deadline,
  };
}

function restoreTimerState() {
  const restored = catchUpTimerState(persisted.timer);

  currentMode = restored.currentMode;
  timeRemaining = restored.timeRemaining;

  if (restored.shouldResume && timeRemaining > 0) {
    startTimer(restored.endsAt);
    return;
  }

  if (restored.shouldResume && timeRemaining <= 0) {
    currentMode = getNextModeAfterCompletion(currentMode, new Date().toISOString());
    timeRemaining = getDurationForMode(currentMode);
  }

  persistState();
}

function getModeLabel(mode) {
  if (mode === 'long-break') {
    return 'Long break';
  }

  return mode === 'work' ? 'Work' : 'Break';
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === 'suspended') {
    return audioContext.resume();
  }

  return Promise.resolve();
}

function playNotificationSound() {
  ensureAudioContext()
    .then(() => {
      if (!audioContext) return;

      const now = audioContext.currentTime;

      [0, 0.25].forEach((offset) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.25, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.3);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.3);
      });
    })
    .catch(() => {
      // Audio may be unavailable in unsupported environments.
    });
}

function setDurationInputValue(input, totalSeconds) {
  input.value = formatDuration(totalSeconds);
}

function getDurationForMode(mode) {
  if (mode === 'work') {
    return workDuration;
  }

  if (mode === 'long-break') {
    return longBreakDuration;
  }

  return breakDuration;
}

function clearSettingsInputErrors() {
  [workDurationInput, breakDurationInput, longBreakDurationInput].forEach((input) => {
    input.classList.remove('settings-panel__input--invalid');
  });
}

function markSettingsInputErrors(inputs) {
  clearSettingsInputErrors();
  inputs.forEach((input) => input.classList.add('settings-panel__input--invalid'));
}

function showSettingsFeedback(message, isError = false) {
  settingsFeedbackEl.textContent = message;
  settingsFeedbackEl.classList.toggle('settings-panel__feedback--error', isError);
  settingsFeedbackEl.classList.toggle('settings-panel__feedback--success', !isError);

  clearTimeout(settingsFeedbackTimeoutId);
  settingsFeedbackTimeoutId = setTimeout(() => {
    settingsFeedbackEl.textContent = '';
    settingsFeedbackEl.classList.remove('settings-panel__feedback--error', 'settings-panel__feedback--success');
  }, isError ? 4000 : 2500);
}

function showVisualNotification(completedMode) {
  const labels = {
    work: 'Work complete!',
    break: 'Break complete!',
    'long-break': 'Long break complete!',
  };
  modeIndicator.textContent = labels[completedMode];
  timeDisplay.classList.add('time-display--complete');

  clearTimeout(notificationTimeoutId);
  notificationTimeoutId = setTimeout(() => {
    timeDisplay.classList.remove('time-display--complete');
    updateDOM();
  }, 1200);
}

function getModeElapsedSeconds() {
  const total = getDurationForMode(currentMode);

  if (total <= 0) {
    return 0;
  }

  const remainingSeconds =
    isRunning && endsAt !== null
      ? Math.max(0, (endsAt - Date.now()) / 1000)
      : timeRemaining;

  return Math.max(0, total - remainingSeconds);
}

function getSceneProgress() {
  const total = getDurationForMode(currentMode);

  if (total <= 0) {
    return currentMode === 'work' ? 0 : 1;
  }

  const raw = Math.min(1, getModeElapsedSeconds() / total);

  if (currentMode === 'break' || currentMode === 'long-break') {
    // Break: night at start → full day by end
    return 1 - raw;
  }

  // Work: full day at start → night by end (linear so each second reads clearly)
  return raw;
}

function snapWorkDayUi() {
  app.classList.add('ui-snap');
  app.dataset.uiTheme = 'day';
  app.style.setProperty('--ui-day-blend', '100%');
  app.style.setProperty('--ui-night-blend', '0%');
  app.style.setProperty('--card-surface-opacity', '94%');
  app.style.setProperty('--backdrop-blur', '4');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      app.classList.remove('ui-snap');
    });
  });
}

function getUiTheme(sceneProgress) {
  return sceneProgress >= UI_THEME_SWITCH_PROGRESS ? 'night' : 'day';
}

function getTwilightGlow(sceneProgress) {
  // Wide vivid band around midpoint so dawn/dusk reads clearly
  const distance = Math.abs(sceneProgress - 0.5);
  return Math.max(0, Math.min(1, (0.58 - distance) * 2.1));
}

function getCardSurfaceOpacity(sceneProgress) {
  const twilightPeak = getTwilightGlow(sceneProgress);
  return 0.84 - twilightPeak * 0.28;
}

function updateDayProgress() {
  const sceneProgress = getSceneProgress();
  const uiTheme =
    currentMode === 'work' ? getUiTheme(sceneProgress) : 'night';
  const twilightGlow = getTwilightGlow(sceneProgress);
  let cardOpacity =
    currentMode === 'work' ? getCardSurfaceOpacity(sceneProgress) : 0.88;

  if (currentMode === 'work' && uiTheme === 'day') {
    cardOpacity = Math.max(cardOpacity, 0.96);
  }

  if (currentMode === 'work' && uiTheme === 'night') {
    cardOpacity = Math.max(cardOpacity, 0.93);
  }

  if (twilightGlow > 0.2 && uiTheme === 'night' && currentMode !== 'work') {
    cardOpacity = Math.min(cardOpacity, 0.82);
  }

  app.style.setProperty('--day-progress', sceneProgress.toFixed(4));
  app.style.setProperty('--scene-day-blend', `${((1 - sceneProgress) * 100).toFixed(1)}%`);
  app.style.setProperty('--scene-night-blend', `${(sceneProgress * 100).toFixed(1)}%`);
  app.style.setProperty('--twilight-glow', twilightGlow.toFixed(4));
  app.style.setProperty('--twilight-peak', twilightGlow.toFixed(4));
  app.style.setProperty('--card-surface-opacity', `${(cardOpacity * 100).toFixed(1)}%`);
  app.style.setProperty('--orb-top', `${10 + sceneProgress * 24}%`);

  if (app.dataset.uiTheme !== uiTheme) {
    app.dataset.uiTheme = uiTheme;
  }

  app.style.setProperty('--ui-day-blend', uiTheme === 'day' ? '100%' : '0%');
  app.style.setProperty('--ui-night-blend', uiTheme === 'night' ? '100%' : '0%');
  app.style.setProperty('--backdrop-blur', uiTheme === 'day' ? '4' : '5');
  app.dataset.phase = sceneProgress < 0.33 ? 'day' : sceneProgress < 0.66 ? 'twilight' : 'night';
}

function progressFrame() {
  if (!isRunning) {
    progressFrameId = null;
    return;
  }

  updateDayProgress();

  if (endsAt !== null && Date.now() >= endsAt) {
    progressFrameId = null;
    return;
  }

  progressFrameId = requestAnimationFrame(progressFrame);
}

function startProgressLoop() {
  if (progressFrameId !== null) {
    return;
  }

  if (isRunning) {
    progressFrameId = requestAnimationFrame(progressFrame);
  }
}

function stopProgressLoop() {
  if (progressFrameId !== null) {
    cancelAnimationFrame(progressFrameId);
    progressFrameId = null;
  }
}

function updateDOM() {
  timeDisplay.textContent = formatDuration(timeRemaining);

  if (!timeDisplay.classList.contains('time-display--complete')) {
    modeIndicator.textContent = getModeLabel(currentMode);
  }

  app.dataset.mode = currentMode;
  updateDayProgress();

  startPauseBtn.setAttribute('aria-label', isRunning ? 'Pause' : 'Start');
  startPauseBtn.dataset.state = isRunning ? 'pause' : 'play';
  pomodoroCountEl.textContent = String(sessions.length);
  cycleCountEl.textContent = String(workSessionsSinceLongBreak);
}

function advanceAfterCompletion(completedMode) {
  stopProgressLoop();
  currentMode = getNextModeAfterCompletion(completedMode, new Date().toISOString());
  timeRemaining = getDurationForMode(currentMode);
  app.dataset.mode = currentMode;

  if (currentMode === 'work') {
    snapWorkDayUi();
  }

  if (isRunning) {
    endsAt = Date.now() + timeRemaining * 1000;
    startProgressLoop();
  } else {
    endsAt = null;
  }

  updateDayProgress();
  playNotificationSound();
  triggerBackgroundFlash();
}

function triggerBackgroundFlash() {
  app.classList.remove('mode-switch-flash');
  void app.offsetWidth;
  app.classList.add('mode-switch-flash');
  app.addEventListener(
    'animationend',
    () => app.classList.remove('mode-switch-flash'),
    { once: true },
  );
}

function tick() {
  syncTimeRemainingFromDeadline();

  if (timeRemaining <= 0) {
    const completedMode = currentMode;

    showVisualNotification(completedMode);
    advanceAfterCompletion(completedMode);

    if (isRunning) {
      persistState();
    }
  }

  updateDOM();
}

function startTimer(resumeEndsAt = null) {
  if (isRunning) return;
  ensureAudioContext();
  endsAt = resumeEndsAt ?? Date.now() + timeRemaining * 1000;
  isRunning = true;
  intervalId = setInterval(tick, 1000);
  startProgressLoop();
  persistState();
  updateDOM();
}

function pauseTimer() {
  if (!isRunning) return;
  syncTimeRemainingFromDeadline();
  isRunning = false;
  endsAt = null;
  stopProgressLoop();
  clearInterval(intervalId);
  intervalId = null;
  persistState();
  updateDOM();
}

function toggleStartPause() {
  if (isRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
}

function reset() {
  pauseTimer();
  currentMode = 'work';
  timeRemaining = workDuration;
  endsAt = null;
  stopProgressLoop();
  timeDisplay.classList.remove('time-display--complete');
  app.classList.remove('mode-switch-flash');
  clearTimeout(notificationTimeoutId);
  snapWorkDayUi();
  persistState();
  updateDOM();
}

function applySettings() {
  const fieldLabels = new Map([
    [workDurationInput, 'Work'],
    [breakDurationInput, 'Break'],
    [longBreakDurationInput, 'Long break'],
  ]);
  const parsed = [workDurationInput, breakDurationInput, longBreakDurationInput].map((input) => ({
    input,
    label: fieldLabels.get(input),
    result: parseDurationInputDetailed(input),
  }));
  const invalid = parsed.filter(({ result }) => !result.ok);

  if (invalid.length > 0) {
    markSettingsInputErrors(invalid.map(({ input }) => input));

    const first = invalid[0];
    const minTotal = Number.parseInt(first.input.dataset.minSeconds, 10);
    const maxTotal = Number.parseInt(first.input.dataset.maxSeconds, 10);
    const bounds = formatDurationBoundsMessage(minTotal, maxTotal);

    let message;

    if (first.result.error === 'too-short') {
      message = `${first.label} must be at least ${formatDuration(minTotal)} (00:00 is not allowed).`;
    } else if (first.result.error === 'too-long') {
      message = `${first.label} must be ${bounds} or less.`;
    } else if (first.result.error === 'empty') {
      message = `${first.label} duration is required.`;
    } else {
      message = `${first.label}: use MM:SS, 90s, 25m30s, or minutes (e.g. 25).`;
    }

    showSettingsFeedback(message, true);
    return;
  }

  clearSettingsInputErrors();

  const workSeconds = parsed[0].result.seconds;
  const breakSeconds = parsed[1].result.seconds;
  const longBreakSeconds = parsed[2].result.seconds;

  setDurationInputValue(workDurationInput, workSeconds);
  setDurationInputValue(breakDurationInput, breakSeconds);
  setDurationInputValue(longBreakDurationInput, longBreakSeconds);

  workDuration = workSeconds;
  breakDuration = breakSeconds;
  longBreakDuration = longBreakSeconds;

  const newDuration = getDurationForMode(currentMode);

  if (!isRunning) {
    timeRemaining = newDuration;
  } else {
    timeRemaining = Math.min(timeRemaining, newDuration);
    endsAt = Date.now() + timeRemaining * 1000;
  }

  updateDOM();
  persistState();
  showSettingsFeedback('Settings applied.');
}

function handleSettingsKeydown(event) {
  if (event.key !== 'Enter') {
    return;
  }

  event.preventDefault();
  applySettings();
}

function isTypingContext(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;

  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function handleKeyboardShortcut(event) {
  if (isTypingContext(event.target)) {
    return;
  }

  if (event.code === 'Space') {
    if (event.target.closest('button')) {
      return;
    }

    event.preventDefault();
    toggleStartPause();
    return;
  }

  if (event.key === 'r' || event.key === 'R') {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    reset();
  }
}

setDurationInputValue(workDurationInput, workDuration);
setDurationInputValue(breakDurationInput, breakDuration);
setDurationInputValue(longBreakDurationInput, longBreakDuration);

function initializeApp() {
  app.classList.add('ui-snap');
  restoreTimerState();
  updateDOM();
  document.documentElement.classList.add('app-ready');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      app.classList.remove('ui-snap');
    });
  });
}

startPauseBtn.addEventListener('click', toggleStartPause);
resetBtn.addEventListener('click', reset);
applySettingsBtn.addEventListener('click', applySettings);
[workDurationInput, breakDurationInput, longBreakDurationInput].forEach((input) => {
  input.addEventListener('keydown', handleSettingsKeydown);
});
window.addEventListener('keydown', handleKeyboardShortcut);
window.addEventListener('pagehide', persistState);

initializeApp();
