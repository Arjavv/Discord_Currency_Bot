const { pool } = require('./db');

/**
 * Gets server currency settings. Returns default values if settings don't exist.
 */
async function getServerSettings(serverId) {
  const globalSettings = await getGlobalSettings();
  const query = `
    SELECT drop_channel_id, auto_drops_enabled 
    FROM server_settings 
    WHERE server_id = $1
  `;
  try {
    const res = await pool.query(query, [serverId]);
    const settings = res.rows[0] || { drop_channel_id: null, auto_drops_enabled: false };
    return {
      currency_name: globalSettings.currency_name || 'Souls',
      currency_icon_url: globalSettings.currency_icon_url || '🪙',
      drop_channel_id: settings.drop_channel_id,
      auto_drops_enabled: settings.auto_drops_enabled
    };
  } catch (error) {
    console.error(`Error in getServerSettings for server ${serverId}:`, error);
    return {
      currency_name: globalSettings.currency_name || 'Souls',
      currency_icon_url: globalSettings.currency_icon_url || '🪙',
      drop_channel_id: null,
      auto_drops_enabled: false
    };
  }
}

/**
 * Updates a server currency setting (name or icon).
 */
async function updateServerSetting(serverId, currencyName, currencyIconUrl) {
  const query = `
    INSERT INTO server_settings (server_id, currency_name, currency_icon_url)
    VALUES ($1, COALESCE($2, 'Souls'), COALESCE($3, '<:Soul_Head:1523605643158618214>'))
    ON CONFLICT (server_id) 
    DO UPDATE SET 
      currency_name = COALESCE($2, server_settings.currency_name),
      currency_icon_url = COALESCE($3, server_settings.currency_icon_url)
    RETURNING *
  `;
  try {
    const res = await pool.query(query, [serverId, currencyName, currencyIconUrl]);
    return res.rows[0];
  } catch (error) {
    console.error(`Error in updateServerSetting for server ${serverId}:`, error);
    throw error;
  }
}

/**
 * Helper to ensure a user exists in the database.
 */
async function ensureUserExists(client, discordId, serverId) {
  // Ensure the specific server user record exists (to satisfy local foreign keys like message_activity)
  const query = `
    INSERT INTO users (discord_id, server_id, coin_balance)
    VALUES ($1, $2, 0)
    ON CONFLICT (discord_id, server_id) DO NOTHING
  `;
  await client.query(query, [discordId, serverId]);

  // Also ensure the global user record exists
  if (serverId !== 'GLOBAL') {
    const globalQuery = `
      INSERT INTO users (discord_id, server_id, coin_balance)
      VALUES ($1, 'GLOBAL', 0)
      ON CONFLICT (discord_id, server_id) DO NOTHING
    `;
    await client.query(globalQuery, [discordId]);
  }
}

/**
 * Daily Check-in transaction.
 * Cooldown: 24 hours.
 */
