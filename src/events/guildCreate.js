module.exports = {
  name: 'guildCreate',
  once: false,
  async execute(guild) {
    console.log(`Joined a new server: ${guild.name} (${guild.id})`);
  }
};

