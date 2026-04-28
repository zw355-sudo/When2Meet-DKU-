<script setup>
import { useI18n } from "../i18n";

defineProps({
  rows: { type: Array, required: true },
  notes: { type: Array, default: () => [] },
});

const emit = defineEmits(["save-row", "skip-row"]);

const { t, eventTypeLabel, formatDateTime } = useI18n();

function formatRange(isoStart, isoEnd) {
  try {
    const a = new Date(isoStart);
    const b = new Date(isoEnd);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${isoStart} ~ ${isoEnd}`;
    return `${formatDateTime(a)} ~ ${formatDateTime(b)}`;
  } catch {
    return `${isoStart} ~ ${isoEnd}`;
  }
}

function icsServerStatusLabel(status) {
  if (status === "ready") return t("import.serverReady");
  if (status === "conflict") return t("import.serverConflict");
  if (status === "invalid") return t("import.serverInvalid");
  return status || "";
}
</script>

<template>
  <div class="import-queue">
    <ul v-if="rows.length" class="list import-queue-list">
      <li
        v-for="row in rows"
        :key="row.key"
        class="import-queue-item"
        :class="{ 'row-skipped': row.status === 'skipped', 'row-saved': row.status === 'saved' }"
      >
        <div class="import-queue-main">
          <div class="import-queue-titles">
            <strong>{{ row.title || t("profile.noTitle") }}</strong>
            <span v-if="row.isRecurring" class="recurring-tag">{{ t("profile.recurring") }}</span>
            <span v-if="row.icsStatus" class="ics-status-tag" :class="`ics-${row.icsStatus}`">{{
              icsServerStatusLabel(row.icsStatus)
            }}</span>
            <span v-if="row.conflict && row.status === 'pending'" class="ics-status-tag ics-conflict">{{
              t("import.calendarConflict")
            }}</span>
            <span v-else-if="row.payload && row.status === 'pending' && !row.conflict" class="ics-status-tag ics-ready">{{
              t("import.canSave")
            }}</span>
            <span v-if="row.eventType" class="muted import-type">{{ eventTypeLabel(row.eventType) }}</span>
          </div>
          <p v-if="row.payload && row.displayStart && row.displayEnd">{{ formatRange(row.displayStart, row.displayEnd) }}</p>
          <p v-else-if="row.reason" class="muted">{{ row.reason }}</p>
          <p v-if="row.location" class="muted">{{ t("home.locationLabel") }}: {{ row.location }}</p>
          <p v-if="row.conflict && row.overlapIds?.length" class="muted">
            {{ t("import.overlapCount", { n: row.overlapIds.length }) }}
          </p>
        </div>
        <div class="import-queue-actions">
          <template v-if="row.status === 'pending' && row.payload">
            <template v-if="!row.conflict">
              <button type="button" class="ghost" @click="emit('save-row', { row, overwrite: false })">
                {{ t("import.save") }}
              </button>
            </template>
            <template v-else>
              <button type="button" class="ghost" @click="emit('skip-row', row)">{{ t("import.skip") }}</button>
              <button type="button" @click="emit('save-row', { row, overwrite: true })">{{ t("import.overwriteSave") }}</button>
            </template>
          </template>
          <template v-else-if="row.status === 'pending' && !row.payload">
            <button type="button" class="ghost" @click="emit('skip-row', row)">{{ t("import.skip") }}</button>
          </template>
          <span v-else-if="row.status === 'skipped'" class="muted">{{ t("import.skipped") }}</span>
          <span v-else-if="row.status === 'saved'" class="muted">{{ t("import.savedRow") }}</span>
        </div>
      </li>
    </ul>
    <div v-if="notes?.length" class="notes">
      <strong>{{ t("import.notes") }}</strong>
      <ul>
        <li v-for="(n, i) in notes" :key="i">{{ n }}</li>
      </ul>
    </div>
  </div>
</template>
