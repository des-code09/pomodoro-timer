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
let audioContext = null;

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
    notifyTimerComplete(completedMode);
    switchMode();
  }

  updateDOM();
}

function startTimer() {
  if (isRunning) return;
  ensureAudioContext();
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
  app.classList.remove('mode-switch-flash');
  clearTimeout(notificationTimeoutId);
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
}

setDurationInputValue(workDurationInput, DEFAULT_WORK_MINUTES * 60);
setDurationInputValue(breakDurationInput, DEFAULT_BREAK_MINUTES * 60);

startPauseBtn.addEventListener('click', toggleStartPause);
resetBtn.addEventListener('click', reset);
applySettingsBtn.addEventListener('click', applySettings);

updateDOM();
