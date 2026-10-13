import {
  mdiBattery,
  mdiBattery10,
  mdiBattery20,
  mdiBattery30,
  mdiBattery40,
  mdiBattery50,
  mdiBattery60,
  mdiBattery70,
  mdiBattery80,
  mdiBattery90,
  mdiBatteryAlertVariantOutline,
  mdiBatteryHigh,
  mdiFire,
  mdiHome,
  mdiLeaf,
  mdiSolarPower,
  mdiTransmissionTower,
  mdiWater,
} from "@mdi/js";
import type {
  EnergyDiagramFlow,
  EnergyDiagramLine,
  EnergyDiagramModel,
  EnergyDiagramNode,
  EnergyNodeKey,
  FlowId,
} from "./diagram";
import { drawEnergyDistributionDiagram } from "./diagram";
import type { EnergyData } from "./energy";
import {
  computeConsumption,
  formatConsumptionShort,
  formatNumber,
  getSummedData,
  HOME_CIRCUMFERENCE,
  homeCircleArcs,
  sourcesByType,
  sumGrowth,
} from "./energy";

const VERSION = "0.1.3";

interface CardConfig {
  type: string;
  title?: string;
  collection_key?: string;
  link_dashboard?: boolean;
}

// Minimal view of the Home Assistant object this card uses.
interface Hass {
  connection: Record<string, any>;
  states: Record<string, { state: string; attributes: Record<string, any> }>;
  entities: Record<string, { display_precision?: number }>;
  config: { location_name: string };
  locale: { language: string; number_format?: string };
  panelUrl?: string;
  localize: (key: string, ...args: any[]) => string;
}

interface Collection {
  subscribe: (cb: (data: EnergyData) => void) => () => void;
}

const hasFlow = (v: number | null | undefined): v is number => Math.round((v ?? 0) * 1000) / 1000 > 0;

const batteryIcon = (soc: number) => {
  const level = Math.round(soc / 10) * 10;
  if (level >= 100) return mdiBattery;
  if (level <= 0) return mdiBatteryAlertVariantOutline;
  return [mdiBattery10, mdiBattery20, mdiBattery30, mdiBattery40, mdiBattery50, mdiBattery60, mdiBattery70, mdiBattery80, mdiBattery90][level / 10 - 1];
};

const STYLE = `
  :host { display: block; }
  ha-card { min-width: 210px; }
  .card-content { position: relative; direction: ltr; padding: 16px; }
  svg.diagram { display: block; width: 100%; overflow: visible; }
  .node { fill: var(--ha-card-background, var(--card-background-color)); }
  .icon { fill: var(--primary-text-color); }
  .value { font-size: var(--ha-font-size-s, 12px); fill: var(--primary-text-color); }
  .label { font-size: var(--ha-font-size-s, 12px); fill: var(--secondary-text-color); }
  .pill { font-size: 11px; font-weight: 500; }
  .card-actions { border-top: 1px solid var(--divider-color); padding: 4px 8px; }
  .card-actions a { color: var(--primary-color); text-decoration: none; font-weight: 500; padding: 8px; display: inline-block; }
  .message { padding: 16px; color: var(--secondary-text-color); }
`;

class EnergyRibbonCard extends HTMLElement {
  private _config?: CardConfig;

  private _hass?: Hass;

  private _data?: EnergyData;

  private _unsub?: () => void;

  private _subscribedKey?: string;

  private _helper?: HTMLElement;

  private _resize?: ResizeObserver;

  private _drawnKey?: string;

  private _probe?: HTMLElement;

  public static getStubConfig() {
    return {};
  }

  public setConfig(config: CardConfig) {
    this._config = config;
    this._drawnKey = undefined;
    this._render();
  }

  public set hass(hass: Hass) {
    const first = !this._hass;
    this._hass = hass;
    this._subscribe();
    if (first) this._render();
  }

  public getCardSize() {
    return 4;
  }

