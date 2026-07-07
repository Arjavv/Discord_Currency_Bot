const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { initDatabase, pool } = require('./database/db');
require('dotenv').config();

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

const app = express();
const port = process.env.PORT || 8000;
const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe';
const botStartedAt = Date.now();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'soul-currency-secret-key-123',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60 * 60 * 1000 } // 1 hour session
}));

// Serve static files from docs folder
app.use(express.static(path.join(__dirname, '..', 'docs')));

// Middleware to protect admin routes
function requireLogin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized. Please login.' });
}

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

// Bot status & economy overview (Protected)
app.get('/api/bot-status', requireLogin, async (req, res) => {
  try {
    const [economy, control, dbSize] = await Promise.all([
      getGlobalEconomyStats(),
      getBotControlState(),
      getDatabaseSize()
    ]);

    res.json({
      discordReady: client.isReady(),
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

// Admin panel frontend HTML route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'admin.html'));
});

app.listen(port, () => {
  console.log(`Express web server listening on port ${port}`);
});

// Main Boot Sequence
async function startBot() {
  try {
    // 1. Initialize and run database migrations
    await initDatabase();
    
    // 2. Log in to Discord
    console.log('Logging in to Discord...');
    await client.login(token);

    // 3. Start periodic cleanup of old transactions & message_activity (every 6 hours)
    const { cleanupOldRecords } = require('./database/queries');
    cleanupOldRecords(); // Run once on startup
    setInterval(cleanupOldRecords, 6 * 60 * 60 * 1000);
    console.log('Scheduled database cleanup every 6 hours.');
  } catch (error) {
    console.error('Failed to start the bot:', error);
    process.exit(1);
  }
}

startBot();

