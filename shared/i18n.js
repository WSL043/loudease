(function installWebVolumeBalancerI18n(global) {
  const api = global.chrome?.i18n;
  const supportedLocales = new Set(['en', 'zh_CN', 'zh_TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt_BR', 'ru', 'ar']);
  let catalog = null;
  let activeLocale = 'en';

  function substitute(message, substitutions) {
    const values = substitutions == null ? [] : (Array.isArray(substitutions) ? substitutions : [substitutions]);
    return values.reduce((result, value, index) => result.replaceAll(`$${index + 1}`, String(value)), String(message || ''));
  }

  async function initialize(locale = 'en') {
    activeLocale = supportedLocales.has(String(locale)) ? String(locale) : 'en';
    const url = global.chrome?.runtime?.getURL
      ? chrome.runtime.getURL(`_locales/${activeLocale}/messages.json`)
      : new URL(`../_locales/${activeLocale}/messages.json`, global.location.href).href;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      catalog = response.ok ? await response.json() : null;
    } catch (_) {
      catalog = null;
    }
    return activeLocale;
  }

  function get(key, substitutions, fallback = '') {
    const custom = catalog?.[key]?.message;
    if (custom) {
      return substitute(custom, substitutions);
    }
    const value = api?.getMessage?.(key, substitutions);
    return value || fallback || key;
  }

  function apply(root = document) {
    for (const element of root.querySelectorAll('[data-i18n]')) {
      element.textContent = get(element.dataset.i18n, undefined, element.textContent);
    }
    for (const element of root.querySelectorAll('[data-i18n-aria-label]')) {
      element.setAttribute('aria-label', get(element.dataset.i18nAriaLabel, undefined, element.getAttribute('aria-label') || ''));
    }
    for (const element of root.querySelectorAll('[data-i18n-title]')) {
      element.setAttribute('title', get(element.dataset.i18nTitle, undefined, element.getAttribute('title') || ''));
    }
    for (const element of root.querySelectorAll('[data-i18n-placeholder]')) {
      element.setAttribute('placeholder', get(element.dataset.i18nPlaceholder, undefined, element.getAttribute('placeholder') || ''));
    }
    document.documentElement.lang = activeLocale.replace('_', '-');
    document.documentElement.dir = activeLocale === 'ar' ? 'rtl' : 'ltr';
    document.title = get(document.body?.dataset.i18nTitle || 'appName', undefined, document.title);
  }

  global.WebVolumeBalancerI18n = Object.freeze({ get, apply, initialize, locale: () => activeLocale });
})(globalThis);
