"""태양광 발전량·경제성 계산 엔진"""

from __future__ import annotations

from typing import Any

REGIONS = [
    {"id": "seoul", "name": "서울", "peakHours": 3.6},
    {"id": "incheon", "name": "인천", "peakHours": 3.7},
    {"id": "daejeon", "name": "대전", "peakHours": 3.9},
    {"id": "daegu", "name": "대구", "peakHours": 4.0},
    {"id": "gwangju", "name": "광주", "peakHours": 4.1},
    {"id": "busan", "name": "부산", "peakHours": 4.0},
    {"id": "ulsan", "name": "울산", "peakHours": 4.0},
    {"id": "jeju", "name": "제주", "peakHours": 3.8},
    {"id": "gangneung", "name": "강릉", "peakHours": 3.8},
    {"id": "jeonju", "name": "전주", "peakHours": 4.0},
    {"id": "cheongju", "name": "청주", "peakHours": 3.9},
    {"id": "changwon", "name": "창원", "peakHours": 4.0},
]

DEFAULTS = {
    "region": "daejeon",
    "capacity": 10,
    "moduleEff": 21.5,
    "pr": 0.8,
    "tilt": 30,
    "azimuth": 0,
    "area": 60,
    "areaPerKw": 5.5,
    "capexUnit": 1400000,
    "omUnit": 20000,
    "tariff": 160,
    "selfUse": 70,
    "exportPrice": 100,
    "discount": 4.5,
    "years": 25,
    "degrade": 0.5,
}


class CalculationError(Exception):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__(" ".join(errors))


def clamp(value: float, min_v: float, max_v: float) -> float:
    return min(max_v, max(min_v, value))


def tilt_factor(tilt_deg: float) -> float:
    t = clamp(float(tilt_deg), 0, 90)
    delta = abs(t - 30)
    return clamp(1 - delta * 0.0045, 0.72, 1.05)


def azimuth_factor(azimuth_deg: float) -> float:
    a = abs(clamp(float(azimuth_deg), -180, 180))
    if a <= 15:
        return 1.0
    if a >= 90:
        return 0.78
    return 1 - ((a - 15) / 75) * 0.22


def _num(body: dict[str, Any], key: str, fallback: float) -> float:
    try:
        value = float(body.get(key, fallback))
    except (TypeError, ValueError):
        return float(fallback)
    return value if value == value else float(fallback)  # NaN check


