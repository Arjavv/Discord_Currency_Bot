// Prefer IPv4 over IPv6 for outbound network connections (prevents Supabase connect ENETUNREACH in IPv4-only environments)
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { initDatabase } = require('./database/db');
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

// Start HTTP health check server instantly on boot for hosting platforms (Hugging Face/Koyeb)
const http = require('http');
const port = process.env.PORT || 8000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Soul Currency Bot is online!\n');
}).listen(port, () => {
  console.log(`Health check server listening on port ${port}`);
});

// Main Boot Sequence
async function startBot() {
  try {
    // 1. Initialize and run database migrations
    await initDatabase();
    
    // 2. Log in to Discord
    console.log('Logging in to Discord...');
    await client.login(token);
  } catch (error) {
    console.error('Failed to start the bot:', error);
    process.exit(1);
  }
}

startBot();
