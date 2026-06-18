const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3300;

const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

// 価格・出来高チャートデータ
app.get('/api/chart', async (req, res) => {
  const { symbol, range = '2y', interval = '1d' } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&events=div,splits`;
    const r = await fetch(url, { headers: YF_HEADERS });
    if (!r.ok) return res.status(r.status).json({ error: `Yahoo Finance HTTP ${r.status}` });
    const json = await r.json();

    const result = json?.chart?.result?.[0];
    if (!result) {
      const errDesc = json?.chart?.error?.description || '指定されたシンボルのデータが見つかりません';
      return res.status(404).json({ error: errDesc });
    }

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const volumes = quote.volume || [];

    // null（休場・データ欠損）を除去
    const out = { timestamps: [], opens: [], closes: [], highs: [], lows: [], volumes: [] };
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      out.timestamps.push(timestamps[i] * 1000);
      out.opens.push(opens[i] ?? closes[i]);
      out.closes.push(closes[i]);
      out.highs.push(highs[i] ?? closes[i]);
      out.lows.push(lows[i] ?? closes[i]);
      out.volumes.push(volumes[i] ?? null);
    }

    res.json({
      symbol: result.meta.symbol,
      currency: result.meta.currency,
      exchangeName: result.meta.exchangeName,
      instrumentType: result.meta.instrumentType,
      regularMarketPrice: result.meta.regularMarketPrice,
      ...out,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 日本語ニックネーム → シンボルのマッピング（Yahoo Finance に登録のない俗称に対応）
const NICKNAME_ALIASES = {
  'オルカン':       { symbol: 'ACWI',    name: 'オルカン / 全世界株式(オール・カントリー)', type: 'ETF',  exchange: 'NASDAQ' },
  'オールカントリー': { symbol: 'ACWI',   name: 'オルカン / 全世界株式(オール・カントリー)', type: 'ETF',  exchange: 'NASDAQ' },
  'レバナス':       { symbol: '2869.T',  name: 'iFreeレバレッジ NASDAQ100 ETF',            type: 'ETF',  exchange: '東証' },
  'ナスダック':     { symbol: '^IXIC',   name: 'NASDAQ総合指数',                            type: '指数', exchange: '' },
  'ゴールド':       { symbol: 'GC=F',    name: 'ゴールド先物',                              type: '商品', exchange: 'COMEX' },
  '日経':           { symbol: '^N225',   name: '日経平均株価',                              type: '指数', exchange: '' },
  '原油':           { symbol: 'CL=F',    name: '原油先物(WTI)',                             type: '商品', exchange: 'NYMEX' },
  'ドル円':         { symbol: 'JPY=X',   name: 'ドル/円',                                  type: '為替', exchange: '' },
  'ビットコイン':   { symbol: 'BTC-JPY', name: 'ビットコイン / BTC/JPY',                   type: '暗号資産', exchange: '' },
};

// 銘柄検索
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });

  try {
    // ニックネームマッピング確認（クエリがキーを含む、またはキーがクエリを含む）
    const aliasHits = Object.entries(NICKNAME_ALIASES)
      .filter(([key]) => q.includes(key) || key.includes(q))
      .map(([, v]) => v);

    const yfSearch = async (query) => {
      const url = `https://query1.finance.yahoo.com/v6/finance/autocomplete?region=JP&lang=ja-JP&query=${encodeURIComponent(query)}`;
      const r = await fetch(url, { headers: YF_HEADERS });
      if (!r.ok) return [];
      const json = await r.json();
      return (json.ResultSet?.Result || [])
        .filter(item => item.symbol)
        .map(item => ({
          symbol: item.symbol,
          name: item.name || item.symbol,
          type: item.typeDisp || null,
          exchange: item.exchDisp || null,
        }));
    };

    let apiQuotes = await yfSearch(q);

    // 日本語マルチ文字クエリが空の場合は先頭1文字でフォールバック
    // 例: "任天堂" → [] → "任" → [任天堂, ...]
    const hasJP = /[぀-鿿]/.test(q);
    if (apiQuotes.length === 0 && hasJP && q.length > 1) {
      apiQuotes = await yfSearch(q[0]);
    }

    // ニックネーム結果を先頭に、重複シンボルを除外してマージ
    const seen = new Set(aliasHits.map(r => r.symbol));
    const quotes = [
      ...aliasHits,
      ...apiQuotes.filter(r => !seen.has(r.symbol)),
    ].slice(0, 10);

    res.json({ quotes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// crumb/cookie キャッシュ（クォートサマリーAPI用の認証）
let crumbCache = null;

async function getCrumb() {
  if (crumbCache && Date.now() - crumbCache.ts < 1000 * 60 * 30) return crumbCache;

  const r1 = await fetch('https://fc.yahoo.com', { headers: YF_HEADERS, redirect: 'manual' });
  const setCookie = r1.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];

  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...YF_HEADERS, Cookie: cookie },
  });
  const crumb = await r2.text();

  crumbCache = { cookie, crumb, ts: Date.now() };
  return crumbCache;
}

