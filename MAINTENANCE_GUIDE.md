# Bot Maintenance & Developer Guide

This guide is designed to help you independently manage, troubleshoot, and update your Discord bot. It covers the project structure, how to edit files to fix errors, and how to commit your changes to GitHub.

## 📁 Project Structure

Here is how the files in your bot are arranged:

- `src/` - The core logic of your bot.
  - `index.js` - The main entry point. It logs into Discord, loads commands and events, and runs the admin web dashboard.
  - `commands/` - Contains all the slash commands (e.g., `checkin.js`, `shop.js`). If a command has an error, you look here.
  - `events/` - Contains Discord event listeners like `ready.js` or `messageCreate.js`.
  - `database/` - Contains database connection logic (`db.js`) and all queries (`queries.js`). If data isn't saving, check here.
  - `utils/` - Helper files and configurations (e.g., `characters.js`, `botControl.js`).
- `docs/` - Contains the HTML, CSS, and client-side JavaScript for the Admin Dashboard and web UI.
  - `admin.html` - The main Admin Dashboard file.
- `.env` - Your private environment variables (Bot token, Database URL). **Never share this file or push it to GitHub.**
- `package.json` - Lists the bot's dependencies and scripts.

---

## 🛠️ How to Edit Files for Errors

When the bot crashes or something misaligns, here is how you can find and fix it:

1. **Check the Admin Dashboard Crash Logs:** 
   We have added a new "Crash Logs" section in your Mission Control admin panel. It will show you the exact error message and the file/line number where it happened (e.g., `TypeError at src/commands/shop.js:45:12`).

2. **Locate the File:**
   Based on the crash log, open the corresponding file in your editor. For example, if it says `src/commands/shop.js:45`, open `src/commands/shop.js` and look at line 45.

3. **Make the Edit:**
   - Look for typos, missing variables, or incorrect logic.
   - You can add `console.log(variableName);` before the error line to see what data is flowing through.
   - Save the file once you have made your changes.

4. **Restart the Bot:**
   For the changes to take effect, you must restart the bot process.
   Stop the bot (usually `Ctrl+C` in your terminal) and run it again:
   ```bash
   node src/index.js
   ```
   *(Or however you normally start the bot, e.g., `npm start` or using PM2).*

---

## 🚀 Committing Changes to GitHub

Once you have fixed a bug or made a change, you should save it to GitHub so you don't lose your work.

Open a terminal (or command prompt) in the `currency_bot` folder and run these commands one by one:

1. **See what files you changed:**
   ```bash
   git status
   ```
   *(This shows modified files in red).*

2. **Stage your changes (prepare them to be saved):**
   ```bash
   git add .
   ```
   *(The `.` means "add everything that changed" except what's in `.gitignore` like `.env`).*

3. **Commit your changes with a descriptive message:**
   ```bash
   git commit -m "Fixed a bug in the shop command"
   ```
   *(Replace the text inside the quotes with a brief description of what you did).*

4. **Push the changes to GitHub:**
   ```bash
   git push origin main
   ```
   *(If your main branch is called `master`, use `git push origin master` instead).*

🎉 **Congratulations!** Your changes are now safely backed up on GitHub.

---

## 🚨 Troubleshooting Common Cloud Deployment Issues

When deploying to Render, you might run into specific networking issues that don't happen locally. Here is how to fix them:

### 1. Discord Bot Stays Offline & Hangs at "Preparing to connect..."
* **Symptoms:** The bot runs fine locally, but on Render it stays offline. Logs show `Preparing to connect to the gateway...` followed by `Discord login timed out after 30 seconds`.
* **Root Cause:** Node.js tries to connect to Discord using IPv6 first. If Render's network routing is incomplete or if Discord's firewall blocks Render's shared IP address range, the connection hangs.
* **Resolution:**
  1. We resolved this in code by monkeypatching `dns.lookup` in `src/index.js` to force IPv4 for Discord endpoints.
  2. If the problem persists, it means Discord has blocked the entire Render IP range in that region. Go to **Render** and recreate the Web Service in a different region (e.g. **Frankfurt, Germany** or **Singapore**). This routes the bot through a fresh, unblocked IP range.

### 2. Database Connection Fails with `ENETUNREACH`
* **Symptoms:** The bot crashes on startup with the error `FATAL: Database init failed: Error: connect ENETUNREACH <IPv6 address>:5432`.
* **Root Cause:** Supabase databases use **IPv6-only** direct connection strings. If your Render region (like Singapore) is **IPv4-only**, the server cannot route IPv6 traffic, throwing "Network Unreachable".
* **Resolution:**
  1. **Do not use the Direct Connection link.**
  2. Go to your **Supabase Settings** -> **Database**.
  3. Under **Connection Pooler**, select **Mode: Session** and copy the pooling connection string.
  4. Replace `[YOUR-PASSWORD]` with your actual password (ensure `@` is encoded as `%40` as `Currency_bot%4011062005`).
  5. Use this new pooler string as the `DATABASE_URL` in Render. It runs over IPv4 and will connect instantly.

### 3. Bot Responds Twice to Commands (Double Responses)
* **Symptoms:** Whenever you type a command in Discord, the bot replies twice.
* **Root Cause:** You have two instances of the bot running at the same time: one locally on your PC, and one in the cloud on Render.
* **Resolution:**
  * Open your local [.env](file:///e:/Discord_bots/currency_bot/.env) file and ensure `RUN_DISCORD_CLIENT=false` is set. This allows you to run the local admin panel/dashboard without the local process logging into Discord.

