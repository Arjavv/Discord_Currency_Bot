const { REST, Routes, EmbedBuilder } = require('discord.js');
const { pool } = require('../database/db');
const { scheduleNextDrop } = require('../utils/drops');
const { updateBotPresence } = require('../utils/botControl');
require('dotenv').config();

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    console.log(`Ready! Logged in as ${client.user.tag}`);

    const clientId = process.env.CLIENT_ID;
    const guildId = process.env.GUILD_ID;
    const token = process.env.DISCORD_TOKEN;

    if (!clientId || clientId === 'your_client_id_here') {
      console.warn('[WARNING] CLIENT_ID is not configured in .env. Command registration skipped.');
      return;
    }

    const rest = new REST({ version: '10' }).setToken(token);

    try {
      const commands = [];
      client.commands.forEach(command => {
        commands.push(command.data.toJSON());
      });

      console.log(`Started refreshing ${commands.length} application (/) commands.`);

      if (guildId && guildId !== 'your_testing_guild_id_here' && guildId.trim() !== '') {
        // Register commands to a specific guild (instant update)
        console.log(`Registering guild-specific commands for guild: ${guildId}`);
        await rest.put(
          Routes.applicationGuildCommands(clientId, guildId),
          { body: commands }
        );
      } else {
        // Register commands globally (takes up to 1 hour, but works everywhere)
        console.log('Registering commands globally (no GUILD_ID provided)...');
        await rest.put(
          Routes.applicationCommands(clientId),
          { body: commands }
        );
      }

      console.log('Successfully reloaded application (/) commands.');

      // Set bot presence based on current maintenance mode state
      await updateBotPresence(client);

      // Send startup notifications to all servers inside #soul-logs channel
      client.guilds.cache.forEach(async (guild) => {
        try {
          const adminLogsChannel = guild.channels.cache.find(
            c => c.name.toLowerCase() .includes('soul-logs') && c.isTextBased()
          );
          if (adminLogsChannel) {
            const startupEmbed = new EmbedBuilder()
              .setColor('#00ffaa')
              .setTitle('🟢 Bot Online')
              .setDescription('Soul Currency system has successfully booted up and connected to the database.')
              .setTimestamp();
            await adminLogsChannel.send({ embeds: [startupEmbed] }).catch(() => {});
          }
        } catch (e) {
          console.error(`Failed to send startup alert to guild ${guild.name}:`, e);
        }
      });

      // Resume auto drops for enabled servers
      try {
        const res = await pool.query(`SELECT server_id, drop_channel_id FROM server_settings WHERE auto_drops_enabled = TRUE`);
        for (const row of res.rows) {
          if (row.drop_channel_id) {
            console.log(`Resuming auto-drops loop for server ${row.server_id}`);
            scheduleNextDrop(client, row.server_id, row.drop_channel_id);
          }
        }
      } catch (dbErr) {
        console.error('Failed to load auto-drops state from DB:', dbErr);
      }

    } catch (error) {
      console.error('Error while registering application commands:', error);
    }
  }
};
