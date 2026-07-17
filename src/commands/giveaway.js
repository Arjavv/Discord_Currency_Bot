const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGlobalSettings } = require('../database/queries');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('View the status and last winners of the daily, weekly, and monthly giveaways'),
  async execute(interaction) {
    if (!interaction.channel || !interaction.channel.name.toLowerCase().includes('soul-bot')) {
      return await interaction.reply({
        content: '❌ This command can only be used in the **#soul-bot** channel.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      const settings = await getGlobalSettings();
      const now = Date.now();

      const lastDaily = parseInt(settings.last_giveaway_daily || '0', 10);
      const lastWeekly = parseInt(settings.last_giveaway_weekly || '0', 10);
      const lastMonthly = parseInt(settings.last_giveaway_monthly || '0', 10);

      const dailyCooldown = 24 * 60 * 60 * 1000;
      const weeklyCooldown = 7 * 24 * 60 * 60 * 1000;
      const monthlyCooldown = 30 * 24 * 60 * 60 * 1000;

      // Helper to format remaining time
      const getRemainingTime = (lastTime, cooldown) => {
        const nextTime = lastTime + cooldown;
        if (now >= nextTime) return '⏳ Drawing soon...';
        const diffMs = nextTime - now;
        const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
        const diffMins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
        
        if (diffHours >= 24) {
          const days = Math.floor(diffHours / 24);
          const hours = diffHours % 24;
          return `⏳ ${days}d ${hours}h remaining`;
        }
        return `⏳ ${diffHours}h ${diffMins}m remaining`;
      };

      // Helper to format last winner info
      const getWinnerInfo = (winnerSetting) => {
        if (!winnerSetting) return 'No previous winner recorded.';
        try {
          const info = JSON.parse(winnerSetting);
          const dateStr = new Date(info.timestamp).toLocaleDateString();
          return `👤 **Winner:** <@${info.id}> (${info.tag || info.username})\n💰 **Prize:** **${info.amount.toLocaleString()}** Souls\n📅 **Date:** ${dateStr}`;
        } catch (e) {
          return 'No previous winner recorded.';
        }
      };

      const embed = new EmbedBuilder()
        .setColor('#8b2fc9')
        .setTitle('🎁 Soul Sweepstakes & Giveaways')
        .setDescription(
          'Automated giveaways are drawn regularly from active server members. ' +
          'Every member registered in the database is automatically entered!'
        )
        .addFields(
          {
            name: '📅 Daily Sweepstakes (1,000 Souls)',
            value: `${getRemainingTime(lastDaily, dailyCooldown)}\n\n**Last Draw:**\n${getWinnerInfo(settings.last_winner_daily)}`,
            inline: false
          },
          {
            name: '📅 Weekly Sweepstakes (5,000 Souls)',
            value: `${getRemainingTime(lastWeekly, weeklyCooldown)}\n\n**Last Draw:**\n${getWinnerInfo(settings.last_winner_weekly)}`,
            inline: false
          },
          {
            name: '📅 Monthly Sweepstakes (50,000 Souls)',
            value: `${getRemainingTime(lastMonthly, monthlyCooldown)}\n\n**Last Draw:**\n${getWinnerInfo(settings.last_winner_monthly)}`,
            inline: false
          }
        )
        .setThumbnail(interaction.client.user.displayAvatarURL())
        .setFooter({ text: 'Wield the power of your Souls!' })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error executing giveaway status command:', error);
      return await interaction.editReply({ content: '❌ Failed to retrieve giveaway status. Please try again later.' });
    }
  }
};
