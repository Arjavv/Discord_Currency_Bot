-- Database Schema for ApexGold Discord Currency Bot

-- 1. Server settings table to store customizable currency options
CREATE TABLE IF NOT EXISTS server_settings (
    server_id VARCHAR(64) PRIMARY KEY,
    currency_name VARCHAR(64) DEFAULT 'Souls',
    currency_icon_url VARCHAR(256) DEFAULT '<:Soul_Head:1523605643158618214>',
    drop_channel_id VARCHAR(64),
    auto_drops_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users table to store balances and check-in timestamps
CREATE TABLE IF NOT EXISTS users (
    discord_id VARCHAR(64) NOT NULL,
    server_id VARCHAR(64) NOT NULL,
    coin_balance INT NOT NULL DEFAULT 0,
    last_checkin_at TIMESTAMP,
    last_rob_at TIMESTAMP,
    message_count INT NOT NULL DEFAULT 0,
    PRIMARY KEY (discord_id, server_id)
);

-- Index for sorting leaderboard faster
CREATE INDEX IF NOT EXISTS idx_users_balance ON users (server_id, coin_balance DESC);

-- 3. Transactions table to audit coin movements (check-ins, message activity, cycle resets)
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    server_id VARCHAR(64) NOT NULL,
    amount INT NOT NULL,
    source VARCHAR(32) NOT NULL, -- e.g. 'checkin', 'message', 'reset', 'drop_catch'
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id, server_id) REFERENCES users (discord_id, server_id) ON DELETE CASCADE
);

-- 4. Message activity table to track rate limiting and daily activity caps
CREATE TABLE IF NOT EXISTS message_activity (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    server_id VARCHAR(64) NOT NULL,
    counted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id, server_id) REFERENCES users (discord_id, server_id) ON DELETE CASCADE
);

-- Index for counting messages per user per day quickly
CREATE INDEX IF NOT EXISTS idx_msg_activity_time ON message_activity (user_id, server_id, counted_at DESC);

