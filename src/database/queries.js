const { pool } = require('./db');

/**
 * Gets server currency settings. Returns default values if settings don't exist.
 */
async function getServerSettings(serverId) {
  const globalSettings = await getGlobalSettings();
  const query = `
    SELECT drop_channel_id, auto_drops_enabled, bot_channel_id, log_channel_id 
    FROM server_settings 
    WHERE server_id = $1
  `;
  try {
    const res = await pool.query(query, [serverId]);
    const settings = res.rows[0] || { drop_channel_id: null, auto_drops_enabled: false, bot_channel_id: null, log_channel_id: null };
    return {
      currency_name: globalSettings.currency_name || 'Souls',
      currency_icon_url: globalSettings.currency_icon_url || '🪙',
      drop_channel_id: settings.drop_channel_id,
      auto_drops_enabled: settings.auto_drops_enabled,
      bot_channel_id: settings.bot_channel_id,
      log_channel_id: settings.log_channel_id
    };
  } catch (error) {
    console.error(`Error in getServerSettings for server ${serverId}:`, error);
    return {
      currency_name: globalSettings.currency_name || 'Souls',
      currency_icon_url: globalSettings.currency_icon_url || '🪙',
      drop_channel_id: null,
      auto_drops_enabled: false,
      bot_channel_id: null,
      log_channel_id: null
    };
  }
}

/**
 * Updates the bot channel and log channel configuration for a server.
 */
