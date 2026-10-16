#!/data/data/com.termux/files/usr/bin/bash
cd ~/skinstock
export BASE_URL="https://skinstock.onrender.com"
export APP_PASSWORD=""
export LOCAL_HOSTS="kmbelle.com"
node scripts/relay-blocked-hosts.js >> ~/relay.log 2>&1
