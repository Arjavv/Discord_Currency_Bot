const { initDatabase, pool } = require('./src/database/db');
require('dotenv').config();

const TEST_SERVER = '999999999999999999';
const TEST_SERVER_2 = '888888888888888888';
const TEST_USER_1 = '111111111111111111';
const TEST_USER_2 = '222222222222222222';

// In-Memory Database State for Mock Engine
const mockState = {
  users: new Map(), // key: userId + '_' + serverId
  transactions: [],
  message_activity: [],
  cycles: [],
  cycle_results: [],
  server_settings: new Map(), // key: serverId
  global_settings: new Map(),  // key: settingKey
  server_treasury: new Map(), // key: serverId
  user_daily_tax: new Map(),  // key: userId + '_' + serverId
  user_inventory: new Map()   // key: userId + '_' + serverId + '_' + itemId
};

let nextCycleId = 1;
let nextResultId = 1;

/**
 * Parses and executes SQL queries in-memory for the mock engine.
 */
function mockQueryExecutor(sql, params) {
  const normalizedSql = sql.replace(/\s+/g, ' ').trim();

  // --- Treasury Mock Queries ---
  if (normalizedSql.includes('INSERT INTO server_treasury')) {
    const [serverId] = params;
    if (!mockState.server_treasury.has(serverId)) {
      mockState.server_treasury.set(serverId, {
        server_id: serverId,
        balance: 100000,
        daily_tax_rate: 1.00,
        win_tax_rate: 10.00,
        sell_tax_rate: 10.00,
        total_tax_paid: 0,
        today_tax_paid: 0,
        last_tax_deduction_at: null,
        custom_tax_rate: null
      });
    }
    return { rows: [] };
  }

  if (normalizedSql.includes('SELECT balance') && normalizedSql.includes('custom_tax_rate')) {
    const [serverId] = params;
    const treasury = mockState.server_treasury.get(serverId) || {
      server_id: serverId,
      balance: 100000,
      daily_tax_rate: 1.00,
      win_tax_rate: 10.00,
      sell_tax_rate: 10.00,
      total_tax_paid: 0,
      today_tax_paid: 0,
      last_tax_deduction_at: null,
      custom_tax_rate: null
    };
    return { rows: [treasury] };
  }

  if (normalizedSql.includes('SELECT balance, daily_tax_rate, win_tax_rate, sell_tax_rate') && normalizedSql.includes('total_tax_paid')) {
    const [serverId] = params;
    const treasury = mockState.server_treasury.get(serverId) || {
      server_id: serverId,
      balance: 100000,
      daily_tax_rate: 1.00,
      win_tax_rate: 10.00,
      sell_tax_rate: 10.00,
      total_tax_paid: 0,
      today_tax_paid: 0,
      last_tax_deduction_at: null,
      custom_tax_rate: null
    };
    return { rows: [treasury] };
  }

  if (normalizedSql.includes('SELECT balance, daily_tax_rate, win_tax_rate, sell_tax_rate FROM server_treasury')) {
    const [serverId] = params;
    const treasury = mockState.server_treasury.get(serverId) || {
      server_id: serverId,
      balance: 100000,
      daily_tax_rate: 1.00,
      win_tax_rate: 10.00,
      sell_tax_rate: 10.00,
      total_tax_paid: 0,
      today_tax_paid: 0,
      last_tax_deduction_at: null,
      custom_tax_rate: null
    };
    return { rows: [treasury] };
  }

  if (normalizedSql.includes('SELECT daily_tax_rate FROM server_treasury') || normalizedSql.includes('SELECT win_tax_rate FROM server_treasury') || normalizedSql.includes('SELECT sell_tax_rate FROM server_treasury')) {
    const [serverId] = params;
    const treasury = mockState.server_treasury.get(serverId) || {
      server_id: serverId,
      balance: 100000,
      daily_tax_rate: 1.00,
      win_tax_rate: 10.00,
      sell_tax_rate: 10.00,
      total_tax_paid: 0,
      today_tax_paid: 0,
      last_tax_deduction_at: null,
      custom_tax_rate: null
    };
    return { rows: [treasury] };
  }

  if (normalizedSql.includes('UPDATE server_treasury SET custom_tax_rate =')) {
    const [customRate, serverId] = params;
    const treasury = mockState.server_treasury.get(serverId) || {
      server_id: serverId,
      balance: 100000,
      daily_tax_rate: 1.00,
      win_tax_rate: 10.00,
      sell_tax_rate: 10.00,
      total_tax_paid: 0,
      today_tax_paid: 0,
      last_tax_deduction_at: null,
      custom_tax_rate: null
    };
    treasury.custom_tax_rate = customRate;
    mockState.server_treasury.set(serverId, treasury);
    return { rows: [treasury] };
  }

  if (normalizedSql.includes('UPDATE server_treasury SET daily_tax_rate = COALESCE')) {
    const [dailyRate, winRate, sellRate, serverId] = params;
    const treasury = mockState.server_treasury.get(serverId) || {
      server_id: serverId,
      balance: 100000,
      daily_tax_rate: 1.00,
      win_tax_rate: 10.00,
      sell_tax_rate: 10.00,
      total_tax_paid: 0,
      today_tax_paid: 0,
      last_tax_deduction_at: null,
      custom_tax_rate: null
    };
    if (dailyRate !== null && dailyRate !== undefined) treasury.daily_tax_rate = dailyRate;
    if (winRate !== null && winRate !== undefined) treasury.win_tax_rate = winRate;
    if (sellRate !== null && sellRate !== undefined) treasury.sell_tax_rate = sellRate;
    mockState.server_treasury.set(serverId, treasury);
    return { rows: [treasury] };
  }

  if (normalizedSql.includes('UPDATE server_treasury SET balance = balance - $1, total_tax_paid = total_tax_paid + $1')) {
    const [taxAmount, lastTaxTime, serverId] = params;
    const treasury = mockState.server_treasury.get(serverId) || {
      server_id: serverId,
      balance: 100000,
      daily_tax_rate: 1.00,
      win_tax_rate: 10.00,
      sell_tax_rate: 10.00,
      total_tax_paid: 0,
      today_tax_paid: 0,
      last_tax_deduction_at: null,
      custom_tax_rate: null
    };
    treasury.balance = (BigInt(treasury.balance) - BigInt(taxAmount)).toString();
    treasury.total_tax_paid = (BigInt(treasury.total_tax_paid) + BigInt(taxAmount)).toString();
    treasury.today_tax_paid = taxAmount.toString();
    treasury.last_tax_deduction_at = lastTaxTime;
    mockState.server_treasury.set(serverId, treasury);
    return { rows: [treasury] };
  }

  if (normalizedSql.includes('UPDATE server_treasury SET balance = balance + $1')) {
    const [amount, serverId] = params;
    const treasury = mockState.server_treasury.get(serverId) || {
      server_id: serverId,
      balance: 100000,
      daily_tax_rate: 1.00,
      win_tax_rate: 10.00,
      sell_tax_rate: 10.00,
      total_tax_paid: 0,
      today_tax_paid: 0,
      last_tax_deduction_at: null,
      custom_tax_rate: null
    };
    treasury.balance = (BigInt(treasury.balance) + BigInt(amount)).toString();
    mockState.server_treasury.set(serverId, treasury);
    return { rows: [treasury] };
  }

  // --- Daily Tax Mock Queries ---
  if (normalizedSql.includes('SELECT last_taxed_at FROM user_daily_tax')) {
    const [discordId, serverId] = params;
    const key = `${discordId}_${serverId}`;
    const taxRecord = mockState.user_daily_tax.get(key);
    return { rows: taxRecord ? [taxRecord] : [] };
  }

  if (normalizedSql.includes('INSERT INTO user_daily_tax')) {
    const [discordId, serverId, lastTaxed] = params;
    const key = `${discordId}_${serverId}`;
    mockState.user_daily_tax.set(key, {
      discord_id: discordId,
      server_id: serverId,
      last_taxed_at: lastTaxed
    });
    return { rows: [] };
  }

  // --- Inventory Mock Queries (for Sell) ---
  if (normalizedSql.includes('SELECT quantity FROM user_inventory')) {
    const [discordId, itemId] = params; // select quantity from user_inventory where discord_id = $1 and server_id = 'GLOBAL' and item_id = $2
    const key = `${discordId}_GLOBAL_${itemId}`;
    const item = mockState.user_inventory.get(key);
    return { rows: item ? [item] : [] };
  }

  if (normalizedSql.includes('UPDATE user_inventory SET quantity = $3')) {
    const [discordId, itemId, qty] = params; // update user_inventory set quantity = $3 where discord_id = $1 and server_id = 'GLOBAL' and item_id = $2
    const key = `${discordId}_GLOBAL_${itemId}`;
    const item = mockState.user_inventory.get(key) || { discord_id: discordId, server_id: 'GLOBAL', item_id: itemId, quantity: 0 };
    item.quantity = qty;
    mockState.user_inventory.set(key, item);
    return { rows: [] };
  }

  if (normalizedSql.includes('DELETE FROM user_inventory')) {
    const [discordId, itemId] = params;
    const key = `${discordId}_GLOBAL_${itemId}`;
    mockState.user_inventory.delete(key);
    return { rows: [] };
  }

  // 0. SELECT global_settings
  if (normalizedSql.includes('SELECT key, value FROM global_settings')) {
    const rows = [];
    mockState.global_settings.forEach((val, key) => {
      rows.push({ key, value: val });
    });
    return { rows };
  }

  // 0.1 INSERT/UPDATE global_settings
  if (normalizedSql.includes('INSERT INTO global_settings')) {
    const [key, val] = params;
    if (normalizedSql.includes('DO UPDATE')) {
      mockState.global_settings.set(key, val);
    } else {
      // ON CONFLICT DO NOTHING
      if (!mockState.global_settings.has(key)) {
        mockState.global_settings.set(key, val);
      }
    }
    return { rows: [{ key, value: val }] };
  }

  // 1. SELECT server_settings
  if (normalizedSql.includes('SELECT currency_name, currency_icon_url, drop_channel_id FROM server_settings') ||
      normalizedSql.includes('SELECT currency_name, currency_icon_url FROM server_settings') ||
      normalizedSql.includes('SELECT drop_channel_id, auto_drops_enabled FROM server_settings')) {
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
    const discordId = params[0];
    const serverId = params[1] || (normalizedSql.includes("'GLOBAL'") ? 'GLOBAL' : undefined);
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
    const discordId = params[0];
    const serverId = params[1] || (normalizedSql.includes("'GLOBAL'") ? 'GLOBAL' : undefined);
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
    const [amount, checkinTime, discordId, pServerId] = params;
    const serverId = pServerId || (normalizedSql.includes("'GLOBAL'") ? 'GLOBAL' : undefined);
    const key = `${discordId}_${serverId}`;
    const user = mockState.users.get(key);
    user.coin_balance += amount;
    user.last_checkin_at = checkinTime;
    return { rows: [{ coin_balance: user.coin_balance }] };
  }

  // 6. UPDATE users (increment message count)
  if (normalizedSql.includes('UPDATE users SET message_count = message_count + 1')) {
    const discordId = params[0];
    const serverId = params[1] || (normalizedSql.includes("'GLOBAL'") ? 'GLOBAL' : undefined);
    const key = `${discordId}_${serverId}`;
    const user = mockState.users.get(key);
    user.message_count += 1;
    return { rows: [{ message_count: user.message_count, coin_balance: user.coin_balance }] };
  }

  // 6.5. UPDATE users (award milestone coins, net change in casino, etc.)
  if (normalizedSql.includes('UPDATE users SET coin_balance = coin_balance + $1 WHERE')) {
    const [amount, discordId, pServerId] = params;
    const serverId = pServerId || (normalizedSql.includes("'GLOBAL'") ? 'GLOBAL' : 'GLOBAL');
    const key = `${discordId}_${serverId}`;
    const user = mockState.users.get(key);
    user.coin_balance += amount;
    return { rows: [{ coin_balance: user.coin_balance }] };
  }

  // 6.6. UPDATE users (subtraction / shop purchases)
  if (normalizedSql.includes('UPDATE users SET coin_balance = coin_balance - $1')) {
    const [amount, discordId] = params;
    const key = `${discordId}_GLOBAL`;
    const user = mockState.users.get(key);
    if (user) {
      user.coin_balance = (BigInt(user.coin_balance) - BigInt(amount)).toString();
      user.coin_balance = parseInt(user.coin_balance, 10);
    }
    return { rows: [{ coin_balance: user ? user.coin_balance : 0 }] };
  }

  // 6.61. UPDATE user_stats
  if (normalizedSql.includes('UPDATE user_stats')) {
    return { rows: [] };
  }

  // 6.62. INSERT INTO active_boosts
  if (normalizedSql.includes('INSERT INTO active_boosts')) {
    return { rows: [] };
  }

  // 6.63. INSERT INTO user_inventory (e.g. shield purchase)
  if (normalizedSql.includes('INSERT INTO user_inventory') && normalizedSql.includes('ON CONFLICT')) {
    const discordId = params[0];
    const itemId = params[2];
    const qty = params[3];
    const key = `${discordId}_GLOBAL_${itemId}`;
    const item = mockState.user_inventory.get(key) || { discord_id: discordId, server_id: 'GLOBAL', item_id: itemId, quantity: 0 };
    item.quantity += qty;
    mockState.user_inventory.set(key, item);
    return { rows: [] };
  }

  // 6.7. UPDATE users (reset all balances to 0 during cycle reset)
  if (normalizedSql.includes('UPDATE users SET coin_balance = 0, last_checkin_at = NULL')) {
    mockState.users.forEach((user, key) => {
      if (key.endsWith('_GLOBAL')) {
        user.coin_balance = 0;
        user.last_checkin_at = null;
      }
    });
    return { rows: [] };
  }

  // 7. INSERT INTO transactions
  if (normalizedSql.includes('INSERT INTO transactions') && !normalizedSql.includes('SELECT')) {
    let userId, serverId, amount, source, createdAt;
    
    if (normalizedSql.includes("'GLOBAL'")) {
      userId = params[0];
      serverId = 'GLOBAL';
      amount = params[1];
      
      if (normalizedSql.includes('created_at')) {
        // params: [userId, amount, now]
        // source is hardcoded in SQL, e.g. 'message', 'checkin'
        source = normalizedSql.includes("'message'") ? 'message' :
                 normalizedSql.includes("'checkin'") ? 'checkin' :
                 normalizedSql.includes("'casino_win'") ? 'casino_win' :
                 normalizedSql.includes("'casino_loss'") ? 'casino_loss' :
                 normalizedSql.includes("'drop_catch'") ? 'drop_catch' : 'unknown';
        createdAt = params[2];
      } else {
        // params: [userId, amount, source]
        source = params[2];
        createdAt = new Date();
      }
    } else {
      userId = params[0];
      serverId = params[1];
      amount = params[2];
      source = params[3];
      if (normalizedSql.includes('created_at')) {
        createdAt = params[4];
      } else {
        createdAt = new Date();
      }
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
    const userId = params[0];
    const serverId = params[1] || (normalizedSql.includes("'GLOBAL'") ? 'GLOBAL' : undefined);
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
  if (normalizedSql.includes('ORDER BY g.coin_balance DESC') || normalizedSql.includes('ORDER BY coin_balance DESC LIMIT')) {
    const isJoin = normalizedSql.includes('JOIN');
    const serverId = isJoin ? params[0] : (normalizedSql.includes("'GLOBAL'") ? 'GLOBAL' : params[1]);
    const limit = isJoin ? params[1] : params[0];
    
    // In mock mode, if it is a JOIN, we select users active in serverId, but fetch their balance from 'GLOBAL'
    const rankings = Array.from(mockState.users.values())
      .filter(u => u.server_id === serverId)
      .map(u => {
        const globalUser = mockState.users.get(`${u.discord_id}_GLOBAL`);
        return {
          discord_id: u.discord_id,
          coin_balance: globalUser ? globalUser.coin_balance : 0
        };
      })
      .filter(u => u.coin_balance > 0)
      .sort((a, b) => b.coin_balance - a.coin_balance)
      .slice(0, limit);
    return { rows: rankings };
  }

  // 13. SELECT active cycle
  if (normalizedSql.includes('SELECT id FROM cycles') && normalizedSql.includes('is_active = TRUE')) {
    const serverId = normalizedSql.includes("'GLOBAL'") ? 'GLOBAL' : params[0];
    const activeCycle = mockState.cycles.find(c => c.server_id === serverId && c.is_active);
    return { rows: activeCycle ? [activeCycle] : [] };
  }

  // 14. INSERT active cycle
  if (normalizedSql.includes('INSERT INTO cycles') && (normalizedSql.includes('started_at') || normalizedSql.includes('is_active'))) {
    const serverId = normalizedSql.includes("'GLOBAL'") ? 'GLOBAL' : params[0];
    const startedAt = new Date();
    const isActive = true;
    const cycle = {
      id: nextCycleId++,
      server_id: serverId,
      started_at: startedAt,
      ended_at: null,
      is_active: isActive
    };
    mockState.cycles.push(cycle);
    return { rows: [cycle] };
  }

  // 15. SELECT rankings of users with balance > 0 (during reset)
  if (normalizedSql.includes('SELECT discord_id, coin_balance') && normalizedSql.includes('FROM users') && normalizedSql.includes('coin_balance > 0')) {
    const serverId = normalizedSql.includes("'GLOBAL'") ? 'GLOBAL' : params[0];
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
  const isProductionDb = process.env.DATABASE_URL && (
    process.env.DATABASE_URL.includes('.supabase.co') ||
    process.env.DATABASE_URL.includes('supabase.com') ||
    process.env.DATABASE_URL.includes('render.com')
  );

  if (isProductionDb) {
    console.log('⚠️  DATABASE_URL points to a cloud/production database.');
    console.log('🔒 Running destructive integration tests on production is blocked to prevent data loss.');
    useMock = true;
    setupMockDatabase();
  } else {
    try {
      const testClient = await pool.connect();
      testClient.release();
      await initDatabase();
      console.log('✔ Real database initialized.');
    } catch (err) {
      useMock = true;
      setupMockDatabase();
    }
  }

  const {
    getServerSettings,
    setGlobalSetting,
    checkInUser,
    recordMessageActivity,
    getUserBalance,
    getLeaderboard,
    resetCycle,
    recordCasinoGame,
    updateDropChannel,
    awardDropCoins,
    getTreasury,
    updateTreasuryRates,
    applyDailyTaxIfDue,
    sellCharacter,
    applyServerVaultTaxIfDue,
    updateServerVaultCustomTaxRate,
    triggerServerVaultTaxDeduction
} = require('./src/database/queries');

  try {
    // 2. Server Settings Test
    console.log('Testing Server Settings...');
    let settings = await getServerSettings(TEST_SERVER);
    console.log(`Default settings: Name="${settings.currency_name}", Icon="${settings.currency_icon_url}"`);

    // Save originals so we can restore after test
    const originalName = settings.currency_name;
    const originalIcon = settings.currency_icon_url;

    await setGlobalSetting('currency_name', 'TestCoin');
    await setGlobalSetting('currency_icon_url', '🧪');
    settings = await getServerSettings(TEST_SERVER);
    console.log(`Updated settings: Name="${settings.currency_name}", Icon="${settings.currency_icon_url}"`);
    if (settings.currency_name !== 'TestCoin' || settings.currency_icon_url !== '🧪') {
      throw new Error('Server settings update failed');
    }

    // Restore original values immediately after asserting
    await setGlobalSetting('currency_name', originalName);
    await setGlobalSetting('currency_icon_url', originalIcon);
    console.log(`✔ Server settings test passed. (Restored to: Name="${originalName}", Icon="${originalIcon}")`);

    // Cleanup any existing test data to ensure clean state
    if (!useMock) {
      await pool.query(
        "DELETE FROM users WHERE server_id = $1 OR (server_id = 'GLOBAL' AND (discord_id = $2 OR discord_id = $3))",
        [TEST_SERVER, TEST_USER_1, TEST_USER_2]
      );
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
    // Disable tax rates temporarily so original tests pass without tax
    await updateTreasuryRates(TEST_SERVER, 0.00, 0.00, 0.00);
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
    if (leaderboard.rankings.length < 2) {
      throw new Error(`Leaderboard should return at least 2 users, got ${leaderboard.rankings.length}`);
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

    // 5.7 Testing Server Treasury (Soul Well) and Contributions (Tributes)
    console.log('\nTesting Server Treasury / Soul Well settings & balance...');
    // Initial treasury check on TEST_SERVER_2 (TEST_SERVER was configured to 0% above)
    let treasury = await getTreasury(TEST_SERVER_2);
    console.log('Initial treasury on server 2:', treasury);
    if (parseInt(treasury.balance, 10) !== 100000 || treasury.dailyTaxRate !== 1.00 || treasury.winTaxRate !== 10.00) {
      throw new Error('Default treasury properties incorrect');
    }

    // Configure rates
    const updatedRates = await updateTreasuryRates(TEST_SERVER, 2.50, 15.00, 5.00);
    console.log('Updated rates:', updatedRates);
    treasury = await getTreasury(TEST_SERVER);
    if (treasury.dailyTaxRate !== 2.50 || treasury.winTaxRate !== 15.00 || treasury.sellTaxRate !== 5.00) {
      throw new Error('Failed to update treasury rates');
    }

    // Test Win Tax applied to casino wins
    if (!useMock) {
      await pool.query("UPDATE users SET coin_balance = 100 WHERE discord_id = $1 AND server_id = 'GLOBAL'", [TEST_USER_1]);
    } else {
      mockState.users.get(`${TEST_USER_1}_GLOBAL`).coin_balance = 100;
    }
    
    console.log('Testing Win Tax on Casino Game (15% win tax configured)...');
    const winResult = await recordCasinoGame(TEST_USER_1, TEST_SERVER, 100, true);
    console.log('Casino win result with 15% tax:', winResult);
    if (!winResult.success || winResult.taxAmount !== 15 || winResult.newBalance !== 185) {
      throw new Error('Win tax was not computed/applied correctly');
    }
    treasury = await getTreasury(TEST_SERVER);
    if (parseInt(treasury.balance, 10) !== 100015) {
      throw new Error(`Treasury balance incorrect. Expected 100015, got ${treasury.balance}`);
    }
    console.log('✔ Win tax casino test passed.');

    // Test Sell Tax on character sell
    if (!useMock) {
      await pool.query(`
        INSERT INTO user_inventory (discord_id, server_id, item_id, quantity)
        VALUES ($1, 'GLOBAL', 'dumbbell_soul', 2)
        ON CONFLICT (discord_id, server_id, item_id) DO UPDATE SET quantity = 2
      `, [TEST_USER_1]);
    } else {
      mockState.user_inventory.set(`${TEST_USER_1}_GLOBAL_dumbbell_soul`, {
        discord_id: TEST_USER_1,
        server_id: 'GLOBAL',
        item_id: 'dumbbell_soul',
        quantity: 2
      });
    }

    console.log('Testing Sell Tax on character sell (5% sell tax configured)...');
    const sellResult = await sellCharacter(TEST_USER_1, TEST_SERVER, 'dumbbell_soul', 200, 1);
    console.log('Sell character result with 5% tax:', sellResult);
    if (!sellResult.success || sellResult.taxAmount !== 10 || sellResult.netEarnings !== 190 || sellResult.newBalance !== 375) {
      throw new Error('Sell tax was not computed/applied correctly');
    }
    treasury = await getTreasury(TEST_SERVER);
    if (parseInt(treasury.balance, 10) !== 100025) {
      throw new Error(`Treasury balance incorrect after sell. Expected 100025, got ${treasury.balance}`);
    }
    console.log('✔ Sell tax test passed.');

    // Test Bulk Sell Characters (Multiple souls/quantities)
    console.log('Testing Bulk Sell Characters (Multiple items & quantities)...');
    const { bulkSellCharacters } = require('./src/database/queries');

    // Add another item to inventory for User 1
    if (!useMock) {
      await pool.query(`
        INSERT INTO user_inventory (discord_id, server_id, item_id, quantity)
        VALUES ($1, 'GLOBAL', 'common_soul', 5)
        ON CONFLICT (discord_id, server_id, item_id) DO UPDATE SET quantity = 5
      `, [TEST_USER_1]);
    } else {
      mockState.user_inventory.set(`${TEST_USER_1}_GLOBAL_common_soul`, {
        discord_id: TEST_USER_1,
        server_id: 'GLOBAL',
        item_id: 'common_soul',
        quantity: 5
      });
    }

    const bulkSales = [
      { characterId: 'dumbbell_soul', value: 200, qty: 1 }, // Gross: 200, Tax (5%): 10, Net: 190
      { characterId: 'common_soul', value: 100, qty: 3 }     // Gross: 300, Tax (5%): 15, Net: 285
    ]; // Total gross: 500, Total tax (5%): 25, Total net: 475
    // Balance before bulk sell: 375 (from sell character test). Expected after: 375 + 475 = 850

    const bulkSellRes = await bulkSellCharacters(TEST_USER_1, TEST_SERVER, bulkSales);
    console.log('Bulk sell result:', bulkSellRes);
    if (!bulkSellRes.success || bulkSellRes.totalTaxAmount !== 25 || bulkSellRes.totalNetEarnings !== 475 || bulkSellRes.newBalance !== 850) {
      throw new Error('Bulk sell was not executed correctly');
    }
    treasury = await getTreasury(TEST_SERVER);
    if (parseInt(treasury.balance, 10) !== 100050) {
      throw new Error(`Treasury balance incorrect after bulk sell. Expected 100050, got ${treasury.balance}`);
    }
    
    // Set User 1 balance back to 375 and restore treasury balance to 100025 so subsequent daily tax tests match expected math
    if (!useMock) {
      await pool.query("UPDATE users SET coin_balance = 375 WHERE discord_id = $1 AND server_id = 'GLOBAL'", [TEST_USER_1]);
      await pool.query("UPDATE server_treasury SET balance = 100025 WHERE server_id = $1", [TEST_SERVER]);
    } else {
      mockState.users.get(`${TEST_USER_1}_GLOBAL`).coin_balance = 375;
      mockState.server_treasury.get(TEST_SERVER).balance = "100025";
    }
    console.log('✔ Bulk sell test passed.');

    // Test Daily Tax / Tribute (2.5% daily tax configured)
    console.log('Testing Daily Tax / Tribute (2.5% daily tax)...');
    const dailyTax1 = await applyDailyTaxIfDue(TEST_USER_1, TEST_SERVER);
    console.log('Daily tax first run result:', dailyTax1);
    if (!dailyTax1.success || dailyTax1.taxAmount !== 9 || dailyTax1.newBalance !== 366) {
      throw new Error('Daily tax was not applied correctly');
    }
    treasury = await getTreasury(TEST_SERVER);
    if (parseInt(treasury.balance, 10) !== 100034) {
      throw new Error(`Treasury balance incorrect after daily tax. Expected 100034, got ${treasury.balance}`);
    }

    // Try applying daily tax again immediately (should be rate-limited/cooldown)
    const dailyTax2 = await applyDailyTaxIfDue(TEST_USER_1, TEST_SERVER);
    console.log('Daily tax second run (cooldown) result:', dailyTax2);
    if (dailyTax2.success) {
      throw new Error('Daily tax should have been rate-limited');
    }
    console.log('✔ Daily tax/tribute test passed.');

    // Test Server Vault Daily Tax (Fluctuating based on members or custom override)
    console.log('\nTesting Server Vault Daily Tax (Fluctuating/Custom)...');
    
    // TEST_SERVER has daily tax for users.
    // Initial treasury balance is 100034 (from casino, sell, user daily tax wins)
    // memberCount = 10 (fluctuating rate should be 1.00% daily)
    
    const vaultTaxRes1 = await applyServerVaultTaxIfDue(TEST_SERVER, 10);
    console.log('Server vault tax first run result (1.00% rate):', vaultTaxRes1);
    // 1.00% of 100034 = 1000 Souls
    if (!vaultTaxRes1.success || vaultTaxRes1.taxAmount !== 1000) {
      throw new Error(`Vault tax was not applied correctly. Expected 1000 tax, got ${vaultTaxRes1.taxAmount}`);
    }
    
    let currentTreasury = await getTreasury(TEST_SERVER);
    if (parseInt(currentTreasury.balance, 10) !== 99034) {
      throw new Error(`Vault balance incorrect. Expected 99034, got ${currentTreasury.balance}`);
    }
    if (parseInt(currentTreasury.totalTaxPaid, 10) !== 1000 || parseInt(currentTreasury.todayTaxPaid, 10) !== 1000) {
      throw new Error(`Vault tax statistics incorrect: total=${currentTreasury.totalTaxPaid}, today=${currentTreasury.todayTaxPaid}`);
    }

    // Try applying again immediately (should fail with cooldown)
    const vaultTaxRes2 = await applyServerVaultTaxIfDue(TEST_SERVER, 10);
    console.log('Server vault tax second run (cooldown) result:', vaultTaxRes2);
    if (vaultTaxRes2.success) {
      throw new Error('Server vault tax should have failed due to 24h cooldown');
    }

    // Update custom tax rate override to 5.00%
    console.log('Setting custom vault tax rate override to 5.00%...');
    await updateServerVaultCustomTaxRate(TEST_SERVER, 5.00);
    currentTreasury = await getTreasury(TEST_SERVER);
    if (currentTreasury.customTaxRate !== 5.00) {
      throw new Error(`Custom tax rate override not set. Expected 5.00, got ${currentTreasury.customTaxRate}`);
    }

    // Trigger manual tax deduction (ignores cooldown, should use custom 5% rate)
    console.log('Triggering manual tax deduction (5.00% override)...');
    const manualVaultTaxRes = await triggerServerVaultTaxDeduction(TEST_SERVER, 10);
    console.log('Manual tax deduction result:', manualVaultTaxRes);
    // 5.00% of 99034 = 4951 Souls
    if (!manualVaultTaxRes.success || manualVaultTaxRes.taxAmount !== 4951) {
      throw new Error(`Manual vault tax failed. Expected 4951 tax, got ${manualVaultTaxRes.taxAmount}`);
    }

    currentTreasury = await getTreasury(TEST_SERVER);
    if (parseInt(currentTreasury.balance, 10) !== 94083) {
      throw new Error(`Vault balance incorrect after manual tax. Expected 94083, got ${currentTreasury.balance}`);
    }
    if (parseInt(currentTreasury.totalTaxPaid, 10) !== 5951 || parseInt(currentTreasury.todayTaxPaid, 10) !== 4951) {
      throw new Error(`Vault tax stats incorrect: total=${currentTreasury.totalTaxPaid}, today=${currentTreasury.todayTaxPaid}`);
    }
    
    // Clear custom tax rate override (reset to NULL)
    console.log('Resetting custom vault tax rate override to NULL...');
    await updateServerVaultCustomTaxRate(TEST_SERVER, null);
    currentTreasury = await getTreasury(TEST_SERVER);
    if (currentTreasury.customTaxRate !== null) {
      throw new Error(`Custom tax rate not cleared.`);
    }

    console.log('✔ Server vault tax tests passed.');

    // 5.9 Testing Shop Cart Checkout (Multiple items & quantities)
    console.log('\nTesting Shop Cart Checkout (Multiple items & quantities)...');
    const { checkoutCart } = require('./src/database/queries');
    
    // Set User 1 balance to 1000 to afford the cart items
    if (!useMock) {
      await pool.query("UPDATE users SET coin_balance = 1000 WHERE discord_id = $1 AND server_id = 'GLOBAL'", [TEST_USER_1]);
    } else {
      mockState.users.get(`${TEST_USER_1}_GLOBAL`).coin_balance = 1000;
    }
    
    const cart = {
      dumbbell: 2, // 300 coins (150 each fallback)
      shield: 1    // 500 coins (500 each fallback)
    }; // Total cost: 800 coins

    const checkoutRes = await checkoutCart(TEST_USER_1, TEST_SERVER, cart);
    console.log('Checkout result:', checkoutRes);
    if (!checkoutRes.success || checkoutRes.totalCost !== 800 || checkoutRes.newBalance !== 200) {
      throw new Error('Failed to checkout cart with correct total cost and balance deduction');
    }
    if (checkoutRes.purchasedItems.length !== 2) {
      throw new Error('Purchased items list count incorrect');
    }
    console.log('✔ Shop cart checkout test passed.');

    // 6. Reset Cycle Test (Now succeeds under dashboard/owner controls)
    console.log('\nTesting Cycle Reset (should succeed and clear balances)...');
    const reset = await resetCycle(TEST_SERVER);
    console.log('Cycle reset result:', reset);
    if (!reset.success) {
      throw new Error('Cycle reset failed under the new dashboard-only implementation');
    }

    // Check balances are reset to 0 (User 1 should have 0 coins)
    const finalBalance1 = await getUserBalance(TEST_USER_1, TEST_SERVER);
    console.log('User 1 Balance after reset:', finalBalance1.balance);
    if (finalBalance1.balance !== 0) {
      throw new Error('User balance should be reset to 0 after a cycle reset');
    }
    console.log('✔ Cycle reset test passed.');

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
