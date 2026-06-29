import './style.css';
import {
  DEFAULT_WORK_MINUTES,
  DEFAULT_BREAK_MINUTES,
  DEFAULT_LONG_BREAK_MINUTES,
  POMODOROS_PER_CYCLE,
} from './config.js';
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
const pomodoroCountEl = document.getElementById('pomodoro-count');
const cycleCountEl = document.getElementById('cycle-count');

let workDuration = persisted.settings.workDurationSeconds;
let breakDuration = persisted.settings.breakDurationSeconds;
let longBreakDuration = persisted.settings.longBreakDurationSeconds;
let sessions = persisted.sessions;
let workSessionsSinceLongBreak = persisted.workSessionsSinceLongBreak;
let currentMode = persisted.timer.currentMode;
let timeRemaining = persisted.timer.timeRemaining;
let isRunning = false;
let intervalId = null;
let notificationTimeoutId = null;
let audioContext = null;

function getTimerSnapshot() {
  return {
    currentMode,
    timeRemaining,
    isRunning,
    endsAt: isRunning ? Date.now() + timeRemaining * 1000 : null,
  };
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
  };
}

function restoreTimerState() {
  const restored = catchUpTimerState(persisted.timer);

  currentMode = restored.currentMode;
  timeRemaining = restored.timeRemaining;

  if (restored.shouldResume && timeRemaining > 0) {
    startTimer();
    return;
  }

  if (restored.shouldResume && timeRemaining <= 0) {
    currentMode = getNextModeAfterCompletion(currentMode, new Date().toISOString());
    timeRemaining = getDurationForMode(currentMode);
  }

  persistState();
}

function formatPomodoroCount(count) {
  return String(count);
}

function formatCycleCount(count) {
  return String(count);
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

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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

function parseDurationInput(input) {
  const match = input.value.trim().match(/^(\d+):(\d{1,2})$/);

  if (!match) {
    return null;
  }

  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);
  const minTotal = Number.parseInt(input.dataset.minSeconds, 10);
  const maxTotal = Number.parseInt(input.dataset.maxSeconds, 10);

  if (seconds >= 60 || Number.isNaN(minutes) || Number.isNaN(seconds)) {
    return null;
  }

  const totalSeconds = minutes * 60 + seconds;

  if (totalSeconds < minTotal || totalSeconds > maxTotal) {
    return null;
  }

  return totalSeconds;
}

function setDurationInputValue(input, totalSeconds) {
  input.value = formatTime(totalSeconds);
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

function notifyTimerComplete(completedMode) {
  showVisualNotification(completedMode);
}

function updateDOM() {
  timeDisplay.textContent = formatTime(timeRemaining);

  if (!timeDisplay.classList.contains('time-display--complete')) {
    modeIndicator.textContent = getModeLabel(currentMode);
  }

  app.dataset.mode = currentMode;
  startPauseBtn.textContent = isRunning ? 'Pause' : 'Start';
  pomodoroCountEl.textContent = formatPomodoroCount(sessions.length);
  cycleCountEl.textContent = formatCycleCount(workSessionsSinceLongBreak);
}

function advanceAfterCompletion(completedMode) {
  currentMode = getNextModeAfterCompletion(completedMode, new Date().toISOString());
  timeRemaining = getDurationForMode(currentMode);
  app.dataset.mode = currentMode;
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
  timeRemaining -= 1;

  if (timeRemaining <= 0) {
    const completedMode = currentMode;

    notifyTimerComplete(completedMode);
    advanceAfterCompletion(completedMode);

    if (isRunning) {
      persistState();
    }
  }

  updateDOM();
}

function startTimer() {
  if (isRunning) return;
  ensureAudioContext();
  isRunning = true;
  intervalId = setInterval(tick, 1000);
  persistState();
  updateDOM();
}

function pauseTimer() {
  if (!isRunning) return;
  isRunning = false;
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
  timeDisplay.classList.remove('time-display--complete');
  app.classList.remove('mode-switch-flash');
  clearTimeout(notificationTimeoutId);
  persistState();
  updateDOM();
}

function applySettings() {
  const workSeconds = parseDurationInput(workDurationInput);
  const breakSeconds = parseDurationInput(breakDurationInput);
  const longBreakSeconds = parseDurationInput(longBreakDurationInput);

  if (workSeconds === null || breakSeconds === null || longBreakSeconds === null) {
    return;
  }

  setDurationInputValue(workDurationInput, workSeconds);
  setDurationInputValue(breakDurationInput, breakSeconds);
  setDurationInputValue(longBreakDurationInput, longBreakSeconds);

  workDuration = workSeconds;
  breakDuration = breakSeconds;
  longBreakDuration = longBreakSeconds;

  if (!isRunning) {
    timeRemaining = getDurationForMode(currentMode);
    updateDOM();
  }

  persistState();
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

startPauseBtn.addEventListener('click', toggleStartPause);
resetBtn.addEventListener('click', reset);
applySettingsBtn.addEventListener('click', applySettings);
window.addEventListener('keydown', handleKeyboardShortcut);
window.addEventListener('pagehide', persistState);

restoreTimerState();
updateDOM();
