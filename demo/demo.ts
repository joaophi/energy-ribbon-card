import {
  mdiBattery20,
  mdiBattery50,
  mdiBattery90,
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
} from "../src/diagram";
import { drawEnergyDistributionDiagram } from "../src/diagram";
import {
  formatConsumptionShort,
  HOME_CIRCUMFERENCE,
  homeCircleArcs,
} from "../src/energy";
import pkg from "../package.json";

// Raw energy per flow (kWh) plus which sources are configured, the way the card sees a day.
interface Scenario {
  id: string; // screenshot file name
  title: string;
  note: string;
  check: string;
  grid?: boolean;
  returnToGrid?: boolean;
  solar?: boolean;
  battery?: boolean;
  soc?: number;
  gas?: number; // m³
  water?: number; // L
  lowCarbonShare?: number; // fraction of grid import that is low carbon
  location?: string;
  f: Partial<Record<"sh" | "gh" | "bh" | "sg" | "sb" | "gb" | "bg", number>>;
}

const SCENARIOS: Scenario[] = [
  {
    id: "solar-grid",
    title: "Big export, small self-use",
    note: "Solar→grid much larger than solar→home.",
    check: "Purple solar→grid ribbon stays inside the Grid circle; grid→home is straight.",
    grid: true, returnToGrid: true, solar: true,
    f: { sh: 0.6, sg: 3.17, gh: 1.7 },
  },
  {
    id: "grid-only",
    title: "Grid only",
    note: "No solar, no battery, no return meter.",
    check: "One straight ribbon, Grid shows a single value without arrows.",
    grid: true,
    f: { gh: 9.4 },
  },
  {
    id: "sunny-self-use",
    title: "Sunny day, mostly self-use",
    note: "Solar covers most of the home, small export.",
    check: "Home ring is mostly orange; the two solar ribbons turn cleanly.",
    grid: true, returnToGrid: true, solar: true,
    f: { sh: 12.8, sg: 1.4, gh: 2.1 },
  },
  {
    id: "solar-grid-battery",
    title: "Solar, grid and battery, all seven flows",
    note: "Every electric flow is non-zero, so the middle gets the combined badge.",
    check: "Pills don't overlap ribbons or circles; badge sits where grid→home crosses solar→battery.",
    grid: true, returnToGrid: true, solar: true, battery: true, soc: 64,
    f: { sh: 6.2, sg: 2.4, sb: 4.1, gh: 3.3, gb: 1.2, bg: 0.8, bh: 3.9 },
  },
  {
    id: "battery-night",
    title: "Night shift: battery and grid, no solar",
    note: "Battery charged off-peak from the grid, drained into the home.",
    check: "Grid→battery and battery→home turn without crossing the circles.",
    grid: true, returnToGrid: true, battery: true, soc: 18,
    f: { gh: 4.6, gb: 5.5, bh: 4.9, bg: 0.3 },
  },
  {
    id: "through-grid-home",
    title: "Through-line stress: grid→home",
    note: "Large solar→grid above it on Grid and large battery→home below it on Home.",
    check: "Everything on Grid's right side and Home's left side stays inside the circles.",
    grid: true, returnToGrid: true, solar: true, battery: true, soc: 47,
    f: { sh: 0.4, sg: 7.5, gh: 6.8, bh: 7.1, sb: 0.5 },
  },
  {
    id: "through-solar-battery",
    title: "Through-line stress: solar→battery",
    note: "Big solar→battery with big solar→home on one side and battery→grid/grid→battery on the other.",
    check: "Solar's bottom and battery's top bundles stay inside; solar→battery is straight.",
    grid: true, returnToGrid: true, solar: true, battery: true, soc: 92,
    f: { sh: 8.2, sg: 0.3, sb: 9.6, gh: 0.9, gb: 4.4, bg: 3.8, bh: 0.6 },
  },
  {
    id: "everything",
    title: "Everything configured",
    note: "Low carbon, solar, gas, water, grid, home and battery all present.",
    check: "Seven circles; gas sits top right, water bottom right, Home's name moves beside it.",
    grid: true, returnToGrid: true, solar: true, battery: true, soc: 71,
    gas: 1.84, water: 412, lowCarbonShare: 0.62, location: "Casa",
    f: { sh: 5.1, sg: 1.9, sb: 2.7, gh: 4.2, gb: 0.6, bg: 0.4, bh: 2.3 },
  },
  {
    id: "gas-water",
    title: "Gas and water, no solar",
    note: "Utility-only house.",
    check: "Gas and water links are thin plain lines into Home, not sized ribbons.",
    grid: true, gas: 3.27, water: 286,
    f: { gh: 11.3 },
  },
  {
    id: "water-no-gas",
    title: "Water without gas",
    note: "Water moves to the top row when there's no gas.",
    check: "Water circle top right, line runs down into Home.",
    grid: true, returnToGrid: true, solar: true, water: 158,
    f: { sh: 3.4, sg: 0.9, gh: 5.6 },
  },
  {
    id: "low-carbon",
    title: "Low carbon grid with solar",
    note: "Electricity Maps share shown as its own circle above Grid.",
    check: "Green link into Grid; Home ring has a green low-carbon slice.",
    grid: true, returnToGrid: true, solar: true, lowCarbonShare: 0.85,
    f: { sh: 4.0, sg: 0.5, gh: 7.2 },
  },
  {
    id: "tiny-and-huge",
    title: "Tiny next to huge",
    note: "One flow is 1000× smaller than the others.",
    check: "The tiny flows still draw as thin 2px ribbons with a visible chevron.",
    grid: true, returnToGrid: true, solar: true, battery: true, soc: 55,
    f: { sh: 24.0, sg: 0.02, gh: 18.5, sb: 0.03, bh: 0.01 },
  },
  {
    id: "mwh",
    title: "Big numbers (MWh)",
    note: "A month on a bigger install switches units.",
    check: "Values read in MWh; the two-line Grid and Battery values still fit in their circles.",
    grid: true, returnToGrid: true, solar: true, battery: true, soc: 33,
    f: { sh: 412, sg: 1260, sb: 380, gh: 905, gb: 120, bg: 95, bh: 410 },
  },
  {
    id: "all-zero",
    title: "Nothing happened yet",
    note: "Just after midnight: every flow is zero.",
    check: "Circles show 0 kWh and no ribbons; nothing crashes.",
    grid: true, returnToGrid: true, solar: true, battery: true, soc: 100,
    f: {},
  },
];