async function updateServerChannels(serverId, botChannelId, logChannelId) {
  const query = `
    INSERT INTO server_settings (server_id, bot_channel_id, log_channel_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (server_id) 
    DO UPDATE SET 
      bot_channel_id = COALESCE($2, server_settings.bot_channel_id),
      log_channel_id = COALESCE($3, server_settings.log_channel_id)
    RETURNING *
  `;
  try {
    const res = await pool.query(query, [serverId, botChannelId, logChannelId]);
    return res.rows[0];
  } catch (error) {
    console.error(`Error in updateServerChannels for server ${serverId}:`, error);
    throw error;
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
      SELECT u.discord_id, g.coin_balance 
      FROM users u
      JOIN users g ON g.discord_id = u.discord_id AND g.server_id = 'GLOBAL'
      WHERE u.server_id = $1 AND g.coin_balance > 0
      ORDER BY g.coin_balance DESC 
      LIMIT $2
    `;
    const res = await pool.query(query, [serverId, limit]);
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
 * Resets the current monthly cycle (Dashboard-only).
 * Archives all non-zero GLOBAL balances into cycle_results,
 * resets all coin_balance and last_checkin_at to 0/null,
 * closes the active cycle, and starts a new one.
 * serverId is ignored — always operates on GLOBAL balances.
 */
async function resetCycle(serverId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Check if there is an active cycle
    const activeCycleRes = await client.query(
      `SELECT id FROM cycles WHERE server_id = 'GLOBAL' AND is_active = TRUE LIMIT 1`
    );

    let oldCycleId = null;
    if (activeCycleRes.rows.length > 0) {
      oldCycleId = activeCycleRes.rows[0].id;

      // 2. Archive top GLOBAL rankings into cycle_results
      const topUsersRes = await client.query(`
        SELECT discord_id, coin_balance,
               RANK() OVER (ORDER BY coin_balance DESC) AS rank
        FROM users
        WHERE server_id = 'GLOBAL' AND coin_balance > 0
        ORDER BY coin_balance DESC
        LIMIT 100
      `);

      for (const row of topUsersRes.rows) {
        await client.query(
          `INSERT INTO cycle_results (cycle_id, discord_id, final_coins, rank)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [oldCycleId, row.discord_id, row.coin_balance, row.rank]
        );
      }

      const archivedCount = topUsersRes.rows.length;

      // 3. Close the active cycle
      await client.query(
        `UPDATE cycles SET is_active = FALSE, ended_at = NOW() WHERE id = $1`,
        [oldCycleId]
      );

      // 4. Reset all GLOBAL coin balances and clear check-in timestamps
      await client.query(`
        UPDATE users
        SET coin_balance = 0, last_checkin_at = NULL
        WHERE server_id = 'GLOBAL'
      `);

      // 5. Start a new cycle
      await client.query(`INSERT INTO cycles (server_id, started_at, is_active) VALUES ('GLOBAL', NOW(), TRUE)`);

      await client.query('COMMIT');
      return { success: true, archivedCount, oldCycleId };
    } else {
      // No active cycle — create one and reset balances anyway
      await client.query(`
        UPDATE users
        SET coin_balance = 0, last_checkin_at = NULL
        WHERE server_id = 'GLOBAL'
      `);
      await client.query(`INSERT INTO cycles (server_id, started_at, is_active) VALUES ('GLOBAL', NOW(), TRUE)`);
      await client.query('COMMIT');
      return { success: true, archivedCount: 0, oldCycleId: null };
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in resetCycle:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Casino Game Transaction.
 * Deducts bet amount on loss, awards net bet amount on win.
 * Logs transaction with source 'casino_win' or 'casino_loss'.
 */
async function recordCasinoGame(discordId, serverId, betAmount, isWin, isPayout = false, originalBet = 0) {
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

    if (!isPayout && currentBalance < betAmount) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'insufficient_funds', currentBalance };
    }

    // Calculate tax on casino wins
    let taxAmount = 0;
    let netChange = 0;

    if (isWin) {
      // Ensure treasury exists for this server
      await ensureTreasuryExists(client, serverId);
      
      const treasuryQuery = `
        SELECT win_tax_rate FROM server_treasury
        WHERE server_id = $1
        FOR UPDATE
      `;
      const treasuryRes = await client.query(treasuryQuery, [serverId]);
      const winTaxRate = treasuryRes.rows[0] ? parseFloat(treasuryRes.rows[0].win_tax_rate) : 10.00;

      const profit = isPayout ? (betAmount - originalBet) : betAmount;
      taxAmount = Math.max(0, Math.floor(profit * (winTaxRate / 100.0)));
      netChange = betAmount - taxAmount;

      if (taxAmount > 0) {
        // Add tax to server treasury balance
        await client.query(`
          UPDATE server_treasury SET balance = balance + $1
          WHERE server_id = $2
        `, [taxAmount, serverId]);
      }
    } else {
      netChange = -betAmount;
    }

    // 3. Calculate new balance globally
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

    // Also log the tax transaction if any
    if (taxAmount > 0) {
      await client.query(`
        INSERT INTO transactions (user_id, server_id, amount, source)
        VALUES ($1, 'GLOBAL', $2, 'win_tribute_paid')
      `, [discordId, -taxAmount]);
    }

    await client.query('COMMIT');
    return {
      success: true,
      won: isWin,
      netChange,
      taxAmount,
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
      message_milestone: '10',
      drops_paused_until: '0',
      giveaway_ping_template: '🎉 CONGRATULATIONS {mention}! You won the {type} giveaway draw! 🎉',
      giveaway_desc_template: 'A lucky server member has been chosen by the cosmic scales for the **{type}** sweepstakes!\n\n👤 **Winner:** {tag} ({mention})\n💰 **Prize:** **{amount}** Souls\n\nCongratulations to the winner! Keep chatting and claiming drops to stand a chance in the next draw!'
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
      drops_paused_until: '0',
      checkin_min: '500',
      checkin_max: '1000',
      slash_checkin_amount: '20',
      message_reward: '100',
      message_daily_cap: '5000',
      message_cooldown_seconds: '15',
      message_milestone: '10',
      giveaway_ping_template: '🎉 CONGRATULATIONS {mention}! You won the {type} giveaway draw! 🎉',
      giveaway_desc_template: 'A lucky server member has been chosen by the cosmic scales for the **{type}** sweepstakes!\n\n👤 **Winner:** {tag} ({mention})\n💰 **Prize:** **{amount}** Souls\n\nCongratulations to the winner! Keep chatting and claiming drops to stand a chance in the next draw!'
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
 * Adds a character/spawn to the user's inventory globally.
 */
async function addCharacterToInventory(discordId, characterId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Ensure user exists globally first
    await ensureUserExists(client, discordId, 'GLOBAL');

    // Add character to user_inventory table
    const query = `
      INSERT INTO user_inventory (discord_id, server_id, item_id, quantity)
      VALUES ($1, 'GLOBAL', $2, 1)
      ON CONFLICT (discord_id, server_id, item_id)
      DO UPDATE SET quantity = user_inventory.quantity + 1
      RETURNING quantity
    `;
    const res = await client.query(query, [discordId, characterId]);
    await client.query('COMMIT');
    return res.rows[0].quantity;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in addCharacterToInventory for user ${discordId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Sells a character from the user's inventory, awarding them coins.
 */
async function sellCharacter(discordId, serverId, characterId, value, quantityToSell = 1) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current quantity
    const invRes = await client.query(`
      SELECT quantity FROM user_inventory
      WHERE discord_id = $1 AND server_id = 'GLOBAL' AND item_id = $2
      FOR UPDATE
    `, [discordId, characterId]);

    if (invRes.rows.length === 0 || invRes.rows[0].quantity < quantityToSell) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'insufficient_quantity' };
    }

    const currentQty = invRes.rows[0].quantity;
    const newQty = currentQty - quantityToSell;

    if (newQty === 0) {
      // Remove row
      await client.query(`
        DELETE FROM user_inventory
        WHERE discord_id = $1 AND server_id = 'GLOBAL' AND item_id = $2
      `, [discordId, characterId]);
    } else {
      // Update row
      await client.query(`
        UPDATE user_inventory
        SET quantity = $3
        WHERE discord_id = $1 AND server_id = 'GLOBAL' AND item_id = $2
      `, [discordId, characterId, newQty]);
    }

    // Get server sell tax rate
    await ensureTreasuryExists(client, serverId);
    const treasuryQuery = `
      SELECT sell_tax_rate FROM server_treasury
      WHERE server_id = $1
      FOR UPDATE
    `;
    const treasuryRes = await client.query(treasuryQuery, [serverId]);
    const sellTaxRate = treasuryRes.rows[0] ? parseFloat(treasuryRes.rows[0].sell_tax_rate) : 10.00;

    // Calculate total coins before tax
    const totalCoins = value * quantityToSell;
    // Calculate tax amount
    const taxAmount = Math.max(0, Math.floor(totalCoins * (sellTaxRate / 100.0)));
    const netEarnings = totalCoins - taxAmount;

    // Award coins globally
    const balRes = await client.query(`
      UPDATE users
      SET coin_balance = coin_balance + $1
      WHERE discord_id = $2 AND server_id = 'GLOBAL'
      RETURNING coin_balance
    `, [netEarnings, discordId]);

    const newBalance = balRes.rows[0].coin_balance;

    if (taxAmount > 0) {
      // Add tax to server treasury
      await client.query(`
        UPDATE server_treasury SET balance = balance + $1
        WHERE server_id = $2
      `, [taxAmount, serverId]);
    }

    // Log transaction
    await client.query(`
      INSERT INTO transactions (user_id, server_id, amount, source)
      VALUES ($1, 'GLOBAL', $2, $3)
    `, [discordId, netEarnings, `sell_${characterId}`]);

    if (taxAmount > 0) {
      await client.query(`
        INSERT INTO transactions (user_id, server_id, amount, source)
        VALUES ($1, 'GLOBAL', $2, 'sell_tribute_paid')
      `, [discordId, -taxAmount]);
    }

    await client.query('COMMIT');
    return { success: true, newBalance, newQty, taxAmount, netEarnings };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in sellCharacter for user ${discordId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Transfers a character from one user to another.
 */
async function giftCharacter(senderId, receiverId, characterId, quantityToGift = 1) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure receiver exists
    await ensureUserExists(client, receiverId, 'GLOBAL');

    // Get current quantity of sender
    const invRes = await client.query(`
      SELECT quantity FROM user_inventory
      WHERE discord_id = $1 AND server_id = 'GLOBAL' AND item_id = $2
      FOR UPDATE
    `, [senderId, characterId]);

    if (invRes.rows.length === 0 || invRes.rows[0].quantity < quantityToGift) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'insufficient_quantity' };
    }

    const currentQty = invRes.rows[0].quantity;
    const newQty = currentQty - quantityToGift;

    if (newQty === 0) {
      // Remove row
      await client.query(`
        DELETE FROM user_inventory
        WHERE discord_id = $1 AND server_id = 'GLOBAL' AND item_id = $2
      `, [senderId, characterId]);
    } else {
      // Update row
      await client.query(`
        UPDATE user_inventory
        SET quantity = $3
        WHERE discord_id = $1 AND server_id = 'GLOBAL' AND item_id = $2
      `, [senderId, characterId, newQty]);
    }

    // Add to receiver's inventory
    await client.query(`
      INSERT INTO user_inventory (discord_id, server_id, item_id, quantity)
      VALUES ($1, 'GLOBAL', $2, $3)
      ON CONFLICT (discord_id, server_id, item_id)
      DO UPDATE SET quantity = user_inventory.quantity + $3
    `, [receiverId, characterId, quantityToGift]);

    await client.query('COMMIT');
    return { success: true, senderNewQty: newQty };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in giftCharacter from ${senderId} to ${receiverId}:`, error);
    throw error;
  } finally {
    client.release();
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
    const [balRes, txRes, statsRes, rankRes, invRes] = await Promise.all([
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
      `, [discordId]),
      pool.query('SELECT item_id, quantity FROM user_inventory WHERE discord_id = $1 AND server_id = $2', [discordId, 'GLOBAL'])
    ]);

    const hasProfile = balRes.rows.length > 0;
    const user = hasProfile ? balRes.rows[0] : { coin_balance: 0, last_checkin_at: null };
    const stats = statsRes.rows[0] || null;
    const transactions = txRes.rows.map(r => ({ amount: r.amount, source: r.source, at: r.created_at }));
    const inventory = invRes.rows.map(r => ({ itemId: r.item_id, quantity: parseInt(r.quantity, 10) || 0 }));

    return {
      discordId,
      balance: parseInt(user.coin_balance, 10) || 0,
      lastCheckin: user.last_checkin_at,
      rank: hasProfile ? (parseInt(rankRes.rows[0].rank, 10) || 0) : 0,
      transactions,
      inventory,
      stats: {
        strength: (stats?.base_strength || 50) + (stats?.boost_strength || 0),
        defense: (stats?.base_defense || 50) + (stats?.boost_defense || 0),
        speed: (stats?.base_speed || 50) + (stats?.boost_speed || 0),
        magic: (stats?.base_magic || 50) + (stats?.boost_magic || 0),
        base_strength: stats?.base_strength || 50,
        base_defense: stats?.base_defense || 50,
        base_speed: stats?.base_speed || 50,
        base_magic: stats?.base_magic || 50,
        boost_strength: stats?.boost_strength || 0,
        boost_defense: stats?.boost_defense || 0,
        boost_speed: stats?.boost_speed || 0,
        boost_magic: stats?.boost_magic || 0
      },
      isNew: !hasProfile
    };
  } catch (e) {
    console.error('Error in getUserInspect:', e);
    return null;
  }
}

