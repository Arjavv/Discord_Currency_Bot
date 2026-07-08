const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { updateServerSetting, getServerSettings, updateDropChannel, toggleAutoDrops } = require('../database/queries');
const { triggerDrop, nextDropTimers, scheduleNextDrop } = require('../utils/drops');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Administration commands for the currency system')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Restricts visibility to server admins by default
    .addSubcommand(subcommand =>
      subcommand
        .setName('setup')
        .setDescription('Create the Soul Currency channels and category in this server')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-drop-channel')
        .setDescription('Set the channel where random coin drops will occur')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Select the text channel for Soul Drops (defaults to current channel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('force-drop')
        .setDescription('Force a soul coin drop to happen immediately in the general channel')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('auto-drops')
        .setDescription('Start or stop the continuous 10-minute auto drop cycle in the drop channel')
        .addStringOption(option =>
          option.setName('action')
            .setDescription('Choose whether to start or stop the cycle')
            .setRequired(true)
            .addChoices(
              { name: 'Start', value: 'start' },
              { name: 'Stop', value: 'stop' }
            )
        )
    ),

  async execute(interaction) {
    // Secondary check: double-check permission just in case discord API settings override client-side defaults
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.reply({
        content: '❌ You must have Administrator permissions to run admin subcommands.',
        ephemeral: true
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const serverId = interaction.guildId;

    // Restrict to #soul-logs: currently no subcommands require soul-logs (reset-cycle removed)
    // setup, set-drop-channel, auto-drops, and force-drop can all be run anywhere

    await interaction.deferReply();

    try {
      if (subcommand === 'setup') {
        const guild = interaction.guild;

        // Check if the bot has permission to manage channels
        const botMember = guild.members.me || await guild.members.fetch(interaction.client.user.id).catch(() => null);
        if (botMember && !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return await interaction.editReply({
            content: '❌ **Setup Failed**: The bot is missing the **Manage Channels** permission in this server. Please grant this permission to the bot or its role in Server Settings and try running the command again.'
          });
        }

        const channelsToCreate = [
          { 
            name: 'soul-bot', 
            topic: 'Command usage (/checkin, /balance, /leaderboard, /casino) and active chat milestone rewards.',
            private: false 
          },
          { 
            name: 'soul-logs', 
            topic: 'Administrative logs and configuration settings for the Soul Currency system.',
            private: true 
          }
        ];

        const currentChannels = await guild.channels.fetch().catch(() => guild.channels.cache);

        // Find or create category
        let category = currentChannels.find(
          c => c.name.toLowerCase() === 'soul' && c.type === ChannelType.GuildCategory
        );

        if (!category) {
          category = await guild.channels.create({
            name: 'Soul',
            type: ChannelType.GuildCategory
          });
        }

        const updatedChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
        const created = [];
        const skipped = [];

        for (const ch of channelsToCreate) {
          const exists = updatedChannels.find(
            c => c.name.toLowerCase() === ch.name.toLowerCase() && c.type === ChannelType.GuildText
          );
          if (!exists) {
            const options = {
              name: ch.name,
              type: ChannelType.GuildText,
              topic: ch.topic,
              parent: category.id
            };

            // If the channel is private, deny ViewChannel for everyone
            if (ch.private) {
              options.permissionOverwrites = [
                {
                  id: guild.roles.everyone.id,
                  deny: [PermissionFlagsBits.ViewChannel]
                }
              ];
            }

            await guild.channels.create(options);
            created.push(`#${ch.name}`);
          } else {
            skipped.push(`#${ch.name}`);
          }
        }

        const embed = new EmbedBuilder()
          .setColor('#00ffaa')
          .setTitle('✅ Server Setup Complete')
          .setDescription('Soul Currency channels have been configured!')
          .addFields(
            { name: 'Created', value: created.length > 0 ? created.join('\n') : 'None (all existed)', inline: true },
            { name: 'Skipped', value: skipped.length > 0 ? skipped.join('\n') : 'None', inline: true }
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === 'set-drop-channel' || subcommand === 'set-general-channel') {
        const channelOption = interaction.options.getChannel('channel');
        const targetChannelId = channelOption?.id || interaction.channelId;
        await updateDropChannel(serverId, targetChannelId);

        const embed = new EmbedBuilder()
          .setColor('#00ffaa')
          .setTitle('⚙️ Drop Channel Configured')
          .setDescription(`Random Soul Coin drops will now occur in the channel: <#${targetChannelId}>.`)
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === 'force-drop') {
        const settings = await getServerSettings(serverId);
        let dropChannel = null;

        if (settings.drop_channel_id) {
          dropChannel = interaction.guild.channels.cache.get(settings.drop_channel_id) || 
                        await interaction.guild.channels.fetch(settings.drop_channel_id).catch(() => null);
        } else {
          // Fallback to channel named general
          const currentChannels = await interaction.guild.channels.fetch().catch(() => interaction.guild.channels.cache);
          dropChannel = currentChannels.find(
            c => c.name.toLowerCase() === 'general' && c.type === ChannelType.GuildText
          );
        }

        if (!dropChannel) {
          return await interaction.editReply({
            content: '❌ **Error**: Drop channel not configured or not found. Please set it using `/admin set-drop-channel` or name a channel `#general`.'
          });
        }

        const dropResult = await triggerDrop(interaction.client, serverId, dropChannel);
        if (dropResult) {
          return await interaction.editReply({
            content: `✅ Successfully triggered a random coin drop in ${dropChannel}!`
          });
        } else {
          return await interaction.editReply({
            content: '❌ **Error**: Failed to send drop message. Please check permissions.'
          });
        }
      }
      
      if (subcommand === 'auto-drops') {
        const action = interaction.options.getString('action');
        const settings = await getServerSettings(serverId);

        if (action === 'start') {
          // Enable in database
          await toggleAutoDrops(serverId, true);

          // Find drop channel
          let dropChannel = null;
          if (settings.drop_channel_id) {
            dropChannel = interaction.guild.channels.cache.get(settings.drop_channel_id) || 
                          await interaction.guild.channels.fetch(settings.drop_channel_id).catch(() => null);
          } else {
            const currentChannels = await interaction.guild.channels.fetch().catch(() => interaction.guild.channels.cache);
            dropChannel = currentChannels.find(
              c => c.name.toLowerCase() === 'general' && c.type === ChannelType.GuildText
            );
          }

          if (!dropChannel) {
            return await interaction.editReply({
              content: '❌ **Error**: Drop channel not configured or not found. Please set it using `/admin set-drop-channel`.'
            });
          }

          // Trigger first drop immediately
          await triggerDrop(interaction.client, serverId, dropChannel);

          // Schedule the next drop cycle
          scheduleNextDrop(interaction.client, serverId, dropChannel.id);

          const embed = new EmbedBuilder()
            .setColor('#00ffaa')
            .setTitle('▶️ Auto Drops Started')
            .setDescription(`The 10-minute continuous auto drop cycle has been started for <#${dropChannel.id}>.`)
            .setTimestamp();
          
          return await interaction.editReply({ embeds: [embed] });

        } else if (action === 'stop') {
          // Disable in database
          await toggleAutoDrops(serverId, false);

          // Clear any pending timeout
          if (nextDropTimers.has(serverId)) {
            const timerObj = nextDropTimers.get(serverId);
            if (timerObj && timerObj.timeoutId) {
              clearTimeout(timerObj.timeoutId);
            }
            nextDropTimers.delete(serverId);
          }

          const embed = new EmbedBuilder()
            .setColor('#ff3366')
            .setTitle('⏹️ Auto Drops Stopped')
            .setDescription('The continuous auto drop cycle has been stopped. No more coins will drop automatically.')
            .setTimestamp();
          
          return await interaction.editReply({ embeds: [embed] });
        }
      } else {
        // Fallback for unhandled subcommands
        return await interaction.editReply({
          content: `❌ Unknown subcommand: ${subcommand}`
        });
      }
    } catch (error) {
      console.error(`Error executing admin subcommand ${subcommand} on server ${serverId}:`, error);
      // Send a friendly error message back to the user
      if (interaction.deferred || interaction.replied) {
        return await interaction.editReply({
          content: `❌ An error occurred: ${error.message || 'Unknown error'}. Please check that the bot has all required permissions.`
        }).catch(() => null);
      }
      throw error;
    }
  }
};
