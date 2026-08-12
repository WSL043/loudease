process.env.WVB_E2E_CHECK_SLIDER_PERSIST = '1';
process.env.WVB_E2E_PAGE = 'quiet-dialog.html';
process.env.WVB_E2E_EXPECT = 'lift';
// Keep a long settled window so this persistence check is not coupled to the
// short-form confidence-ramp duration.
process.env.WVB_E2E_MIN_SIGNAL_TICKS = '260';
process.env.WVB_E2E_HEADLESS = '1';
process.env.WVB_E2E_SILENT_SINK = '1';

require('./e2e_poc_smoke.js');
