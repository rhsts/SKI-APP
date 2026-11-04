# Raspberry Pi 4 setup, step by step

This turns a Raspberry Pi 4 into the friends server for Ski Tracker: friend groups, daily leaderboards and
group challenges. It's reachable from the mountain, over HTTPS, and costs nothing beyond the Pi.

**Time:** about 45 minutes. **Difficulty:** you copy and paste commands; no programming needed.

## What you need

- A **Raspberry Pi 4** (any memory size; 2 GB is plenty) with its **USB-C power supply** (official 5V/3A
  recommended; weak chargers cause random crashes).
- A **microSD card** of 16 GB or more. A USB SSD is even better, and lasts much longer than an SD card.
- A **network cable** to your router (Wi-Fi also works, but a cable is more reliable).
- A **computer** to set things up (Windows, Mac or Linux), with a card reader.
- A free **Tailscale account** (step 7). You can log in with Google, Microsoft or GitHub.

---

## Step 1: Put Raspberry Pi OS on the card

1. On your computer, download and install **Raspberry Pi Imager** from raspberrypi.com/software.
2. Put the microSD card in your computer and open Raspberry Pi Imager.
3. Choose:
   - **Device:** Raspberry Pi 4
   - **Operating system:** *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite (64-bit)**. "Lite" has no
     desktop, which you don't need for a server.
   - **Storage:** your microSD card. Double-check this: the card is wiped.
4. When it asks about **OS customisation**, choose **Edit settings** and fill in:
   - **Hostname:** `skipi`
   - **Username and password:** e.g. username `pi` and a strong password. Write the password down.
   - **Wi-Fi:** only if you don't use a cable. Enter your network name and password, and set the country.
   - **Locale / time zone:** your time zone (e.g. Europe/Amsterdam).
   - **Services** tab: tick **Enable SSH** → *Use password authentication*.
5. Save, choose **Yes** to apply the settings, and write the card. This takes a few minutes.

## Step 2: Start the Pi

1. Put the card in the Pi, plug in the network cable, then the power.
2. Wait **2–3 minutes** the first time. It sets itself up and restarts once.

## Step 3: Log in to the Pi from your computer

Open a terminal on your computer: on **Windows** use *PowerShell*, on **Mac** use *Terminal*. Then type
(with your own username):

```bash
ssh pi@skipi.local
```

- The first time it asks *"Are you sure you want to continue connecting?"*: type `yes`.
- Enter the password from step 1. You won't see anything while you type; that's normal.
- When the prompt changes to `pi@skipi:~ $`, you're on the Pi. All the next commands go here.

**If `skipi.local` isn't found:** open your router's web page and look up the IP address of `skipi` in the
list of connected devices. Then use `ssh pi@192.168.1.23` with that address.

## Step 4: Update the Pi

```bash
sudo apt update && sudo apt full-upgrade -y
```

This can take 5–10 minutes. Then restart it:

```bash
sudo reboot
```

Wait a minute and log in again as in step 3.

## Step 5: Install Docker and Git

Docker runs the server in its own box, so it's easy to update and can't mess up the Pi.

```bash
sudo apt install -y git
```

```bash
curl -fsSL https://get.docker.com | sh
```

Let your user run Docker without `sudo`:

```bash
sudo usermod -aG docker $USER
```

**Log out and back in** so that takes effect:

```bash
exit
```

```bash
ssh pi@skipi.local
```

Check that it works. It should print a version number:

```bash
docker compose version
```

## Step 6: Download and start the friends server

```bash
git clone https://github.com/rhsts/SKI-APP.git
```

```bash
cd SKI-APP/server
```

```bash
docker compose up -d --build
```

The first time this takes a few minutes, because it downloads Node.js. Then check that the server answers:

```bash
curl http://localhost:8787/v1/health
```

You should see `{"ok":true,"app":"ski-tracker-friends","v":1}`. 🎉

The server now starts by itself whenever the Pi starts. The data lives in `~/SKI-APP/server/data/`.

**Quick test at home:** find the Pi's address with `hostname -I` (the first number, e.g. `192.168.1.23`).
In the app, enter `http://192.168.1.23:8787` under **Profile → Friends server → Connect**. This only works
while your phone is on your home Wi-Fi. The next step makes it work everywhere.

