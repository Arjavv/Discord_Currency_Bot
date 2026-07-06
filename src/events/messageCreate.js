const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType
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
  purchaseShopItem
} = require('../database/queries');
const { EmbedBuilder, AttachmentBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

// Track active crash games per user to prevent multiple simultaneous games
const activeCrashGames = new Set();

// Track active mines games per user
const activeMinesGames = new Map();
const path = require('path');
const { activeDrops, triggerDrop, scheduleNextDrop } = require('../utils/drops');

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

      try {
        const settings = await getServerSettings(serverId);
        const currencyName = settings.currency_name;
        const currencyIcon = settings.currency_icon_         // --- 1. ADMIN COMMANDS ---
        if (['setup', 'set-name', 'set-icon', 'reset-cycle', 'set-drop-channel', 'force-drop', 'set-price'].includes(commandName)) {
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

          if (commandName === 'set-name') {
            const newName = args.join(' ');
            if (!newName) {
              return message.reply('❌ **Usage**: `s set-name <new_name>`').catch(() => { });
            }
            const updated = await updateServerSetting(serverId, newName, null);
            const embed = new EmbedBuilder()
              .setColor('#00ffaa')
              .setTitle('⚙️ Setting Updated')
              .setDescription(`Currency name has been successfully updated to **${updated.currency_name}**.`);
            return await message.reply({ embeds: [embed] }).catch(() => { });
          }

          if (commandName === 'set-icon') {
            const newIcon = args[0];
            if (!newIcon) {
              return message.reply('❌ **Usage**: `s set-icon <emoji>`').catch(() => { });
            }
            const updated = await updateServerSetting(serverId, null, newIcon);
            const embed = new EmbedBuilder()
              .setColor('#00ffaa')
              .setTitle('⚙️ Setting Updated')
              .setDescription(`Currency icon has been successfully updated to ${updated.currency_icon_url}.`);
            return await message.reply({ embeds: [embed] }).catch(() => { });
          }

          if (commandName === 'reset-cycle') {
            const result = await resetCycle(serverId);
            const embed = new EmbedBuilder()
              .setColor('#ff3300')
              .setTitle('🔄 Monthly Cycle Reset Completed')
              .setDescription('The current monthly cycle has been successfully closed and reset.')
              .addFields(
                { name: 'Rankings Archived', value: `**${result.archivedCount}** members snapshotted`, inline: true },
                { name: 'Database Action', value: 'Balances set to 0, check-ins cleared', inline: true }
              )
              .setFooter({ text: `Note: rankings were archived under Cycle ID #${result.oldCycleId}` })
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

          if (commandName === 'set-price') {
            const itemId = args[0];
            const priceVal = parseInt(args[1], 10);

            const validItems = ['dumbbell', 'vest', 'shoes', 'tome', 'rage', 'aegis', 'adrenaline', 'mana', 'shield'];
            if (!itemId || !validItems.includes(itemId) || isNaN(priceVal) || priceVal < 0) {
              return message.reply(`❌ **Usage**: \`s set-price <item_id> <price>\`\nValid Item IDs: ${validItems.map(i => `\`${i}\``).join(', ')}`).catch(() => { });
            }

            await setShopPrice(serverId, itemId, priceVal);
            const embed = new EmbedBuilder()
              .setColor('#00ffaa')
              .setTitle('⚙️ Price Updated')
              .setDescription(`The price for **${itemId}** has been set to **${priceVal}** ${currencyIcon} ${currencyName}.`);
            return await message.reply({ embeds: [embed] }).catch(() => { });
          }
        }

        // --- 2. USER COMMANDS ---
        if (['daily', 'checkin', 'claim', 'cash', 'balance', 'bal', 'money', 'leaderboard', 'lb', 'rich', 'flip', 'casino', 'bet', 'crash', 'mines', 'stats', 'profile', 'shop', 'buy', 'fight', 'gift', 'give', 'send', 'transfer', 'help', 'rob', 'steal', 'heist'].includes(commandName)) {
          // Lock user commands to #soul-bot
          if (!message.channel.name.toLowerCase().includes('soul-bot')) {
            return sendTempMessage(message.channel, '❌ This command can only be used in the **#soul-bot** channel.');
          }

          if (['help'].includes(commandName)) {
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
              .setFooter({ text: 'Tip: You also passively earn Souls by chatting in active channels!' })
              .setTimestamp();

            return await message.reply({ embeds: [helpEmbed] }).catch(() => { });
          }

          if (['daily', 'checkin', 'claim'].includes(commandName)) {
            const checkinAmount = Math.floor(Math.random() * (1000 - 500 + 1)) + 500;
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
            const targetUser = message.mentions.users.first() || message.author;
            const isSelf = targetUser.id === message.author.id;
            
            const stats = await getUserStats(targetUser.id, serverId);
            
            const embed = new EmbedBuilder()
              .setAuthor({
                name: `${targetUser.username}'s Profile`,
                iconURL: targetUser.displayAvatarURL({ dynamic: true })
              })
              .setTimestamp();

            if (isSelf) {
              embed.setColor('#ffd700')
                .setTitle('📊 Your Core Stats')
                .setDescription(
                  `⚔️ **Strength:** \`${stats.total.strength}\` (Base: ${stats.base.strength} | Weekly: +${stats.weekly.strength} | Potion: +${stats.activeBuffs.strength})\n` +
                  `🛡️ **Defense:** \`${stats.total.defense}\` (Base: ${stats.base.defense} | Weekly: +${stats.weekly.defense} | Potion: +${stats.activeBuffs.defense})\n` +
                  `⚡ **Speed:** \`${stats.total.speed}\` (Base: ${stats.base.speed} | Weekly: +${stats.weekly.speed} | Potion: +${stats.activeBuffs.speed})\n` +
                  `🔮 **Magic:** \`${stats.total.magic}\` (Base: ${stats.base.magic} | Weekly: +${stats.weekly.magic} | Potion: +${stats.activeBuffs.magic})\n`
                );

              // Add Divine Shield info
              const inventory = await getUserInventory(targetUser.id, serverId);
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
            } else {
              embed.setColor('#777777')
                .setTitle(`📊 ${targetUser.username}'s Core Stats`)
                .setDescription(
                  `⚔️ **Strength:** \`???\`\n` +
                  `🛡️ **Defense:** \`???\`\n` +
                  `⚡ **Speed:** \`???\`\n` +
                  `🔮 **Magic:** \`???\`\n\n` +
                  `*Stats of other players are hidden to keep battles mysterious!*`
                );

              // Show active items (without showing the exact boost numbers)
              if (stats.detailedBoosts.length > 0) {
                const activeNames = [...new Set(stats.detailedBoosts.map(b => {
                  let elixirName = '';
                  if (b.stat_type === 'strength') elixirName = 'Rage Elixir';
                  else if (b.stat_type === 'defense') elixirName = 'Aegis Serum';
                  else if (b.stat_type === 'speed') elixirName = 'Adrenaline Pill';
                  else if (b.stat_type === 'magic') elixirName = 'Mana Elixir';
                  return `🧪 ${elixirName}`;
                }))].join('\n');
                embed.addFields({ name: '🧪 Active Potion Effects', value: activeNames, inline: false });
              }
            }

            return await message.reply({ embeds: [embed] }).catch(() => { });
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
              .setFooter({ text: 'Usage: s buy <item_id> (e.g. s buy dumbbell)' })
              .setTimestamp();

            return await message.reply({ embeds: [embed] }).catch(() => { });
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
              return sendTempMessage(message.channel, `❌ Opponent doesn't have enough coins! ${targetUser.username} needs at least **${bet}** ${currencyIcon} to accept.`);
            }

            const buttonIdAccept = `fight_accept_${userId}_${targetUser.id}_${Date.now()}`;
            const buttonIdDecline = `fight_decline_${userId}_${targetUser.id}_${Date.now()}`;

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(buttonIdAccept).setLabel('Accept Challenge').setStyle(ButtonStyle.Success).setEmoji('⚔️'),
              new ButtonBuilder().setCustomId(buttonIdDecline).setLabel('Decline').setStyle(ButtonStyle.Danger)
            );

            const challengeEmbed = new EmbedBuilder()
              .setColor('#ffaa00')
              .setTitle('⚔️ Duel Challenge!')
              .setDescription(`${message.author} has challenged ${targetUser} to a stat showdown for **${bet}** ${currencyIcon} ${currencyName}!\n\nBoth players' stats in a random category will be compared. Loser gets eliminated!`)
              .setFooter({ text: 'The challenged player has 30 seconds to accept.' })
              .setTimestamp();

            const challengeMsg = await message.reply({ embeds: [challengeEmbed], components: [row] });

            // Button collector
            const collector = challengeMsg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 30000,
              filter: (i) => i.user.id === targetUser.id
            });

            let duelActive = false;

            collector.on('collect', async (buttonInteraction) => {
              if (buttonInteraction.customId === buttonIdDecline) {
                collector.stop('declined');
                return;
              }

              if (buttonInteraction.customId === buttonIdAccept) {
                duelActive = true;
                collector.stop('accepted');
                await buttonInteraction.deferUpdate();

                // Re-verify balances
                const challengerBal = await getUserBalance(userId, serverId);
                const defenderBal = await getUserBalance(targetUser.id, serverId);

                if (challengerBal.balance < bet || defenderBal.balance < bet) {
                  return await challengeMsg.edit({
                    content: '❌ Duel cancelled: One of the players no longer has enough coins.',
                    embeds: [],
                    components: []
                  }).catch(() => {});
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

                // Fetch stats
                const challengerStats = await getUserStats(userId, serverId);
                const defenderStats = await getUserStats(targetUser.id, serverId);

                const cVal = challengerStats.total[category.key];
                const dVal = defenderStats.total[category.key];

                // Showdown animated loading embeds
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

                await challengeMsg.edit({ embeds: [showdownEmbed], components: [] }).catch(() => {});

                // Delay for suspense
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

                    await challengeMsg.edit({ embeds: [tieEmbed] }).catch(() => {});
                  } else {
                    // Winnings pot
                    const pot = bet * 2;
                    await recordCasinoGame(winnerId, serverId, pot, true);

                    const winEmbed = new EmbedBuilder()
                      .setColor('#00ffaa')
                      .setTitle('🏆 DUEL RESULT: VICTORY!')
                      .setDescription(
                        `📊 **Clash Category:** **${category.icon} ${category.name}**\n\n` +
                        `👑 **Winner**: <@${winnerId}> (\`${winVal} ${category.name}\`)\n` +
                        `💀 **Loser**: <@${loserId}> (\`${loseVal} ${category.name}\`)\n\n` +
                        `<@${winnerId}> claimed the pot of **${pot}** ${currencyIcon} ${currencyName}!`
                      )
                      .setTimestamp();

                    await challengeMsg.edit({ embeds: [winEmbed] }).catch(() => {});

                    // Send the kill command for the loser to trigger server gif bot
                    await message.channel.send(`!kill <@${loserId}>`).catch(() => {});
                  }
                }, 3000);
              }
            });

            collector.on('end', async (collected, reason) => {
              if (!duelActive) {
                const expiredEmbed = new EmbedBuilder()
                  .setColor('#555555')
                  .setTitle('⚔️ Challenge Expired')
                  .setDescription(reason === 'declined' ? `The challenge was declined by ${targetUser}.` : `The challenge from ${message.author} was not accepted in time.`)
                  .setTimestamp();
                await challengeMsg.edit({ embeds: [expiredEmbed], components: [] }).catch(() => {});
              }
            });
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
    // Filter and count words (ignoring extra whitespace)
    const words = content.split(/\s+/).filter(Boolean);
    if (words.length < 5) return; // Ignore short messages to prevent spam

    try {
      // Award 100 coins for milestone (every 10 messages), 15 seconds cooldown, daily cap of 5000 coins
      const result = await recordMessageActivity(userId, serverId, 100, 15, 5000);

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
