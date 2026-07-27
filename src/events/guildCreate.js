const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder
} = require('discord.js');

const path = require('path');
const fs = require('fs');
const { getServerSettings } = require('../database/queries');

module.exports = {
  name: 'guildCreate',
  once: false,
  async execute(guild) {
    console.log(`🌸 Joined a new server: ${guild.name} (${guild.id})`);

    try {
      // Ensure server settings row exists in DB
      await getServerSettings(guild.id).catch(() => {});

      // Find the best text channel to send the welcome guide
      const botMember = guild.members.me || await guild.members.fetch(guild.client.user.id).catch(() => null);
      if (!botMember) return;

      const channels = await guild.channels.fetch().catch(() => guild.channels.cache);

      let targetChannel = null;

      // 1. System channel if available and sendable
      if (guild.systemChannel && guild.systemChannel.permissionsFor(botMember).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        targetChannel = guild.systemChannel;
      }

      // 2. Look for channels named 'general', 'bot-commands', 'welcome', 'chat', 'main'
      if (!targetChannel) {
        targetChannel = channels.find(c =>
          c && c.isTextBased() &&
          ['general', 'bot-commands', 'welcome', 'chat', 'main', 'soul-bot'].includes(c.name.toLowerCase()) &&
          c.permissionsFor(botMember).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
        );
      }

      // 3. Fallback to any text channel where bot can send messages
      if (!targetChannel) {
        targetChannel = channels.find(c =>
          c && c.isTextBased() &&
          c.type === ChannelType.GuildText &&
          c.permissionsFor(botMember).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
        );
      }

      if (!targetChannel) {
        console.log(`⚠️ Could not find a text channel to send welcome message in ${guild.name}`);
        return;
      }

      // Build Welcome Embed
      const welcomeEmbed = new EmbedBuilder()
        .setColor('#c084fc') // Pastel Lavender
        .setTitle('✨ 🌸 Welcome to Soul Economy & Sanctuary! 💜 ✨')
        .setDescription(
          `Thank you for adding **Soul Bot** to **${guild.name}**! 🐾💜\n` +
          `Soul is an feature-packed economy, character collection, casino, and moderation bot designed for Discord communities.\n\n` +
          `Below is a quick setup guide for Administrators and a breakdown of player commands!`
        )
        .addFields(
          {
            name: '👑 1. How to Setup (Server Administrators)',
            value:
              '• Type **`s admin`** or **`/admin panel`** to open the interactive **Control Sanctuary**.\n' +
              '• Click **`⚙️ Auto-Setup Channels`** to automatically create `#soul-bot` and `#soul-logs` channels.\n' +
              '• Use the **Server Configurations** menu to set or create your **Drop Channel**, **Bot Channel**, or toggle features ON/OFF.',
            inline: false
          },
          {
            name: '🎀 2. Popular Member Commands',
            value:
              '• **`s checkin`** / **`s daily`** — Claim daily Soul rewards & maintain checkin streaks.\n' +
              '• **`s balance`** / **`s bal`** — Inspect your Soul balance & Soul Vault fuel.\n' +
              '• **`s shop`** — Browse the character shop to buy anime/gaming heroes.\n' +
              '• **`s flip <bet>`** / **`s slots`** — Play casino games & earn double Souls!\n' +
              '• **`s duel @user <bet>`** — Challenge server members to 1v1 duels.\n' +
              '• **`s drop`** — Spawn or catch character drops in the drop channel!',
            inline: false
          },
          {
            name: '🔗 3. Share & Support',
            value: '• Use **`s invite`** or **`/invite`** to share the bot with other servers and receive bonus Souls!',
            inline: false
          }
        )
        .setFooter({ text: '✦ Soul Sanctuary Bot • Interactive Guild Setup ✦', iconURL: guild.iconURL({ dynamic: true }) })
        .setTimestamp();

      // Attach banner if present
      const files = [];
      const bannerPath = path.join(__dirname, '..', 'assets', 'admin_banner.png');
      if (fs.existsSync(bannerPath)) {
        files.push(new AttachmentBuilder(bannerPath, { name: 'welcome_banner.png' }));
        welcomeEmbed.setImage('attachment://welcome_banner.png');
      }

      // Action Row Buttons
      const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${guild.client.user.id}&permissions=8&scope=bot%20applications.commands`;

      const btnInvite = new ButtonBuilder()
        .setLabel('Invite Bot to Other Servers')
        .setStyle(ButtonStyle.Link)
        .setURL(inviteUrl)
        .setEmoji('🔗');

      const btnAdminHelp = new ButtonBuilder()
        .setCustomId('welcome_btn_admin_info')
        .setLabel('Admin Command Info')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('👑');

      const btnPlayerHelp = new ButtonBuilder()
        .setCustomId('welcome_btn_player_info')
        .setLabel('Player Commands')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🎀');

      const row = new ActionRowBuilder().addComponents(btnAdminHelp, btnPlayerHelp, btnInvite);

      await targetChannel.send({
        content: `👋 **Hello ${guild.name}!** Soul Economy Bot has arrived!`,
        embeds: [welcomeEmbed],
        components: [row],
        files
      });

      console.log(`✅ Welcome guide sent to #${targetChannel.name} in ${guild.name}`);
    } catch (err) {
      console.error(`Error sending welcome message in guild ${guild.id}:`, err);
    }
  }
};
