const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserBalance } = require('../database/queries');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription("View your current coin balance or another user's balance")
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user whose balance you want to view')
        .setRequired(false)
    ),
  async execute(interaction) {
    if (!interaction.channel || interaction.channel.name.toLowerCase() !== 'soul-bot') {
      return await interaction.reply({
        content: '❌ This command can only be used in the **#soul-bot** channel.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;
    const serverId = interaction.guildId;

    try {
      const { balance, currencyName, currencyIcon } = await getUserBalance(userId, serverId);

      const embed = new EmbedBuilder()
        .setColor('#00bfff') // Vibrant Electric Blue
        .setAuthor({
          name: `${targetUser.username}'s Account`,
          iconURL: targetUser.displayAvatarURL({ dynamic: true })
        })
        .setTitle('💰 Account Balance')
        .setDescription(`Here is the current wallet information:`)
        .addFields(
          { name: 'Balance', value: `**${balance}** ${currencyIcon} ${currencyName}`, inline: true },
          { name: 'Server', value: interaction.guild.name, inline: true }
        )
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`Error processing balance command for user ${userId} in guild ${serverId}:`, error);
      throw error;
    }
  }
};
