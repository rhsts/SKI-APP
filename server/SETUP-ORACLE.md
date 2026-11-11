# Oracle Cloud (free VM) setup: the complete step-by-step guide

This guide puts the **friends server** for Ski Tracker on a free virtual machine in Oracle Cloud, instead of
(or after) a Raspberry Pi at home. At the end:

- the server runs in a data centre, day and night, and doesn't depend on your power or internet at home,
- your friends' phones reach it from anywhere over a secure **https://** address (Tailscale Funnel),
- it starts by itself after a restart, and makes a backup every week,
- it costs **nothing**: it uses Oracle's *Always Free* resources.

It's the **same server and the same Docker setup** as on the Pi. Nothing in the code changes. If you already
run the server on a Pi, [Part 9](#part-9-move-your-data-from-the-pi-optional) moves your groups, accounts and
backups over, and your friends can keep the same address.

Every command is written out: copy it, paste it, press Enter. After each part there's a **✅ Checkpoint**.

**Total time:** about 1 hour, most of it waiting.

> **Oracle's free offer changes now and then.** At the time of writing, *Always Free* includes Arm
> (Ampere A1) VMs with **2 OCPUs and 12 GB of memory in total**, and **200 GB of disk in total**. Oracle
> recently lowered this from 4 OCPUs / 24 GB and disabled VMs that were bigger. This guide uses **1 OCPU and
> 6 GB**, well inside the limit and still far more than the server needs. Check the current limits on
> Oracle's *Free Tier* page before you start.

---

## Contents

- [How it fits together](#how-it-fits-together)
- [Part 0: What you need](#part-0-what-you-need)
- [Part 1: Create an Oracle Cloud account](#part-1-create-an-oracle-cloud-account)
- [Part 2: Make an SSH key on your computer](#part-2-make-an-ssh-key-on-your-computer)
- [Part 3: Create the VM](#part-3-create-the-vm)
- [Part 4: Log in to the VM](#part-4-log-in-to-the-vm)
- [Part 5: Updates, Docker and Git](#part-5-updates-docker-and-git)
- [Part 6: Download and start the friends server](#part-6-download-and-start-the-friends-server)
- [Part 7: Make it reachable from anywhere (Tailscale Funnel)](#part-7-make-it-reachable-from-anywhere-tailscale-funnel)
- [Part 8: Connect the app](#part-8-connect-the-app)
- [Part 9: Move your data from the Pi (optional)](#part-9-move-your-data-from-the-pi-optional)
- [Part 10: Automatic weekly backups](#part-10-automatic-weekly-backups)
- [Part 11: Check that everything survives a restart](#part-11-check-that-everything-survives-a-restart)
- [Keep the free VM safe](#keep-the-free-vm-safe)
- [Everyday use](#everyday-use)
- [Troubleshooting](#troubleshooting)

---

## How it fits together

```
 Friend's phone on the mountain
          │  https://skicloud.tail1a2b.ts.net
          ▼
 Tailscale's servers (on the internet)
          │  encrypted tunnel, started by the VM itself
          ▼
 Oracle Cloud VM (Ubuntu, Arm)
  ├── Tailscale (keeps the tunnel open)
  └── Docker
       └── friends server (port 8787)
            └── data/ski-friends.db  (groups, accounts, day totals, challenge times, backups)
```

- Oracle gives you a small computer in their data centre (a **VM**). You control it from your own computer
  over **SSH**, just like the Pi.
- **Tailscale Funnel** gives it a public `https://` address. The VM connects *out* to Tailscale, so you
  don't open any ports in Oracle's firewall: only SSH (port 22) is open, and that's protected by your key.

---

## Part 0: What you need

- A computer with Windows 10/11, macOS or Linux.
- An e-mail address and a **credit or debit card**. Oracle uses the card only to check you're a real person
  (you may see a small temporary charge that is refunded). As long as you don't upgrade your account, you
  can't be charged.
- A **Tailscale** account (free, Part 7). If you already set up the Pi with Tailscale, use the same account.
- If you're moving from a Pi: your **server password** (in `~/SKI-APP/server/.env` on the Pi).

Write these down as you go:

```
Oracle home region:      .................... (Part 1, can't be changed later)
VM public IP:            ...............      (Part 3)
Server password:         ....................  (Part 6.2, same as on the Pi if you move)
Public server address:   https://................ts.net (Part 7)
```

---

## Part 1: Create an Oracle Cloud account

1. Go to **oracle.com/cloud/free** and click **Start for free**.
2. Fill in your country, name and e-mail, and confirm the e-mail.
3. **Home region: choose carefully, you can't change it later.** The free VM can only run in your home
   region. Pick one close to you, e.g. **Germany Central (Frankfurt)** or **Netherlands Northwest
   (Amsterdam)**. Busy regions sometimes run out of free Arm VMs (see
   [Troubleshooting](#troubleshooting)).
4. Choose a **cloud account name** (it becomes part of your login, e.g. `skitracker`) and a password.
5. Enter your address and card details, and finish.
6. Setting up the account can take a few minutes up to an hour. You get an e-mail when it's ready.

You start with a 30-day trial with some credit on top. **When the trial ends, the Always Free resources
keep running.** Only the extra credit runs out.

✅ **Checkpoint:** you can log in at **cloud.oracle.com** and see the Oracle Cloud console.

---

## Part 2: Make an SSH key on your computer

An SSH key is how you log in to the VM: a pair of files, one secret (stays on your computer) and one
public (you give to Oracle). There's no password to guess, so it's very safe.

Open a terminal: on **Windows** open **PowerShell**, on **macOS** open **Terminal**.

```bash
ssh-keygen -t ed25519 -C skicloud
```

- It asks where to save it: press **Enter** for the default.
- It asks for a passphrase: press **Enter** twice for none, or type one you'll remember.
- If it says the file already exists, you already have a key: type `n` and use the existing one.

Show the **public** key:

```bash
cat ~/.ssh/id_ed25519.pub
```

It's one long line starting with `ssh-ed25519`. Keep this window open: you paste that line in Part 3.

**Never share the file without `.pub`** (`id_ed25519`): that's your secret key.

✅ **Checkpoint:** `cat ~/.ssh/id_ed25519.pub` shows a line starting with `ssh-ed25519`.

---

## Part 3: Create the VM

Oracle's console changes its layout now and then. Look for the labels below; they've stayed the same for a
long time even when buttons move.

1. In the console, open the menu (☰) → **Compute** → **Instances**, and click **Create instance**.
2. **Name:** `skicloud`.
3. **Image and shape** → **Edit**:
   - **Image:** click **Change image**, choose **Ubuntu**, and pick the newest **Canonical Ubuntu**
     LTS version (e.g. 24.04). Not the "Minimal" one.
   - **Shape:** click **Change shape** → **Ampere** → **VM.Standard.A1.Flex**. Set **1 OCPU** and
     **6 GB memory**. It should show an **Always Free-eligible** label.
4. **Networking:** keep **Create new virtual cloud network** and **Create new public subnet**, and make sure
   **Automatically assign public IPv4 address** is on.
5. **Add SSH keys:** choose **Paste public keys** and paste the `ssh-ed25519 …` line from Part 2.
6. **Boot volume:** leave it as it is (about 50 GB, inside the free 200 GB).
7. Click **Create**.

The VM is ready when its status says **Running** (1–3 minutes). On the instance page, find **Public IP
address** (e.g. `141.144.12.34`) and **write it down**.

> **"Out of capacity for shape VM.Standard.A1.Flex"?** Your region has no free Arm VMs right now. Try a
> different **Availability domain** (under Placement, if your region has more than one), or try again later:
> early morning often works. Nothing is charged for failed attempts.

✅ **Checkpoint:** the instance `skicloud` shows **Running** and has a public IP address.

---

## Part 4: Log in to the VM

In your terminal (with the VM's IP):

```bash
ssh ubuntu@141.144.12.34
```

- The username for Ubuntu VMs on Oracle is always **`ubuntu`**.
- The first time it asks `Are you sure you want to continue connecting (yes/no)?`: type `yes` and Enter.
- If you set a passphrase in Part 2, type it.

Your prompt now looks like `ubuntu@skicloud:~$`. Everything you type now runs on the VM.

To log out: `exit`. To log back in: the same `ssh` command.

✅ **Checkpoint:** your prompt shows `ubuntu@skicloud`.

---

## Part 5: Updates, Docker and Git

### 5.1 Install all updates

```bash
sudo apt update && sudo apt full-upgrade -y
```

If a purple screen asks which services to restart, press **Enter** to accept. Ubuntu installs security
updates automatically by itself after this.

Restart once to load everything:

```bash
sudo reboot
```

Wait a minute, then log in again (`ssh ubuntu@<ip>`).

### 5.2 Install Docker and Git

```bash
sudo apt install -y git
```

```bash
curl -fsSL https://get.docker.com | sh
```

Allow your user to use Docker without `sudo`:

```bash
sudo usermod -aG docker ubuntu
```

**Log out (`exit`) and log in again** so this takes effect. Then test it:

```bash
docker run --rm hello-world
```

You should see `Hello from Docker!`.

✅ **Checkpoint:** `docker run --rm hello-world` prints `Hello from Docker!` without `sudo`.

---

## Part 6: Download and start the friends server

### 6.1 Download the code

```bash
cd ~ && git clone https://github.com/rhsts/SKI-APP.git && cd ~/SKI-APP/server
```

### 6.2 Set the server password

**Moving from a Pi?** Use **exactly the same password** as on the Pi, so nobody has to enter a new one. You
can see it on the Pi with `cat ~/SKI-APP/server/.env`.

**New server?** Pick one that's easy to share but hard to guess, like `powder-goggles-fondue-42`.

```bash
echo "SERVER_PASSWORD=powder-goggles-fondue-42" > .env
```

**Moving from a Pi?** Don't start the server yet: go to [Part 9](#part-9-move-your-data-from-the-pi-optional)
first to copy your data in, then come back to 6.3.

### 6.3 Build and start it

```bash
docker compose up -d --build
```

The first time takes a few minutes. Then check it:

```bash
docker compose ps
```

```bash
curl http://localhost:8787/v1/health
```

The answer should be:

```
{"ok":true,"app":"ski-tracker-friends","v":2,"accounts":true,"password":true}
```

✅ **Checkpoint:** `docker compose ps` says **Up**, and `/v1/health` shows `"ok":true` and
`"password":true`.

---

## Part 7: Make it reachable from anywhere (Tailscale Funnel)

### 7.1 Install Tailscale and connect it to your account

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

```bash
sudo tailscale up --hostname=skicloud
```

Open the link it prints in your computer's browser, log in to your Tailscale account and click **Connect**.

> **Want to keep the Pi's address** (e.g. `https://skipi.tail1a2b.ts.net`) so your friends don't have to
> change anything? Do [Part 9](#part-9-move-your-data-from-the-pi-optional) first. Then, in the Tailscale
> admin under **Machines**, remove the old `skipi`, and use `--hostname=skipi` in the command above instead.
> The address then stays exactly the same.

### 7.2 Switch on HTTPS (one-time, skip if you did it for the Pi)

1. Open **login.tailscale.com/admin/dns**.
2. Under **MagicDNS**: click **Enable MagicDNS** if it's there.
3. Under **HTTPS Certificates**: click **Enable HTTPS**.

### 7.3 Open the server to the internet

```bash
sudo tailscale funnel --bg 8787
```

If it prints a link saying Funnel isn't enabled for your tailnet, open it, click **Enable**, and run the
command again. When it works it shows:

```
Available on the internet:

https://skicloud.tail1a2b.ts.net/
|-- proxy http://127.0.0.1:8787
```

**Write down the `https://….ts.net` address.** It's your public server address.

### 7.4 Test it

On your phone, on mobile data, open your address plus `/v1/health`, e.g.
`https://skicloud.tail1a2b.ts.net/v1/health`. The first time it can take up to 10 minutes to work.

✅ **Checkpoint:** on your phone, `https://….ts.net/v1/health` shows `{"ok":true,...}`.

---

## Part 8: Connect the app

**Same address as before** (you kept `skipi`): nothing to do. The app keeps working.

**New address:**

1. In the app, go to **Profile → Friends server**, enter the new `https://….ts.net` address and the server
   password, and tap **Connect**.
2. Send your friends the new address (or a new invite from the group's **share** button). They do the same.

**Brand-new server (no data from a Pi):** follow
[Part 10 of SETUP-PI.md](SETUP-PI.md#part-10-connect-the-app-and-invite-your-friends) with your new address.
Create **your** account first: the first account becomes the admin.

✅ **Checkpoint:** the app says **Connected**, and you see your groups.

---

## Part 9: Move your data from the Pi (optional)

This copies everything (groups, accounts, day totals, challenges and online backups of days) from the Pi to
the VM. Do it after Part 6.2 and **before** starting the server on the VM (6.3).

### 9.1 On the Pi: make a final backup and stop the server

Log in to the Pi (`ssh pi@skipi.local`), then:

```bash
cd ~/SKI-APP/server && ./backup.sh && docker compose down
```

Note the file name it prints, e.g. `backups/ski-friends-2026-11-11_1930.db`. The server on the Pi is now
off, so nothing new is written there that would get lost.

Also switch off the Pi's public address, so phones stop trying to reach it:

```bash
sudo tailscale funnel --bg off 8787
```

Then `exit`.

### 9.2 On your computer: copy the backup from the Pi to the VM

In a terminal on **your computer** (use your own file name and VM IP):

```bash
scp pi@skipi.local:SKI-APP/server/backups/ski-friends-2026-11-11_1930.db .
```

```bash
scp ski-friends-2026-11-11_1930.db ubuntu@141.144.12.34:
```

### 9.3 On the VM: put it in place

Log in to the VM (`ssh ubuntu@<ip>`), then:

```bash
mkdir -p ~/SKI-APP/server/data && mv ~/ski-friends-2026-11-11_1930.db ~/SKI-APP/server/data/ski-friends.db
```

Now go back to [Part 6.3](#63-build-and-start-it) and start the server. Then do Part 7 and Part 8.

✅ **Checkpoint:** in the app, your groups, friends and past days are all there.

Keep the Pi as it is for a few weeks, with the server off. If anything goes wrong with Oracle, you can
switch back: copy the newest backup from the VM to the Pi the same way, and run `docker compose up -d` and
`sudo tailscale funnel --bg 8787` on the Pi.

---

## Part 10: Automatic weekly backups

### 10.1 Try it once

```bash
cd ~/SKI-APP/server && ./backup.sh
```

### 10.2 Every Sunday at 04:00

```bash
crontab -e
```

Choose `1` (nano) if it asks, go to the bottom with the arrow keys, and paste:

```
0 4 * * 0 cd ~/SKI-APP/server && ./backup.sh >> backups/backup.log 2>&1
```

Save with **Ctrl + O**, **Enter**, and close with **Ctrl + X**. Check with `crontab -l`.

### 10.3 Keep a copy off the VM (important!)

A free VM comes without guarantees: Oracle can change the rules or remove it (see
[Keep the free VM safe](#keep-the-free-vm-safe)). So keep copies **outside** Oracle. Every month, and before
every ski trip, run this on **your computer**:

```bash
scp -r ubuntu@141.144.12.34:SKI-APP/server/backups ./ski-backups
```

With a backup in hand you can have the server running again on the Pi, or anywhere else, in 15 minutes.

✅ **Checkpoint:** `./backup.sh` works, `crontab -l` shows the backup line, and you have a copy on your
computer.

---

## Part 11: Check that everything survives a restart

```bash
sudo reboot
```

Wait 2 minutes, log in again, and check:

```bash
cd ~/SKI-APP/server && docker compose ps && tailscale funnel status
```

The server should be **Up** and Funnel should show your address. Open `https://….ts.net/v1/health` on your
phone once more.

✅ **Checkpoint:** after the restart everything works. **You're done!** 🎿

---

## Keep the free VM safe

- **Don't upgrade your account** to *Pay As You Go* unless you want to. A Free Tier account can't be
  charged. If you do upgrade (some people do because Oracle is less likely to reclaim VMs on paid
  accounts), set up a **budget alert** under **Billing → Budgets** first, at e.g. €1.
- **Idle VMs can be reclaimed.** Oracle says it may reclaim Always Free VMs that stay almost completely idle
  for a week (very low CPU, network and memory use). The friends server is very light, especially outside
  the ski season. Read the e-mails Oracle sends: they warn you before reclaiming. Check the current rules
  on Oracle's *Free Tier* page.
- **Stay within the free limits.** Keep the A1 VM at 2 OCPUs / 12 GB or less in total, and don't add
  anything that isn't marked **Always Free-eligible**.
- **Keep your backups outside Oracle** (Part 10.3). Then the worst case is 15 minutes of work.
- **Keep only SSH open.** You don't need to open port 8787 in Oracle's firewall (security list): Funnel
  works without it.

---

## Everyday use

Log in (`ssh ubuntu@<ip>`), go to the server folder (`cd ~/SKI-APP/server`), and use:

| What | Command |
|---|---|
| Is the server running? | `docker compose ps` |
| Show the latest log lines | `docker compose logs --tail 50` |
| Restart the server | `docker compose restart` |
| **Update to the newest server version** | `git pull && docker compose up -d --build` |
| Make a backup now | `./backup.sh` |
| Is the public address on? | `tailscale funnel status` |
| Free disk space | `df -h /` |
| Update the VM (monthly) | `sudo apt update && sudo apt full-upgrade -y` |

[Restore a backup](SETUP-PI.md#restore-a-backup) works exactly as on the Pi.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| **"Out of capacity"** when creating the VM | Try another availability domain, or try again later (early morning often works). Some people retry for a few days. |
| `ssh: connect to host … port 22: Connection timed out` | Check the public IP on the instance page, and that the instance is **Running**. |
| `Permission denied (publickey)` | Use `ubuntu@`, not `pi@` or `root@`. Make sure you pasted the `.pub` key from the same computer. |
| `permission denied while trying to connect to the Docker daemon` | You didn't log out and in after `usermod` (Part 5.2). |
| The app says the server password is wrong | Compare `cat .env` on the VM with the password in the app. After changing `.env`, run `docker compose up -d`. |
| `https://….ts.net` doesn't load | Run `tailscale funnel status` on the VM. If it's empty, run `sudo tailscale funnel --bg 8787` again. |
| The groups are empty after moving | The database wasn't in place before the first start. Follow [Restore a backup](SETUP-PI.md#restore-a-backup) with the backup from the Pi. |
| The VM is gone or stopped | Check your e-mail from Oracle. Create a new VM (Parts 3–7) and restore your newest backup, or run the server on the Pi again. |
