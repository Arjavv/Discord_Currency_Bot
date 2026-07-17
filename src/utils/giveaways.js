const { pool } = require('../database/db');
const { getServerGiveawaySettings, setServerGiveawaySettings, getServerSettings } = require('../database/queries');
const { EmbedBuilder } = require('discord.js');

const DAILY_VALUE = 1000;
const WEEKLY_VALUE = 5000;
const MONTHLY_VALUE = 50000;

const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;       // 24 hours
const WEEKLY_COOLDOWN = 7 * 24 * 60 * 60 * 1000;   // 7 days
const MONTHLY_COOLDOWN = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Sends the giveaway announcement to the target server's logs/bot channel.
 */
async function announceServerGiveaway(guild, type, winnerUser, amount, pingTemplate, descTemplate) {
  try {
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

    if (!targetChannel) {
      console.warn(`[GIVEAWAY] No suitable text channel found to broadcast in guild: ${guild.name} (${guild.id})`);
      return;
    }

    const replacePlaceholders = (str) => {
      return str
        .replace(/{mention}/g, `<@${winnerUser.id}>`)
        .replace(/{tag}/g, winnerUser.tag)
        .replace(/{type}/g, type)
        .replace(/{amount}/g, amount.toLocaleString());
    };

    const pingContent = replacePlaceholders(pingTemplate || `🎉 CONGRATULATIONS {mention}! You won the {type} giveaway draw! 🎉`);
    const descriptionContent = replacePlaceholders(descTemplate || `A lucky server member has been chosen by the cosmic scales for the **{type}** sweepstakes!\n\n👤 **Winner:** {tag} ({mention})\n💰 **Prize:** **{amount}** Souls\n\nCongratulations to the winner! Keep chatting and claiming drops to stand a chance in the next draw!`);

    const embed = new EmbedBuilder()
      .setColor(type === 'monthly' ? '#f5c842' : type === 'weekly' ? '#ff6090' : '#8b2fc9')
      .setTitle(`🎁 SOUL ${type.toUpperCase()} GIVEAWAY WINNER! 🎁`)
      .setThumbnail(winnerUser.displayAvatarURL({ dynamic: true }))
      .setDescription(descriptionContent)
      .setFooter({ text: 'Soul Economy Giveaway System', iconURL: guild.client.user.displayAvatarURL() })
      .setTimestamp();

    await targetChannel.send({ content: pingContent, embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error(`Failed to broadcast giveaway announcement to guild ${guild.name}:`, err);
  }
}

/**
 * Runs a single giveaway of the specified type for a specific guild/server.
 */
async function runServerGiveaway(guild, type, amount) {
  const serverId = guild.id;
  console.log(`[GIVEAWAY] Starting run for: ${type} in server ${guild.name} (${serverId})`);

  // 1. Get all unique Discord IDs who are active/registered in this server
  const usersRes = await pool.query(
    "SELECT DISTINCT discord_id FROM users WHERE server_id = $1 AND discord_id != 'GLOBAL'",
    [serverId]
  );
  
  let candidateIds = usersRes.rows.map(r => r.discord_id);

  // If no users are found in database for this server yet, fallback to members in the server's cache
  if (candidateIds.length === 0) {
    console.log(`[GIVEAWAY] No database users found for server ${serverId}. Falling back to cached guild members list...`);
    try {
      const members = await guild.members.fetch();
      candidateIds = members.filter(m => !m.user.bot).map(m => m.user.id);
    } catch (e) {
      console.error(`[GIVEAWAY] Failed to fetch server members list fallback:`, e);
    }
  }

  if (candidateIds.length === 0) {
    console.warn(`[GIVEAWAY] Aborting giveaway in server ${serverId}: no human candidates found.`);
    return null;
  }

  // Shuffle list to get high entropy randomness
  candidateIds.sort(() => Math.random() - 0.5);

  let winnerUser = null;
  let winnerId = null;

  // 2. Resolve a valid Discord user object
  for (const id of candidateIds) {
    try {
      winnerUser = await guild.client.users.fetch(id);
      if (winnerUser && !winnerUser.bot) {
        winnerId = id;
        break;
      }
    } catch (e) {
      // Continue to next candidate
    }
  }

  if (!winnerId || !winnerUser) {
    console.warn(`[GIVEAWAY] Aborting giveaway in server ${serverId}: no active human users resolved.`);
    return null;
  }

  console.log(`[GIVEAWAY] Winner selected for ${type} in server ${serverId}: ${winnerUser.tag} (${winnerId})`);

  // 3. Ensure user records exist in DB
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // Ensure the specific server user record exists
    await dbClient.query(
      "INSERT INTO users (discord_id, server_id, coin_balance) VALUES ($1, $2, 0) ON CONFLICT (discord_id, server_id) DO NOTHING",
      [winnerId, serverId]
    );
    // Ensure global record exists
    await dbClient.query(
      "INSERT INTO users (discord_id, server_id, coin_balance) VALUES ($1, 'GLOBAL', 0) ON CONFLICT (discord_id, server_id) DO NOTHING",
      [winnerId]
    );

    // 4. Award the user balance globally
    await dbClient.query(
      "UPDATE users SET coin_balance = coin_balance + $1 WHERE discord_id = $2 AND server_id = 'GLOBAL'",
      [amount, winnerId]
    );

    // 5. Log transaction
    await dbClient.query(
      "INSERT INTO transactions (user_id, server_id, amount, source, created_at) VALUES ($1, $2, $3, 'giveaway', NOW())",
      [winnerId, serverId, amount]
    );

    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error(`[GIVEAWAY] Database operation failed for ${type} giveaway in server ${serverId}:`, err);
    throw err;
  } finally {
    dbClient.release();
  }

  // 6. Save state to server specific giveaways table
  const now = new Date();
  const winnerData = {
    id: winnerId,
    username: winnerUser.username,
    tag: winnerUser.tag,
    avatar: winnerUser.displayAvatarURL(),
    timestamp: now.getTime(),
    amount: amount
  };

  const updates = {};
  updates[`last_giveaway_${type}`] = now.getTime();
  updates[`last_winner_${type}`] = JSON.stringify(winnerData);
  
  const serverSettings = await getServerGiveawaySettings(serverId);
  await setServerGiveawaySettings(serverId, updates);

  // 7. Broadcast in that server
  await announceServerGiveaway(guild, type, winnerUser, amount, serverSettings.giveaway_ping_template, serverSettings.giveaway_desc_template);
  console.log(`[GIVEAWAY] Completed ${type} giveaway successfully for server ${serverId}.`);
  return { winnerUser, winnerId };
}

/**
 * Checks and runs giveaways for each server.
 */
async function checkAndRunGiveaways(client) {
  if (process.env.RUN_DISCORD_CLIENT === 'false') return;
  if (!client.isReady()) return;

  const guilds = client.guilds.cache;
  for (const [guildId, guild] of guilds) {
    try {
      const settings = await getServerGiveawaySettings(guildId);
      const now = Date.now();

      const lastDaily = parseInt(settings.last_giveaway_daily || '0', 10);
      const lastWeekly = parseInt(settings.last_giveaway_weekly || '0', 10);
      const lastMonthly = parseInt(settings.last_giveaway_monthly || '0', 10);

      // 1. Check Daily Giveaway
      if (now - lastDaily >= DAILY_COOLDOWN) {
        await runServerGiveaway(guild, 'daily', DAILY_VALUE);
      }

      // 2. Check Weekly Giveaway
      if (now - lastWeekly >= WEEKLY_COOLDOWN) {
        await runServerGiveaway(guild, 'weekly', WEEKLY_VALUE);
      }

      // 3. Check Monthly Giveaway
      if (now - lastMonthly >= MONTHLY_COOLDOWN) {
        await runServerGiveaway(guild, 'monthly', MONTHLY_VALUE);
      }

    } catch (error) {
      console.error(`[GIVEAWAY] Error checking giveaways for server ${guild.name} (${guildId}):`, error);
    }
  }
}

module.exports = {
  checkAndRunGiveaways,
  runServerGiveaway
};
