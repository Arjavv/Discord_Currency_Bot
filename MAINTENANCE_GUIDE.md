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
