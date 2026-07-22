const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getServerSettings } = require('../database/queries');
const { getBotControlState } = require('./botControl');
const { getRandomCharacter } = require('./characters');
const fs = require('fs');

// In-memory drop states shared across the bot process
const activeDrops = new Map(); // key: channelId -> { value, character, messageId, timestamp, timeoutId }
const nextDropTimers = new Map(); // key: serverId -> timeoutId
const channelDropHistory = new Map(); // key: channelId -> Array of timestamps within last 10 mins
const channelDropCooldowns = new Map(); // key: channelId -> timestamp when 24h penalty cooldown expires

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

    // Check 24-hour drop spam penalty cooldown for the channel
    const now = Date.now();
    if (channelDropCooldowns.has(channel.id)) {
      const cooldownUntil = channelDropCooldowns.get(channel.id);
      if (now < cooldownUntil) {
        console.log(`[Drops] Blocked drop in channel ${channel.id} due to active 24h drop spam penalty cooldown.`);
        return null;
      } else {
        channelDropCooldowns.delete(channel.id);
      }
    }

    // Track drop timestamps to detect spam (3+ drops within 10 minutes)
    const history = channelDropHistory.get(channel.id) || [];
    const recentHistory = history.filter(t => now - t <= 10 * 60 * 1000);
    recentHistory.push(now);
    channelDropHistory.set(channel.id, recentHistory);

    if (recentHistory.length >= 3) {
      const penaltyUntil = now + 24 * 60 * 60 * 1000; // 24 hours
      channelDropCooldowns.set(channel.id, penaltyUntil);
      channelDropHistory.set(channel.id, []);

      // Notify the channel about the 24-hour penalty cooldown
      const spamEmbed = new EmbedBuilder()
        .setColor('#ef4444')
        .setTitle('🛑 AUTOMATIC DROP SPAM PROTECTION')
        .setDescription(
          `⚠️ **Drop spam detected in this channel!**\n\n` +
          `Auto drops have been triggered **3 or more times within 10 minutes**.\n` +
          `To protect the economy balance, auto drops in <#${channel.id}> have been placed on a **24-hour penalty cooldown**.\n\n` +
          `⏰ **Auto drops will automatically resume after 24 hours.**`
        )
        .setFooter({ text: 'Soul Economy Anti-Spam Guard' })
        .setTimestamp();

      await channel.send({ embeds: [spamEmbed] }).catch(() => {});
      return null;
    }

    // Check Server Vault Fuel
    const { getTreasury } = require('../database/queries');
    const treasury = await getTreasury(guildId);
    if (treasury && treasury.balance < 20000) {
      console.log(`[Drops] Blocked drop in guild ${guildId} due to insufficient vault balance (${treasury.balance} < 20000).`);
      return null;
    }

    const character = getRandomCharacter();
    const dropValue = character.value;

    const files = [];
    if (character.imagePath && fs.existsSync(character.imagePath)) {
      const file = new AttachmentBuilder(character.imagePath);
      files.push(file);
    }

    const contentText = `✦ **A ${character.tier} SOUL HAS DESCENDED** ✦\n**${character.name}** has appeared! (Value: **${dropValue}** Souls)\nType \`soul\` to claim her!`;

    const dropMsg = await channel.send({ content: contentText, files }).catch(err => {
      console.error(`Failed to send drop message to channel ${channel.id}:`, err);
      return null;
    });

    if (!dropMsg) return null;

    // If there was an existing active drop in this channel, clear its timeout to prevent leaks
    if (activeDrops.has(channel.id)) {
      const oldDrop = activeDrops.get(channel.id);
      if (oldDrop.timeoutId) {
        clearTimeout(oldDrop.timeoutId);
      }
      try {
        const oldMsg = await channel.messages.fetch(oldDrop.messageId).catch(() => null);
        if (oldMsg) {
          await oldMsg.delete().catch(() => {});
        }
      } catch (err) {
        console.error('Failed to expire old drop message:', err);
      }
    }

    // Drop stays active indefinitely until caught
    const timeoutId = null;

    activeDrops.set(channel.id, {
      character,
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
            .setDescription(`A **${character.name}** (Tier: **${character.tier}**, Value: **${character.value}** Souls) has just spawned in <#${channel.id}>!`)
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
    const timerObj = nextDropTimers.get(guildId);
    if (timerObj && timerObj.timeoutId) {
      clearTimeout(timerObj.timeoutId);
    }
  }
  const nextDropTime = Date.now() + 10 * 60 * 1000;
  const timeoutId = setTimeout(async () => {
    // Remove the timer from the map since it's now executing/fired
    nextDropTimers.delete(guildId);

    try {
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return;
      
      const settings = await getServerSettings(guildId);
      if (!settings.auto_drops_enabled) return;

      const targetChannelId = settings.drop_channel_id || channelId;
      const channel = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return;

      const control = await getBotControlState();
      if (control.maintenanceMode || !control.features.drops) {
        // If drops are paused/disabled or in maintenance, schedule retry
        if (!nextDropTimers.has(guildId)) {
          scheduleNextDrop(client, guildId, channelId);
        }
        return;
      }

      await triggerDrop(client, guildId, channel);

      // Schedule the next drop if no newer timer was scheduled in the meantime (e.g. from a catch)
      if (!nextDropTimers.has(guildId)) {
        scheduleNextDrop(client, guildId, targetChannelId);
      }
    } catch (err) {
      console.error(`Error in scheduled drop for ${guildId}:`, err);
      // Re-schedule on error to avoid loop dying
      if (!nextDropTimers.has(guildId)) {
        scheduleNextDrop(client, guildId, channelId);
      }
    }
  }, 10 * 60 * 1000); // 10 minutes

  nextDropTimers.set(guildId, { timeoutId, nextDropTime });
}

module.exports = {
  activeDrops,
  nextDropTimers,
  channelDropCooldowns,
  triggerDrop,
  scheduleNextDrop
};
