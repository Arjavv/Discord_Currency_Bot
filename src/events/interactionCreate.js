module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);

      const errorMessage = {
        content: 'There was an error while executing this command! Please try again later.',
        ephemeral: true
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage).catch(err => console.error('Failed to send error followUp:', err));
      } else {
        await interaction.reply(errorMessage).catch(err => console.error('Failed to send error reply:', err));
      }
    }
  }
};
