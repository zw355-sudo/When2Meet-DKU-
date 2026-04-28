<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { api } from "../lib/api";
import { useI18n } from "../i18n";
import { findBusyOverlap } from "../lib/importOverlap.js";
import ImportPreviewQueue from "./ImportPreviewQueue.vue";
import LocaleSwitcher from "../components/LocaleSwitcher.vue";

const { t, eventTypeLabel, formatDateTime, dateInputLang } = useI18n();

const loading = ref(false);
const message = ref("");
const profileEditMode = ref(false);

const profile = reactive({
  displayName: "",
  major: "",
  avatarUrl: "",
  email: "",
});

const calendarForm = reactive({
  title: "",
  description: "",
  location: "",
  startTime: "",
  endTime: "",
  eventType: "busy",
  isRecurring: false,
  recurrenceRule: "",
  recurrenceStartDate: "",
  recurrenceEndDate: "",
  source: "manual",
});

const events = ref([]);
const editingId = ref(null);

const icsFile = ref(null);
const icsPreview = ref(null);
const icsQueueRows = ref([]);
const icsInputRef = ref(null);
const aiImageFile = ref(null);
const aiImageInputRef = ref(null);
const aiImagePrompt = ref("");
const aiImageResult = ref(null);
const aiTextPrompt = ref("");
const aiTextResult = ref(null);
const aiTextIncludeCalendar = ref(true);
const aiImageQueueRows = ref([]);
const aiTextQueueRows = ref([]);

const canBulkIcs = computed(() =>
  icsQueueRows.value.some((r) => r.status === "pending" && r.payload && !r.conflict)
);
const canBulkAiImage = computed(() =>
  aiImageQueueRows.value.some((r) => r.status === "pending" && r.payload && !r.conflict)
);
const canBulkAiText = computed(() =>
  aiTextQueueRows.value.some((r) => r.status === "pending" && r.payload && !r.conflict)
);
const hasIcsConflictPending = computed(() =>
  icsQueueRows.value.some((r) => r.status === "pending" && r.payload && r.conflict)
);
const hasAiImageConflictPending = computed(() =>
  aiImageQueueRows.value.some((r) => r.status === "pending" && r.payload && r.conflict)
);
const hasAiTextConflictPending = computed(() =>
  aiTextQueueRows.value.some((r) => r.status === "pending" && r.payload && r.conflict)
);
const canParseIcs = computed(() => Boolean(icsFile.value));

function setMessage(text) {
  message.value = text;
}

function resetForm() {
  editingId.value = null;
  Object.assign(calendarForm, {
    title: "",
    description: "",
    location: "",
    startTime: "",
    endTime: "",
    eventType: "busy",
    isRecurring: false,
    recurrenceRule: "",
    recurrenceStartDate: "",
    recurrenceEndDate: "",
    source: "manual",
  });
}

async function loadProfile() {
  const data = await api("/me");
  profile.displayName = data.displayName || "";
  profile.major = data.major || "";
  profile.avatarUrl = data.avatarUrl || "";
  profile.email = data.email || "";
}

async function saveProfile() {
  loading.value = true;
  try {
    await api("/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: profile.displayName || null,
        major: profile.major || null,
        avatarUrl: profile.avatarUrl || null,
      }),
    });
    profileEditMode.value = false;
    setMessage(t("profile.msgProfileUpdated"));
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

async function loadEvents() {
  events.value = await api("/me/calendar-events");
  refreshQueueConflicts(icsQueueRows);
  refreshQueueConflicts(aiImageQueueRows);
  refreshQueueConflicts(aiTextQueueRows);
}

/** 模板里 ref 会自动解包成数组；脚本里传入的是 ref。统一取列表。 */
function queueRows(queueRefOrList) {
  if (queueRefOrList == null) return [];
  return Array.isArray(queueRefOrList) ? queueRefOrList : queueRefOrList.value ?? [];
}