async function checkInUser(discordId, serverId, amount = 20) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure user exists
    await ensureUserExists(client, discordId, serverId);

    // 2. Fetch last check-in time
    const userQuery = `
      SELECT last_checkin_at, coin_balance 
      FROM users 
      WHERE discord_id = $1 AND server_id = 'GLOBAL' 
      FOR UPDATE
    `;
    const userRes = await client.query(userQuery, [discordId]);
    const user = userRes.rows[0];

    const now = new Date();
    if (user.last_checkin_at) {
      const lastCheckin = new Date(user.last_checkin_at);
      const timeDiffMs = now.getTime() - lastCheckin.getTime();
      const cooldownMs = 24 * 60 * 60 * 1000; // 24 hours in ms

      if (timeDiffMs < cooldownMs) {
        await client.query('ROLLBACK');
        return {
          success: false,
          cooldownRemainingMs: cooldownMs - timeDiffMs,
          currentBalance: user.coin_balance
        };
      }
    }

    // 3. Update user balance and checkin timestamp
    const updateQuery = `
      UPDATE users 
      SET coin_balance = coin_balance + $1, last_checkin_at = $2
      WHERE discord_id = $3 AND server_id = 'GLOBAL'
      RETURNING coin_balance
    `;
    const updateRes = await client.query(updateQuery, [amount, now, discordId]);
    const newBalance = updateRes.rows[0].coin_balance;

    // 4. Log transaction
    const logQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source, created_at)
      VALUES ($1, 'GLOBAL', $2, 'checkin', $3)
    `;
    await client.query(logQuery, [discordId, amount, now]);

    await client.query('COMMIT');
    return {
      success: true,
      newBalance
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in checkInUser for user ${discordId} on server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Message Activity Earnings transaction.
 * Limits: 1 chat counted per 60 seconds.
 * Milestone: every 100 chats awards 10 coins (up to the daily cap of 20 coins, e.g. 2 milestones/day).
 */
async function recordMessageActivity(discordId, serverId, coinAmount = 10, cooldownSeconds = 0, dailyCap = 20, milestoneInterval = 10) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure user exists
    await ensureUserExists(client, discordId, serverId);

    const now = new Date();

    // 2. Check 60-second rate-limit (kept per-server)
    const limitQuery = `
      SELECT counted_at 
      FROM message_activity 
      WHERE user_id = $1 AND server_id = $2 
      ORDER BY counted_at DESC 
      LIMIT 1
    `;
    const limitRes = await client.query(limitQuery, [discordId, serverId]);
    if (limitRes.rows.length > 0) {
      const lastCounted = new Date(limitRes.rows[0].counted_at);
      const timeDiffSeconds = (now.getTime() - lastCounted.getTime()) / 1000;
      if (timeDiffSeconds < cooldownSeconds) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'cooldown', timeRemaining: cooldownSeconds - timeDiffSeconds };
      }
    }

    // 3. Insert message activity log (qualifying chat event - kept per-server)
    const activityQuery = `
      INSERT INTO message_activity (user_id, server_id, counted_at)
      VALUES ($1, $2, $3)
    `;
    await client.query(activityQuery, [discordId, serverId, now]);

    // 4. Increment message count globally
    const incrementQuery = `
      UPDATE users 
      SET message_count = message_count + 1 
      WHERE discord_id = $1 AND server_id = 'GLOBAL'
      RETURNING message_count, coin_balance
    `;
    const incRes = await client.query(incrementQuery, [discordId]);
    const messageCount = incRes.rows[0].message_count;
    let balance = incRes.rows[0].coin_balance;

    // 5. Check if we hit the message milestone
    if (messageCount > 0 && messageCount % milestoneInterval === 0) {
      // Check daily cap from message rewards in last 24 hours globally
      const dailyQuery = `
        SELECT COALESCE(SUM(amount), 0) AS daily_sum 
        FROM transactions 
        WHERE user_id = $1 AND server_id = 'GLOBAL' AND source = 'message' AND created_at >= NOW() - INTERVAL '24 hours'
      `;
      const dailyRes = await client.query(dailyQuery, [discordId]);
      const dailySum = parseInt(dailyRes.rows[0].daily_sum, 10);

      if (dailySum >= dailyCap) {
        await client.query('COMMIT');
        return {
          success: true,
          awardedMilestone: false,
          reason: 'daily_cap',
          dailySum,
          totalMessages: messageCount,
          newBalance: balance
        };
      }

      // Calculate safe reward amount up to cap
      const amountToAward = Math.min(coinAmount, dailyCap - dailySum);
      if (amountToAward <= 0) {
        await client.query('COMMIT');
        return {
          success: true,
          awardedMilestone: false,
          reason: 'daily_cap',
          dailySum,
          totalMessages: messageCount,
          newBalance: balance
        };
      }

      // Award milestone coins globally
      const updateBalanceQuery = `
        UPDATE users 
        SET coin_balance = coin_balance + $1 
        WHERE discord_id = $2 AND server_id = 'GLOBAL'
        RETURNING coin_balance
      `;
      const updateRes = await client.query(updateBalanceQuery, [amountToAward, discordId]);
      balance = updateRes.rows[0].coin_balance;

      // Log transaction globally
      const logQuery = `
        INSERT INTO transactions (user_id, server_id, amount, source, created_at)
        VALUES ($1, 'GLOBAL', $2, 'message', $3)
      `;
      await client.query(logQuery, [discordId, amountToAward, now]);

      await client.query('COMMIT');
      return {
        success: true,
        awardedMilestone: true,
        amountAwarded: amountToAward,
        newBalance: balance,
        dailySum: dailySum + amountToAward,
        totalMessages: messageCount
      };
    }

    await client.query('COMMIT');
    return {
      success: true,
      awardedMilestone: false,
      totalMessages: messageCount,
      newBalance: balance
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in recordMessageActivity for user ${discordId} on server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Gets user's balance and current currency settings.
 */
async function getUserBalance(discordId, serverId) {
  try {
    const settings = await getServerSettings(serverId);

    // Ensure user exists first globally
    const client = await pool.connect();
    try {
      await ensureUserExists(client, discordId, 'GLOBAL');
    } finally {
      client.release();
    }

    const query = `
      SELECT coin_balance 
      FROM users 
      WHERE discord_id = $1 AND server_id = 'GLOBAL'
    `;
    const res = await pool.query(query, [discordId]);
    const balance = res.rows.length > 0 ? res.rows[0].coin_balance : 0;

    return {
      balance,
      currencyName: settings.currency_name,
      currencyIcon: settings.currency_icon_url
    };
  } catch (error) {
    console.error(`Error in getUserBalance for user ${discordId} on server ${serverId}:`, error);
    throw error;
  }
}

/**
 * Retrieves the top 10 users ranked globally by coin_balance.
 */
async function getLeaderboard(serverId, limit = 10) {
  try {
    const settings = await getServerSettings(serverId);
    const query = `
      SELECT discord_id, coin_balance 
      FROM users 
      WHERE server_id = 'GLOBAL' AND coin_balance > 0
      ORDER BY coin_balance DESC 
      LIMIT $1
    `;
    const res = await pool.query(query, [limit]);
    return {
      rankings: res.rows,
      currencyName: settings.currency_name,
      currencyIcon: settings.currency_icon_url
    };
  } catch (error) {
    console.error(`Error in getLeaderboard for server ${serverId}:`, error);
    throw error;
  }
}

/**
 * Resets the current monthly cycle.
 * Closes the active cycle, archives top rankings into cycle_results,
 * resets all balances, and launches a new cycle.
 */
async function resetCycle(serverId) {
  return {
    success: false,
    reason: 'global_economy'
  };
}

/**
 * Casino Game Transaction.
 * Deducts bet amount on loss, awards net bet amount on win.
 * Logs transaction with source 'casino_win' or 'casino_loss'.
 */
async function recordCasinoGame(discordId, serverId, betAmount, isWin) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure user exists globally
    await ensureUserExists(client, discordId, serverId);

    // 2. Fetch current user balance globally
    const balanceQuery = `
      SELECT coin_balance 
      FROM users 
      WHERE discord_id = $1 AND server_id = 'GLOBAL' 
      FOR UPDATE
    `;
    const balanceRes = await client.query(balanceQuery, [discordId]);
    const currentBalance = balanceRes.rows[0].coin_balance;

    if (currentBalance < betAmount) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'insufficient_funds', currentBalance };
    }

    // 3. Calculate new balance globally
    const netChange = isWin ? betAmount : -betAmount;
    const updateQuery = `
      UPDATE users 
      SET coin_balance = coin_balance + $1 
      WHERE discord_id = $2 AND server_id = 'GLOBAL'
      RETURNING coin_balance
    `;
    const updateRes = await client.query(updateQuery, [netChange, discordId]);
    const newBalance = updateRes.rows[0].coin_balance;

    // 4. Log transaction globally
    const logQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source)
      VALUES ($1, 'GLOBAL', $2, $3)
    `;
    const source = isWin ? 'casino_win' : 'casino_loss';
    await client.query(logQuery, [discordId, netChange, source]);

    await client.query('COMMIT');
    return {
      success: true,
      won: isWin,
      netChange,
      newBalance
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in recordCasinoGame for user ${discordId} on server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Updates the drop channel ID for a server.
 */
async function updateDropChannel(serverId, channelId) {
  const query = `
    INSERT INTO server_settings (server_id, drop_channel_id)
    VALUES ($1, $2)
    ON CONFLICT (server_id) 
    DO UPDATE SET drop_channel_id = $2
    RETURNING *
  `;
  try {
    const res = await pool.query(query, [serverId, channelId]);
    return res.rows[0];
  } catch (error) {
    console.error(`Error in updateDropChannel for server ${serverId}:`, error);
    throw error;
  }
}

/**
 * Toggles auto drops for a server.
 */
async function toggleAutoDrops(serverId, enabled) {
  const query = `
    INSERT INTO server_settings (server_id, auto_drops_enabled)
    VALUES ($1, $2)
    ON CONFLICT (server_id) 
    DO UPDATE SET auto_drops_enabled = $2
    RETURNING *
  `;
  try {
    const res = await pool.query(query, [serverId, enabled]);
    return res.rows[0];
  } catch (error) {
    console.error(`Error in toggleAutoDrops for server ${serverId}:`, error);
    throw error;
  }
}

/**
 * Awards coins from catching a drop globally.
 */
async function awardDropCoins(discordId, serverId, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure user exists globally
    await ensureUserExists(client, discordId, serverId);

    // Update user balance globally
    const updateQuery = `
      UPDATE users 
      SET coin_balance = coin_balance + $1
      WHERE discord_id = $2 AND server_id = 'GLOBAL'
      RETURNING coin_balance
    `;
    const updateRes = await client.query(updateQuery, [amount, discordId]);
    const newBalance = updateRes.rows[0].coin_balance;

    // Log transaction globally
    const logQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source)
      VALUES ($1, 'GLOBAL', $2, 'drop_catch')
    `;
    await client.query(logQuery, [discordId, amount]);

    await client.query('COMMIT');
    return {
      success: true,
      amount,
      newBalance
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in awardDropCoins for user ${discordId} on server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Transfers coins from one user to another.
 */
async function transferCoins(senderId, receiverId, serverId, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure both users exist globally
    await ensureUserExists(client, senderId, serverId);
    await ensureUserExists(client, receiverId, serverId);

    // 2. Fetch sender balance globally with row lock
    const senderBalanceQuery = `
      SELECT coin_balance 
      FROM users 
      WHERE discord_id = $1 AND server_id = 'GLOBAL' 
      FOR UPDATE
    `;
    const senderRes = await client.query(senderBalanceQuery, [senderId]);
    const senderBalance = senderRes.rows[0].coin_balance;

    if (senderBalance < amount) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'insufficient_funds', currentBalance: senderBalance };
    }

    // 3. Deduct from sender globally
    const deductQuery = `
      UPDATE users 
      SET coin_balance = coin_balance - $1
      WHERE discord_id = $2 AND server_id = 'GLOBAL'
      RETURNING coin_balance
    `;
    const newSenderBalance = (await client.query(deductQuery, [amount, senderId])).rows[0].coin_balance;

    // 4. Add to receiver globally
    const addQuery = `
      UPDATE users 
      SET coin_balance = coin_balance + $1
      WHERE discord_id = $2 AND server_id = 'GLOBAL'
    `;
    await client.query(addQuery, [amount, receiverId]);

    // 5. Log transaction globally for sender
    const logSenderQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source)
      VALUES ($1, 'GLOBAL', $2, 'transfer_sent')
    `;
    await client.query(logSenderQuery, [senderId, -amount]);

    // 6. Log transaction globally for receiver
    const logReceiverQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source)
      VALUES ($1, 'GLOBAL', $2, 'transfer_received')
    `;
    await client.query(logReceiverQuery, [receiverId, amount]);

    await client.query('COMMIT');
    return {
      success: true,
      newSenderBalance
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in transferCoins for server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Attempts to rob a user.
 */
async function attemptRob(robberId, targetId, serverId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure both users exist globally
    await ensureUserExists(client, robberId, 'GLOBAL');
    await ensureUserExists(client, targetId, 'GLOBAL');

    // 2. Fetch robber data globally with row lock
    const robberQuery = `
      SELECT coin_balance, last_rob_at 
      FROM users 
      WHERE discord_id = $1 AND server_id = 'GLOBAL' 
      FOR UPDATE
    `;
    const robberRes = await client.query(robberQuery, [robberId]);
    const robberBalance = robberRes.rows[0].coin_balance;
    const lastRobAt = robberRes.rows[0].last_rob_at;

    // 3. Check 1-hour cooldown globally
    if (lastRobAt) {
      const msSinceLastRob = Date.now() - new Date(lastRobAt).getTime();
      const cooldownMs = 1 * 60 * 60 * 1000;
      if (msSinceLastRob < cooldownMs) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'cooldown', cooldownRemainingMs: cooldownMs - msSinceLastRob };
      }
    }

    // 4. Fetch target balance globally with row lock
    const targetQuery = `
      SELECT coin_balance 
      FROM users 
      WHERE discord_id = $1 AND server_id = 'GLOBAL' 
      FOR UPDATE
    `;
    const targetRes = await client.query(targetQuery, [targetId]);
    const targetBalance = targetRes.rows[0].coin_balance;

    // Minimum balance checks to make robbing fair (both need at least 20 coins)
    if (robberBalance < 20) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'robber_poor' };
    }
    if (targetBalance < 20) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'target_poor' };
    }

    // 5. Update last_rob_at for robber immediately globally
    const updateRobTimeQuery = `
      UPDATE users SET last_rob_at = NOW() 
      WHERE discord_id = $1 AND server_id = 'GLOBAL'
    `;
    await client.query(updateRobTimeQuery, [robberId]);

    // Check target's Divine Shield globally
    const hasShield = await checkAndConsumeShield(client, targetId, 'GLOBAL');
    if (hasShield) {
      await client.query('COMMIT');
      return { success: false, reason: 'shield_blocked' };
    }

    // 6. Roll the dice! (30% success chance)
    const isSuccess = Math.random() < 0.30;

    if (isSuccess) {
      // Steal 10% of target's wallet
      const stolenAmount = Math.floor(targetBalance * 0.10);
      
      if (stolenAmount <= 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'target_poor' }; // Failsafe
      }

      await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE discord_id = $2 AND server_id = 'GLOBAL'`, [stolenAmount, targetId]);
      await client.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE discord_id = $2 AND server_id = 'GLOBAL'`, [stolenAmount, robberId]);
      
      await client.query(`INSERT INTO transactions (user_id, server_id, amount, source) VALUES ($1, 'GLOBAL', $2, 'rob_success_gain')`, [robberId, stolenAmount]);
      await client.query(`INSERT INTO transactions (user_id, server_id, amount, source) VALUES ($1, 'GLOBAL', $2, 'rob_success_loss')`, [targetId, -stolenAmount]);

      await client.query('COMMIT');
      return { success: true, amount: stolenAmount, newBalance: robberBalance + stolenAmount };
    } else {
      // Caught! Pay 5% of robber's wallet
      const fineAmount = Math.floor(robberBalance * 0.05);

      if (fineAmount > 0) {
        await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE discord_id = $2 AND server_id = 'GLOBAL'`, [fineAmount, robberId]);
        await client.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE discord_id = $2 AND server_id = 'GLOBAL'`, [fineAmount, targetId]);
        
        await client.query(`INSERT INTO transactions (user_id, server_id, amount, source) VALUES ($1, 'GLOBAL', $2, 'rob_caught_fine')`, [robberId, -fineAmount]);
        await client.query(`INSERT INTO transactions (user_id, server_id, amount, source) VALUES ($1, 'GLOBAL', $2, 'rob_caught_reward')`, [targetId, fineAmount]);
      }

      await client.query('COMMIT');
      return { success: false, reason: 'caught', amount: fineAmount, newBalance: robberBalance - fineAmount };
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in attemptRob for server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Cleans up old transaction and message_activity records.
 * Keeps the last 48 hours of data (24h needed for daily cap checks + 24h safety buffer).
 * Should be called on a periodic interval to prevent unbounded table growth.
 */
async function cleanupOldRecords() {
  try {
    const txResult = await pool.query(
      "DELETE FROM transactions WHERE created_at < NOW() - INTERVAL '48 hours'"
    );
    const maResult = await pool.query(
      "DELETE FROM message_activity WHERE counted_at < NOW() - INTERVAL '48 hours'"
    );

    const txDeleted = txResult.rowCount || 0;
    const maDeleted = maResult.rowCount || 0;

    if (txDeleted > 0 || maDeleted > 0) {
      console.log(`[Cleanup] Purged ${txDeleted} old transactions and ${maDeleted} old message_activity records.`);
    }

    return { transactionsDeleted: txDeleted, messageActivityDeleted: maDeleted };
  } catch (error) {
    console.error('Error in cleanupOldRecords:', error);
  }
}

/**
 * Checks if target has a Divine Shield, consumes 1 and returns true globally.
 */
async function checkAndConsumeShield(client, discordId, serverId) {
  const selectRes = await client.query(`
    SELECT quantity FROM user_inventory
    WHERE discord_id = $1 AND server_id = 'GLOBAL' AND item_id = 'shield' FOR UPDATE
  `, [discordId]);

  if (selectRes.rows.length > 0 && selectRes.rows[0].quantity > 0) {
    const qty = selectRes.rows[0].quantity;
    if (qty > 1) {
      await client.query(`
        UPDATE user_inventory SET quantity = quantity - 1
        WHERE discord_id = $1 AND server_id = 'GLOBAL' AND item_id = 'shield'
      `, [discordId]);
    } else {
      await client.query(`
        DELETE FROM user_inventory
        WHERE discord_id = $1 AND server_id = 'GLOBAL' AND item_id = 'shield'
      `, [discordId]);
    }
    return true; // Shield consumed
  }
  return false; // No shield
}

/**
 * Determines if Sunday midnight has passed since lastResetDate.
 */
function isWeeklyResetDue(lastResetDate) {
  const now = new Date();
  const lastReset = new Date(lastResetDate);
  
  // Find the Sunday midnight immediately following lastReset
  const nextSunday = new Date(lastReset);
  nextSunday.setDate(lastReset.getDate() + (7 - lastReset.getDay()));
  nextSunday.setHours(0, 0, 0, 0);
  
  if (nextSunday.getTime() <= lastReset.getTime()) {
    nextSunday.setDate(nextSunday.getDate() + 7);
  }
  
  return now.getTime() >= nextSunday.getTime();
}

/**
 * Ensures user stats record exists and handles weekly reset.
 */
async function ensureUserStats(client, discordId, serverId) {
  const executor = client || pool;

  // Make sure user exists in main table first globally
  if (client) {
    await ensureUserExists(client, discordId, 'GLOBAL');
  } else {
    const c = await pool.connect();
    try {
      await ensureUserExists(c, discordId, 'GLOBAL');
    } finally {
      c.release();
    }
  }

  // Fetch stats row globally with lock if inside a transaction
  let res;
  if (client) {
    res = await executor.query(`
      SELECT last_weekly_reset FROM user_stats 
      WHERE discord_id = $1 AND server_id = 'GLOBAL' FOR UPDATE
    `, [discordId]);
  } else {
    res = await executor.query(`
      SELECT last_weekly_reset FROM user_stats 
      WHERE discord_id = $1 AND server_id = 'GLOBAL'
    `, [discordId]);
  }

  if (res.rows.length === 0) {
    await executor.query(`
      INSERT INTO user_stats (discord_id, server_id, last_weekly_reset)
      VALUES ($1, 'GLOBAL', NOW())
      ON CONFLICT (discord_id, server_id) DO NOTHING
    `, [discordId]);
  } else {
    const row = res.rows[0];
    if (isWeeklyResetDue(row.last_weekly_reset)) {
      await executor.query(`
        UPDATE user_stats
        SET boost_strength = 0, boost_defense = 0, boost_speed = 0, boost_magic = 0, last_weekly_reset = NOW()
        WHERE discord_id = $1 AND server_id = 'GLOBAL'
      `, [discordId]);
      console.log(`[Weekly Reset] Reset training boosts for user ${discordId} globally.`);
    }
  }
}

/**
 * Gets total active stats (Base + Weekly Upgrades + 24h Potion Buffs) globally.
 */
async function getUserStats(discordId, serverId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureUserStats(client, discordId, 'GLOBAL');

    // Fetch stats globally
    const statsRes = await client.query(`
      SELECT base_strength, base_defense, base_speed, base_magic,
             boost_strength, boost_defense, boost_speed, boost_magic,
             last_weekly_reset, last_duel_loss_at
      FROM user_stats
      WHERE discord_id = $1 AND server_id = 'GLOBAL'
    `, [discordId]);

    const stats = statsRes.rows[0] || {
      base_strength: 50, base_defense: 50, base_speed: 50, base_magic: 50,
      boost_strength: 0, boost_defense: 0, boost_speed: 0, boost_magic: 0,
      last_weekly_reset: new Date(),
      last_duel_loss_at: null
    };

    // Prune expired boosts globally
    await client.query(`
      DELETE FROM active_boosts 
      WHERE expires_at < NOW() AND discord_id = $1 AND server_id = 'GLOBAL'
    `, [discordId]);

    // Sum active 24h boosts globally
    const activeRes = await client.query(`
      SELECT stat_type, SUM(amount) as total_amount
      FROM active_boosts
      WHERE discord_id = $1 AND server_id = 'GLOBAL'
      GROUP BY stat_type
    `, [discordId]);

    const activeBuffs = { strength: 0, defense: 0, speed: 0, magic: 0 };
    activeRes.rows.forEach(r => {
      activeBuffs[r.stat_type] = parseInt(r.total_amount, 10) || 0;
    });

    // Get active boosts detail globally
    const detailedBoostsRes = await client.query(`
      SELECT stat_type, amount, expires_at
      FROM active_boosts
      WHERE discord_id = $1 AND server_id = 'GLOBAL'
      ORDER BY expires_at ASC
    `, [discordId]);

    const total = {
      strength: stats.base_strength + stats.boost_strength + activeBuffs.strength,
      defense: stats.base_defense + stats.boost_defense + activeBuffs.defense,
      speed: stats.base_speed + stats.boost_speed + activeBuffs.speed,
      magic: stats.base_magic + stats.boost_magic + activeBuffs.magic
    };

    await client.query('COMMIT');

    return {
      base: {
        strength: stats.base_strength,
        defense: stats.base_defense,
        speed: stats.base_speed,
        magic: stats.base_magic
      },
      weekly: {
        strength: stats.boost_strength,
        defense: stats.boost_defense,
        speed: stats.boost_speed,
        magic: stats.boost_magic
      },
      activeBuffs,
      total,
      detailedBoosts: detailedBoostsRes.rows,
      lastWeeklyReset: stats.last_weekly_reset,
      lastDuelLossAt: stats.last_duel_loss_at
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in getUserStats for user ${discordId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

const DEFAULT_PRICES = {
  dumbbell: 150,
  vest: 150,
  shoes: 150,
  tome: 150,
  rage: 300,
  aegis: 300,
  adrenaline: 300,
  mana: 300,
  shield: 500
};

/**
 * Fetches all global settings.
 */
async function getGlobalSettings() {
  const query = 'SELECT key, value FROM global_settings';
  try {
    const res = await pool.query(query);
    const settings = {};
    res.rows.forEach(r => {
      settings[r.key] = r.value;
    });
    
    // Fill in defaults if any are missing
    const defaults = {
      max_fight_bet: '10000',
      duel_cooldown_hours: '6',
      price_dumbbell: '150',
      price_vest: '150',
      price_shoes: '150',
      price_tome: '150',
      price_rage: '300',
      price_aegis: '300',
      price_adrenaline: '300',
      price_mana: '300',
      price_shield: '500',
      currency_name: 'Souls',
      currency_icon_url: '<:Soul_Head:1523605643158618214>',
      maintenance_mode: 'false',
      maintenance_message: '🔧 The Soul Currency bot is currently under maintenance. Please try again later.',
      feature_checkin: 'true',
      feature_casino: 'true',
      feature_shop: 'true',
      feature_duels: 'true',
      feature_rob: 'true',
      feature_drops: 'true',
      feature_message_earnings: 'true',
      feature_transfers: 'true',
      checkin_min: '500',
      checkin_max: '1000',
      slash_checkin_amount: '20',
      message_reward: '100',
      message_daily_cap: '5000',
      message_cooldown_seconds: '15',
      message_milestone: '10'
    };
    
    for (const [key, val] of Object.entries(defaults)) {
      if (settings[key] === undefined) {
        settings[key] = val;
        // Insert missing setting into database
        await pool.query(
          'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
          [key, val]
        ).catch(err => console.error(`Error inserting default global setting ${key}:`, err));
      }
    }
    return settings;
  } catch (error) {
    console.error('Error in getGlobalSettings:', error);
    // Return standard hardcoded fallbacks
    return {
      max_fight_bet: '10000',
      duel_cooldown_hours: '6',
      price_dumbbell: '150',
      price_vest: '150',
      price_shoes: '150',
      price_tome: '150',
      price_rage: '300',
      price_aegis: '300',
      price_adrenaline: '300',
      price_mana: '300',
      price_shield: '500',
      currency_name: 'Souls',
      currency_icon_url: '<:Soul_Head:1523605643158618214>',
      maintenance_mode: 'false',
      maintenance_message: '🔧 The Soul Currency bot is currently under maintenance. Please try again later.',
      feature_checkin: 'true',
      feature_casino: 'true',
      feature_shop: 'true',
      feature_duels: 'true',
      feature_rob: 'true',
      feature_drops: 'true',
      feature_message_earnings: 'true',
      feature_transfers: 'true',
      checkin_min: '500',
      checkin_max: '1000',
      slash_checkin_amount: '20',
      message_reward: '100',
      message_daily_cap: '5000',
      message_cooldown_seconds: '15',
      message_milestone: '10'
    };
  }
}

/**
 * Returns aggregate stats for the global economy.
 */
async function getGlobalEconomyStats() {
  const userQuery = `
    SELECT
      COUNT(*) AS total_users,
      COALESCE(SUM(coin_balance), 0) AS total_coins,
      COUNT(*) FILTER (WHERE coin_balance > 0) AS active_users
    FROM users WHERE server_id = 'GLOBAL'
  `;
  const txQuery = `SELECT COUNT(*) AS tx_count FROM transactions WHERE created_at >= NOW() - INTERVAL '24 hours'`;
  const chartQuery = `
    SELECT
      DATE(created_at) AS day,
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS souls_in,
      COUNT(*) AS tx_count
    FROM transactions
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY DATE(created_at)
    ORDER BY day ASC
  `;
  const sourceQuery = `
    SELECT source, COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total
    FROM transactions
    WHERE created_at >= NOW() - INTERVAL '7 days' AND amount > 0
    GROUP BY source
    ORDER BY total DESC
    LIMIT 10
  `;
  const topQuery = `
    SELECT discord_id, coin_balance
    FROM users WHERE server_id = 'GLOBAL' AND coin_balance > 0
    ORDER BY coin_balance DESC LIMIT 20
  `;
  try {
    const [userRes, txRes, chartRes, sourceRes, topRes] = await Promise.all([
      pool.query(userQuery), pool.query(txQuery), pool.query(chartQuery),
      pool.query(sourceQuery), pool.query(topQuery)
    ]);
    const row = userRes.rows[0];
    return {
      totalUsers: parseInt(row.total_users, 10) || 0,
      activeUsers: parseInt(row.active_users, 10) || 0,
      totalCoins: parseInt(row.total_coins, 10) || 0,
      transactions24h: parseInt(txRes.rows[0].tx_count, 10) || 0,
      chartData: chartRes.rows.map(r => ({ day: r.day, soulsIn: parseInt(r.souls_in,10)||0, txCount: parseInt(r.tx_count,10)||0 })),
      sourceBreakdown: sourceRes.rows.map(r => ({ source: r.source, total: parseInt(r.total,10)||0 })),
      topUsers: topRes.rows.map(r => ({ discordId: r.discord_id, balance: parseInt(r.coin_balance,10)||0 }))
    };
  } catch (error) {
    console.error('Error in getGlobalEconomyStats:', error);
    return { totalUsers: 0, activeUsers: 0, totalCoins: 0, transactions24h: 0, chartData: [], sourceBreakdown: [], topUsers: [] };
  }
}

/**
 * Updates a single global setting.
 */
async function setGlobalSetting(key, value) {
  const query = `
    INSERT INTO global_settings (key, value)
    VALUES ($1, $2)
    ON CONFLICT (key)
    DO UPDATE SET value = $2
    RETURNING *
  `;
  const res = await pool.query(query, [key, String(value)]);
  return res.rows[0];
}

/**
 * Gets customized item prices globally from global_settings, falls back to default.
 */
async function getShopPrices(serverId) {
  try {
    const globalSettings = await getGlobalSettings();
    const fallbackPrices = {
      dumbbell: parseInt(globalSettings.price_dumbbell, 10) || 150,
      vest: parseInt(globalSettings.price_vest, 10) || 150,
      shoes: parseInt(globalSettings.price_shoes, 10) || 150,
      tome: parseInt(globalSettings.price_tome, 10) || 150,
      rage: parseInt(globalSettings.price_rage, 10) || 300,
      aegis: parseInt(globalSettings.price_aegis, 10) || 300,
      adrenaline: parseInt(globalSettings.price_adrenaline, 10) || 300,
      mana: parseInt(globalSettings.price_mana, 10) || 300,
      shield: parseInt(globalSettings.price_shield, 10) || 500
    };

    if (!serverId || serverId === 'GLOBAL') {
      return fallbackPrices;
    }

    const res = await pool.query('SELECT item_id, price FROM shop_prices WHERE server_id = $1', [serverId]);
    const serverPrices = {};
    res.rows.forEach(r => {
      serverPrices[r.item_id] = parseInt(r.price, 10);
    });

    return {
      dumbbell: serverPrices.dumbbell !== undefined ? serverPrices.dumbbell : fallbackPrices.dumbbell,
      vest: serverPrices.vest !== undefined ? serverPrices.vest : fallbackPrices.vest,
      shoes: serverPrices.shoes !== undefined ? serverPrices.shoes : fallbackPrices.shoes,
      tome: serverPrices.tome !== undefined ? serverPrices.tome : fallbackPrices.tome,
      rage: serverPrices.rage !== undefined ? serverPrices.rage : fallbackPrices.rage,
      aegis: serverPrices.aegis !== undefined ? serverPrices.aegis : fallbackPrices.aegis,
      adrenaline: serverPrices.adrenaline !== undefined ? serverPrices.adrenaline : fallbackPrices.adrenaline,
      mana: serverPrices.mana !== undefined ? serverPrices.mana : fallbackPrices.mana,
      shield: serverPrices.shield !== undefined ? serverPrices.shield : fallbackPrices.shield
    };
  } catch (error) {
    console.error(`Error in getShopPrices:`, error);
    return DEFAULT_PRICES;
  }
}

/**
 * Sets custom item price for a server.
 */
async function setShopPrice(serverId, itemId, price) {
  const query = `
    INSERT INTO shop_prices (server_id, item_id, price)
    VALUES ($1, $2, $3)
    ON CONFLICT (server_id, item_id)
    DO UPDATE SET price = $3
    RETURNING *
  `;
  const res = await pool.query(query, [serverId, itemId, price]);
  return res.rows[0];
}

/**
 * Fetches non-expiring user inventory.
 */
async function getUserInventory(discordId, serverId) {
  try {
    const res = await pool.query(`
      SELECT item_id, quantity FROM user_inventory
      WHERE discord_id = $1 AND server_id = 'GLOBAL'
    `, [discordId]);

    const inventory = {};
    res.rows.forEach(r => {
      inventory[r.item_id] = r.quantity;
    });
    return inventory;
  } catch (error) {
    console.error(`Error in getUserInventory for user ${discordId}:`, error);
    return {};
  }
}

/**
 * Deducts currency and applies upgrades / elixirs / shields.
 */
async function purchaseShopItem(discordId, serverId, itemId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prices = await getShopPrices(serverId);
    const cost = prices[itemId];
    if (cost === undefined) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'invalid_item' };
    }

    // Ensure stats exist globally
    await ensureUserStats(client, discordId, 'GLOBAL');

    // Get user wallet balance with lock globally
    const balanceRes = await client.query(`
      SELECT coin_balance FROM users WHERE discord_id = $1 AND server_id = 'GLOBAL' FOR UPDATE
    `, [discordId]);

    if (balanceRes.rows.length === 0 || balanceRes.rows[0].coin_balance < cost) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'insufficient_funds', cost };
    }

    // Deduct coins globally
    await client.query(`
      UPDATE users SET coin_balance = coin_balance - $1 WHERE discord_id = $2 AND server_id = 'GLOBAL'
    `, [cost, discordId]);

    // Log transaction globally
    await client.query(`
      INSERT INTO transactions (user_id, server_id, amount, source)
      VALUES ($1, 'GLOBAL', $2, $3)
    `, [discordId, -cost, `buy_${itemId}`]);

    let effectMsg = '';
    if (['dumbbell', 'vest', 'shoes', 'tome'].includes(itemId)) {
      // Weekly training (+5) globally
      let field = '';
      if (itemId === 'dumbbell') field = 'boost_strength';
      else if (itemId === 'vest') field = 'boost_defense';
      else if (itemId === 'shoes') field = 'boost_speed';
      else if (itemId === 'tome') field = 'boost_magic';

      await client.query(`
        UPDATE user_stats
        SET ${field} = ${field} + 5
        WHERE discord_id = $1 AND server_id = 'GLOBAL'
      `, [discordId]);

      effectMsg = '+5 training boost applied';
    } else if (['rage', 'aegis', 'adrenaline', 'mana'].includes(itemId)) {
      // 24h Potion (+15) globally
      let type = '';
      if (itemId === 'rage') type = 'strength';
      else if (itemId === 'aegis') type = 'defense';
      else if (itemId === 'adrenaline') type = 'speed';
      else if (itemId === 'mana') type = 'magic';

      await client.query(`
        INSERT INTO active_boosts (discord_id, server_id, stat_type, amount, expires_at)
        VALUES ($1, 'GLOBAL', $2, 15, NOW() + INTERVAL '24 hours')
      `, [discordId, type]);

      effectMsg = '+15 potion effect applied for 24 hours';
    } else if (itemId === 'shield') {
      // Inventory shield globally
      await client.query(`
        INSERT INTO user_inventory (discord_id, server_id, item_id, quantity)
        VALUES ($1, 'GLOBAL', 'shield', 1)
        ON CONFLICT (discord_id, server_id, item_id)
        DO UPDATE SET quantity = user_inventory.quantity + 1
      `, [discordId]);

      effectMsg = 'Divine Shield added to your inventory';
    }

    const finalBalanceRes = await client.query(`
      SELECT coin_balance FROM users WHERE discord_id = $1 AND server_id = 'GLOBAL'
    `, [discordId]);
    const newBalance = finalBalanceRes.rows[0].coin_balance;

    await client.query('COMMIT');
    return { success: true, newBalance, cost, message: effectMsg };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in purchaseShopItem:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Sets the last_duel_loss_at timestamp to now globally, initiating a 6-hour cooldown.
 */
async function recordDuelLoss(discordId, serverId) {
  await ensureUserStats(null, discordId, 'GLOBAL');
  const query = `
    UPDATE user_stats
    SET last_duel_loss_at = NOW()
    WHERE discord_id = $1 AND server_id = 'GLOBAL'
  `;
  await pool.query(query, [discordId]);
}

/**
 * Gets per-server feature overrides as a { featureName: bool } map.
 */
async function getServerFeatureOverrides(serverId) {
  try {
    const res = await pool.query(
      'SELECT feature, enabled FROM server_feature_overrides WHERE server_id = $1',
      [serverId]
    );
    const overrides = {};
    res.rows.forEach(r => { overrides[r.feature] = r.enabled; });
    return overrides;
  } catch (e) {
    console.error('Error in getServerFeatureOverrides:', e);
    return {};
  }
}

/**
 * Sets a single per-server feature override.
 */
async function setServerFeatureOverride(serverId, feature, enabled) {
  await pool.query(`
    INSERT INTO server_feature_overrides (server_id, feature, enabled, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (server_id, feature) DO UPDATE SET enabled = $3, updated_at = NOW()
  `, [serverId, feature, enabled]);
}

/**
 * Returns detailed stats for a single server — top members, recent transactions, 7d activity.
 */
async function getServerDetail(serverId) {
  try {
    const [topRes, txRes, actRes, overridesRes] = await Promise.all([
      pool.query(`
        SELECT u.discord_id, u.coin_balance
        FROM users u
        WHERE u.server_id = 'GLOBAL' AND u.discord_id IN (
          SELECT discord_id FROM users WHERE server_id = $1
        ) AND u.coin_balance > 0
        ORDER BY u.coin_balance DESC LIMIT 10
      `, [serverId]),
      pool.query(`
        SELECT t.user_id, t.amount, t.source, t.created_at
        FROM transactions t
        WHERE t.server_id = $1 OR (t.server_id = 'GLOBAL' AND t.user_id IN (
          SELECT discord_id FROM users WHERE server_id = $1
        ))
        ORDER BY t.created_at DESC LIMIT 20
      `, [serverId]),
      pool.query(`
        SELECT DATE(counted_at) AS day, COUNT(DISTINCT user_id) AS active_users
        FROM message_activity
        WHERE server_id = $1 AND counted_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(counted_at) ORDER BY day ASC
      `, [serverId]),
      pool.query('SELECT feature, enabled FROM server_feature_overrides WHERE server_id = $1', [serverId])
    ]);

    const overrides = {};
    overridesRes.rows.forEach(r => { overrides[r.feature] = r.enabled; });

    const shopPrices = await getShopPrices(serverId);

    return {
      topMembers: topRes.rows.map((r, i) => ({ rank: i+1, discordId: r.discord_id, balance: parseInt(r.coin_balance,10)||0 })),
      recentTransactions: txRes.rows.map(r => ({ userId: r.user_id, amount: r.amount, source: r.source, at: r.created_at })),
      activityChart: actRes.rows.map(r => ({ day: r.day, activeUsers: parseInt(r.active_users,10)||0 })),
      featureOverrides: overrides,
      shopPrices
    };
  } catch (e) {
    console.error('Error in getServerDetail:', e);
    return { topMembers: [], recentTransactions: [], activityChart: [], featureOverrides: {}, shopPrices: {} };
  }
}

/**
 * Returns wallet + transaction history for a specific user (for User Inspector tab).
 */
async function getUserInspect(discordId) {
  try {
    const [balRes, txRes, statsRes, rankRes] = await Promise.all([
      pool.query('SELECT coin_balance, last_checkin_at FROM users WHERE discord_id = $1 AND server_id = $2', [discordId, 'GLOBAL']),
      pool.query(`
        SELECT amount, source, created_at FROM transactions
        WHERE user_id = $1
        ORDER BY created_at DESC LIMIT 30
      `, [discordId]),
      pool.query('SELECT * FROM user_stats WHERE discord_id = $1 AND server_id = $2', [discordId, 'GLOBAL']),
      pool.query(`
        SELECT COUNT(*) + 1 AS rank FROM users
        WHERE server_id = 'GLOBAL' AND coin_balance > (
          SELECT COALESCE(coin_balance, 0) FROM users WHERE discord_id = $1 AND server_id = 'GLOBAL'
        )
      `, [discordId])
    ]);

    if (balRes.rows.length === 0) return null;

    const user = balRes.rows[0];
    const stats = statsRes.rows[0] || null;
    return {
      discordId,
      balance: parseInt(user.coin_balance, 10) || 0,
      lastCheckin: user.last_checkin_at,
      rank: parseInt(rankRes.rows[0].rank, 10) || 0,
      transactions: txRes.rows.map(r => ({ amount: r.amount, source: r.source, at: r.created_at })),
      stats: stats ? {
        strength: (stats.base_strength || 50) + (stats.boost_strength || 0),
        defense: (stats.base_defense || 50) + (stats.boost_defense || 0),
        speed: (stats.base_speed || 50) + (stats.boost_speed || 0),
        magic: (stats.base_magic || 50) + (stats.boost_magic || 0)
      } : null
    };
  } catch (e) {
    console.error('Error in getUserInspect:', e);
    return null;
  }
}

module.exports = {
  getServerSettings,
  updateServerSetting,
  checkInUser,
  recordMessageActivity,
  getUserBalance,
  getLeaderboard,
  resetCycle,
  recordCasinoGame,
  updateDropChannel,
  toggleAutoDrops,
  awardDropCoins,
  transferCoins,
  attemptRob,
  cleanupOldRecords,
  ensureUserStats,
  getUserStats,
  getShopPrices,
  setShopPrice,
  getUserInventory,
  purchaseShopItem,
  recordDuelLoss,
  getGlobalSettings,
  setGlobalSetting,
  getGlobalEconomyStats,
  getServerFeatureOverrides,
  setServerFeatureOverride,
  getServerDetail,
  getUserInspect
};

