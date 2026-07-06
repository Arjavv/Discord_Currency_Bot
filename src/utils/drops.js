const { EmbedBuilder } = require('discord.js');
const { getServerSettings } = require('../database/queries');

// In-memory drop states shared across the bot process
const activeDrops = new Map(); // key: channelId -> { value, messageId, timestamp, timeoutId }
const lastDropTimes = new Map(); // key: channelId -> timestamp

/**
 * Triggers a drop in the specified channel.
 * @param {Client} client - Discord client
 * @param {string} guildId - Server ID
 * @param {TextChannel} channel - Channel to drop the coin in
 * @returns {Promise<{value: number, messageId: string}|null>}
 */
async function triggerDrop(client, guildId, channel) {
  try {
    const settings = await getServerSettings(guildId);
    const currencyName = settings.currency_name;
    const currencyIcon = settings.currency_icon_url;

    // Generate random coin value between 1 and 50
    const dropValue = Math.floor(Math.random() * 50) + 1;

    const embed = new EmbedBuilder()
      .setColor('#ffd700')
      .setTitle('☠️ A Soul Coin has appeared! ☠️')
      .setDescription(`A stray **Soul Coin** is floating in the air!\n\nQuick! Anyone can catch it by typing **soul** in this channel!`)
      .addFields(
        { name: 'Value', value: `💰 **1 - 50** ${currencyIcon} ${currencyName}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Expires in 5 minutes if unclaimed.' });

    const dropMsg = await channel.send({ embeds: [embed] }).catch(err => {
      console.error(`Failed to send drop message to channel ${channel.id}:`, err);
      return null;
    });

    if (!dropMsg) return null;

    // If there was an existing active drop in this channel, clear its timeout to prevent leaks
    if (activeDrops.has(channel.id)) {
      const oldDrop = activeDrops.get(channel.id);
      clearTimeout(oldDrop.timeoutId);
    }

    // Set 5-minute expiration timer
    const timeoutId = setTimeout(async () => {
      if (activeDrops.has(channel.id) && activeDrops.get(channel.id).messageId === dropMsg.id) {
        activeDrops.delete(channel.id);
        lastDropTimes.set(channel.id, Date.now()); // Cooldown starts after fade away

        const expiredEmbed = new EmbedBuilder()
          .setColor('#555555')
          .setTitle('☠️ The Soul Coin has faded away... ☠️')
          .setDescription('No one caught the Soul Coin in time. It has returned to the abyss.')
          .setTimestamp();

        await dropMsg.edit({ embeds: [expiredEmbed] }).catch(() => {});
      }
    }, 5 * 60 * 1000);

    activeDrops.set(channel.id, {
      value: dropValue,
      messageId: dropMsg.id,
      timestamp: Date.now(),
      timeoutId
    });

    // Send log to #admin-logs
    try {
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        const adminLogs = guild.channels.cache.find(c => c.name.toLowerCase() === 'admin-logs' && c.isTextBased());
        if (adminLogs) {
          const logEmbed = new EmbedBuilder()
            .setColor('#ffa500')
            .setTitle('📦 Drop Spawned')
            .setDescription(`A random Soul Coin drop has just spawned in <#${channel.id}>!`)
            .addFields(
              { name: 'Next Eligible Drop', value: '10 minutes after this drop is caught or expires.' }
            )
            .setTimestamp();
          await adminLogs.send({ embeds: [logEmbed] }).catch(() => {});
        }
      }
    } catch (logErr) {
      console.error('Failed to send drop log to admin-logs:', logErr);
    }

    return { value: dropValue, messageId: dropMsg.id };
  } catch (error) {
    console.error(`Error in triggerDrop:`, error);
    return null;
  }
}

module.exports = {
  activeDrops,
  lastDropTimes,
  triggerDrop
};
