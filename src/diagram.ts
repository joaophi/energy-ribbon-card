// Static energy distribution diagram: circles for each source/consumer, ribbons whose thickness follows
// the energy they carry, one chevron per ribbon for direction, and value pills only on flows that
// can't be read off the circles. Nothing animates, so the card draws no frames while idle.

export type EnergyNodeKey =
  "solar" | "grid" | "home" | "battery" | "gas" | "water" | "lowCarbon";

export interface EnergyDiagramLine {
  text: string;
  color?: string;
}

export interface EnergyDiagramNode {
  key: EnergyNodeKey;
  name: string;
  icon: string;
  /** Text lines inside the circle. */
  lines: EnergyDiagramLine[];
  ring: string;
  href?: string;
}

export interface EnergyDiagramFlow {
  id: FlowId;
  from: EnergyNodeKey;
  to: EnergyNodeKey;
  /** Energy in the card's unit; null for links shown without a size (gas, water, low carbon). */
  value: number | null;
  /** Colour at the source and at the destination end. */
  from_color: string;
  to_color: string;
  /** Text for the value pill. */
  label: string;
}

export interface EnergyDiagramModel {
  nodes: EnergyDiagramNode[];
  flows: EnergyDiagramFlow[];
  /** Home ring segments, as fractions of the full circle, in drawing order. */
  homeRing: { fraction: number; color: string }[];
  homeRingColor: string;
  /** Resolved colours for pill/badge backgrounds and borders. */
  surface: string;
  divider: string;
}

export type FlowId =
  | "sh" // solar -> home
  | "gh" // grid -> home
  | "bh" // battery -> home
  | "sg" // solar -> grid
  | "sb" // solar -> battery
  | "gb" // grid -> battery
  | "bg" // battery -> grid
  | "xh" // gas -> home
  | "wh" // water -> home
  | "lg"; // low carbon -> grid (plain link)

const R = 40; // circle radius
const ROW = 128; // distance between rows
const LABEL = 20; // room for a name label above/below a circle
const GAP = 3; // between ribbons sharing a circle side
const FIT = 72; // widest bundle on a circle side (circle is 80)
const EDGE = R + 8;
const KMAX = 12; // largest chevron
const KEEP = EDGE + 2 * 8 + 4; // straight length kept at each end of a turn
const PH = 20; // pill height
const NS = "http://www.w3.org/2000/svg";

// Ribbons on each circle side, in order along that side.
const SIDES: Partial<
  Record<EnergyNodeKey, { axis: "x" | "y"; ids: FlowId[] }>
> = {
  solar: { axis: "x", ids: ["sg", "sb", "sh"] }, // bottom of solar, left -> right
  grid: { axis: "y", ids: ["sg", "gh", "gb", "bg"] }, // right of grid, top -> bottom
  home: { axis: "y", ids: ["sh", "gh", "bh"] }, // left of home, top -> bottom
  battery: { axis: "x", ids: ["bg", "gb", "sb", "bh"] }, // top of battery, left -> right
};

interface Pt {
  x: number;
  y: number;
}
interface Sample extends Pt {
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}
interface Ribbon {
  flow: EnergyDiagramFlow;
  width: number;
  k: number; // chevron size
  pts: Sample[]; // 1px samples with tangent/normal
  a: Pt; // path start
  b: Pt; // path end
  chevron: number | null;
  pill: Pt | null;
}

const el = <K extends keyof SVGElementTagNameMap>(
  parent: Element,
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, String(v));
  }
  parent.appendChild(e);
  return e;
};

const parseColor = (c: string): [number, number, number] => {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(/[ ,/]+/).map(Number);
    return [r, g, b];
  }
  const hex = c.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
};

