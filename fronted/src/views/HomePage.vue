<script setup>
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { api, clearAuth, getToken, setAuth } from "../lib/api";
import { useI18n } from "../i18n";
import LocaleSwitcher from "../components/LocaleSwitcher.vue";

const router = useRouter();
const { t, dateInputLang } = useI18n();
const loading = ref(false);
const message = ref("");

const token = ref(getToken());
const authed = computed(() => Boolean(token.value));

const authForm = reactive({
  mode: "login",
  username: "",
  email: "",
  password: "",
});

const createForm = reactive({
  title: "",
  description: "",
  location: "",
  availableStart: "",
  availableEnd: "",
});

function setMessage(text) {
  message.value = text;
}

function onLogout() {
  clearAuth();
  token.value = "";
  setMessage(t("home.msgLogout"));
}

async function submitAuth() {
  loading.value = true;
  try {
    const path = authForm.mode === "login" ? "/auth/login" : "/auth/register";
    const payload =
      authForm.mode === "login"
        ? { email: authForm.email, password: authForm.password }
        : {
            username: authForm.username,
            email: authForm.email,
            password: authForm.password,
          };
    const data = await api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setAuth(data.token, data.userId);
    token.value = data.token;
    setMessage(t("home.msgLoginOk"));
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

async function createEvent() {
  loading.value = true;
  try {
    const data = await api("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: createForm.title,
        description: createForm.description || null,
        location: createForm.location || null,
        availableStart: `${createForm.availableStart}:00+08:00`,
        availableEnd: `${createForm.availableEnd}:00+08:00`,
      }),
    });
    setMessage(t("home.msgEventCreated", { slug: data.slug }));
    router.push(`/event/${data.slug}`);
  } catch (error) {
    setMessage(error.message);
  } finally {
    loading.value = false;
  }
}

function openBySlug(slug) {
  if (!slug.trim()) return;
  router.push(`/event/${slug.trim()}`);
}
</script>

<template>
  <main class="page">
    <header class="top">
      <div>
        <h1>{{ t("home.title") }}</h1>
        <p>{{ t("home.subtitle") }}</p>
      </div>
      <div class="status">
        <LocaleSwitcher />
        <template v-if="authed">
          <a class="link-home" href="/profile">{{ t("home.openProfile") }}</a>
          <span>{{ t("home.loggedIn") }}</span>
          <button type="button" @click="onLogout">{{ t("home.logout") }}</button>
        </template>
      </div>
    </header>

    <p class="banner">{{ message || t("common.ready") }} <span v-if="loading">· {{ t("common.loading") }}</span></p>

    <section v-if="!authed" class="card">
      <h2>{{ t("home.loginRegister") }}</h2>
      <div class="row">
        <label>{{ t("home.mode") }}</label>
        <select v-model="authForm.mode">
          <option value="login">{{ t("home.login") }}</option>
          <option value="register">{{ t("home.register") }}</option>
        </select>
      </div>
      <div class="row" v-if="authForm.mode === 'register'">
        <label>{{ t("home.username") }}</label>
        <input v-model="authForm.username" />
      </div>
      <div class="row"><label>{{ t("home.email") }}</label><input v-model="authForm.email" /></div>
      <div class="row"><label>{{ t("home.password") }}</label><input type="password" v-model="authForm.password" /></div>
      <button type="button" @click="submitAuth">{{ t("home.submit") }}</button>
    </section>

    <template v-else>
      <section class="card">
        <h2>{{ t("home.newTeamEvent") }}</h2>
        <div class="grid2">
          <div class="row"><label>{{ t("home.titleLabel") }}</label><input v-model="createForm.title" /></div>
          <div class="row"><label>{{ t("home.locationLabel") }}</label><input v-model="createForm.location" /></div>
          <div class="row">
            <label>{{ t("home.availStart") }}</label>
            <input type="datetime-local" v-model="createForm.availableStart" :lang="dateInputLang()" />
          </div>
          <div class="row">
            <label>{{ t("home.availEnd") }}</label>
            <input type="datetime-local" v-model="createForm.availableEnd" :lang="dateInputLang()" />
          </div>
          <div class="row"><label>{{ t("home.description") }}</label><input v-model="createForm.description" /></div>
        </div>
        <button type="button" @click="createEvent">{{ t("home.createOpenEvent") }}</button>
      </section>

      <section class="card">
        <h2>{{ t("home.profileCardTitle") }}</h2>
        <p>{{ t("home.profileCardDesc") }}</p>
        <a class="link-home" href="/profile">{{ t("home.openProfileLink") }}</a>
      </section>

      <section class="card">
        <h2>{{ t("home.slugCardTitle") }}</h2>
        <div class="row">
          <label>{{ t("home.slugLabel") }}</label>
          <input :placeholder="t('home.slugPlaceholder')" @keydown.enter="openBySlug($event.target.value)" />
        </div>
      </section>
    </template>
  </main>
</template>
