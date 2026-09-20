const METRIC_DEFS = [
  ["rpm",          "Engine RPM",   "rpm", "#f97316"],
  ["speed",        "Speed",        "mph", "#38bdf8"],
  ["throttle",     "Throttle",     "%",   "#fb923c"],
  ["coolant",      "Coolant Temp", "°F",  "#f87171"],
  ["maf",          "MAF",          "g/s", "#a78bfa"],
  ["power",        "Power",        "hp",  "#4ade80"],
  ["boost",        "Boost",        "bar", "#facc15"],
  ["intake_temp",  "Intake Temp",  "°F",  "#fb7185"],
  ["timing",       "Timing",       "°",   "#22d3ee"],
  ["accel",        "Accel",        "g",   "#e879f9"],
  ["oil_temp",     "Oil Temp",     "°F",  "#fbbf24"],
  ["oil_pressure", "Oil Pressure", "bar", "#86efac"],
  ["voltage",      "Voltage",      "V",   "#94a3b8"],
  ["torque",       "Torque",       "Nm",  "#c084fc"],
  ["lambda",       "Lambda (AFR)", "λ",   "#2dd4bf"],
  ["gear",         "Gear",         "",    "#fde047"],
  ["map_slot",     "Map Slot",     "",    "#fca5a5"],
];

let TIMELINE = [], ALL = {}, META = {};

const slider   = document.getElementById("slider");
const progress = document.getElementById("slider-progress");
const timeEl   = document.getElementById("current-time");
const lblStart = document.getElementById("lbl-start");
const lblEnd   = document.getElementById("lbl-end");

function fmt(val, key) {
  if (val === null || val === undefined) return "—";
  if (key === "rpm") return Math.round(val).toLocaleString();
  if (Math.abs(val) >= 100) return Math.round(val).toLocaleString();
  return (+val.toFixed(1)).toString();
}

function pct(val, min, max) {
  if (val === null || max === min) return 0;
  return Math.max(0, Math.min(100, (val - min) / (max - min) * 100));
}

function update(i) {
  timeEl.textContent = TIMELINE[i] || "—";
  progress.style.width = (i / Math.max(1, TIMELINE.length - 1) * 100) + "%";
  for (const [key] of METRIC_DEFS) {
    const vEl = document.getElementById("v-" + key);
    const bEl = document.getElementById("b-" + key);
    if (!vEl) continue;
    const val = ALL[key] ? ALL[key][i] : null;
    vEl.textContent = fmt(val, key);
    if (bEl && META[key]) bEl.style.width = pct(val, META[key].min, META[key].max) + "%";
  }
}

function applyLog(log) {
  TIMELINE = log.timeline;
  ALL      = log.all;
  META     = log.meta;
  const N  = TIMELINE.length - 1;
  slider.max   = N;
  slider.value = 0;
  graphSliderIdx = 0;
  lblStart.textContent = TIMELINE[0];
  lblEnd.textContent   = TIMELINE[N];

  for (const [k] of METRIC_DEFS) {
    const minEl = document.getElementById("bmin-" + k);
    const maxEl = document.getElementById("bmax-" + k);
    const card  = document.getElementById("card-" + k);
    const has   = !!ALL[k];
    if (minEl) minEl.textContent = has ? fmt(META[k].min, k) : "";
    if (maxEl) maxEl.textContent = has ? fmt(META[k].max, k) : "";
    if (card)  card.classList.toggle("no-data", !has);
  }
  const rMin = document.getElementById("bmin-rpm");
  const rMax = document.getElementById("bmax-rpm");
  if (rMin) rMin.textContent = ALL.rpm ? fmt(META.rpm.min, "rpm") : "";
  if (rMax) rMax.textContent = ALL.rpm ? fmt(META.rpm.max, "rpm") : "";

  update(0);
  requestAnimationFrame(renderCharts);
}

async function loadLog(name) {
  stop();
  const log = await fetch(`/api/logs/${encodeURIComponent(name)}`).then(r => r.json());
  applyLog(log);
}

