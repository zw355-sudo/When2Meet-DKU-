<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { api, getToken } from "../lib/api";
import { useI18n } from "../i18n";
import LocaleSwitcher from "../components/LocaleSwitcher.vue";

const { t, formatDateTime, dateInputLang } = useI18n();
const route = useRoute();
const slug = computed(() => String(route.params.slug || ""));
const loading = ref(false);
const message = ref("");

const eventInfo = ref(null);
const participants = ref([]);
const slots = ref([]);
const participantsCount = computed(() => participants.value.length);

const range = reactive({
  from: "",
  to: "",
  durationMinutes: 60,
});

const hasToken = computed(() => Boolean(getToken()));
const shareUrl = computed(() => `${window.location.origin}/event/${slug.value}`);
const canAnalyze = computed(() => Boolean(eventInfo.value?.availableStart && eventInfo.value?.availableEnd));

function setMessage(text) {
  message.value = text;
}

async function fetchEvent() {
  loading.value = true;
  try {
    eventInfo.value = await api(`/events/${slug.value}`);
    range.from = eventInfo.value.availableStart ? eventInfo.value.availableStart.slice(0, 16) : "";
    range.to = eventInfo.value.availableEnd ? eventInfo.value.availableEnd.slice(0, 16) : "";
    setMessage(t("event.msgLoaded"));
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

async function joinEvent() {
  loading.value = true;
  try {
    await api(`/events/${slug.value}/join`, { method: "POST" });
    setMessage(t("event.msgJoined"));
    await fetchParticipants();
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

async function importMySchedule() {
  loading.value = true;
  try {
    await api(`/events/${slug.value}/import-my-calendar`, { method: "POST" });
    setMessage(t("event.msgImported"));
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

async function fetchParticipants() {
  loading.value = true;
  try {
    participants.value = await api(`/events/${slug.value}/participants`);
    setMessage(t("event.msgParticipantCount", { n: participants.value.length }));
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

async function analyzeAvailability() {
  if (!range.from || !range.to) return setMessage(t("event.msgMissingRange"));
  loading.value = true;
  try {
    const from = `${range.from}:00+08:00`;
    const to = `${range.to}:00+08:00`;
    const q =
      `from=${encodeURIComponent(from)}` +
      `&to=${encodeURIComponent(to)}` +
      `&durationMinutes=${range.durationMinutes}`;
    const data = await api(`/events/${slug.value}/common-availability?${q}`);
    slots.value = data.slots || [];
    setMessage(t("event.msgAnalyzeDone", { n: slots.value.length }));
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    setMessage(t("event.msgCopyOk"));
  } catch (_e) {
    setMessage(t("event.msgCopyFail"));
  }
}

onMounted(async () => {
  await fetchEvent();
  if (hasToken.value) await fetchParticipants();
});
</script>

<template>
  <main class="page">
    <header class="top">
      <div>
        <h1>{{ t("event.title", { slug }) }}</h1>
        <p>{{ t("event.subtitle") }}</p>
      </div>
      <div class="status">
        <LocaleSwitcher />
        <a class="link-home" href="/profile">{{ t("event.myProfile") }}</a>
        <a class="link-home" href="/">{{ t("event.backHome") }}</a>
      </div>
    </header>

    <p class="banner">{{ message || t("common.ready") }} <span v-if="loading">· {{ t("common.loading") }}</span></p>

    <section class="card">
      <h2>{{ t("event.shareSection") }}</h2>
      <div class="row">
        <label>{{ t("event.shareUrl") }}</label>
        <input :value="shareUrl" readonly />
      </div>
      <button type="button" @click="copyShareLink">{{ t("event.copyLink") }}</button>
    </section>

    <section class="card" v-if="eventInfo">
      <h2>{{ t("event.infoSection") }}</h2>
      <div class="grid2">
        <div class="row"><label>{{ t("event.labelTitle") }}</label><input :value="eventInfo.title || '-'" readonly /></div>
        <div class="row"><label>{{ t("event.labelLocation") }}</label><input :value="eventInfo.location || '-'" readonly /></div>
        <div class="row"><label>{{ t("event.labelStatus") }}</label><input :value="eventInfo.status || '-'" readonly /></div>
        <div class="row"><label>{{ t("event.availStart") }}</label><input :value="eventInfo.availableStart ? formatDateTime(eventInfo.availableStart) : '-'" readonly /></div>
        <div class="row"><label>{{ t("event.availEnd") }}</label><input :value="eventInfo.availableEnd ? formatDateTime(eventInfo.availableEnd) : '-'" readonly /></div>
      </div>
      <div class="row">
        <label>{{ t("event.labelDesc") }}</label>
        <textarea :value="eventInfo.description || '-'" rows="2" readonly />
      </div>
    </section>

    <section class="card">
      <h2>{{ t("event.participantsSection") }}</h2>
      <p v-if="!hasToken">{{ t("event.notLoggedIn") }}</p>
      <div class="actions" v-else>
        <button type="button" @click="joinEvent" :disabled="loading">{{ t("event.join") }}</button>
        <button type="button" @click="importMySchedule" :disabled="loading">{{ t("event.importSchedule") }}</button>
        <button type="button" class="ghost" @click="fetchParticipants" :disabled="loading">{{ t("event.refreshParticipants") }}</button>
      </div>
      <p>{{ t("event.participantCount", { n: participantsCount }) }}</p>
      <ul class="list" v-if="participants.length">
        <li v-for="p in participants" :key="p.id">
          <div>
            <strong>{{ p.displayName || p.username || `User ${p.id}` }}</strong>
            <p>{{ t("event.major") }}: {{ p.major || "-" }}</p>
          </div>
          <span>#{{ p.id }}</span>
        </li>
      </ul>
    </section>

    <section class="card">
      <h2>{{ t("event.analyzeSection") }}</h2>
      <div class="grid2">
        <div class="row">
          <label>{{ t("event.fromFixed") }}</label>
          <input type="datetime-local" v-model="range.from" disabled :lang="dateInputLang()" />
        </div>
        <div class="row">
          <label>{{ t("event.toFixed") }}</label>
          <input type="datetime-local" v-model="range.to" disabled :lang="dateInputLang()" />
        </div>
        <div class="row"><label>{{ t("event.durationMin") }}</label><input type="number" v-model.number="range.durationMinutes" /></div>
      </div>
      <button type="button" @click="analyzeAvailability" :disabled="loading || !canAnalyze">
        {{ t("event.analyzeBtn") }}
      </button>
      <p v-if="!canAnalyze">{{ t("event.needFromTo") }}</p>
      <p v-else-if="slots.length === 0">{{ t("event.noSlots") }}</p>
      <ul class="list" v-if="slots.length">
        <li v-for="(slot, idx) in slots" :key="`${slot.startTime}-${slot.endTime}-${idx}`">
          <div>
            <strong>{{ t("event.slotTitle", { n: idx + 1 }) }}</strong>
            <p>{{ formatDateTime(slot.startTime) }} ~ {{ formatDateTime(slot.endTime) }}</p>
          </div>
          <span>{{ slot.durationMinutes }} {{ t("event.min") }}</span>
        </li>
      </ul>
    </section>
  </main>
</template>
