module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

    // Handle Button Interactions
    if (interaction.isButton()) {
      if (interaction.customId === 'refuel_vault_btn') {
        if (interaction.user.id !== interaction.guild.ownerId) {
          return await interaction.reply({
            content: '❌ Only the Server Owner can refuel the Soul Vault.',
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId('refuel_vault_modal')
          .setTitle('Refuel Server Vault');

        const amountInput = new TextInputBuilder()
          .setCustomId('refuel_amount')
          .setLabel('Amount of Souls to Deposit')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter amount (minimum 20,000)')
          .setRequired(true);

        const row = new ActionRowBuilder().addComponents(amountInput);
        modal.addComponents(row);

        return await interaction.showModal(modal);
      }
    }

    // Handle Modal Submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'refuel_vault_modal') {
        const amountStr = interaction.fields.getTextInputValue('refuel_amount');
        const amount = parseInt(amountStr.replace(/,/g, ''), 10);
        if (isNaN(amount) || amount < 20000) {
          return await interaction.reply({
            content: '❌ Invalid amount. You must deposit at least 20,000 Souls.',
            ephemeral: true
          });
        }

        try {
          const { refuelServerVault } = require('../database/queries');
          const result = await refuelServerVault(interaction.user.id, interaction.guildId, amount);

          if (!result.success) {
            if (result.reason === 'insufficient_funds') {
              return await interaction.reply({
                content: `❌ You do not have enough Souls. Your balance: **${result.userBalance}** Souls.`,
                ephemeral: true
              });
            }
            return await interaction.reply({
              content: '❌ Failed to refuel the vault. Please try again later.',
              ephemeral: true
            });
          }

          return await interaction.reply({
            content: `⛽ **Vault Refueled!** Successfully deposited **${amount}** Souls from your balance into the server's Soul Vault.\nNew Vault Balance: **${result.newVaultBalance}** Souls.\nAll commands and functions have been enabled.`,
            ephemeral: false
          });
        } catch (err) {
          console.error('Error in refuel modal submission:', err);
          return await interaction.reply({
            content: '❌ An unexpected error occurred: ' + err.message,
            ephemeral: true
          });
        }
      }
    }

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

    const { logRequest } = require('../utils/requestLogger');
    const cmdStr = `/${interaction.commandName}` + (interaction.options.getSubcommand(false) ? ` ${interaction.options.getSubcommand()}` : '');

    try {
      const control = await getBotControlState(interaction.guildId);
      const isAdminCommand = interaction.commandName === 'admin';

      if (control.maintenanceMode && !isAdminCommand) {
        logRequest({
          username: interaction.user.tag,
          command: cmdStr,
          fulfilled: false,
          error: 'Maintenance Mode'
        });
        return interaction.reply({
          content: control.maintenanceMessage,
          ephemeral: true
        });
      }

      // Server Vault Fuel Check (block commands if balance < 1000)
      const { getTreasury } = require('../database/queries');
      const treasury = await getTreasury(interaction.guildId);
      const isFuelLow = treasury && treasury.balance < 20000;

      if (isFuelLow && !isAdminCommand) {
        const isOwner = interaction.user.id === interaction.guild.ownerId;
        const components = [];
        if (isOwner) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('refuel_vault_btn')
              .setLabel('Refuel Vault')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('⛽')
          );
          components.push(row);
        }

        logRequest({
          username: interaction.user.tag,
          command: cmdStr,
          fulfilled: false,
          error: 'Insufficient Vault Fuel'
        });

        return await interaction.reply({
          content: `❌ **Insufficient Vault Balance**: This server's Soul Vault is out of fuel (Balance: **${treasury.balance}** Souls, Minimum required: **20,000** Souls). Commands and features are temporarily disabled.${isOwner ? '\nAs the Server Owner, you can refuel the vault using your own Souls.' : '\nPlease contact the Server Owner to refuel the vault.'}`,
          components: components,
          ephemeral: true
        });
      }

      if (!isAdminCommand) {
        const feature = getFeatureForSlashCommand(interaction.commandName);
        if (feature && !control.features[feature]) {
          logRequest({
            username: interaction.user.tag,
            command: cmdStr,
            fulfilled: false,
            error: 'Feature Disabled'
          });
          return interaction.reply({
            content: `❌ **${interaction.commandName}** is temporarily disabled globally by the bot owner.`,
            ephemeral: true
          });
        }
      }

      await command.execute(interaction);
      
      logRequest({
        username: interaction.user.tag,
        command: cmdStr,
        fulfilled: true
      });
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);

      logRequest({
        username: interaction.user.tag,
        command: cmdStr,
        fulfilled: false,
        error: error.message || 'Execution Error'
      });

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