document.getElementById("log-select").addEventListener("change", e => loadLog(e.target.value));
slider.addEventListener("input", () => {
  const i = +slider.value;
  update(i);
  graphSliderIdx = i;
  for (const c of Object.values(chartInstances)) c.update("none");
});

// ── playback ──
const btnPlay   = document.getElementById("btn-play");
const speedBtns = document.querySelectorAll(".btn-speed");
let playing = false, speed = 1, timer = null;

function interval() { return Math.round(1000 / speed); }

function tick() {
  const next = +slider.value + 1;
  if (next > +slider.max) { stop(); return; }
  slider.value = next;
  graphSliderIdx = next;
  update(next);
  for (const c of Object.values(chartInstances)) c.update("none");
}

function play() {
  playing = true;
  btnPlay.innerHTML = "&#9646;&#9646;";
  if (+slider.value >= +slider.max) slider.value = 0;
  timer = setInterval(tick, interval());
}

function stop() {
  playing = false;
  btnPlay.innerHTML = "&#9654;";
  clearInterval(timer);
  timer = null;
}

btnPlay.addEventListener("click", () => playing ? stop() : play());
document.addEventListener("keydown", e => { if (e.code === "Space" && !compareMode) { e.preventDefault(); playing ? stop() : play(); } });
speedBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    speed = parseFloat(btn.dataset.speed);
    speedBtns.forEach(b => b.classList.toggle("active", b === btn));
    if (playing) { clearInterval(timer); timer = setInterval(tick, interval()); }
  });
});

const chartInstances = {};
let graphSliderIdx = 0;

// ── vertical scrub-line + value label plugin ──
Chart.register({
  id: "scrubLine",
  afterDraw(chart) {
    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;
    if (!xAxis || !yAxis || graphSliderIdx === null) return;
    const x = xAxis.getPixelForValue(graphSliderIdx);
    if (x < xAxis.left || x > xAxis.right) return;

    const key = chart.canvas.id.replace("gc-", "");
    const val = (ALL[key] && ALL[key][graphSliderIdx] != null)
                 ? ALL[key][graphSliderIdx] : null;

    const ctx = chart.ctx;
    ctx.save();

    ctx.fillStyle = "rgba(10, 10, 10, 0.55)";
    ctx.fillRect(x, yAxis.top, xAxis.right - x, yAxis.bottom - yAxis.top);

    ctx.beginPath();
    ctx.moveTo(x, yAxis.top);
    ctx.lineTo(x, yAxis.bottom);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#f97316";
    ctx.stroke();

    if (val !== null) {
      const text = fmt(val, key);
      ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
      const textW = ctx.measureText(text).width;
      const pad = 5, boxH = 18, boxW = textW + pad * 2;
      let bx = Math.max(xAxis.left, Math.min(xAxis.right - boxW, x - boxW / 2));
      const by = yAxis.top;
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 3);
      ctx.fill();
      ctx.fillStyle = "#0a0a0a";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx + pad, by + boxH / 2);
    }

    ctx.restore();
  }
});

function syncZoom(source) {
  const { min, max } = source.scales.x;
  const pool = compareMode ? Object.values(compareChartInstances) : Object.values(chartInstances);
  for (const c of pool) {
    if (c === source) continue;
    c.zoomScale("x", { min, max }, "none");
  }
  document.getElementById("btn-reset-zoom").style.display = "";
}

function resetAllZoom() {
  for (const c of [...Object.values(chartInstances), ...Object.values(compareChartInstances)]) {
    c.resetZoom("none");
  }
  document.getElementById("btn-reset-zoom").style.display = "none";
}

const zoomWheel = {
  zoom: {
    wheel: { enabled: true },
    pinch: { enabled: true },
    mode: "x",
    onZoomComplete: ({ chart }) => syncZoom(chart),
  },
};

