# Beach Hamster — STF Arcade

An endless horizontally scrolling shoreline runner built for **STF Arcade**. Roam freely along the coast as a speedy beach hamster collecting sand dollars and rare Sea Stars while chaining combos and dodging surging ocean waves, scurrying crabs, bubbling sand mounds, and swooping seagulls.

Zero build steps. Zero npm/Node dependencies. Pure HTML5 Canvas, Web Audio API, and native CSS on the client, paired with a lightweight PHP + SQLite global leaderboard (plus automatic browser Local Mode fallback when no PHP backend is present).

---

## Running Locally

### Option A: PHP Server (Global SQLite Leaderboard)
```bash
php -S localhost:8000
```
Open `http://localhost:8000/`. Requires PHP 7.4+ with `pdo_sqlite` enabled and write permissions on `data/`.

### Option B: Static HTTP Server (Local Development Mode)
```bash
python3 -m http.server 8000
```
If the PHP API endpoints are unavailable, the leaderboard automatically falls back to `localStorage` without errors.

---

## Controls & Orientation

- **Desktop:** `W` `A` `S` `D` or Arrow keys to move · `P` / `Esc` to pause · `M` to toggle audio
- **Mobile:** Floating virtual joystick anywhere on the beach for continuous roaming along the shoreline, plus optional **Tilt** (`DeviceOrientation`) toggle in the HUD or Pause menu
- **Orientation:** Auto-detects Portrait (`720x1280`, 9:16) on portrait/mobile screens and Landscape (`1280x720`, 16:9) on desktop, with manual **Auto / Portrait / Landscape** switching in both the HUD (`VIEW`) and Pause menu

---

## Pickups, Multipliers & Shoreline Mechanics

### Sand Dollar Tiers & Power Pickups
- **Large / Common (10 pts):** Generous hitbox, plain bleached white — sparse along the upper/mid beach (`y < 0.55 H`) and grouped in lower damp-sand arcs.
- **Medium / Sun-Bleached (25 pts):** Standard hitbox, crisp ivory with a subtle star pattern, spawning in lower damp sand (`y > 0.55 H`) and receding wave wash.
- **Tiny / Golden "Pearl" (100 pts):** Tight precision hitbox with a golden-amber sheen and sparkle glint — spawning in tight crab gaps and receding wave wash zones (capped at **1 Golden Pearl per wave**).
- **Rare Sea Star (150 pts + Speed Burst):** Vibrant, slowly rotating 5-pointed coral-gold starfish washed ashore every ~24–32s in receding wave wash (`9s` reclaim TTL). Awards 150 base points and triggers a 4-second **+35% Speed Burst** (with a golden/cyan sparkle trail and immunity to wet-sand drag).

### Combos & Bonuses
- **Surf Zone Bonus (2×):** Pickups collected in the lower wet swash earn double points.
- **Beachcomber Chain (up to 3×):** Collecting pickups within a **2.6s** streak window builds a combo multiplier (`1–2`: 1×, `3–5`: 1.5×, `6–9`: 2×, `10+`: 3×) with a rising audio pitch flourish, stacking cleanly with the 2× Surf Zone bonus. Resets on timeout or damage.

### Hazards & Terrain
- **Dynamic Tide Cycle:** A continuous ~35-second coastal tide cycle raises the waterline by ~6% during **High Tide** (compressing dry sand) before easing back down to **Low Tide**.
- **Progressive Wet-Sand Drag:** Moving into the wet sand zone (`y > 0.58 H`) smoothly slows movement by up to **22%** at the surf line (and applies full 22% drag inside active receding wave wash), replacing dry footprints with water-droplet splash particles. Sea Star Speed Bursts ignore wet-sand drag.
- **Incoming Waves:** Bubbling surf foam telegraphs surges up the beach before receding and depositing fresh pickups.
- **Scurrying Crabs & Sand Mounds:** Crabs scuttle in from either side of the screen (including tight pairs guarding Golden Pearls), while occasional **Sand Mounds** in the mid-beach wiggle and bubble for ~1.1s before a crab emerges left or right.
- **Swooping Seagulls:** Target upper dunes (~40%), mid-beach (~45%), and lower beach (~15%), casting a sand shadow and an early dashed coral/red dive telegraph ring starting at `altitude < 0.55`.
- **World-Space Landmarks:** Recurring cosmetic landmarks (weathered driftwood, sandcastles, striped beach umbrellas, and tide-pool stones) every ~1,400px provide spatial reference and speed cues.

---

## Deployment

Upload the repository contents to your web root or subdirectory (e.g. `public_html/beachhamster/`).
- Ensure `data/` is writable (`755` or `775`) so `data/leaderboard.sqlite` can be created automatically on first request.
- Root `.htaccess` and `data/.htaccess` block directory listings, dotfiles, SQLite database/journal/WAL files, logs, backups, and Markdown documentation.
- `api/submit_score.php` enforces rate limiting, input validation, and server-side score plausibility bounds accounting for stacked Surf + Beachcomber Chain multipliers.
- Configure `ARCADE_URL` in `js/config.js` if needed.

---

## License

MIT License © 2026 Anthony Moore / None Yet Studios
