-- Database Schema for ApexGold Discord Currency Bot

-- 1. Server settings table to store customizable currency options
CREATE TABLE IF NOT EXISTS server_settings (
    server_id VARCHAR(64) PRIMARY KEY,
    currency_name VARCHAR(64) DEFAULT 'Souls',
    currency_icon_url VARCHAR(256) DEFAULT '<:Soul_Head:1523605643158618214>',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users table to store balances and check-in timestamps
CREATE TABLE IF NOT EXISTS users (
    discord_id VARCHAR(64) NOT NULL,
    server_id VARCHAR(64) NOT NULL,
    coin_balance INT NOT NULL DEFAULT 0,
    last_checkin_at TIMESTAMP,
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
    source VARCHAR(32) NOT NULL, -- e.g. 'checkin', 'message', 'reset'
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