def normalize_inputs(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    return {
        "region": str(body.get("region") or DEFAULTS["region"]),
        "capacity": _num(body, "capacity", DEFAULTS["capacity"]),
        "moduleEff": _num(body, "moduleEff", DEFAULTS["moduleEff"]),
        "pr": _num(body, "pr", DEFAULTS["pr"]),
        "tilt": _num(body, "tilt", DEFAULTS["tilt"]),
        "azimuth": _num(body, "azimuth", DEFAULTS["azimuth"]),
        "area": _num(body, "area", DEFAULTS["area"]),
        "areaPerKw": _num(body, "areaPerKw", DEFAULTS["areaPerKw"]),
        "capexUnit": _num(body, "capexUnit", DEFAULTS["capexUnit"]),
        "omUnit": _num(body, "omUnit", DEFAULTS["omUnit"]),
        "tariff": _num(body, "tariff", DEFAULTS["tariff"]),
        "selfUse": _num(body, "selfUse", DEFAULTS["selfUse"]),
        "exportPrice": _num(body, "exportPrice", DEFAULTS["exportPrice"]),
        "discount": _num(body, "discount", DEFAULTS["discount"]),
        "years": int(round(_num(body, "years", DEFAULTS["years"]))),
        "degrade": _num(body, "degrade", DEFAULTS["degrade"]),
    }


def validate(inputs: dict[str, Any]) -> list[str]:
    errors = []
    if not (inputs["capacity"] > 0):
        errors.append("설치 용량을 입력하세요.")
    if not (0 < inputs["pr"] <= 1):
        errors.append("성능비 PR은 0~1 사이여야 합니다.")
    if not (1 <= inputs["years"] <= 40):
        errors.append("분석 기간은 1~40년이어야 합니다.")
    if not (inputs["areaPerKw"] > 0):
        errors.append("모듈 단위면적을 확인하세요.")
    return errors


def estimate_irr(capex: float, cashflows: list[float]) -> float | None:
    def npv_at(rate: float) -> float:
        total = -capex
        for i, cf in enumerate(cashflows):
            total += cf / ((1 + rate) ** (i + 1))
        return total

    lo, hi = -0.5, 1.5
    if npv_at(lo) * npv_at(hi) > 0:
        return None

    for _ in range(60):
        mid = (lo + hi) / 2
        if npv_at(mid) > 0:
            lo = mid
        else:
            hi = mid
    return ((lo + hi) / 2) * 100


def compute_economics(inputs: dict[str, Any], year1_gen: float) -> dict[str, Any]:
    years = inputs["years"]
    degrade = inputs["degrade"] / 100
    self_ratio = clamp(inputs["selfUse"], 0, 100) / 100
    export_ratio = 1 - self_ratio
    capex = inputs["capacity"] * inputs["capexUnit"]
    om_year = inputs["capacity"] * inputs["omUnit"]
    discount = inputs["discount"] / 100

    rows = []
    cumulative = -capex
    npv = -capex
    total_gen = 0.0
    total_revenue = 0.0
    total_om = 0.0
    payback_year = None

    for y in range(1, years + 1):
        gen = year1_gen * ((1 - degrade) ** (y - 1))
        revenue = gen * self_ratio * inputs["tariff"] + gen * export_ratio * inputs["exportPrice"]
        net = revenue - om_year
        cumulative += net
        npv += net / ((1 + discount) ** y)
        total_gen += gen
        total_revenue += revenue
        total_om += om_year

        if payback_year is None and cumulative >= 0:
            prev_cum = cumulative - net
            frac = (-prev_cum / net) if net != 0 else 0
            payback_year = y - 1 + clamp(frac, 0, 1)

        rows.append(
            {
                "year": y,
                "gen": gen,
                "revenue": revenue,
                "om": om_year,
                "net": net,
                "cumulative": cumulative,
            }
        )

    discounted_om = sum(om_year / ((1 + discount) ** (i + 1)) for i in range(years))
    discounted_gen = sum(
        (year1_gen * ((1 - degrade) ** i)) / ((1 + discount) ** (i + 1)) for i in range(years)
    )
    lcoe = (capex + discounted_om) / discounted_gen if discounted_gen > 0 else 0
    irr = estimate_irr(capex, [r["net"] for r in rows])
    roi = ((total_revenue - total_om - capex) / capex) * 100 if capex > 0 else 0

    return {
        "capex": capex,
        "omYear": om_year,
        "rows": rows,
        "npv": npv,
        "paybackYear": payback_year,
        "lcoe": lcoe,
        "irr": irr,
        "roi": roi,
        "totalGen": total_gen,
        "totalRevenue": total_revenue,
        "avgAnnualGen": total_gen / years,
        "year1Revenue": year1_gen * self_ratio * inputs["tariff"]
        + year1_gen * export_ratio * inputs["exportPrice"],
    }


def calculate(raw_inputs: dict[str, Any] | None = None) -> dict[str, Any]:
    inputs = normalize_inputs(raw_inputs)
    errors = validate(inputs)
    if errors:
        raise CalculationError(errors)

    region = next((r for r in REGIONS if r["id"] == inputs["region"]), None)
    if region is None:
        raise CalculationError(["지원하지 않는 지역입니다."])

    f_tilt = tilt_factor(inputs["tilt"])
    f_az = azimuth_factor(inputs["azimuth"])
    year1_gen = inputs["capacity"] * region["peakHours"] * f_tilt * f_az * inputs["pr"] * 365
    required_area = inputs["capacity"] * inputs["areaPerKw"]
    eco = compute_economics(inputs, year1_gen)
    capacity_factor = (year1_gen / (inputs["capacity"] * 8760)) * 100
    area_ok = inputs["area"] <= 0 or required_area <= inputs["area"]

    return {
        "inputs": inputs,
        "region": region,
        "generation": {
            "year1": year1_gen,
            "total": eco["totalGen"],
            "avgAnnual": eco["avgAnnualGen"],
            "capacityFactor": capacity_factor,
            "tiltFactor": f_tilt,
            "azimuthFactor": f_az,
            "requiredArea": required_area,
            "areaOk": area_ok,
        },
        "economics": {
            "capex": eco["capex"],
            "omYear": eco["omYear"],
            "year1Revenue": eco["year1Revenue"],
            "totalRevenue": eco["totalRevenue"],
            "npv": eco["npv"],
            "paybackYear": eco["paybackYear"],
            "lcoe": eco["lcoe"],
            "irr": eco["irr"],
            "roi": eco["roi"],
            "cheaperThanTariff": eco["lcoe"] < inputs["tariff"],
        },
        "rows": eco["rows"],
    }