const params = new URLSearchParams(location.search);
const EN = params.get("lang") !== "pt";
const SHOT = params.get("shot"); // comma-separated scenario numbers, diagram-only cards for screenshots
const locale = { language: EN ? "en" : "pt-BR", number_format: "language" } as any;
const T = EN
  ? { lowCarbon: "Low-carbon", solar: "Solar", gas: "Gas", water: "Water", grid: "Grid", home: "Home", battery: "Battery" }
  : { lowCarbon: "Baixo carbono", solar: "Solar", gas: "Gás", water: "Água", grid: "Rede", home: "Casa", battery: "Bateria" };

const tok = (el: Element, name: string) =>
  getComputedStyle(el).getPropertyValue(name).trim();

const buildModel = (s: Scenario, host: Element): EnergyDiagramModel => {
  const C = {
    solar: tok(host, "--energy-solar-color"),
    gridIn: tok(host, "--energy-grid-consumption-color"),
    gridOut: tok(host, "--energy-grid-return-color"),
    batIn: tok(host, "--energy-battery-in-color"),
    batOut: tok(host, "--energy-battery-out-color"),
    gas: tok(host, "--energy-gas-color"),
    water: tok(host, "--energy-water-color"),
    lowCarbon: tok(host, "--energy-non-fossil-color"),
    home: tok(host, "--ha-primary"),
  };
  const v = (k: keyof Scenario["f"]) => s.f[k] ?? 0;
  const totalSolar = v("sh") + v("sg") + v("sb");
  const fromGrid = v("gh") + v("gb");
  const toGrid = v("sg") + v("bg");
  const batIn = v("sb") + v("gb");
  const batOut = v("bh") + v("bg");
  const home = v("sh") + v("gh") + v("bh");
  const lowCarbon =
    s.lowCarbonShare !== undefined ? fromGrid * s.lowCarbonShare : undefined;
  const highCarbonUsed =
    lowCarbon !== undefined ? v("gh") * (1 - s.lowCarbonShare!) : undefined;

  const maxEnergy = Math.max(lowCarbon ?? 0, totalSolar, toGrid, fromGrid, home, batIn, batOut);
  const unit = formatConsumptionShort(locale, maxEnergy, "kWh").split(" ").pop();
  const fmt = (x: number | null) => formatConsumptionShort(locale, x, "kWh", unit);

  const nodes: EnergyDiagramNode[] = [];
  if (lowCarbon !== undefined)
    nodes.push({ key: "lowCarbon", name: T.lowCarbon, icon: mdiLeaf, ring: C.lowCarbon, lines: [{ text: fmt(lowCarbon) }] });
  if (s.solar) nodes.push({ key: "solar", name: T.solar, icon: mdiSolarPower, ring: C.solar, lines: [{ text: fmt(totalSolar) }] });
  if (s.gas !== undefined)
    nodes.push({ key: "gas", name: T.gas, icon: mdiFire, ring: C.gas, lines: [{ text: formatConsumptionShort(locale, s.gas, "m³") }] });
  if (s.water !== undefined)
    nodes.push({ key: "water", name: T.water, icon: mdiWater, ring: C.water, lines: [{ text: formatConsumptionShort(locale, s.water, "L") }] });
  if (s.grid) {
    const lines: EnergyDiagramLine[] = [];
    if (s.returnToGrid) lines.push({ text: `← ${fmt(toGrid)}`, color: C.gridOut });
    lines.push({ text: `${s.returnToGrid ? "→ " : ""}${fmt(fromGrid)}`, color: s.returnToGrid ? C.gridIn : undefined });
    nodes.push({ key: "grid", name: T.grid, icon: mdiTransmissionTower, ring: C.gridIn, lines });
  }
  nodes.push({ key: "home", name: EN ? T.home : (s.location ?? T.home), icon: mdiHome, ring: C.home, lines: [{ text: fmt(home) }] });
  if (s.battery) {
    const soc = s.soc ?? 50;
    nodes.push({
      key: "battery",
      name: `${T.battery} · ${soc} %`,
      icon: soc > 80 ? mdiBattery90 : soc > 35 ? mdiBattery50 : mdiBattery20,
      ring: C.batOut,
      lines: [
        { text: `↓ ${fmt(batIn)}`, color: C.batIn },
        { text: `↑ ${fmt(batOut)}`, color: C.batOut },
      ],
    });
  }

  const flow = (id: FlowId, from: EnergyNodeKey, to: EnergyNodeKey, c1: string, c2: string): EnergyDiagramFlow => {
    const x = v(id as keyof Scenario["f"]);
    return { id, from, to, value: x > 0 ? x : 0, from_color: c1, to_color: c2, label: x > 0 ? fmt(x) : "" };
  };
  const link = (id: FlowId, from: EnergyNodeKey, to: EnergyNodeKey, c: string): EnergyDiagramFlow =>
    ({ id, from, to, value: null, from_color: c, to_color: c, label: "" });
  const flows: EnergyDiagramFlow[] = [
    flow("sh", "solar", "home", C.solar, C.solar),
    flow("gh", "grid", "home", C.gridIn, C.gridIn),
    flow("bh", "battery", "home", C.batOut, C.batOut),
    flow("sg", "solar", "grid", C.solar, C.gridOut),
    flow("sb", "solar", "battery", C.solar, C.batIn),
    flow("gb", "grid", "battery", C.gridIn, C.batIn),
    flow("bg", "battery", "grid", C.batOut, C.gridOut),
  ];
  if (s.gas) flows.push(link("xh", "gas", "home", C.gas));
  if (s.water) flows.push(link("wh", "water", "home", C.water));
  if (lowCarbon !== undefined) flows.push(link("lg", "lowCarbon", "grid", C.lowCarbon));

  const arcs = homeCircleArcs({
    usedSolar: v("sh"),
    usedBattery: v("bh"),
    usedGrid: v("gh"),
    hasSolar: !!s.solar,
    hasGrid: !!s.grid,
    highCarbonConsumption: highCarbonUsed,
  });
  const homeRing =
    arcs.solar !== undefined || arcs.lowCarbon !== undefined
      ? ([
          [arcs.solar, C.solar],
          [arcs.battery, C.batOut],
          [arcs.lowCarbon, C.lowCarbon],
          [arcs.grid, C.gridIn],
        ] as [number | undefined, string][])
          .filter(([x]) => x)
          .map(([x, color]) => ({ fraction: x! / HOME_CIRCUMFERENCE, color }))
      : [];

  return {
    nodes,
    flows,
    homeRing,
    homeRingColor: C.home,
    surface: tok(host, "--ha-card"),
    divider: tok(host, "--ha-divider"),
  };
};

