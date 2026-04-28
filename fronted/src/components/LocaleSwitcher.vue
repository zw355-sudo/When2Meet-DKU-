<script setup>
import { useI18n } from "../i18n";

const { locale, setLocale, t } = useI18n();
</script>

<template>
  <div class="locale-switch" role="group" :aria-label="`${t('common.langZh')} / ${t('common.langEn')}`">
    <button
      type="button"
      class="locale-btn"
      :class="{ 'locale-btn-active': locale === 'zh' }"
      @click="setLocale('zh')"
    >
      {{ t("common.langZh") }}
    </button>
    <button
      type="button"
      class="locale-btn"
      :class="{ 'locale-btn-active': locale === 'en' }"
      @click="setLocale('en')"
    >
      {{ t("common.langEn") }}
    </button>
  </div>
</template>