/**
 * Updates user details (balance, stats, inventory) from the admin panel.
 */
async function adminUpdateUser(discordId, updates) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Ensure user exists globally first
    await ensureUserExists(client, discordId, 'GLOBAL');
    
    // 1. Update Balance if provided
    if (updates.coin_balance !== undefined) {
      const newBal = parseInt(updates.coin_balance, 10);
      
      const curRes = await client.query('SELECT coin_balance FROM users WHERE discord_id = $1 AND server_id = $2', [discordId, 'GLOBAL']);
      const oldBal = curRes.rows[0] ? parseInt(curRes.rows[0].coin_balance, 10) : 0;
      const difference = newBal - oldBal;
      
      await client.query(`
        UPDATE users
        SET coin_balance = $2
        WHERE discord_id = $1 AND server_id = 'GLOBAL'
      `, [discordId, newBal]);
      
      if (difference !== 0) {
        await client.query(`
          INSERT INTO transactions (user_id, server_id, amount, source)
          VALUES ($1, 'GLOBAL', $2, 'admin_edit')
        `, [discordId, difference]);
      }
    }
    
    // 2. Update Stats if provided
    if (updates.stats !== undefined) {
      const stats = updates.stats;
      await client.query(`
        INSERT INTO user_stats (discord_id, server_id)
        VALUES ($1, 'GLOBAL')
        ON CONFLICT (discord_id, server_id) DO NOTHING
      `, [discordId]);
      
      const setClauses = [];
      const params = [discordId];
      let paramIndex = 2;
      
      const fields = [
        'base_strength', 'base_defense', 'base_speed', 'base_magic',
        'boost_strength', 'boost_defense', 'boost_speed', 'boost_magic'
      ];
      
      fields.forEach(field => {
        if (stats[field] !== undefined) {
          setClauses.push(`${field} = $${paramIndex}`);
          params.push(parseInt(stats[field], 10) || 0);
          paramIndex++;
        }
      });
      
      if (setClauses.length > 0) {
        await client.query(`
          UPDATE user_stats
          SET ${setClauses.join(', ')}
          WHERE discord_id = $1 AND server_id = 'GLOBAL'
        `, params);
      }
    }
    
    // 3. Update Inventory if provided
    if (updates.inventory !== undefined && Array.isArray(updates.inventory)) {
      for (const item of updates.inventory) {
        const itemId = item.itemId;
        const quantity = parseInt(item.quantity, 10);
        
        if (isNaN(quantity) || quantity <= 0) {
          await client.query(`
            DELETE FROM user_inventory
            WHERE discord_id = $1 AND server_id = 'GLOBAL' AND item_id = $2
          `, [discordId, itemId]);
        } else {
          await client.query(`
            INSERT INTO user_inventory (discord_id, server_id, item_id, quantity)
            VALUES ($1, 'GLOBAL', $2, $3)
            ON CONFLICT (discord_id, server_id, item_id)
            DO UPDATE SET quantity = $3
          `, [discordId, itemId, quantity]);
        }
      }
    }
    
    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in adminUpdateUser for user ${discordId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fetches the current database size in bytes.
 */
async function getDatabaseSize() {
  try {
    const res = await pool.query("SELECT pg_database_size(current_database()) AS size");
    return parseInt(res.rows[0].size, 10) || 0;
  } catch (err) {
    console.error('Error fetching database size:', err);
    return 0;
  }
}

/**
 * Ensures a server's treasury exists.
 */
async function ensureTreasuryExists(client, serverId) {
  const query = `
    INSERT INTO server_treasury (server_id, balance)
    VALUES ($1, 100000)
    ON CONFLICT (server_id) DO NOTHING
  `;
  await client.query(query, [serverId]);
}

/**
 * Gets a server's treasury balance and settings.
 */
async function getTreasury(serverId) {
  const client = await pool.connect();
  try {
    await ensureTreasuryExists(client, serverId);
    const query = `
      SELECT balance, daily_tax_rate, win_tax_rate, sell_tax_rate,
             total_tax_paid, today_tax_paid, last_tax_deduction_at, custom_tax_rate
      FROM server_treasury
      WHERE server_id = $1
    `;
    const res = await client.query(query, [serverId]);
    const row = res.rows[0];
    return {
      balance: parseInt(row.balance, 10),
      dailyTaxRate: parseFloat(row.daily_tax_rate),
      winTaxRate: parseFloat(row.win_tax_rate),
      sellTaxRate: parseFloat(row.sell_tax_rate),
      totalTaxPaid: parseInt(row.total_tax_paid || 0, 10),
      todayTaxPaid: parseInt(row.today_tax_paid || 0, 10),
      lastTaxDeductionAt: row.last_tax_deduction_at,
      customTaxRate: row.custom_tax_rate !== null ? parseFloat(row.custom_tax_rate) : null
    };
  } catch (error) {
    console.error(`Error in getTreasury for server ${serverId}:`, error);
    return {
      balance: 100000,
      dailyTaxRate: 1.00,
      winTaxRate: 10.00,
      sellTaxRate: 10.00,
      totalTaxPaid: 0,
      todayTaxPaid: 0,
      lastTaxDeductionAt: null,
      customTaxRate: null
    };
  } finally {
    client.release();
  }
}

/**
 * Updates a server's treasury settings (tax rates).
 */
async function updateTreasuryRates(serverId, dailyRate, winRate, sellRate) {
  const client = await pool.connect();
  try {
    await ensureTreasuryExists(client, serverId);
    const query = `
      UPDATE server_treasury
      SET daily_tax_rate = COALESCE($1, daily_tax_rate),
          win_tax_rate = COALESCE($2, win_tax_rate),
          sell_tax_rate = COALESCE($3, sell_tax_rate)
      WHERE server_id = $4
      RETURNING *
    `;
    const res = await client.query(query, [dailyRate, winRate, sellRate, serverId]);
    return res.rows[0];
  } catch (error) {
    console.error(`Error in updateTreasuryRates for server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Applies a daily tribute/tax if it is due (last taxed > 24 hours ago).
 * Returns an object with { success: boolean, taxAmount: number, newBalance: number }.
 */
async function applyDailyTaxIfDue(discordId, serverId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure treasury and user exist
    await ensureTreasuryExists(client, serverId);
    await ensureUserExists(client, discordId, serverId);

    // 2. Check if they were already taxed in this server in the last 24 hours
    const taxCheckQuery = `
      SELECT last_taxed_at FROM user_daily_tax
      WHERE discord_id = $1 AND server_id = $2
      FOR UPDATE
    `;
    const taxCheckRes = await client.query(taxCheckQuery, [discordId, serverId]);
    const now = new Date();

    if (taxCheckRes.rows.length > 0) {
      const lastTaxed = new Date(taxCheckRes.rows[0].last_taxed_at);
      const timeDiffMs = now.getTime() - lastTaxed.getTime();
      const cooldownMs = 24 * 60 * 60 * 1000;

      if (timeDiffMs < cooldownMs) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'cooldown' };
      }
    }

    // 3. Fetch current user balance globally
    const balanceQuery = `
      SELECT coin_balance FROM users
      WHERE discord_id = $1 AND server_id = 'GLOBAL'
      FOR UPDATE
    `;
    const balanceRes = await client.query(balanceQuery, [discordId]);
    const userBalance = balanceRes.rows[0] ? balanceRes.rows[0].coin_balance : 0;

    // 4. Fetch server tax rates
    const treasuryQuery = `
      SELECT daily_tax_rate FROM server_treasury
      WHERE server_id = $1
      FOR UPDATE
    `;
    const treasuryRes = await client.query(treasuryQuery, [serverId]);
    const dailyTaxRate = treasuryRes.rows[0] ? parseFloat(treasuryRes.rows[0].daily_tax_rate) : 1.00;

    // 5. Calculate tax amount
    const taxAmount = Math.max(0, Math.floor(userBalance * (dailyTaxRate / 100.0)));

    if (taxAmount > 0) {
      // Deduct from user
      await client.query(`
        UPDATE users SET coin_balance = coin_balance - $1
        WHERE discord_id = $2 AND server_id = 'GLOBAL'
      `, [taxAmount, discordId]);

      // Add to server treasury
      await client.query(`
        UPDATE server_treasury SET balance = balance + $1
        WHERE server_id = $2
      `, [taxAmount, serverId]);

      // Log transaction
      await client.query(`
        INSERT INTO transactions (user_id, server_id, amount, source)
        VALUES ($1, 'GLOBAL', $2, 'daily_tribute_paid')
      `, [discordId, -taxAmount]);
    }

    // 6. Update user_daily_tax record
    await client.query(`
      INSERT INTO user_daily_tax (discord_id, server_id, last_taxed_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (discord_id, server_id)
      DO UPDATE SET last_taxed_at = $3
    `, [discordId, serverId, now]);

    await client.query('COMMIT');

    return {
      success: true,
      taxAmount,
      newBalance: userBalance - taxAmount
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in applyDailyTaxIfDue for user ${discordId} on server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Retrieves the leaderboard of soul collectors in a server, optionally filtered by tier.
 */
async function getSoulsLeaderboard(serverId, tier = 'ALL', limit = 10) {
  try {
    const settings = await getServerSettings(serverId);
    const { CHARACTER_SPAWNS } = require('../utils/characters');

    let query;
    let params;

    if (tier === 'ALL') {
      query = `
        SELECT u.discord_id, SUM(ui.quantity)::int AS total_souls
        FROM users u
        JOIN user_inventory ui ON ui.discord_id = u.discord_id AND ui.server_id = 'GLOBAL'
        WHERE u.server_id = $1
        GROUP BY u.discord_id
        ORDER BY total_souls DESC
        LIMIT $2
      `;
      params = [serverId, limit];
    } else {
      // Filter spawns by the requested tier
      const tierCharIds = CHARACTER_SPAWNS.filter(c => c.tier.toUpperCase() === tier.toUpperCase()).map(c => c.id);
      
      // If there are no characters defined for this tier in the config, return empty rankings
      if (tierCharIds.length === 0) {
        return {
          rankings: [],
          currencyName: settings.currency_name,
          currencyIcon: settings.currency_icon_url
        };
      }

      query = `
        SELECT u.discord_id, SUM(ui.quantity)::int AS total_souls
        FROM users u
        JOIN user_inventory ui ON ui.discord_id = u.discord_id AND ui.server_id = 'GLOBAL'
        WHERE u.server_id = $1 AND ui.item_id = ANY($2)
        GROUP BY u.discord_id
        ORDER BY total_souls DESC
        LIMIT $3
      `;
      params = [serverId, tierCharIds, limit];
    }

    const res = await pool.query(query, params);
    return {
      rankings: res.rows,
      currencyName: settings.currency_name,
      currencyIcon: settings.currency_icon_url
    };
  } catch (error) {
    console.error(`Error in getSoulsLeaderboard for server ${serverId}:`, error);
    throw error;
  }
}

/**
 * Ensures a server giveaways settings record exists.
 */
async function ensureServerGiveawayExists(client, serverId) {
  // Ensure the server settings parent record exists first
  await client.query(
    'INSERT INTO server_settings (server_id) VALUES ($1) ON CONFLICT (server_id) DO NOTHING',
    [serverId]
  );
  
  const query = `
    INSERT INTO server_giveaways (server_id, giveaway_ping_template, giveaway_desc_template)
    VALUES ($1, $2, $3)
    ON CONFLICT (server_id) DO NOTHING
  `;
  const defaultPing = '🎉 CONGRATULATIONS {mention}! You won the {type} giveaway draw! 🎉';
  const defaultDesc = 'A lucky server member has been chosen by the cosmic scales for the **{type}** sweepstakes!\n\n👤 **Winner:** {tag} ({mention})\n💰 **Prize:** **{amount}** Souls\n\nCongratulations to the winner! Keep chatting and claiming drops to stand a chance in the next draw!';
  await client.query(query, [serverId, defaultPing, defaultDesc]);
}

/**
 * Gets server giveaway settings and previous winners.
 */
async function getServerGiveawaySettings(serverId) {
  const client = await pool.connect();
  try {
    await ensureServerGiveawayExists(client, serverId);
    const res = await client.query('SELECT * FROM server_giveaways WHERE server_id = $1', [serverId]);
    return res.rows[0];
  } catch (error) {
    console.error(`Error in getServerGiveawaySettings for server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Updates server giveaway settings.
 */
async function setServerGiveawaySettings(serverId, updates) {
  const client = await pool.connect();
  try {
    await ensureServerGiveawayExists(client, serverId);
    
    const fields = [];
    const values = [serverId];
    let paramIndex = 2;
    
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = $${paramIndex}`);
      values.push(val);
      paramIndex++;
    }
    
    if (fields.length === 0) return null;
    
    const query = `
      UPDATE server_giveaways 
      SET ${fields.join(', ')} 
      WHERE server_id = $1 
      RETURNING *
    `;
    const res = await client.query(query, values);
    return res.rows[0];
  } catch (error) {
    console.error(`Error in setServerGiveawaySettings for server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

function getFluctuatingTaxRate(memberCount) {
  if (memberCount <= 100) return 1.00;
  if (memberCount <= 500) return 1.50;
  if (memberCount <= 1000) return 2.00;
  if (memberCount <= 5000) return 2.50;
  return 3.00;
}

async function applyServerVaultTaxIfDue(serverId, memberCount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureTreasuryExists(client, serverId);

    const checkQuery = `
      SELECT balance, total_tax_paid, today_tax_paid, last_tax_deduction_at, custom_tax_rate
      FROM server_treasury
      WHERE server_id = $1
      FOR UPDATE
    `;
    const checkRes = await client.query(checkQuery, [serverId]);
    const row = checkRes.rows[0];

    const now = new Date();
    if (row.last_tax_deduction_at) {
      const lastTax = new Date(row.last_tax_deduction_at);
      const timeDiff = now.getTime() - lastTax.getTime();
      const cooldown = 24 * 60 * 60 * 1000;
      if (timeDiff < cooldown) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'cooldown' };
      }
    }

    const customRate = row.custom_tax_rate !== null ? parseFloat(row.custom_tax_rate) : null;
    const effectiveRate = customRate !== null ? customRate : getFluctuatingTaxRate(memberCount);
    const balance = parseInt(row.balance, 10);
    const taxAmount = Math.max(0, Math.floor(balance * (effectiveRate / 100.0)));

    if (taxAmount > 0) {
      await client.query(`
        UPDATE server_treasury
        SET balance = balance - $1,
            total_tax_paid = total_tax_paid + $1,
            today_tax_paid = $1,
            last_tax_deduction_at = $2
        WHERE server_id = $3
      `, [taxAmount, now, serverId]);
    } else {
      await client.query(`
        UPDATE server_treasury
        SET today_tax_paid = 0,
            last_tax_deduction_at = $1
        WHERE server_id = $2
      `, [now, serverId]);
    }

    await client.query('COMMIT');
    return {
      success: true,
      taxAmount,
      newBalance: balance - taxAmount
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in applyServerVaultTaxIfDue for server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

async function triggerServerVaultTaxDeduction(serverId, memberCount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureTreasuryExists(client, serverId);

    const checkQuery = `
      SELECT balance, total_tax_paid, today_tax_paid, custom_tax_rate
      FROM server_treasury
      WHERE server_id = $1
      FOR UPDATE
    `;
    const checkRes = await client.query(checkQuery, [serverId]);
    const row = checkRes.rows[0];

    const now = new Date();
    const customRate = row.custom_tax_rate !== null ? parseFloat(row.custom_tax_rate) : null;
    const effectiveRate = customRate !== null ? customRate : getFluctuatingTaxRate(memberCount);
    const balance = parseInt(row.balance, 10);
    const taxAmount = Math.max(0, Math.floor(balance * (effectiveRate / 100.0)));

    if (taxAmount > 0) {
      await client.query(`
        UPDATE server_treasury
        SET balance = balance - $1,
            total_tax_paid = total_tax_paid + $1,
            today_tax_paid = $1,
            last_tax_deduction_at = $2
        WHERE server_id = $3
      `, [taxAmount, now, serverId]);
    } else {
      await client.query(`
        UPDATE server_treasury
        SET today_tax_paid = 0,
            last_tax_deduction_at = $1
        WHERE server_id = $2
      `, [now, serverId]);
    }

    await client.query('COMMIT');
    return {
      success: true,
      taxAmount,
      newBalance: balance - taxAmount
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in triggerServerVaultTaxDeduction for server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

async function updateServerVaultCustomTaxRate(serverId, customTaxRate) {
  const client = await pool.connect();
  try {
    await ensureTreasuryExists(client, serverId);
    const rateValue = customTaxRate !== null && customTaxRate !== undefined && customTaxRate !== '' ? parseFloat(customTaxRate) : null;
    const query = `
      UPDATE server_treasury
      SET custom_tax_rate = $1
      WHERE server_id = $2
      RETURNING *
    `;
    const res = await client.query(query, [rateValue, serverId]);
    return res.rows[0];
  } catch (error) {
    console.error(`Error in updateServerVaultCustomTaxRate for server ${serverId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getServerSettings,
  updateServerChannels,
  updateServerSetting,
  checkInUser,
  getSoulsLeaderboard,
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
  addCharacterToInventory,
  sellCharacter,
  giftCharacter,
  purchaseShopItem,
  recordDuelLoss,
  getGlobalSettings,
  setGlobalSetting,
  getGlobalEconomyStats,
  getServerFeatureOverrides,
  setServerFeatureOverride,
  getServerDetail,
  getUserInspect,
  adminUpdateUser,
  getDatabaseSize,
  ensureTreasuryExists,
  getTreasury,
  updateTreasuryRates,
  applyDailyTaxIfDue,
  getServerGiveawaySettings,
  setServerGiveawaySettings,
  getFluctuatingTaxRate,
  applyServerVaultTaxIfDue,
  triggerServerVaultTaxDeduction,
  updateServerVaultCustomTaxRate
};

