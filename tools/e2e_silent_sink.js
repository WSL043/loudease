process.env.WVB_E2E_SILENT_SINK = '1';
process.env.WVB_E2E_HEADLESS = '1';
process.env.WVB_E2E_PAGE = 'quiet-dialog.html';
process.env.WVB_E2E_EXPECT = 'lift';
process.env.WVB_E2E_MIN_SIGNAL_TICKS = '40';
process.env.WVB_E2E_REQUIRE_POPUP_AUTOCAPTURE = '1';

require('./e2e_poc_smoke.js');
