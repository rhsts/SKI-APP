# Ski Tracker friends server

Friend groups, a daily group leaderboard (vertical, top speed, runs) and group challenges with automatic
rankings. A Raspberry Pi 4 handles this easily: it's built for a handful to a few dozen friends.

- **No dependencies.** Plain Node.js (22.13 or newer) with its built-in HTTP server and SQLite.
- **Shares totals only**: day totals and challenge times. GPS tracks stay on the phones.
- **No accounts.** Each phone makes up a random id + secret the first time it connects. Group codes are
  6 characters, and only members can see a group.

**New to this? Follow [SETUP-PI.md](SETUP-PI.md):** a step-by-step manual from an empty SD card to a working
server, reachable from the mountain for free with Tailscale Funnel.

## Run it on a Raspberry Pi (Docker)

You need a 64-bit Raspberry Pi OS. A USB SSD is better than the SD card, but either works.

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out and back in
git clone https://github.com/rhsts/SKI-APP.git
cd SKI-APP/server
docker compose up -d --build
```

Check it: `curl http://localhost:8787/v1/health` should print `{"ok":true,...}`.
The database is `server/data/ski-friends.db`. Copy that file to back everything up.

**At home** (phones on your Wi-Fi), the app's server address is `http://<pi-ip>:8787`, for example
`http://192.168.1.20:8787`. Find the IP with `hostname -I`.

## Reach it from the mountain: Tailscale Funnel (free, no domain)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale funnel --bg 8787
```

Turn on MagicDNS and HTTPS Certificates in the Tailscale admin first. The full steps are in
[SETUP-PI.md](SETUP-PI.md#step-7-make-it-reachable-from-anywhere-tailscale-funnel-free). The app's server
address is then `https://<pi>.<tailnet>.ts.net`.

## Reach it from the mountain: Cloudflare Tunnel (your own domain)

Phones on mobile data can't reach your home network directly. A Cloudflare Tunnel fixes that: you don't
open any ports on your router, it works behind CGNAT, and you get HTTPS for free.

1. Get a domain (around €10 a year) and add it to a free Cloudflare account.
2. In the Cloudflare dashboard go to **Zero Trust → Networks → Tunnels → Create a tunnel**
   (type *Cloudflared*). Copy the **token** it shows.
3. Add a **public hostname** to the tunnel, e.g. `ski.yourdomain.com`, with service
   **HTTP → `friends:8787`**.
4. On the Pi, in `SKI-APP/server`:

   ```bash
   echo "TUNNEL_TOKEN=<paste token>" > .env
   docker compose --profile tunnel up -d
   ```

5. In the app: **Profile → Friends server → `https://ski.yourdomain.com` → Connect**. Your friends enter the
   same address.

## Run it without Docker

```bash
cd server
npm start            # PORT=8787 and DB_FILE=./data/ski-friends.db by default
npm test             # API tests
```

To start it at boot without Docker, put `npm start` in a systemd service, or use Docker as above
(`restart: unless-stopped` already handles reboots).

## Keep it healthy

- `sudo apt update && sudo apt upgrade` every now and then.
- Update the server: `git pull && docker compose up -d --build`.
- Back up with `./backup.sh` (a safe copy while it runs, keeps the newest 8 in `backups/`). See SETUP-PI.md
  for a weekly automatic backup.

## API

All requests and responses are JSON. Every endpoint except `/v1/health` needs the header
`Authorization: Bearer <playerId>:<secret>`.

| Method | Path | What |
|---|---|---|
| GET | `/v1/health` | Is the server up |
| PUT | `/v1/me` | `{name}`: your name on leaderboards |
| GET | `/v1/groups` | Your groups |
| POST | `/v1/groups` | `{name}`: create a group (you're the first member) |
| POST | `/v1/groups/join` | `{code}`: join with a code |
| GET | `/v1/groups/:id` | Members, dates with ski days, group challenges |
| PATCH | `/v1/groups/:id` | `{name}`: rename |
| DELETE | `/v1/groups/:id/members/me` | Leave (the last one to leave deletes the group) |
| GET | `/v1/groups/:id/board?date=YYYY-MM-DD` | Totals per member on that day |
| POST | `/v1/groups/:id/challenges` | `{date, segment}`: set a group challenge for a day |
| DELETE | `/v1/groups/:id/challenges/:cid` | Remove it (only who set it, or the group's creator) |
| GET | `/v1/groups/:id/challenges/:cid/board` | Each member's best time on that stretch that day |
| PUT | `/v1/days/:dayId` | `{date, startedAt, vertical, topSpeed, runs, distance, skiTime}` |
| DELETE | `/v1/days/:dayId` | Take a day off the leaderboards |
| PUT | `/v1/attempts/:id` | `{segmentId, date, time, at, ghost}`: a timed run |
