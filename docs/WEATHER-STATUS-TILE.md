# Status weather tile

HomeBack renders a passive status tile at the fixed right edge of the ribbon. The tile is intentionally outside the launcher-card DOM so it cannot affect launch-point focus, ordering, editing, or horizontal selection indexes.

## Data flow

The app renders the TV's local clock directly and asks the HomeBack helper service for a normalized weather snapshot. The helper caches successful weather for 20 minutes and may display a stale snapshot for up to two hours if refreshes fail.

On the first post-bootstrap run for a HomeBack version, the helper probes the known LG/webOS preference locations once to determine whether stock weather values are exposed and whether LG's Weather Location Setting can be read. The result is stored in `/home/root/.config/homeback/weather-capability.json`, including explicit stock-weather availability, the selected stock source when available, the discovered weather location, the HomeBack version, and the probe timestamp.

Normal ribbon opens do not repeat the capability scan. If stock weather was found, refreshes query only the stored source. If stock weather was unavailable, HomeBack goes directly to the stored LG weather location or the webOS location service and then Open-Meteo. A HomeBack version change invalidates the persisted capability record so a new version probes once again.

## Conditions

Weather responses are normalized to these UI conditions: clear, partly cloudy, cloudy, rain, heavy rain, storm, snow, fog, and unknown. The status tile uses bundled monochrome SVG glyphs and does not depend on external icon assets.

## Failure behavior

Weather is optional. Missing LG services, denied location access, failed geocoding, or network failures do not affect launcher navigation or visibility. The tile continues to show the clock and displays `--°` until a weather snapshot is available.