function refreshQueueConflicts(queueRef) {
  const list = queueRows(queueRef);
  if (!list.length) return;
  for (const row of list) {
    if (row.status !== "pending" || !row.payload) continue;
    const { hasConflict, ids } = findBusyOverlap(row.payload.startTime, row.payload.endTime, events.value);
    row.conflict = hasConflict;
    row.overlapIds = ids;
  }
}

function buildIcsQueueRows(previewEvents, translate) {
  const tfn = translate;
  const list = previewEvents || [];
  return list.map((pe, idx) => {
    const key = `ics-${idx}-${pe.startTime || "x"}`;
    if (pe.status === "invalid" || !pe.startTime || !pe.endTime) {
      return {
        key,
        status: "pending",
        payload: null,
        conflict: false,
        overlapIds: [],
        title: pe.title,
        reason: pe.reason || tfn("profile.invalidTime"),
        icsStatus: "invalid",
        isRecurring: false,
        eventType: "busy",
      };
    }
    const payload = {
      title: pe.title,
      description: pe.description || null,
      location: pe.location || null,
      startTime: pe.startTime,
      endTime: pe.endTime,
      eventType: "busy",
      isRecurring: Boolean(pe.isRecurring),
      recurrenceRule: pe.recurrenceRule || null,
      recurrenceStartDate: pe.recurrenceStartDate || null,
      recurrenceEndDate: pe.recurrenceEndDate || null,
      source: "ics_import",
    };
    const { hasConflict, ids } = findBusyOverlap(payload.startTime, payload.endTime, events.value);
    return {
      key,
      status: "pending",
      payload,
      conflict: hasConflict,
      overlapIds: ids,
      title: pe.title,
      icsStatus: pe.status,
      isRecurring: Boolean(pe.isRecurring),
      location: pe.location,
      displayStart: pe.startTime,
      displayEnd: pe.endTime,
      eventType: "busy",
    };
  });
}

function buildAiQueueRows(rawEvents, defaultSource) {
  const list = rawEvents || [];
  return list.map((ev, idx) => {
    const payload = buildPayloadFromParsedEvent(ev, defaultSource);
    const { hasConflict, ids } = findBusyOverlap(payload.startTime, payload.endTime, events.value);
    return {
      key: `ai-${idx}-${payload.startTime}`,
      status: "pending",
      payload,
      conflict: hasConflict,
      overlapIds: ids,
      title: payload.title,
      isRecurring: payload.isRecurring,
      location: payload.location,
      displayStart: payload.startTime,
      displayEnd: payload.endTime,
      eventType: payload.eventType,
    };
  });
}

function maybeClearSectionAfterImport(queueRef, clearSection) {
  const list = queueRows(queueRef);
  const pendingPayload = list.filter((r) => r.status === "pending" && r.payload);
  const pendingInvalid = list.filter((r) => r.status === "pending" && !r.payload);
  if (pendingPayload.length === 0 && pendingInvalid.length === 0) clearSection?.();
}

async function saveImportRow(row, queueRef, clearSection, overwrite = false) {
  if (!row.payload || row.status !== "pending") return;
  if (row.conflict && !overwrite) return;
  loading.value = true;
  try {
    if (overwrite && row.overlapIds?.length) {
      const unique = [...new Set(row.overlapIds)];
      for (const id of unique) {
        await api(`/me/calendar-events/${id}`, { method: "DELETE" });
      }
    }
    await api("/me/calendar-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row.payload),
    });
    row.status = "saved";
    await loadEvents();
    setMessage(t("profile.msgSavedRow", { title: row.title || t("profile.entry") }));
    maybeClearSectionAfterImport(queueRef, clearSection);
  } catch (e) {
    setMessage(e.message);
  } finally {
    loading.value = false;
  }
}

function skipImportRow(row, queueRef, clearSection) {
  row.status = "skipped";
  maybeClearSectionAfterImport(queueRef, clearSection);
}

