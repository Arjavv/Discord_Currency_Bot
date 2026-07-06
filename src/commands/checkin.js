const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { checkInUser, getServerSettings } = require('../database/queries');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('checkin')
    .setDescription('Claim your daily currency reward (once every 24 hours)'),
  async execute(interaction) {
    if (!interaction.channel || !interaction.channel.name.toLowerCase().includes('soul-bots')) {
      return await interaction.reply({
        content: '❌ This command can only be used in the **#💵-soul-bots** channel.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const userId = interaction.user.id;
    const serverId = interaction.guildId;
    const checkinAmount = 20; // Default amount

    try {
      const settings = await getServerSettings(serverId);
      const currencyName = settings.currency_name;
      const currencyIcon = settings.currency_icon_url;

      const result = await checkInUser(userId, serverId, checkinAmount);

      if (result.success) {
        const successEmbed = new EmbedBuilder()
          .setColor('#00ffaa') // Elegant Mint Green
          .setTitle('✨ Daily Check-in Success!')
          .setDescription(`You have successfully claimed your daily reward!`)
          .addFields(
            { name: 'Reward Claimed', value: `**+${checkinAmount}** ${currencyIcon} ${currencyName}`, inline: true },
            { name: 'New Balance', value: `**${result.newBalance}** ${currencyIcon} ${currencyName}`, inline: true }
          )
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        return await interaction.editReply({ embeds: [successEmbed] });
      } else {
        // Calculate the future unlock timestamp for Discord's dynamic relative time formatting
        const nextClaimUnix = Math.floor((Date.now() + result.cooldownRemainingMs) / 1000);
        
        const cooldownEmbed = new EmbedBuilder()
          .setColor('#ff3366') // Premium Neon Red/Pink
          .setTitle('⏳ Check-in on Cooldown')
          .setDescription(`You have already claimed your daily check-in reward today, **${interaction.user.username}**!`)
          .addFields(
            { name: 'Next Claim Available', value: `<t:${nextClaimUnix}:F> (<t:${nextClaimUnix}:R>)` },
            { name: 'Current Balance', value: `**${result.currentBalance}** ${currencyIcon} ${currencyName}` }
          )
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        return await interaction.editReply({ embeds: [cooldownEmbed] });
      }
    } catch (error) {
      console.error(`Error processing check-in command for user ${userId}:`, error);
      throw error; // Let interactionCreate event catch it and send a standard error reply
    }
  }
};
