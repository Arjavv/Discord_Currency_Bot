const { EmbedBuilder } = require('discord.js');
const { getServerSettings } = require('../database/queries');
const { getBotControlState } = require('./botControl');

// In-memory drop states shared across the bot process
const activeDrops = new Map(); // key: channelId -> { value, messageId, timestamp, timeoutId }
const nextDropTimers = new Map(); // key: serverId -> timeoutId

/**
 * Triggers a drop in the specified channel.
 * @param {Client} client - Discord client
 * @param {string} guildId - Server ID
 * @param {TextChannel} channel - Channel to drop the coin in
 * @returns {Promise<{value: number, messageId: string}|null>}
 */
async function triggerDrop(client, guildId, channel) {
  try {
    const control = await getBotControlState();
    if (control.maintenanceMode || !control.features.drops) {
      return null;
    }

    const settings = await getServerSettings(guildId);
    const currencyName = settings.currency_name;
    const currencyIcon = settings.currency_icon_url;

    // Weighted random coin value between 1 and 50 (50 is least probable)
    const dropValue = Math.floor(Math.pow(Math.random(), 2) * 50) + 1;

    const embed = new EmbedBuilder()
      .setColor('#ffd700')
      .setTitle('☠️ A Soul Coin has appeared! ☠️')
      .setDescription(`A stray **Soul Coin** is floating in the air!\n\nQuick! Anyone can catch it by typing **soul** in this channel!`)
      .addFields(
        { name: 'Value', value: `💰 **1 - 50** ${currencyIcon} ${currencyName}`, inline: true }
      )
      .setTimestamp()
      // Footer removed – drop does not expire

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

    // Drop stays active indefinitely until caught
    const timeoutId = null;

    activeDrops.set(channel.id, {
      value: dropValue,
      messageId: dropMsg.id,
      timestamp: Date.now(),
      timeoutId
    });

    // Send log to #soul-logs
    try {
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        const adminLogs = guild.channels.cache.find(c => c.name.toLowerCase() .includes('soul-logs') && c.isTextBased());
        if (adminLogs) {
          const logEmbed = new EmbedBuilder()
            .setColor('#ffa500')
            .setTitle('📦 Drop Spawned')
            .setDescription(`A random Soul Coin drop has just spawned in <#${channel.id}>!`)
            .addFields(
              { name: 'Next Scheduled Drop', value: '10 minutes after this drop is caught.' }
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

/**
 * Schedules the next drop for a server.
 */
function scheduleNextDrop(client, guildId, channelId) {
  if (nextDropTimers.has(guildId)) {
    clearTimeout(nextDropTimers.get(guildId));
  }
  const timeoutId = setTimeout(async () => {
    try {
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return;
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return;
      
      const settings = await getServerSettings(guildId);
      if (!settings.auto_drops_enabled) return;

      const control = await getBotControlState();
      if (control.maintenanceMode || !control.features.drops) return;

      await triggerDrop(client, guildId, channel);
    } catch (err) {
      console.error(`Error in scheduled drop for ${guildId}:`, err);
    }
  }, 10 * 60 * 1000); // 10 minutes

  nextDropTimers.set(guildId, timeoutId);
}

module.exports = {
  activeDrops,
  nextDropTimers,
  triggerDrop,
  scheduleNextDrop
};
