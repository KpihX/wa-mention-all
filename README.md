# wa-mention-all  
*Author: KpihX*

## 1. Project Overview

**`wa-mention-all`** is a self-hosted WhatsApp group “mention all” bot designed to run persistently on a minimal Oracle Cloud Always Free instance.  
Its primary function: when the author (you) sends `# <message>` in a WhatsApp group, the bot replies by tagging/mentioning **every participant** in that group.  
A forced override uses `#! <message>` to bypass rate limits.

This repository contains:
- Persistent session management with WhatsApp via Baileys.
- Rate-limited “mention all” trigger.
- Self-healing and auto-reconnect logic.
- Keep-alive mechanism so Oracle Cloud won’t consider the VM idle.
- `pm2` supervision for 24/7 resilience across reboots.

---

## 2. Architecture and Flow

```
+----------------------+        +------------------------+         +---------------------+
| WhatsApp Group       | <----> | WhatsApp Account (you) | <-----> | wa-mention-all  Bot |
| (members)            |         | (mobile, QR scan)      |          | running on Oracle   |
+----------------------+         +------------------------+         +---------------------+
                                                                       |        |
                                                                       |        |
                                              +------------------------+        +------------------+
                                              |                                         |
                                   +----------v-----------+              +----------v----------+
                                   | bot.js (Baileys client)|              | keepalive.sh ping  |
                                   | handles "#..."         |              | (avoids idle)      |
                                   +----------+-----------+              +----------+----------+
                                              |                                     |
                                mentions all participants                         keeps instance active
                                              |                                     |
                                       WhatsApp group <-----------------------------+
```

### Key components
- `bot.js`: Core logic. Watches for triggers (`#` or `#!`) from *your own* WhatsApp account and replies by mentioning all group members, with throttle and auto-reconnect.
- `keepalive.sh`: Periodically pings an external endpoint to keep the Oracle Cloud instance considered “active” (prevents automatic suspension due to idleness).
- `pm2`: Supervises both `bot.js` and `keepalive.sh`, ensuring they restart on crashes and persist across reboots.
- `auth/`: Persistent WhatsApp session credentials — do **not** delete unless you intentionally want to re-authenticate (requires rescanning QR).
- `node_modules`, `package.json`: Dependencies, including `baileys` for WhatsApp Web protocol handling.

---

## 3. File Descriptions

- `bot.js`  
  - Listens for messages you send in groups starting with `#` (normal) or `#!` (force).  
  - Builds a mention list of all group participants and sends `📣 <your message>` with mentions.  
  - Deletes the original trigger message if possible.  
  - Applies configurable throttling to avoid abuse.  
  - Auto-reconnects if the WhatsApp connection drops.

- `keepalive.sh`  
  - Bash loop that `curl`s an external endpoint every 10 minutes to create outbound traffic, preventing Oracle from marking the VM idle.  
  - Resilient to transient failures.

- `auth/`  
  - Holds WhatsApp session data. Keeps you logged in without rescanning the QR each time.

- `package.json` & `package-lock.json`  
  - Node project metadata and locked dependency versions.

- `node_modules/`  
  - Installed libraries (`baileys`, `qrcode-terminal`, `pino`, etc.)

---

## 4. Configuration

Environment variables (used by `bot.js`):

| Name             | Default | Meaning |
|------------------|---------|---------|
| `THROTTLE_SEC`   | `1`     | Minimum seconds between successive `#` mentions per group (can be bypassed with `#!`) |
| `THROTTLE_FEEDBACK` | `0` or `1` | If `1`, bot sends a “wait” message when throttled; if `0`, it just logs internally |

Usage example overriding defaults:
```bash
THROTTLE_SEC=5 THROTTLE_FEEDBACK=1 node bot.js
```

---

## 5. Installation & Setup (fresh instance)

```bash
# 1. Update and install basics (if not already)
sudo apt update && sudo apt install -y curl git build-essential

# 2. Ensure Node.js (v22+ recommended) is installed. Example via NodeSource:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Move to project directory (if cloned already)
cd ~/wa-mention-all

# 4. Install dependencies
npm install baileys qrcode-terminal pino

# 5. Create or verify bot.js and keepalive.sh are present (they should be here)
# 6. Launch for first time to scan QR
node bot.js
# Scan the QR code from the terminal with WhatsApp on your phone (Linked Devices -> Link a device)
```

