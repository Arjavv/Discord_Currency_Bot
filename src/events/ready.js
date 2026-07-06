const { REST, Routes } = require('discord.js');
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
    } catch (error) {
      console.error('Error while registering application commands:', error);
    }
  }
};
