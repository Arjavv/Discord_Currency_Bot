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
  attemptRob
} = require('../database/queries');
const { EmbedBuilder, AttachmentBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const { activeDrops, triggerDrop, scheduleNextDrop } = require('../utils/drops');

// Helper to send a temporary message that deletes itself after 5 seconds
const sendTempMessage = (channel, content) => {
  channel.send(content).then(msg => {
    setTimeout(() => msg.delete().catch(() => {}), 5000);
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

          await dropMsg.edit({ embeds: [caughtEmbed] }).catch(() => {});
        }

        // Send congratulatory reply
        const congratulateText = `Congratulations ${message.author}! You caught the Soul Coin and added **${drop.value}** <:Soul_Head:1523605643158618214> to your wallet!\n**New Balance**: **${awardResult.newBalance}** <:Soul_Head:1523605643158618214>`;

        await message.reply({ content: congratulateText }).catch(() => {});
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
        const currencyIcon = settings.currency_icon_url;

        // --- 1. ADMIN COMMANDS ---
        if (['setup', 'set-name', 'set-icon', 'reset-cycle', 'set-drop-channel', 'force-drop'].includes(commandName)) {
          // Check administrator permission
          if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You must have Administrator permissions to run admin commands.').catch(() => {});
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
              return message.reply('❌ **Setup Failed**: The bot is missing the **Manage Channels** permission in this server. Please grant this permission to the bot or its role in Server Settings and try again.').catch(() => {});
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

            return await message.reply({ embeds: [embed] }).catch(() => {});
          }

          if (commandName === 'set-name') {
            const newName = args.join(' ');
            if (!newName) {
              return message.reply('❌ **Usage**: `s set-name <new_name>`').catch(() => {});
            }
            const updated = await updateServerSetting(serverId, newName, null);
            const embed = new EmbedBuilder()
              .setColor('#00ffaa')
              .setTitle('⚙️ Setting Updated')
              .setDescription(`Currency name has been successfully updated to **${updated.currency_name}**.`);
            return await message.reply({ embeds: [embed] }).catch(() => {});
          }

          if (commandName === 'set-icon') {
            const newIcon = args[0];
            if (!newIcon) {
              return message.reply('❌ **Usage**: `s set-icon <emoji>`').catch(() => {});
            }
            const updated = await updateServerSetting(serverId, null, newIcon);
            const embed = new EmbedBuilder()
              .setColor('#00ffaa')
              .setTitle('⚙️ Setting Updated')
              .setDescription(`Currency icon has been successfully updated to ${updated.currency_icon_url}.`);
            return await message.reply({ embeds: [embed] }).catch(() => {});
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
            return await message.reply({ embeds: [embed] }).catch(() => {});
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
              return message.reply('❌ **Error**: Channel not found in this server. Usage: `s set-drop-channel [channel_name/mention/id]`').catch(() => {});
            }

            const channelExists = message.guild.channels.cache.get(targetChannelId) || 
                                  await message.guild.channels.fetch(targetChannelId).catch(() => null);

            if (!channelExists || channelExists.type !== ChannelType.GuildText) {
              return message.reply('❌ **Error**: Channel not found or is not a text channel.').catch(() => {});
            }

            await updateDropChannel(serverId, targetChannelId);

            const embed = new EmbedBuilder()
              .setColor('#00ffaa')
              .setTitle('⚙️ Drop Channel Configured')
              .setDescription(`Random Soul Coin drops will now occur in the channel: <#${targetChannelId}>.`)
              .setTimestamp();

            return await message.reply({ embeds: [embed] }).catch(() => {});
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
              return message.reply('❌ **Error**: Drop channel not configured or not found. Please set it using `s set-drop-channel <#channel>` or name a channel `#general`.').catch(() => {});
            }

            const dropResult = await triggerDrop(message.client, serverId, dropChannel);
            if (dropResult) {
              return message.reply(`✅ Successfully triggered a random coin drop in ${dropChannel}!`).catch(() => {});
            } else {
              return message.reply('❌ **Error**: Failed to send drop message. Please check permissions.').catch(() => {});
            }
          }
        }

        // --- 2. USER COMMANDS ---
        if (['daily', 'checkin', 'claim', 'cash', 'balance', 'bal', 'money', 'leaderboard', 'lb', 'rich', 'flip', 'casino', 'bet', 'gift', 'give', 'send', 'transfer', 'help', 'rob', 'steal', 'heist'].includes(commandName)) {
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
                  { name: '🎁 `s gift @user <amount>`', value: 'Send Souls to another user from your wallet.' },
                  { name: '🎰 `s flip <heads/tails> <amount>`', value: 'Flip a coin for double or nothing! Defaults to heads if no choice is given.' },
                  { name: '🥷 `s rob @user`', value: 'Attempt to steal 10% of their wallet (30% success rate). Caught? Pay a 5% fine! (6hr cooldown).' },
                  { name: '🏃‍♂️ `soul`', value: 'Type exactly this word when a Soul Coin drops to catch it before anyone else!' }
                )
                .setFooter({ text: 'Tip: You also passively earn Souls by chatting in active channels!' })
                .setTimestamp();
              
              return await message.reply({ embeds: [helpEmbed] }).catch(() => {});
            }

            if (['daily', 'checkin', 'claim'].includes(commandName)) {
            const checkinAmount = 20;
            const res = await checkInUser(userId, serverId, checkinAmount);

            if (res.success) {
              const embed = new EmbedBuilder()
                .setColor('#00ffaa')
                .setTitle('📅 Daily Check-in Success!')
                .setDescription(`You have claimed your daily reward of **${checkinAmount}** ${currencyIcon} ${currencyName}!`)
                .addFields({ name: 'New Balance', value: `💰 **${res.newBalance}** ${currencyIcon} ${currencyName}` })
                .setTimestamp();
              return await message.reply({ embeds: [embed] }).catch(() => {});
            } else {
              const cooldownHours = (res.cooldownRemainingMs / (1000 * 60 * 60)).toFixed(2);
              const embed = new EmbedBuilder()
                .setColor('#ff3300')
                .setTitle('⏳ Daily Check-in Cooldown')
                .setDescription(`You have already claimed your daily reward today. Please try again in **${cooldownHours}** hours.`)
                .setTimestamp();
              return await message.reply({ embeds: [embed] }).catch(() => {});
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
            return await message.reply({ embeds: [embed] }).catch(() => {});
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
              return await message.reply({ embeds: [embed] }).catch(() => {});
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
              return await message.reply({ embeds: [embed] }).catch(() => {});
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
                return await message.reply({ embeds: [embed] }).catch(() => {});
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
            return await message.reply({ embeds: [embed] }).catch(() => {});
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
              return await message.reply('❌ **Usage**: `s flip <bet_amount>` (defaults to heads) OR `s flip <heads/tails> <bet_amount>`').catch(() => {});
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
              return await message.reply({ embeds: [errorEmbed] }).catch(() => {});
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

            return await message.reply({ content: outputText }).catch(() => {});
          }
        }
      } catch (err) {
        console.error(`Error processing prefix command ${commandName} for user ${userId}:`, err);
        return await message.reply('❌ An error occurred while executing this command.').catch(() => {});
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
      // Award 10 coins for milestone, 15 seconds cooldown, daily cap of 20 coins
      const result = await recordMessageActivity(userId, serverId, 10, 15, 20);

      if (result.success && result.awardedMilestone) {
        console.log(`[Activity Earning] User ${message.author.tag} (${userId}) reached milestone: ${result.totalMessages} messages. Awarded ${result.amountAwarded} coins.`);

        // Find the log channel named 'soul-bot'
        const logChannel = message.guild.channels.cache.find(
          c => c.name.toLowerCase() .includes('soul-bot') && c.isTextBased()
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
