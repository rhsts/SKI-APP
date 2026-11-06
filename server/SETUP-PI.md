# Raspberry Pi 4 setup: the complete step-by-step guide

This guide turns a Raspberry Pi 4 into the **friends server** for Ski Tracker, for friend groups, daily
leaderboards and group challenges. At the end:

- the server runs on your Pi at home, day and night,
- your friends' phones reach it from anywhere (the mountain, mobile data, abroad) over a secure **https://**
  address,
- it starts by itself after a power cut, and makes a backup every week,
- it costs **nothing** beyond the Pi and a bit of electricity (about €5 a year).

You don't need to know Linux or programming. Every command is written out: you copy it, paste it, and press
Enter. After each part there's a **✅ Checkpoint** telling you what you should see before you move on.

**Total time:** about 1 to 1.5 hours, most of it waiting for downloads.

---

## Contents

- [How it fits together](#how-it-fits-together)
- [Part 0: What you need](#part-0-what-you-need)
- [Part 1: Terminal basics (5 minutes, read this first)](#part-1-terminal-basics-5-minutes-read-this-first)
- [Part 2: Put Raspberry Pi OS on the SD card](#part-2-put-raspberry-pi-os-on-the-sd-card)
- [Part 3: Assemble and start the Pi](#part-3-assemble-and-start-the-pi)
- [Part 4: Log in to the Pi from your computer](#part-4-log-in-to-the-pi-from-your-computer)
- [Part 5: Update the Pi and switch on automatic security updates](#part-5-update-the-pi-and-switch-on-automatic-security-updates)
- [Part 6: Install Docker and Git](#part-6-install-docker-and-git)
- [Part 7: Download and start the friends server](#part-7-download-and-start-the-friends-server)
- [Part 8: Test it at home](#part-8-test-it-at-home)
- [Part 9: Make it reachable from anywhere (Tailscale Funnel)](#part-9-make-it-reachable-from-anywhere-tailscale-funnel)
- [Part 10: Connect the app and invite your friends](#part-10-connect-the-app-and-invite-your-friends)
- [Part 11: Automatic weekly backups](#part-11-automatic-weekly-backups)
- [Part 12: Check that everything survives a restart](#part-12-check-that-everything-survives-a-restart)
- [Everyday use](#everyday-use)
- [Restore a backup](#restore-a-backup)
- [Troubleshooting](#troubleshooting)
- [Optional: boot from a USB SSD instead of the SD card](#optional-boot-from-a-usb-ssd-instead-of-the-sd-card)
- [Optional: your own address instead of ….ts.net](#optional-your-own-address-instead-of-tsnet)

---

## How it fits together

```
 Friend's phone on the mountain
          │  https://skipi.tail1a2b.ts.net
          ▼
 Tailscale's servers (on the internet)
          │  encrypted tunnel, started by the Pi itself
          ▼
 Your router at home  ──►  Raspberry Pi
                            ├── Tailscale (keeps the tunnel open)
                            └── Docker
                                 └── friends server (port 8787)
                                      └── data/ski-friends.db  (groups, day totals, challenge times)
```

- The **friends server** is a small program in this repository (`server/`). It runs inside **Docker**, a kind
  of sealed box, so it can't mess up the Pi and is easy to update or remove.
- **Tailscale Funnel** gives the Pi a public `https://` address. Because the Pi opens the connection itself,
  you don't change anything on your router: no port forwarding, and it works with every internet provider.
- A **server password** keeps strangers out: without it, the app doesn't even open (it shows a lock screen).
- Everyone has an **account** (username + password), so they can log in on any phone. The **first account**
  created on the server becomes the **admin**: make that yours.
- Friends see only **day totals** (vertical, top speed, runs, distance, ski time), **challenge times** and
  your **profile** (picture, season totals, badges). Each person's **online backup** of their days (GPS
  tracks included) is only visible to themselves; it can be switched off in the app.

---

## Part 0: What you need

### Hardware

| Item | Notes |
|---|---|
| **Raspberry Pi 4** | Any memory size. 2 GB is plenty; 1 GB also works. |
| **USB-C power supply, 5V / 3A** | Preferably the official Raspberry Pi one. A weak phone charger is the #1 cause of random crashes. |
| **microSD card, 16 GB or more** | A brand card (SanDisk, Samsung) of class A1/A2. Or a USB SSD, see the [optional part](#optional-boot-from-a-usb-ssd-instead-of-the-sd-card). |
| **Network cable** | From the Pi to your router. Wi-Fi works too, but a cable is more reliable for a server. |
| **Case with a heatsink or fan** | Optional but recommended: the Pi 4 gets warm. |
| **Card reader** | If your computer has no SD slot. |

You don't need a screen, keyboard or mouse for the Pi: you control it from your computer.

### Accounts (all free)

- A **Tailscale** account (Part 9). You log in with Google, Microsoft, GitHub or Apple, so there's no new
  password to remember.

### Write these down as you go

Keep a note (on paper or on your phone). You'll fill it in during the guide:

```
Pi name (hostname):      skipi
Pi username:             pi
Pi password:             ......................
Pi home address (IP):    192.168.... (Part 4)
Server password:         ...................... (Part 7.2)
Public server address:   https://................ts.net (Part 9)
```

---

## Part 1: Terminal basics (5 minutes, read this first)

You'll type commands in a **terminal**: a window where you give the computer text instructions.

### Opening a terminal on your computer

- **Windows 10/11:** press the **Windows key**, type `PowerShell`, and click **Windows PowerShell**.
- **Mac:** press **Cmd + Space**, type `Terminal`, and press Enter.
- **Linux:** press **Ctrl + Alt + T**.

### Copying and pasting

| | Windows PowerShell | Mac Terminal |
|---|---|---|
| Paste | **right-click** in the window, or **Ctrl + V** | **Cmd + V** |
| Copy | select the text, then **right-click** or **Ctrl + C** | select the text, then **Cmd + C** |

### Things that look scary but are normal

- **Passwords are invisible.** When you type a password, nothing appears, not even dots. Just type it and
  press Enter.
- **Lots of text scrolls by** during installs. That's fine. Only look at the last lines.
- **Some commands take minutes.** Wait until the **prompt** comes back. On the Pi the prompt looks like
  `pi@skipi:~ $`, and when you see it again, the command has finished.
- **`sudo`** at the start of a command means "do this as administrator". The first time per session it can
  ask for the Pi's password.

### If something goes wrong

- **Ctrl + C** stops the command that's running.
- **Arrow up** brings back the previous command, so you don't have to retype it.
- Copy the error message and the command you typed: that's what you need to get help.

### Code blocks in this guide

Everything in a grey box like this is **one command**. Copy the whole box, paste it, and press Enter:

```bash
echo "hello"
```

Run commands **one box at a time**, and wait for each to finish.

---

## Part 2: Put Raspberry Pi OS on the SD card

Raspberry Pi OS is the Pi's operating system, like Windows or macOS but for the Pi.

### 2.1 Install Raspberry Pi Imager

1. On your computer, go to **raspberrypi.com/software**.
2. Download **Raspberry Pi Imager** for your system (Windows, macOS or Ubuntu) and install it like any other
   program.

### 2.2 Choose what to write

1. Put the microSD card in your computer. If Windows asks to **format** the card, click **Cancel**.
2. Open **Raspberry Pi Imager**.
3. **Raspberry Pi Device:** choose **Raspberry Pi 4**.
4. **Operating System:** click it, then choose **Raspberry Pi OS (other)**, then
   **Raspberry Pi OS Lite (64-bit)**.
   - "Lite" means no desktop, which a server doesn't need. It's faster and uses less memory.
   - It must be **64-bit**, because the server software needs it.
5. **Storage:** choose your microSD card.
   ⚠️ **Check the size** so you're sure it's the card, not a USB stick or external disk. Everything on it is
   erased.
6. Click **Next**.

### 2.3 Pre-configure the Pi (important!)

Imager asks **"Would you like to apply OS customisation settings?"** Click **Edit Settings**.
(In newer Imager versions these settings are separate steps of the wizard instead; the fields are the same.)

**General** tab:

| Setting | What to fill in |
|---|---|
| **Set hostname** | ✔ tick it, and type `skipi`. This is the Pi's name on your network. |
| **Set username and password** | ✔ tick it. Username: `pi`. Password: something strong that you **write down**. |
| **Configure wireless LAN** | Only if you **don't** use a network cable: your Wi-Fi name (SSID) and password, and **Wireless LAN country** (e.g. NL). |
| **Set locale settings** | ✔ tick it. Time zone, e.g. `Europe/Amsterdam`. Keyboard layout: `us` is fine for most keyboards. |

**Services** tab:

- ✔ **Enable SSH**, and choose **Use password authentication**. SSH is what lets you control the Pi from
  your computer.

Click **Save**.

### 2.4 Write the card

1. Imager asks again whether to apply the settings: click **Yes**.
2. It warns that all data on the card will be erased: click **Yes**.
3. Writing and checking takes **5 to 15 minutes**. It downloads the system first.
4. When it says **"Write Successful"**, click **Continue** and take the card out.

✅ **Checkpoint:** Imager said "Write Successful". You've written down the username and password.

---

## Part 3: Assemble and start the Pi

1. If you have a case, put the Pi in it (and stick on the heatsinks if they came with it).
2. Slide the microSD card into the slot on the **underside** of the Pi, with the contacts facing the board.
3. Plug a **network cable** from the Pi into your **router** (skip this if you set up Wi-Fi).
4. Plug in the **power supply** last. The Pi has no on/off switch: power in means on.

The **red light** means power, and the **green light** flickers while it's working. **Wait 3 minutes** the first
time. The Pi sets itself up and restarts once on its own.

✅ **Checkpoint:** the red light is on and the green light flickers now and then.

---

## Part 4: Log in to the Pi from your computer

### 4.1 Connect with SSH

Your computer must be on the **same home network** as the Pi. Open a terminal (Part 1) and type:

```bash
ssh pi@skipi.local
```

(If you chose another username or hostname, use those: `ssh username@hostname.local`.)

1. The first time you see:
   `Are you sure you want to continue connecting (yes/no/[fingerprint])?`
   Type `yes` and press Enter. This happens only once.
2. Type the Pi's password (it stays invisible) and press Enter.
3. You see some text about Debian, ending with:

   ```
   pi@skipi:~ $
   ```

You're now **on the Pi**. Everything you type in this window happens on the Pi, not on your computer.

### 4.2 If `skipi.local` isn't found

If you get `Could not resolve hostname skipi.local`, look up the Pi's address in your router:

1. Open your router's page in a browser. It's often `http://192.168.1.1` or `http://192.168.0.1`, and the
   address and password are usually on a sticker on the router.
2. Look for a list called **Connected devices**, **DHCP clients** or **Network map**.
3. Find **skipi** and its **IP address**, e.g. `192.168.1.23`.
4. Log in with that address instead:

   ```bash
   ssh pi@192.168.1.23
   ```

### 4.3 Write down the Pi's address

On the Pi, type:

```bash
hostname -I
```

The first number (e.g. `192.168.1.23`) is the Pi's address at home. Write it down.

> **Tip:** in your router you can usually "reserve" this address for the Pi (look for **DHCP reservation** or
> **static lease**), so it never changes. That's handy but not required: from Part 9 on, the public address
> works no matter what.

### 4.4 Logging out and back in

- **Log out:** type `exit` and press Enter (or just close the window).
- **Log in again later:** open a terminal and run `ssh pi@skipi.local` again.

✅ **Checkpoint:** you see `pi@skipi:~ $`, and you've written down the Pi's IP address.

---

## Part 5: Update the Pi and switch on automatic security updates

Your Pi will be reachable from the internet, so keep it up to date.

### 5.1 Install all updates

```bash
sudo apt update && sudo apt full-upgrade -y
```

- `apt update` fetches the list of new versions, and `full-upgrade -y` installs them without asking.
- This takes **5 to 15 minutes**. Wait for the prompt `pi@skipi:~ $` to come back.

### 5.2 Automatic security updates

This installs security fixes by itself every day:

```bash
sudo apt install -y unattended-upgrades
```

```bash
sudo dpkg-reconfigure -plow unattended-upgrades
```

A blue screen asks *"Automatically download and install stable updates?"*. Choose **Yes** with the arrow
keys and press Enter.

### 5.3 Restart

```bash
sudo reboot
```

Your SSH window closes (`Connection to skipi.local closed`). That's expected. **Wait 1 minute** and log in
again:

```bash
ssh pi@skipi.local
```

✅ **Checkpoint:** you're logged in again and see `pi@skipi:~ $`.

---

## Part 6: Install Docker and Git

- **Git** downloads the server code from GitHub.
- **Docker** runs the server in a sealed box and restarts it automatically.

### 6.1 Install Git

```bash
sudo apt install -y git
```

### 6.2 Install Docker

This uses Docker's official install script:

```bash
curl -fsSL https://get.docker.com | sh
```

It takes **2 to 5 minutes**. At the end you see a summary about Docker and some warnings about running as
root; you can ignore those.

### 6.3 Allow your user to use Docker

```bash
sudo usermod -aG docker $USER
```

This only takes effect after you log out and in again:

```bash
exit
```

```bash
ssh pi@skipi.local
```

### 6.4 Test Docker

```bash
docker compose version
```

You should see something like `Docker Compose version v2.x.x`. Then run a tiny test box:

```bash
docker run --rm hello-world
```

It downloads a small test image and prints **"Hello from Docker!"**.

✅ **Checkpoint:** `docker compose version` shows a version, and `hello-world` printed "Hello from Docker!".
If you get `permission denied ... docker.sock`, you didn't log out and in (step 6.3).

---

## Part 7: Download and start the friends server

### 7.1 Download the code

```bash
cd ~
```

```bash
git clone https://github.com/rhsts/SKI-APP.git
```

This creates a folder `SKI-APP` in your home folder. Go into the server part:

```bash
cd ~/SKI-APP/server
```

Your prompt now ends in `~/SKI-APP/server $`. Check that the files are there:

```bash
ls
```

You should see, among others: `Dockerfile  docker-compose.yml  index.js  backup.sh  README.md  SETUP-PI.md`.

### 7.2 Choose a server password

Anyone who knows your server's address could otherwise use it. A **server password** stops that: the app
only connects with the right password. You give it to your friends together with the address.

Pick a password that's easy to share but hard to guess, like three random words and a number:
`powder-goggles-fondue-42`. Then save it (put your own password between the quotes):

```bash
echo "SERVER_PASSWORD=powder-goggles-fondue-42" > .env
```

This writes it to a file called `.env` in the server folder, where Docker reads it. Check it:

```bash
cat .env
```

**Write the password down** in your note from Part 0.

> **Changing it later:** run the `echo` command again with the new password, then
> `docker compose up -d` to apply it. Everyone then enters the new password in the app.

### 7.3 Build and start the server

```bash
docker compose up -d --build
```

- `up` starts the server, `-d` keeps it running in the background, and `--build` builds the box first.
- The first time this takes **3 to 10 minutes**, because it downloads Node.js for the Pi.
- It ends with something like:

  ```
  ✔ Container server-friends-1  Started
  ```

### 7.4 Check that it runs

```bash
docker compose ps
```

You should see one line with `server-friends-1` and, under STATUS, **Up**.

Now ask the server whether it's healthy:

```bash
curl http://localhost:8787/v1/health
```

The answer should be exactly:

```
{"ok":true,"app":"ski-tracker-friends","v":2,"accounts":true,"password":true}
```

`"password":true` means your server password is on. The health check is the only thing that works without it.

🎉 Your server is running.

### 7.5 What just happened

- Docker built a box with Node.js and the server, and started it.
- The box restarts by itself if it crashes, and starts when the Pi starts (`restart: unless-stopped`).
- All data is in **`~/SKI-APP/server/data/`**. This folder survives updates and restarts.
- Check that the password is on:

  ```bash
  docker compose logs friends | grep -i password
  ```

  It should say `Server password is on`. If it says `WARNING: no SERVER_PASSWORD set`, redo step 7.2, then
  run `docker compose up -d`.

✅ **Checkpoint:** `docker compose ps` says **Up**, `/v1/health` gives `{"ok":true,...,"password":true}`,
and the log says `Server password is on`.

---

## Part 8: Test it at home

Before making it public, test it from your phone on your **home Wi-Fi**.

1. Make sure your phone is on the **same Wi-Fi** as the Pi.
2. Open the phone's browser and go to (with your Pi's IP from Part 4.3):

   ```
   http://192.168.1.23:8787/v1/health
   ```

   You should see `{"ok":true,"app":"ski-tracker-friends",...}`.
3. Optional: in the app, enter `http://192.168.1.23:8787` and your **server password** under
   **Profile → Friends server**, and tap **Connect**. It should say **Connected**.

This home address **only works on your home Wi-Fi**. Part 9 makes it work everywhere.

✅ **Checkpoint:** the phone's browser shows `{"ok":true,...}`.

---

## Part 9: Make it reachable from anywhere (Tailscale Funnel)

Tailscale Funnel gives your Pi a fixed public address like `https://skipi.tail1a2b.ts.net`, with a real
HTTPS certificate. The Pi connects **out** to Tailscale, so there's nothing to change on your router.

### 9.1 Create a Tailscale account

1. On your computer, go to **tailscale.com** and click **Get started** (or **Log in**).
2. Sign in with Google, Microsoft, GitHub or Apple.
3. It may ask what you'll use it for (choose **Personal use**) and offer to install Tailscale on your
   computer. You **don't** need to: you can skip that step.

### 9.2 Install Tailscale on the Pi

On the Pi (in your SSH window):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

It takes about a minute and ends with `Installation complete! Log in to start using Tailscale by running: tailscale up`.

### 9.3 Connect the Pi to your account

```bash
sudo tailscale up
```

It prints a link like this:

```
To authenticate, visit:

        https://login.tailscale.com/a/1a2b3c4d5e6f
```

1. **Copy the link** (select it, then right-click in PowerShell or Cmd+C on a Mac) and open it in your
   computer's browser.
2. Log in with the same account as in 9.1, and click **Connect**.
3. Back in the SSH window you see `Success.` and the prompt returns.

Check it:

```bash
tailscale status
```

The first line shows your Pi (`skipi`) with an address starting with `100.`.

### 9.4 Switch on HTTPS (one-time)

1. On your computer, open **login.tailscale.com/admin/dns**.
2. Under **MagicDNS**: if there's an **Enable MagicDNS** button, click it. (It's usually on already.)
3. Scroll down to **HTTPS Certificates** and click **Enable HTTPS**. Confirm when it asks.

While you're on this page, note your **tailnet name**, shown at the top as something like
`tail1a2b.ts.net`. Your public address will be `https://skipi.<that name>`.

### 9.5 Open the server to the internet

On the Pi:

```bash
sudo tailscale funnel --bg 8787
```

- **If it prints a link** saying Funnel isn't enabled for your tailnet: open the link, click **Enable**
  (this allows Funnel for your devices), then run the command above again.
- **If it works**, you see:

  ```
  Available on the internet:

  https://skipi.tail1a2b.ts.net/
  |-- proxy http://127.0.0.1:8787

  Funnel started and running in the background.
  ```

**Write down the `https://….ts.net` address.** This is your public server address. It stays the same, and
`--bg` means Funnel stays on after restarts.

### 9.6 Test from outside your home

1. On your phone, **switch Wi-Fi off** so you're on mobile data.
2. Open the browser and go to your address plus `/v1/health`, e.g.:

   ```
   https://skipi.tail1a2b.ts.net/v1/health
   ```

3. You should see `{"ok":true,"app":"ski-tracker-friends",...}`.

**The first time it can take up to 10 minutes** before the new address works everywhere. If it doesn't load,
wait a few minutes and try again.

✅ **Checkpoint:** on mobile data, your `https://….ts.net/v1/health` shows `{"ok":true,...}`.

---

## Part 10: Connect the app and invite your friends

### 10.1 Your phone: unlock the app

The app is **private**: the first time it opens, it shows **"Ski Tracker is private"** and only opens with your
server's address and password. So someone who finds the app online can't use it.

1. Open Ski Tracker. You see the lock screen.
2. **Server address:** your public address, e.g. `https://skipi.tail1a2b.ts.net` (no `/v1/health` at the end).
3. **Password:** your server password from Part 7.2.
4. **Your name:** the name your friends see on leaderboards.
5. Tap **Unlock**. Next you see **Create your account**.
6. **Create your account first, before your friends do:** the first account on the server becomes the
   **admin** (that's how you get *Manage people* in the app). Pick a username (e.g. `rafha`), a password of at
   least 6 characters, and your name, then tap **Create account**.
7. The app opens, and stays logged in, also without signal.

> **Changing the server password later locks everyone out** the next time their app is online, until they enter the
> new one. Use this if the password leaked: change it (Part 7.2) and send the new one only to your friends.
>
> **In Expo Go** (testing on your computer) there's a *Skip* link on the lock screen. The installed app
> doesn't have it.

### 10.2 Make a group

1. Go to **Challenges**. At the top you see **Friend groups**.
2. Tap **+ New / join**, type a name for the group (e.g. "Ischgl 2026") under **Start a new group**, and tap
   **Create group**.
3. You're now in the group. At the top is a 6-character **invite code**, e.g. `K7MP2Q`.
4. Tap the **share** icon to send an invite to your friends via WhatsApp or another app. The invite
   contains the server address, the **server password** and the group code, so only send it to people you
   want in.

### 10.3 Your friends

The invite from the share button contains everything: a link to download the app, the server address, the
password and the group code. Your friends:

> 1. Download and install the app from the link.
> 2. **Copy the whole invite message**, open the app, and tap **Paste invite** on the lock screen.
> 3. Tap **Unlock**, then **create their account** (username + password).
> 4. They're in, and already in your group.

### 10.4 Accounts, backups and profiles

- **New phone?** Install the app, unlock it with the server address and password, choose **I have an
  account**, and log in. Groups come back, and the app offers to download your backed-up days.
- **Profile:** under **Profile** tap your picture to set a profile picture. In a group, tap a friend to see
  their profile: picture, season totals, recent days and badges.
- **Online backup:** under **Profile → Back up my days online** (on by default). Your days, GPS tracks
  included, are kept compressed on the Pi; only you can see them. A full day is a few hundred KB.

### 10.5 Manage people (admin)

As the admin, **Profile → Manage people (admin)** shows everyone on the server: account, last seen, groups,
days and backup size.

- **Remove** deletes someone's account, memberships, shared days, challenge times and backup, and their phone
  can't get back in. It can't be undone.
- **Make admin** gives a friend the same rights.
- To shut out **everyone** who isn't supposed to be there at once, change the server password (Part 7.2):
  everyone gets the lock screen until they enter the new one.

### 10.6 How the group works

- **Leaderboard:** when someone finishes a ski day, its totals go to the group automatically. In the group,
  pick a day and rank by **Vertical**, **Top speed** or **Runs**.
- **Group challenge:** in the group, tap **+ New**, pick a day and one of your challenges (stretches you made
  with the 🏳 flag on a run). Everyone who skis that stretch on that day is timed and ranked automatically.
- **No signal on the mountain?** No problem. The app shares the day as soon as it's back online.

✅ **Checkpoint:** you see your group, and your friends can join with the code.

---

## Part 11: Automatic weekly backups

The backup script makes a safe copy of the database (also while the server runs) in
`~/SKI-APP/server/backups/` and keeps the newest 8.

### 11.1 Try it once

```bash
cd ~/SKI-APP/server && ./backup.sh
```

You should see `Backup saved: backups/ski-friends-2026-…db`.

### 11.2 Schedule it every Sunday at 04:00

Open the Pi's schedule (called *crontab*):

```bash
crontab -e
```

1. The first time it asks which editor to use. Type `1` (nano) and press Enter.
2. A text file opens. Use the **arrow keys** to go to the very bottom.
3. Paste this line:

   ```
   0 4 * * 0 cd ~/SKI-APP/server && ./backup.sh >> backups/backup.log 2>&1
   ```

   It means: minute 0, hour 4, any day of the month, any month, on day 0 (Sunday).
4. Save with **Ctrl + O**, then **Enter**, and close with **Ctrl + X**.
5. It says `crontab: installing new crontab`.

Check it's there:

```bash
crontab -l
```

### 11.3 Keep a copy off the Pi

If the SD card dies, backups on the same card die with it. Every month or so, copy them to your computer.
On **your computer** (not on the Pi), open a new terminal and run:

```bash
scp -r pi@skipi.local:SKI-APP/server/backups ./ski-backups
```

This copies the backups to a folder `ski-backups` in your computer's current folder (on Windows usually
`C:\Users\<you>`).

✅ **Checkpoint:** `./backup.sh` worked, and `crontab -l` shows the backup line.

---

## Part 12: Check that everything survives a restart

A power cut shouldn't break anything. Test it:

```bash
sudo reboot
```

Wait **2 minutes**, log in again (`ssh pi@skipi.local`), and check:

```bash
cd ~/SKI-APP/server && docker compose ps
```

It should show **Up** again.

```bash
tailscale funnel status
```

It should show your `https://….ts.net` address. Finally, open `https://….ts.net/v1/health` on your phone.

✅ **Checkpoint:** after the restart, the server is **Up**, Funnel shows your address, and the health page
works. **You're done!** 🎿

---

## Everyday use

You don't need to do anything day to day. For maintenance, log in (`ssh pi@skipi.local`), go to the server
folder (`cd ~/SKI-APP/server`), and use:

| What | Command |
|---|---|
| Is the server running? | `docker compose ps` |
| Show the latest log lines | `docker compose logs --tail 50` |
| Follow the log live (stop with Ctrl+C) | `docker compose logs -f` |
| Restart the server | `docker compose restart` |
| Stop the server | `docker compose down` |
| Start it again | `docker compose up -d` |
| **Update to the newest server version** | `git pull && docker compose up -d --build` |
| Make a backup now | `./backup.sh` |
| Is the public address on? | `tailscale funnel status` |
| Turn the public address off | `sudo tailscale funnel --bg off 8787` |
| Turn it back on | `sudo tailscale funnel --bg 8787` |
| Pi temperature (below 70 °C is fine) | `vcgencmd measure_temp` |
| Free space on the SD card | `df -h /` |
| Update the Pi (monthly) | `sudo apt update && sudo apt full-upgrade -y` |
| **Turn the Pi off safely** | `sudo shutdown -h now`, wait until the green light stops, then unplug |

Don't just pull the plug while it's running unless you have to. That can damage the SD card.

---

## Restore a backup

Use this if the database got damaged, or after setting up a new SD card.

1. See which backups you have:

   ```bash
   cd ~/SKI-APP/server && ls backups
   ```

2. Stop the server:

   ```bash
   docker compose down
   ```

3. Put the backup in place. Replace the file name with the one you want:

   ```bash
   cp backups/ski-friends-2026-01-17_0400.db data/ski-friends.db
   ```

   ```bash
   rm -f data/ski-friends.db-wal data/ski-friends.db-shm
   ```

4. Start it again:

   ```bash
   docker compose up -d
   ```

**On a new SD card:** redo Parts 2–9, then copy your backup from your computer to the Pi (from your
computer: `scp ski-backups/ski-friends-2026-01-17_0400.db pi@skipi.local:SKI-APP/server/backups/`), and
follow the steps above. Use the same Tailscale account, and the address stays the same if you name the Pi
`skipi` again. If Tailscale gives it a different name (like `skipi-1`), remove the old `skipi` in the
Tailscale admin under **Machines**, then rename the new one to `skipi`.

---

## Troubleshooting

### Logging in

| Problem | Fix |
|---|---|
| `Could not resolve hostname skipi.local` | Use the Pi's IP address from your router (Part 4.2). Wait 3 minutes after the first start. |
| `Connection refused` or `timed out` | SSH isn't on, or the Pi isn't on the network. Check the cable, or rewrite the card with SSH enabled (Part 2.3). |
| `Permission denied (password)` | Wrong username or password. The username is the one you set in Imager (`pi` in this guide). |
| `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED` | Happens after rewriting the card. On your computer, run `ssh-keygen -R skipi.local` and try again. |

### The server

| Problem | Fix |
|---|---|
| `permission denied ... docker.sock` | Log out and in after Part 6.3 (`exit`, then `ssh pi@skipi.local`). |
| `docker compose ps` shows **Restarting** or nothing | Run `docker compose logs --tail 50` and look at the last lines. Then `docker compose up -d --build`. |
| `curl ... /v1/health` says `Connection refused` | The server isn't running: `docker compose up -d`. |
| `git pull` says *"Your local changes would be overwritten"* | You edited a file by accident. Run `git checkout -- .` and then `git pull` again. |
| The SD card is full (`df -h /` shows 100%) | Clean up old Docker files: `docker system prune -f`. |

### Reaching it from outside

| Problem | Fix |
|---|---|
| `tailscale funnel` says Funnel isn't enabled | Open the link it prints and click **Enable**, then run the command again. |
| Error about **HTTPS** or certificates | Enable HTTPS Certificates in the Tailscale admin (Part 9.4). |
| The `.ts.net` address doesn't load | Wait 10 minutes the first time. Check `tailscale status` (should be online) and `tailscale funnel status`. |
| It works at home but not on mobile data | You're using the home address (`http://192.168…`). Use the `https://….ts.net` address. |

### The app

| Problem | Fix |
|---|---|
| "Can't reach the friends server" | Check the address in **Profile** (with `https://`, without `/v1/health`). Open `…/v1/health` in the phone's browser: if that fails too, it's the server or Funnel, not the app. |
| The app shows "Ski Tracker is private" again | The server password was changed, or you tapped Disconnect. Enter the address and the current password. |
| "Wrong server password" or "This server needs a password" | Enter the password from Part 7.2 under **Profile → Friends server** and tap **Connect**. Forgot it? On the Pi: `cat ~/SKI-APP/server/.env`. |
| "That address answers, but it isn't a Ski Tracker friends server" | There's a typo in the address, or another program uses port 8787. |
| After reinstalling the app, my groups are gone | A reinstalled app is a new skier to the server. Connect again and join your groups with their codes. Old days come back on the leaderboard once you restore your app backup (Profile → Restore from a backup). |
| My day isn't on the leaderboard | Finish the day in the app (it's shared when finished). Demo days are only shared with **Share demo days** switched on in Profile. Pull down in the group to refresh. |

### The Pi itself

| Problem | Fix |
|---|---|
| Random restarts or freezes | Almost always the power supply. Use the official 5V/3A one. |
| A lightning-bolt or "under-voltage" warning in the log | Same: the power supply or cable is too weak. |
| Very hot (above 80 °C) | Use a case with a heatsink or fan, and don't put the Pi in a closed cupboard. |
| The SD card stopped working | SD cards wear out after a few years. Use a new card (or an SSD) and [restore a backup](#restore-a-backup). |

---

## Optional: boot from a USB SSD instead of the SD card

An SSD is faster and lasts much longer than an SD card. A Pi 4 can start directly from USB.

1. In **Part 2**, choose the **USB SSD** as Storage instead of the SD card (plug it into your computer
   with a USB adapter).
2. In **Part 3**, **don't insert an SD card**. Plug the SSD into one of the **blue USB 3 ports** on the Pi.
3. Continue the guide as normal.

If the Pi doesn't start from the SSD (no green flickering after 3 minutes), its firmware is too old.
Start once from an SD card, log in, and run:

```bash
sudo rpi-eeprom-update -a
```

```bash
sudo reboot
```

After that, shut it down (`sudo shutdown -h now`), take out the SD card, and start it from the SSD.

Some cheap SSD adapters don't work well with the Pi. If you get random disconnects, try another adapter or
the black USB 2 port.

---

## Optional: your own address instead of ….ts.net

If you want an address like `https://ski.yourname.uk`:

1. Buy a domain. A `.uk` one is about €5 a year at Cloudflare.
2. Use a **Cloudflare Tunnel** instead of Tailscale Funnel. The steps are in [README.md](README.md), under
   "Reach it from the mountain: Cloudflare Tunnel".
3. Turn Funnel off (`sudo tailscale funnel --bg off 8787`) and change the address in everyone's app.
