# Admin Reference & Configuration Guide

This document describes all configurations, variables, and permissions for the Soul Currency system.

---

## 💻 1. Website Admin Panel Configurations (Bot Owner Only)
Only the bot owner (you) can view and modify these settings. They apply **globally** across all Discord servers where the bot runs.

| Configuration Variable | Default Value | Description |
| :--- | :--- | :--- |
| **`max_fight_bet`** | `10000` | The maximum bet limit allowed for a single duel showdown command (`s fight @user <bet>`). |
| **`duel_cooldown_hours`** | `6` | The cooldown duration (in hours) placed on a player who loses a duel. During this time, they cannot challenge others or be challenged. |
| **`price_dumbbell`** | `150` | Shop price for **Iron Dumbbell** (Weekly Training Upgrades: grants `+5` Strength until Sunday reset). |
| **`price_vest`** | `150` | Shop price for **Kevlar Vest** (Weekly Training Upgrades: grants `+5` Defense until Sunday reset). |
| **`price_shoes`** | `150` | Shop price for **Running Shoes** (Weekly Training Upgrades: grants `+5` Speed until Sunday reset). |
| **`price_tome`** | `150` | Shop price for **Ancient Tome** (Weekly Training Upgrades: grants `+5` Magic until Sunday reset). |
| **`price_rage`** | `300` | Shop price for **Rage Elixir** (24-Hour Consumable: grants `+15` Strength for exactly 24 hours). |
| **`price_aegis`** | `300` | Shop price for **Aegis Serum** (24-Hour Consumable: grants `+15` Defense for exactly 24 hours). |
| **`price_adrenaline`** | `300` | Shop price for **Adrenaline Pill** (24-Hour Consumable: grants `+15` Speed for exactly 24 hours). |
| **`price_mana`** | `300` | Shop price for **Mana Elixir** (24-Hour Consumable: grants `+15` Magic for exactly 24 hours). |
| **`price_shield`** | `500` | Shop price for **Divine Shield** (Inventory item: blocks one robbery attempt automatically). |

---

## 💬 2. Discord Admin Commands (Server Administrators Only)
These setup and configuration commands are available to **local server administrators** (members with the Administrator permission on the server). They configure settings local to their server.

### Setup & Channel Management
* **`s setup`** or **`/admin setup`**
  - **Description**: Automatically creates a dedicated category (`SOUL SYSTEM`) along with the `#soul-bot` channel (for user games/check-ins) and the `#soul-logs` channel (restricted admin logs).
  - **Permissions**: Restricted to Server Administrators. Can be run in any channel.

* **`s set-drop-channel <#channel>`** or **`/admin set-drop-channel [#channel]`**
  - **Description**: Configures the target channel where random currency drops will spawn. Defaults to the current channel if no argument is given.
  - **Permissions**: Restricted to Server Administrators. Can be run in any channel.

### Random Drop Management
* **`/admin auto-drops <start/stop>`**
  - **Description**: Enables or disables the bot's automated background drop loop (slash command only). When enabled, a drop spawns randomly every 10 minutes in the configured drop channel.
  - **Permissions**: Restricted to Server Administrators. Can be run in any channel.

* **`s force-drop`** or **`/admin force-drop`**
  - **Description**: Instantly forces a drop of random coins to spawn in the drop channel for users to claim.
  - **Permissions**: Restricted to Server Administrators. Can be run in any channel.

### Cycle Management
> ⚠️ **Cycle Reset is a Bot Owner–only operation** managed exclusively from the [Admin Cockpit dashboard](https://your-bot-url/admin). Server administrators **cannot** trigger a cycle reset via any Discord command.

---

## 🕒 3. System Resets & Timing Variables

* **Weekly Upgrade Reset**: training stats (Dumbbell, Vest, Shoes, Tome boosts) reset automatically back to `0` for every user on **Sunday midnight (00:00 UTC)**.
* **Potion Buff Expiry**: Potion buffs expire exactly **24 hours** after the time of purchase.
* **Daily Check-in Allowance**: Available exactly once every **24 hours** from the user's last check-in time.
  - `s daily` / `s checkin` / `s claim`: Awards a random **500–1,000 Souls** per claim.
  - `/checkin` (slash): Awards a fixed **20 Souls** per claim.
* **Message Earnings**: Every **10 qualifying messages** (min 5 words, 15s cooldown between counted messages) awards **100 Souls**. Daily cap is **5,000 Souls** from message activity.
* **Robbery Cooldown**: A user is placed on a **1-hour robbery cooldown** after executing a rob command.
* **Monthly Cycle Reset**: Triggered manually from the **Admin Cockpit → Mission Control → Danger Zone**. Archives the top-100 global rankings, resets all balances to 0, and starts a new cycle. Requires typing `RESET CYCLE` to confirm.