-- 5. Cycles table to keep track of monthly cycles
CREATE TABLE IF NOT EXISTS cycles (
    id SERIAL PRIMARY KEY,
    server_id VARCHAR(64) NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Partial index to enforce only one active cycle per server
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_cycle ON cycles (server_id) WHERE (is_active = TRUE);

-- 6. Cycle results table to snapshot rankings when a cycle is closed
CREATE TABLE IF NOT EXISTS cycle_results (
    id SERIAL PRIMARY KEY,
    cycle_id INT NOT NULL REFERENCES cycles (id) ON DELETE CASCADE,
    discord_id VARCHAR(64) NOT NULL,
    final_coins INT NOT NULL,
    rank INT NOT NULL
);

-- Migration: Add message_count to users table if not exists (for existing database environments)
ALTER TABLE users ADD COLUMN IF NOT EXISTS message_count INT NOT NULL DEFAULT 0;

-- Migration: Add drop_channel_id to server_settings table if not exists
ALTER TABLE server_settings ADD COLUMN IF NOT EXISTS drop_channel_id VARCHAR(64);

-- Migration: Add last_rob_at to users table if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_rob_at TIMESTAMP;

-- 7. User Stats table (Stores base stats and weekly training upgrades)
CREATE TABLE IF NOT EXISTS user_stats (
    discord_id VARCHAR(64) NOT NULL,
    server_id VARCHAR(64) NOT NULL,
    base_strength INT NOT NULL DEFAULT 50,
    base_defense INT NOT NULL DEFAULT 50,
    base_speed INT NOT NULL DEFAULT 50,
    base_magic INT NOT NULL DEFAULT 50,
    
    boost_strength INT NOT NULL DEFAULT 0,
    boost_defense INT NOT NULL DEFAULT 0,
    boost_speed INT NOT NULL DEFAULT 0,
    boost_magic INT NOT NULL DEFAULT 0,
    
    last_weekly_reset TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_duel_loss_at TIMESTAMP,
    PRIMARY KEY (discord_id, server_id),
    FOREIGN KEY (discord_id, server_id) REFERENCES users (discord_id, server_id) ON DELETE CASCADE
);

-- 8. Table for active 24-hour consumables
CREATE TABLE IF NOT EXISTS active_boosts (
    id SERIAL PRIMARY KEY,
    discord_id VARCHAR(64) NOT NULL,
    server_id VARCHAR(64) NOT NULL,
    stat_type VARCHAR(16) NOT NULL, -- 'strength', 'defense', 'speed', 'magic'
    amount INT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (discord_id, server_id) REFERENCES users (discord_id, server_id) ON DELETE CASCADE
);

-- 9. Table for non-expiring inventories (like Divine Shield)
CREATE TABLE IF NOT EXISTS user_inventory (
    discord_id VARCHAR(64) NOT NULL,
    server_id VARCHAR(64) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    PRIMARY KEY (discord_id, server_id, item_id),
    FOREIGN KEY (discord_id, server_id) REFERENCES users (discord_id, server_id) ON DELETE CASCADE
);

-- 10. Table for custom shop item prices per server
CREATE TABLE IF NOT EXISTS shop_prices (
    server_id VARCHAR(64) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    price INT NOT NULL,
    PRIMARY KEY (server_id, item_id)
);

-- Migration: Add last_duel_loss_at to user_stats if not exists
ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS last_duel_loss_at TIMESTAMP;

-- 11. Table for global bot config settings (prices, max bet, cooldowns)
CREATE TABLE IF NOT EXISTS global_settings (
    key VARCHAR(64) PRIMARY KEY,
    value VARCHAR(256) NOT NULL
);

-- 12. Per-server feature overrides (set by server admins via Discord or by bot owner via admin panel)
CREATE TABLE IF NOT EXISTS server_feature_overrides (
    server_id VARCHAR(64) NOT NULL,
    feature   VARCHAR(64) NOT NULL,
    enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (server_id, feature)
);

-- 13. Server Treasury settings and balance (starts with default of 1 lakh = 100,000)
CREATE TABLE IF NOT EXISTS server_treasury (
    server_id VARCHAR(64) PRIMARY KEY,
    balance BIGINT NOT NULL DEFAULT 100000,
    daily_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 1.00, -- Default 1% daily tax
    win_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 10.00,  -- Default 10% win tax
    sell_tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 10.00,  -- Default 10% sell tax
    total_tax_paid BIGINT NOT NULL DEFAULT 0,
    today_tax_paid BIGINT NOT NULL DEFAULT 0,
    last_tax_deduction_at TIMESTAMP,
    custom_tax_rate NUMERIC(5, 2) DEFAULT NULL
);

-- 14. Track user daily tax payment timestamps per server
CREATE TABLE IF NOT EXISTS user_daily_tax (
    discord_id VARCHAR(64) NOT NULL,
    server_id VARCHAR(64) NOT NULL,
    last_taxed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (discord_id, server_id),
    FOREIGN KEY (discord_id, server_id) REFERENCES users (discord_id, server_id) ON DELETE CASCADE
);

-- Migration: Add bot_channel_id and log_channel_id to server_settings
ALTER TABLE server_settings ADD COLUMN IF NOT EXISTS bot_channel_id VARCHAR(64);
ALTER TABLE server_settings ADD COLUMN IF NOT EXISTS log_channel_id VARCHAR(64);

-- 15. Server-specific giveaway settings and history
CREATE TABLE IF NOT EXISTS server_giveaways (
    server_id VARCHAR(64) PRIMARY KEY,
    last_giveaway_daily BIGINT DEFAULT 0,
    last_giveaway_weekly BIGINT DEFAULT 0,
    last_giveaway_monthly BIGINT DEFAULT 0,
    last_winner_daily TEXT,
    last_winner_weekly TEXT,
    last_winner_monthly TEXT,
    giveaway_ping_template VARCHAR(512),
    giveaway_desc_template TEXT,
    FOREIGN KEY (server_id) REFERENCES server_settings(server_id) ON DELETE CASCADE
);

-- Migration: Add operational cost tracking columns to server_treasury
ALTER TABLE server_treasury ADD COLUMN IF NOT EXISTS total_tax_paid BIGINT NOT NULL DEFAULT 0;
ALTER TABLE server_treasury ADD COLUMN IF NOT EXISTS today_tax_paid BIGINT NOT NULL DEFAULT 0;
ALTER TABLE server_treasury ADD COLUMN IF NOT EXISTS last_tax_deduction_at TIMESTAMP;
ALTER TABLE server_treasury ADD COLUMN IF NOT EXISTS custom_tax_rate NUMERIC(5, 2) DEFAULT NULL;


