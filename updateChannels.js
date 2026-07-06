const fs = require('fs');
const path = require('path');

const replaceInFile = (file) => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace strict equality with includes for soul-bot
  content = content.replace(/=== 'soul-bot'/g, `.includes('soul-bot')`);
  
  // In interaction commands it's interaction.channel.name, in messageCreate it's message.channel.name
  // We should just replace !== 'soul-bot' with !...includes('soul-bot')
  content = content.replace(/interaction\.channel\.name\.toLowerCase\(\) !== 'soul-bot'/g, `!interaction.channel.name.toLowerCase().includes('soul-bot')`);
  content = content.replace(/message\.channel\.name\.toLowerCase\(\) !== 'soul-bot'/g, `!message.channel.name.toLowerCase().includes('soul-bot')`);

  // Same for admin-logs / soul-logs
  content = content.replace(/interaction\.channel\.name\.toLowerCase\(\) !== 'admin-logs'/g, `!interaction.channel.name.toLowerCase().includes('soul-logs')`);
  content = content.replace(/message\.channel\.name\.toLowerCase\(\) !== 'admin-logs'/g, `!message.channel.name.toLowerCase().includes('soul-logs')`);
  content = content.replace(/=== 'admin-logs'/g, `.includes('soul-logs')`);
  
  // Replace plain strings
  content = content.replace(/'admin-logs'/g, `'soul-logs'`);
  content = content.replace(/#admin-logs/g, '#soul-logs');
  
  fs.writeFileSync(file, content);
  console.log(`Updated ${file}`);
};

const files = [
  'src/commands/admin.js',
  'src/commands/balance.js',
  'src/commands/casino.js',
  'src/commands/checkin.js',
  'src/commands/leaderboard.js',
  'src/events/guildCreate.js',
  'src/events/messageCreate.js',
  'src/events/ready.js',
  'src/utils/drops.js'
];

files.forEach(f => replaceInFile(path.join(process.cwd(), f)));
