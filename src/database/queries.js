const { pool } = require('./db');

/**
 * Gets server currency settings. Returns default values if settings don't exist.
 */
async function getServerSettings(serverId) {
  const query = `
    SELECT currency_name, currency_icon_url, drop_channel_id, auto_drops_enabled 
    FROM server_settings 
    WHERE server_id = $1
  `;
  try {
    const res = await pool.query(query, [serverId]);
    if (res.rows.length > 0) {
      return res.rows[0];
    }
    return {
      currency_name: 'Souls',
      currency_icon_url: '<:Soul_Head:1523605643158618214>',
      drop_channel_id: null,
      auto_drops_enabled: false
    };
  } catch (error) {
    console.error(`Error in getServerSettings for server ${serverId}:`, error);
    return {
      currency_name: 'Souls',
      currency_icon_url: '<:Soul_Head:1523605643158618214>',
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
  const query = `
    INSERT INTO users (discord_id, server_id, coin_balance)
    VALUES ($1, $2, 0)
    ON CONFLICT (discord_id, server_id) DO NOTHING
  `;
  await client.query(query, [discordId, serverId]);
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
      WHERE discord_id = $1 AND server_id = $2 
      FOR UPDATE
    `;
    const userRes = await client.query(userQuery, [discordId, serverId]);
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
      WHERE discord_id = $3 AND server_id = $4
      RETURNING coin_balance
    `;
    const updateRes = await client.query(updateQuery, [amount, now, discordId, serverId]);
    const newBalance = updateRes.rows[0].coin_balance;

    // 4. Log transaction
    const logQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source, created_at)
      VALUES ($1, $2, $3, 'checkin', $4)
    `;
    await client.query(logQuery, [discordId, serverId, amount, now]);

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
async function recordMessageActivity(discordId, serverId, coinAmount = 10, cooldownSeconds = 0, dailyCap = 20) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure user exists
    await ensureUserExists(client, discordId, serverId);

    const now = new Date();

    // 2. Check 60-second rate-limit
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

    // 3. Insert message activity log (qualifying chat event)
    const activityQuery = `
      INSERT INTO message_activity (user_id, server_id, counted_at)
      VALUES ($1, $2, $3)
    `;
    await client.query(activityQuery, [discordId, serverId, now]);

    // 4. Increment message count
    const incrementQuery = `
      UPDATE users 
      SET message_count = message_count + 1 
      WHERE discord_id = $1 AND server_id = $2
      RETURNING message_count, coin_balance
    `;
    const incRes = await client.query(incrementQuery, [discordId, serverId]);
    const messageCount = incRes.rows[0].message_count;
    let balance = incRes.rows[0].coin_balance;

    // 5. Check if we hit the 100-message milestone
    if (messageCount > 0 && messageCount % 100 === 0) {
      // Check daily cap from message rewards in last 24 hours
      const dailyQuery = `
        SELECT COALESCE(SUM(amount), 0) AS daily_sum 
        FROM transactions 
        WHERE user_id = $1 AND server_id = $2 AND source = 'message' AND created_at >= NOW() - INTERVAL '24 hours'
      `;
      const dailyRes = await client.query(dailyQuery, [discordId, serverId]);
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

      // Award milestone coins
      const updateBalanceQuery = `
        UPDATE users 
        SET coin_balance = coin_balance + $1 
        WHERE discord_id = $2 AND server_id = $3
        RETURNING coin_balance
      `;
      const updateRes = await client.query(updateBalanceQuery, [amountToAward, discordId, serverId]);
      balance = updateRes.rows[0].coin_balance;

      // Log transaction
      const logQuery = `
        INSERT INTO transactions (user_id, server_id, amount, source, created_at)
        VALUES ($1, $2, $3, 'message', $4)
      `;
      await client.query(logQuery, [discordId, serverId, amountToAward, now]);

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

    // Ensure user exists first
    const client = await pool.connect();
    try {
      await ensureUserExists(client, discordId, serverId);
    } finally {
      client.release();
    }

    const query = `
      SELECT coin_balance 
      FROM users 
      WHERE discord_id = $1 AND server_id = $2
    `;
    const res = await pool.query(query, [discordId, serverId]);
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
 * Retrieves the top 10 users ranked by coin_balance.
 */
async function getLeaderboard(serverId, limit = 10) {
  try {
    const settings = await getServerSettings(serverId);
    const query = `
      SELECT discord_id, coin_balance 
      FROM users 
      WHERE server_id = $1 AND coin_balance > 0
      ORDER BY coin_balance DESC 
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
 * Resets the current monthly cycle.
 * Closes the active cycle, archives top rankings into cycle_results,
 * resets all balances, and launches a new cycle.
 */
async function resetCycle(serverId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const now = new Date();

    // 1. Find or create an active cycle
    let activeCycleQuery = `
      SELECT id FROM cycles 
      WHERE server_id = $1 AND is_active = TRUE 
      FOR UPDATE
    `;
    let cycleRes = await client.query(activeCycleQuery, [serverId]);
    let cycleId;

    if (cycleRes.rows.length === 0) {
      // If no active cycle, create one that started immediately
      const createCycleQuery = `
        INSERT INTO cycles (server_id, started_at, is_active)
        VALUES ($1, NOW() - INTERVAL '1 month', TRUE)
        RETURNING id
      `;
      const createRes = await client.query(createCycleQuery, [serverId]);
      cycleId = createRes.rows[0].id;
    } else {
      cycleId = cycleRes.rows[0].id;
    }

    // 2. Archive rankings of users with balance > 0
    const rankingsQuery = `
      SELECT discord_id, coin_balance 
      FROM users 
      WHERE server_id = $1 AND coin_balance > 0
      ORDER BY coin_balance DESC
    `;
    const rankingsRes = await client.query(rankingsQuery, [serverId]);
    const usersToArchive = rankingsRes.rows;

    if (usersToArchive.length > 0) {
      const insertResultQuery = `
        INSERT INTO cycle_results (cycle_id, discord_id, final_coins, rank)
        VALUES ($1, $2, $3, $4)
      `;
      for (let i = 0; i < usersToArchive.length; i++) {
        const u = usersToArchive[i];
        await client.query(insertResultQuery, [cycleId, u.discord_id, u.coin_balance, i + 1]);
      }
    }

    // 3. Mark the active cycle as closed
    const closeCycleQuery = `
      UPDATE cycles 
      SET is_active = FALSE, ended_at = $1 
      WHERE id = $2
    `;
    await client.query(closeCycleQuery, [now, cycleId]);

    // 4. Log transactions for auditing: reset check-in times and set coin balances to 0
    // Record reset transaction for all users with >0 balance
    const logTransactionQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source, created_at)
      SELECT discord_id, server_id, -coin_balance, 'reset', $1
      FROM users
      WHERE server_id = $2 AND coin_balance > 0
    `;
    await client.query(logTransactionQuery, [now, serverId]);

    // 5. Reset balances and message counts in the users table
    const resetUsersQuery = `
      UPDATE users 
      SET coin_balance = 0, message_count = 0
      WHERE server_id = $1
    `;
    await client.query(resetUsersQuery, [serverId]);

    // 6. Create a new active cycle
    const newCycleQuery = `
      INSERT INTO cycles (server_id, started_at, is_active)
      VALUES ($1, $2, TRUE)
      RETURNING id
    `;
    const newCycleRes = await client.query(newCycleQuery, [serverId, now]);
    const newCycleId = newCycleRes.rows[0].id;

    await client.query('COMMIT');
    return {
      success: true,
      archivedCount: usersToArchive.length,
      oldCycleId: cycleId,
      newCycleId
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error in resetCycle for server ${serverId}:`, error);
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
async function recordCasinoGame(discordId, serverId, betAmount, isWin) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure user exists
    await ensureUserExists(client, discordId, serverId);

    // 2. Fetch current user balance
    const balanceQuery = `
      SELECT coin_balance 
      FROM users 
      WHERE discord_id = $1 AND server_id = $2 
      FOR UPDATE
    `;
    const balanceRes = await client.query(balanceQuery, [discordId, serverId]);
    const currentBalance = balanceRes.rows[0].coin_balance;

    if (currentBalance < betAmount) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'insufficient_funds', currentBalance };
    }

    // 3. Calculate new balance and amount to change
    const netChange = isWin ? betAmount : -betAmount;
    const updateQuery = `
      UPDATE users 
      SET coin_balance = coin_balance + $1 
      WHERE discord_id = $2 AND server_id = $3
      RETURNING coin_balance
    `;
    const updateRes = await client.query(updateQuery, [netChange, discordId, serverId]);
    const newBalance = updateRes.rows[0].coin_balance;

    // 4. Log transaction
    const logQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source)
      VALUES ($1, $2, $3, $4)
    `;
    const source = isWin ? 'casino_win' : 'casino_loss';
    await client.query(logQuery, [discordId, serverId, netChange, source]);

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
 * Awards coins from catching a drop.
 */
async function awardDropCoins(discordId, serverId, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure user exists
    await ensureUserExists(client, discordId, serverId);

    // Update user balance
    const updateQuery = `
      UPDATE users 
      SET coin_balance = coin_balance + $1
      WHERE discord_id = $2 AND server_id = $3
      RETURNING coin_balance
    `;
    const updateRes = await client.query(updateQuery, [amount, discordId, serverId]);
    const newBalance = updateRes.rows[0].coin_balance;

    // Log transaction
    const logQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source)
      VALUES ($1, $2, $3, 'drop_catch')
    `;
    await client.query(logQuery, [discordId, serverId, amount]);

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

    // 1. Ensure both users exist
    await ensureUserExists(client, senderId, serverId);
    await ensureUserExists(client, receiverId, serverId);

    // 2. Fetch sender balance with row lock
    const senderBalanceQuery = `
      SELECT coin_balance 
      FROM users 
      WHERE discord_id = $1 AND server_id = $2 
      FOR UPDATE
    `;
    const senderRes = await client.query(senderBalanceQuery, [senderId, serverId]);
    const senderBalance = senderRes.rows[0].coin_balance;

    if (senderBalance < amount) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'insufficient_funds', currentBalance: senderBalance };
    }

    // 3. Deduct from sender
    const deductQuery = `
      UPDATE users 
      SET coin_balance = coin_balance - $1
      WHERE discord_id = $2 AND server_id = $3
      RETURNING coin_balance
    `;
    const newSenderBalance = (await client.query(deductQuery, [amount, senderId, serverId])).rows[0].coin_balance;

    // 4. Add to receiver
    const addQuery = `
      UPDATE users 
      SET coin_balance = coin_balance + $1
      WHERE discord_id = $2 AND server_id = $3
    `;
    await client.query(addQuery, [amount, receiverId, serverId]);

    // 5. Log transaction for sender
    const logSenderQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source)
      VALUES ($1, $2, $3, 'transfer_sent')
    `;
    await client.query(logSenderQuery, [senderId, serverId, -amount]);

    // 6. Log transaction for receiver
    const logReceiverQuery = `
      INSERT INTO transactions (user_id, server_id, amount, source)
      VALUES ($1, $2, $3, 'transfer_received')
    `;
    await client.query(logReceiverQuery, [receiverId, serverId, amount]);

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

    // 1. Ensure both users exist
    await ensureUserExists(client, robberId, serverId);
    await ensureUserExists(client, targetId, serverId);

    // 2. Fetch robber data with row lock
    const robberQuery = `
      SELECT coin_balance, last_rob_at 
      FROM users 
      WHERE discord_id = $1 AND server_id = $2 
      FOR UPDATE
    `;
    const robberRes = await client.query(robberQuery, [robberId, serverId]);
    const robberBalance = robberRes.rows[0].coin_balance;
    const lastRobAt = robberRes.rows[0].last_rob_at;

    // 3. Check 6-hour cooldown
    if (lastRobAt) {
      const msSinceLastRob = Date.now() - new Date(lastRobAt).getTime();
      const cooldownMs = 6 * 60 * 60 * 1000;
      if (msSinceLastRob < cooldownMs) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'cooldown', cooldownRemainingMs: cooldownMs - msSinceLastRob };
      }
    }

    // 4. Fetch target balance with row lock
    const targetQuery = `
      SELECT coin_balance 
      FROM users 
      WHERE discord_id = $1 AND server_id = $2 
      FOR UPDATE
    `;
    const targetRes = await client.query(targetQuery, [targetId, serverId]);
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

    // 5. Update last_rob_at for robber immediately so they can't spam
    const updateRobTimeQuery = `
      UPDATE users SET last_rob_at = NOW() 
      WHERE discord_id = $1 AND server_id = $2
    `;
    await client.query(updateRobTimeQuery, [robberId, serverId]);

    // 6. Roll the dice! (30% success chance)
    const isSuccess = Math.random() < 0.30;

    if (isSuccess) {
      // Steal 10% of target's wallet
      const stolenAmount = Math.floor(targetBalance * 0.10);
      
      if (stolenAmount <= 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'target_poor' }; // Failsafe
      }

      await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE discord_id = $2 AND server_id = $3`, [stolenAmount, targetId, serverId]);
      await client.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE discord_id = $2 AND server_id = $3`, [stolenAmount, robberId, serverId]);
      
      await client.query(`INSERT INTO transactions (user_id, server_id, amount, source) VALUES ($1, $2, $3, 'rob_success_gain')`, [robberId, serverId, stolenAmount]);
      await client.query(`INSERT INTO transactions (user_id, server_id, amount, source) VALUES ($1, $2, $3, 'rob_success_loss')`, [targetId, serverId, -stolenAmount]);

      await client.query('COMMIT');
      return { success: true, amount: stolenAmount, newBalance: robberBalance + stolenAmount };
    } else {
      // Caught! Pay 5% of robber's wallet
      const fineAmount = Math.floor(robberBalance * 0.05);

      if (fineAmount > 0) {
        await client.query(`UPDATE users SET coin_balance = coin_balance - $1 WHERE discord_id = $2 AND server_id = $3`, [fineAmount, robberId, serverId]);
        await client.query(`UPDATE users SET coin_balance = coin_balance + $1 WHERE discord_id = $2 AND server_id = $3`, [fineAmount, targetId, serverId]);
        
        await client.query(`INSERT INTO transactions (user_id, server_id, amount, source) VALUES ($1, $2, $3, 'rob_caught_fine')`, [robberId, serverId, -fineAmount]);
        await client.query(`INSERT INTO transactions (user_id, server_id, amount, source) VALUES ($1, $2, $3, 'rob_caught_reward')`, [targetId, serverId, fineAmount]);
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
  attemptRob
};
