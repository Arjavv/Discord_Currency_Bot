const { REST, Routes, EmbedBuilder } = require('discord.js');
const { pool } = require('../database/db');
const { scheduleNextDrop } = require('../utils/drops');
const { updateBotPresence } = require('../utils/botControl');
require('dotenv').config();

module.exports = {
  name: 'ready',
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

      // Register commands to all guilds dynamically (instant update for all guilds the bot is in)
      client.guilds.cache.forEach(async (guild) => {
        console.log(`Registering guild-specific commands for: ${guild.name} (${guild.id})`);
        await rest.put(
          Routes.applicationGuildCommands(clientId, guild.id),
          { body: commands }
        ).catch(err => {
          console.error(`Failed to register commands for guild ${guild.name}:`, err.message);
        });
      });

      // Register globally as well to cover any future guilds (takes up to 1 hour to sync)
      console.log('Registering commands globally (sync background)...');
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      ).catch(err => {
        console.error('Failed to register global commands:', err.message);
      });

      console.log('Successfully reloaded application (/) commands.');

      // Set bot presence based on current maintenance mode state
      await updateBotPresence(client);

      // Send startup notifications to all servers inside #soul-logs channel
      client.guilds.cache.forEach(async (guild) => {
        try {
          const { getServerSettings } = require('../database/queries');
          const settings = await getServerSettings(guild.id);
          let adminLogsChannel = null;

          if (settings.log_channel_id) {
            adminLogsChannel = guild.channels.cache.get(settings.log_channel_id) ||
                               await guild.channels.fetch(settings.log_channel_id).catch(() => null);
          }

          if (!adminLogsChannel) {
            adminLogsChannel = guild.channels.cache.find(
              c => c.name.toLowerCase().includes('soul-logs') && c.isTextBased()
            );
          }

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
