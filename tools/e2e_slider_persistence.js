process.env.WVB_E2E_CHECK_SLIDER_PERSIST = '1';
process.env.WVB_E2E_PAGE = 'quiet-dialog.html';
process.env.WVB_E2E_EXPECT = 'lift';
// The stable programme policy deliberately needs about four seconds of
// continuous evidence before applying its full upward correction.
process.env.WVB_E2E_MIN_SIGNAL_TICKS = '260';
process.env.WVB_E2E_HEADLESS = '1';
process.env.WVB_E2E_SILENT_SINK = '1';

require('./e2e_poc_smoke.js');