  public connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    this._resize ??= new ResizeObserver(() => this._draw());
    this._resize.observe(this);
    this._subscribe();
    this._render();
  }

  public disconnectedCallback() {
    this._resize?.disconnect();
    this._unsub?.();
    this._unsub = undefined;
    this._subscribedKey = undefined;
  }

  // The same energy collection the built-in energy cards use (per dashboard unless collection_key is
  // set). If no energy card has created it yet, a hidden built-in card creates it for us.
  private _collectionKey() {
    if (this._config?.collection_key) return `_${this._config.collection_key}`;
    return this._hass?.panelUrl ? `_energy_${this._hass.panelUrl}` : "_energy";
  }

  private async _subscribe() {
    if (!this._hass || !this._config || !this.isConnected) return;
    const key = this._collectionKey();
    if (this._subscribedKey === key) return;
    const collection: Collection | undefined = this._hass.connection[key];
    if (!collection) {
      await this._createCollection();
      setTimeout(() => this._subscribe(), 250);
      return;
    }
    this._unsub?.();
    this._subscribedKey = key;
    this._unsub = collection.subscribe((data) => {
      this._data = data;
      this._drawnKey = undefined;
      this._render();
    });
    this._helper?.remove();
    this._helper = undefined;
  }

  private async _createCollection() {
    if (this._helper || !this.shadowRoot) return;
    const helpers = await (window as any).loadCardHelpers?.();
    if (!helpers || this._helper) return;
    const el = helpers.createCardElement({ type: "energy-distribution", collection_key: this._config?.collection_key });
    el.style.display = "none";
    el.hass = this._hass;
    this._helper = el;
    this.shadowRoot.appendChild(el);
  }

  private _color(name: string) {
    if (!this._probe) {
      this._probe = document.createElement("span");
      this._probe.style.display = "none";
      this.shadowRoot!.appendChild(this._probe);
    }
    this._probe.style.color = `var(${name})`;
    return getComputedStyle(this._probe).color;
  }

  private _render() {
    const root = this.shadowRoot;
    if (!root || !this._config) return;
    const helper = this._helper;
    root.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);
    if (helper) root.appendChild(helper);
    this._probe = undefined;
    const card = document.createElement("ha-card") as HTMLElement & { header?: string };
    if (this._config.title) card.header = this._config.title;
    root.appendChild(card);
    if (!this._hass || !this._data) {
      const msg = document.createElement("div");
      msg.className = "message";
      msg.textContent = this._hass?.localize("ui.panel.lovelace.cards.energy.loading") || "Loading…";
      card.appendChild(msg);
      return;
    }
    const content = document.createElement("div");
    content.className = "card-content";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("diagram");
    content.appendChild(svg);
    card.appendChild(content);
    if (this._config.link_dashboard) {
      const actions = document.createElement("div");
      actions.className = "card-actions";
      const a = document.createElement("a");
      const params = new URLSearchParams({ historyBack: "1", backPath: window.location.pathname });
      a.href = `/energy?${params}`;
      a.textContent = this._hass.localize("ui.panel.lovelace.cards.energy.energy_distribution.go_to_energy_dashboard");
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        window.history.pushState(null, "", a.href);
        window.dispatchEvent(new CustomEvent("location-changed"));
      });
      actions.appendChild(a);
      card.appendChild(actions);
    }
    this._drawnKey = undefined;
    requestAnimationFrame(() => this._draw());
  }

  private _draw() {
    const svg = this.shadowRoot?.querySelector<SVGSVGElement>("svg.diagram");
    if (!svg || !this._data || !this._hass) return;
    const width = svg.getBoundingClientRect().width;
    if (!width) return;
    const key = String(Math.round(width));
    if (this._drawnKey === key) return;
    this._drawnKey = key;
    drawEnergyDistributionDiagram(svg, this._buildModel(), width);
  }

  // Same numbers and labels as the built-in energy distribution card.
  private _buildModel(): EnergyDiagramModel {
    const hass = this._hass!;
    const data = this._data!;
    const types = sourcesByType(data);
    const hasGrid = types.grid?.some((g) => g.stat_energy_from || g.stat_energy_to) ?? false;
    const hasSolar = types.solar !== undefined;
    const hasBattery = types.battery !== undefined;
    const hasGas = types.gas !== undefined;
    const hasWater = types.water !== undefined;
    const hasReturnToGrid = types.grid?.some((s) => s.stat_energy_to) ?? false;
    const precisions = (types.gas ?? [])
      .filter((s) => hass.states[s.stat_energy_from]?.attributes.unit_of_measurement === data.gasUnit)
      .map((s) => hass.entities[s.stat_energy_from]?.display_precision)
      .filter((p): p is number => p !== undefined);
    const gasPrecision = precisions.length ? Math.max(...precisions) : undefined;

    const summed = getSummedData(data);
    const consumption = computeConsumption(summed);
    const totalFromGrid = summed.total.from_grid ?? 0;
    const waterUsage = hasWater ? (sumGrowth(data.stats, types.water!.map((s) => s.stat_energy_from)) ?? 0) : null;
    const gasUsage = hasGas ? (sumGrowth(data.stats, types.gas!.map((s) => s.stat_energy_from)) ?? 0) : null;
    const totalSolar = hasSolar ? (summed.total.solar ?? 0) : null;
    const totalBatteryIn = hasBattery ? (summed.total.to_battery ?? 0) : null;
    const totalBatteryOut = hasBattery ? (summed.total.from_battery ?? 0) : null;
    const returnedToGrid = hasReturnToGrid ? (summed.total.to_grid ?? 0) : null;

    let batteryIconPath = mdiBatteryHigh;
    let soc: number | null = null;
    if (hasBattery && (!data.end || new Date(data.end).getTime() >= Date.now())) {
      const batteries = types
        .battery!.map((s) => ({ soc: s.stat_soc ? Number(hass.states[s.stat_soc]?.state) : NaN, capacity: s.capacity }))
        .filter((b) => Number.isFinite(b.soc));
      if (batteries.length) {
        const caps = batteries.map((b) => b.capacity).filter((c): c is number => c != null && c > 0);
        const mean = caps.length ? caps.reduce((a, b) => a + b, 0) / caps.length : 1;
        let wSum = 0;
        let sSum = 0;
        for (const b of batteries) {
          const c = b.capacity != null && b.capacity > 0 ? b.capacity : mean;
          wSum += c;
          sSum += b.soc * c;
        }
        soc = sSum / wSum;
        batteryIconPath = batteryIcon(soc);
      }
    }

    const solarConsumption = hasSolar ? consumption.used_solar : null;
    const batteryFromGrid = hasBattery && hasGrid ? consumption.grid_to_battery : null;
    const batteryToGrid = hasBattery && hasGrid ? consumption.battery_to_grid : null;
    const solarToGrid = hasSolar && hasGrid ? consumption.solar_to_grid : null;
    const solarToBattery = hasSolar && hasBattery ? consumption.solar_to_battery : null;
    const batteryConsumption = hasBattery ? Math.max(consumption.used_battery, 0) : null;
    const gridConsumption = hasGrid ? Math.max(consumption.used_grid, 0) : 0;
    const totalHome = Math.max(0, consumption.used_total);

    let lowCarbonEnergy: number | undefined;
    let highCarbonConsumption: number | undefined;
    let electricityMapUrl = "https://app.electricitymaps.com";
    if (hasGrid && data.co2SignalEntity && data.fossilEnergyConsumption) {
      const highCarbon = Object.values(data.fossilEnergyConsumption).reduce((s, a) => s + a, 0);
      const co2 = hass.states[data.co2SignalEntity];
      if (co2?.attributes.country_code) electricityMapUrl += `/zone/${co2.attributes.country_code}`;
      lowCarbonEnergy = totalFromGrid - highCarbon;
      highCarbonConsumption = gridConsumption !== totalFromGrid ? highCarbon * (gridConsumption / totalFromGrid) : highCarbon;
    }
    const arcs = homeCircleArcs({
      usedSolar: solarConsumption ?? 0,
      usedBattery: batteryConsumption ?? 0,
      usedGrid: gridConsumption,
      hasSolar,
      hasGrid,
      highCarbonConsumption,
    });

    const maxEnergy = Math.max(lowCarbonEnergy || 0, totalSolar || 0, returnedToGrid || 0, totalFromGrid || 0, totalHome, totalBatteryIn || 0, totalBatteryOut || 0);
    const targetUnit = formatConsumptionShort(hass.locale, maxEnergy, "kWh").split(" ").pop();
    const fmt = (v: number | null) => formatConsumptionShort(hass.locale, v, "kWh", targetUnit);
    const C = {
      solar: this._color("--energy-solar-color"),
      gridIn: this._color("--energy-grid-consumption-color"),
      gridOut: this._color("--energy-grid-return-color"),
      batIn: this._color("--energy-battery-in-color"),
      batOut: this._color("--energy-battery-out-color"),
      gas: this._color("--energy-gas-color"),
      water: this._color("--energy-water-color"),
      lowCarbon: this._color("--energy-non-fossil-color"),
      home: this._color("--primary-color"),
    };
    const localize = (key: string) => hass.localize(`ui.panel.lovelace.cards.energy.energy_distribution.${key}`);

    const nodes: EnergyDiagramNode[] = [];
    if (lowCarbonEnergy !== undefined) {
      nodes.push({ key: "lowCarbon", name: localize("low_carbon"), icon: mdiLeaf, ring: C.lowCarbon, href: electricityMapUrl, lines: [{ text: fmt(lowCarbonEnergy) }] });
    }
    if (hasSolar) nodes.push({ key: "solar", name: localize("solar"), icon: mdiSolarPower, ring: C.solar, lines: [{ text: fmt(totalSolar) }] });
    if (hasGas) {
      nodes.push({ key: "gas", name: localize("gas"), icon: mdiFire, ring: C.gas, lines: [{ text: formatConsumptionShort(hass.locale, gasUsage, data.gasUnit, undefined, gasPrecision) }] });
    }
    if (hasWater) {
      nodes.push({ key: "water", name: localize("water"), icon: mdiWater, ring: C.water, lines: [{ text: formatConsumptionShort(hass.locale, waterUsage, data.waterUnit) }] });
    }
    if (hasGrid) {
      const lines: EnergyDiagramLine[] = [];
      if (returnedToGrid !== null) lines.push({ text: `← ${fmt(returnedToGrid)}`, color: C.gridOut });
      lines.push({ text: `${hasReturnToGrid ? "→ " : ""}${fmt(totalFromGrid)}`, color: hasReturnToGrid ? C.gridIn : undefined });
      nodes.push({ key: "grid", name: localize("grid"), icon: mdiTransmissionTower, ring: C.gridIn, lines });
    }
    nodes.push({ key: "home", name: hass.config.location_name, icon: mdiHome, ring: C.home, lines: [{ text: fmt(totalHome) }] });
    if (hasBattery) {
      const socText = soc !== null ? ` · ${formatNumber(soc, hass.locale, { maximumFractionDigits: 0 })} %` : "";
      nodes.push({
        key: "battery",
        name: `${localize("battery")}${socText}`,
        icon: batteryIconPath,
        ring: C.batOut,
        lines: [
          { text: `↓ ${fmt(totalBatteryIn)}`, color: C.batIn },
          { text: `↑ ${fmt(totalBatteryOut)}`, color: C.batOut },
        ],
      });
    }

    const flow = (id: FlowId, from: EnergyNodeKey, to: EnergyNodeKey, value: number | null, c1: string, c2: string): EnergyDiagramFlow => ({
      id,
      from,
      to,
      value: hasFlow(value) ? value : 0,
      from_color: c1,
      to_color: c2,
      label: hasFlow(value) ? fmt(value) : "",
    });
    const link = (id: FlowId, from: EnergyNodeKey, to: EnergyNodeKey, c: string): EnergyDiagramFlow => ({ id, from, to, value: null, from_color: c, to_color: c, label: "" });
    const flows: EnergyDiagramFlow[] = [
      flow("sh", "solar", "home", solarConsumption, C.solar, C.solar),
      flow("gh", "grid", "home", hasGrid ? gridConsumption : null, C.gridIn, C.gridIn),
      flow("bh", "battery", "home", batteryConsumption, C.batOut, C.batOut),
      flow("sg", "solar", "grid", solarToGrid, C.solar, C.gridOut),
      flow("sb", "solar", "battery", solarToBattery, C.solar, C.batIn),
      flow("gb", "grid", "battery", batteryFromGrid, C.gridIn, C.batIn),
      flow("bg", "battery", "grid", batteryToGrid, C.batOut, C.gridOut),
    ];
    if (hasGas && gasUsage) flows.push(link("xh", "gas", "home", C.gas));
    if (hasWater && waterUsage) flows.push(link("wh", "water", "home", C.water));
    if (lowCarbonEnergy !== undefined && hasGrid) flows.push(link("lg", "lowCarbon", "grid", C.lowCarbon));

    const homeRing =
      arcs.solar !== undefined || arcs.lowCarbon !== undefined
        ? ([
            [arcs.solar, C.solar],
            [arcs.battery, C.batOut],
            [arcs.lowCarbon, C.lowCarbon],
            [arcs.grid, C.gridIn],
          ] as [number | undefined, string][])
            .filter(([v]) => v)
            .map(([v, color]) => ({ fraction: v! / HOME_CIRCUMFERENCE, color }))
        : [];

    return {
      nodes,
      flows,
      homeRing,
      homeRingColor: C.home,
      surface: this._color("--card-background-color"),
      divider: this._color("--divider-color"),
    };
  }
}

customElements.define("energy-ribbon-card", EnergyRibbonCard);
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "energy-ribbon-card",
  name: "Energy Ribbon Card",
  description: "Energy distribution with flows sized by energy, static (no animation)",
  preview: true,
});
// eslint-disable-next-line no-console
console.info(`%c ENERGY-RIBBON-CARD %c ${VERSION} `, "color:#fff;background:#ff9800;font-weight:700", "color:#ff9800");