const chartOpts = {
  animation: false, responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, zoom: zoomWheel },
  elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0.3 } },
  scales: {
    x: { ticks: { color: "#475569", font: { size: 10 }, maxTicksLimit: 6, maxRotation: 0 }, grid: { color: "#1a1a1d" } },
    y: { grid: { color: "#1e1e23" }, ticks: { color: "#64748b", font: { size: 11 } } }
  }
};

const compareChartOpts = {
  animation: false, responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    zoom: {
      ...zoomWheel,
      pan: { enabled: true, mode: "x", onPanComplete: ({ chart }) => syncZoom(chart) },
    },
  },
  elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0.3 } },
  scales: {
    x: { ticks: { color: "#475569", font: { size: 10 }, maxTicksLimit: 6, maxRotation: 0 }, grid: { color: "#1a1a1d" } },
    y: { grid: { color: "#1e1e23" }, ticks: { color: "#64748b", font: { size: 11 } } }
  }
};

function seekFromChart(canvas, clientX) {
  const chart = Chart.getChart(canvas);
  if (!chart) return;
  const xAxis = chart.scales.x;
  if (!xAxis) return;
  const rect = canvas.getBoundingClientRect();
  const px   = clientX - rect.left;
  let idx = Math.round(xAxis.getValueForPixel(px));
  idx = Math.max(0, Math.min(TIMELINE.length - 1, idx));
  slider.value   = idx;
  graphSliderIdx = idx;
  update(idx);
  for (const c of Object.values(chartInstances)) c.update("none");
}

function attachSeek(canvas) {
  let down = false;
  canvas.addEventListener("mousedown",  e => { down = true; seekFromChart(canvas, e.clientX); });
  canvas.addEventListener("mousemove",  e => { if (down) seekFromChart(canvas, e.clientX); });
  canvas.addEventListener("mouseup",    () => { down = false; });
  canvas.addEventListener("mouseleave", () => { down = false; });
  canvas.addEventListener("dblclick",   () => resetAllZoom());
  canvas.addEventListener("touchstart", e => { e.preventDefault(); seekFromChart(canvas, e.touches[0].clientX); }, { passive: false });
  canvas.addEventListener("touchmove",  e => { e.preventDefault(); seekFromChart(canvas, e.touches[0].clientX); }, { passive: false });
}

function renderCharts() {
  for (const [key,,, color] of METRIC_DEFS) {
    const canvas = document.getElementById("gc-" + key);
    const card   = document.getElementById("gccard-" + key);
    if (!canvas) continue;
    const vals    = ALL[key] || [];
    const hasData = vals.some(v => v !== null);
    if (card) card.classList.toggle("no-data", !hasData);
    if (chartInstances[key]) {
      chartInstances[key].data.labels           = TIMELINE;
      chartInstances[key].data.datasets[0].data = vals;
      chartInstances[key].update("none");
    } else {
      chartInstances[key] = new Chart(canvas, {
        type: "line",
        options: chartOpts,
        data: {
          labels: TIMELINE,
          datasets: [{ data: vals, borderColor: color, backgroundColor: color + "22", fill: true }]
        }
      });
      attachSeek(canvas);
    }
  }
}

function buildChartCards() {
  const grid = document.getElementById("charts-grid");
  for (const [key, label, unit] of METRIC_DEFS) {
    if (key === "rpm") continue;
    const div = document.createElement("div");
    div.className = "chart-card";
    div.id = "gccard-" + key;
    div.innerHTML =
      `<div class="chart-card-label">${label} <span class="chart-unit">(${unit})</span></div>` +
      `<canvas id="gc-${key}"></canvas>`;
    grid.appendChild(div);
  }
}

// ── compare mode ──────────────────────────────────────────────────────────────

const LOG_COLORS = {
  intake_pipe: { color: "#f97316", label: "Intake",   width: 2.5 },
  stock_1:     { color: "#38bdf8", label: "Stock 1",  width: 1.5 },
  stock_2:     { color: "#818cf8", label: "Stock 2",  width: 1.5 },
  stock_3:     { color: "#34d399", label: "Stock 3",  width: 1.5 },
};

