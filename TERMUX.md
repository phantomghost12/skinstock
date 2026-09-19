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
