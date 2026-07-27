const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  PermissionFlagsBits
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const { addWarning, getUserWarnings, clearUserWarnings, getServerSettings } = require('../database/queries');

/**
 * Builds the cute interactive Admin & Moderation Panel embed and action rows.
 */
async function buildAdminPanelPayload(guild, moderatorUser) {
  const settings = await getServerSettings(guild.id);
  const memberCount = guild.memberCount;

  const embed = new EmbedBuilder()
    .setColor('#c084fc') // Beautiful pastel lavender purple
    .setTitle('✨ 👑 Soul Royal Admin & Moderation Realm 💜 ✨')
    .setDescription(
      `Welcome back, **${moderatorUser.username}**! 🐾💜\n` +
      `Here is your administrative control sanctuary. Select a moderation tool or system control below!\n\n` +
      `🌸 **Server:** \`${guild.name}\` (**${memberCount}** souls)\n` +
      `📢 **Drop Channel:** ${settings.drop_channel_id ? `<#${settings.drop_channel_id}>` : '*Not Set*'}\n` +
      `🤖 **Bot Channel:** ${settings.bot_channel_id ? `<#${settings.bot_channel_id}>` : '*Not Set*'}\n` +
      `📜 **Log Channel:** ${settings.log_channel_id ? `<#${settings.log_channel_id}>` : '*Not Set*'}\n` +
      `⚡ **Auto Drops:** \`${settings.auto_drops_enabled ? 'Active (10m cycle) ✨' : 'Disabled 💤'}\``
    )
    .addFields(
      {
        name: '🎀 Member Moderation Tools',
        value: '• **Kick / Ban**: Soft or permanent member removal\n• **Timeout / Mute**: Temporarily silence a member\n• **Warn / History**: Issue warnings & view warning logs\n• **Purge**: Bulk delete messages in current channel',
        inline: false
      },
      {
        name: '🔮 Quick System Controls',
        value: '• Use the buttons below to trigger manual drops, auto-setup channels, or toggle auto-drops.',
        inline: false
      }
    )
    .setFooter({ text: '✦ Soul Admin Guard • Cute Moderation Sanctuary ✦', iconURL: guild.iconURL({ dynamic: true }) })
    .setTimestamp();

  // Attach cute anime banner if present
  const files = [];
  const bannerPath = path.join(__dirname, '..', 'assets', 'admin_banner.png');
  if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: 'admin_banner.png' }));
    embed.setImage('attachment://admin_banner.png');
  }

  // Action Row 1: Moderation Action Select Menu
  const modActionSelect = new StringSelectMenuBuilder()
    .setCustomId('admin_mod_action_select')
    .setPlaceholder('🔮 Select a Moderation Command...')
    .addOptions([
      { label: '🎀 Kick Member', description: 'Kick a member from the server', value: 'mod_kick' },
      { label: '🚫 Ban Member', description: 'Ban a member permanently', value: 'mod_ban' },
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

  return { embeds: [embed], components: [row1, row2], files };
}

/**
 * Sends a structured audit log entry to the server's #soul-logs channel.
 */
async function sendModLog(guild, title, description, color = '#c084fc', fields = []) {
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