async function bulkSaveNonConflicting(queueRef, clearSection) {
  const ready = queueRows(queueRef).filter((r) => r.status === "pending" && r.payload && !r.conflict);
  if (!ready.length) {
    setMessage(t("profile.msgNoNonConflict"));
    return;
  }
  loading.value = true;
  try {
    for (const row of ready) {
      await api("/me/calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row.payload),
      });
      row.status = "saved";
    }
    await loadEvents();
    setMessage(t("profile.msgSavedNonConflict", { n: ready.length }));
    maybeClearSectionAfterImport(queueRef, clearSection);
  } catch (e) {
    setMessage(e.message);
  } finally {
    loading.value = false;
  }
}

function bulkSkipAllConflicting(queueRef, clearSection) {
  const rows = queueRows(queueRef).filter((r) => r.status === "pending" && r.payload && r.conflict);
  if (!rows.length) {
    setMessage(t("profile.msgNoConflictSkip"));
    return;
  }
  for (const row of rows) {
    row.status = "skipped";
  }
  setMessage(t("profile.msgSkippedConflict", { n: rows.length }));
  maybeClearSectionAfterImport(queueRef, clearSection);
}

async function bulkOverwriteAllConflicting(queueRef, clearSection) {
  const rows = queueRows(queueRef).filter((r) => r.status === "pending" && r.payload && r.conflict);
  if (!rows.length) {
    setMessage(t("profile.msgNoConflictOverwrite"));
    return;
  }
  loading.value = true;
  try {
    const allOverlap = new Set();
    for (const row of rows) {
      for (const id of row.overlapIds || []) allOverlap.add(id);
    }
    for (const id of allOverlap) {
      await api(`/me/calendar-events/${id}`, { method: "DELETE" });
    }
    for (const row of rows) {
      await api("/me/calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row.payload),
      });
      row.status = "saved";
    }
    await loadEvents();
    setMessage(t("profile.msgOverwritten", { n: rows.length, m: allOverlap.size }));
    maybeClearSectionAfterImport(queueRef, clearSection);
  } catch (e) {
    setMessage(e.message);
  } finally {
    loading.value = false;
  }
}

function clearIcsSection() {
  icsPreview.value = null;
  icsQueueRows.value = [];
  if (icsInputRef.value) icsInputRef.value.value = "";
  icsFile.value = null;
}

function clearAiImageSection() {
  aiImageResult.value = null;
  aiImageQueueRows.value = [];
  if (aiImageInputRef.value) aiImageInputRef.value.value = "";
  aiImageFile.value = null;
}

function clearAiTextSection() {
  aiTextResult.value = null;
  aiTextQueueRows.value = [];
  aiTextPrompt.value = "";
}

function buildEventPayload() {
  return {
    title: calendarForm.title,
    description: calendarForm.description || null,
    location: calendarForm.location || null,
    startTime: `${calendarForm.startTime}:00+08:00`,
    endTime: `${calendarForm.endTime}:00+08:00`,
    eventType: calendarForm.eventType,
    isRecurring: calendarForm.isRecurring,
    recurrenceRule: calendarForm.recurrenceRule || null,
    recurrenceStartDate: calendarForm.recurrenceStartDate || null,
    recurrenceEndDate: calendarForm.recurrenceEndDate || null,
    source: calendarForm.source,
  };
}

