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
const { getGlobalSettings, setGlobalSetting } = require('./database/queries');

const app = express();
const port = process.env.PORT || 8000;
const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe';

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
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Servers list & stats endpoint (Protected)
app.get('/api/servers-info', requireLogin, async (req, res) => {
  try {
    // Sum balances directly from server-specific rows (not via GLOBAL join)
    const dbRes = await pool.query(`
      SELECT server_id,
             COUNT(DISTINCT discord_id) AS member_count,
             COALESCE(SUM(coin_balance), 0) AS total_coins
      FROM users
      WHERE server_id != 'GLOBAL'
        AND server_id NOT LIKE '9999%'
      GROUP BY server_id
      ORDER BY total_coins DESC
    `);

    const servers = dbRes.rows.map(row => {
      const guild = client.guilds.cache.get(row.server_id);
      return {
        id: row.server_id,
        name: guild ? guild.name : `Server ${row.server_id}`,
        icon: guild && guild.icon ? guild.iconURL({ size: 64 }) : null,
        membersCount: parseInt(row.member_count, 10),
        totalCoins: parseInt(row.total_coins, 10)
      };
    });

    res.json(servers);
  } catch (err) {
    console.error('Error fetching servers info:', err);
    res.status(500).json({ error: 'Failed to fetch servers info' });
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

