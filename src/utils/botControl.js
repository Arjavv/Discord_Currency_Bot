const { getGlobalSettings, getServerFeatureOverrides } = require('../database/queries');

const ADMIN_PREFIX_COMMANDS = ['setup', 'set-drop-channel', 'force-drop', 'auto-drops', 'help'];


const READONLY_PREFIX_COMMANDS = ['cash', 'balance', 'bal', 'money', 'leaderboard', 'lb', 'rich', 'stats', 'profile', 'help'];
const READONLY_SLASH_COMMANDS = ['balance', 'leaderboard', 'stats'];

const FEATURE_COMMAND_MAP = {
  checkin: ['daily', 'checkin', 'claim'],
  casino: ['flip', 'casino', 'bet', 'crash', 'mines'],
  shop: ['shop', 'buy'],
  duels: ['fight'],
  rob: ['rob', 'steal', 'heist'],
  transfers: ['gift', 'give', 'send', 'transfer']
};

function parseBool(value, defaultTrue = true) {
  if (value === undefined || value === null || value === '') return defaultTrue;
  return value === 'true' || value === '1';
}

async function getBotControlState(serverId = null) {
  const settings = await getGlobalSettings();
  const dropsPausedUntil = parseInt(settings.drops_paused_until, 10) || 0;
  const isPaused = Date.now() < dropsPausedUntil;

  const globalFeatures = {
    checkin: parseBool(settings.feature_checkin, true),
    casino: parseBool(settings.feature_casino, true),
    shop: parseBool(settings.feature_shop, true),
    duels: parseBool(settings.feature_duels, true),
    rob: parseBool(settings.feature_rob, true),
    drops: parseBool(settings.feature_drops, true) && !isPaused,
    messageEarnings: parseBool(settings.feature_message_earnings, true),
    transfers: parseBool(settings.feature_transfers, true)
  };

  // Merge per-server overrides (only if a server is specified)
  let features = { ...globalFeatures };
  if (serverId && serverId !== 'GLOBAL') {
    const overrides = await getServerFeatureOverrides(serverId);
    for (const [key, val] of Object.entries(overrides)) {
      // Only apply override if global feature is ON (globally disabled = disabled everywhere)
      if (globalFeatures[key] !== false) {
        features[key] = val;
      }
    }
  }

  return {
    maintenanceMode: parseBool(settings.maintenance_mode, false),
    maintenanceMessage: settings.maintenance_message
      || '🔧 The Soul Currency bot is currently under maintenance. Please try again later.',
    features,
    dropsPausedUntil,
    checkinMin: parseInt(settings.checkin_min, 10) || 500,
    checkinMax: parseInt(settings.checkin_max, 10) || 1000,
    slashCheckinAmount: parseInt(settings.slash_checkin_amount, 10) || 20,
    messageReward: parseInt(settings.message_reward, 10) || 100,
    messageDailyCap: parseInt(settings.message_daily_cap, 10) || 5000,
    messageCooldownSeconds: parseInt(settings.message_cooldown_seconds, 10) || 15,
    messageMilestone: parseInt(settings.message_milestone, 10) || 10
  };
}

function isAdminPrefixCommand(commandName) {
  return ADMIN_PREFIX_COMMANDS.includes(commandName);
}

function isReadonlyPrefixCommand(commandName) {
  return READONLY_PREFIX_COMMANDS.includes(commandName);
}

function isReadonlySlashCommand(commandName) {
  return READONLY_SLASH_COMMANDS.includes(commandName);
}

function getFeatureForPrefixCommand(commandName) {
  for (const [feature, commands] of Object.entries(FEATURE_COMMAND_MAP)) {
    if (commands.includes(commandName)) return feature;
  }
  if (commandName === 'checkin') return 'checkin';
  return null;
}

function getFeatureForSlashCommand(commandName) {
  if (commandName === 'checkin') return 'checkin';
  if (commandName === 'casino') return 'casino';
  return null;
}

function getRandomCheckinAmount(state) {
  const min = Math.min(state.checkinMin, state.checkinMax);
  const max = Math.max(state.checkinMin, state.checkinMax);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function updateBotPresence(client) {
  if (!client || !client.user) return;
  try {
    const { ActivityType } = require('discord.js');
    const state = await getBotControlState();
    
    if (state.maintenanceMode) {
      client.user.setPresence({
        activities: [{ name: '🔧 Under Maintenance', type: ActivityType.Playing }],
        status: 'dnd'
      });
      console.log('Bot presence set to: Maintenance Mode (dnd)');
    } else {
      client.user.setPresence({
        activities: [{ name: '⚔️ Souls Economy', type: ActivityType.Competing }],
        status: 'online'
      });
      console.log('Bot presence set to: Live (online)');
    }
  } catch (error) {
    console.error('Error updating bot presence:', error);
  }
}

module.exports = {
  ADMIN_PREFIX_COMMANDS,
  READONLY_PREFIX_COMMANDS,
  READONLY_SLASH_COMMANDS,
  getBotControlState,
  isAdminPrefixCommand,
  isReadonlyPrefixCommand,
  isReadonlySlashCommand,
  getFeatureForPrefixCommand,
  getFeatureForSlashCommand,
  getRandomCheckinAmount,
  updateBotPresence
};
