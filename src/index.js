const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { initDatabase, pool } = require('./database/db');
require('dotenv').config();

// Force DNS resolution to prefer IPv4 ONLY for Discord domains
// Fixes known gateway connection hangs in cloud environments (like Render/AWS)
// Other domains like Supabase (which are IPv6-only) will resolve normally
const dns = require('dns');
const originalLookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  } else if (typeof options === 'number') {
    options = { family: options };
  } else if (!options) {
    options = {};
  }
  
  if (hostname && hostname.includes('discord')) {
    options.family = 4; // Force IPv4 for Discord
  }
  
  return originalLookup.call(this, hostname, options, callback);
};

console.log(`Node.js version running: ${process.version}`);

const consoleLogs = [];
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function captureLog(type, args) {
  const msg = `[${new Date().toISOString()}] [${type}] ${args.map(arg => {
    try {
      return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
    } catch (e) {
      return String(arg);
    }
  }).join(' ')}`;
  consoleLogs.push(msg);
  if (consoleLogs.length > 200) consoleLogs.shift();
}

console.log = (...args) => {
  captureLog('LOG', args);
  originalLog.apply(console, args);
};

console.error = (...args) => {
  captureLog('ERROR', args);
  originalError.apply(console, args);
};

console.warn = (...args) => {
  captureLog('WARN', args);
  originalWarn.apply(console, args);
};

const token = process.env.DISCORD_TOKEN;

if (!token || token === 'your_bot_token_here') {
  console.error('CRITICAL ERROR: DISCORD_TOKEN is not configured in the .env file.');
  process.exit(1);
}

// Create client instance with required Gateway Intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // Useful for message activity verification
  ],
  ws: {
    compress: false // Disable compression to avoid potential handshake hangs
  }
});

// Listen to REST rate limits to output them in debug logs
client.on('rateLimit', (rateLimitData) => {
  console.warn('[RATE LIMIT]', rateLimitData);
});

// Initialize collection to store commands
client.commands = new Collection();

// Load Commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
  }
}

// Load Event Handlers
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
  }
}

// Serve the docs/ website, admin dashboard, and endpoints
const express = require('express');
const session = require('express-session');
const { getGlobalSettings, setGlobalSetting, getGlobalEconomyStats, getServerSettings, toggleAutoDrops, updateDropChannel, getServerFeatureOverrides, setServerFeatureOverride, getServerDetail, getUserInspect, adminUpdateUser, getShopPrices, setShopPrice, resetCycle, getDatabaseSize, getTreasury, updateServerVaultCustomTaxRate, triggerServerVaultTaxDeduction, getFluctuatingTaxRate } = require('./database/queries');
const { getBotControlState } = require('./utils/botControl');
const { scheduleNextDrop, triggerDrop, nextDropTimers } = require('./utils/drops');

const crashLogPath = path.join(__dirname, '..', 'crash_logs.json');

function logCrash(err, type) {
  let logs = [];
  try {
    if (fs.existsSync(crashLogPath)) {
      logs = JSON.parse(fs.readFileSync(crashLogPath, 'utf8'));
    }
  } catch(e) {}
  logs.unshift({
    timestamp: new Date().toISOString(),
    type: type,
    message: err.message || String(err),
    stack: err.stack || ''
  });
  if (logs.length > 50) logs = logs.slice(0, 50);
  fs.writeFileSync(crashLogPath, JSON.stringify(logs, null, 2));
}

const app = express();
const port = process.env.PORT || 8000;
const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe';
const botStartedAt = Date.now();
let lastDiscordReadyAt = null;
let lastDiscordDisconnectAt = null;
let discordLoginError = null; // tracks Discord login failure reason


app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'soul-currency-secret-key-123',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 60 * 1000 } // 1 hour session
}));

// Serve static files from docs folder with caching disabled for HTML files
app.use(express.static(path.join(__dirname, '..', 'docs'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Serve spawn character images statically from assets folder
app.use('/assets/spawns', express.static(path.join(__dirname, 'assets')));

// Middleware to protect admin routes
function requireLogin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized. Please login.' });
}

// Public health check — no auth required (for Render uptime monitoring)
app.get('/health', async (req, res) => {
  const discordConnected = client.isReady() &&
    lastDiscordReadyAt !== null &&
    (lastDiscordDisconnectAt === null || lastDiscordReadyAt > lastDiscordDisconnectAt);
    
  let databaseStatus = 'unchecked';
  if (pool) {
    try {
      const dbPromise = pool.query('SELECT 1');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 3000));
      await Promise.race([dbPromise, timeoutPromise]);
      databaseStatus = 'connected';
    } catch (e) {
      databaseStatus = 'error: ' + e.message;
    }
  }

  let tokenStatus = 'unchecked';
  let tokenUser = null;
  if (client && client.user) {
    tokenStatus = 200;
    tokenUser = client.user.tag;
  } else if (process.env.DISCORD_TOKEN) {
    tokenStatus = 'configured_but_disconnected';
  }

  res.json({
    status: 'ok',
    discordReady: discordConnected,
    discordLoginError: discordLoginError,
    databaseStatus,
    tokenStatus,
    tokenUser,
    uptimeMs: Date.now() - botStartedAt,
    guildCount: client.guilds.cache.size,
    envVarsPresent: {
      DISCORD_TOKEN: !!process.env.DISCORD_TOKEN,
      CLIENT_ID: !!process.env.CLIENT_ID,
      DATABASE_URL: !!process.env.DATABASE_URL,
      ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD
    }
  });
});

