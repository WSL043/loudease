process.env.WVB_E2E_CHECK_SLIDER_PERSIST = '1';
process.env.WVB_E2E_EXPECT = 'reduce';
process.env.WVB_E2E_HEADLESS = '1';

require('./e2e_poc_smoke.js');
