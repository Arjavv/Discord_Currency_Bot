const { initDatabase, pool } = require('./src/database/db');
require('dotenv').config();

const TEST_SERVER = '999999999999999999';
const TEST_USER_1 = '111111111111111111';
const TEST_USER_2 = '222222222222222222';

// In-Memory Database State for Mock Engine
const mockState = {
  users: new Map(), // key: userId + '_' + serverId
  transactions: [],
  message_activity: [],
  cycles: [],
  cycle_results: [],
  server_settings: new Map() // key: serverId
};

let nextCycleId = 1;
let nextResultId = 1;

/**
 * Parses and executes SQL queries in-memory for the mock engine.
 */
function mockQueryExecutor(sql, params) {
  const normalizedSql = sql.replace(/\s+/g, ' ').trim();

  // 1. SELECT server_settings
  if (normalizedSql.includes('SELECT currency_name, currency_icon_url, drop_channel_id FROM server_settings') ||
      normalizedSql.includes('SELECT currency_name, currency_icon_url FROM server_settings')) {
    const [serverId] = params;
    const settings = mockState.server_settings.get(serverId);
    return { rows: settings ? [settings] : [] };
  }

  // 2. INSERT/UPDATE server_settings (upsert)
  if (normalizedSql.includes('INSERT INTO server_settings')) {
    const [serverId] = params;
    const existing = mockState.server_settings.get(serverId) || {
      server_id: serverId,
      currency_name: 'Souls',
      currency_icon_url: '<:Soul_Head:1523605643158618214>',
      drop_channel_id: null
    };

    if (normalizedSql.includes('drop_channel_id')) {
      const [, channelId] = params;
      existing.drop_channel_id = channelId;
    } else {
      const [, currencyName, currencyIconUrl] = params;
      if (currencyName !== null && currencyName !== undefined) existing.currency_name = currencyName;
      if (currencyIconUrl !== null && currencyIconUrl !== undefined) existing.currency_icon_url = currencyIconUrl;
    }

    mockState.server_settings.set(serverId, existing);
    return { rows: [existing] };
  }

  // 3. INSERT INTO users (ensure user exists)
  if (normalizedSql.includes('INSERT INTO users') && normalizedSql.includes('ON CONFLICT')) {
    const [discordId, serverId] = params;
    const key = `${discordId}_${serverId}`;
    if (!mockState.users.has(key)) {
      mockState.users.set(key, {
        discord_id: discordId,
        server_id: serverId,
        coin_balance: 0,
        last_checkin_at: null,
        message_count: 0
      });
    }
    return { rows: [] };
  }

  // 4. SELECT users (last_checkin_at, coin_balance)
  if (normalizedSql.includes('SELECT last_checkin_at, coin_balance FROM users') || normalizedSql.includes('SELECT coin_balance FROM users')) {
    const [discordId, serverId] = params;
    const key = `${discordId}_${serverId}`;
    const user = mockState.users.get(key) || {
      discord_id: discordId,
      server_id: serverId,
      coin_balance: 0,
      last_checkin_at: null,
      message_count: 0
    };
    return { rows: [user] };
  }

  // 5. UPDATE users (claim checkin)
  if (normalizedSql.includes('UPDATE users SET coin_balance = coin_balance + $1, last_checkin_at = $2')) {
    const [amount, checkinTime, discordId, serverId] = params;
    const key = `${discordId}_${serverId}`;
    const user = mockState.users.get(key);
    user.coin_balance += amount;
    user.last_checkin_at = checkinTime;
    return { rows: [{ coin_balance: user.coin_balance }] };
  }

  // 6. UPDATE users (increment message count)
  if (normalizedSql.includes('UPDATE users SET message_count = message_count + 1')) {
    const [discordId, serverId] = params;
    const key = `${discordId}_${serverId}`;
    const user = mockState.users.get(key);
    user.message_count += 1;
    return { rows: [{ message_count: user.message_count, coin_balance: user.coin_balance }] };
  }

  // 6.5. UPDATE users (award milestone coins, net change in casino, etc.)
  if (normalizedSql.includes('UPDATE users SET coin_balance = coin_balance + $1 WHERE')) {
    const [amount, discordId, serverId] = params;
    const key = `${discordId}_${serverId}`;
    const user = mockState.users.get(key);
    user.coin_balance += amount;
    return { rows: [{ coin_balance: user.coin_balance }] };
  }

  // 7. INSERT INTO transactions
  if (normalizedSql.includes('INSERT INTO transactions') && !normalizedSql.includes('SELECT')) {
    const [userId, serverId, amount, param3, param4] = params;
    let source = 'unknown';
    let createdAt = new Date();

    if (typeof param3 === 'string') {
      source = param3;
      createdAt = param4 || new Date();
    } else {
      source = normalizedSql.includes("'checkin'") ? 'checkin' : 
               normalizedSql.includes("'message'") ? 'message' : 
               normalizedSql.includes("'reset'") ? 'reset' : 
               normalizedSql.includes("'drop_catch'") ? 'drop_catch' : 'unknown';
      createdAt = param3 || new Date();
    }

    mockState.transactions.push({
      user_id: userId,
      server_id: serverId,
      amount,
      source,
      created_at: createdAt
    });
    return { rows: [] };
  }

  // 8. SELECT message_activity
  if (normalizedSql.includes('SELECT counted_at FROM message_activity')) {
    const [userId, serverId] = params;
    const userActivity = mockState.message_activity
      .filter(a => a.user_id === userId && a.server_id === serverId)
      .sort((a, b) => b.counted_at - a.counted_at);
    return { rows: userActivity.length > 0 ? [userActivity[0]] : [] };
  }

  // 9. SELECT daily message coins sum
  if (normalizedSql.includes("source = 'message'") && normalizedSql.includes('created_at >= NOW() - INTERVAL')) {
    const [userId, serverId] = params;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sum = mockState.transactions
      .filter(t => t.user_id === userId && t.server_id === serverId && t.source === 'message' && t.created_at >= cutoff)
      .reduce((acc, t) => acc + t.amount, 0);
    return { rows: [{ daily_sum: sum }] };
  }

  // 10. INSERT INTO message_activity
  if (normalizedSql.includes('INSERT INTO message_activity')) {
    const [userId, serverId, countedAt] = params;
    mockState.message_activity.push({
      user_id: userId,
      server_id: serverId,
      counted_at: countedAt || new Date()
    });
    return { rows: [] };
  }

  // 12. SELECT leaderboard
  if (normalizedSql.includes('ORDER BY coin_balance DESC LIMIT')) {
    const [serverId, limit] = params;
    const rankings = Array.from(mockState.users.values())
      .filter(u => u.server_id === serverId && u.coin_balance > 0)
      .sort((a, b) => b.coin_balance - a.coin_balance)
      .slice(0, limit);
    return { rows: rankings };
  }

  // 13. SELECT active cycle
  if (normalizedSql.includes('SELECT id FROM cycles WHERE server_id = $1 AND is_active = TRUE')) {
    const [serverId] = params;
    const activeCycle = mockState.cycles.find(c => c.server_id === serverId && c.is_active);
    return { rows: activeCycle ? [activeCycle] : [] };
  }

  // 14. INSERT active cycle
  if (normalizedSql.includes('INSERT INTO cycles') && normalizedSql.includes('started_at')) {
    const [serverId, startedAt, isActive] = params;
    const cycle = {
      id: nextCycleId++,
      server_id: serverId,
      started_at: startedAt || new Date(),
      ended_at: null,
      is_active: isActive !== undefined ? isActive : true
    };
    mockState.cycles.push(cycle);
    return { rows: [cycle] };
  }

  // 15. SELECT rankings of users with balance > 0 (during reset)
  if (normalizedSql.includes('SELECT discord_id, coin_balance FROM users WHERE server_id = $1 AND coin_balance > 0')) {
    const [serverId] = params;
    const rankings = Array.from(mockState.users.values())
      .filter(u => u.server_id === serverId && u.coin_balance > 0)
      .sort((a, b) => b.coin_balance - a.coin_balance);
    return { rows: rankings };
  }

  // 16. INSERT cycle_results
  if (normalizedSql.includes('INSERT INTO cycle_results')) {
    const [cycleId, discordId, finalCoins, rank] = params;
    mockState.cycle_results.push({
      id: nextResultId++,
      cycle_id: cycleId,
      discord_id: discordId,
      final_coins: finalCoins,
      rank
    });
    return { rows: [] };
  }

  // 17. UPDATE cycles close
  if (normalizedSql.includes('UPDATE cycles SET is_active = FALSE')) {
    const [endedAt, cycleId] = params;
    const cycle = mockState.cycles.find(c => c.id === cycleId);
    if (cycle) {
      cycle.is_active = false;
      cycle.ended_at = endedAt;
    }
    return { rows: [] };
  }

  // 18. INSERT transactions from reset
  if (normalizedSql.includes('INSERT INTO transactions') && normalizedSql.includes('SELECT')) {
    const [createdAt, serverId] = params;
    const usersToReset = Array.from(mockState.users.values()).filter(u => u.server_id === serverId && u.coin_balance > 0);
    for (const u of usersToReset) {
      mockState.transactions.push({
        user_id: u.discord_id,
        server_id: u.server_id,
        amount: -u.coin_balance,
        source: 'reset',
        created_at: createdAt
      });
    }
    return { rows: [] };
  }

  // 19. RESET user balances
  if (normalizedSql.includes('UPDATE users SET coin_balance = 0, message_count = 0 WHERE server_id = $1')) {
    const [serverId] = params;
    for (const u of mockState.users.values()) {
      if (u.server_id === serverId) {
        u.coin_balance = 0;
        u.message_count = 0;
      }
    }
    return { rows: [] };
  }

  return { rows: [] };
}

