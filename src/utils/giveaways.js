const { pool } = require('../database/db');
const { getGlobalSettings, setGlobalSetting } = require('../database/queries');
const { EmbedBuilder } = require('discord.js');

const DAILY_VALUE = 1000;
const WEEKLY_VALUE = 5000;
const MONTHLY_VALUE = 50000;

const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;       // 24 hours
const WEEKLY_COOLDOWN = 7 * 24 * 60 * 60 * 1000;   // 7 days
const MONTHLY_COOLDOWN = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Iterates through all guilds and attempts to broadcast an announcement embed.
 */
async function announceGiveaway(client, type, winnerUser, amount) {
  const globalSettings = await getGlobalSettings();
  const pingTemplate = globalSettings.giveaway_ping_template || `🎉 CONGRATULATIONS {mention}! You won the {type} giveaway draw! 🎉`;
  const descTemplate = globalSettings.giveaway_desc_template || `A lucky server member has been chosen by the cosmic scales for the **{type}** sweepstakes!\n\n👤 **Winner:** {tag} ({mention})\n💰 **Prize:** **{amount}** Souls\n\nCongratulations to the winner! Keep chatting and claiming drops to stand a chance in the next draw!`;

  const replacePlaceholders = (str) => {
    return str
      .replace(/{mention}/g, `<@${winnerUser.id}>`)
      .replace(/{tag}/g, winnerUser.tag)
      .replace(/{type}/g, type)
      .replace(/{amount}/g, amount.toLocaleString());
  };

  const pingContent = replacePlaceholders(pingTemplate);
  const descriptionContent = replacePlaceholders(descTemplate);

  const embed = new EmbedBuilder()
    .setColor(type === 'monthly' ? '#f5c842' : type === 'weekly' ? '#ff6090' : '#8b2fc9')
    .setTitle(`🎁 SOUL ${type.toUpperCase()} GIVEAWAY WINNER! 🎁`)
    .setThumbnail(winnerUser.displayAvatarURL({ dynamic: true }))
    .setDescription(descriptionContent)
    .setFooter({ text: 'Soul Economy Giveaway System', iconURL: client.user.displayAvatarURL() })
    .setTimestamp();

  client.guilds.cache.forEach(async (guild) => {
    try {
      const { getServerSettings } = require('../database/queries');
      const settings = await getServerSettings(guild.id);
      let targetChannel = null;

      // Try channels in priority order
      if (settings.bot_channel_id) {
        targetChannel = guild.channels.cache.get(settings.bot_channel_id) || 
                        await guild.channels.fetch(settings.bot_channel_id).catch(() => null);
      }
      if (!targetChannel && settings.drop_channel_id) {
        targetChannel = guild.channels.cache.get(settings.drop_channel_id) ||
                        await guild.channels.fetch(settings.drop_channel_id).catch(() => null);
      }
      if (!targetChannel) {
        targetChannel = guild.channels.cache.find(
          c => (c.name.toLowerCase().includes('soul-bot') || c.name.toLowerCase().includes('soul-logs')) && c.isTextBased()
        );
      }
      if (!targetChannel) {
        targetChannel = guild.channels.cache.find(
          c => (c.name.toLowerCase().includes('general') || c.name.toLowerCase().includes('chat')) && c.isTextBased()
        );
      }

      if (targetChannel) {
        await targetChannel.send({ content: pingContent, embeds: [embed] }).catch(() => {});
      }
    } catch (err) {
      console.error(`Failed to broadcast giveaway announcement to guild ${guild.name}:`, err);
    }
  });
}

/**
 * Runs a single giveaway of the specified type.
 */
async function runGiveaway(client, type, amount) {
  console.log(`[GIVEAWAY] Starting run for: ${type}`);
  
  // 1. Get all unique Discord IDs (ignoring the special 'GLOBAL' user entry)
  const usersRes = await pool.query("SELECT DISTINCT discord_id FROM users WHERE discord_id != 'GLOBAL'");
  if (usersRes.rows.length === 0) {
    console.warn(`[GIVEAWAY] Aborting ${type} giveaway: no users exist in the database.`);
    return null;
  }

  // Shuffle list to get high entropy randomness
  const candidateIds = usersRes.rows.map(r => r.discord_id).sort(() => Math.random() - 0.5);

  let winnerUser = null;
  let winnerId = null;

  // 2. Resolve a valid Discord user object
  for (const id of candidateIds) {
    try {
      winnerUser = await client.users.fetch(id);
      if (winnerUser && !winnerUser.bot) {
        winnerId = id;
        break;
      }
    } catch (e) {
      // User might have left or deleted account, continue to next candidate
    }
  }

  if (!winnerId || !winnerUser) {
    console.warn(`[GIVEAWAY] Aborting ${type} giveaway: no active human users resolved.`);
    return null;
  }

  console.log(`[GIVEAWAY] Winner selected for ${type}: ${winnerUser.tag} (${winnerId})`);

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // 3. Award the user balance globally
    await dbClient.query(
      "UPDATE users SET coin_balance = coin_balance + $1 WHERE discord_id = $2 AND server_id = 'GLOBAL'",
      [amount, winnerId]
    );

    // 4. Log transaction
    await dbClient.query(
      "INSERT INTO transactions (user_id, server_id, amount, source, created_at) VALUES ($1, 'GLOBAL', $2, 'giveaway', NOW())",
      [winnerId, amount]
    );

    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error(`[GIVEAWAY] Database operation failed for ${type} giveaway:`, err);
    throw err;
  } finally {
    dbClient.release();
  }

  // 5. Save state to global settings
  const now = new Date();
  await setGlobalSetting(`last_giveaway_${type}`, String(now.getTime()));
  await setGlobalSetting(`last_winner_${type}`, JSON.stringify({
    id: winnerId,
    username: winnerUser.username,
    tag: winnerUser.tag,
    avatar: winnerUser.displayAvatarURL(),
    timestamp: now.getTime(),
    amount: amount
  }));

  // 6. Broadcast to all servers
  await announceGiveaway(client, type, winnerUser, amount);
  console.log(`[GIVEAWAY] Completed ${type} giveaway successfully.`);
  return { winnerUser, winnerId };
}

/**
 * Checks and runs giveaways if their cooldown has expired.
 */
async function checkAndRunGiveaways(client) {
  if (process.env.RUN_DISCORD_CLIENT === 'false') return;
  if (!client.isReady()) return;

  try {
    const settings = await getGlobalSettings();
    const now = Date.now();

    const lastDaily = parseInt(settings.last_giveaway_daily || '0', 10);
    const lastWeekly = parseInt(settings.last_giveaway_weekly || '0', 10);
    const lastMonthly = parseInt(settings.last_giveaway_monthly || '0', 10);

    // 1. Check Daily Giveaway
    if (now - lastDaily >= DAILY_COOLDOWN) {
      await runGiveaway(client, 'daily', DAILY_VALUE);
    }

    // 2. Check Weekly Giveaway
    if (now - lastWeekly >= WEEKLY_COOLDOWN) {
      await runGiveaway(client, 'weekly', WEEKLY_VALUE);
    }

    // 3. Check Monthly Giveaway
    if (now - lastMonthly >= MONTHLY_COOLDOWN) {
      await runGiveaway(client, 'monthly', MONTHLY_VALUE);
    }

  } catch (error) {
    console.error('[GIVEAWAY] Error during checking/running giveaways:', error);
  }
}

module.exports = {
  checkAndRunGiveaways,
  runGiveaway
};