## Step 7: Make it reachable from anywhere (Tailscale Funnel, free)

This gives the Pi a public **https://** address without opening anything on your router.

1. Install Tailscale:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   ```

2. Connect the Pi to your Tailscale account:

   ```bash
   sudo tailscale up
   ```

   It prints a link. Open it on your computer or phone, and log in (or create the free account).

3. On your computer, open **login.tailscale.com/admin/dns** and make sure both of these are on:
   - **MagicDNS**
   - **HTTPS Certificates** (click *Enable HTTPS*)

4. Back on the Pi, open the server to the internet:

   ```bash
   sudo tailscale funnel --bg 8787
   ```

   The first time it may print a link asking you to allow Funnel. Open it and click **Enable**, then run the
   command again.

5. It prints your public address, for example:

   ```
   Available on the internet:
   https://skipi.tail1a2b3c.ts.net/
   ```

   **Write this address down.** It stays the same, and `--bg` keeps it on after a restart.

6. Test it from your phone **on mobile data, not Wi-Fi**: open `https://skipi.tail1a2b3c.ts.net/v1/health`
   in the browser. You should see `{"ok":true,...}`. The first time it can take a few minutes before the
   address works.

## Step 8: Connect the app

1. In the app: **Profile → Friends server**, enter your `https://….ts.net` address and tap **Connect**.
2. **Challenges → Friend groups → + New / join** → **Create group**, e.g. "Ischgl 2026".
3. Tap the share icon in the group and send the **code** to your friends.
4. Your friends enter the **same server address** in their app (Profile → Friends server), then
   **Join** with the code.

That's it: finished days appear on the group leaderboard automatically.

## Step 9: Automatic weekly backup (recommended)

Make a backup now to check it works:

```bash
cd ~/SKI-APP/server && ./backup.sh
```

Then let the Pi do it every Sunday at 04:00. Open the schedule:

```bash
crontab -e
```

If it asks for an editor, pick `1` (nano). Go to the bottom and add this line:

```
0 4 * * 0 cd ~/SKI-APP/server && ./backup.sh >> backups/backup.log 2>&1
```

Save with **Ctrl+O**, **Enter**, then close with **Ctrl+X**. The newest 8 backups are kept in
`~/SKI-APP/server/backups/`. Now and then copy that folder off the Pi, e.g. to a USB stick.

---

## Everyday commands

All of these run in `~/SKI-APP/server`:

| What | Command |
|---|---|
| Is the server running? | `docker compose ps` |
| Show the server's log | `docker compose logs --tail 50` |
| Restart the server | `docker compose restart` |
| Stop the server | `docker compose down` |
| Update to the newest version | `git pull && docker compose up -d --build` |
| Is the public address on? | `tailscale funnel status` |
| Turn the public address off | `sudo tailscale funnel --bg off 8787` |
| Update the Pi itself (monthly) | `sudo apt update && sudo apt full-upgrade -y` |

## Restore a backup

```bash
cd ~/SKI-APP/server
docker compose down
cp backups/ski-friends-2026-01-17_0400.db data/ski-friends.db
rm -f data/ski-friends.db-wal data/ski-friends.db-shm
docker compose up -d
```

Use the name of the backup you want instead of `ski-friends-2026-01-17_0400.db`.

## Troubleshooting

- **`ssh: Could not resolve hostname skipi.local`:** use the Pi's IP address from your router (step 3).
- **`permission denied … docker.sock`:** you didn't log out and in after step 5. Type `exit` and log in again.
- **The app says "Can't reach the friends server":**
  1. On the Pi, `curl http://localhost:8787/v1/health` should work. If not, check `docker compose logs`.
  2. `tailscale funnel status` should show your address.
  3. Did you type the address in the app exactly, with `https://`?
- **The Pi restarts or freezes at random:** usually the power supply. Use the official one.
- **The SD card stopped working:** SD cards wear out. Write a new card (step 1), redo steps 3–7, and restore
  your latest backup. Booting from a USB SSD prevents this.

## Want your own address instead of `….ts.net`?

Buy a domain (a `.uk` one is about €5 a year at Cloudflare) and use a Cloudflare Tunnel instead of Tailscale
Funnel: see "Reach it from the mountain: Cloudflare Tunnel" in [README.md](README.md).
