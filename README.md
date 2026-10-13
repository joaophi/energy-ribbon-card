# Energy Ribbon Card

A Home Assistant energy distribution card where every flow is a ribbon sized by the energy it
carries. It shows the same numbers as the built-in energy distribution card (it uses the same energy
data and the same calculations), drawn differently:

- **Ribbons sized by energy.** The bundle on each side of a circle is never wider than the circle,
  so the proportions read at a glance.
- **One chevron per flow** shows the direction (in the middle of each curve, or past the crossing
  for straight flows), sized with the ribbon and coloured like it.
- **Value pills only where you need them.** A flow's value is shown only when it can't be read off
  a circle (when it's neither the only flow leaving its source nor the only one entering its
  destination). Flows that cross in the middle share one badge.
- **Static.** Nothing animates, so the card doesn't keep the device redrawing. On low-power wall
  tablets the built-in card's moving dots cost a significant amount of CPU for as long as it is on
  screen; this card costs nothing while idle.

Supports solar, grid (import and export), battery (with state of charge), gas, water and the
low-carbon (CO2 signal) circle, in the same positions as the built-in card.

## Installation

### HACS

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/joaophi/energy-ribbon-card`, type
   **Dashboard**.
2. Install **Energy Ribbon Card** and reload the browser.

### Manual

Copy `dist/energy-ribbon-card.js` to `config/www/` and add it as a dashboard resource
(`/local/energy-ribbon-card.js`, type JavaScript module).

## Configuration

```yaml
type: custom:energy-ribbon-card
title: Energia          # optional
link_dashboard: true    # optional, link to the energy dashboard
collection_key: energy_custom  # optional, same as the built-in energy cards
```

The card follows the dashboard's energy date selection, like the built-in energy cards.

## Development

```sh
docker run --rm -v "$PWD":/w -w /w node:24 sh -c 'npm install && npm run typecheck && npm run build'
```

The build writes `dist/energy-ribbon-card.js`, which HACS serves. Commit it with each release.

## Credits

The energy math is ported from the [Home Assistant frontend](https://github.com/home-assistant/frontend)
(Apache-2.0) so the numbers match the built-in card.
