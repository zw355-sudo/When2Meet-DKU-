import { ref } from "vue";
import { messages } from "./messages.js";

const STORAGE_KEY = "w2m-locale";

function applyDocumentLocale(lang) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
}

export const locale = ref(
  localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh"
);
applyDocumentLocale(locale.value);

export function setLocale(lang) {
  if (lang !== "zh" && lang !== "en") return;
  locale.value = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  applyDocumentLocale(lang);
}

function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] != null ? String(params[name]) : ""
  );
}

function lookup(path) {
  const keys = path.split(".");
  let cur = messages[locale.value];
  for (const k of keys) {
    cur = cur?.[k];
  }
  return cur;
}

function localeBcp47() {
  return locale.value === "en" ? "en-US" : "zh-CN";
}

/** Formats a date for display; follows app language (unlike native date picker popups). */
export function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(localeBcp47(), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function useI18n() {
  function t(path, params) {
    const raw = lookup(path);
    if (typeof raw !== "string") return path;
    return interpolate(raw, params);
  }

  function eventTypeLabel(type) {
    return type === "available" ? t("calendar.available") : t("calendar.busy");
  }

  /** For native `<input type="date|datetime-local">` `lang` (picker language follows OS/browser). */
  function dateInputLang() {
    return locale.value === "en" ? "en" : "zh-CN";
  }

  return { locale, setLocale, t, eventTypeLabel, formatDateTime, dateInputLang };
}
