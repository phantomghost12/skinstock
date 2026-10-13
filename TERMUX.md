# Running SkinStock entirely on your phone (no PC) via Termux

Termux is a terminal app for Android — it lets your phone run real programs,
including Node.js. This is how you run the SkinStock backend directly on
your phone, so the on-demand refresh button works with zero PC or hosting
involved.

## 1. Install Termux

Get it from **F-Droid**, not the Play Store — the Play Store version is
outdated and no longer maintained:
https://f-droid.org/en/packages/com.termux/

(If you don't have F-Droid yet, its own site walks you through installing
that first — it's just an app store, same as installing any APK from a
trusted source.)

## 2. Set up Node inside Termux

Open Termux and run, one at a time:

```bash
pkg update -y
pkg install -y nodejs unzip
```

## 3. Get the SkinStock files onto your phone

You already have `skinstock.zip` from this chat, downloaded to your phone's
Downloads folder. In Termux:

```bash
termux-setup-storage
```

(This prompts for a permission — allow it, so Termux can see your
Downloads folder.) Then:

```bash
cd ~
unzip /sdcard/Download/skinstock.zip
cd skinstock
npm install
```

`npm install` will take a minute or two the first time — it's downloading
the handful of small libraries the server uses.

## 4. Run it

```bash
node server.js
```

You'll see:
```
SkinStock running at http://localhost:3000
```

Leave that Termux window open (or swipe down and tap the Termux
notification to keep it running in the background), then open **Chrome**
on the same phone and go to:

```
http://localhost:3000
```

## 5. Install it to your home screen

In Chrome: menu (⋮) → **Add to Home screen**. Now you have a SkinStock icon
that opens full-screen like a normal app.

## 6. Day-to-day use

Whenever you want to open SkinStock:
1. Open Termux, run `cd skinstock && node server.js` (or just leave it
   running in the background between uses).
2. Tap the SkinStock icon on your home screen.
3. Tap the refresh button — that's the on-demand scrape you asked for.

If Termux gets closed by Android (some phones aggressively kill background
apps to save battery), the server stops and the app will show "can't
connect" until you restart it with `node server.js` again. If that gets
annoying, tell me and I'll show you how to use `termux-wake-lock` and a
boot script so it stays running persistently in the background.

## 7. Automatically refreshing the sites Render's IP is blocked from

If you've moved the main app to Render (with cron-job.org triggering the
regular refresh) so you no longer run this local server day-to-day, you
can still use this phone — automatically, without opening Termux — to
refresh just the listings a site is blocking from Render's IP. See
`scripts/relay-blocked-hosts.js` for what it does and why.

This uses Android's own job scheduler, so it runs on a timer even with
Termux closed — you don't open the app or type anything after this
one-time setup.

### One-time setup

```bash
pkg install -y termux-api
```

Also install the separate **Termux:API** app from F-Droid (same place you
got Termux) — the `pkg install` above is just the command-line half of it;
without the app installed too, scheduling won't work:
https://f-droid.org/en/packages/com.termux.api/

Then create a small wrapper script (this is what the scheduler will
actually run — environment variables set in your interactive shell aren't
visible to scheduled jobs, so they're hardcoded here instead):

```bash
cat > ~/skinstock/scripts/run-relay.sh << 'SCRIPT'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/skinstock
export BASE_URL="https://your-app.onrender.com"
export APP_PASSWORD=""
export LOCAL_HOSTS="kmbelle.com"
node scripts/relay-blocked-hosts.js >> ~/relay.log 2>&1
SCRIPT
chmod +x ~/skinstock/scripts/run-relay.sh
```

Edit that `BASE_URL` line to your actual Render URL first (and
`APP_PASSWORD` if you've set one on Render — leave it as `""` if not).

Now schedule it — this example runs every 12 hours (43,200,000
milliseconds), matching the Render cron schedule:

```bash
termux-job-scheduler --job-id 1 --period-ms 43200000 --script ~/skinstock/scripts/run-relay.sh
```

That's it — Android will now wake Termux briefly every 12 hours to run
the relay script, even if you haven't opened the app in days. Check
`~/relay.log` any time to see what the last few runs did.

A couple of honest caveats, since this is Android running something in
the background rather than an always-on server: some phones' battery
optimization can still delay or skip a scheduled run if the phone's been
idle for a long time, and `--period-ms` is a minimum interval Android is
allowed to stretch, not a guarantee. If you notice runs aren't happening
reliably, go to Android Settings → Apps → Termux → Battery, and remove
any battery restriction on it.

To cancel the schedule later: `termux-job-scheduler --job-id 1 --cancel`.
