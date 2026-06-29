/**
 * Parse a duration string into total seconds.
 * Supports: MM:SS, HH:MM:SS, plain minutes (25), seconds (90s), and compound (25m30s).
 */
export function parseDurationString(raw, minTotal, maxTotal) {
  const result = parseDurationStringDetailed(raw, minTotal, maxTotal);
  return result.ok ? result.seconds : null;
}

export function parseDurationStringDetailed(raw, minTotal, maxTotal) {
  const value = raw.trim().toLowerCase();

  if (!value) {
    return { ok: false, error: 'empty' };
  }

  let totalSeconds = null;

  const hmsMatch = value.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  const msMatch = value.match(/^(\d+):(\d{1,2})$/);
  const secondsMatch = value.match(/^(\d+)\s*s$/);
  const minutesSecondsMatch = value.match(/^(\d+)\s*m(?:\s*(\d+)\s*s?)?$/);
  const hoursMatch = value.match(/^(\d+)\s*h(?:\s*(\d+)\s*m)?(?:\s*(\d+)\s*s?)?$/);

  if (hmsMatch) {
    const hours = Number.parseInt(hmsMatch[1], 10);
    const minutes = Number.parseInt(hmsMatch[2], 10);
    const seconds = Number.parseInt(hmsMatch[3], 10);

    if (minutes >= 60 || seconds >= 60) {
      return { ok: false, error: 'format' };
    }

    totalSeconds = hours * 3600 + minutes * 60 + seconds;
  } else if (msMatch) {
    const minutes = Number.parseInt(msMatch[1], 10);
    const seconds = Number.parseInt(msMatch[2], 10);

    if (seconds >= 60 || Number.isNaN(minutes) || Number.isNaN(seconds)) {
      return { ok: false, error: 'format' };
    }

    totalSeconds = minutes * 60 + seconds;
  } else if (secondsMatch) {
    totalSeconds = Number.parseInt(secondsMatch[1], 10);
  } else if (minutesSecondsMatch) {
    const minutes = Number.parseInt(minutesSecondsMatch[1], 10);
    const seconds = minutesSecondsMatch[2]
      ? Number.parseInt(minutesSecondsMatch[2], 10)
      : 0;

    if (seconds >= 60 || Number.isNaN(minutes) || Number.isNaN(seconds)) {
      return { ok: false, error: 'format' };
    }

    totalSeconds = minutes * 60 + seconds;
  } else if (hoursMatch) {
    const hours = Number.parseInt(hoursMatch[1], 10);
    const minutes = hoursMatch[2] ? Number.parseInt(hoursMatch[2], 10) : 0;
    const seconds = hoursMatch[3] ? Number.parseInt(hoursMatch[3], 10) : 0;

    if (minutes >= 60 || seconds >= 60) {
      return { ok: false, error: 'format' };
    }

    totalSeconds = hours * 3600 + minutes * 60 + seconds;
  } else if (/^\d+$/.test(value)) {
    totalSeconds = Number.parseInt(value, 10) * 60;
  } else {
    return { ok: false, error: 'format' };
  }

  if (totalSeconds === null || Number.isNaN(totalSeconds)) {
    return { ok: false, error: 'format' };
  }

  if (totalSeconds < minTotal) {
    return { ok: false, error: 'too-short', seconds: totalSeconds };
  }

  if (totalSeconds > maxTotal) {
    return { ok: false, error: 'too-long', seconds: totalSeconds };
  }

  return { ok: true, seconds: totalSeconds };
}

export function parseDurationInputDetailed(input) {
  const minTotal = Number.parseInt(input.dataset.minSeconds, 10);
  const maxTotal = Number.parseInt(input.dataset.maxSeconds, 10);

  return parseDurationStringDetailed(input.value, minTotal, maxTotal);
}

export function formatDuration(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationBoundsMessage(minTotal, maxTotal) {
  const minLabel = formatDuration(minTotal);
  const maxLabel = formatDuration(maxTotal);

  if (minTotal === maxTotal) {
    return minLabel;
  }

  return `${minLabel} to ${maxLabel}`;
}
