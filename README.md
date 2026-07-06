---
title: Soul Currency Bot
emoji: 🪙
colorFrom: yellow
colorTo: red
sdk: docker
app_port: 8000
pinned: false
---

# Discord Engagement & Currency Bot (ApexGold)

ApexGold is a modular Discord server engagement bot built with **Node.js**, **discord.js (v14)**, and **PostgreSQL** as the database. It features a daily check-in system, automated rate-limited message activity earnings, monthly leaderboard rankings, and administrator customization commands.

---

## Features

1. **Daily Check-in (`/checkin`)**
   - Users claim a configurable amount of daily coins (default: `20`) every 24 hours.
   - Shows dynamic relative cooldown timers matching the remaining time.
   - Audits all awards to a transaction log.

2. **Message Activity Earnings**
   - Active chatting rewards users automatically to incentivize conversation.
   - Anti-spam rate limit: maximum **1 coin** earned per **60 seconds** per user.
   - Daily earning cap: maximum **20 coins** from message activity per user per rolling 24-hour cycle.

3. **User Profiles & Leaderboard (`/balance` and `/leaderboard`)**
   - View your wallet or examine another user's balance.
   - Show top 10 users ranked by coin balances with fancy gold/silver/bronze medals.

4. **Currency Customization (Admin-Only)**
   - `/admin set-currency-name <name>`: Rename the currency server-wide (e.g. Gold, Credits, Gems).
   - `/admin set-currency-icon <emoji or URL>`: Modify the currency icon or emoji (e.g., 🪙, 💎).

5. **Monthly Reset (`/admin reset-cycle`)**
   - Closes the active cycle, archives the rankings in `cycle_results` with their final standings, zeroes out all user balances, and starts a fresh new active cycle.
   - Written as modular functions so scheduling with `node-cron` is seamless.

---

## Schema Diagram (PostgreSQL)

The bot uses the following structured schema:
- **`server_settings`**: Stores custom currency name and icon per server.
- **`users`**: Maintains current balances, server associations, and check-in timestamps.
- **`transactions`**: Complete transaction history log (sources: `'checkin'`, `'message'`, `'reset'`).
- **`message_activity`**: High-resolution timestamp log of awarded messages for rate-limit checks.
- **`cycles`**: Active/inactive monthly leaderboard periods.
- **`cycle_results`**: Historical archive snapshot of finalized monthly leaderboard standings.

---

## Installation & Configuration

### Prerequisites
- **Node.js** `v16.9.0` or higher is required.
- **PostgreSQL** instance running locally or hosted online.

### Setup Instructions

1. **Clone & Install Dependencies**
   ```bash
   npm install
   ```

2. **Create Environment Configuration**
   Copy the example environment file and fill in your credentials:
   ```bash
   cp .env.example .env
   ```
   Modify `.env` with your credentials:
   - `DISCORD_TOKEN`: Your Discord Bot Token (from the Discord Developer Portal).
   - `CLIENT_ID`: The application Client ID of your bot.
   - `GUILD_ID`: (Optional) Your primary Discord testing server ID. Specifying this registers slash commands instantly for testing. Leave blank to register commands globally.
   - `DATABASE_URL`: Your PostgreSQL connection string. Format: `postgresql://username:password@localhost:5432/database_name`

3. **Run Database Migrations & Validation Tests**
   A pre-built verification suite is included to check database migrations, constraints, and business logic:
   ```bash
   npm run test
   ```
   *Note: If no PostgreSQL connection is detected, the test runner automatically launches an in-memory SQL mock engine to safely validate query logic.*

4. **Start the Bot**
   - Production mode:
     ```bash
     npm start
     ```
   - Development mode (runs with nodemon):
     ```bash
     npm run dev
     ```

---

## Codebase Architecture

```
currency_bot/
├── src/
│   ├── commands/             # Slash command implementations
│   │   ├── admin.js          # set-currency-name, set-currency-icon, reset-cycle
│   │   ├── balance.js        # Wallet check command
│   │   ├── checkin.js        # Daily coin claim command
│   │   └── leaderboard.js    # Monthly cycle rankings
│   ├── database/
│   │   ├── db.js             # pg Pool client and migrations runner
│   │   ├── queries.js        # Core SQL queries and transactions logic
│   │   └── schema.sql        # Database tables & indexes design
│   ├── events/               # Discord gateway event handlers
│   │   ├── interactionCreate.js
│   │   ├── messageCreate.js
│   │   └── ready.js
│   └── index.js              # Application entry point
├── .env.example              # Env template
├── package.json              # Project metadata & dependencies
└── verifyDb.js               # Offline integration testing script
```

---

## Automating Monthly Resets

To automatically reset the cycle at the end of every month using `node-cron`, you can create a simple automation script (e.g. `cron.js`):

```javascript
const cron = require('node-cron');
const { resetCycle } = require('./src/database/queries');

// Run at 00:00 (midnight) on the 1st day of every month
cron.schedule('0 0 1 * *', async () => {
  console.log('Automated month-end reset triggered...');
  const YOUR_SERVER_ID = 'your_server_id_here';
  try {
    const result = await resetCycle(YOUR_SERVER_ID);
    console.log(`Successfully completed cycle reset. Archived ${result.archivedCount} users.`);
  } catch (error) {
    console.error('Failed to run automated cycle reset:', error);
  }
});
```
