const { ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'guildCreate',
  once: false,
  async execute(guild) {
    console.log(`Joined a new server: ${guild.name} (${guild.id})`);

    // Verify if the bot has permissions to manage channels
    const botMember = guild.members.me || await guild.members.fetch(guild.client.user.id).catch(() => null);
    
    if (botMember && !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
      console.warn(`[Onboarding] Missing "Manage Channels" permission in guild ${guild.name}. Cannot create setup channels.`);
      return;
    }

    const channelsToCreate = [
      { 
        name: 'soul-bot', 
        topic: 'Command usage (/checkin, /balance, /leaderboard, /casino) and active chat milestone rewards.',
        private: false 
      },
      { 
        name: 'admin-logs', 
        topic: 'Administrative logs and configuration settings for the Soul Currency system.',
        private: true 
      }
    ];

    try {
      // 1. Fetch all channels in the guild
      const currentChannels = await guild.channels.fetch().catch(() => guild.channels.cache);

      // 2. Find or create the "Soul" category dropdown
      let category = currentChannels.find(
        c => c.name.toLowerCase() === 'soul' && c.type === ChannelType.GuildCategory
      );

      if (!category) {
        console.log(`[Onboarding] Creating category "Soul" in server: ${guild.name}`);
        category = await guild.channels.create({
          name: 'Soul',
          type: ChannelType.GuildCategory
        });
      } else {
        console.log(`[Onboarding] Category "Soul" already exists in server: ${guild.name}.`);
      }

      // Refresh channels list to include newly created category if necessary
      const updatedChannels = await guild.channels.fetch().catch(() => guild.channels.cache);

      // 3. Create channels inside the category
      for (const ch of channelsToCreate) {
        const nameChecked = ch.name.toLowerCase();
        
        // Check if the channel already exists in the guild (text channel matching the name)
        const exists = updatedChannels.find(
          c => c.name.toLowerCase() === nameChecked && c.type === ChannelType.GuildText
        );

        if (!exists) {
          console.log(`[Onboarding] Creating #${ch.name} inside "Soul" in server: ${guild.name}`);
          
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
        } else {
          console.log(`[Onboarding] Channel #${ch.name} already exists in server: ${guild.name}. Skipping.`);
        }
      }
    } catch (error) {
      console.error(`[Onboarding Error] Failed to create setup channels in server ${guild.name}:`, error);
    }
  }
};
