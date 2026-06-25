import './style.css';
import { DEFAULT_WORK_MINUTES, DEFAULT_BREAK_MINUTES } from './config.js';
import { loadState, saveState } from './storage.js';

const defaultSettings = {
  workDurationSeconds: DEFAULT_WORK_MINUTES * 60,
  breakDurationSeconds: DEFAULT_BREAK_MINUTES * 60,
};

const persisted = loadState(defaultSettings);

const app = document.getElementById('app');
const modeIndicator = document.getElementById('mode-indicator');
const timeDisplay = document.getElementById('time-display');
const startPauseBtn = document.getElementById('start-pause-btn');
const resetBtn = document.getElementById('reset-btn');
const workDurationInput = document.getElementById('work-duration');
const breakDurationInput = document.getElementById('break-duration');
const applySettingsBtn = document.getElementById('apply-settings-btn');
const pomodoroCountEl = document.getElementById('pomodoro-count');

let workDuration = persisted.settings.workDurationSeconds;
let breakDuration = persisted.settings.breakDurationSeconds;
let sessions = persisted.sessions;
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
    },
    sessions,
    timer: getTimerSnapshot(),
  });
}

function addCompletedSession(completedAt) {
  sessions.push({
    completedAt,
    workDurationSeconds: workDuration,
  });
}

function flipMode(mode) {
  return mode === 'work' ? 'break' : 'work';
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
    if (mode === 'work') {
      addCompletedSession(new Date(deadline).toISOString());
    }

    mode = flipMode(mode);
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
    const completedMode = currentMode;

    if (completedMode === 'work') {
      addCompletedSession(new Date().toISOString());
    }

    switchMode();
  }

  persistState();
}

function recordCompletedPomodoro() {
  addCompletedSession(new Date().toISOString());
}

function formatPomodoroCount(count) {
  const label = count === 1 ? 'pomodoro' : 'pomodoros';
  return `${count} ${label} completed`;
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
  return mode === 'work' ? workDuration : breakDuration;
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
  const label = completedMode === 'work' ? 'Work complete!' : 'Break complete!';
  modeIndicator.textContent = label;
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
    modeIndicator.textContent = currentMode === 'work' ? 'Work' : 'Break';
  }

  app.dataset.mode = currentMode;
  startPauseBtn.textContent = isRunning ? 'Pause' : 'Start';
  pomodoroCountEl.textContent = formatPomodoroCount(sessions.length);
}

function switchMode() {
  currentMode = currentMode === 'work' ? 'break' : 'work';
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

    if (completedMode === 'work') {
      recordCompletedPomodoro();
    }

    notifyTimerComplete(completedMode);
    switchMode();

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

  if (workSeconds === null || breakSeconds === null) {
    return;
  }

  setDurationInputValue(workDurationInput, workSeconds);
  setDurationInputValue(breakDurationInput, breakSeconds);

  workDuration = workSeconds;
  breakDuration = breakSeconds;

  if (!isRunning) {
    timeRemaining = getDurationForMode(currentMode);
    updateDOM();
  }

  persistState();
}

setDurationInputValue(workDurationInput, workDuration);
setDurationInputValue(breakDurationInput, breakDuration);

startPauseBtn.addEventListener('click', toggleStartPause);
resetBtn.addEventListener('click', reset);
applySettingsBtn.addEventListener('click', applySettings);
window.addEventListener('pagehide', persistState);

restoreTimerState();
updateDOM();
