import './style.css';
import { WORK_DURATION, BREAK_DURATION } from './config.js';

const app = document.getElementById('app');
const modeIndicator = document.getElementById('mode-indicator');
const timeDisplay = document.getElementById('time-display');
const startPauseBtn = document.getElementById('start-pause-btn');
const resetBtn = document.getElementById('reset-btn');

let timeRemaining = WORK_DURATION;
let isRunning = false;
let currentMode = 'work';
let intervalId = null;

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getDurationForMode(mode) {
  return mode === 'work' ? WORK_DURATION : BREAK_DURATION;
}

function updateDOM() {
  timeDisplay.textContent = formatTime(timeRemaining);
  modeIndicator.textContent = currentMode === 'work' ? 'Work' : 'Break';
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
  timeRemaining = WORK_DURATION;
  updateDOM();
}

startPauseBtn.addEventListener('click', toggleStartPause);
resetBtn.addEventListener('click', reset);

updateDOM();
