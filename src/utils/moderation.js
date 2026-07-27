const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits
} = require('discord.js');
const { addWarning, getUserWarnings, clearUserWarnings, getServerSettings } = require('../database/queries');

/**
 * Builds the interactive Admin & Moderation Panel embed and action rows.
 */
async function buildAdminPanelPayload(guild, moderatorUser) {
  const settings = await getServerSettings(guild.id);
  const memberCount = guild.memberCount;

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🛡️ Admin & Moderation Control Center')
    .setDescription(
      `Welcome **${moderatorUser.username}**! Use the interactive controls below to perform moderation actions or manage bot configurations.\n\n` +
      `📌 **Server Info:** \`${guild.name}\` (${memberCount} members)\n` +
      `📢 **Drop Channel:** ${settings.drop_channel_id ? `<#${settings.drop_channel_id}>` : '*Not Set*'}\n` +
      `🤖 **Bot Channel:** ${settings.bot_channel_id ? `<#${settings.bot_channel_id}>` : '*Not Set*'}\n` +
      `📜 **Log Channel:** ${settings.log_channel_id ? `<#${settings.log_channel_id}>` : '*Not Set*'}\n` +
      `⚡ **Auto Drops:** \`${settings.auto_drops_enabled ? 'Active (10m cycle)' : 'Disabled'}\``
    )
    .addFields(
      {
        name: '🔨 Member Moderation Tools',
        value: '• **Kick / Ban**: Remove a user from the server\n• **Timeout / Mute**: Temporarily mute a user\n• **Warn / History**: Issue warnings & check warning records\n• **Purge**: Bulk delete messages in channel',
        inline: false
      },
      {
        name: '⚙️ Quick Bot Commands',
        value: '• Use the buttons below to trigger manual drops, setup channels, or toggle auto-drops.',
        inline: false
      }
    )
    .setFooter({ text: 'Soul Admin Guard • Select an action below', iconURL: guild.iconURL({ dynamic: true }) })
    .setTimestamp();

  // Action Row 1: Moderation Action Select Menu
  const modActionSelect = new StringSelectMenuBuilder()
    .setCustomId('admin_mod_action_select')
    .setPlaceholder('🛠️ Choose a Moderation Action...')
    .addOptions([
      { label: '🔨 Kick Member', description: 'Kick a member from the server', value: 'mod_kick' },
      { label: '🚫 Ban Member', description: 'Ban a member permanently or with reason', value: 'mod_ban' },
      { label: '🔇 Mute / Timeout Member', description: 'Temporarily mute a member with custom duration', value: 'mod_timeout' },
      { label: '🔊 Remove Timeout (Unmute)', description: 'Remove active timeout from a member', value: 'mod_untimeout' },
      { label: '⚠️ Warn Member', description: 'Issue a formal warning to a user', value: 'mod_warn' },
      { label: '📋 View User Warnings', description: 'View warning log history for a user', value: 'mod_view_warns' },
      { label: '🧹 Clear / Purge Messages', description: 'Bulk delete 1 to 100 recent messages in this channel', value: 'mod_purge' }
    ]);

  // Action Row 2: Quick System Controls
  const btnSetup = new ButtonBuilder()
    .setCustomId('admin_quick_setup')
    .setLabel('Auto-Setup Channels')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('⚙️');

  const btnForceDrop = new ButtonBuilder()
    .setCustomId('admin_quick_forcedrop')
    .setLabel('Force Coin Drop')
    .setStyle(ButtonStyle.Success)
    .setEmoji('📦');

  const btnToggleAutoDrop = new ButtonBuilder()
    .setCustomId('admin_quick_autodrop')
    .setLabel(settings.auto_drops_enabled ? 'Stop Auto-Drops' : 'Start Auto-Drops')
    .setStyle(settings.auto_drops_enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    .setEmoji(settings.auto_drops_enabled ? '⏹️' : '▶️');

  const row1 = new ActionRowBuilder().addComponents(modActionSelect);
  const row2 = new ActionRowBuilder().addComponents(btnSetup, btnForceDrop, btnToggleAutoDrop);

  return { embeds: [embed], components: [row1, row2] };
}

/**
 * Sends a structured audit log entry to the server's #soul-logs channel.
 */
async function sendModLog(guild, title, description, color = '#ffaa00', fields = []) {
  try {
    const settings = await getServerSettings(guild.id);
    let logChannel = null;

    if (settings.log_channel_id) {
      logChannel = guild.channels.cache.get(settings.log_channel_id) ||
                 await guild.channels.fetch(settings.log_channel_id).catch(() => null);
    }
    if (!logChannel) {
      logChannel = guild.channels.cache.find(
        c => c.name.toLowerCase().includes('soul-logs') && c.isTextBased()
      );
    }

    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();

      if (fields.length > 0) {
        embed.addFields(fields);
      }

      await logChannel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err) {
    console.error('Failed to send mod log:', err);
  }
}

module.exports = {
  buildAdminPanelPayload,
  sendModLog
};
