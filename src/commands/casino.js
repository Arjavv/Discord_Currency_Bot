const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { recordCasinoGame, getServerSettings } = require('../database/queries');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('casino')
    .setDescription('Play casino games for a chance to win or lose coins')
    .addSubcommand(subcommand =>
      subcommand
        .setName('flip')
        .setDescription('Flip a coin for double or nothing (50% chance)')
        .addStringOption(option =>
          option.setName('choice')
            .setDescription('Select Heads or Tails')
            .setRequired(true)
            .addChoices(
              { name: 'Heads', value: 'heads' },
              { name: 'Tails', value: 'tails' }
            )
        )
        .addIntegerOption(option =>
          option.setName('bet')
            .setDescription('Amount of coins to bet')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    // 1. Enforce channel restriction to #💵-soul-casino
    if (!interaction.channel || !interaction.channel.name.toLowerCase().includes('soul-casino')) {
      return await interaction.reply({
        content: '❌ This command can only be used in the **#💵-soul-casino** channel.',
        ephemeral: true
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const serverId = interaction.guildId;

    try {
      const settings = await getServerSettings(serverId);
      const currencyName = settings.currency_name;
      const currencyIcon = settings.currency_icon_url;

      if (subcommand === 'flip') {
        const choice = interaction.options.getString('choice');
        const bet = interaction.options.getInteger('bet');

        if (bet <= 0) {
          return await interaction.reply({
            content: '❌ You must bet a positive number of coins.',
            ephemeral: true
          });
        }

        await interaction.deferReply();

        // 2. Perform coin flip logic (50% chance)
        const flipResult = Math.random() < 0.5 ? 'heads' : 'tails';
        const isWin = choice === flipResult;

        // 3. Database transaction
        const result = await recordCasinoGame(userId, serverId, bet, isWin);

        if (!result.success) {
          if (result.reason === 'insufficient_funds') {
            const errorEmbed = new EmbedBuilder()
              .setColor('#ff3366')
              .setTitle('❌ Insufficient Coins')
              .setDescription(`You don't have enough coins to place that bet!`)
              .addFields(
                { name: 'Your Balance', value: `**${result.currentBalance}** ${currencyIcon} ${currencyName}`, inline: true },
                { name: 'Attempted Bet', value: `**${bet}** ${currencyIcon} ${currencyName}`, inline: true }
              )
              .setTimestamp();

            return await interaction.editReply({ embeds: [errorEmbed] });
          }
          throw new Error('Database transaction failed without reason');
        }

        // 4. Construct beautiful flip results embed
        const capitalizedChoice = choice.charAt(0).toUpperCase() + choice.slice(1);
        const capitalizedResult = flipResult.charAt(0).toUpperCase() + flipResult.slice(1);

        const displayChoice = choice === 'heads' ? '<:Soul_Head:1523605643158618214>' : '<:Soul_Tail:1523605605787373610>';
        const displayResult = flipResult === 'heads' ? '<:Soul_Head:1523605643158618214>' : '<:Soul_Tail:1523605605787373610>';

        const gifName = flipResult === 'heads' ? 'heads.gif' : 'tails.gif';
        const gifPath = path.join(__dirname, '..', 'assets', gifName);
        const attachment = new AttachmentBuilder(gifPath, { name: gifName });

        const embed = new EmbedBuilder()
          .setAuthor({
            name: `${interaction.user.username}'s Coin Flip`,
            iconURL: interaction.user.displayAvatarURL({ dynamic: true })
          })
          .setImage(`attachment://${gifName}`)
          .setTimestamp();

        if (isWin) {
          embed
            .setColor('#00ffaa') // Mint Green
            .setTitle('<:Soul_Head:1523605643158618214> Double or Nothing: WIN!')
            .setDescription(`The coin spun in the air and landed on ${displayResult} **${capitalizedResult}**!`)
            .addFields(
              { name: 'Your Prediction', value: `${displayChoice} **${capitalizedChoice}**`, inline: true },
              { name: 'Coin Landed On', value: `${displayResult} **${capitalizedResult}**`, inline: true },
              { name: 'Net Earnings', value: `**+${bet}** ${currencyIcon} ${currencyName}`, inline: false },
              { name: 'New Wallet Balance', value: `**${result.newBalance}** ${currencyIcon} ${currencyName}`, inline: false }
            );
        } else {
          embed
            .setColor('#ff3366') // Neon Red
            .setTitle('<:Soul_Head:1523605643158618214> Double or Nothing: LOSS')
            .setDescription(`The coin spun in the air and landed on ${displayResult} **${capitalizedResult}**...`)
            .addFields(
              { name: 'Your Prediction', value: `${displayChoice} **${capitalizedChoice}**`, inline: true },
              { name: 'Coin Landed On', value: `${displayResult} **${capitalizedResult}**`, inline: true },
              { name: 'Lost Bet', value: `**-${bet}** ${currencyIcon} ${currencyName}`, inline: false },
              { name: 'New Wallet Balance', value: `**${result.newBalance}** ${currencyIcon} ${currencyName}`, inline: false }
            );
        }

        return await interaction.editReply({ embeds: [embed], files: [attachment] });
      }
    } catch (error) {
      console.error(`Error processing casino subcommand ${subcommand} for user ${userId}:`, error);
      throw error;
    }
  }
};
