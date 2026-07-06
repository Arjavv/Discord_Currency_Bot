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

    const {
      getBotControlState,
      isReadonlySlashCommand,
      getFeatureForSlashCommand
    } = require('../utils/botControl');

    const control = await getBotControlState();
    const isAdminCommand = interaction.commandName === 'admin';

    if (control.maintenanceMode && !isAdminCommand) {
      return interaction.reply({
        content: control.maintenanceMessage,
        ephemeral: true
      });
    }

    if (!isAdminCommand) {
      const feature = getFeatureForSlashCommand(interaction.commandName);
      if (feature && !control.features[feature]) {
        return interaction.reply({
          content: `❌ **${interaction.commandName}** is temporarily disabled globally by the bot owner.`,
          ephemeral: true
        });
      }
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);

      const errorMessage = {
        content: 'There was an error while executing this command! Please try again later.',
        ephemeral: true
      };

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch (err) {
        console.error('Failed to send error fallback response:', err);
      }
    }
  }
};
