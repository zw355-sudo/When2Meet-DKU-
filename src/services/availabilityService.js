function toMs(dateLike) {
  return new Date(dateLike).getTime();
}

function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  const sorted = intervals.sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= prev.end) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function invertIntervals(rangeStart, rangeEnd, busyIntervals) {
  const free = [];
  let cursor = rangeStart;
  for (const interval of busyIntervals) {
    if (interval.start > cursor) {
      free.push({ start: cursor, end: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < rangeEnd) {
    free.push({ start: cursor, end: rangeEnd });
  }
  return free;
}

function intersectIntervals(a, b) {
  const intersections = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (start < end) intersections.push({ start, end });
    if (a[i].end < b[j].end) i += 1;
    else j += 1;
  }

  return intersections;
}

function filterByMinimumDuration(intervals, durationMinutes) {
  const durationMs = durationMinutes * 60 * 1000;
  return intervals
    .filter((interval) => interval.end - interval.start >= durationMs)
    .map((interval) => ({
      startTime: new Date(interval.start).toISOString(),
      endTime: new Date(interval.end).toISOString(),
      durationMinutes: Math.floor((interval.end - interval.start) / 60000),
    }));
}

function computeCommonAvailability({
  rangeStartIso,
  rangeEndIso,
  participantsBusyEvents,
  durationMinutes,
}) {
  const rangeStart = toMs(rangeStartIso);
  const rangeEnd = toMs(rangeEndIso);

  if (participantsBusyEvents.length === 0) return [];

  const participantFreeMaps = participantsBusyEvents.map((events) => {
    const busy = events
      .map((event) => ({
        start: Math.max(toMs(event.start_time), rangeStart),
        end: Math.min(toMs(event.end_time), rangeEnd),
      }))
      .filter((item) => item.start < item.end);

    const mergedBusy = mergeIntervals(busy);
    return invertIntervals(rangeStart, rangeEnd, mergedBusy);
  });

  const commonFree = participantFreeMaps.reduce((acc, current) => intersectIntervals(acc, current));
  return filterByMinimumDuration(commonFree, durationMinutes);
}

module.exports = {
  computeCommonAvailability,
};