app.get('/debug-logs', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(consoleLogs.join('\n'));
});

// Auth endpoints
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/check-auth', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.isAdmin) });
});

// Crash logs endpoint (Protected)
app.get('/api/crash-logs', requireLogin, (req, res) => {
  try {
    if (fs.existsSync(crashLogPath)) {
      const logs = JSON.parse(fs.readFileSync(crashLogPath, 'utf8'));
      res.json(logs);
    } else {
      res.json([]);
    }
  } catch(e) {
    res.status(500).json({ error: 'Failed to read crash logs' });
  }
});

// Request logs endpoint (Protected)
app.get('/api/request-logs', requireLogin, (req, res) => {
  try {
    const { getLogs } = require('./utils/requestLogger');
    res.json(getLogs());
  } catch (e) {
    res.status(500).json({ error: 'Failed to read request logs' });
  }
});

// Bot status & economy overview (Protected)
app.get('/api/bot-status', requireLogin, async (req, res) => {
  try {
    const [economy, control, dbSize] = await Promise.all([
      getGlobalEconomyStats(),
      getBotControlState(),
      getDatabaseSize()
    ]);

    // True only when the WS is ready AND hasn't disconnected since
    const discordConnected = client.isReady() &&
      lastDiscordReadyAt !== null &&
      (lastDiscordDisconnectAt === null || lastDiscordReadyAt > lastDiscordDisconnectAt);

    res.json({
      discordReady: discordConnected,
      discordLoginError: discordLoginError,
      uptimeMs: Date.now() - botStartedAt,
      guildCount: client.guilds.cache.size,
      totalMembers: client.guilds.cache.reduce((sum, g) => sum + (g.memberCount || 0), 0),
      economy,
      maintenanceMode: control.maintenanceMode,
      maintenanceMessage: control.maintenanceMessage,
      features: control.features,
      dropsPausedUntil: control.dropsPausedUntil,
      dbSizeUsedBytes: dbSize,
      dbSizeLimitBytes: 500 * 1024 * 1024 // Supabase free tier is 500 MB
    });
  } catch (err) {
    console.error('Error fetching bot status:', err);
    res.status(500).json({ error: 'Failed to fetch bot status' });
  }
});

