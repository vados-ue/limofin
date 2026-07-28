// LimoFin — Scriptable widget (iOS)
// Shows today's safe-to-spend from the LimoFin companion API on a home-screen
// or lock-screen widget. Free alternative to an Apple Wallet pass.
//
// Setup:
//   1. Install "Scriptable" from the App Store (free).
//   2. New script → paste this file → name it "LimoFin".
//   3. Add a Scriptable widget to your home screen (small or medium) or lock
//      screen (rectangular/circular), pick script "LimoFin".
// The widget fetches over home Wi-Fi and keeps the last payload cached in the
// Scriptable keychain, so off-LAN it shows the last known numbers with an
// "as of" stamp instead of an error.

const BASE_URL = 'http://10.117.1.82:3002';
const CACHE_KEY = 'limofin.widget.today';

const COLORS = {
  bg: new Color('#0f1115'),
  text: new Color('#f3f4f6'),
  muted: new Color('#9ca3af'),
  green: new Color('#22c55e'),
  yellow: new Color('#eab308'),
  red: new Color('#ef4444'),
  barBg: new Color('#2a3140')
};

function money(cents) {
  if (cents === null || cents === undefined) return '–';
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return dollars % 1 === 0 ? `$${dollars.toFixed(0)}` : `$${dollars.toFixed(2)}`;
}

async function loadToday() {
  try {
    const request = new Request(`${BASE_URL}/api/today`);
    request.timeoutInterval = 6;
    const data = await request.loadJSON();
    Keychain.set(CACHE_KEY, JSON.stringify({ data, at: new Date().toISOString() }));
    return { data, stale: false, at: new Date().toISOString() };
  } catch (error) {
    if (Keychain.contains(CACHE_KEY)) {
      const cached = JSON.parse(Keychain.get(CACHE_KEY));
      return { data: cached.data, stale: true, at: cached.at };
    }
    return { data: null, stale: true, at: null };
  }
}

function heroColor(data) {
  if (data.no_plan) return COLORS.muted;
  if (data.totals.remaining_cents < 0) return COLORS.red;
  const ratio = data.totals.allocated_cents > 0 ? data.totals.spent_cents / data.totals.allocated_cents : 0;
  return ratio > 0.85 && data.days_left > 1 ? COLORS.yellow : COLORS.green;
}

function addBar(widget, envelope, width) {
  const ratio = envelope.allocated_cents > 0
    ? Math.min(1, envelope.spent_cents / envelope.allocated_cents)
    : 0;
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const label = row.addText(envelope.name);
  label.font = Font.mediumSystemFont(10);
  label.textColor = COLORS.muted;
  label.lineLimit = 1;
  row.addSpacer();
  const left = row.addText(`${money(envelope.remaining_cents)}`);
  left.font = Font.boldSystemFont(10);
  left.textColor = envelope.remaining_cents < 0 ? COLORS.red : COLORS.text;

  widget.addSpacer(2);
  const barCtx = new DrawContext();
  barCtx.size = new Size(width, 5);
  barCtx.opaque = false;
  barCtx.setFillColor(COLORS.barBg);
  barCtx.fillRect(new Rect(0, 0, width, 5));
  barCtx.setFillColor(envelope.remaining_cents < 0 ? COLORS.red : envelope.pace === 'hot' ? COLORS.yellow : COLORS.green);
  barCtx.fillRect(new Rect(0, 0, Math.round(width * ratio), 5));
  const barImg = widget.addImage(barCtx.getImage());
  barImg.cornerRadius = 2.5;
  widget.addSpacer(5);
}

async function buildWidget() {
  const { data, stale, at } = await loadToday();
  const family = config.widgetFamily || 'medium';

  // Lock screen (accessory) families get minimal text-only layouts.
  if (family === 'accessoryCircular' || family === 'accessoryRectangular' || family === 'accessoryInline') {
    const widget = new ListWidget();
    if (!data) {
      widget.addText('LimoFin ?');
      return widget;
    }
    if (family === 'accessoryCircular') {
      const big = widget.addText(data.no_plan ? '—' : money(data.safe_today_cents));
      big.font = Font.boldSystemFont(14);
      big.minimumScaleFactor = 0.5;
      const cap = widget.addText('today');
      cap.font = Font.systemFont(9);
    } else {
      const line1 = widget.addText(data.no_plan ? 'LimoFin: no plan' : `Safe today ${money(data.safe_today_cents)}`);
      line1.font = Font.boldSystemFont(13);
      if (family === 'accessoryRectangular' && !data.no_plan) {
        const line2 = widget.addText(`wk left ${money(Math.max(0, data.totals.remaining_cents))} · d${data.day_index + 1}/7${stale ? ' · stale' : ''}`);
        line2.font = Font.systemFont(11);
      }
    }
    return widget;
  }

  const widget = new ListWidget();
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(14, 14, 12, 14);

  if (!data) {
    const title = widget.addText('LimoFin');
    title.font = Font.boldSystemFont(13);
    title.textColor = COLORS.text;
    widget.addSpacer(4);
    const msg = widget.addText('Not reachable yet — open the app once on home Wi-Fi.');
    msg.font = Font.systemFont(11);
    msg.textColor = COLORS.muted;
    return widget;
  }

  const head = widget.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const brand = head.addText('LimoFin');
  brand.font = Font.boldSystemFont(11);
  brand.textColor = COLORS.muted;
  head.addSpacer();
  if (!data.no_plan) {
    const day = head.addText(`day ${data.day_index + 1}/7${stale ? ' · stale' : ''}`);
    day.font = Font.systemFont(10);
    day.textColor = stale ? COLORS.yellow : COLORS.muted;
  }

  widget.addSpacer(6);

  if (data.no_plan) {
    const big = widget.addText('No week plan');
    big.font = Font.boldSystemFont(18);
    big.textColor = COLORS.text;
    widget.addSpacer(2);
    const sub = widget.addText('Push this week via /finance');
    sub.font = Font.systemFont(11);
    sub.textColor = COLORS.muted;
  } else {
    const big = widget.addText(money(data.safe_today_cents));
    big.font = Font.boldSystemFont(family === 'small' ? 30 : 34);
    big.textColor = heroColor(data);
    big.minimumScaleFactor = 0.6;
    const sub = widget.addText(`safe today · ${money(Math.max(0, data.totals.remaining_cents))} left this wk`);
    sub.font = Font.systemFont(10);
    sub.textColor = COLORS.muted;

    if (family !== 'small') {
      widget.addSpacer(8);
      const barWidth = 286;
      for (const envelope of data.envelopes.slice(0, 3)) {
        addBar(widget, envelope, barWidth);
      }
    }
  }

  widget.addSpacer();
  widget.url = `${BASE_URL}/m/`;
  widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  return widget;
}

const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
