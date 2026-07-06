const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');
const {
  recordMessageActivity,
  getServerSettings,
  updateServerSetting,
  checkInUser,
  getUserBalance,
  getLeaderboard,
  resetCycle,
  recordCasinoGame,
  updateDropChannel,
  awardDropCoins,
  transferCoins,
  attemptRob,
  getUserStats,
  getShopPrices,
  setShopPrice,
  getUserInventory,
  purchaseShopItem,
  recordDuelLoss,
  getGlobalSettings
} = require('../database/queries');
const { EmbedBuilder, AttachmentBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

// Track active crash games per user to prevent multiple simultaneous games
const activeCrashGames = new Set();

// Track active mines games per user
const activeMinesGames = new Map();
const path = require('path');
const { activeDrops, triggerDrop, scheduleNextDrop } = require('../utils/drops');
const {
  getBotControlState,
  isAdminPrefixCommand,
  isReadonlyPrefixCommand,
  getFeatureForPrefixCommand,
  getRandomCheckinAmount
} = require('../utils/botControl');

// Helper to send a temporary message that deletes itself after 5 seconds
const sendTempMessage = (channel, content) => {
  channel.send(content).then(msg => {
    setTimeout(() => msg.delete().catch(() => { }), 5000);
  }).catch(err => console.error('Failed to send temp message:', err));
};

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(message) {
    // Ignore bots and direct messages (DMs)
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const userId = message.author.id;
    const serverId = message.guild.id;

    // --- DROP CATCH INTERCEPT ---
    if (activeDrops.has(message.channel.id) && content.toLowerCase() === 'soul') {
      const dropControl = await getBotControlState();
      if (dropControl.maintenanceMode || !dropControl.features.drops) {
        return;
      }

      const drop = activeDrops.get(message.channel.id);

      // Delete immediately to prevent double catch race conditions
      activeDrops.delete(message.channel.id);

      // Set cooldown start time to now (catch time)
      // We schedule the next drop rather than just setting a time
      scheduleNextDrop(message.client, serverId, message.channel.id);

      if (drop.timeoutId) {
        clearTimeout(drop.timeoutId);
      }

      try {
        const settings = await getServerSettings(serverId);
        const currencyName = settings.currency_name;
        const currencyIcon = settings.currency_icon_url;

        const awardResult = await awardDropCoins(userId, serverId, drop.value);

        // Edit original drop message
        const dropMsg = await message.channel.messages.fetch(drop.messageId).catch(() => null);
        if (dropMsg) {
          const caughtEmbed = new EmbedBuilder()
            .setColor('#00ffaa')
            .setTitle('🎉 Soul Coin Caught! 🎉')
            .setDescription(`**${message.author.username}** claimed the Soul Coin!\n\nReward: **${drop.value}** <:Soul_Head:1523605643158618214>`)
            .setTimestamp();

          await dropMsg.edit({ embeds: [caughtEmbed] }).catch(() => { });
        }

        // Send congratulatory reply
        const congratulateText = `Congratulations ${message.author}! You caught the Soul Coin and added **${drop.value}** <:Soul_Head:1523605643158618214> to your wallet!\n**New Balance**: **${awardResult.newBalance}** <:Soul_Head:1523605643158618214>`;

        await message.reply({ content: congratulateText }).catch(() => { });
      } catch (err) {
        console.error(`Error claiming drop for user ${userId}:`, err);
      }

      return; // Exit early to prevent catching from counting as milestone activity
    }

    // Check if the message is a prefix command (starts with "s " case-insensitive)
    if (content.toLowerCase().startsWith('s ')) {
      const args = content.slice(2).trim().split(/\s+/);
      const commandName = args.shift().toLowerCase();
      const control = await getBotControlState(message.guildId);

      if (control.maintenanceMode && !isAdminPrefixCommand(commandName)) {
        return sendTempMessage(message.channel, control.maintenanceMessage);
      }

      const featureKey = getFeatureForPrefixCommand(commandName);
      if (featureKey && !control.features[featureKey]) {
        return sendTempMessage(message.channel, `❌ **${commandName}** is temporarily disabled globally by the bot owner.`);
      }

      try {
        const settings = await getServerSettings(serverId);
        const currencyName = settings.currency_name;
        const currencyIcon = settings.currency_icon_url;

        // --- 1. ADMIN COMMANDS ---
        if (['setup', 'reset-cycle', 'set-drop-channel', 'force-drop'].includes(commandName)) {
          // Check administrator permission
          if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You must have Administrator permissions to run admin commands.').catch(() => { });
          }

          // setup, set-drop-channel, and force-drop can be run anywhere; other admin commands are restricted to #soul-logs
          if (!['setup', 'set-drop-channel', 'force-drop'].includes(commandName)) {
            if (!message.channel.name.toLowerCase().includes('soul-logs')) {
              return sendTempMessage(message.channel, '❌ This administrative command can only be used in the **#soul-logs** channel.');
            }
          }

          // Execute admin commands
          if (commandName === 'setup') {
            // Check if the bot has permission to manage channels
            const botMember = message.guild.members.me || await message.guild.members.fetch(message.client.user.id).catch(() => null);
            if (botMember && !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
              return message.reply('❌ **Setup Failed**: The bot is missing the **Manage Channels** permission in this server. Please grant this permission to the bot or its role in Server Settings and try again.').catch(() => { });
            }

            const channelsToCreate = [
              {
                name: 'soul-bot',
                topic: 'Command usage (s daily, s cash, s lb, s flip) and active chat milestone rewards.',
                private: false
              },
              {
                name: 'soul-logs',
                topic: 'Administrative logs and configuration settings for the Soul Currency system.',
                private: true
              }
            ];

            // Find or create category
            const currentChannels = await message.guild.channels.fetch().catch(() => message.guild.channels.cache);
            let category = currentChannels.find(
              c => c.name.toLowerCase() === 'soul' && c.type === ChannelType.GuildCategory
            );

            if (!category) {
              category = await message.guild.channels.create({
                name: 'Soul',
                type: ChannelType.GuildCategory
              });
            }

            const updatedChannels = await message.guild.channels.fetch().catch(() => message.guild.channels.cache);
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

                if (ch.private) {
                  options.permissionOverwrites = [
                    {
                      id: message.guild.roles.everyone.id,
                      deny: [PermissionFlagsBits.ViewChannel]
                    }
                  ];
                }

                await message.guild.channels.create(options);
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

            return await message.reply({ embeds: [embed] }).catch(() => { });
          }


          if (commandName === 'set-drop-channel') {
            const channelMention = args[0];
            let targetChannelId = null;

            if (channelMention) {
              const match = channelMention.match(/^<#(\d+)>$/);
              if (match) {
                targetChannelId = match[1];
              } else if (!isNaN(channelMention)) {
                targetChannelId = channelMention;
              } else {
                // Resolve by name (case-insensitive)
                const currentChannels = await message.guild.channels.fetch().catch(() => message.guild.channels.cache);
                const channelByName = currentChannels.find(
                  c => c.name.toLowerCase() === channelMention.toLowerCase() && c.type === ChannelType.GuildText
                );
                if (channelByName) {
                  targetChannelId = channelByName.id;
                }
              }
            } else {
              // Fallback to the current channel
              targetChannelId = message.channel.id;
            }

            if (!targetChannelId) {
              return message.reply('❌ **Error**: Channel not found in this server. Usage: `s set-drop-channel [channel_name/mention/id]`').catch(() => { });
            }

            const channelExists = message.guild.channels.cache.get(targetChannelId) ||
              await message.guild.channels.fetch(targetChannelId).catch(() => null);

            if (!channelExists || channelExists.type !== ChannelType.GuildText) {
              return message.reply('❌ **Error**: Channel not found or is not a text channel.').catch(() => { });
            }

            await updateDropChannel(serverId, targetChannelId);

            const embed = new EmbedBuilder()
              .setColor('#00ffaa')
              .setTitle('⚙️ Drop Channel Configured')
              .setDescription(`Random Soul Coin drops will now occur in the channel: <#${targetChannelId}>.`)
              .setTimestamp();

            return await message.reply({ embeds: [embed] }).catch(() => { });
          }

          if (commandName === 'force-drop') {
            const settings = await getServerSettings(serverId);
            let dropChannel = null;

            if (settings.drop_channel_id) {
              dropChannel = message.guild.channels.cache.get(settings.drop_channel_id) ||
                await message.guild.channels.fetch(settings.drop_channel_id).catch(() => null);
            } else {
              const currentChannels = await message.guild.channels.fetch().catch(() => message.guild.channels.cache);
              dropChannel = currentChannels.find(
                c => c.name.toLowerCase() === 'general' && c.type === ChannelType.GuildText
              );
            }

            if (!dropChannel) {
              return message.reply('❌ **Error**: Drop channel not configured or not found. Please set it using `s set-drop-channel <#channel>` or name a channel `#general`.').catch(() => { });
            }

            const dropResult = await triggerDrop(message.client, serverId, dropChannel);
            if (dropResult) {
              return message.reply(`✅ Successfully triggered a random coin drop in ${dropChannel}!`).catch(() => { });
            } else {
              return message.reply('❌ **Error**: Failed to send drop message. Please check permissions.').catch(() => { });
            }
          }
        }

        // --- 2. USER COMMANDS ---
        if (['daily', 'checkin', 'claim', 'cash', 'balance', 'bal', 'money', 'leaderboard', 'lb', 'rich', 'flip', 'casino', 'bet', 'crash', 'mines', 'stats', 'profile', 'shop', 'buy', 'fight', 'gift', 'give', 'send', 'transfer', 'help', 'rob', 'steal', 'heist'].includes(commandName)) {
          // Lock user commands to #soul-bot — EXCEPT 's help admin' which admins can run anywhere
          const isAdminHelpRequest = commandName === 'help' && args[0] && args[0].toLowerCase() === 'admin';
          if (!isAdminHelpRequest && !message.channel.name.toLowerCase().includes('soul-bot')) {
            return sendTempMessage(message.channel, '❌ This command can only be used in the **#soul-bot** channel.');
          }

          if (['help'].includes(commandName)) {
            // --- ADMIN HELP ---
            if (args[0] && args[0].toLowerCase() === 'admin') {
              // Check administrator permission
              if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return sendTempMessage(message.channel, '❌ **Admin Help** is restricted to Server Administrators only.');
              }

              const prefixEmbed = new EmbedBuilder()
                .setColor('#7b2fff')
                .setTitle('🛡️ Admin Prefix Commands (`s <command>`)')
                .setDescription('These commands use the `s ` prefix and require **Administrator** permission.')
                .addFields(
                  {
                    name: '🏗️ `s setup`',
                    value: 'Creates the **Soul** category with `#soul-bot` (public) and `#soul-logs` (private) channels.\n> Can be run in **any channel**.',
                    inline: false
                  },
                  {
                    name: '📍 `s set-drop-channel [#channel]`',
                    value: 'Sets the channel where random Soul Coin drops will spawn.\nLeave blank to use the current channel.\n> Can be run in **any channel**.',
                    inline: false
                  },
                  {
                    name: '💥 `s force-drop`',
                    value: 'Immediately triggers a Soul Coin drop in the configured drop channel.\n> Can be run in **any channel**.',
                    inline: false
                  }
                )
                .setFooter({ text: 'Prefix commands are typed directly in chat with the "s " prefix.' })
                .setTimestamp();

              const slashEmbed = new EmbedBuilder()
                .setColor('#a855f7')
                .setTitle('⚡ Admin Slash Commands (`/admin`)')
                .setDescription('These are registered Discord slash commands. Type `/admin` to see them in the command picker.')
                .addFields(
                  {
                    name: '🏗️ `/admin setup`',
                    value: 'Creates the **Soul** category with `#soul-bot` and `#soul-logs` channels if they don\'t exist.\n> Can be run in **any channel**.',
                    inline: false
                  },
                  {
                    name: '📍 `/admin set-drop-channel [channel]`',
                    value: 'Sets the Soul Coin drop channel. Leave blank to use the current channel.\n> Can be run in **any channel**.',
                    inline: false
                  },
                  {
                    name: '💥 `/admin force-drop`',
                    value: 'Immediately triggers a Soul Coin drop in the configured drop channel.\n> Can be run in **any channel**.',
                    inline: false
                  },
                  {
                    name: '🔁 `/admin auto-drops <start/stop>`',
                    value: 'Starts or stops the **automated 10-minute Soul Coin drop cycle** in the drop channel.\n> Can be run in **any channel**.',
                    inline: false
                  },
                  {
                    name: '🔄 `/admin reset-cycle`',
                    value: 'Archives current cycle standings, then resets **all member balances to 0** for a fresh cycle.\n⚠️ **Disabled in Global Economy mode.**\n> Must be run in **#soul-logs** only.',
                    inline: false
                  }
                )
                .setFooter({ text: 'Slash commands show up in Discord\'s command picker when you type /admin.' })
                .setTimestamp();

              const noteEmbed = new EmbedBuilder()
                .setColor('#3b0764')
                .setTitle('📋 Quick Reference')
                .addFields(
                  { name: '✅ Available Anywhere', value: '`s setup` · `s set-drop-channel` · `s force-drop`\n`/admin setup` · `/admin set-drop-channel` · `/admin force-drop` · `/admin auto-drops`', inline: false },
                  { name: '⚡ Slash-Only (no prefix version)', value: '`/admin auto-drops`', inline: false },
                  { name: '🔒 Bot Owner Dashboard Only', value: '**Cycle Reset** — must be triggered from the Admin Cockpit dashboard.\nServer admins cannot reset cycles directly.', inline: false },
                  { name: '⛔ Globally Disabled', value: 'Currency name & icon changes · Shop price overrides\n*(These were removed from this bot\'s configuration.)*', inline: false }
                )
                .setFooter({ text: `Run by ${message.author.tag} · Soul Currency Admin Reference` })
                .setTimestamp();

              return await message.reply({ embeds: [prefixEmbed, slashEmbed, noteEmbed] }).catch(() => { });
            }

            // --- REGULAR USER HELP ---
            const helpEmbed = new EmbedBuilder()
              .setColor('#ffd700')
              .setTitle(`${currencyName} Commands`)
              .setDescription('Here are all the ways you can interact with the Soul Currency bot in this channel:')
              .addFields(
                { name: '💰 `s daily`', value: 'Claim your daily allowance of Souls (resets every 24 hours).' },
                { name: '🏦 `s cash`', value: 'Check your wallet balance (or tag another user to check theirs).' },
                { name: '🏆 `s lb`', value: 'View the top 10 richest users in the current monthly cycle.' },
                { name: '📊 `s stats [@user]`', value: 'Check stats (Strength, Defense, Speed, Magic). Others are hidden as `???`.' },
                { name: '🛒 `s shop`', value: 'Browse stat training boosters, 24-hour elixirs, and shields.' },
                { name: '🛍️ `s buy <item>`', value: 'Purchase upgrades or items from the shop.' },
                { name: '⚔️ `s fight @user <bet>`', value: 'Challenge a player to a mystery stat clash! Winner takes the pot.' },
                { name: '🎁 `s gift @user <amount>`', value: 'Send Souls to another user from your wallet.' },
                { name: '🎰 `s flip <heads/tails> <amount>`', value: 'Flip a coin for double or nothing! Defaults to heads if no choice is given.' },
                { name: '🚀 `s crash <amount>`', value: 'Watch the multiplier rise and cash out before it crashes! Higher risk, higher reward.' },
                { name: '💣 `s mines <amount> [mines]`', value: 'Reveal tiles on a grid and avoid hidden mines! More mines = higher multiplier. Default: 3 mines.' },
                { name: '🥷 `s rob @user`', value: 'Attempt to steal 10% of their wallet (30% success rate). Caught? Pay a 5% fine! (1hr cooldown).' },
                { name: '🏃‍♂️ `soul`', value: 'Type exactly this word when a Soul Coin drops to catch it before anyone else!' }
              )
              .setFooter({ text: 'Tip: Passively earn Souls by chatting in active channels! · Admins: use `s help admin` in any channel.' })
              .setTimestamp();

            return await message.reply({ embeds: [helpEmbed] }).catch(() => { });
          }

          if (['daily', 'checkin', 'claim'].includes(commandName)) {
            const checkinAmount = getRandomCheckinAmount(control);
            const res = await checkInUser(userId, serverId, checkinAmount);

            if (res.success) {
              const embed = new EmbedBuilder()
                .setColor('#00ffaa')
                .setTitle('📅 Daily Check-in Success!')
                .setDescription(`You have claimed your daily reward of **${checkinAmount}** ${currencyIcon} ${currencyName}!`)
                .addFields({ name: 'New Balance', value: `💰 **${res.newBalance}** ${currencyIcon} ${currencyName}` })
                .setTimestamp();
              return await message.reply({ embeds: [embed] }).catch(() => { });
            } else {
              const cooldownHours = (res.cooldownRemainingMs / (1000 * 60 * 60)).toFixed(2);
              const embed = new EmbedBuilder()
                .setColor('#ff3300')
                .setTitle('⏳ Daily Check-in Cooldown')
                .setDescription(`You have already claimed your daily reward today. Please try again in **${cooldownHours}** hours.`)
                .setTimestamp();
              return await message.reply({ embeds: [embed] }).catch(() => { });
            }
          }

          if (['cash', 'balance', 'bal', 'money'].includes(commandName)) {
            const targetUser = message.mentions.users.first() || message.author;
            const balanceInfo = await getUserBalance(targetUser.id, serverId);
            const embed = new EmbedBuilder()
              .setColor('#ffd700')
              .setTitle(`${targetUser.username}'s Wallet`)
              .setDescription(`Holding **${balanceInfo.balance}** ${currencyIcon} ${currencyName}`)
              .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
              .setTimestamp();
            return await message.reply({ embeds: [embed] }).catch(() => { });
          }

          if (['gift', 'give', 'send', 'transfer'].includes(commandName)) {
            const targetUser = message.mentions.users.first();
            let amount = 0;

            // Try to find amount in arguments
            for (const arg of args) {
              const parsed = parseInt(arg);
              if (!isNaN(parsed) && parsed > 0) {
                amount = parsed;
                break;
              }
            }

            if (!targetUser || amount <= 0) {
              return sendTempMessage(message.channel, '❌ Invalid syntax. Use `s gift @user <amount>`.');
            }
            if (targetUser.id === message.author.id) {
              return sendTempMessage(message.channel, '❌ You cannot gift yourself.');
            }
            if (targetUser.bot) {
              return sendTempMessage(message.channel, '❌ You cannot gift bots.');
            }

            const result = await transferCoins(message.author.id, targetUser.id, serverId, amount);

            if (result.success) {
              const embed = new EmbedBuilder()
                .setColor('#00ffaa')
                .setTitle('🎁 Gift Sent!')
                .setDescription(`Successfully sent **${amount}** ${currencyIcon} ${currencyName} to ${targetUser}!`)
                .addFields({ name: 'Your New Balance', value: `**${result.newSenderBalance}** ${currencyIcon} ${currencyName}` })
                .setTimestamp();
              return await message.reply({ embeds: [embed] }).catch(() => { });
            } else if (result.reason === 'insufficient_funds') {
              return sendTempMessage(message.channel, `❌ You don't have enough funds to gift that amount. Your current balance is **${result.currentBalance}** ${currencyIcon} ${currencyName}.`);
            } else {
              return sendTempMessage(message.channel, '❌ An error occurred while transferring funds.');
            }
          }

          if (['rob', 'steal', 'heist'].includes(commandName)) {
            const targetUser = message.mentions.users.first();

            if (!targetUser) {
              return sendTempMessage(message.channel, '❌ Invalid syntax. Use `s rob @user`.');
            }
            if (targetUser.id === message.author.id) {
              return sendTempMessage(message.channel, '❌ You cannot rob yourself.');
            }
            if (targetUser.bot) {
              return sendTempMessage(message.channel, '❌ You cannot rob bots.');
            }

            const result = await attemptRob(message.author.id, targetUser.id, serverId);

            if (result.success) {
              // Successfully robbed 10%
              const embed = new EmbedBuilder()
                .setColor('#00ffaa')
                .setTitle('🥷 Bank Heist: SUCCESS!')
                .setDescription(`You successfully sneaked into ${targetUser}'s wallet and stole **${result.amount}** ${currencyIcon} ${currencyName}!`)
                .addFields({ name: 'Your New Balance', value: `**${result.newBalance}** ${currencyIcon} ${currencyName}` })
                .setTimestamp();
              return await message.reply({ embeds: [embed] }).catch(() => { });
            } else {
              if (result.reason === 'cooldown') {
                const hoursLeft = Math.floor(result.cooldownRemainingMs / (1000 * 60 * 60));
                const minsLeft = Math.floor((result.cooldownRemainingMs % (1000 * 60 * 60)) / (1000 * 60));
                return sendTempMessage(message.channel, `⏳ You are lying low. You can attempt another robbery in **${hoursLeft}h ${minsLeft}m**.`);
              } else if (result.reason === 'robber_poor') {
                return sendTempMessage(message.channel, `❌ You need at least 20 ${currencyIcon} ${currencyName} to attempt a robbery (gotta buy the lockpicks).`);
              } else if (result.reason === 'target_poor') {
                return sendTempMessage(message.channel, `❌ ${targetUser.username} is too poor to be robbed (they have less than 20 ${currencyName}). Pick on someone your own size!`);
              } else if (result.reason === 'caught') {
                // Failed and paid fine
                const embed = new EmbedBuilder()
                  .setColor('#ff3366')
                  .setTitle('🚨 Bank Heist: CAUGHT!')
                  .setDescription(`You tripped the alarm and got caught trying to rob ${targetUser}!\n\nYou were forced to pay them a fine of **${result.amount}** ${currencyIcon} ${currencyName} (5% of your wallet).`)
                  .addFields({ name: 'Your New Balance', value: `**${result.newBalance}** ${currencyIcon} ${currencyName}` })
                  .setTimestamp();
                return await message.reply({ embeds: [embed] }).catch(() => { });
              }
            }
          }

          if (['leaderboard', 'lb', 'rich'].includes(commandName)) {
            const { rankings } = await getLeaderboard(serverId, 10);
            const embed = new EmbedBuilder()
              .setColor('#ffd700')
              .setTitle(`🏆 ${message.guild.name} Monthly Leaderboard`)
              .setTimestamp();

            if (rankings.length === 0) {
              embed.setDescription('No active rankings found for this cycle yet. Start chatting to join the board!');
            } else {
              const listStr = rankings.map((r, i) => {
                let medal = '';
                if (i === 0) medal = '🥇 ';
                else if (i === 1) medal = '🥈 ';
                else if (i === 2) medal = '🥉 ';
                else medal = `\`#${i + 1}\` `;
                return `${medal} <@${r.discord_id}> — **${r.coin_balance}** ${currencyIcon} ${currencyName}`;
              }).join('\n');
              embed.setDescription(listStr);
            }
            return await message.reply({ embeds: [embed] }).catch(() => { });
          }

          if (['flip', 'casino', 'bet'].includes(commandName)) {
            let bet = 0;
            let choice = 'heads'; // default

            if (args.length === 1 && !isNaN(parseInt(args[0]))) {
              bet = parseInt(args[0]);
            } else if (args.length >= 2) {
              let choiceInput = args[0].toLowerCase();
              let betInput = args[1];

              if (!isNaN(choiceInput) && isNaN(parseInt(betInput))) {
                const temp = choiceInput;
                choiceInput = betInput.toLowerCase();
                betInput = temp;
              }

              if (choiceInput === 'heads' || choiceInput === 'h') choice = 'heads';
              if (choiceInput === 'tails' || choiceInput === 't') choice = 'tails';
              bet = parseInt(betInput);
            }

            if (isNaN(bet) || bet <= 0) {
              return await message.reply('❌ **Usage**: `s flip <bet_amount>` (defaults to heads) OR `s flip <heads/tails> <bet_amount>`').catch(() => { });
            }

            // Verify user balance
            const balanceInfo = await getUserBalance(userId, serverId);
            if (balanceInfo.balance < bet) {
              const errorEmbed = new EmbedBuilder()
                .setColor('#ff3366')
                .setTitle('❌ Insufficient Coins')
                .setDescription(`You don't have enough coins to place that bet!`)
                .addFields(
                  { name: 'Your Balance', value: `**${balanceInfo.balance}** ${currencyIcon} ${currencyName}`, inline: true },
                  { name: 'Attempted Bet', value: `**${bet}** ${currencyIcon} ${currencyName}`, inline: true }
                )
                .setTimestamp();
              return await message.reply({ embeds: [errorEmbed] }).catch(() => { });
            }

            // Rig the flip to a 30% win chance
            const isWin = Math.random() < 0.30;
            const flipResult = isWin ? choice : (choice === 'heads' ? 'tails' : 'heads');

            const result = await recordCasinoGame(userId, serverId, bet, isWin);

            const capitalizedChoice = choice.charAt(0).toUpperCase() + choice.slice(1);
            const capitalizedResult = flipResult.charAt(0).toUpperCase() + flipResult.slice(1);

            const displayChoice = choice === 'heads' ? '<:Soul_Head:1523605643158618214>' : '<:Soul_Tail:1523605605787373610>';
            const displayResult = flipResult === 'heads' ? '<:Soul_Head:1523605643158618214>' : '<:Soul_Tail:1523605605787373610>';

            let outputText = `**${message.author.username}** spent <:Soul_Head:1523605643158618214> **${bet}** and chose **${choice}**\n`;
            if (isWin) {
              outputText += `The coin spins... ${displayResult} and you won <:Soul_Head:1523605643158618214> **${bet * 2}**!!`;
            } else {
              outputText += `The coin spins... ${displayResult} and you lost it all...`;
            }

            return await message.reply({ content: outputText }).catch(() => { });
          }

          if (['stats', 'profile'].includes(commandName)) {
            // Delete user's command message immediately to keep the channel completely clean
            message.delete().catch(() => {});

            try {
              const stats = await getUserStats(userId, serverId);
              
              const embed = new EmbedBuilder()
                .setAuthor({
                  name: `${message.author.username}'s Profile`,
                  iconURL: message.author.displayAvatarURL({ dynamic: true })
                })
                .setColor('#ffd700')
                .setTitle('📊 Your Core Stats')
                .setDescription(
                  `⚔️ **Strength:** \`${stats.total.strength}\` (Base: ${stats.base.strength} | Weekly: +${stats.weekly.strength} | Potion: +${stats.activeBuffs.strength})\n` +
                  `🛡️ **Defense:** \`${stats.total.defense}\` (Base: ${stats.base.defense} | Weekly: +${stats.weekly.defense} | Potion: +${stats.activeBuffs.defense})\n` +
                  `⚡ **Speed:** \`${stats.total.speed}\` (Base: ${stats.base.speed} | Weekly: +${stats.weekly.speed} | Potion: +${stats.activeBuffs.speed})\n` +
                  `🔮 **Magic:** \`${stats.total.magic}\` (Base: ${stats.base.magic} | Weekly: +${stats.weekly.magic} | Potion: +${stats.activeBuffs.magic})\n`
                )
                .setTimestamp();

              // Add Divine Shield info
              const inventory = await getUserInventory(userId, serverId);
              const shieldCount = inventory.shield || 0;
              embed.addFields({ name: '🎒 Inventory', value: `🛡️ **Divine Shield:** \`${shieldCount}\``, inline: false });

              // Active potions
              if (stats.detailedBoosts.length > 0) {
                const potionList = stats.detailedBoosts.map(b => {
                  const timeLeftMs = new Date(b.expires_at).getTime() - Date.now();
                  const hoursLeft = (timeLeftMs / (1000 * 60 * 60)).toFixed(1);
                  return `🧪 **+15 ${b.stat_type.charAt(0).toUpperCase() + b.stat_type.slice(1)} Buff** (Expires in ${hoursLeft}h)`;
                }).join('\n');
                embed.addFields({ name: '🧪 Active Potion Buffs', value: potionList, inline: false });
              }

              // Send privately via DM
              let dmSuccess = true;
              await message.author.send({ embeds: [embed] }).catch(() => {
                dmSuccess = false;
              });

              if (dmSuccess) {
                // Post temporary group notification that self-destructs after 4 seconds
                message.channel.send(`📬 **${message.author.username}**, I have DM'd you your profile details!`).then(tempMsg => {
                  setTimeout(() => {
                    tempMsg.delete().catch(() => {});
                  }, 4000);
                }).catch(() => {});
              } else {
                message.channel.send(`❌ **${message.author.username}**, I couldn't send you a DM. Please enable direct messages in your privacy settings.`).then(tempMsg => {
                  setTimeout(() => {
                    tempMsg.delete().catch(() => {});
                  }, 4000);
                }).catch(() => {});
              }
            } catch (err) {
              console.error(`Failed to DM stats to user ${userId}:`, err);
            }
            return;
          }

          if (commandName === 'shop') {
            const prices = await getShopPrices(serverId);
            const embed = new EmbedBuilder()
              .setColor('#ffd700')
              .setTitle(`🛒 The Soul Shop`)
              .setDescription(`Enhance your stats or buy defense systems! Prices can be configured by server administrators.`)
              .addFields(
                {
                  name: '🏋️ Category A: Weekly Upgrades (Resets Sunday Midnight)',
                  value: 
                    `🏋️ **Iron Dumbbell** (ID: \`dumbbell\`) — **${prices.dumbbell}** ${currencyIcon}\n` +
                    `*Effect: +5 Strength ⚔️*\n\n` +
                    `🛡️ **Kevlar Vest** (ID: \`vest\`) — **${prices.vest}** ${currencyIcon}\n` +
                    `*Effect: +5 Defense 🛡️*\n\n` +
                    `👟 **Running Shoes** (ID: \`shoes\`) — **${prices.shoes}** ${currencyIcon}\n` +
                    `*Effect: +5 Speed ⚡*\n\n` +
                    `📘 **Ancient Tome** (ID: \`tome\`) — **${prices.tome}** ${currencyIcon}\n` +
                    `*Effect: +5 Magic 🔮*`
                },
                {
                  name: '🧪 Category B: 24-Hour Consumables',
                  value:
                    `🧪 **Rage Elixir** (ID: \`rage\`) — **${prices.rage}** ${currencyIcon}\n` +
                    `*Effect: +15 Strength ⚔️ for 24 hours.*\n\n` +
                    `🧪 **Aegis Serum** (ID: \`aegis\`) — **${prices.aegis}** ${currencyIcon}\n` +
                    `*Effect: +15 Defense 🛡️ for 24 hours.*\n\n` +
                    `💊 **Adrenaline Pill** (ID: \`adrenaline\`) — **${prices.adrenaline}** ${currencyIcon}\n` +
                    `*Effect: +15 Speed ⚡ for 24 hours.*\n\n` +
                    `🧪 **Mana Elixir** (ID: \`mana\`) — **${prices.mana}** ${currencyIcon}\n` +
                    `*Effect: +15 Magic 🔮 for 24 hours.*`
                },
                {
                  name: '🛡️ Category C: Utility Items',
                  value:
                    `🔮 **Divine Shield** (ID: \`shield\`) — **${prices.shield}** ${currencyIcon}\n` +
                    `*Effect: Automatically blocks 1 robbery attempt. Consumed on use.*`
                }
              )
              .setFooter({ text: 'Usage: s buy <item_id> OR select an option from the menu below to purchase!' })
              .setTimestamp();

            // Create interactive select menu for purchases
            const selectId = `shop_select_${userId}_${Date.now()}`;
            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId(selectId)
              .setPlaceholder('🛒 Select an item to purchase...')
              .addOptions(
                new StringSelectMenuOptionBuilder()
                  .setLabel('Iron Dumbbell (+5 Strength)')
                  .setDescription(`Cost: ${prices.dumbbell} coins`)
                  .setValue('dumbbell')
                  .setEmoji('🏋️'),
                new StringSelectMenuOptionBuilder()
                  .setLabel('Kevlar Vest (+5 Defense)')
                  .setDescription(`Cost: ${prices.vest} coins`)
                  .setValue('vest')
                  .setEmoji('🛡️'),
                new StringSelectMenuOptionBuilder()
                  .setLabel('Running Shoes (+5 Speed)')
                  .setDescription(`Cost: ${prices.shoes} coins`)
                  .setValue('shoes')
                  .setEmoji('👟'),
                new StringSelectMenuOptionBuilder()
                  .setLabel('Ancient Tome (+5 Magic)')
                  .setDescription(`Cost: ${prices.tome} coins`)
                  .setValue('tome')
                  .setEmoji('📘'),
                new StringSelectMenuOptionBuilder()
                  .setLabel('Rage Elixir (+15 Strength/24h)')
                  .setDescription(`Cost: ${prices.rage} coins`)
                  .setValue('rage')
                  .setEmoji('🧪'),
                new StringSelectMenuOptionBuilder()
                  .setLabel('Aegis Serum (+15 Defense/24h)')
                  .setDescription(`Cost: ${prices.aegis} coins`)
                  .setValue('aegis')
                  .setEmoji('🛡️'),
                new StringSelectMenuOptionBuilder()
                  .setLabel('Adrenaline Pill (+15 Speed/24h)')
                  .setDescription(`Cost: ${prices.adrenaline} coins`)
                  .setValue('adrenaline')
                  .setEmoji('💊'),
                new StringSelectMenuOptionBuilder()
                  .setLabel('Mana Elixir (+15 Magic/24h)')
                  .setDescription(`Cost: ${prices.mana} coins`)
                  .setValue('mana')
                  .setEmoji('🔮'),
                new StringSelectMenuOptionBuilder()
                  .setLabel('Divine Shield (Robbery Block)')
                  .setDescription(`Cost: ${prices.shield} coins`)
                  .setValue('shield')
                  .setEmoji('🔮')
              );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const shopMessage = await message.reply({
              embeds: [embed],
              components: [row]
            });

            // Create collector
            const collector = shopMessage.createMessageComponentCollector({
              componentType: ComponentType.StringSelect,
              time: 60000,
              filter: (i) => i.user.id === userId && i.customId === selectId
            });

            collector.on('collect', async (menuInteraction) => {
              const selectedItemId = menuInteraction.values[0];
              await menuInteraction.deferReply({ ephemeral: true });

              const result = await purchaseShopItem(userId, serverId, selectedItemId);
              if (result.success) {
                const successEmbed = new EmbedBuilder()
                  .setColor('#00ffaa')
                  .setTitle('🛒 Purchase Successful!')
                  .setDescription(`Successfully bought **${selectedItemId}** for **${result.cost}** ${currencyIcon} ${currencyName}.`)
                  .addFields(
                    { name: 'Effect', value: `✨ ${result.message}` },
                    { name: 'Your New Balance', value: `**${result.newBalance}** ${currencyIcon} ${currencyName}` }
                  )
                  .setTimestamp();
                await menuInteraction.followUp({ embeds: [successEmbed], ephemeral: true });
              } else {
                let errorText = '❌ An error occurred processing your purchase.';
                if (result.reason === 'insufficient_funds') {
                  errorText = `❌ Insufficient funds! You need **${result.cost}** ${currencyIcon} to buy this item.`;
                } else if (result.reason === 'invalid_item') {
                  errorText = `❌ Invalid Item ID!`;
                }
                await menuInteraction.followUp({ content: errorText, ephemeral: true });
              }
            });

            collector.on('end', async () => {
              // Disable select menu on timeout
              selectMenu.setDisabled(true).setPlaceholder('Shop session expired. Type s shop to reopen.');
              const disabledRow = new ActionRowBuilder().addComponents(selectMenu);
              await shopMessage.edit({ components: [disabledRow] }).catch(() => {});
            });

            return;
          }

          if (commandName === 'buy') {
            const itemId = args[0];
            if (!itemId) {
              return message.reply('❌ **Usage**: `s buy <item_id>` (check IDs using `s shop`)').catch(() => { });
            }

            const result = await purchaseShopItem(userId, serverId, itemId);
            if (result.success) {
              const embed = new EmbedBuilder()
                .setColor('#00ffaa')
                .setTitle('🛒 Purchase Successful!')
                .setDescription(`Successfully bought **${itemId}** for **${result.cost}** ${currencyIcon} ${currencyName}.`)
                .addFields(
                  { name: 'Effect', value: `✨ ${result.message}` },
                  { name: 'Your New Balance', value: `**${result.newBalance}** ${currencyIcon} ${currencyName}` }
                )
                .setTimestamp();
              return await message.reply({ embeds: [embed] }).catch(() => { });
            } else {
              if (result.reason === 'insufficient_funds') {
                return sendTempMessage(message.channel, `❌ Insufficient funds! You need **${result.cost}** ${currencyIcon} to buy this item.`);
              } else if (result.reason === 'invalid_item') {
                return sendTempMessage(message.channel, `❌ Invalid Item ID! Use \`s shop\` to check valid item IDs.`);
              } else {
                return sendTempMessage(message.channel, '❌ An error occurred processing your purchase.');
              }
            }
          }

          if (commandName === 'fight') {
            const targetUser = message.mentions.users.first();
            let bet = parseInt(args[1], 10);

            if (!targetUser || isNaN(bet) || bet <= 0) {
              return message.reply('❌ **Usage**: `s fight @user <bet_amount>`').catch(() => { });
            }

            const globalSettings = await getGlobalSettings();
            const maxBet = parseInt(globalSettings.max_fight_bet, 10) || 10000;
            const cooldownHours = parseInt(globalSettings.duel_cooldown_hours, 10) || 6;

            if (bet > maxBet) {
              return sendTempMessage(message.channel, `❌ The maximum bet for a duel is **${maxBet.toLocaleString()}** coins!`);
            }

            if (targetUser.id === userId) {
              return sendTempMessage(message.channel, '❌ You cannot fight yourself!');
            }

            if (targetUser.bot) {
              return sendTempMessage(message.channel, '❌ You cannot fight bots!');
            }

            // Verify challenger balance
            const balanceInfo = await getUserBalance(userId, serverId);
            if (balanceInfo.balance < bet) {
              return sendTempMessage(message.channel, `❌ Insufficient coins! You need at least **${bet}** ${currencyIcon} to initiate this duel.`);
            }

            // Verify defender balance
            const targetBal = await getUserBalance(targetUser.id, serverId);
            if (targetBal.balance < bet) {
              return sendTempMessage(message.channel, `❌ Opponent doesn't have enough coins! ${targetUser.username} needs at least **${bet}** ${currencyIcon} to fight.`);
            }

            // Check challenger cooldown
            const challengerStats = await getUserStats(userId, serverId);
            if (challengerStats.lastDuelLossAt) {
              const elapsed = Date.now() - new Date(challengerStats.lastDuelLossAt).getTime();
              const cooldownMs = cooldownHours * 60 * 60 * 1000;
              if (elapsed < cooldownMs) {
                const remainingMin = Math.ceil((cooldownMs - elapsed) / (60 * 1000));
                let remainingText = '';
                if (remainingMin > 60) {
                  const hours = Math.floor(remainingMin / 60);
                  const mins = remainingMin % 60;
                  remainingText = `**${hours}h ${mins}m**`;
                } else {
                  remainingText = `**${remainingMin}m**`;
                }
                return sendTempMessage(message.channel, `❌ You are on a duel cooldown! You must wait ${remainingText} before initiating another fight.`);
              }
            }

            // Check defender cooldown
            const defenderStats = await getUserStats(targetUser.id, serverId);
            if (defenderStats.lastDuelLossAt) {
              const elapsed = Date.now() - new Date(defenderStats.lastDuelLossAt).getTime();
              const cooldownMs = cooldownHours * 60 * 60 * 1000;
              if (elapsed < cooldownMs) {
                const remainingMin = Math.ceil((cooldownMs - elapsed) / (60 * 1000));
                let remainingText = '';
                if (remainingMin > 60) {
                  const hours = Math.floor(remainingMin / 60);
                  const mins = remainingMin % 60;
                  remainingText = `**${hours}h ${mins}m**`;
                } else {
                  remainingText = `**${remainingMin}m**`;
                }
                return sendTempMessage(message.channel, `❌ **${targetUser.username}** is on a duel cooldown and cannot be challenged for another ${remainingText}.`);
              }
            }

            // Re-verify balances to be absolutely safe
            const finalChallengerBal = await getUserBalance(userId, serverId);
            const finalDefenderBal = await getUserBalance(targetUser.id, serverId);
            if (finalChallengerBal.balance < bet || finalDefenderBal.balance < bet) {
              return sendTempMessage(message.channel, '❌ Duel cancelled: One of the players no longer has enough coins.');
            }

            // Deduct bets upfront
            await recordCasinoGame(userId, serverId, bet, false);
            await recordCasinoGame(targetUser.id, serverId, bet, false);

            // Pick random category
            const categories = [
              { name: 'Strength', icon: '⚔️', key: 'strength' },
              { name: 'Defense', icon: '🛡️', key: 'defense' },
              { name: 'Speed', icon: '⚡', key: 'speed' },
              { name: 'Magic', icon: '🔮', key: 'magic' }
            ];
            const category = categories[Math.floor(Math.random() * categories.length)];

            const cVal = challengerStats.total[category.key];
            const dVal = defenderStats.total[category.key];

            // Send Duel Started loading message directly
            const showdownEmbed = new EmbedBuilder()
              .setColor('#ff3300')
              .setTitle('⚔️ DUEL STARTED ⚔️')
              .setDescription(
                `📊 **Chosen Clash Category:** **${category.icon} ${category.name}**\n\n` +
                `🔴 **${message.author.username}**: \`??? ${category.name}\`\n` +
                `🔵 **${targetUser.username}**: \`??? ${category.name}\`\n\n` +
                `*Calculating showdown results...*`
              )
              .setTimestamp();

            const duelMsg = await message.reply({ embeds: [showdownEmbed] });

            // Suspend and calculate results
            setTimeout(async () => {
              let winnerId, loserId, winnerName, loserName, tie = false;
              let winVal, loseVal;

              if (cVal > dVal) {
                winnerId = userId;
                winnerName = message.author.username;
                loserId = targetUser.id;
                loserName = targetUser.username;
                winVal = cVal;
                loseVal = dVal;
              } else if (dVal > cVal) {
                winnerId = targetUser.id;
                winnerName = targetUser.username;
                loserId = userId;
                loserName = message.author.username;
                winVal = dVal;
                loseVal = cVal;
              } else {
                tie = true;
              }

              if (tie) {
                // Refund bets
                await recordCasinoGame(userId, serverId, bet, true);
                await recordCasinoGame(targetUser.id, serverId, bet, true);

                const tieEmbed = new EmbedBuilder()
                  .setColor('#ffd700')
                  .setTitle('🤝 DUEL RESULT: TIE!')
                  .setDescription(
                    `📊 **Clash Category:** **${category.icon} ${category.name}**\n\n` +
                    `🔴 **${message.author.username}**: \`${cVal} ${category.name}\`\n` +
                    `🔵 **${targetUser.username}**: \`${dVal} ${category.name}\`\n\n` +
                    `It was a perfect match! All bets have been refunded.`
                  )
                  .setTimestamp();

                await duelMsg.edit({ embeds: [tieEmbed] }).catch(() => {});
              } else {
                // Winnings pot
                const pot = bet * 2;
                await recordCasinoGame(winnerId, serverId, pot, true);

                // Set 1-hour cooldown for the loser
                await recordDuelLoss(loserId, serverId).catch(err => {
                  console.error(`Failed to record duel loss for user ${loserId}:`, err);
                });

                const winEmbed = new EmbedBuilder()
                  .setColor('#00ffaa')
                  .setTitle('🏆 DUEL RESULT: VICTORY!')
                  .setDescription(
                    `📊 **Clash Category:** **${category.icon} ${category.name}**\n\n` +
                    `👑 **Winner**: <@${winnerId}> (\`${winVal} ${category.name}\`)\n` +
                    `💀 **Loser**: <@${loserId}> (\`${loseVal} ${category.name}\`)\n\n` +
                    `<@${winnerId}> claimed the pot of **${pot}** ${currencyIcon} ${currencyName}!\n` +
                    `*💀 <@${loserId}> has been placed on a ${cooldownHours}-hour duel cooldown!*`
                  )
                  .setTimestamp();

                await duelMsg.edit({ embeds: [winEmbed] }).catch(() => {});

                // Fetch random anime kill GIF (Nekotina-style)
                let gifUrl = null;
                try {
                  const gifRes = await fetch('https://api.waifu.pics/sfw/kill');
                  if (gifRes.ok) {
                    const gifData = await gifRes.json();
                    gifUrl = gifData.url;
                  }
                } catch (gifErr) {
                  console.error('Failed to fetch action GIF:', gifErr);
                }

                const killEmbed = new EmbedBuilder()
                  .setColor('#ff3300')
                  .setDescription(`💀 **${winnerName}** ends **${loserName}**!`)
                  .setTimestamp();

                if (gifUrl) {
                  killEmbed.setImage(gifUrl);
                }

                await message.channel.send({ embeds: [killEmbed] }).catch(() => {});
              }
            }, 3000);
          }

          if (commandName === 'crash') {
            let bet = parseInt(args[0]);

            if (isNaN(bet) || bet <= 0) {
              return await message.reply('❌ **Usage**: `s crash <bet_amount>`').catch(() => { });
            }

            // Prevent multiple simultaneous crash games per user
            const gameKey = `${userId}_${serverId}`;
            if (activeCrashGames.has(gameKey)) {
              return sendTempMessage(message.channel, '❌ You already have an active crash game! Finish it first.');
            }

            // Deduct bet upfront (recorded as a loss)
            const deductResult = await recordCasinoGame(userId, serverId, bet, false);
            if (!deductResult.success) {
              if (deductResult.reason === 'insufficient_funds') {
                const errorEmbed = new EmbedBuilder()
                  .setColor('#ff3366')
                  .setTitle('❌ Insufficient Coins')
                  .setDescription(`You don't have enough coins to place that bet!`)
                  .addFields(
                    { name: 'Your Balance', value: `**${deductResult.currentBalance}** ${currencyIcon} ${currencyName}`, inline: true },
                    { name: 'Attempted Bet', value: `**${bet}** ${currencyIcon} ${currencyName}`, inline: true }
                  )
                  .setTimestamp();
                return await message.reply({ embeds: [errorEmbed] }).catch(() => { });
              }
              throw new Error('Database transaction failed');
            }

            // Mark game as active
            activeCrashGames.add(gameKey);

            // Generate crash point with house edge
            const r = Math.random();
            let crashPoint;
            if (r < 0.03) {
              crashPoint = 1.00; // 3% instant crash
            } else {
              crashPoint = Math.min(10.0, 1 / (1 - r));
              crashPoint = Math.floor(crashPoint * 100) / 100;
            }

            let currentMultiplier = 1.00;
            const barLength = 15;

            // Build initial embed
            function buildCrashEmbed(multiplier, state, winnings) {
              const embed = new EmbedBuilder()
                .setAuthor({
                  name: `${message.author.username}'s Crash Game`,
                  iconURL: message.author.displayAvatarURL({ dynamic: true })
                })
                .setTimestamp();

              const filled = Math.min(barLength, Math.round((multiplier / 10) * barLength));
              const progressBar = '🟩'.repeat(filled) + '⬛'.repeat(barLength - filled);

              if (state === 'rising') {
                embed.setColor('#ffaa00')
                  .setTitle('🚀 Crash — Multiplier Rising!')
                  .setDescription(
                    `The multiplier is climbing...\n\n` +
                    `### 💰 Current: \`${multiplier.toFixed(2)}x\`\n\n` +
                    `${progressBar}\n\n` +
                    `**Bet:** ${bet} ${currencyIcon} ${currencyName}\n` +
                    `**Potential Win:** ${Math.floor(bet * multiplier)} ${currencyIcon} ${currencyName}\n\n` +
                    `⚠️ *Hit **Cash Out** before it crashes!*`
                  );
              } else if (state === 'cashed_out') {
                embed.setColor('#00ffaa')
                  .setTitle('💰 Crash — CASHED OUT!')
                  .setDescription(
                    `You cashed out just in time!\n\n` +
                    `### ✅ Cashed Out At: \`${multiplier.toFixed(2)}x\`\n\n` +
                    `${progressBar}\n\n` +
                    `**Bet:** ${bet} ${currencyIcon} ${currencyName}\n` +
                    `**Winnings:** +${winnings} ${currencyIcon} ${currencyName}\n` +
                    `**Net Profit:** +${winnings - bet} ${currencyIcon} ${currencyName}\n\n` +
                    `*The rocket crashed at \`${crashPoint.toFixed(2)}x\`*`
                  );
              } else if (state === 'crashed') {
                embed.setColor('#ff3366')
                  .setTitle('💥 Crash — CRASHED!')
                  .setDescription(
                    `The rocket exploded!\n\n` +
                    `### 💥 Crashed At: \`${crashPoint.toFixed(2)}x\`\n\n` +
                    `${'🟥'.repeat(barLength)}\n\n` +
                    `**Bet Lost:** -${bet} ${currencyIcon} ${currencyName}\n\n` +
                    `*You didn't cash out in time...*`
                  );
              } else if (state === 'timeout') {
                embed.setColor('#ff3366')
                  .setTitle('⏰ Crash — TIMED OUT!')
                  .setDescription(
                    `You didn't press Cash Out in time!\n\n` +
                    `### 💥 Crashed At: \`${crashPoint.toFixed(2)}x\`\n\n` +
                    `${'🟥'.repeat(barLength)}\n\n` +
                    `**Bet Lost:** -${bet} ${currencyIcon} ${currencyName}\n\n` +
                    `*The game auto-crashed after 15 seconds.*`
                  );
              }
              return embed;
            }

            // Create Cash Out button
            const buttonId = `crash_cashout_${userId}_${Date.now()}`;
            const cashOutButton = new ButtonBuilder()
              .setCustomId(buttonId)
              .setLabel(`Cash Out (${bet} coins)`)
              .setStyle(ButtonStyle.Success)
              .setEmoji('💰');

            const row = new ActionRowBuilder().addComponents(cashOutButton);
            const initialEmbed = buildCrashEmbed(currentMultiplier, 'rising', 0);

            const gameMessage = await message.reply({
              embeds: [initialEmbed],
              components: [row]
            });

            // Game state
            let gameEnded = false;
            let tickCount = 0;
            const maxTicks = 10;
            const tickInterval = 1500;

            function getNextMultiplier(current, tick) {
              const increment = 0.10 + (tick * 0.08);
              return Math.round((current + increment) * 100) / 100;
            }

            // Start multiplier ticker
            const ticker = setInterval(async () => {
              if (gameEnded) {
                clearInterval(ticker);
                return;
              }

              tickCount++;
              currentMultiplier = getNextMultiplier(currentMultiplier, tickCount);

              if (currentMultiplier >= crashPoint || tickCount >= maxTicks) {
                gameEnded = true;
                clearInterval(ticker);
                activeCrashGames.delete(gameKey);

                const disabledButton = new ButtonBuilder()
                  .setCustomId(buttonId)
                  .setLabel('Crashed!')
                  .setStyle(ButtonStyle.Danger)
                  .setDisabled(true);
                const disabledRow = new ActionRowBuilder().addComponents(disabledButton);

                const crashEmbed = buildCrashEmbed(currentMultiplier, 'crashed', 0);
                await gameMessage.edit({ embeds: [crashEmbed], components: [disabledRow] }).catch(() => {});
                return;
              }

              // Update embed with rising multiplier
              const updatedButton = new ButtonBuilder()
                .setCustomId(buttonId)
                .setLabel(`Cash Out (${Math.floor(bet * currentMultiplier)} coins)`)
                .setStyle(ButtonStyle.Success)
                .setEmoji('💰');
              const updatedRow = new ActionRowBuilder().addComponents(updatedButton);
              const updatedEmbed = buildCrashEmbed(currentMultiplier, 'rising', 0);
              await gameMessage.edit({ embeds: [updatedEmbed], components: [updatedRow] }).catch(() => {});
            }, tickInterval);

            // Listen for Cash Out button
            const collector = gameMessage.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 16000,
              filter: (i) => i.user.id === userId
            });

            collector.on('collect', async (buttonInteraction) => {
              if (gameEnded) return;

              gameEnded = true;
              clearInterval(ticker);
              activeCrashGames.delete(gameKey);

              const winnings = Math.floor(bet * currentMultiplier);
              await recordCasinoGame(userId, serverId, winnings, true);

              const disabledButton = new ButtonBuilder()
                .setCustomId(buttonId)
                .setLabel(`Cashed Out at ${currentMultiplier.toFixed(2)}x`)
                .setStyle(ButtonStyle.Success)
                .setDisabled(true);
              const disabledRow = new ActionRowBuilder().addComponents(disabledButton);

              const winEmbed = buildCrashEmbed(currentMultiplier, 'cashed_out', winnings);
              await buttonInteraction.update({ embeds: [winEmbed], components: [disabledRow] }).catch(() => {});
            });

            collector.on('end', async () => {
              if (!gameEnded) {
                gameEnded = true;
                clearInterval(ticker);
                activeCrashGames.delete(gameKey);

                const disabledButton = new ButtonBuilder()
                  .setCustomId(buttonId)
                  .setLabel('Timed Out!')
                  .setStyle(ButtonStyle.Danger)
                  .setDisabled(true);
                const disabledRow = new ActionRowBuilder().addComponents(disabledButton);

                const timeoutEmbed = buildCrashEmbed(currentMultiplier, 'timeout', 0);
                await gameMessage.edit({ embeds: [timeoutEmbed], components: [disabledRow] }).catch(() => {});
              }
            });

            return;
          }

          if (commandName === 'mines') {
            let bet = parseInt(args[0]);
            let mineCount = parseInt(args[1]);
            if (isNaN(mineCount)) {
              mineCount = 3; // Default to 3 mines
            }

            if (isNaN(bet) || bet <= 0) {
              return await message.reply('❌ **Usage**: `s mines <bet_amount> [mine_count]` (mines default: 3, range: 1-19)').catch(() => { });
            }

            if (mineCount < 1 || mineCount > 19) {
              return sendTempMessage(message.channel, '❌ Mine count must be between **1** and **19**.');
            }

            // Prevent multiple simultaneous mines games
            const gameKey = `${userId}_${serverId}`;
            if (activeMinesGames.has(gameKey)) {
              return sendTempMessage(message.channel, '❌ You already have an active mines game! Finish it first.');
            }

            // Deduct bet upfront
            const deductResult = await recordCasinoGame(userId, serverId, bet, false);
            if (!deductResult.success) {
              if (deductResult.reason === 'insufficient_funds') {
                const errorEmbed = new EmbedBuilder()
                  .setColor('#ff3366')
                  .setTitle('❌ Insufficient Coins')
                  .setDescription(`You don't have enough coins to place that bet!`)
                  .addFields(
                    { name: 'Your Balance', value: `**${deductResult.currentBalance}** ${currencyIcon} ${currencyName}`, inline: true },
                    { name: 'Attempted Bet', value: `**${bet}** ${currencyIcon} ${currencyName}`, inline: true }
                  )
                  .setTimestamp();
                return await message.reply({ embeds: [errorEmbed] }).catch(() => { });
              }
              throw new Error('Database transaction failed');
            }

            // Generate mine positions
            const totalTiles = 20;
            const minePositions = new Set();
            while (minePositions.size < mineCount) {
              minePositions.add(Math.floor(Math.random() * totalTiles));
            }

            const safeTiles = totalTiles - mineCount;
            const revealedPositions = new Set();
            let currentMultiplier = 0;
            const gameTimestamp = Date.now();

            // Calculate multiplier after k reveals
            function calcMultiplier(reveals) {
              if (reveals === 0) return 0;
              let mult = 0.97;
              for (let i = 0; i < reveals; i++) {
                mult *= (totalTiles - i) / (safeTiles - i);
              }
              return Math.floor(mult * 100) / 100;
            }

            // Build the grid components
            function buildGridComponents(gameOver, hitMine) {
              const rows = [];

              // 4 rows of 5 tile buttons
              for (let row = 0; row < 4; row++) {
                const actionRow = new ActionRowBuilder();
                for (let col = 0; col < 5; col++) {
                  const tileIndex = row * 5 + col;
                  const btn = new ButtonBuilder()
                    .setCustomId(`mines_tile_${tileIndex}_${userId}_${gameTimestamp}`);

                  if (revealedPositions.has(tileIndex)) {
                    // Already revealed safe tile
                    btn.setEmoji('💎').setStyle(ButtonStyle.Success).setDisabled(true);
                  } else if (gameOver && minePositions.has(tileIndex)) {
                    // Game over — reveal mines
                    btn.setEmoji('💣').setStyle(ButtonStyle.Danger).setDisabled(true);
                  } else if (gameOver) {
                    // Game over — unrevealed safe tile
                    btn.setEmoji('⬜').setStyle(ButtonStyle.Secondary).setDisabled(true);
                  } else {
                    // Active unrevealed tile
                    btn.setEmoji('⬜').setStyle(ButtonStyle.Secondary);
                  }

                  // Use label for position hint
                  btn.setLabel(`${tileIndex + 1}`);
                  actionRow.addComponents(btn);
                }
                rows.push(actionRow);
              }

              // Row 5: Cash Out button
              const cashOutRow = new ActionRowBuilder();
              const cashOutBtn = new ButtonBuilder()
                .setCustomId(`mines_cashout_${userId}_${gameTimestamp}`);

              if (gameOver) {
                cashOutBtn.setLabel('Game Over').setStyle(ButtonStyle.Danger).setDisabled(true);
              } else if (revealedPositions.size === 0) {
                const nextMult = calcMultiplier(1);
                cashOutBtn.setLabel(`💰 Cash Out (Next safe: ${nextMult.toFixed(2)}x / ${nextMult.toFixed(2)} times bet)`).setStyle(ButtonStyle.Secondary).setDisabled(true);
              } else {
                const winAmount = Math.floor(bet * currentMultiplier);
                cashOutBtn.setLabel(`💰 Cash Out — ${currentMultiplier.toFixed(2)}x (${winAmount} coins / ${currentMultiplier.toFixed(2)} times bet)`).setStyle(ButtonStyle.Success);
              }
              cashOutRow.addComponents(cashOutBtn);
              rows.push(cashOutRow);

              return rows;
            }

            // Build game embed
            function buildMinesEmbed(state, winnings) {
              const embed = new EmbedBuilder()
                .setAuthor({
                  name: `${message.author.username}'s Mines Game`,
                  iconURL: message.author.displayAvatarURL({ dynamic: true })
                })
                .setTimestamp();

              if (state === 'playing') {
                const nextMult = calcMultiplier(revealedPositions.size + 1);
                embed.setColor('#ffaa00')
                  .setTitle('💣 Mines — Choose a Tile!')
                  .setDescription(
                    `**Bet:** ${bet} ${currencyIcon} ${currencyName}\n` +
                    `**Mines:** ${mineCount} 💣 | **Safe Tiles:** ${safeTiles} 💎\n` +
                    `**Revealed:** ${revealedPositions.size}/${safeTiles}\n` +
                    `**Current Multiplier:** \`${currentMultiplier.toFixed(2)}x\` (${currentMultiplier.toFixed(2)} times bet)\n` +
                    `**Next Safe Click:** \`${nextMult.toFixed(2)}x\` (${nextMult.toFixed(2)} times bet)\n\n` +
                    `Click a numbered tile to reveal it. Avoid the mines!`
                  );
              } else if (state === 'cashed_out') {
                embed.setColor('#00ffaa')
                  .setTitle('💰 Mines — CASHED OUT!')
                  .setDescription(
                    `You escaped with your winnings!\n\n` +
                    `**Bet:** ${bet} ${currencyIcon} ${currencyName}\n` +
                    `**Tiles Revealed:** ${revealedPositions.size} 💎\n` +
                    `**Multiplier:** \`${currentMultiplier.toFixed(2)}x\` (${currentMultiplier.toFixed(2)} times bet)\n` +
                    `**Winnings:** +${winnings} ${currencyIcon} ${currencyName}\n` +
                    `**Net Profit:** +${winnings - bet} ${currencyIcon} ${currencyName}`
                  );
              } else if (state === 'mine_hit') {
                embed.setColor('#ff3366')
                  .setTitle('💥 Mines — BOOM!')
                  .setDescription(
                    `You hit a mine and lost your bet!\n\n` +
                    `**Bet Lost:** -${bet} ${currencyIcon} ${currencyName}\n` +
                    `**Tiles Revealed Before Hit:** ${revealedPositions.size} 💎\n` +
                    `**Mines:** ${mineCount} 💣`
                  );
              } else if (state === 'timeout') {
                embed.setColor('#ff3366')
                  .setTitle('⏰ Mines — TIMED OUT!')
                  .setDescription(
                    `You didn't act in time and lost your bet!\n\n` +
                    `**Bet Lost:** -${bet} ${currencyIcon} ${currencyName}\n` +
                    `*The game auto-ended after 60 seconds of inactivity.*`
                  );
              } else if (state === 'auto_cashout') {
                embed.setColor('#00ffaa')
                  .setTitle('🏆 Mines — ALL TILES CLEARED!')
                  .setDescription(
                    `You revealed every safe tile! Maximum payout!\n\n` +
                    `**Bet:** ${bet} ${currencyIcon} ${currencyName}\n` +
                    `**All ${safeTiles} Safe Tiles Revealed** 💎\n` +
                    `**Multiplier:** \`${currentMultiplier.toFixed(2)}x\` (${currentMultiplier.toFixed(2)} times bet)\n` +
                    `**Winnings:** +${winnings} ${currencyIcon} ${currencyName}\n` +
                    `**Net Profit:** +${winnings - bet} ${currencyIcon} ${currencyName}`
                  );
              }

              return embed;
            }

            // Send initial game message
            const initialEmbed = buildMinesEmbed('playing', 0);
            const initialComponents = buildGridComponents(false, false);

            const gameMessage = await message.reply({
              embeds: [initialEmbed],
              components: initialComponents
            });

            // Store game state
            let gameEnded = false;
            activeMinesGames.set(gameKey, { gameTimestamp });

            // Collector for button interactions
            const collector = gameMessage.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 60000, // 60 second timeout
              filter: (i) => i.user.id === userId && i.customId.includes(`_${userId}_${gameTimestamp}`)
            });

            collector.on('collect', async (buttonInteraction) => {
              if (gameEnded) return;

              const customId = buttonInteraction.customId;

              // Cash Out
              if (customId.startsWith('mines_cashout_')) {
                if (revealedPositions.size === 0) return; // Safety check

                gameEnded = true;
                activeMinesGames.delete(gameKey);
                collector.stop('cashed_out');

                const winnings = Math.floor(bet * currentMultiplier);
                await recordCasinoGame(userId, serverId, winnings, true);

                const winEmbed = buildMinesEmbed('cashed_out', winnings);
                const endComponents = buildGridComponents(true, false);
                await buttonInteraction.update({ embeds: [winEmbed], components: endComponents }).catch(() => {});
                return;
              }

              // Tile click
              if (customId.startsWith('mines_tile_')) {
                const tileIndex = parseInt(customId.split('_')[2]);

                if (revealedPositions.has(tileIndex)) return; // Already revealed

                // Check if mine
                if (minePositions.has(tileIndex)) {
                  gameEnded = true;
                  activeMinesGames.delete(gameKey);
                  collector.stop('mine_hit');

                  // Add to revealed so it shows as a bomb
                  revealedPositions.add(tileIndex);

                  const lossEmbed = buildMinesEmbed('mine_hit', 0);
                  const endComponents = buildGridComponents(true, true);
                  await buttonInteraction.update({ embeds: [lossEmbed], components: endComponents }).catch(() => {});
                  return;
                }

                // Safe tile
                revealedPositions.add(tileIndex);
                currentMultiplier = calcMultiplier(revealedPositions.size);

                // Check if all safe tiles revealed
                if (revealedPositions.size >= safeTiles) {
                  gameEnded = true;
                  activeMinesGames.delete(gameKey);
                  collector.stop('all_cleared');

                  const winnings = Math.floor(bet * currentMultiplier);
                  await recordCasinoGame(userId, serverId, winnings, true);

                  const winEmbed = buildMinesEmbed('auto_cashout', winnings);
                  const endComponents = buildGridComponents(true, false);
                  await buttonInteraction.update({ embeds: [winEmbed], components: endComponents }).catch(() => {});
                  return;
                }

                // Update game display
                const updatedEmbed = buildMinesEmbed('playing', 0);
                const updatedComponents = buildGridComponents(false, false);
                await buttonInteraction.update({ embeds: [updatedEmbed], components: updatedComponents }).catch(() => {});
              }
            });

            collector.on('end', async (collected, reason) => {
              if (!gameEnded) {
                gameEnded = true;
                activeMinesGames.delete(gameKey);

                const timeoutEmbed = buildMinesEmbed('timeout', 0);
                const endComponents = buildGridComponents(true, false);
                await gameMessage.edit({ embeds: [timeoutEmbed], components: endComponents }).catch(() => {});
              }
            });

            return;
          }
        }
      } catch (err) {
        console.error(`Error processing prefix command ${commandName} for user ${userId}:`, err);
        return await message.reply('❌ An error occurred while executing this command.').catch(() => { });
      }

      // Exit early so prefix command messages don't earn activity points
      return;
    }

    // Random drops block has been removed as drops are now handled automatically on a schedule.

    // --- 3. REGULAR CHAT ACTIVITY PROCESSING ---
    const activityControl = await getBotControlState();
    if (activityControl.maintenanceMode || !activityControl.features.messageEarnings) return;

    // Filter and count words (ignoring extra whitespace)
    const words = content.split(/\s+/).filter(Boolean);
    if (words.length < 5) return; // Ignore short messages to prevent spam

    try {
      const result = await recordMessageActivity(
        userId,
        serverId,
        activityControl.messageReward,
        activityControl.messageCooldownSeconds,
        activityControl.messageDailyCap,
        activityControl.messageMilestone
      );

      if (result.success && result.awardedMilestone) {
        console.log(`[Activity Earning] User ${message.author.tag} (${userId}) reached milestone: ${result.totalMessages} messages. Awarded ${result.amountAwarded} coins.`);

        // Find the log channel named 'soul-bot'
        const logChannel = message.guild.channels.cache.find(
          c => c.name.toLowerCase().includes('soul-bot') && c.isTextBased()
        );

        if (logChannel) {
          const settings = await getServerSettings(serverId);
          const currencyName = settings.currency_name;
          const currencyIcon = settings.currency_icon_url;

          const milestoneEmbed = new EmbedBuilder()
            .setColor('#ffd700')
            .setTitle('🎉 Chat Milestone Reached!')
            .setDescription(`Congratulations to ${message.author} for active engagement in the server!`)
            .addFields(
              { name: 'Messages Sent', value: `💬 **${result.totalMessages}** messages`, inline: true },
              { name: 'Milestone Reward', value: `**+${result.amountAwarded}** ${currencyIcon} ${currencyName}`, inline: true },
              { name: 'New Balance', value: `**${result.newBalance}** ${currencyIcon} ${currencyName}`, inline: false }
            )
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

          await logChannel.send({ embeds: [milestoneEmbed] }).catch(err => {
            console.error(`Failed to send milestone message to #soul-bot:`, err);
          });
        }
      }
    } catch (error) {
      console.error(`Error recording message activity for user ${userId} in guild ${serverId}:`, error);
    }
  }
};