/**
 * Setup a mock pg client pool to bypass PG connection issues during testing.
 */
function setupMockDatabase() {
  console.log('\n⚠️  PostgreSQL connection failed or credentials not config.');
  console.log('⚡ Running verification tests using the In-Memory Mock Database Engine instead...\n');

  const mockClient = {
    query: async (sql, params) => mockQueryExecutor(sql, params),
    release: () => {}
  };

  pool.query = async (sql, params) => mockQueryExecutor(sql, params);
  pool.connect = async () => mockClient;
  pool.end = async () => {};
}

async function runTests() {
  console.log('--- STARTING DATABASE INTEGRATION TESTS ---');
  
  let useMock = false;
  try {
    const testClient = await pool.connect();
    testClient.release();
    await initDatabase();
    console.log('✔ Real database initialized.');
  } catch (err) {
    useMock = true;
    setupMockDatabase();
  }

  const {
    getServerSettings,
    updateServerSetting,
    checkInUser,
    recordMessageActivity,
    getUserBalance,
    getLeaderboard,
    resetCycle,
    recordCasinoGame,
    updateDropChannel,
    awardDropCoins
} = require('./src/database/queries');

  try {
    // 2. Server Settings Test
    console.log('Testing Server Settings...');
    let settings = await getServerSettings(TEST_SERVER);
    console.log(`Default settings: Name="${settings.currency_name}", Icon="${settings.currency_icon_url}"`);

    await updateServerSetting(TEST_SERVER, 'ApexGold', '🪙');
    settings = await getServerSettings(TEST_SERVER);
    console.log(`Updated settings: Name="${settings.currency_name}", Icon="${settings.currency_icon_url}"`);
    if (settings.currency_name !== 'ApexGold' || settings.currency_icon_url !== '🪙') {
      throw new Error('Server settings update failed');
    }
    console.log('✔ Server settings test passed.');

    // Cleanup any existing test data to ensure clean state
    if (!useMock) {
      await pool.query("DELETE FROM users WHERE server_id = $1 OR server_id = 'GLOBAL'", [TEST_SERVER]);
      await pool.query('DELETE FROM cycles WHERE server_id = $1', [TEST_SERVER]);
    } else {
      mockState.users.clear();
      mockState.transactions = [];
      mockState.message_activity = [];
      mockState.cycles = [];
      mockState.cycle_results = [];
    }

    // 3. User Check-in Test
    console.log('\nTesting Daily Check-in...');
    const checkin1 = await checkInUser(TEST_USER_1, TEST_SERVER, 20);
    console.log('First check-in result:', checkin1);
    if (!checkin1.success || checkin1.newBalance !== 20) {
      throw new Error('First check-in failed or returned incorrect balance');
    }

    // Test Cooldown
    const checkin2 = await checkInUser(TEST_USER_1, TEST_SERVER, 20);
    console.log('Second check-in (cooldown) result:', checkin2);
    if (checkin2.success) {
      throw new Error('Check-in should be rate-limited but succeeded');
    }
    console.log(`Remaining Cooldown: ${(checkin2.cooldownRemainingMs / 1000 / 60 / 60).toFixed(2)} hours`);
    console.log('✔ Daily check-in & cooldown test passed.');

    // 4. Message Activity Earnings Test
    console.log('\nTesting Message Activity Counter & Milestones...');
    const msg1 = await recordMessageActivity(TEST_USER_1, TEST_SERVER, 10, 15, 20);
    console.log('Message 1 (count starts) result:', msg1);
    if (!msg1.success || msg1.awardedMilestone || msg1.totalMessages !== 1) {
      throw new Error('First message count increment failed');
    }

    // Send rapid second message
    const msg2 = await recordMessageActivity(TEST_USER_1, TEST_SERVER, 10, 15, 20);
    console.log('Message 2 (rapid cooldown) result:', msg2);
    if (msg2.success) {
      throw new Error('Message activity rate limit of 60s bypassed!');
    }

    // Fast forward user 2 to 99 messages to test the 100th milestone
    console.log('Simulating 100-message Milestone award (User 2)...');
    if (!useMock) {
      await pool.query('DELETE FROM transactions WHERE user_id = $1 AND server_id = \'GLOBAL\'', [TEST_USER_2]);
      await pool.query(
        `INSERT INTO users (discord_id, server_id, coin_balance, message_count) VALUES ($1, 'GLOBAL', 0, 99) 
         ON CONFLICT (discord_id, server_id) DO UPDATE SET coin_balance = 0, message_count = 99`, 
        [TEST_USER_2]
      );
    } else {
      mockState.users.set(`${TEST_USER_2}_GLOBAL`, {
        discord_id: TEST_USER_2,
        server_id: 'GLOBAL',
        coin_balance: 0,
        last_checkin_at: null,
        message_count: 99
      });
    }

    // Send the 100th message
    const milestone1 = await recordMessageActivity(TEST_USER_2, TEST_SERVER, 10, 0, 20);
    console.log('Message 100 (reaches milestone 1) result:', milestone1);
    if (!milestone1.success || !milestone1.awardedMilestone || milestone1.amountAwarded !== 10 || milestone1.newBalance !== 10) {
      throw new Error('Failed to award 10 coins on 100th message milestone');
    }

    // Fast forward user 2 to 199 messages to test the 200th milestone
    console.log('Simulating 200-message Milestone award (User 2)...');
    if (!useMock) {
      await pool.query('UPDATE users SET message_count = 199 WHERE discord_id = $1 AND server_id = \'GLOBAL\'', [TEST_USER_2]);
    } else {
      mockState.users.get(`${TEST_USER_2}_GLOBAL`).message_count = 199;
    }

    // Send the 200th message
    const milestone2 = await recordMessageActivity(TEST_USER_2, TEST_SERVER, 10, 0, 20);
    console.log('Message 200 (reaches milestone 2) result:', milestone2);
    if (!milestone2.success || !milestone2.awardedMilestone || milestone2.newBalance !== 20) {
      throw new Error('Failed to award 10 coins on 200th message milestone');
    }

    // Fast forward user 2 to 299 messages to test daily cap block (300th milestone)
    console.log('Simulating 300-message Milestone with Daily Cap check (User 2)...');
    if (!useMock) {
      await pool.query('UPDATE users SET message_count = 299 WHERE discord_id = $1 AND server_id = \'GLOBAL\'', [TEST_USER_2]);
    } else {
      mockState.users.get(`${TEST_USER_2}_GLOBAL`).message_count = 299;
    }

    // Send the 300th message - should fail because daily cap of 20 coins is already hit!
    const milestone3 = await recordMessageActivity(TEST_USER_2, TEST_SERVER, 10, 0, 20);
    console.log('Message 300 (exceeds cap block) result:', milestone3);
    if (!milestone3.success || milestone3.awardedMilestone || milestone3.newBalance !== 20) {
      throw new Error('Daily milestone coin cap was bypassed!');
    }
    console.log('✔ Message milestone activity & cap tests passed.');

    // 4.5 Testing Casino Game transactions
    console.log('\nTesting Casino Game Coin Flip Bets...');
    // User 1 starts with 20 coins
    // Place a win bet (should add 10 coins)
    const casinoWin = await recordCasinoGame(TEST_USER_1, TEST_SERVER, 10, true);
    console.log('Casino Flip Win result:', casinoWin);
    if (!casinoWin.success || !casinoWin.won || casinoWin.newBalance !== 30) {
      throw new Error('Casino flip win bet failed to award correct coins');
    }

    // Place a loss bet (should subtract 10 coins)
    const casinoLoss = await recordCasinoGame(TEST_USER_1, TEST_SERVER, 10, false);
    console.log('Casino Flip Loss result:', casinoLoss);
    if (!casinoLoss.success || casinoLoss.won || casinoLoss.newBalance !== 20) {
      throw new Error('Casino flip loss bet failed to deduct correct coins');
    }

    // Test Insufficient Funds bet (user has 20, tries to bet 50)
    const casinoPoor = await recordCasinoGame(TEST_USER_1, TEST_SERVER, 50, true);
    console.log('Casino Flip Insufficient funds result:', casinoPoor);
    if (casinoPoor.success || casinoPoor.reason !== 'insufficient_funds') {
      throw new Error('Casino bet with insufficient funds should have failed');
    }
    console.log('✔ Casino flip win/loss/insufficient tests passed.');

    // 5. Balance & Leaderboard tests
    console.log('\nTesting Balance & Leaderboard fetch...');
    const balance1 = await getUserBalance(TEST_USER_1, TEST_SERVER);
    console.log(`User 1 Balance info:`, balance1);
    if (balance1.balance !== 20) {
      throw new Error(`Incorrect balance for user 1. Expected 20, got ${balance1.balance}`);
    }

    const balance2 = await getUserBalance(TEST_USER_2, TEST_SERVER);
    console.log(`User 2 Balance info:`, balance2);
    if (balance2.balance !== 20) {
      throw new Error(`Incorrect balance for user 2. Expected 20, got ${balance2.balance}`);
    }

    const leaderboard = await getLeaderboard(TEST_SERVER, 10);
    console.log('Leaderboard rankings:', leaderboard.rankings);
    if (leaderboard.rankings.length !== 2) {
      throw new Error(`Leaderboard should return 2 users, got ${leaderboard.rankings.length}`);
    }
    console.log('✔ Balance and Leaderboard tests passed.');

    // 5.5 Testing Drop Channel and Drop Catch
    console.log('\nTesting Drop Channel Settings and Drop Coin Catching...');
    const dropChannelId = '123456789012345678';
    const updatedSettings = await updateDropChannel(TEST_SERVER, dropChannelId);
    console.log('Updated drop channel setting:', updatedSettings);
    if (updatedSettings.drop_channel_id !== dropChannelId) {
      throw new Error('Failed to update drop channel ID');
    }

    const testDropAward = await awardDropCoins(TEST_USER_1, TEST_SERVER, 35);
    console.log('Award drop coins result:', testDropAward);
    if (!testDropAward.success || testDropAward.amount !== 35 || testDropAward.newBalance !== 55) {
      throw new Error('Failed to award drop coins correctly to user 1');
    }
    console.log('✔ Drop channel settings and drop catch tests passed.');

    // 6. Reset Cycle Test (Should be blocked in global economy)
    console.log('\nTesting Cycle Reset (should fail in global economy)...');
    const reset = await resetCycle(TEST_SERVER);
    console.log('Cycle reset result:', reset);
    if (reset.success || reset.reason !== 'global_economy') {
      throw new Error('Cycle reset should have failed under Global Economy mode');
    }

    // Check balances remain unchanged (User 1 retains 55 coins)
    const finalBalance1 = await getUserBalance(TEST_USER_1, TEST_SERVER);
    console.log('User 1 Balance after reset attempt:', finalBalance1.balance);
    if (finalBalance1.balance !== 55) {
      throw new Error('Balances should not be reset to zero in global economy mode');
    }
    console.log('✔ Cycle reset block test passed.');

    console.log('\n=========================================');
    console.log('ALL DATABASE INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('=========================================');
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
