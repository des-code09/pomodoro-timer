import './style.css';
import { DEFAULT_WORK_MINUTES, DEFAULT_BREAK_MINUTES } from './config.js';

const app = document.getElementById('app');
const modeIndicator = document.getElementById('mode-indicator');
const timeDisplay = document.getElementById('time-display');
const startPauseBtn = document.getElementById('start-pause-btn');
const resetBtn = document.getElementById('reset-btn');
const workDurationInput = document.getElementById('work-duration');
const breakDurationInput = document.getElementById('break-duration');
const applySettingsBtn = document.getElementById('apply-settings-btn');

let workDuration = DEFAULT_WORK_MINUTES * 60;
let breakDuration = DEFAULT_BREAK_MINUTES * 60;
let timeRemaining = workDuration;
let isRunning = false;
let currentMode = 'work';
let intervalId = null;
let notificationTimeoutId = null;

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getDurationForMode(mode) {
  return mode === 'work' ? workDuration : breakDuration;
}

function parseMinutesInput(input) {
  const value = Number.parseInt(input.value, 10);
  const min = Number.parseInt(input.min, 10);
  const max = Number.parseInt(input.max, 10);

  if (Number.isNaN(value)) {
    return null;
  }

  return Math.min(max, Math.max(min, value));
}

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.6);
  } catch {
    // Audio may be unavailable until user interaction or in unsupported environments.
  }
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
  playNotificationSound();
  showVisualNotification(completedMode);
}

function updateDOM() {
  timeDisplay.textContent = formatTime(timeRemaining);

  if (!timeDisplay.classList.contains('time-display--complete')) {
    modeIndicator.textContent = currentMode === 'work' ? 'Work' : 'Break';
  }

  app.dataset.mode = currentMode;
  startPauseBtn.textContent = isRunning ? 'Pause' : 'Start';
}

function switchMode() {
  currentMode = currentMode === 'work' ? 'break' : 'work';
  timeRemaining = getDurationForMode(currentMode);
}

function tick() {
  timeRemaining -= 1;

  if (timeRemaining <= 0) {
    const completedMode = currentMode;
    notifyTimerComplete(completedMode);
    switchMode();
  }

  updateDOM();
}

function startTimer() {
  if (isRunning) return;
  isRunning = true;
  intervalId = setInterval(tick, 1000);
  updateDOM();
}

function pauseTimer() {
  if (!isRunning) return;
  isRunning = false;
  clearInterval(intervalId);
  intervalId = null;
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
  clearTimeout(notificationTimeoutId);
  updateDOM();
}

function applySettings() {
  const workMinutes = parseMinutesInput(workDurationInput);
  const breakMinutes = parseMinutesInput(breakDurationInput);

  if (workMinutes === null || breakMinutes === null) {
    return;
  }

  workDurationInput.value = workMinutes;
  breakDurationInput.value = breakMinutes;

  workDuration = workMinutes * 60;
  breakDuration = breakMinutes * 60;

  if (!isRunning) {
    timeRemaining = getDurationForMode(currentMode);
    updateDOM();
  }
}

workDurationInput.value = DEFAULT_WORK_MINUTES;
breakDurationInput.value = DEFAULT_BREAK_MINUTES;

startPauseBtn.addEventListener('click', toggleStartPause);
resetBtn.addEventListener('click', reset);
applySettingsBtn.addEventListener('click', applySettings);

updateDOM();
