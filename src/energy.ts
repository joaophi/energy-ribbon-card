// Energy math, ported from the Home Assistant frontend (src/data/energy.ts, src/data/recorder.ts,
// src/panels/lovelace/cards/energy/energy-distribution-home-circle.ts) so the card shows exactly the
// same numbers as the built-in energy distribution card.

export interface StatisticValue {
  start: number;
  end: number;
  change?: number | null;
}
export type Statistics = Record<string, StatisticValue[]>;

export interface EnergySource {
  type: "grid" | "solar" | "battery" | "gas" | "water";
  stat_energy_from: string;
  stat_energy_to?: string;
  stat_soc?: string;
  capacity?: number;
}

export interface EnergyData {
  start: Date;
  end?: Date;
  prefs: { energy_sources: EnergySource[] };
  stats: Statistics;
  co2SignalEntity?: string;
  fossilEnergyConsumption?: Record<string, number>;
  waterUnit: string;
  gasUnit: string;
}

export interface SumData {
  total: Partial<Record<"to_grid" | "from_grid" | "solar" | "to_battery" | "from_battery", number>>;
  series: Partial<Record<"to_grid" | "from_grid" | "solar" | "to_battery" | "from_battery", Record<number, number>>>;
  timestamps: number[];
}

export const sourcesByType = (data: EnergyData) => {
  const out: Partial<Record<EnergySource["type"], EnergySource[]>> = {};
  for (const s of data.prefs.energy_sources) {
    (out[s.type] ??= []).push(s);
  }
  return out;
};

export const getSummedData = (data: EnergyData): SumData => {
  const ids: Partial<Record<keyof SumData["total"], string[]>> = {};
  const add = (k: keyof SumData["total"], id?: string) => {
    if (id) (ids[k] ??= []).push(id);
  };
  for (const s of data.prefs.energy_sources) {
    if (s.type === "solar") add("solar", s.stat_energy_from);
    else if (s.type === "battery") {
      add("to_battery", s.stat_energy_to);
      add("from_battery", s.stat_energy_from);
    } else if (s.type === "grid") {
      add("from_grid", s.stat_energy_from);
      add("to_grid", s.stat_energy_to);
    }
  }
  const out: SumData = { total: {}, series: {}, timestamps: [] };
  const timestamps = new Set<number>();
  for (const [key, subIds] of Object.entries(ids) as [keyof SumData["total"], string[]][]) {
    const series: Record<number, number> = {};
    let sum = 0;
    for (const id of subIds) {
      for (const stat of data.stats[id] ?? []) {
        if (stat.change === null || stat.change === undefined) continue;
        sum += stat.change;
        series[stat.start] = (series[stat.start] ?? 0) + stat.change;
        timestamps.add(stat.start);
      }
    }
    out.series[key] = series;
    out.total[key] = sum;
  }
  out.timestamps = Array.from(timestamps).sort();
  return out;
};

export interface ConsumptionTotals {
  used_total: number;
  grid_to_battery: number;
  battery_to_grid: number;
  solar_to_battery: number;
  solar_to_grid: number;
  used_solar: number;
  used_grid: number;
  used_battery: number;
}

const consumptionSingle = (d: {
  from_grid?: number;
  to_grid?: number;
  solar?: number;
  to_battery?: number;
  from_battery?: number;
}): ConsumptionTotals => {
  let toGrid = Math.max(d.to_grid || 0, 0);
  let toBattery = Math.max(d.to_battery || 0, 0);
  let solar = Math.max(d.solar || 0, 0);
  let fromGrid = Math.max(d.from_grid || 0, 0);
  let fromBattery = Math.max(d.from_battery || 0, 0);
  const usedTotal = fromGrid + solar + fromBattery - toGrid - toBattery;
  let gridToBattery = 0;
  let remaining = Math.max(usedTotal, 0);
  // Priority (same as Home Assistant): excess grid -> battery, solar -> battery, solar -> grid,
  // battery -> grid, grid -> battery, solar -> home, battery -> home, grid -> home.
  const excessGrid = Math.max(0, Math.min(toBattery, fromGrid - remaining));
  gridToBattery += excessGrid;
  toBattery -= excessGrid;
  fromGrid -= excessGrid;
  const solarToBattery = Math.min(solar, toBattery);
  toBattery -= solarToBattery;
  solar -= solarToBattery;
  const solarToGrid = Math.min(solar, toGrid);
  toGrid -= solarToGrid;
  solar -= solarToGrid;
  const batteryToGrid = Math.min(fromBattery, toGrid);
  fromBattery -= batteryToGrid;
  const gridToBattery2 = Math.min(fromGrid, toBattery);
  gridToBattery += gridToBattery2;
  fromGrid -= gridToBattery2;
  const usedSolar = Math.min(remaining, solar);
  remaining -= usedSolar;
  const usedBattery = Math.min(fromBattery, remaining);
  remaining -= usedBattery;
  const usedGrid = Math.min(remaining, fromGrid);
  return {
    used_solar: usedSolar,
    used_grid: usedGrid,
    used_battery: usedBattery,
    used_total: usedTotal,
    grid_to_battery: gridToBattery,
    battery_to_grid: batteryToGrid,
    solar_to_battery: solarToBattery,
    solar_to_grid: solarToGrid,
  };
};