---

## 6. Usage

- In a WhatsApp group where your account is present, send:
  ```
  # Hello everyone!
  ```
  → Bot replies tagging every member: `📣 Hello everyone!`

- To override throttle and force immediate mention even if recently used:
  ```
  #! Urgent message to all
  ```

- Throttling default: 1 second between uses per group (configurable). You can adjust with `THROTTLE_SEC`.

---

## 7. Persistent Deployment (with `pm2`)

Ensure `pm2` is installed and used to manage both the bot and keepalive:

```bash
# Install pm2 globally
sudo npm install -g pm2

# Start bot with pm2 (example: throttle 1s, no feedback)
pm2 start bot.js --name wa-bot --update-env --env THROTTLE_SEC=1 --env THROTTLE_FEEDBACK=0

# Start keepalive script under pm2 (bash interpreter)
pm2 start ./keepalive.sh --name keepalive --interpreter bash

# Save process list (so it can be resurrected)
pm2 save

# Setup startup script so pm2 comes up after reboot
pm2 startup
# Copy-paste the command it outputs, e.g.:
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

Check status:
```bash
pm2 ls
pm2 logs wa-bot
pm2 logs keepalive
```

---

## 8. Keepalive Script Content (for clarity)

```bash
#!/bin/bash
# keepalive.sh : garde l'instance Oracle active en pingant toutes les 10 minutes.
set -e

while true; do
  if curl -fsS https://ifconfig.me > /dev/null; then
    sleep 600
  else
    sleep 60
  fi
done
```

---

## 9. Making it Survive Reboots

`pm2 save` + `pm2 startup` ensure:
- `pm2` daemon is registered as a systemd service.
- On reboot, `pm2` restores saved processes (`wa-bot` and `keepalive`) automatically.
- **No crontab is needed** if both are under `pm2`.

---

## 10. Troubleshooting

- **No QR appears**: Ensure `node bot.js` is running and your terminal supports displaying the ASCII QR. Check network connectivity.
- **Mention not working**: Validate the trigger syntax (`# message`) and confirm you are sending from your own account. Watch logs for `✅ Mentionné X membres`.
- **Throttle message appears**: You hit the throttle; either wait `THROTTLE_SEC` seconds or use `#!` to force.
- **Bot disconnected**: The script auto-reconnects. Look for reconnection logs and eventual `✅ Bot connecté à WhatsApp`.
- **Keepalive not running**: Check with `pm2 ls` for `keepalive`. Use `pm2 logs keepalive` for its output.

---

## 11. Staying in Oracle Cloud Free Tier

You are safe as long as:
- You run only this Always Free–eligible instance (e.g., VM.Standard.E2.1.Micro).  
- You do not provision extra non-free resources.  
- Your scripts produce minimal network egress (keepalive is small) and keep the account active.  
- You don’t manually upgrade to paid shapes unintentionally.

> The keepalive helps the tenancy remain active; `pm2` ensures uptime. No billing will occur if you stay within Always Free constraints.

---

## 12. Security Notes

- **Do not expose the `auth/` directory**: It contains your WhatsApp session.  
- **Limit usage**: Avoid spamming large groups too frequently to prevent WhatsApp rate-limiting or restrictions.  
- **Backup**: You can back up `auth/` securely if you migrate to another instance.

---

## 13. Suggested `.gitignore`

```gitignore
node_modules/
auth/
npm-debug.log
.env
```

---

## 14. Example Commands Summary

```bash
# install deps
npm install baileys qrcode-terminal pino

# first run (scan QR)
node bot.js

# run persistently with pm2
sudo npm install -g pm2
pm2 start bot.js --name wa-bot --env THROTTLE_SEC=1 --env THROTTLE_FEEDBACK=0
pm2 start ./keepalive.sh --name keepalive --interpreter bash
pm2 save
pm2 startup
```

---

## 15. Credits & License

**Author:** KpihX  
**Project:** wa-mention-all  