function logCfg(name) {
  if (LOG_COLORS[name]) return LOG_COLORS[name];
  const palette = ["#f472b6", "#fbbf24", "#a3e635", "#22d3ee"];
  return { color: palette[Object.keys(compareLogs).indexOf(name) % palette.length], label: name, width: 1.5 };
}

let compareMode = false;
let compareLogs = {};
const compareChartInstances = {};

function buildCompareCards() {
  const grid = document.getElementById("compare-grid");
  for (const [key, label, unit] of METRIC_DEFS) {
    const div = document.createElement("div");
    div.className = "chart-card" + (key === "rpm" ? " cmp-wide" : "");
    div.id = "cmpcrd-" + key;
    div.innerHTML =
      `<div class="chart-card-label">${label} <span class="chart-unit">(${unit})</span></div>` +
      `<canvas id="cmp-${key}"></canvas>`;
    grid.appendChild(div);
  }
}

function renderCompareLegend(names) {
  const el = document.getElementById("compare-legend");
  el.innerHTML = names.map(n => {
    const cfg = logCfg(n);
    return `<span class="legend-item"><span class="legend-dot" style="background:${cfg.color}"></span>${cfg.label}</span>`;
  }).join("");
}

function renderCompareCharts() {
  const maxLen = Math.max(...Object.values(compareLogs).map(d => d.timeline.length));
  const xLabels = Array.from({ length: maxLen }, (_, i) => i);

  for (const [key] of METRIC_DEFS) {
    const canvas = document.getElementById("cmp-" + key);
    if (!canvas) continue;

    const datasets = Object.entries(compareLogs).map(([name, logData]) => {
      const cfg = logCfg(name);
      return {
        label: cfg.label,
        data: logData.all[key] || [],
        borderColor: cfg.color,
        backgroundColor: "transparent",
        borderWidth: cfg.width,
        fill: false,
        tension: 0.3,
        pointRadius: 0,
      };
    }).filter(ds => ds.data.some(v => v !== null));

    const card = document.getElementById("cmpcrd-" + key);
    if (card) card.classList.toggle("no-data", datasets.length === 0);

    if (compareChartInstances[key]) {
      compareChartInstances[key].data.labels   = xLabels;
      compareChartInstances[key].data.datasets = datasets;
      compareChartInstances[key].update("none");
    } else {
      compareChartInstances[key] = new Chart(canvas, {
        type: "line",
        options: compareChartOpts,
        data: { labels: xLabels, datasets },
      });
      canvas.addEventListener("dblclick", () => resetAllZoom());
    }
  }
}

async function loadCompare() {
  const names = await fetch("/api/logs").then(r => r.json());
  const query  = names.map(encodeURIComponent).join(",");
  compareLogs  = await fetch(`/api/compare?logs=${query}`).then(r => r.json());
  renderCompareLegend(names);
  renderCompareCharts();
}

function setCompareMode(on) {
  compareMode = on;
  document.getElementById("view-graph").style.display   = on ? "none" : "";
  document.getElementById("view-compare").style.display = on ? "block" : "none";
  document.querySelector(".slider-row").style.display   = on ? "none" : "";
  document.getElementById("btn-play").style.display     = on ? "none" : "";
  document.querySelector(".speed-btns").style.display   = on ? "none" : "";
  document.getElementById("log-select").style.display   = on ? "none" : "";
  document.getElementById("btn-compare").classList.toggle("active", on);
  if (on && Object.keys(compareLogs).length === 0) loadCompare();
}

document.getElementById("btn-compare").addEventListener("click", () => setCompareMode(!compareMode));
document.getElementById("btn-reset-zoom").addEventListener("click", resetAllZoom);

async function init() {
  buildChartCards();
  buildCompareCards();
  const names  = await fetch("/api/logs").then(r => r.json());
  const select = document.getElementById("log-select");
  select.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join("\n");
  if (names.length > 0) await loadLog(names[0]);
}

init();
