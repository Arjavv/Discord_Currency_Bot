const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const {
  addWarning,
  getUserWarnings,
  clearUserWarnings,
  getServerSettings,
  toggleAutoDrops,
  updateServerChannels,
  updateDropChannel,
  getServerFeatureOverrides,
  setServerFeatureOverride,
  updateServerVaultCustomTaxRate,
  getServerGiveawaySettings,
  setServerGiveawaySettings,
  resetCycle
} = require('../database/queries');

const { buildAdminPanelPayload, sendModLog } = require('../utils/moderation');
const { triggerDrop, scheduleNextDrop, nextDropTimers } = require('../utils/drops');

module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction) {

    // Helper to check Administrator permissions for moderation/admin actions
    const checkAdminPerms = () => {
      if (!interaction.member || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        interaction.reply({
          content: '❌ **Access Denied**: You must have Administrator permissions to perform administrative or moderation actions.',
          ephemeral: true
        }).catch(() => {});
        return false;
      }
      return true;
    };

    // =========================================================================
    // 1. BUTTON INTERACTIONS
    // =========================================================================
    if (interaction.isButton()) {

      // Vault Refuel Button
      if (interaction.customId === 'refuel_vault_btn') {
        if (interaction.user.id !== interaction.guild.ownerId) {
          return await interaction.reply({
            content: '❌ Only the Server Owner can refuel the Soul Vault.',
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId('refuel_vault_modal')
          .setTitle('Refuel Server Vault');

        const amountInput = new TextInputBuilder()
          .setCustomId('refuel_amount')
          .setLabel('Amount of Souls to Deposit')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter amount (minimum 20,000)')
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        return await interaction.showModal(modal);
      }

      // Admin Quick Setup Button
      if (interaction.customId === 'admin_quick_setup') {
        if (!checkAdminPerms()) return;
        await interaction.deferReply({ ephemeral: true });
        
        try {
          const guild = interaction.guild;
          const channelsToCreate = [
            { name: 'soul-bot', topic: 'Currency commands usage', private: false },
            { name: 'soul-logs', topic: 'Administrative logs', private: true }
          ];

          const currentChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
          let category = currentChannels.find(
            c => c.name.toLowerCase() === 'soul' && c.type === ChannelType.GuildCategory
          );
          if (!category) {
            category = await guild.channels.create({ name: 'Soul', type: ChannelType.GuildCategory });
          }

          const created = [];
          for (const ch of channelsToCreate) {
            const exists = currentChannels.find(c => c.name.toLowerCase() === ch.name && c.type === ChannelType.GuildText);
            if (!exists) {
              const options = { name: ch.name, type: ChannelType.GuildText, topic: ch.topic, parent: category.id };
              if (ch.private) {
                options.permissionOverwrites = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
              }
              await guild.channels.create(options);
              created.push(`#${ch.name}`);
            }
          }

          await sendModLog(guild, '⚙️ Auto-Setup Executed', `Moderator <@${interaction.user.id}> ran auto-setup.\nCreated channels: ${created.join(', ') || 'None (already existed)'}`, '#00ffaa');
          return await interaction.editReply({ content: `✅ **Setup Completed!** Channels created: ${created.length > 0 ? created.join(', ') : 'All channels already exist.'}` });
        } catch (err) {
          return await interaction.editReply({ content: `❌ Setup failed: ${err.message}` });
        }
      }

      // Admin Quick Auto-Drop Toggle Button
      if (interaction.customId === 'admin_quick_autodrop') {
        if (!checkAdminPerms()) return;
        await interaction.deferReply({ ephemeral: true });

        try {
          const settings = await getServerSettings(interaction.guildId);
          const newStatus = !settings.auto_drops_enabled;
          await toggleAutoDrops(interaction.guildId, newStatus);

          if (newStatus) {
            let dropChannel = null;
            if (settings.drop_channel_id) {
              dropChannel = interaction.guild.channels.cache.get(settings.drop_channel_id) ||
                            await interaction.guild.channels.fetch(settings.drop_channel_id).catch(() => null);
            }
            if (dropChannel) {
              triggerDrop(interaction.client, interaction.guildId, dropChannel);
              scheduleNextDrop(interaction.client, interaction.guildId, dropChannel.id);
            }
          } else {
            if (nextDropTimers.has(interaction.guildId)) {
              const timerObj = nextDropTimers.get(interaction.guildId);
              if (timerObj?.timeoutId) clearTimeout(timerObj.timeoutId);
              nextDropTimers.delete(interaction.guildId);
            }
          }

          await sendModLog(interaction.guild, '⚡ Auto-Drops Toggled', `Moderator <@${interaction.user.id}> turned Auto-Drops **${newStatus ? 'ON' : 'OFF'}**.`, newStatus ? '#00ffaa' : '#ff3366');
          return await interaction.editReply({ content: `⚡ Auto drops have been **${newStatus ? 'ENABLED' : 'DISABLED'}**.` });
        } catch (err) {
          return await interaction.editReply({ content: `❌ Error toggling auto-drops: ${err.message}` });
        }
      }



      // Admin Clear Warnings Button
      if (interaction.customId.startsWith('admin_clear_warns_')) {
        if (!checkAdminPerms()) return;
        const targetId = interaction.customId.replace('admin_clear_warns_', '');
        await clearUserWarnings(interaction.guildId, targetId);
        
        await sendModLog(interaction.guild, '🧹 User Warnings Cleared', `Moderator <@${interaction.user.id}> cleared all warnings for <@${targetId}>.`, '#00ffaa');
        return await interaction.reply({ content: `✅ Successfully cleared all warnings for <@${targetId}>!`, ephemeral: true });
      }

      // Admin Trigger Create Channel Modal Button (drop, bot, log)
      if (interaction.customId.startsWith('admin_btn_create_channel_')) {
        if (!checkAdminPerms()) return;
        const channelType = interaction.customId.replace('admin_btn_create_channel_', '');

        const defaultName = channelType === 'drop' ? 'soul-drops' : channelType === 'bot' ? 'soul-bot' : 'soul-logs';
        const modal = new ModalBuilder()
          .setCustomId(`admin_modal_create_channel_${channelType}`)
          .setTitle(`Create New ${channelType.toUpperCase()} Channel`);

        const nameInput = new TextInputBuilder()
          .setCustomId('new_channel_name')
          .setLabel('Channel Name')
          .setStyle(TextInputStyle.Short)
          .setValue(defaultName)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
        return await interaction.showModal(modal);
      }

      // Admin Trigger Manual Input Channel Modal Button (drop, bot, log)
      if (interaction.customId.startsWith('admin_btn_input_channel_')) {
        if (!checkAdminPerms()) return;
        const channelType = interaction.customId.replace('admin_btn_input_channel_', '');

        const modal = new ModalBuilder()
          .setCustomId(`admin_modal_input_channel_${channelType}`)
          .setTitle(`Set ${channelType.toUpperCase()} Channel`);

        const inputField = new TextInputBuilder()
          .setCustomId('channel_query')
          .setLabel('Enter Channel Mention (#channel), Name, or ID')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('#soul-logs, general, or 123456789012345678')
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(inputField));
        return await interaction.showModal(modal);
      }
    }

    // =========================================================================
    // 2. STRING SELECT MENU INTERACTIONS
    // =========================================================================
    if (interaction.isStringSelectMenu()) {

      // Moderation Actions Select Menu
      if (interaction.customId === 'admin_mod_action_select') {
        if (!checkAdminPerms()) return;

        const action = interaction.values[0];

        if (action === 'mod_kick') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_kick')
            .setPlaceholder('🎀 Select a member to kick...')
            .setMinValues(1)
            .setMaxValues(1);
          return await interaction.reply({ content: '🎀 **Kick Member**: Select the member you wish to kick:', components: [new ActionRowBuilder().addComponents(userSelect)], ephemeral: true });
        }

        if (action === 'mod_ban') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_ban')
            .setPlaceholder('🚫 Select a member to ban...')
            .setMinValues(1)
            .setMaxValues(1);
          return await interaction.reply({ content: '🚫 **Ban Member**: Select the member you wish to ban:', components: [new ActionRowBuilder().addComponents(userSelect)], ephemeral: true });
        }

        if (action === 'mod_timeout') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_timeout')
            .setPlaceholder('🔇 Select a member to mute / timeout...')
            .setMinValues(1)
            .setMaxValues(1);
          return await interaction.reply({ content: '🔇 **Timeout Member**: Select the member you wish to timeout:', components: [new ActionRowBuilder().addComponents(userSelect)], ephemeral: true });
        }

        if (action === 'mod_untimeout') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_untimeout')
            .setPlaceholder('🔊 Select a member to remove timeout...')
            .setMinValues(1)
            .setMaxValues(1);
          return await interaction.reply({ content: '🔊 **Remove Timeout**: Select the member to unmute:', components: [new ActionRowBuilder().addComponents(userSelect)], ephemeral: true });
        }

        if (action === 'mod_warn') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_warn')
            .setPlaceholder('⚠️ Select a member to warn...')
            .setMinValues(1)
            .setMaxValues(1);
          return await interaction.reply({ content: '⚠️ **Warn Member**: Select the member you wish to issue a warning to:', components: [new ActionRowBuilder().addComponents(userSelect)], ephemeral: true });
        }

        if (action === 'mod_view_warns') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_view_warns')
            .setPlaceholder('📋 Select a member to view warnings...')
            .setMinValues(1)
            .setMaxValues(1);
          return await interaction.reply({ content: '📋 **View Warnings**: Select the member to inspect:', components: [new ActionRowBuilder().addComponents(userSelect)], ephemeral: true });
        }

        if (action === 'mod_purge') {
          const modal = new ModalBuilder()
            .setCustomId('admin_modal_purge')
            .setTitle('Purge Messages');

          const countInput = new TextInputBuilder()
            .setCustomId('purge_count')
            .setLabel('Number of Messages (1 - 100)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('10')
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(countInput));
          return await interaction.showModal(modal);
        }
      }

      // Server Configuration Actions Select Menu
      if (interaction.customId === 'admin_config_action_select') {
        if (!checkAdminPerms()) return;

        const cfgAction = interaction.values[0];

        if (cfgAction === 'cfg_drop_channel') {
          const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('admin_channel_select_drop')
            .setPlaceholder('📢 Select Drop Channel...')
            .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
            .setMinValues(1)
            .setMaxValues(1);
          const inputBtn = new ButtonBuilder()
            .setCustomId('admin_btn_input_channel_drop')
            .setLabel('Enter Name / Mention / ID')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✏️');
          const createBtn = new ButtonBuilder()
            .setCustomId('admin_btn_create_channel_drop')
            .setLabel('Create New Channel')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕');
          return await interaction.reply({
            content: '📢 **Configure Drop Channel**: Select a text channel below, type any channel name/ID, or create a new channel:',
            components: [
              new ActionRowBuilder().addComponents(channelSelect),
              new ActionRowBuilder().addComponents(inputBtn, createBtn)
            ],
            ephemeral: true
          });
        }

        if (cfgAction === 'cfg_bot_channel') {
          const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('admin_channel_select_bot')
            .setPlaceholder('🤖 Select Bot Command Channel...')
            .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
            .setMinValues(1)
            .setMaxValues(1);
          const inputBtn = new ButtonBuilder()
            .setCustomId('admin_btn_input_channel_bot')
            .setLabel('Enter Name / Mention / ID')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✏️');
          const createBtn = new ButtonBuilder()
            .setCustomId('admin_btn_create_channel_bot')
            .setLabel('Create New Channel')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕');
          return await interaction.reply({
            content: '🤖 **Configure Bot Command Channel**: Select a text channel below, type any channel name/ID, or create a new channel:',
            components: [
              new ActionRowBuilder().addComponents(channelSelect),
              new ActionRowBuilder().addComponents(inputBtn, createBtn)
            ],
            ephemeral: true
          });
        }

        if (cfgAction === 'cfg_log_channel') {
          const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('admin_channel_select_log')
            .setPlaceholder('📜 Select Admin Log Channel...')
            .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
            .setMinValues(1)
            .setMaxValues(1);
          const inputBtn = new ButtonBuilder()
            .setCustomId('admin_btn_input_channel_log')
            .setLabel('Enter Name / Mention / ID')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✏️');
          const createBtn = new ButtonBuilder()
            .setCustomId('admin_btn_create_channel_log')
            .setLabel('Create New Channel')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕');
          return await interaction.reply({
            content: '📜 **Configure Log Channel**: Select a text channel below, type any channel name/ID, or create a new private channel:',
            components: [
              new ActionRowBuilder().addComponents(channelSelect),
              new ActionRowBuilder().addComponents(inputBtn, createBtn)
            ],
            ephemeral: true
          });
        }

        if (cfgAction === 'cfg_create_channel') {
          const btnDrop = new ButtonBuilder()
            .setCustomId('admin_btn_create_channel_drop')
            .setLabel('Create Drop Channel')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📢');
          const btnBot = new ButtonBuilder()
            .setCustomId('admin_btn_create_channel_bot')
            .setLabel('Create Bot Channel')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🤖');
          const btnLog = new ButtonBuilder()
            .setCustomId('admin_btn_create_channel_log')
            .setLabel('Create Log Channel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📜');

          return await interaction.reply({
            content: '➕ **Create New Channel**: Choose which type of dedicated channel you want to create:',
            components: [new ActionRowBuilder().addComponents(btnDrop, btnBot, btnLog)],
            ephemeral: true
          });
        }

        if (cfgAction === 'cfg_feature_toggles') {
          const overrides = await getServerFeatureOverrides(interaction.guildId);
          const featureSelect = new StringSelectMenuBuilder()
            .setCustomId('admin_select_feature_toggle')
            .setPlaceholder('🎛️ Choose a Feature to Toggle ON / OFF...')
            .addOptions([
              { label: `Daily Checkin (${overrides.checkin === false ? 'OFF ❌' : 'ON ✅'})`, value: 'checkin' },
              { label: `Casino Games (${overrides.casino === false ? 'OFF ❌' : 'ON ✅'})`, value: 'casino' },
              { label: `Item Shop (${overrides.shop === false ? 'OFF ❌' : 'ON ✅'})`, value: 'shop' },
              { label: `Duels & Combat (${overrides.duels === false ? 'OFF ❌' : 'ON ✅'})`, value: 'duels' },
              { label: `Robbery (${overrides.rob === false ? 'OFF ❌' : 'ON ✅'})`, value: 'rob' },
              { label: `Coin Drops (${overrides.drops === false ? 'OFF ❌' : 'ON ✅'})`, value: 'drops' },
              { label: `Transfers & Gifts (${overrides.transfers === false ? 'OFF ❌' : 'ON ✅'})`, value: 'transfers' }
            ]);
          return await interaction.reply({ content: '🎛️ **Server Feature Overrides**: Select a feature to flip its status for this server:', components: [new ActionRowBuilder().addComponents(featureSelect)], ephemeral: true });
        }

        if (cfgAction === 'cfg_vault_tax') {
          const modal = new ModalBuilder()
            .setCustomId('admin_modal_vault_tax')
            .setTitle('Vault Custom Tax Rate');

          const taxInput = new TextInputBuilder()
            .setCustomId('tax_rate_input')
            .setLabel('Custom Tax Rate % (0.0 to 20.0 or "default")')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1.5')
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(taxInput));
          return await interaction.showModal(modal);
        }
      }

      // Feature Toggle Handling
      if (interaction.customId === 'admin_select_feature_toggle') {
        if (!checkAdminPerms()) return;
        await interaction.deferReply({ ephemeral: true });

        const featureKey = interaction.values[0];
        const overrides = await getServerFeatureOverrides(interaction.guildId);
        const currentVal = overrides[featureKey] !== false;
        const newVal = !currentVal;

        await setServerFeatureOverride(interaction.guildId, featureKey, newVal);
        await sendModLog(interaction.guild, '🎛️ Feature Toggle Changed', `**Feature:** \`${featureKey}\`\n**Status:** ${newVal ? 'ENABLED ✅' : 'DISABLED ❌'}\n**Moderator:** <@${interaction.user.id}>`, '#c084fc');

        return await interaction.editReply({ content: `✅ Feature **${featureKey}** is now **${newVal ? 'ENABLED' : 'DISABLED'}** for this server.` });
      }

      // Timeout Duration Selection
      if (interaction.customId.startsWith('admin_timeout_duration_')) {
        if (!checkAdminPerms()) return;
        const targetId = interaction.customId.replace('admin_timeout_duration_', '');
        const durationMs = interaction.values[0];

        const modal = new ModalBuilder()
          .setCustomId(`admin_modal_timeout_${targetId}_${durationMs}`)
          .setTitle('Timeout Reason');

        const reasonInput = new TextInputBuilder()
          .setCustomId('mod_reason')
          .setLabel('Reason for Timeout')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Violation of server rules...')
          .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        return await interaction.showModal(modal);
      }
    }

    // =========================================================================
    // 3. CHANNEL SELECT MENU INTERACTIONS
    // =========================================================================
    if (interaction.isChannelSelectMenu()) {
      if (!checkAdminPerms()) return;
      await interaction.deferReply({ ephemeral: true });

      const selectedChannelId = interaction.values[0];

      if (interaction.customId === 'admin_channel_select_drop') {
        await updateDropChannel(interaction.guildId, selectedChannelId);
        await sendModLog(interaction.guild, '📢 Drop Channel Configured', `**New Drop Channel:** <#${selectedChannelId}>\n**Moderator:** <@${interaction.user.id}>`, '#00ffaa');
        return await interaction.editReply({ content: `📢 **Drop Channel updated** to <#${selectedChannelId}>!` });
      }

      if (interaction.customId === 'admin_channel_select_bot') {
        await updateServerChannels(interaction.guildId, selectedChannelId, null);
        await sendModLog(interaction.guild, '🤖 Bot Channel Configured', `**New Bot Command Channel:** <#${selectedChannelId}>\n**Moderator:** <@${interaction.user.id}>`, '#00ffaa');
        return await interaction.editReply({ content: `🤖 **Bot Command Channel updated** to <#${selectedChannelId}>!` });
      }

      if (interaction.customId === 'admin_channel_select_log') {
        await updateServerChannels(interaction.guildId, null, selectedChannelId);
        await sendModLog(interaction.guild, '📜 Log Channel Configured', `**New Log Channel:** <#${selectedChannelId}>\n**Moderator:** <@${interaction.user.id}>`, '#00ffaa');
        return await interaction.editReply({ content: `📜 **Log Channel updated** to <#${selectedChannelId}>!` });
      }
    }

    // =========================================================================
    // 4. USER SELECT MENU INTERACTIONS
    // =========================================================================
    if (interaction.isUserSelectMenu()) {
      if (!checkAdminPerms()) return;

      const targetId = interaction.values[0];

      if (interaction.customId === 'admin_user_select_kick') {
        const modal = new ModalBuilder()
          .setCustomId(`admin_modal_kick_${targetId}`)
          .setTitle('Kick Member');

        const reasonInput = new TextInputBuilder()
          .setCustomId('mod_reason')
          .setLabel('Reason for Kick')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Enter reason...')
          .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        return await interaction.showModal(modal);
      }

      if (interaction.customId === 'admin_user_select_ban') {
        const modal = new ModalBuilder()
          .setCustomId(`admin_modal_ban_${targetId}`)
          .setTitle('Ban Member');

        const reasonInput = new TextInputBuilder()
          .setCustomId('mod_reason')
          .setLabel('Reason for Ban')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Enter reason...')
          .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        return await interaction.showModal(modal);
      }

      if (interaction.customId === 'admin_user_select_timeout') {
        const durationSelect = new StringSelectMenuBuilder()
          .setCustomId(`admin_timeout_duration_${targetId}`)
          .setPlaceholder('⏱️ Select Timeout Duration...')
          .addOptions([
            { label: '60 Seconds (1 min)', value: '60000' },
            { label: '5 Minutes', value: '300000' },
            { label: '10 Minutes', value: '600000' },
            { label: '1 Hour', value: '3600000' },
            { label: '24 Hours (1 Day)', value: '86400000' },
            { label: '1 Week (7 Days)', value: '604800000' }
          ]);

        return await interaction.reply({
          content: `⏱️ Select timeout duration for <@${targetId}>:`,
          components: [new ActionRowBuilder().addComponents(durationSelect)],
          ephemeral: true
        });
      }

      if (interaction.customId === 'admin_user_select_untimeout') {
        await interaction.deferReply({ ephemeral: true });
        try {
          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (!member) return await interaction.editReply({ content: '❌ Member not found in server.' });

          await member.timeout(null, `Untimeout by ${interaction.user.tag}`);
          await sendModLog(interaction.guild, '🔊 Timeout Removed (Unmuted)', `**Member:** <@${targetId}>\n**Moderator:** <@${interaction.user.id}>`, '#00ffaa');
          return await interaction.editReply({ content: `✅ **Timeout Removed** for <@${targetId}>!` });
        } catch (err) {
          return await interaction.editReply({ content: `❌ Failed to remove timeout: ${err.message}` });
        }
      }

      if (interaction.customId === 'admin_user_select_warn') {
        const modal = new ModalBuilder()
          .setCustomId(`admin_modal_warn_${targetId}`)
          .setTitle('Warn Member');

        const reasonInput = new TextInputBuilder()
          .setCustomId('mod_reason')
          .setLabel('Reason for Warning')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Spamming, inappropriate content...')
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        return await interaction.showModal(modal);
      }

      if (interaction.customId === 'admin_user_select_view_warns') {
        await interaction.deferReply({ ephemeral: true });
        const warnings = await getUserWarnings(interaction.guildId, targetId);
        const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);

        const embed = new EmbedBuilder()
          .setColor('#c084fc')
          .setTitle(`📋 Warning History — ${targetUser ? targetUser.tag : targetId}`)
          .setThumbnail(targetUser ? targetUser.displayAvatarURL({ dynamic: true }) : null)
          .setDescription(`Total Warnings: **${warnings.length}**`)
          .setTimestamp();

        if (warnings.length === 0) {
          embed.addFields({ name: 'Status', value: 'Clean record (0 warnings).' });
        } else {
          warnings.slice(0, 10).forEach((w, idx) => {
            const dateStr = new Date(w.created_at).toLocaleString();
            embed.addFields({
              name: `#${idx + 1} — ${dateStr}`,
              value: `**Reason:** ${w.reason}\n**Moderator:** <@${w.moderator_id}>`
            });
          });
        }

        const components = [];
        if (warnings.length > 0) {
          const clearBtn = new ButtonBuilder()
            .setCustomId(`admin_clear_warns_${targetId}`)
            .setLabel('Clear All Warnings')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🧹');
          components.push(new ActionRowBuilder().addComponents(clearBtn));
        }

        return await interaction.editReply({ embeds: [embed], components });
      }
    }

    // =========================================================================
    // 5. MODAL SUBMISSIONS
    // =========================================================================
    if (interaction.isModalSubmit()) {

      // Modal Manual Input Channel (drop, bot, log)
      if (interaction.customId.startsWith('admin_modal_input_channel_')) {
        if (!checkAdminPerms()) return;
        const channelType = interaction.customId.replace('admin_modal_input_channel_', '');
        const query = interaction.fields.getTextInputValue('channel_query').trim();

        await interaction.deferReply({ ephemeral: true });

        try {
          const guild = interaction.guild;
          let targetChannel = null;

          // 1. Check if input is channel mention e.g. <#123456789> or raw ID digits
          const mentionMatch = query.match(/^<#(\d+)>$/);
          const rawId = mentionMatch ? mentionMatch[1] : (!isNaN(query) ? query : null);

          if (rawId) {
            targetChannel = guild.channels.cache.get(rawId) || await guild.channels.fetch(rawId).catch(() => null);
          }

          // 2. If not found by ID, search by channel name case-insensitive across ALL guild channels
          if (!targetChannel) {
            const allChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
            targetChannel = allChannels.find(
              c => c && c.isTextBased() && c.name.toLowerCase() === query.toLowerCase().replace(/^#/, '')
            );
          }

          if (!targetChannel || !targetChannel.isTextBased()) {
            return await interaction.editReply({
              content: `❌ **Channel Not Found**: Could not find a text channel matching \`${query}\` in this server.\n\n*Tip: Please check the channel name or paste the exact Channel ID (Right-click channel ➔ Copy Channel ID).*`
            });
          }

          // Update database settings
          if (channelType === 'drop') {
            await updateDropChannel(interaction.guildId, targetChannel.id);
          } else if (channelType === 'bot') {
            await updateServerChannels(interaction.guildId, targetChannel.id, null);
          } else if (channelType === 'log') {
            await updateServerChannels(interaction.guildId, null, targetChannel.id);
          }

          await sendModLog(guild, '⚙️ Channel Configured via Name/ID Input', `**Type:** \`${channelType.toUpperCase()}\`\n**Channel:** <#${targetChannel.id}>\n**Moderator:** <@${interaction.user.id}>`, '#00ffaa');
          return await interaction.editReply({ content: `✅ **Active ${channelType.toUpperCase()} Channel updated** to <#${targetChannel.id}>!` });
        } catch (err) {
          return await interaction.editReply({ content: `❌ Error setting channel: ${err.message}` });
        }
      }

      // Modal Create New Channel (drop, bot, log)
      if (interaction.customId.startsWith('admin_modal_create_channel_')) {
        if (!checkAdminPerms()) return;
        const channelType = interaction.customId.replace('admin_modal_create_channel_', '');
        const rawName = interaction.fields.getTextInputValue('new_channel_name').trim();
        const cleanName = rawName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

        await interaction.deferReply({ ephemeral: true });

        try {
          const guild = interaction.guild;
          const botMember = guild.members.me || await guild.members.fetch(interaction.client.user.id).catch(() => null);
          if (botMember && !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return await interaction.editReply({ content: '❌ **Bot Permission Error**: The bot needs **Manage Channels** permission to create a new channel.' });
          }

          // Find or create category
          const currentChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
          let category = currentChannels.find(c => c.name.toLowerCase() === 'soul' && c.type === ChannelType.GuildCategory);
          if (!category) {
            category = await guild.channels.create({ name: 'Soul', type: ChannelType.GuildCategory });
          }

          const options = {
            name: cleanName || `soul-${channelType}`,
            type: ChannelType.GuildText,
            parent: category.id
          };

          if (channelType === 'log') {
            options.permissionOverwrites = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
          }

          const newChannel = await guild.channels.create(options);

          // Update database settings
          if (channelType === 'drop') {
            await updateDropChannel(interaction.guildId, newChannel.id);
          } else if (channelType === 'bot') {
            await updateServerChannels(interaction.guildId, newChannel.id, null);
          } else if (channelType === 'log') {
            await updateServerChannels(interaction.guildId, null, newChannel.id);
          }

          await sendModLog(guild, '➕ New Channel Created & Configured', `**Type:** \`${channelType.toUpperCase()}\`\n**Channel:** <#${newChannel.id}>\n**Moderator:** <@${interaction.user.id}>`, '#00ffaa');
          return await interaction.editReply({ content: `✅ **Channel Created!** <#${newChannel.id}> has been created and set as your active **${channelType.toUpperCase()}** channel!` });
        } catch (err) {
          return await interaction.editReply({ content: `❌ Failed to create channel: ${err.message}` });
        }
      }

      // Vault Refuel Modal
      if (interaction.customId === 'refuel_vault_modal') {
        const amountStr = interaction.fields.getTextInputValue('refuel_amount');
        const amount = parseInt(amountStr.replace(/,/g, ''), 10);
        if (isNaN(amount) || amount < 20000) {
          return await interaction.reply({ content: '❌ Invalid amount. You must deposit at least 20,000 Souls.', ephemeral: true });
        }
        try {
          const { refuelServerVault } = require('../database/queries');
          const result = await refuelServerVault(interaction.user.id, interaction.guildId, amount);

          if (!result.success) {
            if (result.reason === 'insufficient_funds') {
              return await interaction.reply({ content: `❌ You do not have enough Souls. Your balance: **${result.userBalance}** Souls.`, ephemeral: true });
            }
            return await interaction.reply({ content: '❌ Failed to refuel the vault. Please try again later.', ephemeral: true });
          }

          return await interaction.reply({ content: `⛽ **Vault Refueled!** Successfully deposited **${amount}** Souls into the Soul Vault.\nNew Vault Balance: **${result.newVaultBalance}** Souls.`, ephemeral: false });
        } catch (err) {
          return await interaction.reply({ content: '❌ Error: ' + err.message, ephemeral: true });
        }
      }

      // Vault Custom Tax Rate Modal
      if (interaction.customId === 'admin_modal_vault_tax') {
        if (!checkAdminPerms()) return;
        const valStr = interaction.fields.getTextInputValue('tax_rate_input').trim().toLowerCase();
        await interaction.deferReply({ ephemeral: true });

        let newRate = null;
        if (valStr !== 'default') {
          newRate = parseFloat(valStr);
          if (isNaN(newRate) || newRate < 0 || newRate > 20) {
            return await interaction.editReply({ content: '❌ Invalid tax rate. Must be between 0.0% and 20.0%, or "default".' });
          }
        }

        await updateServerVaultCustomTaxRate(interaction.guildId, newRate);
        await sendModLog(interaction.guild, '⛽ Custom Vault Tax Rate Updated', `**New Rate:** ${newRate === null ? 'Default (Fluctuating 0.5% - 2.0%)' : `${newRate}%`}\n**Moderator:** <@${interaction.user.id}>`, '#c084fc');
        return await interaction.editReply({ content: `⛽ Custom Vault Tax Rate updated to: **${newRate === null ? 'Default (Fluctuating)' : `${newRate}%`}**.` });
      }

      // Modal Kick
      if (interaction.customId.startsWith('admin_modal_kick_')) {
        if (!checkAdminPerms()) return;
        const targetId = interaction.customId.replace('admin_modal_kick_', '');
        const reason = interaction.fields.getTextInputValue('mod_reason') || 'No reason provided';

        await interaction.deferReply({ ephemeral: true });
        try {
          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (!member) return await interaction.editReply({ content: '❌ Member not found in server.' });

          if (!member.kickable) {
            return await interaction.editReply({ content: '❌ **Cannot Kick**: Bot has insufficient permission hierarchy over this user.' });
          }

          await member.send(`boot You have been **kicked** from **${interaction.guild.name}**.\n**Reason:** ${reason}`).catch(() => {});
          await member.kick(reason);

          await sendModLog(interaction.guild, '👢 Member Kicked', `**Target:** <@${targetId}>\n**Moderator:** <@${interaction.user.id}>\n**Reason:** ${reason}`, '#ffaa00');
          return await interaction.editReply({ content: `✅ **Kicked** <@${targetId}> successfully!\n**Reason:** ${reason}` });
        } catch (err) {
          return await interaction.editReply({ content: `❌ Kick error: ${err.message}` });
        }
      }

      // Modal Ban
      if (interaction.customId.startsWith('admin_modal_ban_')) {
        if (!checkAdminPerms()) return;
        const targetId = interaction.customId.replace('admin_modal_ban_', '');
        const reason = interaction.fields.getTextInputValue('mod_reason') || 'No reason provided';

        await interaction.deferReply({ ephemeral: true });
        try {
          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (member) {
            await member.send(`🚫 You have been **banned** from **${interaction.guild.name}**.\n**Reason:** ${reason}`).catch(() => {});
          }

          await interaction.guild.members.ban(targetId, { reason });
          await sendModLog(interaction.guild, '🚫 Member Banned', `**Target:** <@${targetId}>\n**Moderator:** <@${interaction.user.id}>\n**Reason:** ${reason}`, '#ff3366');
          return await interaction.editReply({ content: `✅ **Banned** <@${targetId}> successfully!\n**Reason:** ${reason}` });
        } catch (err) {
          return await interaction.editReply({ content: `❌ Ban error: ${err.message}` });
        }
      }

      // Modal Timeout
      if (interaction.customId.startsWith('admin_modal_timeout_')) {
        if (!checkAdminPerms()) return;
        const parts = interaction.customId.split('_');
        const targetId = parts[3];
        const durationMs = parseInt(parts[4], 10);
        const reason = interaction.fields.getTextInputValue('mod_reason') || 'No reason provided';

        await interaction.deferReply({ ephemeral: true });
        try {
          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (!member) return await interaction.editReply({ content: '❌ Member not found.' });

          if (!member.moderatable) {
            return await interaction.editReply({ content: '❌ **Cannot Timeout**: Bot has insufficient permission hierarchy over this user.' });
          }

          await member.timeout(durationMs, reason);
          await member.send(`🔇 You have been placed on **timeout** in **${interaction.guild.name}** for **${Math.round(durationMs / 60000)} mins**.\n**Reason:** ${reason}`).catch(() => {});

          await sendModLog(interaction.guild, '🔇 Member Timed Out', `**Target:** <@${targetId}>\n**Duration:** ${Math.round(durationMs / 60000)} mins\n**Moderator:** <@${interaction.user.id}>\n**Reason:** ${reason}`, '#ffaa00');
          return await interaction.editReply({ content: `✅ Timed out <@${targetId}> for **${Math.round(durationMs / 60000)} mins**.\n**Reason:** ${reason}` });
        } catch (err) {
          return await interaction.editReply({ content: `❌ Timeout error: ${err.message}` });
        }
      }

      // Modal Warn
      if (interaction.customId.startsWith('admin_modal_warn_')) {
        if (!checkAdminPerms()) return;
        const targetId = interaction.customId.replace('admin_modal_warn_', '');
        const reason = interaction.fields.getTextInputValue('mod_reason');

        await interaction.deferReply({ ephemeral: true });
        try {
          await addWarning(interaction.guildId, targetId, interaction.user.id, reason);
          const warnings = await getUserWarnings(interaction.guildId, targetId);

          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (member) {
            await member.send(`⚠️ You received a formal **warning** in **${interaction.guild.name}**.\n**Reason:** ${reason}\n**Total Warnings:** ${warnings.length}`).catch(() => {});
          }

          await sendModLog(interaction.guild, '⚠️ Warning Issued', `**Target:** <@${targetId}>\n**Moderator:** <@${interaction.user.id}>\n**Reason:** ${reason}\n**Total Warnings:** ${warnings.length}`, '#fbbf24');
          return await interaction.editReply({ content: `⚠️ **Warning issued** to <@${targetId}>!\n**Reason:** ${reason}\n**Total User Warnings:** ${warnings.length}` });
        } catch (err) {
          return await interaction.editReply({ content: `❌ Warn error: ${err.message}` });
        }
      }

      // Modal Purge
      if (interaction.customId === 'admin_modal_purge') {
        if (!checkAdminPerms()) return;
        const countStr = interaction.fields.getTextInputValue('purge_count');
        const count = parseInt(countStr, 10);

        if (isNaN(count) || count < 1 || count > 100) {
          return await interaction.reply({ content: '❌ Invalid count. Must be between 1 and 100.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        try {
          const deleted = await interaction.channel.bulkDelete(count, true);
          await sendModLog(interaction.guild, '🧹 Messages Purged', `**Channel:** <#${interaction.channelId}>\n**Deleted Messages:** ${deleted.size}\n**Moderator:** <@${interaction.user.id}>`, '#00ffaa');
          return await interaction.editReply({ content: `🧹 Successfully purged **${deleted.size}** messages in <#${interaction.channelId}>!` });
        } catch (err) {
          return await interaction.editReply({ content: `❌ Purge error: ${err.message}` });
        }
      }
    }

    // =========================================================================
    // 6. SLASH COMMAND EXECUTOR
    // =========================================================================
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    const { getBotControlState, getFeatureForSlashCommand } = require('../utils/botControl');
    const { logRequest } = require('../utils/requestLogger');
    const cmdStr = `/${interaction.commandName}` + (interaction.options.getSubcommand(false) ? ` ${interaction.options.getSubcommand()}` : '');

    try {
      const control = await getBotControlState(interaction.guildId);
      const isAdminCommand = interaction.commandName === 'admin';

      if (control.maintenanceMode && !isAdminCommand) {
        logRequest({ username: interaction.user.tag, command: cmdStr, fulfilled: false, error: 'Maintenance Mode' });
        return interaction.reply({ content: control.maintenanceMessage, ephemeral: true });
      }

      // Server Vault Fuel Check (block commands if balance < 20,000)
      const { getTreasury } = require('../database/queries');
      const treasury = await getTreasury(interaction.guildId);
      const isFuelLow = treasury && treasury.balance < 20000;

      if (isFuelLow && !isAdminCommand) {
        const isOwner = interaction.user.id === interaction.guild.ownerId;
        const components = [];
        if (isOwner) {
          components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('refuel_vault_btn').setLabel('Refuel Vault').setStyle(ButtonStyle.Primary).setEmoji('⛽')
          ));
        }

        logRequest({ username: interaction.user.tag, command: cmdStr, fulfilled: false, error: 'Insufficient Vault Fuel' });
        return await interaction.reply({
          content: `❌ **Insufficient Vault Balance**: Vault is out of fuel (Balance: **${treasury.balance}** Souls, Minimum: **20,000**).${isOwner ? '\nRefuel using button below.' : ''}`,
          components: components,
          ephemeral: true
        });
      }

      if (!isAdminCommand) {
        const feature = getFeatureForSlashCommand(interaction.commandName);
        if (feature && !control.features[feature]) {
          logRequest({ username: interaction.user.tag, command: cmdStr, fulfilled: false, error: 'Feature Disabled' });
          return interaction.reply({ content: `❌ **${interaction.commandName}** is temporarily disabled by bot owner.`, ephemeral: true });
        }
      }

      await command.execute(interaction);
      logRequest({ username: interaction.user.tag, command: cmdStr, fulfilled: true });
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);
      logRequest({ username: interaction.user.tag, command: cmdStr, fulfilled: false, error: error.message || 'Execution Error' });

      const errorMessage = { content: 'There was an error while executing this command!', ephemeral: true };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch (err) {
        console.error('Failed to send error fallback response:', err);
      }
    }
  }
};