// Colour of a ribbon at gradient position t (stops at 0.25 and 0.75, like its paint).
const colorAt = (flow: EnergyDiagramFlow, t: number): string => {
  const u = Math.min(1, Math.max(0, (t - 0.25) / 0.5));
  const a = parseColor(flow.from_color);
  const b = parseColor(flow.to_color);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(",")})`;
};

export const drawEnergyDistributionDiagram = (
  svg: SVGSVGElement,
  model: EnergyDiagramModel,
  width: number
): void => {
  svg.replaceChildren();
  const has = (k: EnergyNodeKey) => model.nodes.some((n) => n.key === k);

  // --- layout -------------------------------------------------------------------------------
  const xL = R + 2;
  const xR = width - R - 2;
  const xC = (xL + xR) / 2;
  const topRow =
    has("solar") ||
    has("gas") ||
    has("lowCarbon") ||
    (has("water") && !has("gas"));
  const bottomRow = has("battery") || (has("gas") && has("water"));
  const yT = LABEL + R;
  const yM = topRow ? yT + ROW : R + 2;
  const yB = yM + ROW;
  const height = (bottomRow ? yB : yM) + R + LABEL + 4;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("height", String(height));
  const P: Record<EnergyNodeKey, Pt> = {
    solar: { x: xC, y: yT },
    lowCarbon: { x: xL, y: yT },
    gas: { x: xR, y: yT },
    water: has("gas") ? { x: xR, y: yB } : { x: xR, y: yT },
    grid: { x: xL, y: yM },
    home: { x: xR, y: yM },
    battery: { x: xC, y: yB },
  };
  const defs = el(svg, "defs");
  let uid = 0;
  const id = (p: string) =>
    `${p}${uid++}-${Math.random().toString(36).slice(2, 7)}`;

  const live = model.flows.filter((f) => f.value === null || f.value > 0);
  const val: Partial<Record<FlowId, number>> = {};
  for (const f of live) {
    if (f.value) {
      val[f.id] = f.value;
    }
  }

  // Ribbon widths: one px-per-unit scale so the busiest circle side fits inside the circle.
  const sides = Object.entries(SIDES).filter(([k]) =>
    has(k as EnergyNodeKey)
  ) as [EnergyNodeKey, { axis: "x" | "y"; ids: FlowId[] }][];
  const scales = sides
    .map(([, sd]) => {
      const ids = sd.ids.filter((i) => val[i]);
      const sum = ids.reduce((a, i) => a + val[i]!, 0);
      return sum > 0 ? (FIT - GAP * (ids.length - 1)) / sum : Infinity;
    })
    .filter((s) => Number.isFinite(s));
  const scale = scales.length ? Math.min(...scales) : 1;
  const w: Partial<Record<FlowId, number>> = {};
  for (const f of live) {
    w[f.id] =
      f.value === null ? (f.id === "lg" ? 2 : 6) : Math.max(2, f.value * scale);
  }

  // Bundles centred on each circle side; straight through-lines (grid->home, solar->battery) sit
  // halfway between their two ideal positions so they stay straight, neighbours stacked beside them.
  const pos: Partial<Record<EnergyNodeKey, Partial<Record<FlowId, number>>>> =
    {};
  const restack = (
    k: EnergyNodeKey,
    ids: FlowId[],
    pinned?: FlowId,
    at?: number
  ) => {
    const p: Partial<Record<FlowId, number>> = {};
    if (pinned && at !== undefined && ids.includes(pinned)) {
      const iP = ids.indexOf(pinned);
      p[pinned] = at;
      let c = at - w[pinned]! / 2;
      for (let i = iP - 1; i >= 0; i--) {
        p[ids[i]] = c - GAP - w[ids[i]]! / 2;
        c -= GAP + w[ids[i]]!;
      }
      c = at + w[pinned]! / 2;
      for (let i = iP + 1; i < ids.length; i++) {
        p[ids[i]] = c + GAP + w[ids[i]]! / 2;
        c += GAP + w[ids[i]]!;
      }
    } else {
      const tot =
        ids.reduce((a, i) => a + w[i]!, 0) + GAP * Math.max(0, ids.length - 1);
      let c = (SIDES[k]!.axis === "x" ? P[k].x : P[k].y) - tot / 2;
      for (const i of ids) {
        p[i] = c + w[i]! / 2;
        c += w[i]! + GAP;
      }
    }
    pos[k] = p;
  };
  for (const [k, sd] of sides) {
    restack(
      k,
      sd.ids.filter((i) => w[i])
    );
  }
  const pin = (fid: FlowId, a: EnergyNodeKey, b: EnergyNodeKey) => {
    const pa = pos[a]?.[fid];
    const pb = pos[b]?.[fid];
    if (pa === undefined || pb === undefined) {
      return;
    }
    const c = (pa + pb) / 2;
    restack(
      a,
      SIDES[a]!.ids.filter((i) => w[i]),
      fid,
      c
    );
    restack(
      b,
      SIDES[b]!.ids.filter((i) => w[i]),
      fid,
      c
    );
  };
  pin("gh", "grid", "home");
  pin("sb", "solar", "battery");

  // Quarter turns as circular arcs, as wide as the corner allows.
  const turn = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    first: "v" | "h"
  ) => {
    const sx = Math.sign(x1 - x0);
    const sy = Math.sign(y1 - y0);
    const r = Math.max(
      6,
      Math.min(Math.abs(x1 - x0) - KEEP, Math.abs(y1 - y0) - KEEP)
    );
    if (first === "v") {
      return `M${x0},${y0} V${y1 - sy * r} A${r},${r} 0 0 ${-sx * sy > 0 ? 1 : 0} ${x0 + sx * r},${y1} H${x1}`;
    }
    return `M${x0},${y0} H${x1 - sx * r} A${r},${r} 0 0 ${sx * sy > 0 ? 1 : 0} ${x1},${y0 + sy * r} V${y1}`;
  };
  const d: Partial<Record<FlowId, string>> = {};
  if (w.sg) {
    d.sg = turn(pos.solar!.sg!, P.solar.y, P.grid.x, pos.grid!.sg!, "v");
  }
  if (w.sh) {
    d.sh = turn(pos.solar!.sh!, P.solar.y, P.home.x, pos.home!.sh!, "v");
  }
  if (w.gh) d.gh = `M${P.grid.x},${pos.grid!.gh} H${P.home.x}`;
  if (w.sb) d.sb = `M${pos.solar!.sb},${P.solar.y} V${P.battery.y}`;
  if (w.gb) {
    d.gb = turn(P.grid.x, pos.grid!.gb!, pos.battery!.gb!, P.battery.y, "h");
  }
  if (w.bg) {
    d.bg = turn(pos.battery!.bg!, P.battery.y, P.grid.x, pos.grid!.bg!, "v");
  }
  if (w.bh) {
    d.bh = turn(pos.battery!.bh!, P.battery.y, P.home.x, pos.home!.bh!, "v");
  }
  if (w.xh) d.xh = `M${P.home.x},${P.gas.y} V${P.home.y}`;
  if (w.wh) d.wh = `M${P.home.x},${P.water.y} V${P.home.y}`;
  if (w.lg) d.lg = `M${P.lowCarbon.x},${P.lowCarbon.y} V${P.grid.y}`;

  // --- ribbons --------------------------------------------------------------------------------
  const ribbons: Ribbon[] = [];
  for (const f of live) {
    const path = d[f.id];
    if (!path) continue;
    const probe = el(svg, "path", { d: path });
    const len = probe.getTotalLength();
    const at = (l: number) =>
      probe.getPointAtLength(Math.max(0, Math.min(len, l)));
    const pts: Sample[] = [];
    for (let l = 0; l <= len; l += 1) {
      const q = at(l);
      const q2 = at(l + 0.5);
      const q0 = at(l - 0.5);
      const dx = q2.x - q0.x;
      const dy = q2.y - q0.y;
      const n = Math.hypot(dx, dy) || 1;
      pts.push({
        x: q.x,
        y: q.y,
        tx: dx / n,
        ty: dy / n,
        nx: -dy / n,
        ny: dx / n,
      });
    }
    probe.remove();
    const a = at(0);
    const b = at(len);
    const g = id("g");
    const grad = el(defs, "linearGradient", {
      id: g,
      gradientUnits: "userSpaceOnUse",
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    });
    el(grad, "stop", { offset: 0.25, "stop-color": f.from_color });
    el(grad, "stop", { offset: 0.75, "stop-color": f.to_color });
    const width_ = w[f.id]!;
    if (f.id === "lg") {
      el(svg, "path", {
        d: path,
        fill: "none",
        stroke: f.from_color,
        "stroke-width": width_,
      });
    } else {
      el(svg, "path", {
        d: path,
        fill: "none",
        stroke: `url(#${g})`,
        "stroke-opacity": 0.45,
        "stroke-width": width_,
      });
      el(svg, "path", {
        d: path,
        fill: "none",
        stroke: `url(#${g})`,
        "stroke-opacity": 0.9,
        "stroke-width": Math.max(2, width_ * 0.3),
      });
    }
    ribbons.push({
      flow: f,
      width: width_,
      k: Math.max(4, Math.min(KMAX, width_ * 0.5)),
      pts,
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      chevron: null,
      pill: null,
    });
  }
  const rib = (fid: FlowId) => ribbons.find((r) => r.flow.id === fid);
  const nodesXY = model.nodes.map((n) => P[n.key]);
  const nearCircle = (q: Pt, pad: number) =>
    nodesXY.some((c) => Math.hypot(q.x - c.x, q.y - c.y) < R + pad);
  const isStraight = (r: Ribbon, i: number) => {
    const a = r.pts[Math.max(0, i - 3)];
    const b = r.pts[Math.min(r.pts.length - 1, i + 3)];
    return Math.abs(a.tx * b.ty - a.ty * b.tx) < 0.01;
  };
  const arcMid = (r: Ribbon) => {
    let best = -1;
    let err = 1;
    r.pts.forEach((q, i) => {
      const e = Math.abs(Math.abs(q.tx) - Math.abs(q.ty));
      if (e < err) {
        err = e;
        best = i;
      }
    });
    return err < 0.2 ? best : null;
  };

  // --- pills: only where the value can't be read off a circle ---------------------------------
  const sized = live.filter((f) => f.value);
  const outs = (k: EnergyNodeKey) => sized.filter((f) => f.from === k).length;
  const ins = (k: EnergyNodeKey) => sized.filter((f) => f.to === k).length;
  const needsPill = (f: EnergyDiagramFlow) =>
    !!f.value && f.id !== "lg" && outs(f.from) > 1 && ins(f.to) > 1;
  const pillRibbons = ribbons
    .filter((r) => needsPill(r.flow))
    .sort((x, y) => (y.flow.value ?? 0) - (x.flow.value ?? 0));
  const PW = Math.max(
    0,
    ...pillRibbons.map((r) => r.flow.label.length * 6.3 + 14)
  );
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const rectFree = (q: Pt) =>
    placed.every(
      (c) =>
        Math.abs(q.x - c.x) > (c.w + PW) / 2 + 4 ||
        Math.abs(q.y - c.y) > (c.h + PH) / 2 + 3
    ) &&
    nodesXY.every(
      (c) =>
        Math.hypot(
          Math.max(Math.abs(q.x - c.x) - PW / 2, 0),
          Math.max(Math.abs(q.y - c.y) - PH / 2, 0)
        ) >
        R + 2
    );
  const hitsRibbon = (c: Pt) =>
    ribbons.some((o) =>
      o.pts.some(
        (p, j) =>
          j % 3 === 0 &&
          Math.abs(p.x - c.x) < PW / 2 + o.width / 2 + 2 &&
          Math.abs(p.y - c.y) < PH / 2 + o.width / 2 + 2
      )
    );
  const place = (r: Ribbon, q: Pt) => {
    r.pill = { x: q.x, y: q.y };
    placed.push({ x: q.x, y: q.y, w: PW, h: PH });
  };
  // grid->home and solar->battery cross in the middle: one combined badge there instead of two pills
  const GH = rib("gh");
  const SB = rib("sb");
  const badge =
    GH && SB && needsPill(GH.flow) && needsPill(SB.flow)
      ? { x: pos.solar!.sb!, y: pos.grid!.gh!, w: PW + 12, h: 38 }
      : null;
  if (badge) placed.push(badge);
  const guides = (to: EnergyNodeKey) => {
    const out: { axis: "x" | "y"; v: number }[] = [];
    for (let j = 0; j < 4; j++) {
      if (to === "home") {
        out.push({
          axis: "x",
          v: P.home.x - EDGE - 2 * KMAX - 6 - PW / 2 - j * (PW + 10),
        });
      } else if (to === "grid") {
        out.push({
          axis: "x",
          v: P.grid.x + EDGE + 2 * KMAX + 6 + PW / 2 + j * (PW + 10),
        });
      } else if (to === "battery") {
        out.push({
          axis: "y",
          v: P.battery.y - EDGE - 2 * KMAX - 6 - PH / 2 - j * (PH + 8),
        });
      }
    }
    return out;
  };
  for (const r of pillRibbons) {
    if (badge && (r === GH || r === SB)) continue;
    if (r.flow.id === "sb") {
      // the vertical through-line: in the middle, slid along its line until it fits
      let best = 0;
      r.pts.forEach((q, i) => {
        if (Math.abs(q.y - P.grid.y) < Math.abs(r.pts[best].y - P.grid.y)) {
          best = i;
        }
      });
      for (let dd = 0; dd < r.pts.length && !r.pill; dd++) {
        for (const i of [best - dd, best + dd]) {
          if (i >= 0 && i < r.pts.length && rectFree(r.pts[i])) {
            place(r, r.pts[i]);
            break;
          }
        }
      }
      if (r.pill) continue;
    }
    if (["sg", "sh", "gb", "bg", "bh"].includes(r.flow.id)) {
      // inside the bend: from the arc's middle, toward the centre of curvature until it clears
      const m = arcMid(r);
      if (m !== null) {
        const q = r.pts[m];
        const qa = r.pts[Math.max(0, m - 6)];
        const qb = r.pts[Math.min(r.pts.length - 1, m + 6)];
        let ux = qb.tx - qa.tx;
        let uy = qb.ty - qa.ty;
        const n = Math.hypot(ux, uy) || 1;
        ux /= n;
        uy /= n;
        for (let off = r.width / 2 + 6; off < 90; off += 3) {
          const ext = off + (Math.abs(ux) * PW) / 2 + (Math.abs(uy) * PH) / 2;
          const c = { x: q.x + ux * ext, y: q.y + uy * ext };
          if (!hitsRibbon(c) && rectFree(c)) {
            place(r, c);
            break;
          }
        }
        if (r.pill) continue;
      }
    }
    for (const g of guides(r.flow.to)) {
      const i = r.pts.findIndex((q) =>
        g.axis === "x"
          ? Math.abs(q.ty) < 0.05 && Math.abs(q.x - g.v) < 1
          : Math.abs(q.tx) < 0.05 && Math.abs(q.y - g.v) < 1
      );
      if (i >= 0 && rectFree(r.pts[i])) {
        place(r, r.pts[i]);
        break;
      }
    }
    if (r.pill) continue;
    for (let i = r.pts.length - 1; i >= 0; i--) {
      const q = r.pts[i];
      if ((Math.abs(q.tx) < 0.05 || Math.abs(q.ty) < 0.05) && rectFree(q)) {
        place(r, q);
        break;
      }
    }
  }
  // pills in mirrored bends line up (same height, mirrored around the centre line)
  for (const [ia, ib, cx] of [
    ["sg", "sh", P.solar.x],
    ["gb", "bh", P.battery.x],
  ] as [FlowId, FlowId, number][]) {
    const A = rib(ia);
    const B = rib(ib);
    if (!A?.pill || !B?.pill || ![A, B].every((x) => arcMid(x) !== null)) {
      continue;
    }
    const others = placed.filter(
      (c) =>
        !(c.x === A.pill!.x && c.y === A.pill!.y) &&
        !(c.x === B.pill!.x && c.y === B.pill!.y)
    );
    const freeOf = (c: Pt) =>
      !hitsRibbon(c) &&
      others.every(
        (o) =>
          Math.abs(c.x - o.x) > (o.w + PW) / 2 + 4 ||
          Math.abs(c.y - o.y) > (o.h + PH) / 2 + 3
      ) &&
      nodesXY.every(
        (n) =>
          Math.hypot(
            Math.max(Math.abs(c.x - n.x) - PW / 2, 0),
            Math.max(Math.abs(c.y - n.y) - PH / 2, 0)
          ) >
          R + 2
      );
    const dxs = [Math.abs(A.pill.x - cx), Math.abs(B.pill.x - cx)].sort(
      (x, y) => y - x
    );
    const ys = [A.pill.y, B.pill.y, (A.pill.y + B.pill.y) / 2];
    let done = false;
    for (const dx of [...dxs, ...[6, 12, 18, 24].map((e) => dxs[0] + e)]) {
      for (const y of ys) {
        const ca = { x: cx - dx * (Math.sign(cx - A.pill.x) || 1), y };
        const cb = { x: cx + dx * (Math.sign(B.pill.x - cx) || 1), y };
        if (freeOf(ca) && freeOf(cb)) {
          for (const [r, c] of [
            [A, ca],
            [B, cb],
          ] as [Ribbon, Pt][]) {
            const o = placed.find(
              (p) => p.x === r.pill!.x && p.y === r.pill!.y
            );
            if (o) {
              o.x = c.x;
              o.y = c.y;
            }
            r.pill = c;
          }
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }

  // --- chevrons: one per ribbon ----------------------------------------------------------------
  const pillRects = () => [
    ...ribbons.filter((r) => r.pill).map((r) => ({ ...r.pill!, w: PW, h: PH })),
    ...(badge ? [badge] : []),
  ];
  const clearSpot = (r: Ribbon, i: number) => {
    const q = r.pts[i];
    if (
      pillRects().some(
        (c) =>
          Math.abs(q.x - c.x) < c.w / 2 + r.k * 0.8 &&
          Math.abs(q.y - c.y) < c.h / 2 + r.k * 0.8
      )
    ) {
      return false;
    }
    if (nearCircle(q, r.k + 1)) return false;
    return !ribbons.some(
      (o) =>
        o !== r &&
        o.pts.some(
          (p, j) =>
            j % 2 === 0 &&
            Math.hypot(p.x - q.x, p.y - q.y) < o.width / 2 + r.k &&
            Math.abs(p.tx * q.ty - p.ty * q.tx) > 0.5
        )
    );
  };
  for (const r of ribbons) {
    if (r.flow.id === "lg") continue;
    const n = r.pts.length;
    const curved = r.pts.some(
      (_, i) => i > 3 && i < n - 4 && !isStraight(r, i)
    );
    if (curved) {
      r.chevron = arcMid(r);
    }
    if (r.chevron === null) {
      const vis = r.pts
        .map((_, i) => i)
        .filter((i) => !nearCircle(r.pts[i], r.k + 4));
      const mid = vis.length
        ? vis[Math.floor(vis.length / 2)]
        : Math.floor(n / 2);
      for (let dd = 0; dd < n && r.chevron === null; dd++) {
        for (const i of [mid - dd, mid + dd]) {
          if (i >= 0 && i < n && clearSpot(r, i)) {
            r.chevron = i;
            break;
          }
        }
      }
      if (r.chevron === null) r.chevron = mid;
    }
  }
  // chevrons on mirrored curves share a height
  for (const [ia, ib] of [
    ["sg", "sh"],
    ["gb", "bh"],
  ] as [FlowId, FlowId][]) {
    const A = rib(ia);
    const B = rib(ib);
    if (A?.chevron == null || B?.chevron == null) continue;
    const y = (A.pts[A.chevron].y + B.pts[B.chevron].y) / 2;
    for (const r of [A, B]) {
      let best = r.chevron!;
      r.pts.forEach((q, i) => {
        if (
          !isStraight(r, i) &&
          Math.abs(q.y - y) < Math.abs(r.pts[best].y - y)
        ) {
          best = i;
        }
      });
      r.chevron = best;
    }
  }
  // straight through-lines: just past the crossing, lined up with the curve chevrons
  {
    const chevAt = (fid: FlowId) => {
      const r = rib(fid);
      return r?.chevron != null ? r.pts[r.chevron] : null;
    };
    const avg = (v: number[]) =>
      v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    const crossX = SB ? pos.solar!.sb! : P.solar.x;
    const crossY = GH ? pos.grid!.gh! : P.grid.y;
    if (GH) {
      let x =
        avg(
          (["sh", "bh"] as FlowId[])
            .map(chevAt)
            .filter((q): q is Sample => !!q)
            .map((q) => q.x)
        ) ?? (crossX + P.home.x - R) / 2;
      x = Math.max(
        x,
        (SB ? crossX + (badge ? badge.w / 2 : SB.width / 2) : P.grid.x + EDGE) +
          GH.k +
          6
      );
      let best = 0;
      GH.pts.forEach((q, i) => {
        if (Math.abs(q.x - x) < Math.abs(GH.pts[best].x - x)) best = i;
      });
      GH.chevron = best;
    }
    if (SB) {
      let y =
        avg(
          (["gb", "bh"] as FlowId[])
            .map(chevAt)
            .filter((q): q is Sample => !!q)
            .map((q) => q.y)
        ) ?? (crossY + P.battery.y - R) / 2;
      y = Math.max(
        y,
        (GH
          ? crossY + (badge ? badge.h / 2 : GH.width / 2)
          : P.solar.y + EDGE) +
          SB.k +
          6
      );
      let best = 0;
      SB.pts.forEach((q, i) => {
        if (Math.abs(q.y - y) < Math.abs(SB.pts[best].y - y)) best = i;
      });
      SB.chevron = best;
    }
  }
  for (const r of ribbons) {
    if (r.chevron === null) continue;
    const q = r.pts[r.chevron];
    const dx = r.b.x - r.a.x;
    const dy = r.b.y - r.a.y;
    const t =
      ((q.x - r.a.x) * dx + (q.y - r.a.y) * dy) / (dx * dx + dy * dy || 1);
    const k = r.k;
    const sw = Math.max(1.6, Math.min(3.4, k * 0.3));
    const h = k * 0.55;
    const shift = sw * 0.35; // centre the visible shape, not the geometric tip
    const tip = { x: q.x + q.tx * (h - shift), y: q.y + q.ty * (h - shift) };
    const a1 = {
      x: q.x - q.tx * (h + shift) + q.nx * k * 0.8,
      y: q.y - q.ty * (h + shift) + q.ny * k * 0.8,
    };
    const a2 = {
      x: q.x - q.tx * (h + shift) - q.nx * k * 0.8,
      y: q.y - q.ty * (h + shift) - q.ny * k * 0.8,
    };
    el(svg, "path", {
      d: `M${a1.x},${a1.y} L${tip.x},${tip.y} L${a2.x},${a2.y}`,
      fill: "none",
      stroke: colorAt(r.flow, t),
      "stroke-width": sw,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
  }

  // --- circles ---------------------------------------------------------------------------------
  for (const node of model.nodes) {
    const { x, y } = P[node.key];
    const parent = node.href
      ? el(svg, "a", {
          href: node.href,
          target: "_blank",
          rel: "noopener noreferrer",
        })
      : svg;
    el(parent, "circle", {
      cx: x,
      cy: y,
      r: R,
      class: "node",
      stroke: node.key === "home" ? "none" : node.ring,
      "stroke-width": 2,
    });
    const iconSize = 24;
    const lines = node.lines;
    const iconY = y - (lines.length > 1 ? 22 : 16);
    const ig = el(parent, "g", {
      transform: `translate(${x - iconSize / 2} ${iconY}) scale(${iconSize / 24})`,
    });
    el(ig, "path", { d: node.icon, class: "icon" });
    lines.forEach((line, i) => {
      const ty = lines.length > 1 ? y + 12 + i * 15 : y + 18;
      const t = el(parent, "text", {
        x,
        y: ty,
        "text-anchor": "middle",
        class: "value",
      });
      if (line.color) t.style.fill = line.color;
      t.textContent = line.text;
    });
    const top =
      node.key === "solar" ||
      node.key === "gas" ||
      node.key === "lowCarbon" ||
      (node.key === "water" && !has("gas"));
    const label = el(svg, "text", {
      class: "label",
      "text-anchor": "middle",
      x,
      y: top ? y - R - 8 : y + R + 16,
    });
    if (node.key === "home" && has("water") && has("gas")) {
      // the water line runs below the home circle: put the name beside it
      label.setAttribute("text-anchor", "end");
      label.setAttribute("x", String(x - 10));
    }
    label.textContent = node.name;
  }
  // home ring, split by where the energy came from
  {
    const { x, y } = P.home;
    const circ = 2 * Math.PI * R;
    if (!model.homeRing.length) {
      el(svg, "circle", {
        cx: x,
        cy: y,
        r: R,
        fill: "none",
        stroke: model.homeRingColor,
        "stroke-width": 2,
      });
    }
    let off = 0;
    for (const seg of model.homeRing) {
      const len = circ * seg.fraction;
      el(svg, "circle", {
        cx: x,
        cy: y,
        r: R,
        fill: "none",
        stroke: seg.color,
        "stroke-width": 4,
        "stroke-dasharray": `${len} ${circ}`,
        "stroke-dashoffset": -off,
        transform: `rotate(-90 ${x} ${y})`,
      });
      off += len;
    }
  }

  // --- pills and badge -------------------------------------------------------------------------
  const pill = (q: Pt, text: string, color: string) => {
    el(svg, "rect", {
      x: q.x - PW / 2,
      y: q.y - PH / 2,
      width: PW,
      height: PH,
      rx: PH / 2,
      fill: model.surface,
      stroke: color,
      "stroke-width": 1.2,
    });
    const t = el(svg, "text", {
      x: q.x,
      y: q.y + 4,
      "text-anchor": "middle",
      class: "pill",
    });
    t.style.fill = color;
    t.textContent = text;
  };
  if (badge && GH && SB) {
    el(svg, "rect", {
      x: badge.x - badge.w / 2,
      y: badge.y - badge.h / 2,
      width: badge.w,
      height: badge.h,
      rx: 11,
      fill: model.surface,
      stroke: model.divider,
      "stroke-width": 1.2,
    });
    for (const [r, dy, arrow] of [
      [GH, -3, "→"],
      [SB, 13, "↓"],
    ] as [Ribbon, number, string][]) {
      const t = el(svg, "text", {
        x: badge.x,
        y: badge.y + dy,
        "text-anchor": "middle",
        class: "pill",
      });
      t.style.fill = r.flow.to_color;
      t.textContent = `${arrow} ${r.flow.label}`;
    }
  }
  for (const r of ribbons) {
    if (r.pill) pill(r.pill, r.flow.label, r.flow.to_color);
  }
};
