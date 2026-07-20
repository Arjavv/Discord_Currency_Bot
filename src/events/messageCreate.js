const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle
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
  updateServerChannels,
  awardDropCoins,
  transferCoins,
  attemptRob,
  getUserStats,
  getShopPrices,
  setShopPrice,
  getUserInventory,
  addCharacterToInventory,
  sellCharacter,
  giftCharacter,
  purchaseShopItem,
  recordDuelLoss,
  getGlobalSettings,
  getTreasury,
  updateTreasuryRates,
  applyDailyTaxIfDue,
  applyServerVaultTaxIfDue,
  getFluctuatingTaxRate
} = require('../database/queries');
const { EmbedBuilder, AttachmentBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

// Track active crash games per user to prevent multiple simultaneous games
const activeCrashGames = new Set();

// Track active mines games per user
const activeMinesGames = new Map();
// Track active blackjack games per user
const activeBlackjackGames = new Set();
const path = require('path');
const fs = require('fs');
const { activeDrops, triggerDrop, scheduleNextDrop } = require('../utils/drops');
const { CHARACTER_SPAWNS } = require('../utils/characters');
const { renderInventoryImage } = require('../utils/inventoryRenderer');
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

async function startFlipGame(userId, serverId, bet, choice, replyTarget, user, currencyIcon, currencyName) {
  const isInteraction = typeof replyTarget.editReply === 'function';

  // Rig the flip to a 30% win chance
  const isWin = Math.random() < 0.30;
  const flipResult = isWin ? choice : (choice === 'heads' ? 'tails' : 'heads');

  const result = await recordCasinoGame(userId, serverId, bet, isWin);

  const capitalizedChoice = choice.charAt(0).toUpperCase() + choice.slice(1);
  const capitalizedResult = flipResult.charAt(0).toUpperCase() + flipResult.slice(1);

  const displayChoice = choice === 'heads' ? '<:Soul_Head:1523605643158618214>' : '<:Soul_Tail:1523605605787373610>';
  const displayResult = flipResult === 'heads' ? '<:Soul_Head:1523605643158618214>' : '<:Soul_Tail:1523605605787373610>';

  let outputText = `**${user.username}** spent <:Soul_Head:1523605643158618214> **${bet}** and chose **${choice}**\n`;
  if (isWin) {
    const payout = bet * 2 - (result.taxAmount || 0);
    outputText += `The coin spins... ${displayResult} and you won <:Soul_Head:1523605643158618214> **${payout}**!!`;
    if (result.taxAmount > 0) {
      outputText += ` *(Reaper's Cut: **${result.taxAmount}** Souls siphoned to the Soul Vault)*`;
    }
  } else {
    outputText += `The coin spins... ${displayResult} and you lost it all...`;
  }

  if (isInteraction) {
    return await replyTarget.editReply({ content: outputText });
  } else {
    return await replyTarget.reply({ content: outputText });
  }
}

async function startCrashGame(userId, serverId, bet, replyTarget, user, currencyIcon, currencyName) {
  const isInteraction = typeof replyTarget.editReply === 'function';

  // Prevent multiple simultaneous crash games per user
  const gameKey = `${userId}_${serverId}`;
  if (activeCrashGames.has(gameKey)) {
    const errMsg = '❌ You already have an active crash game! Finish it first.';
    if (isInteraction) {
      return await replyTarget.editReply({ content: errMsg, embeds: [], components: [] }).catch(() => {});
    } else {
      return sendTempMessage(replyTarget.channel, errMsg);
    }
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
      if (isInteraction) {
        return await replyTarget.editReply({ embeds: [errorEmbed], components: [] }).catch(() => {});
      } else {
        return await replyTarget.reply({ embeds: [errorEmbed] }).catch(() => {});
      }
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
  function buildCrashEmbed(multiplier, state, winnings, taxAmount = 0) {
    const embed = new EmbedBuilder()
      .setAuthor({
        name: `${user.username}'s Crash Game`,
        iconURL: user.displayAvatarURL({ dynamic: true })
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
      const profit = winnings - bet;
      const netProfit = profit - taxAmount;
      const netPayout = winnings - taxAmount;
      embed.setColor('#00ffaa')
        .setTitle('💰 Crash — CASHED OUT!')
        .setDescription(
          `You cashed out just in time!\n\n` +
          `### ✅ Cashed Out At: \`${multiplier.toFixed(2)}x\`\n\n` +
          `${progressBar}\n\n` +
          `**Bet:** ${bet} ${currencyIcon} ${currencyName}\n` +
          `**Winnings (Payout):** +${netPayout} ${currencyIcon} ${currencyName}\n` +
          `**Net Profit:** +${netProfit} ${currencyIcon} ${currencyName}\n` +
          (taxAmount > 0 ? `*Reaper's Cut: **${taxAmount}** Souls siphoned to the Soul Vault.*\n\n` : '') +
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

  const gameMessage = isInteraction
    ? await replyTarget.editReply({ embeds: [initialEmbed], components: [row] })
    : await replyTarget.reply({ embeds: [initialEmbed], components: [row] });

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
    const result = await recordCasinoGame(userId, serverId, winnings, true, true, bet);

    const disabledButton = new ButtonBuilder()
      .setCustomId(buttonId)
      .setLabel(`Cashed Out at ${currentMultiplier.toFixed(2)}x`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(true);
    const disabledRow = new ActionRowBuilder().addComponents(disabledButton);

    const winEmbed = buildCrashEmbed(currentMultiplier, 'cashed_out', winnings, result.taxAmount || 0);
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
}

async function startBlackjackGame(userId, serverId, bet, replyTarget, user, currencyIcon, currencyName) {
  const isInteraction = typeof replyTarget.editReply === 'function';

  // Prevent multiple simultaneous blackjack games
  const gameKey = `${userId}_${serverId}`;
  if (activeBlackjackGames.has(gameKey)) {
    const errMsg = '❌ You already have an active blackjack game! Finish it first.';
    if (isInteraction) {
      return await replyTarget.editReply({ content: errMsg, embeds: [], components: [] }).catch(() => {});
    } else {
      return sendTempMessage(replyTarget.channel, errMsg);
    }
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
      if (isInteraction) {
        return await replyTarget.editReply({ embeds: [errorEmbed], components: [] }).catch(() => {});
      } else {
        return await replyTarget.reply({ embeds: [errorEmbed] }).catch(() => {});
      }
    }
    throw new Error('Database transaction failed');
  }

  activeBlackjackGames.add(gameKey);

  const suits = ['♠️', '♥️', '♦️', '♣️'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  
  const deck = [];
  for (const s of suits) {
    for (const r of ranks) {
      let val = parseInt(r);
      if (['J', 'Q', 'K'].includes(r)) val = 10;
      if (r === 'A') val = 11;
      deck.push({ rank: r, suit: s, value: val });
    }
  }
  
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const playerHand = [deck.pop(), deck.pop()];
  const dealerHand = [deck.pop(), deck.pop()];
  let gameEnded = false;
  let winnings = 0;
  let doubleDownBet = bet;
  const gameTimestamp = Date.now();

  function calculateHand(hand) {
    let value = 0;
    let aces = 0;
    for (const card of hand) {
      value += card.value;
      if (card.rank === 'A') aces++;
    }
    while (value > 21 && aces > 0) {
      value -= 10;
      aces--;
    }
    return value;
  }

  function buildBlackjackEmbed(state, playerDone = false, taxAmount = 0) {
    const playerVal = calculateHand(playerHand);
    const dealerVal = playerDone ? calculateHand(dealerHand) : calculateHand([dealerHand[0]]);
    
    const embed = new EmbedBuilder()
      .setAuthor({
        name: `${user.username}'s Blackjack Game`,
        iconURL: user.displayAvatarURL({ dynamic: true })
      })
      .setTimestamp();
      
    const playerCardStr = playerHand.map(c => `\`[ ${c.rank}${c.suit} ]\``).join(' ');
    const dealerCardStr = playerDone 
      ? dealerHand.map(c => `\`[ ${c.rank}${c.suit} ]\``).join(' ')
      : `\`[ ${dealerHand[0].rank}${dealerHand[0].suit} ]\` \`[  ?  ]\``;
      
    embed.addFields(
      { name: `Dealer's Hand (Score: ${playerDone ? dealerVal : '?'})`, value: dealerCardStr, inline: false },
      { name: `Your Hand (Score: ${playerVal})`, value: playerCardStr, inline: false }
    );
    
    const bannerPath = path.join(__dirname, '..', 'assets', 'blackjack_banner.png');
    if (fs.existsSync(bannerPath)) {
      embed.setImage('attachment://blackjack_banner.png');
    }
    
    if (state === 'playing') {
      embed.setColor('#7d00ff')
        .setTitle('🃏 Blackjack — Hit, Stand, or Double Down!')
        .setDescription(`**Bet:** ${doubleDownBet} ${currencyIcon} ${currencyName}\n\n*Choose your next move using the buttons below.*`);
    } else if (state === 'player_win' || state === 'natural_win') {
      const profit = winnings - doubleDownBet;
      const netProfit = profit - taxAmount;
      const netPayout = winnings - taxAmount;
      embed.setColor('#00ffaa')
        .setTitle(state === 'natural_win' ? '🏆 Blackjack — NATURAL BLACKJACK!' : '💰 Blackjack — YOU WON!')
        .setDescription(
          `**Result:** Player wins!\n` +
          `**Bet:** ${doubleDownBet} ${currencyIcon} ${currencyName}\n` +
          `**Winnings (Payout):** +${netPayout} ${currencyIcon} ${currencyName} **(${(winnings / doubleDownBet).toFixed(2)}x)**\n` +
          `**Net Profit:** +${netProfit} ${currencyIcon} ${currencyName}\n` +
          (taxAmount > 0 ? `*Reaper's Cut: **${taxAmount}** Souls siphoned to the Soul Vault.*\n` : '')
        );
    } else if (state === 'dealer_win' || state === 'player_bust') {
      embed.setColor('#ff3366')
        .setTitle(state === 'player_bust' ? '💥 Blackjack — BUSTED!' : '❌ Blackjack — DEALER WINS')
        .setDescription(
          `**Result:** ${state === 'player_bust' ? 'You busted (>21) and lost!' : 'Dealer wins!'}\n` +
          `**Bet Lost:** -${doubleDownBet} ${currencyIcon} ${currencyName}`
        );
    } else if (state === 'push') {
      embed.setColor('#fbbf24')
        .setTitle('👔 Blackjack — PUSH (TIE)')
        .setDescription(
          `**Result:** It's a push (tie). Your bet has been returned!\n` +
          `**Returned:** ${doubleDownBet} ${currencyIcon} ${currencyName}`
        );
    } else if (state === 'timeout') {
      embed.setColor('#ff3366')
        .setTitle('⏰ Blackjack — TIMED OUT!')
        .setDescription(`You took too long to play. Your bet of **${doubleDownBet}** ${currencyName} was lost.`);
    }
    
    return embed;
  }

  // Setup buttons
  const hitButton = new ButtonBuilder()
    .setCustomId(`bj_hit_${userId}_${gameTimestamp}`)
    .setLabel('Hit')
    .setStyle(ButtonStyle.Success)
    .setEmoji('🟢');

  const standButton = new ButtonBuilder()
    .setCustomId(`bj_stand_${userId}_${gameTimestamp}`)
    .setLabel('Stand')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔴');

  const doubleButton = new ButtonBuilder()
    .setCustomId(`bj_double_${userId}_${gameTimestamp}`)
    .setLabel('Double Down')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🔵');

  // Check if player can double down (must have enough balance to cover another bet)
  const userBal = await getUserBalance(userId, serverId);
  const canDouble = userBal.balance >= bet;
  if (!canDouble) {
    doubleButton.setDisabled(true);
  }

  const row = new ActionRowBuilder().addComponents(hitButton, standButton, doubleButton);

  const initialEmbed = buildBlackjackEmbed('playing', false);

  const files = [];
  const bannerPath = path.join(__dirname, '..', 'assets', 'blackjack_banner.png');
  if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: 'blackjack_banner.png' }));
  }

  const gameMessage = isInteraction
    ? await replyTarget.editReply({ embeds: [initialEmbed], components: [row], files })
    : await replyTarget.reply({ embeds: [initialEmbed], components: [row], files });

  // Check initial naturals
  const initialPlayerVal = calculateHand(playerHand);
  const initialDealerVal = calculateHand(dealerHand);

  if (initialPlayerVal === 21) {
    gameEnded = true;
    activeBlackjackGames.delete(gameKey);
    
    let state = 'natural_win';
    if (initialDealerVal === 21) {
      state = 'push';
      winnings = bet;
      await recordCasinoGame(userId, serverId, winnings, true, false, 0);
    } else {
      winnings = Math.floor(bet * 2.5); // 3:2 payout (returns original bet + 1.5x profit)
      const result = await recordCasinoGame(userId, serverId, winnings, true, true, bet);
      
      const endEmbed = buildBlackjackEmbed('natural_win', true, result.taxAmount || 0);
      const disabledRow = new ActionRowBuilder().addComponents(
        hitButton.setDisabled(true),
        standButton.setDisabled(true),
        doubleButton.setDisabled(true)
      );
      await gameMessage.edit({ embeds: [endEmbed], components: [disabledRow] }).catch(() => {});
      return;
    }
    
    const endEmbed = buildBlackjackEmbed(state, true, 0);
    const disabledRow = new ActionRowBuilder().addComponents(
      hitButton.setDisabled(true),
      standButton.setDisabled(true),
      doubleButton.setDisabled(true)
    );
    await gameMessage.edit({ embeds: [endEmbed], components: [disabledRow] }).catch(() => {});
    return;
  }

  const collector = gameMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000,
    filter: (i) => i.user.id === userId && i.customId.includes(`_${userId}_${gameTimestamp}`)
  });

  async function runDealerTurn(buttonInteraction) {
    gameEnded = true;
    collector.stop('dealer_turn');
    activeBlackjackGames.delete(gameKey);
    
    let dealerScore = calculateHand(dealerHand);
    while (dealerScore < 17) {
      dealerHand.push(deck.pop());
      dealerScore = calculateHand(dealerHand);
    }
    
    const playerScore = calculateHand(playerHand);
    let state = 'push';
    
    if (dealerScore > 21) {
      state = 'player_win';
      winnings = doubleDownBet * 2;
    } else if (playerScore > dealerScore) {
      state = 'player_win';
      winnings = doubleDownBet * 2;
    } else if (playerScore < dealerScore) {
      state = 'dealer_win';
      winnings = 0;
    } else {
      state = 'push';
      winnings = doubleDownBet;
    }
    
    let taxAmount = 0;
    if (state === 'player_win') {
      const result = await recordCasinoGame(userId, serverId, winnings, true, true, doubleDownBet);
      taxAmount = result.taxAmount || 0;
    } else if (state === 'push') {
      await recordCasinoGame(userId, serverId, winnings, true, false, 0);
    }
    
    const endEmbed = buildBlackjackEmbed(state, true, taxAmount);
    const disabledRow = new ActionRowBuilder().addComponents(
      hitButton.setDisabled(true),
      standButton.setDisabled(true),
      doubleButton.setDisabled(true)
    );
    
    if (buttonInteraction) {
      await buttonInteraction.update({ embeds: [endEmbed], components: [disabledRow] }).catch(() => {});
    } else {
      await gameMessage.edit({ embeds: [endEmbed], components: [disabledRow] }).catch(() => {});
    }
  }

  collector.on('collect', async (buttonInteraction) => {
    if (gameEnded) return;

    const customId = buttonInteraction.customId;

    if (customId.startsWith('bj_hit_')) {
      playerHand.push(deck.pop());
      const score = calculateHand(playerHand);
      
      if (score > 21) {
        // Player busts
        gameEnded = true;
        collector.stop('player_bust');
        activeBlackjackGames.delete(gameKey);
        
        const bustEmbed = buildBlackjackEmbed('player_bust', true, 0);
        const disabledRow = new ActionRowBuilder().addComponents(
          hitButton.setDisabled(true),
          standButton.setDisabled(true),
          doubleButton.setDisabled(true)
        );
        await buttonInteraction.update({ embeds: [bustEmbed], components: [disabledRow] }).catch(() => {});
        return;
      }
      
      // Update double button state (disable after hit)
      const currentEmbed = buildBlackjackEmbed('playing', false);
      const updatedRow = new ActionRowBuilder().addComponents(
        hitButton,
        standButton,
        doubleButton.setDisabled(true)
      );
      await buttonInteraction.update({ embeds: [currentEmbed], components: [updatedRow] }).catch(() => {});
    }

    if (customId.startsWith('bj_stand_')) {
      await runDealerTurn(buttonInteraction);
    }

    if (customId.startsWith('bj_double_')) {
      // Deduct the additional bet
      const doubleDeduct = await recordCasinoGame(userId, serverId, bet, false);
      if (!doubleDeduct.success) {
        return await buttonInteraction.reply({ content: '❌ Insufficient funds to double down!', ephemeral: true }).catch(() => {});
      }
      
      doubleDownBet = bet * 2;
      playerHand.push(deck.pop());
      
      const score = calculateHand(playerHand);
      if (score > 21) {
        gameEnded = true;
        collector.stop('player_bust');
        activeBlackjackGames.delete(gameKey);
        
        const bustEmbed = buildBlackjackEmbed('player_bust', true, 0);
        const disabledRow = new ActionRowBuilder().addComponents(
          hitButton.setDisabled(true),
          standButton.setDisabled(true),
          doubleButton.setDisabled(true)
        );
        await buttonInteraction.update({ embeds: [bustEmbed], components: [disabledRow] }).catch(() => {});
        return;
      }
      
      await runDealerTurn(buttonInteraction);
    }
  });

  collector.on('end', async (collected, reason) => {
    if (!gameEnded) {
      gameEnded = true;
      activeBlackjackGames.delete(gameKey);

      const timeoutEmbed = buildBlackjackEmbed('timeout', true, 0);
      const disabledRow = new ActionRowBuilder().addComponents(
        hitButton.setDisabled(true),
        standButton.setDisabled(true),
        doubleButton.setDisabled(true)
      );
      await gameMessage.edit({ embeds: [timeoutEmbed], components: [disabledRow] }).catch(() => {});
    }
  });
}

async function startMinesGame(userId, serverId, bet, mineCount, replyTarget, user, currencyIcon, currencyName) {
  const isInteraction = typeof replyTarget.editReply === 'function';

  // Prevent multiple simultaneous mines games
  const gameKey = `${userId}_${serverId}`;
  if (activeMinesGames.has(gameKey)) {
    const errMsg = '❌ You already have an active mines game! Finish it first.';
    if (isInteraction) {
      return await replyTarget.editReply({ content: errMsg, embeds: [], components: [] }).catch(() => {});
    } else {
      return sendTempMessage(replyTarget.channel, errMsg);
    }
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
      if (isInteraction) {
        return await replyTarget.editReply({ embeds: [errorEmbed], components: [] }).catch(() => {});
      } else {
        return await replyTarget.reply({ embeds: [errorEmbed] }).catch(() => {});
      }
    }
    throw new Error('Database transaction failed');
  }

  // Generate board
  const boardSize = 20;
  const board = Array(boardSize).fill('safe'); // 'safe' or 'mine'
  
  // Randomly place mines
  let placedMines = 0;
  while (placedMines < mineCount) {
    const idx = Math.floor(Math.random() * boardSize);
    if (board[idx] !== 'mine') {
      board[idx] = 'mine';
      placedMines++;
    }
  }

  const revealed = Array(boardSize).fill(false);
  let safeTiles = 0;
  const totalSafeTiles = boardSize - mineCount;
  let winnings = bet;
  
  // Multiplier formulas for Mines
  function getNextPayout(revealedCount) {
    if (revealedCount === 0) return bet;
    let multiplier = 1.0;
    for (let i = 0; i < revealedCount; i++) {
      multiplier *= (20 - i) / (20 - i - mineCount);
    }
    multiplier *= Math.pow(0.98, revealedCount);
    return Math.floor(bet * multiplier);
  }

  const gameTimestamp = Date.now();

  function buildGridComponents(disabledState = false, showAll = false) {
    const rows = [];
    for (let r = 0; r < 4; r++) { // 4 rows of 5 buttons (20 buttons total)
      const row = new ActionRowBuilder();
      for (let c = 0; c < 5; c++) {
        const idx = r * 5 + c;
        const button = new ButtonBuilder();
        
        if (revealed[idx]) {
          if (board[idx] === 'mine') {
            button.setEmoji('💣').setStyle(ButtonStyle.Danger);
          } else {
            button.setEmoji('💎').setStyle(ButtonStyle.Primary);
          }
        } else {
          if (showAll && board[idx] === 'mine') {
            button.setEmoji('💣').setStyle(ButtonStyle.Danger);
          } else {
            button.setLabel(`${idx + 1}`).setStyle(ButtonStyle.Secondary);
          }
        }
        
        button.setCustomId(`mines_tile_${idx}_${userId}_${gameTimestamp}`)
          .setDisabled(disabledState);
        row.addComponents(button);
      }
      rows.push(row);
    }

    if (!disabledState && safeTiles > 0) {
      const nextPayout = getNextPayout(safeTiles);
      const cashOutButton = new ButtonBuilder()
        .setCustomId(`mines_cashout_${userId}_${gameTimestamp}`)
        .setLabel(`Cash Out (${nextPayout} coins)`)
        .setStyle(ButtonStyle.Success)
        .setEmoji('💰');
      
      const controlRow = new ActionRowBuilder().addComponents(cashOutButton);
      rows.push(controlRow);
    }

    return rows;
  }

  function buildMinesEmbed(state, winningsValue, taxAmount = 0) {
    const embed = new EmbedBuilder()
      .setAuthor({
        name: `${user.username}'s Mines Game`,
        iconURL: user.displayAvatarURL({ dynamic: true })
      })
      .setTimestamp();

    if (state === 'playing') {
      const nextPay = getNextPayout(safeTiles + 1);
      const currentMult = (winnings / bet).toFixed(2);
      const nextMult = (nextPay / bet).toFixed(2);
      embed.setColor('#ffaa00')
        .setTitle('💣 Mines — Choose a Tile!')
        .setDescription(
          `**Mines:** ${mineCount} 💣 | **Safe Tiles:** ${safeTiles} 💎\n` +
          `**Current Value:** ${winnings} ${currencyIcon} ${currencyName} **(${currentMult}x)**\n` +
          `**Next Tile Value:** ${nextPay} ${currencyIcon} ${currencyName} **(${nextMult}x)**\n\n` +
          `Click a numbered tile to reveal it. Avoid the mines!`
        );
    } else if (state === 'cashed_out' || state === 'auto_cashout') {
      const profit = winningsValue - bet;
      const netProfit = profit - taxAmount;
      const netPayout = winningsValue - taxAmount;
      const mult = (winningsValue / bet).toFixed(2);
      embed.setColor('#00ffaa')
        .setTitle('💰 Mines — CASHED OUT!')
        .setDescription(
          `You successfully cashed out!\n\n` +
          `**Mines:** ${mineCount} 💣 | **Safe Tiles:** ${safeTiles} 💎\n` +
          `**Bet:** ${bet} ${currencyIcon} ${currencyName}\n` +
          `**Winnings (Payout):** +${netPayout} ${currencyIcon} ${currencyName} **(${mult}x)**\n` +
          `**Net Profit:** +${netProfit} ${currencyIcon} ${currencyName}\n` +
          (taxAmount > 0 ? `*Reaper's Cut: **${taxAmount}** Souls siphoned to the Soul Vault.*\n\n` : '') +
          `*All mine positions have been revealed below.*`
        );
    } else if (state === 'mine_hit') {
      embed.setColor('#ff3366')
        .setTitle('💥 Mines — BOOM!')
        .setDescription(
          `You hit a mine!\n\n` +
          `**Mines:** ${mineCount} 💣\n` +
          `**Bet Lost:** -${bet} ${currencyIcon} ${currencyName}\n\n` +
          `*All mine positions have been revealed below.*`
        );
    } else if (state === 'timeout') {
      embed.setColor('#ff3366')
        .setTitle('⏰ Mines — TIMED OUT!')
        .setDescription(
          `You were inactive for too long!\n\n` +
          `**Bet Lost:** -${bet} ${currencyIcon} ${currencyName}\n\n` +
          `*The game auto-ended due to inactivity.*`
        );
    } else if (state === 'all_cleared') {
      const profit = winningsValue - bet;
      const netProfit = profit - taxAmount;
      const netPayout = winningsValue - taxAmount;
      const mult = (winningsValue / bet).toFixed(2);
      embed.setColor('#fbbf24')
        .setTitle('🏆 Mines — ALL TILES CLEARED!')
        .setDescription(
          `Incredible! You cleared all safe tiles!\n\n` +
          `**Mines:** ${mineCount} 💣 | **Safe Tiles:** ${safeTiles} 💎\n` +
          `**Bet:** ${bet} ${currencyIcon} ${currencyName}\n` +
          `**Winnings (Payout):** +${netPayout} ${currencyIcon} ${currencyName} **(${mult}x)**\n` +
          `**Net Profit:** +${netProfit} ${currencyIcon} ${currencyName}\n` +
          (taxAmount > 0 ? `*Reaper's Cut: **${taxAmount}** Souls siphoned to the Soul Vault.*\n\n` : '')
        );
    }

    return embed;
  }

  // Send initial game message
  const initialEmbed = buildMinesEmbed('playing', 0);
  const initialComponents = buildGridComponents(false, false);

  const gameMessage = isInteraction
    ? await replyTarget.editReply({ embeds: [initialEmbed], components: initialComponents })
    : await replyTarget.reply({ embeds: [initialEmbed], components: initialComponents });

  // Store game state
  let gameEnded = false;
  activeMinesGames.set(gameKey, { gameTimestamp });

  // Collector for button interactions
  const collector = gameMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60000,
    filter: (i) => i.user.id === userId && i.customId.includes(`_${userId}_${gameTimestamp}`)
  });

  collector.on('collect', async (buttonInteraction) => {
    if (gameEnded) return;

    const customId = buttonInteraction.customId;

    if (customId.startsWith('mines_cashout_')) {
      gameEnded = true;
      collector.stop('cashed_out');
      activeMinesGames.delete(gameKey);

      const result = await recordCasinoGame(userId, serverId, winnings, true, true, bet);

      const winEmbed = buildMinesEmbed('cashed_out', winnings, result.taxAmount || 0);
      const endComponents = buildGridComponents(true, true);
      await buttonInteraction.update({ embeds: [winEmbed], components: endComponents }).catch(() => {});
      return;
    }

    if (customId.startsWith('mines_tile_')) {
      const parts = customId.split('_');
      const tileIndex = parseInt(parts[2], 10);

      if (revealed[tileIndex]) {
        return await buttonInteraction.reply({ content: '❌ This tile is already revealed!', ephemeral: true }).catch(() => {});
      }

      revealed[tileIndex] = true;

      if (board[tileIndex] === 'mine') {
        gameEnded = true;
        collector.stop('mine_hit');
        activeMinesGames.delete(gameKey);

        const lossEmbed = buildMinesEmbed('mine_hit', 0);
        const endComponents = buildGridComponents(true, true);
        await buttonInteraction.update({ embeds: [lossEmbed], components: endComponents }).catch(() => {});
        return;
      } else {
        safeTiles++;
        winnings = getNextPayout(safeTiles);

        if (safeTiles === totalSafeTiles) {
          gameEnded = true;
          collector.stop('all_cleared');
          activeMinesGames.delete(gameKey);

          const result = await recordCasinoGame(userId, serverId, winnings, true, true, bet);
          const winEmbed = buildMinesEmbed('all_cleared', winnings, result.taxAmount || 0);
          const endComponents = buildGridComponents(true, true);
          await buttonInteraction.update({ embeds: [winEmbed], components: endComponents }).catch(() => {});
          return;
        }

        const updatedEmbed = buildMinesEmbed('playing', 0);
        const updatedComponents = buildGridComponents(false, false);
        await buttonInteraction.update({ embeds: [updatedEmbed], components: updatedComponents }).catch(() => {});
      }
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
}

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(message) {
    // Ignore bots and direct messages (DMs)
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const userId = message.author.id;
    const serverId = message.guild.id;

    // Log incoming message for debugging
    console.log(`[Msg] User: ${message.author.tag} (${userId}) | Ch: #${message.channel.name} (${message.channel.id}) | Content: "${content}"`);

    // Log bot permissions in this channel
    try {
      const botMember = message.guild.members.me || await message.guild.members.fetch(message.client.user.id).catch(() => null);
      if (botMember) {
        const perms = message.channel.permissionsFor(botMember);
        console.log(`[Perms] SendMessages: ${perms.has(PermissionFlagsBits.SendMessages)} | EmbedLinks: ${perms.has(PermissionFlagsBits.EmbedLinks)} | AttachFiles: ${perms.has(PermissionFlagsBits.AttachFiles)} | UseExternalEmojis: ${perms.has(PermissionFlagsBits.UseExternalEmojis)}`);
      }
    } catch (permErr) {
      console.error('[Perms Check Error]', permErr);
    }

    // --- DROP CATCH INTERCEPT ---
    let normalized = content.replace(/[*_~`|]/g, '');
    normalized = normalized.replace(/<a?:\w+:\d+>/g, '');
    const catchWords = normalized.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .trim()
      .split(/\s+/);

    const firstWord = catchWords[0];
    const secondWord = catchWords[1];
    const isSoulCatch = 
      (firstWord === 'soul' && !secondWord) || 
      (firstWord === 's' && secondWord === 'soul' && catchWords.length === 2);

    if (isSoulCatch) {
      let reactEmoji = null;
      if (message.guild) {
        try {
          reactEmoji = message.guild.emojis.cache.find(e => e.name === 'soul_react');
          if (!reactEmoji) {
            // Check client-wide emoji cache across all guilds the bot belongs to
            reactEmoji = message.client.emojis.cache.find(e => e.name === 'soul_react');
          }
          if (!reactEmoji) {
            const imgPath = path.join(__dirname, '../../docs/assets/soul_react.jpg');
            if (fs.existsSync(imgPath)) {
              reactEmoji = await message.guild.emojis.create({ attachment: imgPath, name: 'soul_react' });
              console.log(`[EMOJI] Created custom emoji soul_react in guild ${message.guild.name}`);
            }
          }
        } catch (err) {
          console.warn(`[EMOJI] Could not resolve/create custom emoji 'soul_react' in guild:`, err.message);
        }
      }

      if (reactEmoji) {
        await message.react(reactEmoji).catch(() => {});
      } else {
        // Fallback to random troll emoji if custom emoji creation is blocked
        const trollEmojis = ['🤡', '😂', '💀', '🤣', '🤫'];
        const randomEmoji = trollEmojis[Math.floor(Math.random() * trollEmojis.length)];
        await message.react(randomEmoji).catch(() => {});
      }

      // If there is an active drop, claim it
      if (activeDrops.has(message.channel.id)) {
        const dropControl = await getBotControlState(serverId);
        if (dropControl.maintenanceMode || !dropControl.features.drops) {
          return;
        }

        const drop = activeDrops.get(message.channel.id);
        activeDrops.delete(message.channel.id);

        scheduleNextDrop(message.client, serverId, message.channel.id);

        if (drop.timeoutId) {
          clearTimeout(drop.timeoutId);
        }

        try {
          const settings = await getServerSettings(serverId);
          const currencyName = settings.currency_name;
          const currencyIcon = settings.currency_icon_url;
          let character = drop.character;
          if (!character) {
            character = {
              id: 'divine_soul',
              name: 'Divine Soul',
              tier: 'DIVINE',
              value: drop.value || 700,
              color: '#a855f7',
              claimTitle: 'DIVINE SOUL CLAIMED!',
              claimDescription: (userMention) => `${userMention} captured Divine Soul 💜\n\n✦ The divine soul has chosen its master.`
            };
          }

          const newQty = await addCharacterToInventory(userId, character.id);

          const dropMsg = await message.channel.messages.fetch(drop.messageId).catch(() => null);
          if (dropMsg) {
            const caughtContent = `🎉 **CLAIMED** ── **${message.author.username}** captured **${character.name}**!`;
            await dropMsg.edit({ content: caughtContent, embeds: [], attachments: [], files: [] }).catch(() => { });
          }

          const claimText = typeof character.claimDescription === 'function'
            ? character.claimDescription(message.author)
            : (typeof character.claimDescription === 'string'
                ? character.claimDescription.replace('{userMention}', String(message.author))
                : `${message.author} captured ${character.name}!`);
          const congratulateText = 
            `**${character.tier} SOUL CLAIMED!**\n` +
            `> ${claimText.replace(/\n/g, '\n> ')}\n\n` +
            `🎒 **Saved to Inventory!** Type \`s inv\` to see your collection. (Quantity: \`${newQty}\` | Sell Value: \`${drop.value}\` ${currencyIcon} ${currencyName})`;

          await message.reply({ content: congratulateText, embeds: [] }).catch(() => { });
        } catch (err) {
          console.error(`Error claiming drop for user ${userId}:`, err);
        }
      }

      return;
    }

    // Check if the message is a prefix command (starts with "s " case-insensitive)
    if (content.toLowerCase().startsWith('s ')) {
      const args = content.slice(2).trim().split(/\s+/);
      const commandName = args.shift().toLowerCase();
      console.log(`[Command Trigger] prefix: "s", command: "${commandName}", args:`, args);

      const VALID_PREFIX_COMMANDS = [
        'setup', 'reset-cycle', 'set-drop-channel', 'set-bot-channel', 'set-log-channel', 'force-drop', 'auto-drops', 'help',
        'daily', 'checkin', 'claim', 'cash', 'balance', 'bal', 'money', 'leaderboard', 'lb',
        'rich', 'flip', 'casino', 'bet', 'crash', 'mines', 'blackjack', 'bj', 'stats', 'profile', 'shop', 'buy',
        'fight', 'gift', 'give', 'send', 'transfer', 'rob', 'steal', 'heist', 'inv', 'inventory',
        'sell', 'rare', 'tax', 'tribute', 'vault', 'well', 'cut', 'soul', 'ship', 'flex'
      ];
      
      const isValid = VALID_PREFIX_COMMANDS.includes(commandName);
      let fulfilled = true;
      let logged = false;
      let errorText = '';

      const logFinal = (status, errText = '') => {
        if (!isValid || logged) return;
        logged = true;
        const { logRequest } = require('../utils/requestLogger');
        logRequest({
          username: message.author.tag,
          command: content,
          fulfilled: status,
          error: errText
        });
      };

      // Wrap message.reply to check what it replies with
      const originalReply = message.reply;
      message.reply = async function(options) {
        let text = '';
        if (typeof options === 'string') text = options;
        else if (options && options.content) text = options.content;
        else if (options && options.embeds && options.embeds[0]) {
          const emb = options.embeds[0];
          text = (emb.title || '') + ' ' + (emb.description || '');
        }
        
        if (text.includes('❌') || text.includes('⏳') || text.includes('⚠️')) {
          fulfilled = false;
          errorText = text.replace(/<[^>]*>/g, '').slice(0, 60);
        }
        
        const res = await originalReply.apply(this, arguments);
        logFinal(fulfilled, errorText);
        return res;
      };

      // Wrap message.channel.send to catch sendTempMessage
      const originalSend = message.channel.send;
      message.channel.send = async function(options) {
        let text = '';
        if (typeof options === 'string') text = options;
        else if (options && options.content) text = options.content;
        
        if (text.includes('❌') || text.includes('⏳') || text.includes('⚠️')) {
          fulfilled = false;
          errorText = text.replace(/<[^>]*>/g, '').slice(0, 60);
        }
        
        const res = await originalSend.apply(this, arguments);
        logFinal(fulfilled, errorText);
        return res;
      };

      const control = await getBotControlState(message.guildId);

      if (control.maintenanceMode && !isAdminPrefixCommand(commandName)) {
        fulfilled = false;
        errorText = 'Maintenance Mode';
        const res = sendTempMessage(message.channel, control.maintenanceMessage);
        logFinal(false, errorText);
        return res;
      }

      const featureKey = getFeatureForPrefixCommand(commandName);
      if (featureKey && !control.features[featureKey]) {
        fulfilled = false;
        errorText = 'Feature Disabled';
        const res = sendTempMessage(message.channel, `❌ **${commandName}** is temporarily disabled globally by the bot owner.`);
        logFinal(false, errorText);
        return res;
      }

      try {
        // Apply daily tax/tribute if due
        try {
          const taxRes = await applyDailyTaxIfDue(userId, serverId);
          if (taxRes.success && taxRes.taxAmount > 0) {
            sendTempMessage(message.channel, `✨ **Daily Reaper's Cut**: Siphoned **${taxRes.taxAmount}** Souls to the server's **Soul Vault**.`);
          }
        } catch (taxErr) {
          console.error('[Daily Tax Error]', taxErr);
        }

        // Apply server vault daily operational cost if due
        try {
          if (message.guild) {
            const vaultTaxRes = await applyServerVaultTaxIfDue(serverId, message.guild.memberCount);
            if (vaultTaxRes.success && vaultTaxRes.taxAmount > 0) {
              console.log(`[Vault Tax] Deducted ${vaultTaxRes.taxAmount} Souls from server ${serverId} vault.`);
            }
          }
        } catch (vaultTaxErr) {
          console.error('[Vault Daily Tax Error]', vaultTaxErr);
        }

        const settings = await getServerSettings(serverId);
        const currencyName = settings.currency_name;
        const currencyIcon = settings.currency_icon_url;

        // --- Permission Validation Check ---
        const botMember = message.guild.members.me || await message.guild.members.fetch(message.client.user.id).catch(() => null);
        if (botMember) {
          const perms = message.channel.permissionsFor(botMember);
          if (perms) {
            // Identify commands that require Attach Files
            const requiresAttachFiles = ['inv', 'inventory', 'flex'].includes(commandName);
            if (requiresAttachFiles && !perms.has(PermissionFlagsBits.AttachFiles)) {
              fulfilled = false;
              errorText = 'Missing Attach Files Permission';
              const res = await message.reply(`⚠️ **Missing Permissions**: The bot needs the **Attach Files** permission in this channel to display inventory images. Please contact an administrator to enable it.`).catch(() => {});
              logFinal(false, errorText);
              return res;
            }

            // Identify commands that require Embed Links (almost all other prefix commands except flip)
            const requiresEmbedLinks = !['flip', 'soul'].includes(commandName) && !requiresAttachFiles;
            if (requiresEmbedLinks && !perms.has(PermissionFlagsBits.EmbedLinks)) {
              fulfilled = false;
              errorText = 'Missing Embed Links Permission';
              const res = await message.reply(`⚠️ **Missing Permissions**: The bot needs the **Embed Links** permission in this channel to display embeds. Please contact an administrator to enable it.`).catch(() => {});
              logFinal(false, errorText);
              return res;
            }
          }
        }

        // --- 1. ADMIN COMMANDS ---
        if (['setup', 'reset-cycle', 'set-drop-channel', 'set-bot-channel', 'set-log-channel', 'force-drop'].includes(commandName)) {
          // Check administrator permission
          if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You must have Administrator permissions to run admin commands.').catch(() => { });
          }

          // setup, set-drop-channel, set-bot-channel, set-log-channel, and force-drop can be run anywhere; other admin commands are restricted to #soul-logs
          if (!['setup', 'set-drop-channel', 'set-bot-channel', 'set-log-channel', 'force-drop'].includes(commandName)) {
            const settings = await getServerSettings(serverId);
            const customLogChannelId = settings.log_channel_id;
            if (customLogChannelId) {
              if (message.channel.id !== customLogChannelId) {
                return sendTempMessage(message.channel, `❌ This administrative command can only be used in the <#${customLogChannelId}> channel.`);
              }
            } else {
              if (!message.channel.name.toLowerCase().includes('soul-logs')) {
                return sendTempMessage(message.channel, '❌ This administrative command can only be used in the **#soul-logs** channel.');
              }
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

          if (commandName === 'set-bot-channel') {
            const channelMention = args[0];
            let targetChannelId = null;

            if (channelMention) {
              const match = channelMention.match(/^<#(\d+)>$/);
              if (match) {
                targetChannelId = match[1];
              } else if (!isNaN(channelMention)) {
                targetChannelId = channelMention;
              } else {
                const currentChannels = await message.guild.channels.fetch().catch(() => message.guild.channels.cache);
                const channelByName = currentChannels.find(
                  c => c.name.toLowerCase() === channelMention.toLowerCase() && c.type === ChannelType.GuildText
                );
                if (channelByName) {
                  targetChannelId = channelByName.id;
                }
              }
            } else {
              targetChannelId = message.channel.id;
            }

            if (!targetChannelId) {
              return message.reply('❌ **Error**: Channel not found in this server. Usage: `s set-bot-channel [channel_name/mention/id]`').catch(() => { });
            }

            const channelExists = message.guild.channels.cache.get(targetChannelId) ||
              await message.guild.channels.fetch(targetChannelId).catch(() => null);

            if (!channelExists || channelExists.type !== ChannelType.GuildText) {
              return message.reply('❌ **Error**: Channel not found or is not a text channel.').catch(() => { });
            }

            await updateServerChannels(serverId, targetChannelId, null);

            const embed = new EmbedBuilder()
              .setColor('#00ffaa')
              .setTitle('⚙️ Bot Channel Configured')
              .setDescription(`Members can now run currency commands in the channel: <#${targetChannelId}>.`)
              .setTimestamp();

            return await message.reply({ embeds: [embed] }).catch(() => { });
          }

          if (commandName === 'set-log-channel') {
            const channelMention = args[0];
            let targetChannelId = null;

            if (channelMention) {
              const match = channelMention.match(/^<#(\d+)>$/);
              if (match) {
                targetChannelId = match[1];
              } else if (!isNaN(channelMention)) {
                targetChannelId = channelMention;
              } else {
                const currentChannels = await message.guild.channels.fetch().catch(() => message.guild.channels.cache);
                const channelByName = currentChannels.find(
                  c => c.name.toLowerCase() === channelMention.toLowerCase() && c.type === ChannelType.GuildText
                );
                if (channelByName) {
                  targetChannelId = channelByName.id;
                }
              }
            } else {
              targetChannelId = message.channel.id;
            }

            if (!targetChannelId) {
              return message.reply('❌ **Error**: Channel not found in this server. Usage: `s set-log-channel [channel_name/mention/id]`').catch(() => { });
            }

            const channelExists = message.guild.channels.cache.get(targetChannelId) ||
              await message.guild.channels.fetch(targetChannelId).catch(() => null);

            if (!channelExists || channelExists.type !== ChannelType.GuildText) {
              return message.reply('❌ **Error**: Channel not found or is not a text channel.').catch(() => { });
            }

            await updateServerChannels(serverId, null, targetChannelId);

            const embed = new EmbedBuilder()
              .setColor('#00ffaa')
              .setTitle('⚙️ Log Channel Configured')
              .setDescription(`Administrative logs and commands are now restricted to the channel: <#${targetChannelId}>.`)
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
        if (['daily', 'checkin', 'claim', 'cash', 'balance', 'bal', 'money', 'leaderboard', 'lb', 'rich', 'flip', 'casino', 'bet', 'crash', 'mines', 'blackjack', 'bj', 'stats', 'profile', 'shop', 'buy', 'fight', 'gift', 'give', 'send', 'transfer', 'help', 'rob', 'steal', 'heist', 'inv', 'inventory', 'sell', 'rare', 'tax', 'tribute', 'vault', 'well', 'cut', 'soul', 'ship', 'flex'].includes(commandName)) {
          // Lock user commands to #soul-bot — EXCEPT 's help admin', 's soul lb', inventory/gifting, and treasury commands which can be run anywhere
          const isAdminHelpRequest = commandName === 'help' && args[0] && args[0].toLowerCase() === 'admin';
          const isSoulLbRequest = commandName === 'soul' && args[0] && args[0].toLowerCase() === 'lb';
          const isInventoryCommand = ['inv', 'inventory', 'sell', 'gift', 'give', 'send', 'transfer', 'rare', 'tax', 'tribute', 'vault', 'well', 'cut', 'flex'].includes(commandName);
          if (!isAdminHelpRequest && !isSoulLbRequest && !isInventoryCommand) {
            const settings = await getServerSettings(serverId);
            const customBotChannelId = settings.bot_channel_id;
            if (customBotChannelId) {
              if (message.channel.id !== customBotChannelId) {
                return sendTempMessage(message.channel, `❌ This command can only be used in the <#${customBotChannelId}> channel.`);
              }
            } else {
              if (!message.channel.name.toLowerCase().includes('soul-bot')) {
                return sendTempMessage(message.channel, '❌ This command can only be used in the **#soul-bot** channel.');
              }
            }
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
                .setDescription('These commands use the `s ` prefix and require **Administrator** or **Server Owner** permission.')
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
                  },
                  {
                    name: '👑 `s tax` / `s cut` / `s tribute`',
                    value: 'Opens the configuration menu to adjust daily, casino win, and soul sell Reaper\'s Cuts.\n> ⚠️ **Server Owner Only**. Can be run in **any channel**.',
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
                  { name: '✅ Available Anywhere', value: '`s setup` · `s set-drop-channel` · `s force-drop` · `s tax`\n`/admin setup` · `/admin set-drop-channel` · `/admin force-drop` · `/admin auto-drops`', inline: false },
                  { name: '⚡ Slash-Only (no prefix version)', value: '`/admin auto-drops`', inline: false },
                  { name: '🔒 Server Owner Only (Prefix)', value: '`s tax` / `s cut` / `s tribute` — configuration of Reaper\'s cuts.', inline: false },
                  { name: '🔒 Bot Owner Dashboard Only', value: '**Cycle Reset** — must be triggered from the Admin Cockpit dashboard.\nServer admins cannot reset cycles directly.', inline: false },
                  { name: '⛔ Globally Disabled', value: 'Currency name & icon changes · Shop price overrides\n*(These were removed from this bot\'s configuration.)*', inline: false }
                )
                .setFooter({ text: `Run by ${message.author.tag} · Soul Currency Admin Reference` })
                .setTimestamp();

              return await message.reply({ embeds: [prefixEmbed, slashEmbed, noteEmbed] }).catch(() => { });
            }

            // --- REGULAR USER HELP ---
            const helpEmbed = new EmbedBuilder()
              .setColor('#7b2fff')
              .setTitle(`🔮 ${currencyName} Commands Reference`)
              .setDescription('Explore all the commands available to interact with the economy, stats, and collectibles!')
              .addFields(
                {
                  name: '💰 Economy & Daily',
                  value: 
                    `• \`s daily\` / \`s claim\` / \`s checkin\` · Claim your daily allowance of Souls (24h cooldown).\n` +
                    `• \`s cash\` / \`s bal\` / \`s money\` [\`@user\`] · Check wallet balance (yours or another user's).\n` +
                    `• \`s lb\` / \`s leaderboard\` / \`s rich\` · View the monthly top 10 richest users.\n` +
                    `• \`s vault\` / \`s well\` · View the Server Soul Vault balance and tax rates.\n` +
                    `• \`s gift @user <amount>\` / \`s give\` / \`s send\` / \`s transfer\` · Send Souls to another user.`
                },
                {
                  name: '🔮 Soul Catching & Inventory',
                  value:
                    `• \`soul\` · Type when a drop spawns in chat to capture the Soul!\n` +
                    `• \`s inv\` / \`s inventory\` · Open inventory to view all your caught souls.\n` +
                    `• \`s soul lb\` · View the server leaderboard of top soul collectors (run anywhere).\n` +
                    `• \`s rare\` · View today's active collectibles and their daily premium prices.\n` +
                    `• \`s sell <index/name> [qty]\` · Sell caught souls at base or collectible prices.\n` +
                    `• \`s gift @user <name/index> [qty]\` / \`s give\` / \`s send\` / \`s transfer\` · Gift a caught soul from your inventory.\n` +
                    `• \`s flex <index/name>\` · Flex a collectible with a temporary auto-deleting image card.`
                },
                {
                  name: '🎰 Casino & Crime',
                  value:
                    `• \`s flip [heads/tails] <amount>\` / \`s bet\` / \`s casino\` · Flip a coin for double or nothing.\n` +
                    `• \`s crash <amount>\` · Watch the multiplier rise and cash out before the crash.\n` +
                    `• \`s mines <amount> [mines]\` · Uncover tiles on a grid while avoiding mines.\n` +
                    `• \`s rob @user\` / \`s steal\` / \`s heist\` · Try to steal 10% of their wallet (1h cooldown, risk of 5% fine).`
                },
                {
                  name: '⚔️ Stats & Training',
                  value:
                    `• \`s stats\` / \`s profile\` [\`@user\`] · Check stats (Strength, Defense, Speed, Magic).\n` +
                    `• \`s shop\` · Browse boosters, 24h elixirs, and shields.\n` +
                    `• \`s buy <item_id>\` · Purchase training items/upgrades from the shop.\n` +
                    `• \`s fight @user <bet>\` · Challenge a player to a stat-clash duel for Souls.\n` +
                    `• \`s ship\` [\`@user\`] · Matchmaker check compatibility with a user or a random server member.`
                }
              )
              .setFooter({ text: 'Tip: Passively earn Souls by chatting! · Admins: use `s help admin` in any channel.' })
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
            const treasuryInfo = await getTreasury(serverId);
            const embed = new EmbedBuilder()
              .setColor('#ffd700')
              .setTitle(`${targetUser.username}'s Wallet`)
              .setDescription(`Holding **${balanceInfo.balance}** ${currencyIcon} ${currencyName}`)
              .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
              .setFooter({ text: `Server Soul Vault: ${treasuryInfo.balance.toLocaleString()} ${currencyName}` })
              .setTimestamp();
            return await message.reply({ embeds: [embed] }).catch(() => { });
          }

          if (['vault', 'well'].includes(commandName)) {
            const treasuryInfo = await getTreasury(serverId);
            const memberCount = message.guild.memberCount;
            const fluctuatingRate = getFluctuatingTaxRate(memberCount);
            const currentTaxRate = treasuryInfo.customTaxRate !== null ? treasuryInfo.customTaxRate : fluctuatingRate;
            const rateLabel = treasuryInfo.customTaxRate !== null ? `\`${currentTaxRate}%\` (Custom Override)` : `\`${currentTaxRate}%\` (Fluctuates based on ${memberCount} members)`;

            const embed = new EmbedBuilder()
              .setColor('#7b2fff')
              .setTitle(`🏛️ Server Soul Vault 🏛️`)
              .setDescription(
                `The **Soul Vault** collects a **Reaper's Cut** from all active users in **${message.guild.name}**.\n\n` +
                `### 🔮 Stored Balance: \`${treasuryInfo.balance.toLocaleString()}\` Souls\n\n` +
                `**Current Rates:**\n` +
                `• **Daily Reaper's Cut:** \`${treasuryInfo.dailyTaxRate}%\` of wallet balance daily\n` +
                `• **Win Reaper's Cut:** \`${treasuryInfo.winTaxRate}%\` siphoned from casino/duel wins\n` +
                `• **Sell Reaper's Cut:** \`${treasuryInfo.sellTaxRate}%\` deducted on character sales\n\n` +
                `**Server Vault Operational Costs:**\n` +
                `• **Vault Tax Rate:** ${rateLabel}\n` +
                `• **Today's Operational Cost Paid:** \`${treasuryInfo.todayTaxPaid.toLocaleString()}\` Souls\n` +
                `• **Total Operational Costs Paid:** \`${treasuryInfo.totalTaxPaid.toLocaleString()}\` Souls\n\n` +
                `*Rates can be customized by the Server Owner using the command \`s tax\` (or \`s cut\`).*`
              )
              .setThumbnail(message.guild.iconURL({ dynamic: true }))
              .setTimestamp();
            return await message.reply({ embeds: [embed] }).catch(() => { });
          }

          if (['tax', 'tribute', 'cut'].includes(commandName)) {
            // Check if user is the server owner
            if (message.author.id !== message.guild.ownerId) {
              return message.reply("❌ **Access Denied**: Only the **Server Owner** can configure the Soul Vault Reaper's Cut rates.").catch(() => {});
            }

            const ownerUser = message.author;
            const guildName = message.guild.name;

            // Fetch current treasury settings
            const treasuryInfo = await getTreasury(serverId);
            const memberCount = message.guild.memberCount;
            const fluctuatingRate = getFluctuatingTaxRate(memberCount);
            const currentTaxRate = treasuryInfo.customTaxRate !== null ? treasuryInfo.customTaxRate : fluctuatingRate;
            const rateLabel = treasuryInfo.customTaxRate !== null ? `\`${currentTaxRate}%\` (Custom Override)` : `\`${currentTaxRate}%\` (Fluctuates based on ${memberCount} members)`;

            // Build select menus
            const dailySelect = new StringSelectMenuBuilder()
              .setCustomId(`set_daily_tax_${serverId}`)
              .setPlaceholder(`Daily Cut: currently ${treasuryInfo.dailyTaxRate}%`)
              .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('0% (Disable daily cut)').setValue('0.00'),
                new StringSelectMenuOptionBuilder().setLabel('0.5% (Very Low)').setValue('0.50'),
                new StringSelectMenuOptionBuilder().setLabel('1.0% (Default Cut)').setValue('1.00'),
                new StringSelectMenuOptionBuilder().setLabel('2.0% (Moderate)').setValue('2.00'),
                new StringSelectMenuOptionBuilder().setLabel('3.0% (High)').setValue('3.00'),
                new StringSelectMenuOptionBuilder().setLabel('5.0% (Aggressive)').setValue('5.00'),
                new StringSelectMenuOptionBuilder().setLabel('10.0% (Extreme)').setValue('10.00')
              );

            const winSelect = new StringSelectMenuBuilder()
              .setCustomId(`set_win_tax_${serverId}`)
              .setPlaceholder(`Win Cut: currently ${treasuryInfo.winTaxRate}%`)
              .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('0% (Keep full payouts)').setValue('0.00'),
                new StringSelectMenuOptionBuilder().setLabel('2% (Slight Cut)').setValue('2.00'),
                new StringSelectMenuOptionBuilder().setLabel('5% (Low Cut)').setValue('5.00'),
                new StringSelectMenuOptionBuilder().setLabel('10% (Default Cut)').setValue('10.00'),
                new StringSelectMenuOptionBuilder().setLabel('15% (High Cut)').setValue('15.00'),
                new StringSelectMenuOptionBuilder().setLabel('20% (Aggressive)').setValue('20.00')
              );

            const sellSelect = new StringSelectMenuBuilder()
              .setCustomId(`set_sell_tax_${serverId}`)
              .setPlaceholder(`Sell Cut: currently ${treasuryInfo.sellTaxRate}%`)
              .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('0% (Keep full sales)').setValue('0.00'),
                new StringSelectMenuOptionBuilder().setLabel('2% (Slight Cut)').setValue('2.00'),
                new StringSelectMenuOptionBuilder().setLabel('5% (Low Cut)').setValue('5.00'),
                new StringSelectMenuOptionBuilder().setLabel('10% (Default Cut)').setValue('10.00'),
                new StringSelectMenuOptionBuilder().setLabel('15% (High Cut)').setValue('15.00'),
                new StringSelectMenuOptionBuilder().setLabel('20% (Aggressive)').setValue('20.00')
              );

            const row1 = new ActionRowBuilder().addComponents(dailySelect);
            const row2 = new ActionRowBuilder().addComponents(winSelect);
            const row3 = new ActionRowBuilder().addComponents(sellSelect);

            const panelEmbed = new EmbedBuilder()
              .setColor('#7b2fff')
              .setTitle(`⚙️ Configure Soul Vault Reaper's Cuts — ${guildName}`)
              .setDescription(
                `Use the menus below to configure how much of the server's currency is siphoned as a **Reaper's Cut** to the **Soul Vault**:\n\n` +
                `• **Daily Reaper's Cut:** deducted from active users once every 24 hours.\n` +
                `• **Win Reaper's Cut:** siphoned from net casino & duel winnings.\n` +
                `• **Sell Reaper's Cut:** deducted from spawn inventory sales.\n\n` +
                `**Current Settings:**\n` +
                `🏛️ **Soul Vault Balance:** \`${treasuryInfo.balance.toLocaleString()}\` Souls\n` +
                `📅 **Daily Reaper's Cut Rate:** \`${treasuryInfo.dailyTaxRate}%\`\n` +
                `🎰 **Win Reaper's Cut Rate:** \`${treasuryInfo.winTaxRate}%\`\n` +
                `🪙 **Sell Reaper's Cut Rate:** \`${treasuryInfo.sellTaxRate}%\`\n\n` +
                `**Server Vault Operational Costs:**\n` +
                `• **Vault Tax Rate:** ${rateLabel}\n` +
                `• **Today's Operational Cost Paid:** \`${treasuryInfo.todayTaxPaid.toLocaleString()}\` Souls\n` +
                `• **Total Operational Costs Paid:** \`${treasuryInfo.totalTaxPaid.toLocaleString()}\` Souls`
              )
              .setTimestamp();

            try {
              const dm = await ownerUser.send({
                embeds: [panelEmbed],
                components: [row1, row2, row3]
              });

              await message.reply(`📬 **${ownerUser.username}**, I have sent the interactive configuration panel to your DMs!`).then(temp => {
                setTimeout(() => temp.delete().catch(() => {}), 4000);
              }).catch(() => {});

              // Create collector for DM menu interactions
              const collector = dm.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 300000 // 5 minutes
              });

              collector.on('collect', async (menuInteraction) => {
                await menuInteraction.deferUpdate();
                const selectedValue = parseFloat(menuInteraction.values[0]);

                let currentDaily = null;
                let currentWin = null;
                let currentSell = null;

                if (menuInteraction.customId.startsWith('set_daily_tax_')) {
                   currentDaily = selectedValue;
                } else if (menuInteraction.customId.startsWith('set_win_tax_')) {
                   currentWin = selectedValue;
                } else if (menuInteraction.customId.startsWith('set_sell_tax_')) {
                   currentSell = selectedValue;
                }

                // Update settings in database
                await updateTreasuryRates(serverId, currentDaily, currentWin, currentSell);
                
                // Fetch latest to show updated values
                const currentTreasury = await getTreasury(serverId);
                const currentFluctuatingRate = getFluctuatingTaxRate(memberCount);
                const currentTaxRateVal = currentTreasury.customTaxRate !== null ? currentTreasury.customTaxRate : currentFluctuatingRate;
                const currentRateLabel = currentTreasury.customTaxRate !== null ? `\`${currentTaxRateVal}%\` (Custom Override)` : `\`${currentTaxRateVal}%\` (Fluctuates based on ${memberCount} members)`;

                // Update placeholders and description
                const updatedDailySelect = StringSelectMenuBuilder.from(dailySelect)
                  .setPlaceholder(`Daily Cut: currently ${currentTreasury.dailyTaxRate}%`);
                const updatedWinSelect = StringSelectMenuBuilder.from(winSelect)
                  .setPlaceholder(`Win Cut: currently ${currentTreasury.winTaxRate}%`);
                const updatedSellSelect = StringSelectMenuBuilder.from(sellSelect)
                  .setPlaceholder(`Sell Cut: currently ${currentTreasury.sellTaxRate}%`);

                const updatedRow1 = new ActionRowBuilder().addComponents(updatedDailySelect);
                const updatedRow2 = new ActionRowBuilder().addComponents(updatedWinSelect);
                const updatedRow3 = new ActionRowBuilder().addComponents(updatedSellSelect);

                const updatedEmbed = EmbedBuilder.from(panelEmbed)
                  .setDescription(
                    `Use the menus below to configure how much of the server's currency is siphoned as a **Reaper's Cut** to the **Soul Vault**:\n\n` +
                    `• **Daily Reaper's Cut:** deducted from active users once every 24 hours.\n` +
                    `• **Win Reaper's Cut:** siphoned from net casino & duel winnings.\n` +
                    `• **Sell Reaper's Cut:** deducted from spawn inventory sales.\n\n` +
                    `**Current Settings:**\n` +
                    `🏛️ **Soul Vault Balance:** \`${currentTreasury.balance.toLocaleString()}\` Souls\n` +
                    `📅 **Daily Reaper's Cut Rate:** \`${currentTreasury.dailyTaxRate}%\`\n` +
                    `🎰 **Win Reaper's Cut Rate:** \`${currentTreasury.winTaxRate}%\`\n` +
                    `🪙 **Sell Reaper's Cut Rate:** \`${currentTreasury.sellTaxRate}%\`\n\n` +
                    `**Server Vault Operational Costs:**\n` +
                    `• **Vault Tax Rate:** ${currentRateLabel}\n` +
                    `• **Today's Operational Cost Paid:** \`${currentTreasury.todayTaxPaid.toLocaleString()}\` Souls\n` +
                    `• **Total Operational Costs Paid:** \`${currentTreasury.totalTaxPaid.toLocaleString()}\` Souls\n\n` +
                    `✅ *Successfully updated Reaper's Cut settings!*`
                  );

                await dm.edit({
                  embeds: [updatedEmbed],
                  components: [updatedRow1, updatedRow2, updatedRow3]
                }).catch(() => {});
              });

              collector.on('end', async () => {
                // Disable components on timeout
                const disabledDaily = StringSelectMenuBuilder.from(dailySelect).setDisabled(true);
                const disabledWin = StringSelectMenuBuilder.from(winSelect).setDisabled(true);
                const disabledSell = StringSelectMenuBuilder.from(sellSelect).setDisabled(true);

                const disabledRow1 = new ActionRowBuilder().addComponents(disabledDaily);
                const disabledRow2 = new ActionRowBuilder().addComponents(disabledWin);
                const disabledRow3 = new ActionRowBuilder().addComponents(disabledSell);

                await dm.edit({
                  components: [disabledRow1, disabledRow2, disabledRow3]
                }).catch(() => {});
              });

            } catch (dmErr) {
              console.error(`Failed to DM owner ${message.guild.ownerId}:`, dmErr);
              await message.reply("❌ **Error**: I could not send you a DM. Please enable direct messages in your Discord privacy settings and try again.").catch(() => {});
            }

            return;
          }

          if (['gift', 'give', 'send', 'transfer'].includes(commandName)) {
            const targetUser = message.mentions.users.first();
            if (!targetUser) {
              return message.reply(`❌ **Usage:**\n- Gifting coins: \`s gift @user <amount>\`\n- Gifting characters: \`s gift @user <index/name> [quantity]\``).catch(() => {});
            }
            if (targetUser.id === message.author.id) {
              return sendTempMessage(message.channel, '❌ You cannot gift yourself.');
            }
            if (targetUser.bot) {
              return sendTempMessage(message.channel, '❌ You cannot gift bots.');
            }

            // Extract remaining arguments by filtering out mentions
            const giftArgs = args.filter(arg => !arg.startsWith('<@') && !arg.endsWith('>'));
            if (giftArgs.length === 0) {
              return message.reply(`❌ **Usage:**\n- Gifting coins: \`s gift @user <amount>\`\n- Gifting characters: \`s gift @user <index/name> [quantity]\``).catch(() => {});
            }

            // Fetch sender's character inventory to check for index/name matching
            const userInv = await getUserInventory(userId, serverId);
            const characterItems = [];
            for (const [itemId, qty] of Object.entries(userInv)) {
              const charDef = CHARACTER_SPAWNS.find(c => c.id === itemId);
              if (charDef) {
                characterItems.push({
                  id: charDef.id,
                  name: charDef.name,
                  tier: charDef.tier,
                  value: charDef.value,
                  quantity: qty
                });
              }
            }

            // Sort identically to s inv
            const tierOrder = { 'DIVINE': 0, 'MYTHIC': 1, 'EPIC': 2, 'RARE': 3, 'UNCOMMON': 4, 'COMMON': 5 };
            characterItems.sort((a, b) => {
              const orderA = tierOrder[a.tier] !== undefined ? tierOrder[a.tier] : 99;
              const orderB = tierOrder[b.tier] !== undefined ? tierOrder[b.tier] : 99;
              if (orderA !== orderB) return orderA - orderB;
              return a.name.localeCompare(b.name);
            });

            let isCharacterGift = false;
            let targetItem = null;
            let giftQty = 1;
            let coinAmount = 0;

            const firstArgNum = parseInt(giftArgs[0]);
            if (!isNaN(firstArgNum)) {
              // It's a number. Check if it's a valid index in the character inventory.
              if (firstArgNum >= 1 && firstArgNum <= characterItems.length) {
                isCharacterGift = true;
                targetItem = characterItems[firstArgNum - 1];
                if (giftArgs[1]) {
                  const qtyVal = parseInt(giftArgs[1]);
                  if (!isNaN(qtyVal) && qtyVal > 0) {
                    giftQty = qtyVal;
                  }
                }
              } else {
                // It's not a valid index, so it must be a coin gift amount
                coinAmount = firstArgNum;
              }
            } else {
              // It's a string name, so it's a character gift
              isCharacterGift = true;
              let nameArgs = [...giftArgs];
              const lastArg = nameArgs[nameArgs.length - 1];
              const qtyVal = parseInt(lastArg);
              if (!isNaN(qtyVal) && qtyVal > 0 && nameArgs.length > 1) {
                giftQty = qtyVal;
                nameArgs.pop();
              }

              const searchName = nameArgs.join(' ').toLowerCase();
              targetItem = characterItems.find(c => c.name.toLowerCase() === searchName) ||
                           characterItems.find(c => c.name.toLowerCase().includes(searchName)) ||
                           characterItems.find(c => c.id.toLowerCase() === searchName);
            }

            if (isCharacterGift) {
              if (!targetItem) {
                return message.reply('❌ Character not found in your inventory. Type `s inv` to view what you have caught.').catch(() => {});
              }
              if (giftQty > targetItem.quantity) {
                return message.reply(`❌ You only have **${targetItem.quantity}** of **${targetItem.name}** in your inventory.`).catch(() => {});
              }

              // Execute character gift
              const giftResult = await giftCharacter(userId, targetUser.id, targetItem.id, giftQty);
              if (giftResult.success) {
                const embed = new EmbedBuilder()
                  .setColor('#00ffaa')
                  .setTitle('🎁 Character Gifted Successfully!')
                  .setDescription(`Successfully gifted **${giftQty}x ${targetItem.name}** to ${targetUser}!`)
                  .addFields(
                    { name: 'Your Remaining Quantity', value: `🎒 **${giftResult.senderNewQty}**`, inline: true }
                  )
                  .setTimestamp();
                return await message.reply({ embeds: [embed] }).catch(() => {});
              } else {
                return message.reply('❌ Failed to gift the character.').catch(() => {});
              }
            } else {
              // Perform coin gift
              if (coinAmount <= 0) {
                return sendTempMessage(message.channel, '❌ Invalid coin amount.');
              }

              const result = await transferCoins(message.author.id, targetUser.id, serverId, coinAmount);
              if (result.success) {
                const embed = new EmbedBuilder()
                  .setColor('#00ffaa')
                  .setTitle('🎁 Gift Sent!')
                  .setDescription(`Successfully sent **${coinAmount}** ${currencyIcon} ${currencyName} to ${targetUser}!`)
                  .addFields({ name: 'Your New Balance', value: `**${result.newSenderBalance}** ${currencyIcon} ${currencyName}` })
                  .setTimestamp();
                return await message.reply({ embeds: [embed] }).catch(() => {});
              } else if (result.reason === 'insufficient_funds') {
                return sendTempMessage(message.channel, `❌ You don't have enough funds to gift that amount. Your current balance is **${result.currentBalance}** ${currencyIcon} ${currencyName}.`);
              } else {
                return sendTempMessage(message.channel, '❌ An error occurred while transferring funds.');
              }
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

          if (['soul'].includes(commandName)) {
            if (args[0] && args[0].toLowerCase() === 'lb') {
              const serverId = message.guild.id;
              const { getSoulsLeaderboard } = require('../database/queries');

              // Fetch initial leaderboard (All Souls)
              const initialTier = 'ALL';
              const { rankings } = await getSoulsLeaderboard(serverId, initialTier, 10);

              const embed = new EmbedBuilder()
                .setColor('#a855f7')
                .setTitle(`🔮 ${message.guild.name} Souls Leaderboard (ALL)`)
                .setDescription('Leaderboard of top soul collectors in this server.')
                .setTimestamp();

              if (rankings.length === 0) {
                embed.setDescription('No souls caught by members of this server yet. Start catching drops!');
              } else {
                const rankList = [];
                const medals = ['🥇', '🥈', '🥉'];
                for (let i = 0; i < rankings.length; i++) {
                  const r = rankings[i];
                  const medal = medals[i] || `\`#${i + 1}\``;
                  let username = `<@${r.discord_id}>`;
                  rankList.push(`${medal} ${username} — **${r.total_souls}** caught`);
                }
                embed.setDescription(rankList.join('\n'));
              }

              // Create select menu component
              const selectId = `soul_lb_select_${userId}_${Date.now()}`;
              const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(selectId)
                .setPlaceholder('🔮 Filter by Soul rarity...')
                .addOptions(
                  new StringSelectMenuOptionBuilder()
                    .setLabel('All Souls')
                    .setDescription('Show leaderboard for all souls caught')
                    .setValue('ALL')
                    .setEmoji('🔮'),
                  new StringSelectMenuOptionBuilder()
                    .setLabel('Legendary Souls')
                    .setDescription('Show leaderboard for Legendary souls')
                    .setValue('LEGENDARY')
                    .setEmoji('⭐'),
                  new StringSelectMenuOptionBuilder()
                    .setLabel('Divine Souls')
                    .setDescription('Show leaderboard for Divine souls')
                    .setValue('DIVINE')
                    .setEmoji('💜'),
                  new StringSelectMenuOptionBuilder()
                    .setLabel('Mythic Souls')
                    .setDescription('Show leaderboard for Mythic souls')
                    .setValue('MYTHIC')
                    .setEmoji('✨'),
                  new StringSelectMenuOptionBuilder()
                    .setLabel('Epic Souls')
                    .setDescription('Show leaderboard for Epic souls')
                    .setValue('EPIC')
                    .setEmoji('🔥'),
                  new StringSelectMenuOptionBuilder()
                    .setLabel('Rare Souls')
                    .setDescription('Show leaderboard for Rare souls')
                    .setValue('RARE')
                    .setEmoji('💎'),
                  new StringSelectMenuOptionBuilder()
                    .setLabel('Uncommon Souls')
                    .setDescription('Show leaderboard for Uncommon souls')
                    .setValue('UNCOMMON')
                    .setEmoji('🔷'),
                  new StringSelectMenuOptionBuilder()
                    .setLabel('Common Souls')
                    .setDescription('Show leaderboard for Common souls')
                    .setValue('COMMON')
                    .setEmoji('🟢')
                );

              const row = new ActionRowBuilder().addComponents(selectMenu);

              const lbMessage = await message.reply({
                embeds: [embed],
                components: [row]
              }).catch(err => console.error('[Soul LB Error] Failed to send initial leaderboard:', err));

              if (!lbMessage) return;

              // Create collector for the select menu
              const collector = lbMessage.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 60000,
                filter: (i) => i.user.id === userId && i.customId === selectId
              });

              collector.on('collect', async (menuInteraction) => {
                const selectedTier = menuInteraction.values[0];
                await menuInteraction.deferUpdate();

                const { rankings: updatedRankings } = await getSoulsLeaderboard(serverId, selectedTier, 10);

                const updatedEmbed = new EmbedBuilder()
                  .setColor('#a855f7')
                  .setTitle(`🔮 ${message.guild.name} Souls Leaderboard (${selectedTier})`)
                  .setTimestamp();

                if (updatedRankings.length === 0) {
                  updatedEmbed.setDescription(`No souls caught in this category yet! Keep catching drops!`);
                } else {
                  const rankList = [];
                  const medals = ['🥇', '🥈', '🥉'];
                  for (let i = 0; i < updatedRankings.length; i++) {
                    const r = updatedRankings[i];
                    const medal = medals[i] || `\`#${i + 1}\``;
                    let username = `<@${r.discord_id}>`;
                    rankList.push(`${medal} ${username} — **${r.total_souls}** caught`);
                  }
                  updatedEmbed.setDescription(rankList.join('\n'));
                }

                // Create a fresh menu, keeping it active
                const updatedSelectMenu = StringSelectMenuBuilder.from(selectMenu)
                  .setPlaceholder(`Filtering by: ${selectedTier}`);
                
                const updatedRow = new ActionRowBuilder().addComponents(updatedSelectMenu);

                await menuInteraction.editReply({
                  embeds: [updatedEmbed],
                  components: [updatedRow]
                }).catch(err => console.error('[Soul LB Error] Failed to edit reply on collect:', err));
              });

              collector.on('end', async () => {
                // Disable select menu on timeout
                const disabledSelectMenu = StringSelectMenuBuilder.from(selectMenu)
                  .setDisabled(true)
                  .setPlaceholder('Leaderboard session expired. Type s soul lb to reopen.');
                const disabledRow = new ActionRowBuilder().addComponents(disabledSelectMenu);
                await lbMessage.edit({ components: [disabledRow] }).catch(err => console.error('[Soul LB Error] Failed to edit message on end:', err));
              });

              return;
            } else {
              return message.reply('❌ **Usage:** `s soul lb` to view the soul collectors leaderboard.').catch(() => {});
            }
          }

          if (['ship'].includes(commandName)) {
            let targetMember = null;

            if (message.mentions.members.first()) {
              targetMember = message.mentions.members.first();
            } else if (args.length > 0) {
              const searchStr = args.join(' ').toLowerCase();
              targetMember = message.guild.members.cache.find(m => 
                m.user.username.toLowerCase().includes(searchStr) || 
                (m.nickname && m.nickname.toLowerCase().includes(searchStr)) || 
                m.id === searchStr
              );
            }

            if (!targetMember) {
              let members = [];
              try {
                // Fetch full guild member list to ensure wide random selection
                const fetched = await message.guild.members.fetch();
                members = Array.from(fetched.values()).filter(m => !m.user.bot && m.id !== userId);
              } catch (err) {
                console.error('Failed to fetch guild members for ship command:', err);
                members = Array.from(message.guild.members.cache.values()).filter(m => !m.user.bot && m.id !== userId);
              }

              if (members.length === 0) {
                return message.reply('❌ No other members found in this server to ship with!').catch(() => {});
              }

              targetMember = members[Math.floor(Math.random() * members.length)];
            }

            if (targetMember.id === userId) {
              return message.reply("❌ You can't ship with yourself! Pick someone else.").catch(() => {});
            }

            if (targetMember.user.bot) {
              return message.reply("❌ You can't ship with a bot!").catch(() => {});
            }

            // Generate fully randomized compatibility and comment selections for continuous re-rolling
            const percent = Math.floor(Math.random() * 101);
            const randIndex = Math.floor(Math.random() * 100);
            const today = new Date().toISOString().split('T')[0];

            let msg = '';
            let embedColor = '#808080';
            if (percent <= 10) {
              const msgs = [
                "Absolute disaster. You two shouldn't even be in the same server. 💀",
                "Negative compatibility. Run away as fast as you can! 🏃‍♂️💨",
                "A match made in... well, definitely not in heaven. 🤮",
                "Even water and oil mix better than you two. ☠️"
              ];
              msg = msgs[randIndex % msgs.length];
              embedColor = '#4b5563';
            } else if (percent <= 30) {
              const msgs = [
                "Just friends. Barely. 😶",
                "Very low compatibility. Maybe stick to catching souls instead of feelings. 🤷‍♂️",
                "There is a spark, but it's more like static electricity from a cheap sweater. ⚡",
                "Awkward side-eyes. You're better off as distant acquaintances. 🥶"
              ];
              msg = msgs[randIndex % msgs.length];
              embedColor = '#ef4444';
            } else if (percent <= 50) {
              const msgs = [
                "Awkward silence vibes. Could work, but needs a ton of effort. 🤝",
                "Decent friendship potential. Grab a cup of coffee first. ☕",
                "Meh. It's purely average. 😐",
                "Not bad, but not exactly exciting either. 🥱"
              ];
              msg = msgs[randIndex % msgs.length];
              embedColor = '#f97316';
            } else if (percent <= 70) {
              const msgs = [
                "Warm feelings! There is definitely a sweet connection there. 😏",
                "Good chemistry! You should go ahead and slide into their DMs. 😉",
                "Cute couple vibes! The stars are beginning to align. 🌸",
                "A solid match. Give it a shot! 💘"
              ];
              msg = msgs[randIndex % msgs.length];
              embedColor = '#eab308';
            } else if (percent <= 90) {
              const msgs = [
                "Great match! A mutual crush is definitely incoming. 👀",
                "High compatibility! You two look absolutely stunning together. ❤️",
                "So compatible, it's starting to get hot in here! 🔥",
                "Highly compatible! The shipping charts are off the hook. 📈"
              ];
              msg = msgs[randIndex % msgs.length];
              embedColor = '#ec4899';
            } else {
              const msgs = [
                "Soulmates! Perfectly matched in every single universe. 💖",
                "True love! A match made in the heavens. ✨💍",
                "100% destined to be together. Get married already! 💒",
                "Unstoppable duo! Together you could conquer the world. 👑💕"
              ];
              msg = msgs[randIndex % msgs.length];
              embedColor = '#db2777';
            }

            const filledCount = Math.round(percent / 10);
            const bar = '❤️'.repeat(filledCount) + '🖤'.repeat(10 - filledCount);

            const shipEmbed = new EmbedBuilder()
              .setColor(embedColor)
              .setTitle('💖 Soul Matchmaker 💖')
              .setDescription(
                `💘 <@${userId}> & <@${targetMember.id}> 💘\n\n` +
                `📈 **Compatibility:** \`${percent}%\`\n` +
                `${bar}\n\n` +
                `*${msg}*`
              )
              .setThumbnail(targetMember.user.displayAvatarURL({ dynamic: true }))
              .setFooter({ text: `Matched on: ${today}` })
              .setTimestamp();

            return await message.reply({
              content: `💞 **New matchmaking results:** <@${userId}> x <@${targetMember.id}>!`,
              embeds: [shipEmbed]
            }).catch(() => {});
          }

          if (commandName === 'flex') {
            const userInv = await getUserInventory(userId, serverId);
            const characterItems = [];
            
            for (const [itemId, qty] of Object.entries(userInv)) {
              const charDef = CHARACTER_SPAWNS.find(c => c.id === itemId);
              if (charDef) {
                characterItems.push({
                  id: charDef.id,
                  name: charDef.name,
                  tier: charDef.tier,
                  value: charDef.value,
                  quantity: qty,
                  color: charDef.color,
                  imagePath: charDef.imagePath
                });
              }
            }

            if (characterItems.length === 0) {
              return message.reply('❌ Your inventory is currently empty! Catch some drops first.').catch(() => {});
            }
            
            const tierOrder = { 'DIVINE': 0, 'MYTHIC': 1, 'EPIC': 2, 'RARE': 3, 'UNCOMMON': 4, 'COMMON': 5 };
            characterItems.sort((a, b) => {
              const orderA = tierOrder[a.tier] !== undefined ? tierOrder[a.tier] : 99;
              const orderB = tierOrder[b.tier] !== undefined ? tierOrder[b.tier] : 99;
              if (orderA !== orderB) return orderA - orderB;
              return a.name.localeCompare(b.name);
            });

            if (args.length === 0) {
              return message.reply('❌ **Usage:** `s flex <index>` or `s flex <collectible name>`. Example: `s flex 1` or `s flex Blossom Soul`.').catch(() => {});
            }

            let selectedChar = null;
            const indexArg = parseInt(args[0], 10);
            if (!isNaN(indexArg)) {
              const idx = indexArg - 1;
              if (idx < 0 || idx >= characterItems.length) {
                return message.reply(`❌ Invalid index. Please choose a number between 1 and ${characterItems.length}.`).catch(() => {});
              }
              selectedChar = characterItems[idx];
            } else {
              const searchStr = args.join(' ').toLowerCase().trim();
              selectedChar = characterItems.find(item => item.name.toLowerCase().includes(searchStr));
              if (!selectedChar) {
                return message.reply(`❌ You do not own any collectible matching "${args.join(' ')}".`).catch(() => {});
              }
            }

            const { disabledIds } = require('../utils/characters');
            const activeSpawns = CHARACTER_SPAWNS.filter(c => !disabledIds.includes(c.id));
            const totalWeight = activeSpawns.reduce((acc, c) => acc + c.weight, 0);
            const charDef = CHARACTER_SPAWNS.find(c => c.id === selectedChar.id);
            const dropPercentage = totalWeight > 0 ? ((charDef.weight / totalWeight) * 100).toFixed(2) : '0.00';

            // Check if active daily collectible and resolve the daily premium price
            const globalSettings = await getGlobalSettings();
            const isCollectible = globalSettings[`collectible_active_${selectedChar.id}`] === 'true';
            const collectiblePrice = globalSettings[`collectible_price_${selectedChar.id}`] !== undefined
              ? parseInt(globalSettings[`collectible_price_${selectedChar.id}`], 10)
              : null;

            if (isCollectible && collectiblePrice !== null && !isNaN(collectiblePrice)) {
              selectedChar.value = collectiblePrice;
            }

            await message.channel.sendTyping();

            try {
              const { renderFlexImage } = require('../utils/flexRenderer');
              const imageBuffer = await renderFlexImage(
                message.author.username,
                selectedChar,
                dropPercentage,
                currencyName,
                isCollectible
              );

              const attachment = new AttachmentBuilder(imageBuffer, { name: 'flex.png' });
              const flexMessage = await message.reply({
                content: `✨ **${message.author.username}** is flexing their collectible! *(This message will auto-delete in 15 seconds)*`,
                files: [attachment]
              });

              setTimeout(() => {
                flexMessage.delete().catch(() => {});
              }, 15000);

              return;
            } catch (renderErr) {
              console.error('Failed to render flex image:', renderErr);
              return message.reply('❌ Failed to render showcase image. Please try again.').catch(() => {});
            }
          }

          if (['flip', 'casino', 'bet'].includes(commandName)) {
            const isDashboard = commandName === 'casino' && args.length === 0;

            if (isDashboard) {
              try {
                const balanceInfo = await getUserBalance(userId, serverId);

                // Build casino banner attachment
                const bannerPath = path.join(__dirname, '..', 'assets', 'casino_banner.png');
                let files = [];
                if (fs.existsSync(bannerPath)) {
                  files.push(new AttachmentBuilder(bannerPath, { name: 'casino_banner.png' }));
                }

                const embed = new EmbedBuilder()
                  .setAuthor({
                    name: `${message.author.username}'s Casino Lobby`,
                    iconURL: message.author.displayAvatarURL({ dynamic: true })
                  })
                  .setColor('#7d00ff') // Cyberpunk purple
                  .setTitle('🎰   THE GRAND SOUL CASINO   🎰')
                  .setDescription(
                    `Welcome to the VIP Casino Lounge, **${message.author.username}**!\n\n` +
                    `💼 **Your Balance:** **${balanceInfo.balance}** ${currencyIcon} ${currencyName}\n\n` +
                    `Choose an interactive game terminal below to place your bets:`
                  )
                  .addFields(
                    {
                      name: '🪙   Coin Flip   [Payout: 2x]',
                      value: `> Predict heads or tails. A simple 50/50 test of luck (30% win chance).`
                    },
                    {
                      name: '🚀   Rocket Crash   [Payout: Up to 10x]',
                      value: `> Watch the multiplier climb. Cash out before the rocket explodes to 0!`
                    },
                    {
                      name: '💣   Grid Mines   [Payout: High Scaling]',
                      value: `> Uncover safe tiles on a 4x5 grid. Avoid the hidden mines. More mines = higher risk & reward!`
                    },
                    {
                      name: '🃏   Blackjack   [Payout: 2x / 2.5x]',
                      value: `> Play a classic hand of Blackjack. Beat the dealer's hand without busting. Natural 21 pays 3:2!`
                    }
                  )
                  .setImage('attachment://casino_banner.png')
                  .setFooter({ text: "Gamble responsibly • Powered by the Reaper's Treasury" })
                  .setTimestamp();

                const buttonFlip = new ButtonBuilder()
                  .setCustomId(`casino_flip_${userId}`)
                  .setLabel('Coin Flip')
                  .setStyle(ButtonStyle.Primary)
                  .setEmoji('🪙');

                const buttonCrash = new ButtonBuilder()
                  .setCustomId(`casino_crash_${userId}`)
                  .setLabel('Crash')
                  .setStyle(ButtonStyle.Success)
                  .setEmoji('🚀');

                const buttonMines = new ButtonBuilder()
                  .setCustomId(`casino_mines_${userId}`)
                  .setLabel('Mines')
                  .setStyle(ButtonStyle.Danger)
                  .setEmoji('💣');

                const buttonBlackjack = new ButtonBuilder()
                  .setCustomId(`casino_blackjack_${userId}`)
                  .setLabel('Blackjack')
                  .setStyle(ButtonStyle.Success)
                  .setEmoji('🃏');

                const row = new ActionRowBuilder().addComponents(buttonFlip, buttonCrash, buttonMines, buttonBlackjack);

                const dashboardMsg = await message.reply({
                  embeds: [embed],
                  components: [row],
                  files
                });

                // Create component collector
                const filter = (i) => i.user.id === userId && i.customId.startsWith('casino_');
                const collector = dashboardMsg.createMessageComponentCollector({
                  filter,
                  time: 60000
                });

                collector.on('collect', async (i) => {
                  const action = i.customId.split('_')[1]; // flip, crash, mines

                  if (action === 'flip') {
                    const modal = new ModalBuilder()
                      .setCustomId(`modal_flip_${userId}_${Date.now()}`)
                      .setTitle('🪙 Coin Flip Bet');

                    const betInput = new TextInputBuilder()
                      .setCustomId('bet')
                      .setLabel('Bet Amount (Souls)')
                      .setPlaceholder('e.g., 50')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(true);

                    const choiceInput = new TextInputBuilder()
                      .setCustomId('choice')
                      .setLabel('Prediction (heads or tails)')
                      .setPlaceholder('heads')
                      .setValue('heads')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(false);

                    const row1 = new ActionRowBuilder().addComponents(betInput);
                    const row2 = new ActionRowBuilder().addComponents(choiceInput);
                    modal.addComponents(row1, row2);

                    await i.showModal(modal);

                    try {
                      const submit = await i.awaitModalSubmit({
                        filter: (sub) => sub.customId === modal.data.custom_id,
                        time: 60000
                      });

                      await submit.deferReply();

                      const betVal = parseInt(submit.fields.getTextInputValue('bet'));
                      let choiceVal = submit.fields.getTextInputValue('choice').toLowerCase().trim();
                      if (choiceVal === 'h' || choiceVal === 'heads') choiceVal = 'heads';
                      else if (choiceVal === 't' || choiceVal === 'tails') choiceVal = 'tails';
                      else {
                        return await submit.editReply('❌ **Invalid Choice**: Please enter either `heads` (or `h`) or `tails` (or `t`).').catch(() => {});
                      }

                      if (isNaN(betVal) || betVal <= 0) {
                        return await submit.editReply('❌ **Invalid Bet**: Please enter a positive number of coins.').catch(() => {});
                      }

                      // Check balance again before launching
                      const activeBal = await getUserBalance(userId, serverId);
                      if (activeBal.balance < betVal) {
                        return await submit.editReply(`❌ **Insufficient Coins**: You only have **${activeBal.balance}** ${currencyIcon} ${currencyName}.`).catch(() => {});
                      }

                      // Start flip game
                      await startFlipGame(userId, serverId, betVal, choiceVal, submit, message.author, currencyIcon, currencyName);
                    } catch (submitErr) {
                      console.error('Modal submit error or timeout for flip:', submitErr);
                    }
                  } else if (action === 'crash') {
                    const modal = new ModalBuilder()
                      .setCustomId(`modal_crash_${userId}_${Date.now()}`)
                      .setTitle('🚀 Crash Bet');

                    const betInput = new TextInputBuilder()
                      .setCustomId('bet')
                      .setLabel('Bet Amount (Souls)')
                      .setPlaceholder('e.g., 50')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(true);

                    const row1 = new ActionRowBuilder().addComponents(betInput);
                    modal.addComponents(row1);

                    await i.showModal(modal);

                    try {
                      const submit = await i.awaitModalSubmit({
                        filter: (sub) => sub.customId === modal.data.custom_id,
                        time: 60000
                      });

                      await submit.deferReply();

                      const betVal = parseInt(submit.fields.getTextInputValue('bet'));
                      if (isNaN(betVal) || betVal <= 0) {
                        return await submit.editReply('❌ **Invalid Bet**: Please enter a positive number of coins.').catch(() => {});
                      }

                      // Check balance
                      const activeBal = await getUserBalance(userId, serverId);
                      if (activeBal.balance < betVal) {
                        return await submit.editReply(`❌ **Insufficient Coins**: You only have **${activeBal.balance}** ${currencyIcon} ${currencyName}.`).catch(() => {});
                      }

                      // Start crash game
                      await startCrashGame(userId, serverId, betVal, submit, message.author, currencyIcon, currencyName);
                    } catch (submitErr) {
                      console.error('Modal submit error or timeout for crash:', submitErr);
                    }
                  } else if (action === 'mines') {
                    const modal = new ModalBuilder()
                      .setCustomId(`modal_mines_${userId}_${Date.now()}`)
                      .setTitle('💣 Mines Bet');

                    const betInput = new TextInputBuilder()
                      .setCustomId('bet')
                      .setLabel('Bet Amount (Souls)')
                      .setPlaceholder('e.g., 50')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(true);

                    const minesInput = new TextInputBuilder()
                      .setCustomId('mines')
                      .setLabel('Number of Mines (1-19)')
                      .setPlaceholder('3')
                      .setValue('3')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(false);

                    const row1 = new ActionRowBuilder().addComponents(betInput);
                    const row2 = new ActionRowBuilder().addComponents(minesInput);
                    modal.addComponents(row1, row2);

                    await i.showModal(modal);

                    try {
                      const submit = await i.awaitModalSubmit({
                        filter: (sub) => sub.customId === modal.data.custom_id,
                        time: 60000
                      });

                      await submit.deferReply();

                      const betVal = parseInt(submit.fields.getTextInputValue('bet'));
                      let minesVal = parseInt(submit.fields.getTextInputValue('mines'));
                      if (isNaN(minesVal)) minesVal = 3;

                      if (isNaN(betVal) || betVal <= 0) {
                        return await submit.editReply('❌ **Invalid Bet**: Please enter a positive number of coins.').catch(() => {});
                      }

                      if (minesVal < 1 || minesVal > 19) {
                        return await submit.editReply('❌ **Invalid Mines**: Number of mines must be between **1** and **19**.').catch(() => {});
                      }

                      // Check balance
                      const activeBal = await getUserBalance(userId, serverId);
                      if (activeBal.balance < betVal) {
                        return await submit.editReply(`❌ **Insufficient Coins**: You only have **${activeBal.balance}** ${currencyIcon} ${currencyName}.`).catch(() => {});
                      }

                      // Start mines game
                      await startMinesGame(userId, serverId, betVal, minesVal, submit, message.author, currencyIcon, currencyName);
                    } catch (submitErr) {
                      console.error('Modal submit error or timeout for mines:', submitErr);
                    }
                  } else if (action === 'blackjack') {
                    const modal = new ModalBuilder()
                      .setCustomId(`modal_blackjack_${userId}_${Date.now()}`)
                      .setTitle('🃏 Blackjack Bet');

                    const betInput = new TextInputBuilder()
                      .setCustomId('bet')
                      .setLabel('Bet Amount (Souls)')
                      .setPlaceholder('e.g., 50')
                      .setStyle(TextInputStyle.Short)
                      .setRequired(true);

                    const row1 = new ActionRowBuilder().addComponents(betInput);
                    modal.addComponents(row1);

                    await i.showModal(modal);

                    try {
                      const submit = await i.awaitModalSubmit({
                        filter: (sub) => sub.customId === modal.data.custom_id,
                        time: 60000
                      });

                      await submit.deferReply();

                      const betVal = parseInt(submit.fields.getTextInputValue('bet'));
                      if (isNaN(betVal) || betVal <= 0) {
                        return await submit.editReply('❌ **Invalid Bet**: Please enter a positive number of coins.').catch(() => {});
                      }

                      // Check balance
                      const activeBal = await getUserBalance(userId, serverId);
                      if (activeBal.balance < betVal) {
                        return await submit.editReply(`❌ **Insufficient Coins**: You only have **${activeBal.balance}** ${currencyIcon} ${currencyName}.`).catch(() => {});
                      }

                      // Start blackjack game
                      await startBlackjackGame(userId, serverId, betVal, submit, message.author, currencyIcon, currencyName);
                    } catch (submitErr) {
                      console.error('Modal submit error or timeout for blackjack:', submitErr);
                    }
                  }
                });

                collector.on('end', async () => {
                  // Disable buttons when dashboard expires
                  const disabledFlip = ButtonBuilder.from(buttonFlip).setDisabled(true);
                  const disabledCrash = ButtonBuilder.from(buttonCrash).setDisabled(true);
                  const disabledMines = ButtonBuilder.from(buttonMines).setDisabled(true);
                  const disabledBlackjack = ButtonBuilder.from(buttonBlackjack).setDisabled(true);
                  const endRow = new ActionRowBuilder().addComponents(disabledFlip, disabledCrash, disabledMines, disabledBlackjack);
                  await dashboardMsg.edit({ components: [endRow] }).catch(() => {});
                });

              } catch (dashboardErr) {
                console.error('Error launching casino dashboard:', dashboardErr);
              }
              return;
            }

            // Otherwise, process normal flip direct command
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

            // Run standalone coin flip
            await startFlipGame(userId, serverId, bet, choice, message, message.author, currencyIcon, currencyName);
            return;
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
                await recordCasinoGame(userId, serverId, bet, true, true);
                await recordCasinoGame(targetUser.id, serverId, bet, true, true);

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
                await recordCasinoGame(winnerId, serverId, pot, true, true);

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

            await startCrashGame(userId, serverId, bet, message, message.author, currencyIcon, currencyName);
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

            await startMinesGame(userId, serverId, bet, mineCount, message, message.author, currencyIcon, currencyName);
            return;
          }

          if (['inv', 'inventory'].includes(commandName)) {
            // 1. Fetch user inventory
            const userInv = await getUserInventory(userId, serverId);
            const settings = await getGlobalSettings();
            
            // 2. Map and filter characters
            const characterItems = [];
            let totalCaught = 0;
            
            for (const [itemId, qty] of Object.entries(userInv)) {
              const charDef = CHARACTER_SPAWNS.find(c => c.id === itemId);
              if (charDef) {
                const isCollectible = settings[`collectible_active_${charDef.id}`] === 'true';
                const collectiblePrice = settings[`collectible_price_${charDef.id}`] !== undefined
                  ? parseInt(settings[`collectible_price_${charDef.id}`], 10)
                  : null;
                const sellPrice = (isCollectible && collectiblePrice !== null && !isNaN(collectiblePrice))
                  ? collectiblePrice
                  : charDef.value;

                characterItems.push({
                  id: charDef.id,
                  name: charDef.name,
                  tier: charDef.tier,
                  value: charDef.value,
                  price: sellPrice,
                  isCollectible: isCollectible && collectiblePrice !== null && !isNaN(collectiblePrice),
                  quantity: qty,
                  color: charDef.color,
                  imagePath: charDef.imagePath
                });
                totalCaught += qty;
              }
            }
            
            // Sort characterItems: Divine -> Mythic -> Epic -> Rare -> Uncommon -> Common, then by name
            const tierOrder = { 'DIVINE': 0, 'MYTHIC': 1, 'EPIC': 2, 'RARE': 3, 'UNCOMMON': 4, 'COMMON': 5 };
            characterItems.sort((a, b) => {
              const orderA = tierOrder[a.tier] !== undefined ? tierOrder[a.tier] : 99;
              const orderB = tierOrder[b.tier] !== undefined ? tierOrder[b.tier] : 99;
              if (orderA !== orderB) return orderA - orderB;
              return a.name.localeCompare(b.name);
            });
            
            // 3. Render the image
            const avatarUrl = message.author.displayAvatarURL({ extension: 'png', size: 128 });
            await message.channel.sendTyping();
            
            try {
              const imageBuffer = await renderInventoryImage(message.author.username, avatarUrl, characterItems, totalCaught);
              
              // 4. Send the image
              const attachment = new AttachmentBuilder(imageBuffer, { name: 'inventory.png' });
              return await message.reply({
                content: `🎒 **${message.author.username}'s Spawn Inventory**`,
                files: [attachment]
              }).catch(() => {});
            } catch (renderErr) {
              console.error('Failed to render inventory image:', renderErr);
              return message.reply('❌ Failed to render inventory image. Please try again.').catch(() => {});
            }
          }

          if (['sell'].includes(commandName)) {
            if (args.length === 0) {
              return message.reply('❌ **Usage:** \`s sell <index/name> [quantity]\`\nExample: \`s sell 1\` or \`s sell Blossom Soul 2\`').catch(() => {});
            }
            
            // Get sender inventory to resolve indices/names
            const userInv = await getUserInventory(userId, serverId);
            const characterItems = [];
            for (const [itemId, qty] of Object.entries(userInv)) {
              const charDef = CHARACTER_SPAWNS.find(c => c.id === itemId);
              if (charDef) {
                characterItems.push({
                  id: charDef.id,
                  name: charDef.name,
                  tier: charDef.tier,
                  value: charDef.value,
                  quantity: qty
                });
              }
            }
            
            // Sort identically to s inv
            const tierOrder = { 'DIVINE': 0, 'MYTHIC': 1, 'EPIC': 2, 'RARE': 3, 'UNCOMMON': 4, 'COMMON': 5 };
            characterItems.sort((a, b) => {
              const orderA = tierOrder[a.tier] !== undefined ? tierOrder[a.tier] : 99;
              const orderB = tierOrder[b.tier] !== undefined ? tierOrder[b.tier] : 99;
              if (orderA !== orderB) return orderA - orderB;
              return a.name.localeCompare(b.name);
            });
            
            // Resolve target item and quantity
            let targetItem = null;
            let sellQty = 1;
            
            // Try checking if first arg is an index
            const indexVal = parseInt(args[0]);
            if (!isNaN(indexVal) && indexVal >= 1 && indexVal <= characterItems.length) {
              targetItem = characterItems[indexVal - 1];
              if (args[1]) {
                const qtyVal = parseInt(args[1]);
                if (!isNaN(qtyVal) && qtyVal > 0) {
                  sellQty = qtyVal;
                }
              }
            } else {
              // It is a name. Check if the last arg is a number representing quantity
              let nameArgs = [...args];
              const lastArg = nameArgs[nameArgs.length - 1];
              const qtyVal = parseInt(lastArg);
              if (!isNaN(qtyVal) && qtyVal > 0 && nameArgs.length > 1) {
                sellQty = qtyVal;
                nameArgs.pop(); // remove quantity from name
              }
              
              const searchName = nameArgs.join(' ').toLowerCase();
              // Try to find exact or prefix match
              targetItem = characterItems.find(c => c.name.toLowerCase() === searchName) ||
                           characterItems.find(c => c.name.toLowerCase().includes(searchName)) ||
                           characterItems.find(c => c.id.toLowerCase() === searchName);
            }
            
            if (!targetItem) {
              return message.reply('❌ Character not found in your inventory. Type \`s inv\` to view what you have caught.').catch(() => {});
            }

            // Determine sell price: collectible (admin-set premium) or default character value
            const settings = await getGlobalSettings();
            const isCollectible = settings[`collectible_active_${targetItem.id}`] === 'true';
            const collectiblePrice = settings[`collectible_price_${targetItem.id}`] !== undefined
              ? parseInt(settings[`collectible_price_${targetItem.id}`], 10)
              : null;

            // Use the collectible price if active AND a valid price is set, otherwise use default
            const sellPrice = (isCollectible && collectiblePrice !== null && !isNaN(collectiblePrice))
              ? collectiblePrice
              : targetItem.value;

            const priceLabel = (isCollectible && collectiblePrice !== null && !isNaN(collectiblePrice))
              ? `💎 **Rare Collectible Price** (${sellPrice} ${currencyIcon})`
              : `📦 **Default Price** (${sellPrice} ${currencyIcon})`;

            if (sellQty > targetItem.quantity) {
              return message.reply(`❌ You only have **${targetItem.quantity}** of **${targetItem.name}** in your inventory.`).catch(() => {});
            }
            
            // Execute sell
            const sellResult = await sellCharacter(userId, serverId, targetItem.id, sellPrice, sellQty);
            if (sellResult.success) {
              const totalEarned = sellPrice * sellQty;
              let desc = `You sold **${sellQty}x ${targetItem.name}** for a total of **${totalEarned}** ${currencyIcon} ${currencyName}!\n${priceLabel}`;
              if (sellResult.taxAmount > 0) {
                desc += `\n\n*Reaper's Cut: **${sellResult.taxAmount}** Souls siphoned to the Soul Vault (Net earned: **${sellResult.netEarnings}** Souls).*`;
              }
              const embed = new EmbedBuilder()
                .setColor(isCollectible ? '#ffd700' : '#00ffaa')
                .setTitle(isCollectible ? '💎 Rare Collectible Sold!' : '💰 Spawn Sold Successfully!')
                .setDescription(desc)
                .addFields(
                  { name: 'Remaining Quantity', value: `🎒 **${sellResult.newQty}**`, inline: true },
                  { name: 'New Wallet Balance', value: `🏦 **${sellResult.newBalance}** ${currencyIcon} ${currencyName}`, inline: true }
                )
                .setTimestamp();
              return await message.reply({ embeds: [embed] }).catch(() => {});
            } else {
              return message.reply('❌ Failed to sell the character.').catch(() => {});
            }
          }

          if (['giveaway', 'giveaways'].includes(commandName)) {
            // Block manual runs from Discord
            if (args[0] === 'run') {
              return message.reply('❌ Manual drawings can only be triggered from the **Web Admin Panel** for security.').catch(() => {});
            }

            const settings = await getGlobalSettings();
            const now = Date.now();

            const lastDaily = parseInt(settings.last_giveaway_daily || '0', 10);
            const lastWeekly = parseInt(settings.last_giveaway_weekly || '0', 10);
            const lastMonthly = parseInt(settings.last_giveaway_monthly || '0', 10);

            const dailyCooldown = 24 * 60 * 60 * 1000;
            const weeklyCooldown = 7 * 24 * 60 * 60 * 1000;
            const monthlyCooldown = 30 * 24 * 60 * 60 * 1000;

            const getRemainingTime = (lastTime, cooldown) => {
              const nextTime = lastTime + cooldown;
              if (now >= nextTime) return '⏳ Drawing soon...';
              const diffMs = nextTime - now;
              const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
              const diffMins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
              if (diffHours >= 24) {
                const days = Math.floor(diffHours / 24);
                const hours = diffHours % 24;
                return `⏳ ${days}d ${hours}h remaining`;
              }
              return `⏳ ${diffHours}h ${diffMins}m remaining`;
            };

            const getWinnerInfo = (winnerSetting) => {
              if (!winnerSetting) return 'No previous winner recorded.';
              try {
                const info = JSON.parse(winnerSetting);
                const dateStr = new Date(info.timestamp).toLocaleDateString();
                return `👤 **Winner:** <@${info.id}> (${info.tag || info.username})\n💰 **Prize:** **${info.amount.toLocaleString()}** Souls\n📅 **Date:** ${dateStr}`;
              } catch (e) {
                return 'No previous winner recorded.';
              }
            };

            const embed = new EmbedBuilder()
              .setColor('#8b2fc9')
              .setTitle('🎁 Soul Sweepstakes & Giveaways')
              .setDescription(
                'Automated giveaways are drawn regularly from active server members. ' +
                'Every member registered in the database is automatically entered!'
              )
              .addFields(
                {
                  name: '📅 Daily Sweepstakes (1,000 Souls)',
                  value: `${getRemainingTime(lastDaily, dailyCooldown)}\n\n**Last Draw:**\n${getWinnerInfo(settings.last_winner_daily)}`,
                  inline: false
                },
                {
                  name: '📅 Weekly Sweepstakes (5,000 Souls)',
                  value: `${getRemainingTime(lastWeekly, weeklyCooldown)}\n\n**Last Draw:**\n${getWinnerInfo(settings.last_winner_weekly)}`,
                  inline: false
                },
                {
                  name: '📅 Monthly Sweepstakes (50,000 Souls)',
                  value: `${getRemainingTime(lastMonthly, monthlyCooldown)}\n\n**Last Draw:**\n${getWinnerInfo(settings.last_winner_monthly)}`,
                  inline: false
                }
              )
              .setThumbnail(message.client.user.displayAvatarURL())
              .setFooter({ text: 'Wield the power of your Souls!' })
              .setTimestamp();

            return await message.reply({ embeds: [embed] }).catch(() => {});
          }

          if (['rare', 'collectibles'].includes(commandName)) {
            const settings = await getGlobalSettings();
            const activeCollectibles = [];
            
            CHARACTER_SPAWNS.forEach(char => {
              const isActive = settings[`collectible_active_${char.id}`] === 'true';
              if (isActive) {
                const price = settings[`collectible_price_${char.id}`] !== undefined 
                  ? parseInt(settings[`collectible_price_${char.id}`], 10) 
                  : char.value;
                activeCollectibles.push({
                  name: char.name,
                  tier: char.tier,
                  value: price
                });
              }
            });
            
            const embed = new EmbedBuilder()
              .setColor('#ffd700')
              .setTitle('💎 Today\'s Active Collectibles')
              .setTimestamp();
              
            if (activeCollectibles.length === 0) {
              embed.setDescription('There are no active collectibles today. Check back tomorrow!');
            } else {
              // Sort the active collectibles by rarity tier
              const tierOrder = { 'DIVINE': 0, 'MYTHIC': 1, 'EPIC': 2, 'RARE': 3, 'UNCOMMON': 4, 'COMMON': 5 };
              activeCollectibles.sort((a, b) => {
                const orderA = tierOrder[a.tier] !== undefined ? tierOrder[a.tier] : 99;
                const orderB = tierOrder[b.tier] !== undefined ? tierOrder[b.tier] : 99;
                if (orderA !== orderB) return orderA - orderB;
                return a.name.localeCompare(b.name);
              });

              const listStr = activeCollectibles.map((c) => {
                return `• **${c.name}** (Tier: *${c.tier}*) — **${c.value}** ${currencyIcon} ${currencyName}`;
              }).join('\n');
              embed.setDescription('Collect these souls from random drops and sell them today using `s sell <inventory_index/name>`!\n\n' + listStr);
            }
            
            return await message.reply({ embeds: [embed] }).catch(() => {});
          }
        }
      } catch (err) {
        console.error(`Error processing prefix command ${commandName} for user ${userId}:`, err);
        fulfilled = false;
        errorText = err.message || 'Execution Error';
        const res = await message.reply(`❌ An error occurred while executing this command: ${err.message}`).catch((replyErr) => {
          console.error('[Error Response Failed]', replyErr);
        });
        logFinal(false, errorText);
        return res;
      }

      // If it reaches the end successfully and didn't call reply/send yet, we log it
      logFinal(fulfilled, errorText);

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
