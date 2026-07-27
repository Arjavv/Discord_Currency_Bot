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
const {
  addWarning,
  getUserWarnings,
  clearUserWarnings,
  getServerSettings,
  getTreasury
} = require('../database/queries');

/**
 * Builds the cute interactive Admin & Moderation Panel embed and action rows.
 */
async function buildAdminPanelPayload(guild, moderatorUser) {
  const settings = await getServerSettings(guild.id);
  const treasury = await getTreasury(guild.id);
  const memberCount = guild.memberCount;
  const vaultBalance = treasury ? Number(treasury.balance).toLocaleString() : '100,000';

  const embed = new EmbedBuilder()
    .setColor('#c084fc') // Pastel lavender purple
    .setTitle('✨ 👑 Soul Royal Admin & Configuration Sanctuary 💜 ✨')
    .setDescription(
      `Welcome back, **${moderatorUser.username}**! 🐾💜\n` +
      `Here is your administrative control sanctuary. Select a moderation tool or system configuration menu below!\n\n` +
      `🌸 **Server:** \`${guild.name}\` (**${memberCount}** souls)\n` +
      `📢 **Drop Channel:** ${settings.drop_channel_id ? `<#${settings.drop_channel_id}>` : '*Not Set*'}\n` +
      `🤖 **Bot Channel:** ${settings.bot_channel_id ? `<#${settings.bot_channel_id}>` : '*Not Set*'}\n` +
      `📜 **Log Channel:** ${settings.log_channel_id ? `<#${settings.log_channel_id}>` : '*Not Set*'}\n` +
      `⛽ **Vault Fuel:** **${vaultBalance}** Souls\n` +
      `⚡ **Auto Drops:** \`${settings.auto_drops_enabled ? 'Active (10m cycle) ✨' : 'Disabled 💤'}\``
    )
    .addFields(
      {
        name: '🎀 Member Moderation Tools',
        value: '• Use **Moderation Actions** menu below to Kick, Ban, Timeout, Warn, or Purge messages.',
        inline: false
      },
      {
        name: '⚙️ Server Configuration & System Controls',
        value: '• Use **Server Configurations** menu to configure channels, feature toggles, vault tax, or giveaway templates.',
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
    .setPlaceholder('🔨 Choose a Moderation Action...')
    .addOptions([
      { label: '🎀 Kick Member', description: 'Kick a member from the server', value: 'mod_kick' },
      { label: '🚫 Ban Member', description: 'Ban a member permanently', value: 'mod_ban' },
      { label: '🔇 Mute / Timeout Member', description: 'Temporarily mute a member with custom duration', value: 'mod_timeout' },
      { label: '🔊 Remove Timeout (Unmute)', description: 'Remove active timeout from a member', value: 'mod_untimeout' },
      { label: '⚠️ Warn Member', description: 'Issue a formal warning to a user', value: 'mod_warn' },
      { label: '📋 View User Warnings', description: 'View warning log history for a user', value: 'mod_view_warns' },
      { label: '🧹 Clear / Purge Messages', description: 'Bulk delete 1 to 100 recent messages in this channel', value: 'mod_purge' }
    ]);

  // Action Row 2: Server Configuration Select Menu
  const configActionSelect = new StringSelectMenuBuilder()
    .setCustomId('admin_config_action_select')
    .setPlaceholder('⚙️ Choose Server Configuration...')
    .addOptions([
      { label: '📢 Set / Create Drop Channel', description: 'Select or create text channel for automatic character spawns', value: 'cfg_drop_channel' },
      { label: '🤖 Set / Create Bot Command Channel', description: 'Select or create text channel for user commands', value: 'cfg_bot_channel' },
      { label: '📜 Set / Create Admin Log Channel', description: 'Select or create custom channel for administrative logs', value: 'cfg_log_channel' },
      { label: '➕ Create New Channel Instantly', description: 'Create a new dedicated channel (Drop, Bot, or Log) automatically', value: 'cfg_create_channel' },
      { label: '🎛️ Toggle Feature Overrides', description: 'Turn features ON/OFF for this server (Casino, Shop, Rob, etc.)', value: 'cfg_feature_toggles' },
      { label: '⛽ Soul Vault & Custom Tax Rate', description: 'Refuel vault or configure custom tax rate', value: 'cfg_vault_tax' },
      { label: '🎁 Giveaway Templates', description: 'Customize ping and announcement text templates', value: 'cfg_giveaway_templates' },
      { label: '🔄 Reset Monthly Economy Cycle', description: 'Reset coin balances and snapshot final rankings', value: 'cfg_reset_cycle' }
    ]);

  // Action Row 3: Quick System Control Buttons (NO force-drop)
  const btnSetup = new ButtonBuilder()
    .setCustomId('admin_quick_setup')
    .setLabel('Auto-Setup Channels')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('⚙️');

  const btnRefuelVault = new ButtonBuilder()
    .setCustomId('refuel_vault_btn')
    .setLabel('Refuel Vault')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⛽');

  const btnToggleAutoDrop = new ButtonBuilder()
    .setCustomId('admin_quick_autodrop')
    .setLabel(settings.auto_drops_enabled ? 'Stop Auto-Drops' : 'Start Auto-Drops')
    .setStyle(settings.auto_drops_enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    .setEmoji(settings.auto_drops_enabled ? '⏹️' : '▶️');

  const row1 = new ActionRowBuilder().addComponents(modActionSelect);
  const row2 = new ActionRowBuilder().addComponents(configActionSelect);
  const row3 = new ActionRowBuilder().addComponents(btnSetup, btnRefuelVault, btnToggleAutoDrop);

  return { embeds: [embed], components: [row1, row2, row3], files };
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
