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
      { name: '💵-soul-bots', topic: 'Claim daily souls here with /checkin' },
      { name: '💵-soul-currency-logs', topic: 'Chat activity milestone log announcements' },
      { name: '💵-soul-leaderboard', topic: 'Check current active rankings here with /leaderboard' },
      { name: '💵-soul-casino', topic: 'Play coin flips with /casino flip' }
    ];

    try {
      // 1. Fetch all channels in the guild
      const currentChannels = await guild.channels.fetch().catch(() => guild.channels.cache);

      // 2. Find or create the "Soul Currency" category dropdown
      let category = currentChannels.find(
        c => c.name.toLowerCase() === 'soul currency' && c.type === ChannelType.GuildCategory
      );

      if (!category) {
        console.log(`[Onboarding] Creating category "Soul Currency" in server: ${guild.name}`);
        category = await guild.channels.create({
          name: 'Soul Currency',
          type: ChannelType.GuildCategory
        });
      } else {
        console.log(`[Onboarding] Category "Soul Currency" already exists in server: ${guild.name}.`);
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
          console.log(`[Onboarding] Creating #${ch.name} inside "Soul Currency" in server: ${guild.name}`);
          await guild.channels.create({
            name: ch.name,
            type: ChannelType.GuildText,
            topic: ch.topic,
            parent: category.id
          });
        } else {
          console.log(`[Onboarding] Channel #${ch.name} already exists in server: ${guild.name}. Skipping.`);
        }
      }
    } catch (error) {
      console.error(`[Onboarding Error] Failed to create setup channels in server ${guild.name}:`, error);
    }
  }
};
