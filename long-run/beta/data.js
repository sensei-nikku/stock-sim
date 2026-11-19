/* The Long Run — data.js (v3: 25 game years)
 * Client-side DISPLAY + ECONOMIC constants. The price arc, news, rumors, index and
 * seeding live server-side (Market.gs) and arrive via reveals. The tax/fed/dividend
 * model is public methodology, so it lives here and drives the engine in Game.html.
 */
var TICKERS = ['MED', 'TBK', 'NVT', 'PPK', 'SHP'];
var INSTRUMENTS = ['FUND', 'INDEX', 'MED', 'TBK', 'NVT', 'PPK', 'SHP'];  // everything buyable

var STARTING_PRICES = { MED: 120, TBK: 80, NVT: 100, PPK: 70, SHP: 40 };

var STOCKS = {
  MED: { name: 'MedCo',     sector: 'Healthcare', color: '#1D9E75' },
  TBK: { name: 'TrustBank',  sector: 'Finance',    color: '#378ADD' },
  NVT: { name: 'NovaTech',   sector: 'Technology', color: '#7F77DD' },
  PPK: { name: 'PetroPeak',  sector: 'Energy',     color: '#D85A30' },
  SHP: { name: 'ShopRight',  sector: 'Retail',     color: '#EF9F27' }
};
// Two fund products you can buy:
var FUNDS = {
  FUND:  { name: 'GrowthFund', note: 'Active blend · no dividends', color: '#C77DDD' },
  INDEX: { name: 'Index 5',    note: 'All five · pays dividends',   color: '#5FB0C9' }
};

// Index basket methodology (public): cap basket / divisor = index level (base 100).
var BASKET_SHARES = { MED: 22, TBK: 35, NVT: 22, PPK: 20, SHP: 25 };
var INDEX_DIVISOR = 100.4;
var FUND_WEIGHTS  = { NVT: 0.35, PPK: 0.35, MED: 0.30 };

// The imaginary Fed: HYS annual rate by year (shown to students each quarter).
// Server years 0-4 are the quiet market, 5-19 the long run (the original 15).
var FED_RATES = [2.5, 2.5, 2.75, 3, 3,  3, 3, 2.5, 2, 4.5, 2.5, 1, 0.25, 0.5, 1, 2, 3, 3.5, 3.5, 3];

// Game years: 1-5 practice (in the browser), 6-10 quiet market, 11-25 the long run.
var PRACTICE_YEARS = 5, QUIET_YEARS = 5, SERVER_YEARS = 20, TOTAL_YEARS = 25, LAST_SERVER_YEAR = 19;

// Dividends: TBK + SHP only. Quarterly $/share, +4%/yr, cut during the collapse.
var DIV_BASE   = { TBK: 0.60, SHP: 0.40 };
var DIV_GROWTH = 0.04;
var DIV_PAYERS = ['TBK', 'SHP'];

// Taxes (paid annually out of HYS; the $1,000/quarter paycheck is post-tax take-home).
var TAX_ORDINARY = 0.22;   // HYS interest + short-term capital gains
var TAX_PREF     = 0.15;   // qualified dividends + long-term capital gains

var PAYCHECK_Q  = 1000;    // post-tax, every quarter
var BUY_AMOUNTS = [100, 500, 1000];
