const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { updateServerSetting, resetCycle, getServerSettings } = require('../database/queries');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Administration commands for the currency system')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Restricts visibility to server admins by default
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-currency-name')
        .setDescription('Set the currency name for the server')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('New name for the currency (e.g. Gold, Credits, Gems)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-currency-icon')
        .setDescription('Set the currency emoji/icon for the server')
        .addStringOption(option =>
          option.setName('icon')
            .setDescription('Emoji or shortcode (e.g. 🪙, 💎, :coin:)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('reset-cycle')
        .setDescription('Close current cycle, archive rankings, and reset all balances to 0 for a new cycle')
    ),

  async execute(interaction) {
    // Secondary check: double-check permission just in case discord API settings override client-side defaults
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({
        content: '❌ You must have Administrator permissions to run admin subcommands.',
        ephemeral: true
      });
    }

    await interaction.deferReply();
    const subcommand = interaction.options.getSubcommand();
    const serverId = interaction.guildId;

    try {
      if (subcommand === 'set-currency-name') {
        const name = interaction.options.getString('name');
        const settings = await updateServerSetting(serverId, name, null);

        const embed = new EmbedBuilder()
          .setColor('#00ffaa')
          .setTitle('⚙️ Setting Updated')
          .setDescription(`Currency name has been successfully updated.`)
          .addFields(
            { name: 'New Name', value: name, inline: true },
            { name: 'Current Icon', value: settings.currency_icon_url, inline: true }
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === 'set-currency-icon') {
        const icon = interaction.options.getString('icon');
        const settings = await updateServerSetting(serverId, null, icon);

        const embed = new EmbedBuilder()
          .setColor('#00ffaa')
          .setTitle('⚙️ Setting Updated')
          .setDescription(`Currency icon has been successfully updated.`)
          .addFields(
            { name: 'Current Name', value: settings.currency_name, inline: true },
            { name: 'New Icon', value: icon, inline: true }
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === 'reset-cycle') {
        const settings = await getServerSettings(serverId);
        const result = await resetCycle(serverId);

        const embed = new EmbedBuilder()
          .setColor('#ff3300') // Intense Red for destructive action
          .setTitle('🔄 Monthly Cycle Reset Completed')
          .setDescription(
            `The current monthly cycle has been successfully closed and reset.`
          )
          .addFields(
            { name: 'Rankings Archived', value: `**${result.archivedCount}** members snapshotted`, inline: true },
            { name: 'Database Action', value: 'Balances set to 0, check-ins cleared', inline: true },
            { name: 'Active Cycle Status', value: 'New cycle started successfully!', inline: false }
          )
          .setFooter({ text: `Note: rankings were archived under Cycle ID #${result.oldCycleId}` })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error(`Error executing admin subcommand ${subcommand} on server ${serverId}:`, error);
      throw error;
    }
  }
};
