const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLeaderboard } = require('../database/queries');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the server leaderboard for the current monthly cycle'),
  async execute(interaction) {
    if (!interaction.channel || !interaction.channel.name.toLowerCase().includes('soul-leaderboard')) {
      return await interaction.reply({
        content: '❌ This command can only be used in the **#💵-soul-leaderboard** channel.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const serverId = interaction.guildId;

    try {
      const { rankings, currencyName, currencyIcon } = await getLeaderboard(serverId, 10);

      const embed = new EmbedBuilder()
        .setColor('#ffd700') // Gold Theme
        .setTitle(`🏆 ${interaction.guild.name} Monthly Leaderboard`)
        .setDescription(`Top members in the current active cycle. Reset occurs monthly.`)
        .setTimestamp()
        .setFooter({ text: 'Keep chatting and checking in to climb the ranks!' });

      if (rankings.length === 0) {
        embed.setDescription('No active rankings yet! Start earning currency by sending messages or using `/checkin`.');
        return await interaction.editReply({ embeds: [embed] });
      }

      // Fetch users in parallel for cleaner username displays
      const rankList = [];
      const medals = ['🥇', '🥈', '🥉'];

      for (let i = 0; i < rankings.length; i++) {
        const rankData = rankings[i];
        const rankNum = i + 1;
        const medal = medals[i] || `**#${rankNum}**`;
        
        let username = 'Unknown User';
        try {
          const user = await interaction.client.users.fetch(rankData.discord_id);
          username = user.username;
        } catch {
          username = `<@${rankData.discord_id}>`;
        }

        rankList.push(`${medal} **${username}** — ${rankData.coin_balance} ${currencyIcon} ${currencyName}`);
      }

      embed.setDescription(rankList.join('\n'));

      return await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`Error loading leaderboard for server ${serverId}:`, error);
      throw error;
    }
  }
};
