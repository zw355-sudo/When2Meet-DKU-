/** 与后端 ICS 冲突判定一致：仅与 eventType===busy 的区间做区间重叠检测 */
export function findBusyOverlap(startIso, endIso, allEvents) {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return { hasConflict: false, ids: [] };
  const ids = [];
  for (const ev of allEvents || []) {
    if (ev.eventType !== "busy") continue;
    const os = new Date(ev.startTime).getTime();
    const oe = new Date(ev.endTime).getTime();
    if (Number.isNaN(os) || Number.isNaN(oe)) continue;
    if (os < e && oe > s) ids.push(ev.id);
  }
  return { hasConflict: ids.length > 0, ids };
}
