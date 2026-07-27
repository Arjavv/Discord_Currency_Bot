const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
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
  updateServerChannels
} = require('../database/queries');

const { buildAdminPanelPayload, sendModLog } = require('../utils/moderation');
const { triggerDrop, scheduleNextDrop, nextDropTimers } = require('../utils/drops');

module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction) {

    // Helper to check Administrator permissions for moderation actions
    const checkAdminPerms = () => {
      if (!interaction.member || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        interaction.reply({
          content: '❌ **Access Denied**: You must have Administrator permissions to perform moderation actions.',
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

        const row = new ActionRowBuilder().addComponents(amountInput);
        modal.addComponents(row);

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

      // Admin Quick Force Drop Button
      if (interaction.customId === 'admin_quick_forcedrop') {
        if (!checkAdminPerms()) return;
        await interaction.deferReply({ ephemeral: true });

        try {
          const settings = await getServerSettings(interaction.guildId);
          let dropChannel = null;
          if (settings.drop_channel_id) {
            dropChannel = interaction.guild.channels.cache.get(settings.drop_channel_id) ||
                          await interaction.guild.channels.fetch(settings.drop_channel_id).catch(() => null);
          } else {
            dropChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === 'general' && c.isTextBased());
          }

          if (!dropChannel) {
            return await interaction.editReply({ content: '❌ **Drop channel not found!** Please set a drop channel using `/admin set-drop-channel`.' });
          }

          const res = await triggerDrop(interaction.client, interaction.guildId, dropChannel);
          if (res) {
            await sendModLog(interaction.guild, '📦 Manual Force Drop Triggered', `Moderator <@${interaction.user.id}> triggered a manual coin drop in <#${dropChannel.id}>.`, '#ffa500');
            return await interaction.editReply({ content: `📦 **Coin Drop Spawned** in <#${dropChannel.id}>!` });
          } else {
            return await interaction.editReply({ content: '❌ Failed to spawn drop. Check vault fuel or drop cooldowns.' });
          }
        } catch (err) {
          return await interaction.editReply({ content: `❌ Force drop error: ${err.message}` });
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
    }

    // =========================================================================
    // 2. STRING SELECT MENU INTERACTIONS
    // =========================================================================
    if (interaction.isStringSelectMenu()) {

      // Main Admin Moderation Action Select Menu
      if (interaction.customId === 'admin_mod_action_select') {
        if (!checkAdminPerms()) return;

        const action = interaction.values[0];

        if (action === 'mod_kick') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_kick')
            .setPlaceholder('🔨 Select a member to kick...')
            .setMinValues(1)
            .setMaxValues(1);
          const row = new ActionRowBuilder().addComponents(userSelect);
          return await interaction.reply({ content: '🔨 **Kick Member**: Select the member you wish to kick:', components: [row], ephemeral: true });
        }

        if (action === 'mod_ban') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_ban')
            .setPlaceholder('🚫 Select a member to ban...')
            .setMinValues(1)
            .setMaxValues(1);
          const row = new ActionRowBuilder().addComponents(userSelect);
          return await interaction.reply({ content: '🚫 **Ban Member**: Select the member you wish to ban:', components: [row], ephemeral: true });
        }

        if (action === 'mod_timeout') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_timeout')
            .setPlaceholder('🔇 Select a member to mute / timeout...')
            .setMinValues(1)
            .setMaxValues(1);
          const row = new ActionRowBuilder().addComponents(userSelect);
          return await interaction.reply({ content: '🔇 **Timeout Member**: Select the member you wish to timeout:', components: [row], ephemeral: true });
        }

        if (action === 'mod_untimeout') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_untimeout')
            .setPlaceholder('🔊 Select a member to remove timeout...')
            .setMinValues(1)
            .setMaxValues(1);
          const row = new ActionRowBuilder().addComponents(userSelect);
          return await interaction.reply({ content: '🔊 **Remove Timeout**: Select the member to unmute:', components: [row], ephemeral: true });
        }

        if (action === 'mod_warn') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_warn')
            .setPlaceholder('⚠️ Select a member to warn...')
            .setMinValues(1)
            .setMaxValues(1);
          const row = new ActionRowBuilder().addComponents(userSelect);
          return await interaction.reply({ content: '⚠️ **Warn Member**: Select the member you wish to issue a warning to:', components: [row], ephemeral: true });
        }

        if (action === 'mod_view_warns') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId('admin_user_select_view_warns')
            .setPlaceholder('📋 Select a member to view warnings...')
            .setMinValues(1)
            .setMaxValues(1);
          const row = new ActionRowBuilder().addComponents(userSelect);
          return await interaction.reply({ content: '📋 **View Warnings**: Select the member to inspect:', components: [row], ephemeral: true });
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
    // 3. USER SELECT MENU INTERACTIONS
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

        const row = new ActionRowBuilder().addComponents(durationSelect);
        return await interaction.reply({
          content: `⏱️ Select timeout duration for <@${targetId}>:`,
          components: [row],
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
          .setColor('#ffaa00')
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
    // 4. MODAL SUBMISSIONS
    // =========================================================================
    if (interaction.isModalSubmit()) {

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

          await member.send(`👢 You have been **kicked** from **${interaction.guild.name}**.\n**Reason:** ${reason}`).catch(() => {});
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
    // 5. SLASH COMMAND EXECUTOR
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
