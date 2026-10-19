/**
 * SUNCALC 프론트엔드
 * - 로컬 Python 서버가 있으면 API 사용
 * - GitHub Pages 등 정적 호스팅에서는 브라우저 엔진 사용
 */

let defaultsCache = null;
let regionsCache = [];
let lastRows = null;
let resizeTimer = null;
let useApi = false;

function formatNumber(n, digits = 0) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

function formatWon(n) {
  const abs = Math.abs(n);
  if (abs >= 100000000) return `${formatNumber(n / 100000000, 2)}억 원`;
  if (abs >= 10000) return `${formatNumber(n / 10000, 0)}만 원`;
  return `${formatNumber(n, 0)}원`;
}

function getInputs(form) {
  const data = new FormData(form);
  const num = (key) => Number(data.get(key));
  return {
    region: String(data.get("region")),
    capacity: num("capacity"),
    moduleEff: num("moduleEff"),
    pr: num("pr"),
    tilt: num("tilt"),
    azimuth: num("azimuth"),
    area: num("area"),
    areaPerKw: num("areaPerKw"),
    capexUnit: num("capexUnit"),
    omUnit: num("omUnit"),
    tariff: num("tariff"),
    selfUse: num("selfUse"),
    exportPrice: num("exportPrice"),
    discount: num("discount"),
    years: Math.round(num("years")),
    degrade: num("degrade"),
  };
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || data.errors?.join("\n") || "요청에 실패했습니다.";
    throw new Error(message);
  }
  return data;
}

function populateRegions(regions, selectedId) {
  const select = document.getElementById("region");
  select.innerHTML = regions
    .map(
      (r) =>
        `<option value="${r.id}" ${r.id === selectedId ? "selected" : ""}>${r.name} (일사 ${r.peakHours} h/day)</option>`
    )
    .join("");
}

function applyDefaults(defaults) {
  const form = document.getElementById("solar-form");
  Object.entries(defaults).forEach(([key, value]) => {
    const el = form.elements.namedItem(key);
    if (el) el.value = value;
  });
}

function setLoading(isLoading) {
  const btn = document.querySelector('#solar-form button[type="submit"]');
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "계산 중…" : "발전·경제성 계산";
}

function renderKpis(result) {
  const { inputs, region, generation, economics } = result;
  const paybackText =
    economics.paybackYear == null
      ? "기간 내 미회수"
      : `${formatNumber(economics.paybackYear, 1)}년`;

  document.getElementById("kpi-row").innerHTML = `
    <div class="kpi">
      <span class="label">1년차 발전량</span>
      <span class="value">${formatNumber(generation.year1, 0)} kWh</span>
      <span class="hint">${region.name} · PR ${inputs.pr}</span>
    </div>
    <div class="kpi">
      <span class="label">연간 예상 수익</span>
      <span class="value">${formatWon(economics.year1Revenue)}</span>
      <span class="hint">자가소비 ${inputs.selfUse}%</span>
    </div>
    <div class="kpi">
      <span class="label">단순 회수기간</span>
      <span class="value">${paybackText}</span>
      <span class="hint">초기투자 ${formatWon(economics.capex)}</span>
    </div>
    <div class="kpi">
      <span class="label">NPV (${inputs.years}년)</span>
      <span class="value">${formatWon(economics.npv)}</span>
      <span class="hint">할인율 ${inputs.discount}%</span>
    </div>
  `;

  document.getElementById("result-summary").textContent = generation.areaOk
    ? `${region.name} ${inputs.capacity} kWp 기준, 필요면적 약 ${formatNumber(generation.requiredArea, 1)}㎡입니다.`
    : `필요면적 ${formatNumber(generation.requiredArea, 1)}㎡가 입력 면적 ${formatNumber(inputs.area, 0)}㎡를 초과합니다. 용량을 줄이거나 면적을 늘리세요.`;
}

function renderDetails(result) {
  const { inputs, region, generation, economics } = result;

  document.getElementById("gen-detail").innerHTML = `
    <div><dt>지역 일사시간</dt><dd>${region.peakHours} h/day</dd></div>
    <div><dt>경사 보정계수</dt><dd>${formatNumber(generation.tiltFactor, 3)}</dd></div>
    <div><dt>방위 보정계수</dt><dd>${formatNumber(generation.azimuthFactor, 3)}</dd></div>
    <div><dt>필요 설치면적</dt><dd>${formatNumber(generation.requiredArea, 1)} ㎡</dd></div>
    <div><dt>기간 총 발전량</dt><dd>${formatNumber(generation.total, 0)} kWh</dd></div>
    <div><dt>연평균 발전량</dt><dd>${formatNumber(generation.avgAnnual, 0)} kWh/년</dd></div>
    <div><dt>용량계수 (1년차)</dt><dd>${formatNumber(generation.capacityFactor, 1)} %</dd></div>
  `;

  const irrText = economics.irr == null ? "산출 불가" : `${formatNumber(economics.irr, 1)} %`;
  document.getElementById("eco-detail").innerHTML = `
    <div><dt>초기 투자비</dt><dd>${formatWon(economics.capex)}</dd></div>
    <div><dt>연간 O&amp;M</dt><dd>${formatWon(economics.omYear)}</dd></div>
    <div><dt>기간 총 수익</dt><dd>${formatWon(economics.totalRevenue)}</dd></div>
    <div><dt>ROI</dt><dd>${formatNumber(economics.roi, 1)} %</dd></div>
    <div><dt>IRR</dt><dd>${irrText}</dd></div>
    <div><dt>LCOE</dt><dd>${formatNumber(economics.lcoe, 0)} 원/kWh</dd></div>
    <div><dt>전기요금 대비</dt><dd>${economics.cheaperThanTariff ? "요금보다 낮음" : "요금보다 높음"}</dd></div>
  `;
}