export const computeConsumption = (sum: SumData): ConsumptionTotals => {
  const total: ConsumptionTotals = {
    used_total: 0,
    grid_to_battery: 0,
    battery_to_grid: 0,
    solar_to_battery: 0,
    solar_to_grid: 0,
    used_solar: 0,
    used_grid: 0,
    used_battery: 0,
  };
  const s = sum.series;
  for (const t of sum.timestamps) {
    const c = consumptionSingle({
      from_grid: s.from_grid && (s.from_grid[t] ?? 0),
      to_grid: s.to_grid && (s.to_grid[t] ?? 0),
      solar: s.solar && (s.solar[t] ?? 0),
      to_battery: s.to_battery && (s.to_battery[t] ?? 0),
      from_battery: s.from_battery && (s.from_battery[t] ?? 0),
    });
    for (const k of Object.keys(total) as (keyof ConsumptionTotals)[]) {
      total[k] += c[k];
    }
  }
  return total;
};

export const sumGrowth = (stats: Statistics, ids: string[]): number | null => {
  let total: number | null = null;
  for (const id of ids) {
    for (const v of stats[id] ?? []) {
      if (v.change === null || v.change === undefined) continue;
      total = (total ?? 0) + v.change;
    }
  }
  return total;
};

interface Locale {
  language: string;
  number_format?: string;
}

const numberLocale = (l?: Locale): string | undefined => {
  switch (l?.number_format) {
    case "comma_decimal":
      return "en-US";
    case "decimal_comma":
      return "de";
    case "space_comma":
      return "fr";
    case "system":
      return undefined;
    default:
      return l?.language;
  }
};

export const formatNumber = (n: number, locale?: Locale, options?: Intl.NumberFormatOptions): string => {
  if (locale?.number_format === "none") {
    return new Intl.NumberFormat("en-US", { ...options, useGrouping: false }).format(n);
  }
  return new Intl.NumberFormat(numberLocale(locale), options).format(n);
};

const UNITS = ["Wh", "kWh", "MWh", "GWh", "TWh"];

export const formatConsumptionShort = (
  locale: Locale | undefined,
  consumption: number | null,
  unit: string,
  targetUnit?: string,
  displayPrecision?: number
): string => {
  let picked = unit;
  let val = consumption || 0;
  const target = targetUnit ? UNITS.indexOf(targetUnit) : -1;
  let idx = UNITS.indexOf(unit);
  if (idx >= 0) {
    while (target > -1 ? target < idx : Math.abs(val) < 1 && idx > 0) {
      val *= 1000;
      idx--;
    }
    while (target > -1 ? target > idx : Math.abs(val) >= 1000 && idx < UNITS.length - 1) {
      val /= 1000;
      idx++;
    }
    picked = UNITS[idx];
  }
  const opts: Intl.NumberFormatOptions =
    displayPrecision !== undefined && picked === unit
      ? { minimumFractionDigits: displayPrecision, maximumFractionDigits: displayPrecision }
      : { maximumFractionDigits: Math.abs(val) < 10 ? 2 : Math.abs(val) < 100 ? 1 : 0 };
  return `${formatNumber(val, locale, opts)} ${picked}`;
};

export const HOME_CIRCUMFERENCE = 238.76104;

export const homeCircleArcs = (o: {
  usedSolar: number;
  usedBattery: number;
  usedGrid: number;
  hasSolar: boolean;
  hasGrid: boolean;
  highCarbonConsumption?: number;
}) => {
  const solar = Math.max(o.usedSolar, 0);
  const battery = Math.max(o.usedBattery, 0);
  const grid = Math.max(o.usedGrid, 0);
  const total = solar + battery + grid;
  const arcs: { solar?: number; battery?: number; lowCarbon?: number; grid?: number } = {};
  if (total <= 0) return arcs;
  const share = (v: number) => HOME_CIRCUMFERENCE * (v / total);
  if (o.hasSolar) arcs.solar = share(solar);
  if (battery > 0) arcs.battery = share(battery);
  if (o.hasGrid) {
    if (o.highCarbonConsumption !== undefined) {
      const high = Math.min(Math.max(o.highCarbonConsumption, 0), grid);
      arcs.lowCarbon = share(grid - high);
      arcs.grid = share(high);
    } else {
      arcs.grid = share(grid);
    }
  }
  return arcs;
};
