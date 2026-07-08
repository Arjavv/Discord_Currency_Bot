const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { initDatabase, pool } = require('./database/db');
require('dotenv').config();

// Force DNS resolution to prefer IPv4 over IPv6
// Fixes known gateway connection hangs in cloud environments (like Render/AWS)
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

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
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // Useful for message activity verification
  ]
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
const { getGlobalSettings, setGlobalSetting, getGlobalEconomyStats, getServerSettings, toggleAutoDrops, updateDropChannel, getServerFeatureOverrides, setServerFeatureOverride, getServerDetail, getUserInspect, getShopPrices, setShopPrice, resetCycle, getDatabaseSize } = require('./database/queries');
const { getBotControlState } = require('./utils/botControl');

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


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    const { CHARACTER_SPAWNS } = require('./utils/characters');
    res.json(CHARACTER_SPAWNS.map(c => ({
      id: c.id,
      name: c.name,
      tier: c.tier,
      value: c.value,
      color: c.color,
      imagePath: c.imagePath
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
        COALESCE(SUM(g.coin_balance), 0) as total_coins
      FROM users u
      JOIN users g ON g.discord_id = u.discord_id AND g.server_id = 'GLOBAL'
      LEFT JOIN server_settings ss ON ss.server_id = u.server_id
      WHERE u.server_id != 'GLOBAL' AND u.server_id NOT LIKE '9999%'
      GROUP BY u.server_id, ss.drop_channel_id, ss.auto_drops_enabled
      ORDER BY total_coins DESC
    `);

    const servers = await Promise.all(dbRes.rows.map(async (row) => {
      const guild = client.guilds.cache.get(row.server_id);
      const settings = await getServerSettings(row.server_id);
      const dropChannel = row.drop_channel_id
        ? client.channels.cache.get(row.drop_channel_id)
        : null;

      return {
        id: row.server_id,
        name: guild ? guild.name : `Server ${row.server_id}`,
        icon: guild && guild.icon ? guild.iconURL({ size: 64 }) : null,
        membersCount: parseInt(row.active_users_with_currency, 10) || 0,
        totalCoins: parseInt(row.total_coins, 10) || 0,
        dropChannelId: row.drop_channel_id,
        dropChannelName: dropChannel ? `#${dropChannel.name}` : null,
        autoDropsEnabled: row.auto_drops_enabled === true,
        currencyName: settings.currency_name,
        currencyIcon: settings.currency_icon_url
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
      await toggleAutoDrops(serverId, auto_drops_enabled === true || auto_drops_enabled === 'true');
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
    res.json({
      id: serverId,
      name: guild ? guild.name : `Server ${serverId}`,
      icon: guild && guild.icon ? guild.iconURL({ size: 128 }) : null,
      memberCount: guild ? guild.memberCount : 0,
      settings,
      ...detail
    });
  } catch (err) {
    console.error('Error fetching server detail:', err);
    res.status(500).json({ error: 'Failed to fetch server detail' });
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
    res.json({ ...user, discordTag });
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
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