function renderTable(rows) {
  const tbody = document.querySelector("#year-table tbody");
  tbody.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${r.year}</td>
        <td>${formatNumber(r.gen, 0)}</td>
        <td>${formatNumber(r.revenue, 0)}</td>
        <td>${formatNumber(r.om, 0)}</td>
        <td>${formatNumber(r.net, 0)}</td>
        <td>${formatNumber(r.cumulative, 0)}</td>
      </tr>`
    )
    .join("");
}

function drawLineChart(canvas, points, options) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = 280;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pad = { t: 16, r: 16, b: 36, l: 56 };
  const w = cssW - pad.l - pad.r;
  const h = cssH - pad.t - pad.b;
  const values = points.map((p) => p.y);
  let minY = Math.min(...values, 0);
  let maxY = Math.max(...values, 0);
  if (minY === maxY) {
    maxY += 1;
    minY -= 1;
  }
  const span = maxY - minY;

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.strokeStyle = "rgba(20,32,28,0.1)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
  }

  const xAt = (i) => pad.l + (w * i) / Math.max(points.length - 1, 1);
  const yAt = (v) => pad.t + h - ((v - minY) / span) * h;

  if (options.zeroLine && minY < 0 && maxY > 0) {
    ctx.strokeStyle = "rgba(20,32,28,0.25)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, yAt(0));
    ctx.lineTo(pad.l + w, yAt(0));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  grad.addColorStop(0, options.fillTop);
  grad.addColorStop(1, "rgba(255,255,255,0)");

  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xAt(points.length - 1), pad.t + h);
  ctx.lineTo(xAt(0), pad.t + h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = options.color;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = "#6b7a73";
  ctx.font = "12px DM Sans, sans-serif";
  ctx.textAlign = "center";
  const step = Math.ceil(points.length / 6);
  points.forEach((p, i) => {
    if (i % step === 0 || i === points.length - 1) {
      ctx.fillText(String(p.x), xAt(i), cssH - 12);
    }
  });

  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const v = maxY - (span * i) / 4;
    const label = options.formatY ? options.formatY(v) : formatNumber(v, 0);
    ctx.fillText(label, pad.l - 8, pad.t + (h * i) / 4 + 4);
  }
}

function renderCharts(rows) {
  drawLineChart(
    document.getElementById("gen-chart"),
    rows.map((r) => ({ x: r.year, y: r.gen })),
    {
      color: "#1f6b4a",
      fillTop: "rgba(31,107,74,0.22)",
      formatY: (v) => (v >= 1000 ? `${formatNumber(v / 1000, 0)}k` : formatNumber(v, 0)),
    }
  );

  drawLineChart(
    document.getElementById("cash-chart"),
    rows.map((r) => ({ x: r.year, y: r.cumulative })),
    {
      color: "#c47d0a",
      fillTop: "rgba(232,163,23,0.25)",
      zeroLine: true,
      formatY: (v) => {
        if (Math.abs(v) >= 100000000) return `${formatNumber(v / 100000000, 1)}억`;
        if (Math.abs(v) >= 10000) return `${formatNumber(v / 10000, 0)}만`;
        return formatNumber(v, 0);
      },
    }
  );
}

function showResult(result) {
  lastRows = result.rows;
  const results = document.getElementById("results");
  results.hidden = false;
  renderKpis(result);
  renderDetails(result);
  renderTable(result.rows);
  renderCharts(result.rows);
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runCalculation(event) {
  event.preventDefault();
  const inputs = getInputs(event.currentTarget);

  setLoading(true);
  try {
    let result;
    if (useApi) {
      result = await fetchJson("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs),
      });
    } else {
      result = window.SunCalcEngine.calculate(inputs);
    }
    showResult(result);
  } catch (error) {
    alert(error.message);
  } finally {
    setLoading(false);
  }
}

async function init() {
  try {
    const data = await fetchJson("/api/defaults");
    defaultsCache = data.defaults;
    regionsCache = data.regions;
    useApi = true;
  } catch (_error) {
    if (!window.SunCalcEngine) {
      alert("계산 엔진을 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
      return;
    }
    defaultsCache = window.SunCalcEngine.DEFAULTS;
    regionsCache = window.SunCalcEngine.REGIONS;
    useApi = false;
  }

  populateRegions(regionsCache, defaultsCache.region);
  applyDefaults(defaultsCache);

  document.getElementById("solar-form").addEventListener("submit", runCalculation);
  document.getElementById("reset-btn").addEventListener("click", () => {
    if (defaultsCache) applyDefaults(defaultsCache);
    lastRows = null;
    document.getElementById("results").hidden = true;
  });

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (lastRows) renderCharts(lastRows);
    }, 150);
  });
}

document.addEventListener("DOMContentLoaded", init);
