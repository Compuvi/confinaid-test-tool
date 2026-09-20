/**
 * i18next configuration — resources are bundled at build time so there are no
 * HTTP fetches inside the Tauri custom-protocol environment.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import tr from "@/locales/tr.json";
import de from "@/locales/de.json";
import fr from "@/locales/fr.json";
import es from "@/locales/es.json";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: LanguageCode = "en";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tr: { translation: tr },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    // React already escapes output — no need for i18next to escape too.
    escapeValue: false,
  },
});

export default i18n;
