(function installWebVolumeBalancerUiPreferences(global) {
  if (global.WebVolumeBalancerUiPreferences) {
    return;
  }

  const STORAGE_KEY = 'webVolumeBalancer.uiPreferences';
  const SUPPORTED_LOCALES = new Set(['en', 'zh_CN', 'zh_TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt_BR', 'ru', 'ar']);
  const SUPPORTED_THEMES = new Set(['system', 'light', 'dark']);
  const DEFAULTS = Object.freeze({ locale: 'en', theme: 'system' });

  function normalize(input = {}) {
    const locale = String(input.locale || DEFAULTS.locale);
    const theme = String(input.theme || DEFAULTS.theme);
    return {
      locale: SUPPORTED_LOCALES.has(locale) ? locale : DEFAULTS.locale,
      theme: SUPPORTED_THEMES.has(theme) ? theme : DEFAULTS.theme
    };
  }

  async function read() {
    if (global.chrome?.storage?.sync) {
      const data = await chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULTS });
      return normalize(data[STORAGE_KEY]);
    }
    try {
      return normalize(JSON.parse(global.localStorage?.getItem(STORAGE_KEY) || '{}'));
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  async function save(next = {}) {
    const value = normalize({ ...(await read()), ...next });
    if (global.chrome?.storage?.sync) {
      await chrome.storage.sync.set({ [STORAGE_KEY]: value });
    } else {
      global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value));
    }
    return value;
  }

  function applyTheme(theme) {
    const normalized = normalize({ theme }).theme;
    document.documentElement.dataset.theme = normalized;
    document.documentElement.style.colorScheme = normalized === 'system' ? 'light dark' : normalized;
  }

  global.WebVolumeBalancerUiPreferences = Object.freeze({ STORAGE_KEY, DEFAULTS, normalize, read, save, applyTheme });
})(globalThis);