// Settings endpoints (Protected)
app.get('/api/settings', requireLogin, async (req, res) => {
  try {
    const settings = await getGlobalSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// GET characters list (Protected)
app.get('/api/characters', requireLogin, (req, res) => {
  try {
    const { CHARACTER_SPAWNS, disabledIds } = require('./utils/characters');
    res.json(CHARACTER_SPAWNS.map(c => ({
      id: c.id,
      name: c.name,
      tier: c.tier,
      value: c.value,
      color: c.color,
      imagePath: c.imagePath,
      isCustom: c.isCustom || false,
      weight: c.weight || 0,
      isDisabled: disabledIds.includes(c.id)
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch characters' });
  }
});

app.post('/api/settings', requireLogin, async (req, res) => {
  const updates = req.body;
  try {
    const results = [];
    for (const [key, value] of Object.entries(updates)) {
      const result = await setGlobalSetting(key, value);
      results.push(result);
    }
    
    // Dynamically update the bot's Discord presence status if maintenance mode changed
    const { updateBotPresence } = require('./utils/botControl');
    await updateBotPresence(client);

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Giveaway sweepstakes endpoints (Protected)
app.get('/api/giveaway/status', requireLogin, async (req, res) => {
  const { serverId } = req.query;
  if (!serverId) {
    return res.status(400).json({ error: 'Missing serverId parameter.' });
  }

  try {
    const { getServerGiveawaySettings } = require('./database/queries');
    const settings = await getServerGiveawaySettings(serverId);
    const now = Date.now();
    const dailyCooldown = 24 * 60 * 60 * 1000;
    const weeklyCooldown = 7 * 24 * 60 * 60 * 1000;
    const monthlyCooldown = 30 * 24 * 60 * 60 * 1000;

    const lastDaily = parseInt(settings.last_giveaway_daily || '0', 10);
    const lastWeekly = parseInt(settings.last_giveaway_weekly || '0', 10);
    const lastMonthly = parseInt(settings.last_giveaway_monthly || '0', 10);

    const getRemainingSeconds = (lastTime, cooldown) => {
      const nextTime = lastTime + cooldown;
      if (now >= nextTime) return 0;
      return Math.max(0, Math.floor((nextTime - now) / 1000));
    };

    res.json({
      daily: {
        lastDraw: lastDaily,
        remainingSeconds: getRemainingSeconds(lastDaily, dailyCooldown),
        lastWinner: settings.last_winner_daily ? JSON.parse(settings.last_winner_daily) : null
      },
      weekly: {
        lastDraw: lastWeekly,
        remainingSeconds: getRemainingSeconds(lastWeekly, weeklyCooldown),
        lastWinner: settings.last_winner_weekly ? JSON.parse(settings.last_winner_weekly) : null
      },
      monthly: {
        lastDraw: lastMonthly,
        remainingSeconds: getRemainingSeconds(lastMonthly, monthlyCooldown),
        lastWinner: settings.last_winner_monthly ? JSON.parse(settings.last_winner_monthly) : null
      },
      templates: {
        ping: settings.giveaway_ping_template,
        description: settings.giveaway_desc_template
      }
    });
  } catch (err) {
    console.error('Error fetching giveaway status:', err);
    res.status(500).json({ error: 'Failed to fetch giveaway status' });
  }
});

app.post('/api/giveaway/settings', requireLogin, async (req, res) => {
  const { serverId, pingTemplate, descTemplate } = req.body;
  if (!serverId) {
    return res.status(400).json({ error: 'Missing serverId parameter.' });
  }

  try {
    const { setServerGiveawaySettings } = require('./database/queries');
    const result = await setServerGiveawaySettings(serverId, {
      giveaway_ping_template: pingTemplate,
      giveaway_desc_template: descTemplate
    });
    res.json({ success: true, result });
  } catch (err) {
    console.error('Error updating server giveaway settings:', err);
    res.status(500).json({ error: 'Failed to update server giveaway settings' });
  }
});

app.post('/api/giveaway/trigger', requireLogin, async (req, res) => {
  const { type, serverId } = req.body;
  if (!serverId) {
    return res.status(400).json({ error: 'Missing serverId parameter.' });
  }
  if (!['daily', 'weekly', 'monthly'].includes(type)) {
    return res.status(400).json({ error: 'Invalid giveaway type.' });
  }

  try {
    const guild = client.guilds.cache.get(serverId) || await client.guilds.fetch(serverId).catch(() => null);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found or inaccessible by the bot.' });
    }

    const val = type === 'daily' ? 1000 : (type === 'weekly' ? 5000 : 50000);
    const { runServerGiveaway } = require('./utils/giveaways');
    const result = await runServerGiveaway(guild, type, val);
    if (result) {
      res.json({ success: true, winner: result.winnerUser.tag });
    } else {
      res.status(500).json({ error: 'Draw failed. No candidates found in this server.' });
    }
  } catch (err) {
    console.error(`Error triggering manual giveaway for ${type} in server ${serverId}:`, err);
    res.status(500).json({ error: err.message || 'Failed to trigger giveaway draw.' });
  }
});

// Servers list & stats endpoint (Protected)
app.get('/api/servers-info', requireLogin, async (req, res) => {
  try {
    const dbRes = await pool.query(`
      SELECT 
        u.server_id,
        ss.drop_channel_id,
        ss.auto_drops_enabled,
        COUNT(DISTINCT u.discord_id) as registered_users,
        COUNT(DISTINCT CASE WHEN g.coin_balance > 0 THEN u.discord_id END) as active_users_with_currency,
        COALESCE(SUM(g.coin_balance), 0) as total_coins,
        COALESCE(st.balance, 100000) as treasury_balance,
        COALESCE(st.total_tax_paid, 0) as total_tax_paid,
        COALESCE(st.today_tax_paid, 0) as today_tax_paid,
        st.custom_tax_rate
      FROM users u
      JOIN users g ON g.discord_id = u.discord_id AND g.server_id = 'GLOBAL'
      LEFT JOIN server_settings ss ON ss.server_id = u.server_id
      LEFT JOIN server_treasury st ON st.server_id = u.server_id
      WHERE u.server_id != 'GLOBAL' AND u.server_id NOT LIKE '9999%'
      GROUP BY u.server_id, ss.drop_channel_id, ss.auto_drops_enabled, st.balance, st.total_tax_paid, st.today_tax_paid, st.custom_tax_rate
      ORDER BY total_coins DESC
    `);

    const servers = await Promise.all(dbRes.rows.map(async (row) => {
      const guild = client.guilds.cache.get(row.server_id);
      const settings = await getServerSettings(row.server_id);
      const dropChannel = row.drop_channel_id
        ? client.channels.cache.get(row.drop_channel_id)
        : null;

      const memberCount = guild ? guild.memberCount : 0;
      const fluctuatingRate = getFluctuatingTaxRate(memberCount);
      const customRate = row.custom_tax_rate !== null ? parseFloat(row.custom_tax_rate) : null;
      const effectiveRate = customRate !== null ? customRate : fluctuatingRate;

      return {
        id: row.server_id,
        name: guild ? guild.name : `Server ${row.server_id}`,
        icon: guild && guild.icon ? guild.iconURL({ size: 64 }) : null,
        membersCount: parseInt(row.active_users_with_currency, 10) || 0,
        discordMemberCount: memberCount,
        totalCoins: parseInt(row.total_coins, 10) || 0,
        dropChannelId: row.drop_channel_id,
        dropChannelName: dropChannel ? `#${dropChannel.name}` : null,
        autoDropsEnabled: row.auto_drops_enabled === true,
        nextDropTime: nextDropTimers.has(row.server_id) ? nextDropTimers.get(row.server_id).nextDropTime : null,
        currencyName: settings.currency_name,
        currencyIcon: settings.currency_icon_url,
        treasury: {
          balance: parseInt(row.treasury_balance, 10),
          totalTaxPaid: parseInt(row.total_tax_paid, 10),
          todayTaxPaid: parseInt(row.today_tax_paid, 10),
          customTaxRate: customRate,
          effectiveTaxRate: effectiveRate
        }
      };
    }));

    res.json(servers);
  } catch (err) {
    console.error('Error fetching servers info:', err);
    res.status(500).json({ error: 'Failed to fetch servers info' });
  }
});

// Cache variables for public top servers
let publicTopServersCache = null;
let publicTopServersLastUpdate = 0;
const PUBLIC_CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

// Public top-servers standings leaderboard (Unprotected, cached 1h)
app.get('/api/public/top-servers', async (req, res) => {
  const now = Date.now();
  if (publicTopServersCache && (now - publicTopServersLastUpdate < PUBLIC_CACHE_DURATION)) {
    return res.json(publicTopServersCache);
  }

  try {
    const dbRes = await pool.query(`
      SELECT 
        u.server_id,
        COALESCE(SUM(g.coin_balance), 0) as total_coins
      FROM users u
      JOIN users g ON g.discord_id = u.discord_id AND g.server_id = 'GLOBAL'
      WHERE u.server_id != 'GLOBAL' AND u.server_id NOT LIKE '9999%'
      GROUP BY u.server_id
      ORDER BY total_coins DESC
      LIMIT 10
    `);

    const servers = await Promise.all(dbRes.rows.map(async (row) => {
      const guild = client.guilds.cache.get(row.server_id);
      return {
        name: guild ? guild.name : `Server ${row.server_id}`,
        icon: guild && guild.icon ? guild.iconURL({ size: 64 }) : null,
        totalCoins: parseInt(row.total_coins, 10) || 0
      };
    }));

    publicTopServersCache = servers;
    publicTopServersLastUpdate = now;
    res.json(servers);
  } catch (err) {
    console.error('Error fetching public top servers standings:', err);
    if (publicTopServersCache) {
      return res.json(publicTopServersCache); // Serve stale cache if db error
    }
    res.status(500).json({ error: 'Failed to fetch standings' });
  }
});


// Per-server admin override from web panel (Protected)
app.patch('/api/server/:serverId', requireLogin, async (req, res) => {
  const { serverId } = req.params;
  const { auto_drops_enabled, drop_channel_id } = req.body;

  try {
    if (auto_drops_enabled !== undefined) {
      const isEnabling = auto_drops_enabled === true || auto_drops_enabled === 'true';
      await toggleAutoDrops(serverId, isEnabling);

      if (isEnabling) {
        if (!nextDropTimers.has(serverId)) {
          const settings = await getServerSettings(serverId);
          const guild = client.guilds.cache.get(serverId) || await client.guilds.fetch(serverId).catch(() => null);
          if (guild) {
            let dropChannel = null;
            if (settings.drop_channel_id) {
              dropChannel = guild.channels.cache.get(settings.drop_channel_id) || 
                            await guild.channels.fetch(settings.drop_channel_id).catch(() => null);
            } else {
              const currentChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
              dropChannel = currentChannels.find(
                c => c.name.toLowerCase() === 'general' && c.isTextBased()
              );
            }
            if (dropChannel) {
              await triggerDrop(client, serverId, dropChannel);
              scheduleNextDrop(client, serverId, dropChannel.id);
            }
          }
        }
      } else {
        if (nextDropTimers.has(serverId)) {
          clearTimeout(nextDropTimers.get(serverId));
          nextDropTimers.delete(serverId);
        }
      }
    }
    if (drop_channel_id !== undefined) {
      await updateDropChannel(serverId, drop_channel_id || null);
    }

    const settings = await getServerSettings(serverId);
    res.json({ success: true, settings });
  } catch (err) {
    console.error('Error updating server settings:', err);
    res.status(500).json({ error: 'Failed to update server settings' });
  }
});

// Per-server detailed stats (Protected)
app.get('/api/server/:serverId/detail', requireLogin, async (req, res) => {
  const { serverId } = req.params;
  try {
    const detail = await getServerDetail(serverId);
    const guild = client.guilds.cache.get(serverId);
    const settings = await getServerSettings(serverId);
    const treasury = await getTreasury(serverId);
    const memberCount = guild ? guild.memberCount : 0;
    
    const fluctuatingRate = getFluctuatingTaxRate(memberCount);
    treasury.effectiveTaxRate = treasury.customTaxRate !== null ? treasury.customTaxRate : fluctuatingRate;

    res.json({
      id: serverId,
      name: guild ? guild.name : `Server ${serverId}`,
      icon: guild && guild.icon ? guild.iconURL({ size: 128 }) : null,
      memberCount: memberCount,
      settings: {
        ...settings,
        nextDropTime: nextDropTimers.has(serverId) ? nextDropTimers.get(serverId).nextDropTime : null
      },
      treasury,
      ...detail
    });
  } catch (err) {
    console.error('Error fetching server detail:', err);
    res.status(500).json({ error: 'Failed to fetch server detail' });
  }
});

// Update custom vault tax rate override (Protected)
app.patch('/api/server/:serverId/vault-tax', requireLogin, async (req, res) => {
  const { serverId } = req.params;
  const { customTaxRate } = req.body;
  try {
    const treasury = await updateServerVaultCustomTaxRate(serverId, customTaxRate);
    res.json({ success: true, treasury });
  } catch (err) {
    console.error('Error updating server custom tax rate:', err);
    res.status(500).json({ error: 'Failed to update custom tax rate' });
  }
});

// Trigger immediate server vault tax deduction (Protected)
app.post('/api/server/:serverId/vault-tax/trigger', requireLogin, async (req, res) => {
  const { serverId } = req.params;
  try {
    const guild = client.guilds.cache.get(serverId) || await client.guilds.fetch(serverId).catch(() => null);
    const memberCount = guild ? guild.memberCount : 0;
    const result = await triggerServerVaultTaxDeduction(serverId, memberCount);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error triggering manual server vault tax deduction:', err);
    res.status(500).json({ error: 'Failed to trigger tax deduction: ' + err.message });
  }
});

// Force drop for a specific server (Protected)
app.post('/api/server/:serverId/force-drop', requireLogin, async (req, res) => {
  const { serverId } = req.params;
  try {
    const settings = await getServerSettings(serverId);
    const guild = client.guilds.cache.get(serverId) || await client.guilds.fetch(serverId).catch(() => null);
    if (!guild) {
      return res.status(404).json({ error: 'Server not found' });
    }

    let dropChannel = null;
    if (settings.drop_channel_id) {
      dropChannel = guild.channels.cache.get(settings.drop_channel_id) || 
                    await guild.channels.fetch(settings.drop_channel_id).catch(() => null);
    } else {
      const currentChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
      dropChannel = currentChannels.find(
        c => c.name.toLowerCase() === 'general' && c.isTextBased()
      );
    }

    if (!dropChannel) {
      return res.status(400).json({ error: 'Drop channel not configured and no general channel found.' });
    }

    const dropResult = await triggerDrop(client, serverId, dropChannel);
    if (dropResult) {
      res.json({ success: true, message: `Successfully triggered a drop in #${dropChannel.name}!` });
    } else {
      res.status(500).json({ error: 'Failed to trigger drop. Please check bot permissions.' });
    }
  } catch (err) {
    console.error('Error triggering forced drop from web panel:', err);
    res.status(500).json({ error: 'Failed to trigger forced drop: ' + err.message });
  }
});

// POST add funds to server vault (Protected - Admin panel)
app.post('/api/server/:serverId/vault/add-funds', requireLogin, async (req, res) => {
  const { serverId } = req.params;
  const { amount } = req.body;
  const fundAmount = parseInt(amount, 10);
  if (isNaN(fundAmount) || fundAmount <= 0) {
    return res.status(400).json({ error: 'Invalid amount. Must be a positive integer.' });
  }

  try {
    const { ensureTreasuryExists } = require('./database/queries');
    const client = await pool.connect();
    let newBalance = 0;
    try {
      await ensureTreasuryExists(client, serverId);
      const dbRes = await client.query(
        `UPDATE server_treasury SET balance = balance + $1 WHERE server_id = $2 RETURNING balance`,
        [fundAmount, serverId]
      );
      newBalance = parseInt(dbRes.rows[0].balance, 10);
    } finally {
      client.release();
    }
    res.json({ success: true, newBalance, message: `Successfully added ${fundAmount} Souls to the server vault.` });
  } catch (err) {
    console.error('Error adding funds to server vault:', err);
    res.status(500).json({ error: 'Failed to add funds: ' + err.message });
  }
});



// POST create custom auto drop (Protected)
app.post('/api/drops', requireLogin, async (req, res) => {
  const { name, tier, value, weight, color, claimDescription, image } = req.body;
  if (!name || !tier || !value || !weight) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const id = 'custom_' + Date.now();
    let imagePath = null;
    let attachmentName = null;

    if (image) {
      const matches = image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return res.status(400).json({ error: 'Invalid image format' });
      }
      const ext = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');
      
      const filename = `${id}.${ext}`;
      const assetsDir = path.join(__dirname, 'assets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }
      const fullPath = path.join(assetsDir, filename);
      fs.writeFileSync(fullPath, buffer);
      
      imagePath = `./src/assets/${filename}`;
      attachmentName = filename;
    }

    const newChar = {
      id,
      name,
      tier,
      value: parseInt(value, 10),
      weight: parseInt(weight, 10),
      imagePath,
      attachmentName,
      color: color || '#ffffff',
      embedTitle: `✦ A ${tier} SOUL HAS DESCENDED ✦`,
      embedDescription: `${name} has appeared! Tier: ${tier}\n\nA rare presence has entered this realm...\n\nType soul to claim her!`,
      claimTitle: `${tier} SOUL CLAIMED!`,
      claimDescription: claimDescription || `{userMention} captured ${name}! 💚\n\n✦ The ${tier.toLowerCase()} soul has chosen its master.`,
      isCustom: true
    };

    const customPath = path.join(__dirname, 'utils', 'custom_characters.json');
    let customChars = [];
    if (fs.existsSync(customPath)) {
      try {
        customChars = JSON.parse(fs.readFileSync(customPath, 'utf8'));
      } catch (e) {
        customChars = [];
      }
    }
    customChars.push(newChar);
    fs.writeFileSync(customPath, JSON.stringify(customChars, null, 2));

    const { reloadCustomCharacters } = require('./utils/characters');
    reloadCustomCharacters();

    res.json({ success: true, character: newChar });
  } catch (err) {
    console.error('Error creating custom drop:', err);
    res.status(500).json({ error: 'Failed to create custom drop' });
  }
});

// DELETE custom auto drop (Protected)
app.delete('/api/drops/:id', requireLogin, async (req, res) => {
  const { id } = req.params;
  try {
    const customPath = path.join(__dirname, 'utils', 'custom_characters.json');
    let customChars = [];
    if (fs.existsSync(customPath)) {
      try {
        customChars = JSON.parse(fs.readFileSync(customPath, 'utf8'));
      } catch (e) {
        customChars = [];
      }
    }

    const charToDelete = customChars.find(c => c.id === id);
    if (!charToDelete) {
      return res.status(404).json({ error: 'Custom drop not found' });
    }

    if (charToDelete.attachmentName) {
      const fullPath = path.join(__dirname, 'assets', charToDelete.attachmentName);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    customChars = customChars.filter(c => c.id !== id);
    fs.writeFileSync(customPath, JSON.stringify(customChars, null, 2));

    const { reloadCustomCharacters } = require('./utils/characters');
    reloadCustomCharacters();

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting custom drop:', err);
    res.status(500).json({ error: 'Failed to delete custom drop' });
  }
});

// POST update custom/default auto drop weight (Protected)
app.post('/api/drops/:id/weight', requireLogin, async (req, res) => {
  const { id } = req.params;
  const { weight } = req.body;
  if (weight === undefined || isNaN(parseInt(weight, 10)) || parseInt(weight, 10) < 0) {
    return res.status(400).json({ error: 'Invalid weight value' });
  }

  try {
    const customWeightsPath = path.join(__dirname, 'utils', 'custom_weights.json');
    let weights = {};
    if (fs.existsSync(customWeightsPath)) {
      try {
        weights = JSON.parse(fs.readFileSync(customWeightsPath, 'utf8'));
      } catch (e) {
        weights = {};
      }
    }

    weights[id] = parseInt(weight, 10);
    fs.writeFileSync(customWeightsPath, JSON.stringify(weights, null, 2));

    const { reloadCustomWeights, reloadCustomCharacters } = require('./utils/characters');
    reloadCustomWeights();
    reloadCustomCharacters();

    res.json({ success: true, weight: weights[id] });
  } catch (err) {
    console.error('Error updating drop weight:', err);
    res.status(500).json({ error: 'Failed to update drop weight' });
  }
});

// POST toggle custom/default auto drop disabled status (Protected)
app.post('/api/drops/:id/toggle', requireLogin, async (req, res) => {
  const { id } = req.params;
  const { isDisabled } = req.body;
  try {
    const disabledPath = path.join(__dirname, 'utils', 'disabled_drops.json');
    let disabledIdsList = [];
    if (fs.existsSync(disabledPath)) {
      try {
        disabledIdsList = JSON.parse(fs.readFileSync(disabledPath, 'utf8'));
      } catch (e) {
        disabledIdsList = [];
      }
    }
    
    if (isDisabled) {
      if (!disabledIdsList.includes(id)) {
        disabledIdsList.push(id);
      }
    } else {
      disabledIdsList = disabledIdsList.filter(dId => dId !== id);
    }
    
    fs.writeFileSync(disabledPath, JSON.stringify(disabledIdsList, null, 2));
    
    const { reloadDisabledDrops } = require('./utils/characters');
    reloadDisabledDrops();
    
    res.json({ success: true, isDisabled });
  } catch (err) {
    console.error('Error toggling drop status:', err);
    res.status(500).json({ error: 'Failed to toggle drop status' });
  }
});

// Per-server feature overrides GET (Protected)
app.get('/api/server/:serverId/feature-overrides', requireLogin, async (req, res) => {
  const { serverId } = req.params;
  try {
    const overrides = await getServerFeatureOverrides(serverId);
    res.json(overrides);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feature overrides' });
  }
});

// Per-server feature overrides PATCH (Protected)
app.patch('/api/server/:serverId/feature-overrides', requireLogin, async (req, res) => {
  const { serverId } = req.params;
  const overrides = req.body; // { checkin: true, casino: false, ... }
  try {
    for (const [feature, enabled] of Object.entries(overrides)) {
      await setServerFeatureOverride(serverId, feature, enabled === true || enabled === 'true');
    }
    const updated = await getServerFeatureOverrides(serverId);
    res.json({ success: true, overrides: updated });
  } catch (err) {
    console.error('Error updating feature overrides:', err);
    res.status(500).json({ error: 'Failed to update feature overrides' });
  }
});

// Per-server shop prices PATCH (Protected)
app.patch('/api/server/:serverId/shop-prices', requireLogin, async (req, res) => {
  const { serverId } = req.params;
  const prices = req.body; // { dumbbell: 150, vest: 150, ... }
  try {
    for (const [itemId, price] of Object.entries(prices)) {
      if (price !== null && price !== undefined && price !== '') {
        await setShopPrice(serverId, itemId, parseInt(price, 10));
      }
    }
    const updated = await getShopPrices(serverId);
    res.json({ success: true, shopPrices: updated });
  } catch (err) {
    console.error('Error updating shop prices:', err);
    res.status(500).json({ error: 'Failed to update shop prices' });
  }
});

// Global Cycle Reset (Protected - Bot Owner Dashboard ONLY)
app.post('/api/admin/reset-cycle', requireLogin, async (req, res) => {
  try {
    const result = await resetCycle('GLOBAL');
    if (!result.success) {
      if (result.reason === 'global_economy') {
        return res.status(400).json({ error: 'Reset Cycle is not available in Global Economy mode.' });
      }
      return res.status(500).json({ error: 'An error occurred resetting the cycle.' });
    }
    res.json({
      success: true,
      archivedCount: result.archivedCount,
      oldCycleId: result.oldCycleId,
      message: `Cycle reset complete. ${result.archivedCount} rankings archived under Cycle #${result.oldCycleId}.`
    });
  } catch (err) {
    console.error('Error in admin reset-cycle:', err);
    res.status(500).json({ error: 'Failed to reset cycle: ' + err.message });
  }
});

// User inspector endpoint (Protected)
app.get('/api/user/:discordId', requireLogin, async (req, res) => {
  const { discordId } = req.params;
  try {
    const user = await getUserInspect(discordId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Try to get Discord username from cache
    let discordTag = null;
    try {
      const member = await client.users.fetch(discordId).catch(() => null);
      if (member) discordTag = member.tag || member.username;
    } catch (_) {}

    // If the profile doesn't exist and they are not a valid Discord user, 404
    if (user.isNew && !discordTag) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ ...user, discordTag });
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Update user details (Protected)
app.post('/api/user/:discordId/update', requireLogin, async (req, res) => {
  const { discordId } = req.params;
  const updates = req.body;
  try {
    const result = await adminUpdateUser(discordId, updates);
    res.json(result);
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Failed to update user: ' + err.message });
  }
});

// Shop frontend HTML route
app.get('/shop', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'shop.html'));
});

// Admin panel frontend HTML route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'admin.html'));
});

// Public marketplace route
app.get('/shop', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'shop.html'));
});

const server = app.listen(port, () => {
  console.log(`Express web server listening on port ${port}`);

  // Self-ping keep-alive for Render free tier — prevents the 15-minute sleep
  // that kills the Discord WebSocket connection
  const renderHostname = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (renderHostname) {
    const selfPingUrl = `https://${renderHostname}/health`;
    console.log(`Render detected. Starting self-ping keep-alive: ${selfPingUrl}`);
    const http = require('http');
    const https = require('https');
    setInterval(() => {
      try {
        https.get(selfPingUrl, (res) => {
          res.resume(); // consume response to free memory
        }).on('error', () => {});
      } catch (e) {}
    }, 10 * 60 * 1000); // Ping every 10 minutes
  }
});

// Global Error Handlers for Crash Logging
process.on('uncaughtException', (err) => {
  // Suppress PM2 EPIPE errors — these are caused by PM2's IPC pipe breaking
  // and cascade into a crash loop if not caught. They are not our fault.
  if (err && (err.code === 'EPIPE' || (err.message && err.message.includes('EPIPE')))) {
    // Silently ignore — PM2 IPC pipe is broken, nothing we can do
    return;
  }
  console.error('Uncaught Exception:', err);
  logCrash(err, 'UncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  // Suppress PM2 EPIPE rejections as well
  if (reason && (reason.code === 'EPIPE' || (reason.message && reason.message.includes('EPIPE')))) {
    return;
  }
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  logCrash(reason instanceof Error ? reason : new Error(String(reason)), 'UnhandledRejection');
});

client.on('error', (err) => {
  console.error('Discord Client Error:', err);
  logCrash(err, 'ClientError');
});

// Track real WebSocket connectivity for accurate admin panel status
// ready = initial login, shardReady = after reconnect
client.on('ready', () => {
  lastDiscordReadyAt = Date.now();
  console.log('Discord WebSocket: connected.');
});

client.on('shardReady', (shardId) => {
  lastDiscordReadyAt = Date.now();
  console.log(`Discord WebSocket: shard ${shardId} ready.`);
});

client.on('shardDisconnect', (event, shardId) => {
  lastDiscordDisconnectAt = Date.now();
  console.warn(`Discord WebSocket: shard ${shardId} disconnected (code ${event.code}).`);

  // Auto-reconnect if Discord doesn't reconnect on its own within 30 seconds
  setTimeout(() => {
    if (!client.isReady() || (lastDiscordDisconnectAt && (!lastDiscordReadyAt || lastDiscordDisconnectAt > lastDiscordReadyAt))) {
      console.log('Discord did not auto-reconnect. Attempting manual re-login...');
      client.login(token).catch(err => {
        console.error('Manual re-login failed:', err.message);
        discordLoginError = err.message;
      });
    }
  }, 30000);
});

client.on('shardReconnecting', (shardId) => {
  console.log(`Discord WebSocket: shard ${shardId} reconnecting...`);
});

client.on('shardError', (err, shardId) => {
  console.error(`Discord WebSocket: shard ${shardId} error:`, err.message);
  logCrash(err, 'ShardError');
});

// Debug: log Discord.js internal gateway events to find connection hangs
client.on('debug', (info) => {
  if (!info.includes('Heartbeat') && !info.includes('latency')) {
    console.log('[DEBUG]', info);
  }
});

client.on('warn', (info) => {
  console.warn('[WARN]', info);
});

// Periodic Discord heartbeat check — catches silent WebSocket deaths
// (e.g., after EPIPE crash loops leave the process alive but Discord dead)
setInterval(() => {
  if (process.env.RUN_DISCORD_CLIENT === 'false') return;

  const isConnected = client.isReady() &&
    lastDiscordReadyAt !== null &&
    (lastDiscordDisconnectAt === null || lastDiscordReadyAt > lastDiscordDisconnectAt);

  if (!isConnected && !discordLoginError) {
    console.warn('Heartbeat: Discord connection appears dead. Attempting re-login...');
    client.login(token).catch(err => {
      discordLoginError = err.message;
      console.error('Heartbeat re-login failed:', err.message);
    });
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Main Boot Sequence
async function startBot() {
  try {
    // 1. Initialize and run database migrations
    await initDatabase();
  } catch (error) {
    // DB failure is fatal - nothing will work without the database
    console.error('FATAL: Database init failed:', error);
    logCrash(error, 'FatalDatabaseInit');
    process.exit(1);
  }

  // 2. Log in to Discord (non-fatal - Express/admin panel stays alive even if Discord fails)
  try {
    const runDiscord = process.env.RUN_DISCORD_CLIENT !== 'false';
    if (!runDiscord) {
      console.log('Discord client connection is disabled locally (RUN_DISCORD_CLIENT=false).');
      return;
    }
    console.log('Logging in to Discord...');
    
    // Asynchronous diagnostic check for Discord REST API accessibility
    const https = require('https');
    try {
      https.get({
        hostname: 'discord.com',
        path: '/api/v10/gateway/bot',
        headers: { Authorization: `Bot ${token}` }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          console.log(`[DIAGNOSTIC] Discord API Status: ${res.statusCode}. Body: ${body}`);
        });
      }).on('error', (err) => {
        console.error(`[DIAGNOSTIC] Discord API Connection Error: ${err.message}`);
      });
    } catch (e) {
      console.error(`[DIAGNOSTIC] Failed to request Discord API: ${e.message}`);
    }

    const loginPromise = client.login(token);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Discord login timed out after 30 seconds — gateway may be unreachable or blocked')), 30000);
    });
    await Promise.race([loginPromise, timeoutPromise]);
    discordLoginError = null; // clear any previous error

    // 3. Start periodic cleanup of old transactions & message_activity (every 6 hours)
    const { cleanupOldRecords } = require('./database/queries');
    cleanupOldRecords(); // Run once on startup
    setInterval(cleanupOldRecords, 6 * 60 * 60 * 1000);
    console.log('Scheduled database cleanup every 6 hours.');
  } catch (error) {
    // Log the Discord login error but keep Express running so admin panel stays up
    discordLoginError = error.message;
    console.error('ERROR: Discord login failed — admin panel is still accessible:', error.message);
    logCrash(error, 'DiscordLoginFailed');
    // Retry Discord login every 30 seconds
    const retryLogin = () => {
      console.log('Retrying Discord login...');
      client.login(token)
        .then(() => {
          discordLoginError = null;
          console.log('Discord login retry succeeded!');
          const { cleanupOldRecords } = require('./database/queries');
          cleanupOldRecords();
          setInterval(cleanupOldRecords, 6 * 60 * 60 * 1000);
        })
        .catch(err => {
          discordLoginError = err.message;
          console.error('Discord retry failed:', err.message);
          logCrash(err, 'DiscordLoginRetryFailed');
          setTimeout(retryLogin, 30000); // keep retrying
        });
    };
    setTimeout(retryLogin, 30000);
  }
}

// Graceful shutdown — properly disconnect Discord and close DB pool
// when Render sends SIGTERM during redeploys/restarts
function gracefulShutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  try {
    if (client && client.isReady()) {
      client.destroy();
      console.log('Discord client disconnected.');
    }
  } catch (e) {}
  try {
    pool.end();
    console.log('Database pool closed.');
  } catch (e) {}
  server.close(() => {
    console.log('Express server closed.');
    process.exit(0);
  });
  // Force exit after 5 seconds if server.close hangs
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startBot();
