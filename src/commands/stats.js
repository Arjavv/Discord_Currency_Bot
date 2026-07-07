const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserStats, getUserInventory } = require('../database/queries');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Check your current combat stats privately (Strength, Defense, Speed, Magic)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const serverId = interaction.guildId;

    // Enforce channel restriction to #soul-bot
    if (!interaction.channel || !interaction.channel.name.toLowerCase().includes('soul-bot')) {
      return await interaction.reply({
        content: '❌ This command can only be used in the **#soul-bot** channel.',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const stats = await getUserStats(userId, serverId);
      
      const embed = new EmbedBuilder()
        .setAuthor({
          name: `${interaction.user.username}'s Profile`,
          iconURL: interaction.user.displayAvatarURL({ dynamic: true })
        })
        .setColor('#ffd700')
        .setTitle('📊 Your Core Stats')
        .setDescription(
          `⚔️ **Strength:** \`${stats.total.strength}\` (Base: ${stats.base.strength} | Weekly: +${stats.weekly.strength} | Potion: +${stats.activeBuffs.strength})\n` +
          `🛡️ **Defense:** \`${stats.total.defense}\` (Base: ${stats.base.defense} | Weekly: +${stats.weekly.defense} | Potion: +${stats.activeBuffs.defense})\n` +
          `⚡ **Speed:** \`${stats.total.speed}\` (Base: ${stats.base.speed} | Weekly: +${stats.weekly.speed} | Potion: +${stats.activeBuffs.speed})\n` +
          `🔮 **Magic:** \`${stats.total.magic}\` (Base: ${stats.base.magic} | Weekly: +${stats.weekly.magic} | Potion: +${stats.activeBuffs.magic})\n`
        )
        .setTimestamp();

      // Add Divine Shield info
      const inventory = await getUserInventory(userId, serverId);
      const shieldCount = inventory.shield || 0;
      embed.addFields({ name: '🎒 Inventory', value: `🛡️ **Divine Shield:** \`${shieldCount}\``, inline: false });

      // Active potions
      if (stats.detailedBoosts.length > 0) {
        const potionList = stats.detailedBoosts.map(b => {
          const timeLeftMs = new Date(b.expires_at).getTime() - Date.now();
          const hoursLeft = (timeLeftMs / (1000 * 60 * 60)).toFixed(1);
          return `🧪 **+15 ${b.stat_type.charAt(0).toUpperCase() + b.stat_type.slice(1)} Buff** (Expires in ${hoursLeft}h)`;
        }).join('\n');
        embed.addFields({ name: '🧪 Active Potion Buffs', value: potionList, inline: false });
      }

      // Ephemeral reply - transparent background, visible only to user
      return await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error(`Error fetching slash stats for user ${userId}:`, error);
      if (interaction.deferred || interaction.replied) {
        return await interaction.editReply({
          content: '❌ An error occurred while fetching your stats.'
        }).catch(() => null);
      }
      return await interaction.reply({
        content: '❌ An error occurred while fetching your stats.',
        ephemeral: true
      }).catch(() => null);
    }
  }
};