document.getElementById("version")!.textContent = `v${pkg.version}`;
const grid = document.getElementById("cards")!;
const draws: (() => void)[] = [];
if (SHOT) document.documentElement.classList.add("shot");
if (params.get("w")) document.documentElement.style.setProperty("--card-w", `${params.get("w")}px`);
SCENARIOS.forEach((s, i) => {
  if (SHOT && SHOT !== "all" && !SHOT.split(",").includes(String(i + 1))) return;
  const card = document.createElement("article");
  card.className = "ha-card";
  card.id = `s${i + 1}`;
  card.dataset.slug = s.id;
  card.innerHTML = `
    <header><span class="num">${String(i + 1).padStart(2, "0")}</span><h2></h2></header>
    <p class="note"></p>
    <div class="frame"><svg class="diagram" role="img"></svg></div>
    <p class="check"><span>Look for</span> </p>`;
  card.querySelector("h2")!.textContent = s.title;
  card.querySelector(".note")!.textContent = s.note;
  card.querySelector(".check")!.append(s.check);
  card.querySelector("svg")!.setAttribute("aria-label", s.title);
  grid.appendChild(card);
  const svg = card.querySelector<SVGSVGElement>("svg")!;
  let last = "";
  const draw = (force = false) => {
    const w = Math.round(svg.getBoundingClientRect().width);
    if (!w || (!force && String(w) === last)) return;
    last = String(w);
    drawEnergyDistributionDiagram(svg, buildModel(s, card), w);
  };
  draws.push(() => draw(true));
  new ResizeObserver(() => draw()).observe(svg);
});

const widths = document.getElementById("width") as HTMLSelectElement;
widths.addEventListener("change", () => {
  document.documentElement.style.setProperty("--card-w", widths.value);
});
// colours are read from tokens at draw time, so redraw when the theme flips
const redraw = () => requestAnimationFrame(() => draws.forEach((d) => d()));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
