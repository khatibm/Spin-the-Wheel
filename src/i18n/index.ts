import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { ar } from './ar';

const saved = localStorage.getItem('ww_lang');
const initial = saved === 'ar' || saved === 'en' ? saved : 'en';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function applyLanguage(lang: 'en' | 'ar') {
  localStorage.setItem('ww_lang', lang);
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

applyLanguage(initial);

export default i18n;
