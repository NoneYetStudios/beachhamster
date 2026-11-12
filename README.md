# Beach Hamster — STF Arcade

An endless horizontally scrolling shoreline runner built for **STF Arcade**. Dash along the sand as a speedy beach hamster collecting 3 tiers of sand dollars while dodging surging ocean waves, scurrying crabs, and swooping seagulls.

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
python -m http.server 8000
```
If the PHP API endpoints are unavailable, the leaderboard automatically falls back to `localStorage` without errors.

---

## Controls & Orientation

- **Desktop:** `W` `A` `S` `D` or Arrow keys to move · `P` / `Esc` to pause · `M` to toggle audio
- **Mobile:** Direct 1:1 touch-drag anywhere on the beach, plus optional **Tilt** (`DeviceOrientation`) toggle in the HUD or Pause menu
- **Orientation:** Auto-detects Portrait (`720x1280`, 9:16) on portrait/mobile screens and Landscape (`1280x720`, 16:9) on desktop, with manual **Auto / Portrait / Landscape** switching in both the HUD (`VIEW`) and Pause menu

---

## 3-Tier Sand Dollar System

- **Large / Common (10 pts):** Generous hitbox, plain bleached white, spawning along safe mid-beach lines.
- **Medium / Sun-Bleached (25 pts):** Standard hitbox, crisp ivory with a subtle star pattern requiring intentional line adjustments.
- **Tiny / Golden "Pearl" (100 pts):** Tight precision hitbox (half the radius of a standard shell) with a bright golden-amber sheen, pulsing sparkle glint, and dark drop shadow — spawning in receding wave wash zones and tight gaps between crabs.

---

## Deployment

Upload the repository contents to your web root or subdirectory (e.g. `public_html/beachhamster/`). Ensure `data/` is writable (`755` or `775`) so `data/leaderboard.sqlite` can be created automatically on first request. Configure `ARCADE_URL` in `js/config.js` if needed.