// PER・PBR・配当・決算情報
app.get('/api/fundamentals', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });

  const modules = 'summaryDetail,defaultKeyStatistics,earnings,calendarEvents';

  try {
    let { cookie, crumb } = await getCrumb();
    let url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
    let r = await fetch(url, { headers: { ...YF_HEADERS, Cookie: cookie } });

    if (r.status === 401) {
      crumbCache = null;
      ({ cookie, crumb } = await getCrumb());
      url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
      r = await fetch(url, { headers: { ...YF_HEADERS, Cookie: cookie } });
    }

    const json = await r.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return res.json({ available: false });

    const sd = result.summaryDetail || {};
    const ks = result.defaultKeyStatistics || {};
    const quarterly = result.earnings?.earningsChart?.quarterly || [];
    const earningsDate = result.calendarEvents?.earnings?.earningsDate?.[0]?.fmt || null;
    const exDividendDate = result.calendarEvents?.exDividendDate?.fmt || null;

    const trailingPE = sd.trailingPE?.raw ?? null;

    res.json({
      available: trailingPE != null,
      trailingPE,
      forwardPE: ks.forwardPE?.raw ?? null,
      priceToBook: ks.priceToBook?.raw ?? null,
      dividendYield: sd.dividendYield?.raw ?? null,
      marketCap: sd.marketCap?.raw ?? null,
      trailingEps: ks.trailingEps?.raw ?? null,
      nextEarningsDate: earningsDate,
      exDividendDate,
      quarterlyEarnings: quarterly.map(q => ({
        period: q.date,
        actual: q.actual?.raw ?? null,
        estimate: q.estimate?.raw ?? null,
        surprisePct: q.surprisePct ?? null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// リアルタイム気配（最新価格・最良気配/数量・板情報）
app.get('/api/quote', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });

  const buildUrl = (crumb) =>
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&crumb=${encodeURIComponent(crumb)}`;

  try {
    let { cookie, crumb } = await getCrumb();
    let r = await fetch(buildUrl(crumb), { headers: { ...YF_HEADERS, Cookie: cookie } });
    if (r.status === 401) {
      crumbCache = null;
      ({ cookie, crumb } = await getCrumb());
      r = await fetch(buildUrl(crumb), { headers: { ...YF_HEADERS, Cookie: cookie } });
    }

    let q = null;
    if (r.ok) {
      const json = await r.json();
      q = json?.quoteResponse?.result?.[0] || null;
    }

    // v7 quote が使えない場合は chart メタから価格だけ取得（板情報なし）
    if (!q) {
      const cr = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`,
        { headers: YF_HEADERS }
      );
      const cj = await cr.json();
      const meta = cj?.chart?.result?.[0]?.meta;
      if (!meta) return res.json({ available: false });
      return res.json({
        available: true,
        source: 'chart',
        price: meta.regularMarketPrice ?? null,
        previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
        time: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
        marketState: null,
        currency: meta.currency ?? null,
        bid: null, ask: null, bidSize: null, askSize: null,
      });
    }

    const prev = q.regularMarketPreviousClose ?? null;
    res.json({
      available: true,
      source: 'quote',
      price: q.regularMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changePct: q.regularMarketChangePercent ?? null,
      previousClose: prev,
      time: q.regularMarketTime ? q.regularMarketTime * 1000 : null,
      marketState: q.marketState || null,
      currency: q.currency || null,
      bid: q.bid ?? null,
      ask: q.ask ?? null,
      bidSize: q.bidSize ?? null,
      askSize: q.askSize ?? null,
      volume: q.regularMarketVolume ?? null,
      dayHigh: q.regularMarketDayHigh ?? null,
      dayLow: q.regularMarketDayLow ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`株式分析ツール起動: http://localhost:${PORT}`);
  });
}

module.exports = app;
