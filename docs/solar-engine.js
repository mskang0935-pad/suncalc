/**
 * SUNCALC 브라우저 계산 엔진 (GitHub Pages용)
 */
(function (global) {
  const REGIONS = [
    { id: "seoul", name: "서울", peakHours: 3.6 },
    { id: "incheon", name: "인천", peakHours: 3.7 },
    { id: "daejeon", name: "대전", peakHours: 3.9 },
    { id: "daegu", name: "대구", peakHours: 4.0 },
    { id: "gwangju", name: "광주", peakHours: 4.1 },
    { id: "busan", name: "부산", peakHours: 4.0 },
    { id: "ulsan", name: "울산", peakHours: 4.0 },
    { id: "jeju", name: "제주", peakHours: 3.8 },
    { id: "gangneung", name: "강릉", peakHours: 3.8 },
    { id: "jeonju", name: "전주", peakHours: 4.0 },
    { id: "cheongju", name: "청주", peakHours: 3.9 },
    { id: "changwon", name: "창원", peakHours: 4.0 },
  ];

  const DEFAULTS = {
    region: "daejeon",
    capacity: 10,
    moduleEff: 21.5,
    pr: 0.8,
    tilt: 30,
    azimuth: 0,
    area: 60,
    areaPerKw: 5.5,
    capexUnit: 1400000,
    omUnit: 20000,
    tariff: 160,
    selfUse: 70,
    exportPrice: 100,
    discount: 4.5,
    years: 25,
    degrade: 0.5,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function tiltFactor(tiltDeg) {
    const t = clamp(Number(tiltDeg), 0, 90);
    const delta = Math.abs(t - 30);
    return clamp(1 - delta * 0.0045, 0.72, 1.05);
  }

  function azimuthFactor(azimuthDeg) {
    const a = Math.abs(clamp(Number(azimuthDeg), -180, 180));
    if (a <= 15) return 1;
    if (a >= 90) return 0.78;
    return 1 - ((a - 15) / 75) * 0.22;
  }

  function normalizeInputs(body) {
    body = body || {};
    const num = (key, fallback) => {
      const v = Number(body[key]);
      return Number.isFinite(v) ? v : fallback;
    };
    return {
      region: String(body.region || DEFAULTS.region),
      capacity: num("capacity", DEFAULTS.capacity),
      moduleEff: num("moduleEff", DEFAULTS.moduleEff),
      pr: num("pr", DEFAULTS.pr),
      tilt: num("tilt", DEFAULTS.tilt),
      azimuth: num("azimuth", DEFAULTS.azimuth),
      area: num("area", DEFAULTS.area),
      areaPerKw: num("areaPerKw", DEFAULTS.areaPerKw),
      capexUnit: num("capexUnit", DEFAULTS.capexUnit),
      omUnit: num("omUnit", DEFAULTS.omUnit),
      tariff: num("tariff", DEFAULTS.tariff),
      selfUse: num("selfUse", DEFAULTS.selfUse),
      exportPrice: num("exportPrice", DEFAULTS.exportPrice),
      discount: num("discount", DEFAULTS.discount),
      years: Math.round(num("years", DEFAULTS.years)),
      degrade: num("degrade", DEFAULTS.degrade),
    };
  }

  function validate(inputs) {
    const errors = [];
    if (!(inputs.capacity > 0)) errors.push("설치 용량을 입력하세요.");
    if (!(inputs.pr > 0 && inputs.pr <= 1)) errors.push("성능비 PR은 0~1 사이여야 합니다.");
    if (!(inputs.years >= 1 && inputs.years <= 40)) errors.push("분석 기간은 1~40년이어야 합니다.");
    if (!(inputs.areaPerKw > 0)) errors.push("모듈 단위면적을 확인하세요.");
    return errors;
  }

  function estimateIrr(capex, cashflows) {
    let lo = -0.5;
    let hi = 1.5;
    const npvAt = (r) =>
      -capex + cashflows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + r, i + 1), 0);
    if (npvAt(lo) * npvAt(hi) > 0) return null;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (npvAt(mid) > 0) lo = mid;
      else hi = mid;
    }
    return ((lo + hi) / 2) * 100;
  }

  function computeEconomics(inputs, year1Gen) {
    const years = inputs.years;
    const degrade = inputs.degrade / 100;
    const selfRatio = clamp(inputs.selfUse, 0, 100) / 100;
    const exportRatio = 1 - selfRatio;
    const capex = inputs.capacity * inputs.capexUnit;
    const omYear = inputs.capacity * inputs.omUnit;
    const discount = inputs.discount / 100;

    const rows = [];
    let cumulative = -capex;
    let npv = -capex;
    let totalGen = 0;
    let totalRevenue = 0;
    let totalOm = 0;
    let paybackYear = null;

    for (let y = 1; y <= years; y++) {
      const gen = year1Gen * Math.pow(1 - degrade, y - 1);
      const revenue =
        gen * selfRatio * inputs.tariff + gen * exportRatio * inputs.exportPrice;
      const net = revenue - omYear;
      cumulative += net;
      npv += net / Math.pow(1 + discount, y);
      totalGen += gen;
      totalRevenue += revenue;
      totalOm += omYear;

      if (paybackYear === null && cumulative >= 0) {
        const prevCum = cumulative - net;
        const frac = net !== 0 ? -prevCum / net : 0;
        paybackYear = y - 1 + clamp(frac, 0, 1);
      }

      rows.push({ year: y, gen, revenue, om: omYear, net, cumulative });
    }

    const discountedOm = Array.from({ length: years }, (_, i) => omYear / Math.pow(1 + discount, i + 1)).reduce(
      (a, b) => a + b,
      0
    );
    const discountedGen = Array.from({ length: years }, (_, i) => {
      const g = year1Gen * Math.pow(1 - degrade, i);
      return g / Math.pow(1 + discount, i + 1);
    }).reduce((a, b) => a + b, 0);

    const lcoe = discountedGen > 0 ? (capex + discountedOm) / discountedGen : 0;
    const irr = estimateIrr(
      capex,
      rows.map((r) => r.net)
    );
    const roi = capex > 0 ? ((totalRevenue - totalOm - capex) / capex) * 100 : 0;

    return {
      capex,
      omYear,
      rows,
      npv,
      paybackYear,
      lcoe,
      irr,
      roi,
      totalGen,
      totalRevenue,
      avgAnnualGen: totalGen / years,
      year1Revenue:
        year1Gen * selfRatio * inputs.tariff + year1Gen * exportRatio * inputs.exportPrice,
    };
  }

  function calculate(rawInputs) {
    const inputs = normalizeInputs(rawInputs);
    const errors = validate(inputs);
    if (errors.length) {
      const err = new Error(errors.join(" "));
      err.errors = errors;
      throw err;
    }

    const region = REGIONS.find((r) => r.id === inputs.region);
    if (!region) {
      const err = new Error("지원하지 않는 지역입니다.");
      err.errors = [err.message];
      throw err;
    }

    const fTilt = tiltFactor(inputs.tilt);
    const fAz = azimuthFactor(inputs.azimuth);
    const year1Gen = inputs.capacity * region.peakHours * fTilt * fAz * inputs.pr * 365;
    const requiredArea = inputs.capacity * inputs.areaPerKw;
    const eco = computeEconomics(inputs, year1Gen);
    const capacityFactor = (year1Gen / (inputs.capacity * 8760)) * 100;
    const areaOk = inputs.area <= 0 || requiredArea <= inputs.area;

    return {
      ok: true,
      inputs,
      region,
      generation: {
        year1: year1Gen,
        total: eco.totalGen,
        avgAnnual: eco.avgAnnualGen,
        capacityFactor,
        tiltFactor: fTilt,
        azimuthFactor: fAz,
        requiredArea,
        areaOk,
      },
      economics: {
        capex: eco.capex,
        omYear: eco.omYear,
        year1Revenue: eco.year1Revenue,
        totalRevenue: eco.totalRevenue,
        npv: eco.npv,
        paybackYear: eco.paybackYear,
        lcoe: eco.lcoe,
        irr: eco.irr,
        roi: eco.roi,
        cheaperThanTariff: eco.lcoe < inputs.tariff,
      },
      rows: eco.rows,
    };
  }

  global.SunCalcEngine = { REGIONS, DEFAULTS, calculate };
})(typeof window !== "undefined" ? window : globalThis);