async function submitEvent() {
  loading.value = true;
  try {
    const payload = buildEventPayload();
    if (editingId.value) {
      await api(`/me/calendar-events/${editingId.value}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setMessage(t("profile.msgEventUpdated"));
    } else {
      await api("/me/calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setMessage(t("profile.msgEventCreated"));
    }
    await loadEvents();
    resetForm();
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

function startEdit(event) {
  editingId.value = event.id;
  calendarForm.title = event.title || "";
  calendarForm.description = event.description || "";
  calendarForm.location = event.location || "";
  calendarForm.startTime = (event.startTime || "").slice(0, 16);
  calendarForm.endTime = (event.endTime || "").slice(0, 16);
  calendarForm.eventType = event.eventType || "busy";
  calendarForm.isRecurring = Boolean(event.isRecurring);
  calendarForm.recurrenceRule = event.recurrenceRule || "";
  calendarForm.recurrenceStartDate = event.recurrenceStartDate || "";
  calendarForm.recurrenceEndDate = event.recurrenceEndDate || "";
  calendarForm.source = event.source || "manual";
}

async function removeEvent(id) {
  loading.value = true;
  try {
    await api(`/me/calendar-events/${id}`, { method: "DELETE" });
    await loadEvents();
    setMessage(t("profile.msgDeleted"));
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

function onIcsFileChange(e) {
  icsFile.value = e.target.files?.[0] || null;
  icsPreview.value = null;
  icsQueueRows.value = [];
}

function onAiImageFileChange(e) {
  aiImageFile.value = e.target.files?.[0] || null;
  aiImageResult.value = null;
  aiImageQueueRows.value = [];
}

async function previewIcs() {
  if (!icsFile.value) return setMessage(t("profile.msgPickIcs"));
  loading.value = true;
  try {
    const formData = new FormData();
    formData.append("file", icsFile.value);
    formData.append("checkOnly", "true");
    const data = await api("/me/calendar-events/import-ics", { method: "POST", body: formData });
    icsPreview.value = data;
    icsQueueRows.value = buildIcsQueueRows(data.previewEvents, t);
    setMessage(t("profile.msgIcsParsed", { n: data.previewEvents?.length ?? 0 }));
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

function nullifyScheduleField(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "null") return null;
  return s;
}

function buildPayloadFromParsedEvent(ev, defaultSource) {
  const dateOnly = (x) => {
    const n = nullifyScheduleField(x);
    if (!n) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(n) ? n : n.slice(0, 10);
  };
  return {
    title: ev.title ?? "",
    description: nullifyScheduleField(ev.description),
    location: nullifyScheduleField(ev.location),
    startTime: ev.startTime,
    endTime: ev.endTime,
    eventType: ev.eventType === "available" ? "available" : "busy",
    isRecurring: Boolean(ev.isRecurring),
    recurrenceRule: nullifyScheduleField(ev.recurrenceRule),
    recurrenceStartDate: dateOnly(ev.recurrenceStartDate),
    recurrenceEndDate: dateOnly(ev.recurrenceEndDate),
    source: ev.source || defaultSource,
  };
}

function confirmAiImageRun() {
  return window.confirm(t("profile.confirmImage"));
}

async function parseImageOnly() {
  if (!aiImageFile.value) return setMessage(t("profile.msgPickImage"));
  if (!confirmAiImageRun()) return;
  setMessage(t("profile.msgParsingImage"));
  loading.value = true;
  try {
    const formData = new FormData();
    formData.append("image", aiImageFile.value);
    formData.append("save", "false");
    formData.append("timezone", "Asia/Shanghai");
    if (aiImagePrompt.value.trim()) formData.append("prompt", aiImagePrompt.value.trim());
    const data = await api("/ai/parse-schedule-image", { method: "POST", body: formData });
    aiImageResult.value = data;
    aiImageQueueRows.value = buildAiQueueRows(data.events, "ai_screenshot");
    setMessage(t("profile.msgParsedImage", { n: data.events?.length || 0 }));
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

function confirmAiTextRun() {
  return window.confirm(t("profile.confirmText"));
}

async function parseTextOnly() {
  if (!aiTextPrompt.value.trim()) return setMessage(t("profile.msgEnterText"));
  if (!confirmAiTextRun()) return;
  setMessage(t("profile.msgParsingText"));
  loading.value = true;
  try {
    const data = await api("/ai/parse-schedule-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: aiTextPrompt.value,
        timezone: "Asia/Shanghai",
        save: false,
        includeCalendarContext: aiTextIncludeCalendar.value,
      }),
    });
    aiTextResult.value = data;
    aiTextQueueRows.value = buildAiQueueRows(data.events, "ai_conversation");
    setMessage(t("profile.msgParsedText", { n: data.events?.length || 0 }));
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    await Promise.all([loadProfile(), loadEvents()]);
  } catch (error) {
    setMessage(error.message);
  }
});

const busyEvents = computed(() =>
  events.value
    .filter((item) => item.eventType === "busy")
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
);
</script>

<template>
  <main class="page">
    <header class="top">
      <div>
        <h1>{{ t("profile.title") }}</h1>
        <p>{{ t("profile.subtitle") }}</p>
      </div>
      <div class="status">
        <LocaleSwitcher />
        <a class="link-home" href="/">{{ t("profile.backHome") }}</a>
      </div>
    </header>

    <p class="banner">{{ message || t("common.ready") }} <span v-if="loading">· {{ t("common.loading") }}</span></p>

    <section class="card">
      <h2>{{ t("profile.profileInfo") }}</h2>
      <div class="grid2">
        <div class="row"><label>{{ t("profile.displayName") }}</label><input v-model="profile.displayName" :disabled="!profileEditMode" /></div>
        <div class="row"><label>{{ t("profile.major") }}</label><input v-model="profile.major" :disabled="!profileEditMode" /></div>
        <div class="row"><label>{{ t("profile.avatarUrl") }}</label><input v-model="profile.avatarUrl" :disabled="!profileEditMode" /></div>
        <div class="row"><label>{{ t("profile.email") }}</label><input v-model="profile.email" disabled /></div>
      </div>
      <div class="actions">
        <button v-if="!profileEditMode" @click="profileEditMode = true">{{ t("profile.editProfile") }}</button>
        <button v-else @click="saveProfile">{{ t("profile.saveProfile") }}</button>
        <button v-if="profileEditMode" class="ghost" @click="profileEditMode = false">{{ t("profile.cancel") }}</button>
      </div>
    </section>

    <section class="card">
      <h2>{{ t("profile.busySection") }}</h2>
      <p v-if="!busyEvents.length">{{ t("profile.busyEmpty") }}</p>
      <ul class="list" v-else>
        <li v-for="ev in busyEvents" :key="`busy-${ev.id}`">
          <div>
            <strong>{{ ev.title || t("profile.noTitle") }}</strong>
            <p>{{ formatDateTime(ev.startTime) }} ~ {{ formatDateTime(ev.endTime) }}</p>
          </div>
          <span>{{ ev.location || "-" }}</span>
        </li>
      </ul>
    </section>

    <section class="card">
      <h2>{{ t("profile.manualSection") }}</h2>
      <div class="grid2">
        <div class="row"><label>{{ t("home.titleLabel") }}</label><input v-model="calendarForm.title" /></div>
        <div class="row"><label>{{ t("home.locationLabel") }}</label><input v-model="calendarForm.location" /></div>
        <div class="row">
          <label>{{ t("profile.start") }}</label>
          <input type="datetime-local" v-model="calendarForm.startTime" :lang="dateInputLang()" />
        </div>
        <div class="row">
          <label>{{ t("profile.end") }}</label>
          <input type="datetime-local" v-model="calendarForm.endTime" :lang="dateInputLang()" />
        </div>
        <div class="row">
          <label>{{ t("profile.typeSchedule") }}</label>
          <select v-model="calendarForm.eventType">
            <option value="busy">{{ t("profile.typeBusy") }}</option>
            <option value="available">{{ t("profile.typeAvail") }}</option>
          </select>
        </div>
        <div class="row"><label>{{ t("profile.source") }}</label><select v-model="calendarForm.source"><option value="manual">manual</option><option value="ai_screenshot">ai_screenshot</option><option value="ai_conversation">ai_conversation</option><option value="ics_import">ics_import</option></select></div>
        <div class="row"><label>{{ t("profile.recurring") }}</label><input type="checkbox" v-model="calendarForm.isRecurring" /></div>
        <div class="row"><label>{{ t("profile.rrule") }}</label><input v-model="calendarForm.recurrenceRule" /></div>
        <div class="row">
          <label>{{ t("profile.recStart") }}</label>
          <input type="date" v-model="calendarForm.recurrenceStartDate" :lang="dateInputLang()" />
        </div>
        <div class="row">
          <label>{{ t("profile.recEnd") }}</label>
          <input type="date" v-model="calendarForm.recurrenceEndDate" :lang="dateInputLang()" />
        </div>
      </div>
      <div class="row"><label>{{ t("home.description") }}</label><textarea rows="2" v-model="calendarForm.description"></textarea></div>
      <div class="actions">
        <button @click="submitEvent">{{ editingId ? t("profile.update") : t("profile.create") }}</button>
        <button class="ghost" @click="resetForm">{{ t("profile.clear") }}</button>
      </div>
      <ul class="list">
        <li v-for="ev in events" :key="ev.id">
          <div>
            <strong>{{ ev.title || t("profile.noTitleEn") }}</strong>
            <p>{{ ev.startTime }} ~ {{ ev.endTime }}</p>
            <p class="muted">{{ eventTypeLabel(ev.eventType) }}</p>
          </div>
          <div class="inline-actions"><button class="ghost" @click="startEdit(ev)">{{ t("profile.edit") }}</button><button class="danger" @click="removeEvent(ev.id)">{{ t("profile.delete") }}</button></div>
        </li>
      </ul>
    </section>

    <section class="card">
      <h2>{{ t("profile.icsSection") }}</h2>
      <p class="muted" style="margin-bottom: 8px">
        {{ t("profile.icsHelp") }}
      </p>
      <input ref="icsInputRef" type="file" accept=".ics,text/calendar" @change="onIcsFileChange" />
      <div class="actions import-bulk-actions">
        <button type="button" :disabled="!canParseIcs || loading" @click="previewIcs">{{ t("profile.parse") }}</button>
        <template v-if="icsQueueRows.length">
          <button type="button" class="ghost" :disabled="!canBulkIcs || loading" @click="bulkSaveNonConflicting(icsQueueRows, clearIcsSection)">
            {{ t("profile.saveAllNoConflict") }}
          </button>
          <button type="button" class="ghost" :disabled="!hasIcsConflictPending || loading" @click="bulkSkipAllConflicting(icsQueueRows, clearIcsSection)">
            {{ t("profile.skipAllConflict") }}
          </button>
          <button type="button" :disabled="!hasIcsConflictPending || loading" @click="bulkOverwriteAllConflicting(icsQueueRows, clearIcsSection)">
            {{ t("profile.overwriteAllConflict") }}
          </button>
        </template>
      </div>
      <div v-if="icsPreview && icsQueueRows.length" class="preview-panel">
        <h3>{{ t("profile.previewTitle") }}</h3>
        <p class="meta">
          {{ t("profile.icsMeta", { total: icsPreview.previewEvents?.length || 0, conflicts: icsPreview.conflicts, skipped: icsPreview.skipped }) }}
        </p>
        <ImportPreviewQueue
          :rows="icsQueueRows"
          @save-row="({ row, overwrite }) => saveImportRow(row, icsQueueRows, clearIcsSection, overwrite)"
          @skip-row="(row) => skipImportRow(row, icsQueueRows, clearIcsSection)"
        />
      </div>
    </section>

    <section class="card">
      <h2>{{ t("profile.aiImageSection") }}</h2>
      <p class="ai-tip">
        {{ t("profile.aiImageTip") }}
      </p>
      <input ref="aiImageInputRef" type="file" accept="image/*" @change="onAiImageFileChange" />
      <textarea rows="3" v-model="aiImagePrompt" :placeholder="t('profile.aiImagePlaceholder')"></textarea>
      <div class="actions import-bulk-actions">
        <button type="button" :disabled="loading" @click="parseImageOnly">{{ t("profile.parse") }}</button>
        <template v-if="aiImageQueueRows.length">
          <button type="button" class="ghost" :disabled="!canBulkAiImage || loading" @click="bulkSaveNonConflicting(aiImageQueueRows, clearAiImageSection)">
            {{ t("profile.saveAllNoConflict") }}
          </button>
          <button type="button" class="ghost" :disabled="!hasAiImageConflictPending || loading" @click="bulkSkipAllConflicting(aiImageQueueRows, clearAiImageSection)">
            {{ t("profile.skipAllConflict") }}
          </button>
          <button type="button" :disabled="!hasAiImageConflictPending || loading" @click="bulkOverwriteAllConflicting(aiImageQueueRows, clearAiImageSection)">
            {{ t("profile.overwriteAllConflict") }}
          </button>
        </template>
      </div>
      <div v-if="aiImageResult && aiImageQueueRows.length" class="preview-panel">
        <h3>{{ t("profile.previewTitle") }}</h3>
        <p class="meta">{{ t("profile.aiImageMeta", { n: aiImageResult.events?.length || 0 }) }}</p>
        <ImportPreviewQueue
          :rows="aiImageQueueRows"
          :notes="aiImageResult.notes || []"
          @save-row="({ row, overwrite }) => saveImportRow(row, aiImageQueueRows, clearAiImageSection, overwrite)"
          @skip-row="(row) => skipImportRow(row, aiImageQueueRows, clearAiImageSection)"
        />
      </div>
    </section>

    <section class="card">
      <h2>{{ t("profile.aiTextSection") }}</h2>
      <label class="inline-check">
        <input type="checkbox" v-model="aiTextIncludeCalendar" />
        {{ t("profile.aiTextInclude") }}
      </label>
      <textarea rows="3" v-model="aiTextPrompt" :placeholder="t('profile.aiTextPlaceholder')"></textarea>
      <div class="actions import-bulk-actions">
        <button type="button" :disabled="loading" @click="parseTextOnly">{{ t("profile.parse") }}</button>
        <template v-if="aiTextQueueRows.length">
          <button type="button" class="ghost" :disabled="!canBulkAiText || loading" @click="bulkSaveNonConflicting(aiTextQueueRows, clearAiTextSection)">
            {{ t("profile.saveAllNoConflict") }}
          </button>
          <button type="button" class="ghost" :disabled="!hasAiTextConflictPending || loading" @click="bulkSkipAllConflicting(aiTextQueueRows, clearAiTextSection)">
            {{ t("profile.skipAllConflict") }}
          </button>
          <button type="button" :disabled="!hasAiTextConflictPending || loading" @click="bulkOverwriteAllConflicting(aiTextQueueRows, clearAiTextSection)">
            {{ t("profile.overwriteAllConflict") }}
          </button>
        </template>
      </div>
      <div v-if="aiTextResult && aiTextQueueRows.length" class="preview-panel">
        <h3>{{ t("profile.previewTitle") }}</h3>
        <p class="meta">{{ t("profile.aiImageMeta", { n: aiTextResult.events?.length || 0 }) }}</p>
        <ImportPreviewQueue
          :rows="aiTextQueueRows"
          :notes="aiTextResult.notes || []"
          @save-row="({ row, overwrite }) => saveImportRow(row, aiTextQueueRows, clearAiTextSection, overwrite)"
          @skip-row="(row) => skipImportRow(row, aiTextQueueRows, clearAiTextSection)"
        />
      </div>
    </section>
  </main>
</template>
