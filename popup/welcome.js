(async () => {
  const { read, applyTheme } = globalThis.WebVolumeBalancerUiPreferences;
  const { initialize, apply } = globalThis.WebVolumeBalancerI18n;
  const preferences = await read();
  applyTheme(preferences.theme);
  await initialize(preferences.locale);
  apply();
})();
