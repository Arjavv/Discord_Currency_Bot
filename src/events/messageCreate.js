const { recordMessageActivity, getServerSettings } = require('../database/queries');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(message) {
    // Ignore bots and direct messages (DMs)
    if (message.author.bot || !message.guild) return;

    const userId = message.author.id;
    const serverId = message.guild.id;

    // Filter and count words (ignoring extra whitespace)
    const words = message.content.trim().split(/\s+/).filter(Boolean);
    if (words.length < 5) return; // Ignore short messages to prevent spam

    try {
      // Award 10 coins for milestone, 15 seconds cooldown, daily cap of 20 coins
      const result = await recordMessageActivity(userId, serverId, 10, 15, 20);

      if (result.success) {
        if (result.awardedMilestone) {
          console.log(`[Activity Earning] User ${message.author.tag} (${userId}) reached milestone: ${result.totalMessages} messages. Awarded ${result.amountAwarded} coins.`);

          // Find the log channel named 'soul-bot'
          const logChannel = message.guild.channels.cache.find(
            c => c.name.toLowerCase() === 'soul-bot' && c.isTextBased()
          );

          if (logChannel) {
            const settings = await getServerSettings(serverId);
            const currencyName = settings.currency_name;
            const currencyIcon = settings.currency_icon_url;

            const milestoneEmbed = new EmbedBuilder()
              .setColor('#ffd700') // Bright Gold
              .setTitle('🎉 Chat Milestone Reached!')
              .setDescription(`Congratulations to ${message.author} for active engagement in the server!`)
              .addFields(
                { name: 'Messages Sent', value: `💬 **${result.totalMessages}** messages`, inline: true },
                { name: 'Milestone Reward', value: `**+${result.amountAwarded}** ${currencyIcon} ${currencyName}`, inline: true },
                { name: 'New Balance', value: `**${result.newBalance}** ${currencyIcon} ${currencyName}`, inline: false }
              )
              .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
              .setTimestamp();

            await logChannel.send({ embeds: [milestoneEmbed] }).catch(err => {
              console.error(`Failed to send milestone message to #currency_logs:`, err);
            });
          } else {
            console.warn(`[Activity Earning] User reached milestone but #currency_logs channel was not found.`);
          }
        }
      }
    } catch (error) {
      console.error(`Error recording message activity for user ${userId} in guild ${serverId}:`, error);
    }
  }
};
