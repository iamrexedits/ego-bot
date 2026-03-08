/**
 * Core Module
 * Essential bot commands: help, serverinfo, botinfo, github, stats
 * Features: Dynamic module discovery, rich embeds, bot statistics
 */

class CoreModule {
    constructor(client) {
        this.client = client;
        this.name = 'core';
        this.storage = null;
        this.config = null;
        
        // Bot credits - modify these IDs
        this.credits = {
            vermeil: '1181137505505001544',  // Replace with actual Discord ID
            luna: '1043020237945184256'         // Replace with actual Discord ID
        };
        
        // GitHub repository link
        this.githubUrl = 'https://github.com/iamrexedits/ego-bot'; // Replace with your repo
    }

    init() {
        this.storage = this.client.storage;
        this.config = this.client.config;
        console.log(`[${this.name}] Core commands ready`);
    }

    // ==================== EVENT HANDLERS ====================

    onCommand(command, args, message) {
        switch(command) {
            case 'help':
            case 'h':
                this.handleHelp(message, args);
                break;
            case 'serverinfo':
            case 'si':
            case 'guildinfo':
                this.handleServerInfo(message);
                break;
            case 'botinfo':
            case 'bi':
            case 'info':
                this.handleBotInfo(message);
                break;
            case 'github':
            case 'repo':
            case 'source':
                this.handleGitHub(message);
                break;
            case 'ping':
                this.handlePing(message);
                break;
            case 'invite':
                this.handleInvite(message);
                break;
            case 'uptime':
                this.handleUptime(message);
                break;
        }
    }

    // ==================== HELP COMMAND ====================
    // ==================== HELP COMMAND ====================

async handleHelp(message, args) {
    const prefix = this.config.prefix;
    
    // If specific module requested
    const moduleName = args[0]?.toLowerCase();
    if (moduleName) {
        return this.showModuleHelp(message, moduleName);
    }

    // Get all loaded modules - access through client
    const moduleManager = this.client.modules;
    const modules = moduleManager?.modules;
    const moduleList = modules ? Array.from(modules.keys()) : [];

    // Build dynamic command list based on loaded modules
    const fields = [];

    // Core commands (always available)
    fields.push({
        name: '📌 Core Commands',
        value: [
            `\`${prefix}help\` - Show this menu`,
            `\`${prefix}help <module>\` - Module specific help`,
            `\`${prefix}serverinfo\` - Server statistics`,
            `\`${prefix}botinfo\` - Bot information`,
            `\`${prefix}github\` - Source code`,
            `\`${prefix}ping\` - Check latency`,
            `\`${prefix}uptime\` - Bot uptime`,
            `\`${prefix}invite\` - Bot invite link`
        ].join('\n'),
        inline: false
    });

    // Dynamic module commands - iterate through loaded modules
    if (modules && modules.size > 0) {
        const moduleCommands = [];
        
        for (const [name, module] of modules) {
            if (name === 'core') continue; // Skip core, already listed
            
            const commands = this.getModuleCommands(name);
            if (commands.length > 0) {
                moduleCommands.push({
                    name: `🧩 ${this.capitalize(name)}`,
                    value: commands.map(cmd => `\`${prefix}${cmd}\``).join(', ').substring(0, 1024),
                    inline: true
                });
            } else {
                // Module exists but has no commands (automatic functionality)
                moduleCommands.push({
                    name: `🧩 ${this.capitalize(name)}`,
                    value: '*Automatic functionality*',
                    inline: true
                });
            }
        }

        // Add module commands to fields (limit to prevent embed overflow)
        fields.push(...moduleCommands.slice(0, 20));
    }

    // Quick tips
    const tips = [
        `Use \`${prefix}help <module>\` for detailed command info`,
        `Example: \`${prefix}help automod\``,
        `Admin commands require Administrator permission`
    ];

    const embed = {
        title: `${this.config.name} Help Menu`,
        description: [
            `**Prefix:** \`${prefix}\``,
            `**Version:** ${this.config.version}`,
            `**Modules Loaded:** ${moduleList.length}`,
            moduleList.length > 0 ? `**Active:** ${moduleList.map(m => `\`${m}\``).join(', ')}` : '',
            '',
            'Need assistance? Contact the developers!'
        ].filter(Boolean).join('\n'),
        color: 0x5865F2,
        fields: fields,
        footer: {
            text: `💡 Tip: ${tips[Math.floor(Math.random() * tips.length)]}`
        },
        timestamp: new Date(),
        thumbnail: {
            url: this.client.user.displayAvatarURL({ dynamic: true })
        }
    };

    message.reply({ embeds: [embed] });
}

showModuleHelp(message, moduleName) {
    // Access module manager through client
    const moduleManager = this.client.modules;
    const modules = moduleManager?.modules;
    const module = modules?.get(moduleName.toLowerCase());

    if (!module) {
        const available = modules ? Array.from(modules.keys()).join(', ') : 'none';
        return message.reply({
            embeds: [{
                title: '❌ Module Not Found',
                description: `Module \`${moduleName}\` is not loaded.\n\n**Available modules:**\n\`${available}\``,
                color: 0xe74c3c
            }]
        });
    }

    // Try to get help from module if it has getHelpEmbed method
    if (typeof module.getHelpEmbed === 'function') {
        try {
            const helpData = module.getHelpEmbed();
            if (helpData) {
                return message.reply(helpData);
            }
        } catch (e) {
            console.error(`[Core] Error getting help from ${moduleName}:`, e);
        }
    }

    // Fallback generic help
    const commands = this.getModuleCommands(moduleName);
    
    const embed = {
        title: `🧩 ${this.capitalize(moduleName)} Module`,
        description: commands.length > 0 
            ? `**Commands:**\n${commands.map(cmd => `\`${this.config.prefix}${cmd}\``).join('\n')}`
            : 'This module has no commands or provides automatic functionality.',
        color: 0x3498db,
        footer: {
            text: `Use ${this.config.prefix}help to see all modules`
        }
    };

    message.reply({ embeds: [embed] });
}


    getModuleCommands(moduleName) {
        const commandMap = {
            'autorole': ['autorole', 'arhuman', 'arbot', 'artoggle', 'arstatus'],
            'automod': ['automod', 'amtoggle', 'amstatus', 'amexempt', 'amwords', 'amreset'],
            'logs': ['logs', 'logchannel', 'logtoggle'],
            'moderation': ['kick', 'ban', 'purge', 'warn', 'mute', 'unmute']
        };
        
        return commandMap[moduleName] || [];
    }

    // ==================== SERVER INFO COMMAND ====================

    async handleServerInfo(message) {
        const guild = message.guild;
        if (!guild) return message.reply('This command can only be used in a server!');

        // Fetch detailed info
        const owner = await guild.fetchOwner().catch(() => null);
        
        // Count channels by type
        const channels = guild.channels.cache;
        const textChannels = channels.filter(c => c.type === 0).size;
        const voiceChannels = channels.filter(c => c.type === 2).size;
        const categories = channels.filter(c => c.type === 4).size;
        const stageChannels = channels.filter(c => c.type === 13).size;
        const forumChannels = channels.filter(c => c.type === 15).size;

        // Count members by status
        const members = await guild.members.fetch({ withPresences: true }).catch(() => null);
        const online = members?.filter(m => m.presence?.status === 'online').size || 0;
        const idle = members?.filter(m => m.presence?.status === 'idle').size || 0;
        const dnd = members?.filter(m => m.presence?.status === 'dnd').size || 0;
        const offline = members?.filter(m => !m.presence || m.presence.status === 'offline').size || 0;
        const bots = members?.filter(m => m.user.bot).size || 0;
        const humans = (members?.size || guild.memberCount) - bots;

        // Boost info
        const boostLevel = guild.premiumTier;
        const boostCount = guild.premiumSubscriptionCount || 0;

        // Security features
        const verificationLevels = ['None', 'Low', 'Medium', 'High', 'Very High'];
        const contentFilter = ['Disabled', 'Members without roles', 'All members'];

        const embed = {
            title: `${guild.name} Server Information`,
            color: 0x5865F2,
            thumbnail: {
                url: guild.iconURL({ dynamic: true, size: 512 }) || null
            },
            image: {
                url: guild.bannerURL({ size: 1024 }) || null
            },
            fields: [
                {
                    name: '📋 General',
                    value: [
                        `**Name:** ${guild.name}`,
                        `**ID:** ${guild.id}`,
                        `**Owner:** ${owner ? owner.user.tag : 'Unknown'} ${owner ? `(<@${owner.id}>)` : ''}`,
                        `**Created:** <t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
                        `**Vanity URL:** ${guild.vanityURLCode || 'None'}`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '👥 Members',
                    value: [
                        `**Total:** ${guild.memberCount.toLocaleString()}`,
                        `**Humans:** ${humans.toLocaleString()}`,
                        `**Bots:** ${bots.toLocaleString()}`,
                        '',
                        `🟢 Online: ${online}`,
                        `🟡 Idle: ${idle}`,
                        `🔴 DND: ${dnd}`,
                        `⚫ Offline: ${offline}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '💬 Channels',
                    value: [
                        `**Total:** ${channels.size}`,
                        `**Text:** ${textChannels}`,
                        `**Voice:** ${voiceChannels}`,
                        `**Stage:** ${stageChannels}`,
                        `**Forum:** ${forumChannels}`,
                        `**Categories:** ${categories}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '✨ Boosts & Features',
                    value: [
                        `**Level:** ${boostLevel} (${boostCount} boosts)`,
                        `**Emojis:** ${guild.emojis.cache.size}/${guild.premiumTier >= 3 ? 500 : guild.premiumTier >= 2 ? 300 : guild.premiumTier >= 1 ? 200 : 100}`,
                        `**Stickers:** ${guild.stickers.cache.size}/${guild.premiumTier >= 3 ? 60 : guild.premiumTier >= 2 ? 45 : guild.premiumTier >= 1 ? 30 : 5}`,
                        `**Roles:** ${guild.roles.cache.size}`,
                        ''
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🛡️ Security',
                    value: [
                        `**Verification:** ${verificationLevels[guild.verificationLevel]}`,
                        `**Content Filter:** ${contentFilter[guild.explicitContentFilter]}`,
                        `**2FA Required:** ${guild.mfaLevel === 1 ? 'Yes' : 'No'}`,
                        `**NSFW Level:** ${guild.nsfwLevel === 0 ? 'Default' : guild.nsfwLevel === 1 ? 'Explicit' : guild.nsfwLevel === 2 ? 'Safe' : 'Age Restricted'}`
                    ].join('\n'),
                    inline: true
                }
            ],
            footer: {
                text: `Requested by ${message.author.tag}`,
                iconURL: message.author.displayAvatarURL({ dynamic: true })
            },
            timestamp: new Date()
        };

        // Add server features if any
        const features = guild.features.map(f => 
            f.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())
        );
        
        if (features.length > 0) {
            embed.fields.push({
                name: '🎖️ Server Features',
                value: features.slice(0, 10).join(', ') + (features.length > 10 ? ` +${features.length - 10} more` : ''),
                inline: false
            });
        }

        message.reply({ embeds: [embed] });
    }

    // ==================== BOT INFO COMMAND ====================

    async handleBotInfo(message) {
        const client = this.client;
        
        // Calculate uptime
        const uptime = process.uptime();
        const days = Math.floor(uptime / 86400);
        const hours = Math.floor((uptime % 86400) / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        
        const uptimeString = [
            days > 0 ? `${days}d` : '',
            hours > 0 ? `${hours}h` : '',
            minutes > 0 ? `${minutes}m` : '',
            `${seconds}s`
        ].filter(Boolean).join(' ');

        // Memory usage
        const memoryUsage = process.memoryUsage();
        const usedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        const totalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);

        // Get module stats
        const modules = client.modules?.modules;
        const moduleCount = modules ? modules.size : 0;
        
        // Database stats
        const dbStats = this.getDatabaseStats();

        // Bot stats from storage
        const totalCommands = this.storage.settings.get('stats.totalCommands', 0);
        const messagesSeen = this.storage.settings.get('stats.messagesSeen', 0);

        const embed = {
            title: `🤖 ${this.config.name} - All-in-One Discord Bot`,
            description: [
                '**Ego** is a powerful, modular Discord bot designed for comprehensive server management.',
                '',
                `Built with ❤️ by **Vermeil** (<@${this.credits.vermeil}>) and **Luna** (<@${this.credits.luna}>)`
            ].join('\n'),
            color: 0x5865F2,
            thumbnail: {
                url: client.user.displayAvatarURL({ dynamic: true, size: 512 })
            },
            fields: [
                {
                    name: '📊 Statistics',
                    value: [
                        `**Servers:** ${client.guilds.cache.size}`,
                        `**Users:** ${client.users.cache.size.toLocaleString()}`,
                        `**Channels:** ${client.channels.cache.size.toLocaleString()}`,
                        `**Commands Used:** ${totalCommands.toLocaleString()}`,
                        `**Messages Processed:** ${messagesSeen.toLocaleString()}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '⚙️ Technical',
                    value: [
                        `**Version:** ${this.config.version}`,
                        `**Node.js:** ${process.version}`,
                        `**Discord.js:** v${require('discord.js').version}`,
                        `**Uptime:** ${uptimeString}`,
                        `**Memory:** ${usedMB}MB / ${totalMB}MB`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🧩 Modules',
                    value: [
                        `**Loaded:** ${moduleCount} modules`,
                        `**Database:** ${dbStats.entries} entries`,
                        `**Storage:** ${dbStats.size}`,
                        '',
                        `Use \`${this.config.prefix}help\` to see all commands`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🔗 Links',
                    value: [
                        `[📁 GitHub](${this.githubUrl})`,
                        `[➕ Invite Bot](https://discord.com/oauth2/authorize?client_id=${this.config.clientId}&permissions=8&scope=bot%20applications.commands)`,
                        `[💬 Support Server](https://discord.gg/RPsh6XpqeD)` // Optional
                    ].join(' • '),
                    inline: false
                }
            ],
            footer: {
                text: `Bot ID: ${client.user.id} • Made with love by Vermeil & Luna`,
                iconURL: client.user.displayAvatarURL()
            },
            timestamp: new Date()
        };

        message.reply({ embeds: [embed] });
    }

    // ==================== GITHUB COMMAND ====================

    handleGitHub(message) {
        const embed = {
            title: '📁 Ego Bot Source Code',
            description: [
                '**Ego** is an open-source All-in-One Discord bot built by:',
                `• **Vermeil** (<@${this.credits.vermeil}>)`,
                `• **Luna** (<@${this.credits.luna}>)`,
                '',
                '⭐ Star the repository if you find it useful!',
                '🐛 Report issues or contribute on GitHub'
            ].join('\n'),
            color: 0x24292e, // GitHub dark color
            fields: [
                {
                    name: '🔗 Repository',
                    value: `[**Click here to view source code**](${this.githubUrl})`,
                    inline: false
                },
                {
                    name: '📜 License',
                    value: 'MIT License - Free to use and modify',
                    inline: true
                },
                {
                    name: '🤝 Contributing',
                    value: 'Pull requests are welcome!',
                    inline: true
                }
            ],
            thumbnail: {
                url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
            },
            footer: {
                text: 'Open source • Community driven • Made with ❤️'
            },
            timestamp: new Date()
        };

        message.reply({ embeds: [embed] });
    }

    // ==================== UTILITY COMMANDS ====================

    async handlePing(message) {
        const sent = await message.reply('🏓 Pinging...');
        const latency = sent.createdTimestamp - message.createdTimestamp;
        const apiLatency = Math.round(this.client.ws.ping);

        const embed = {
            title: '🏓 Pong!',
            color: this.getPingColor(latency),
            fields: [
                {
                    name: 'Bot Latency',
                    value: `${latency}ms`,
                    inline: true
                },
                {
                    name: 'API Latency',
                    value: `${apiLatency}ms`,
                    inline: true
                },
                {
                    name: 'Status',
                    value: this.getPingStatus(latency),
                    inline: true
                }
            ],
            footer: {
                text: 'Latency may vary based on server load'
            }
        };

        sent.edit({ content: null, embeds: [embed] });
    }

    handleUptime(message) {
        const uptime = process.uptime();
        const days = Math.floor(uptime / 86400);
        const hours = Math.floor((uptime % 86400) / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const embed = {
            title: '⏰ Bot Uptime',
            description: [
                `**${days}** days`,
                `**${hours}** hours`,
                `**${minutes}** minutes`,
                `**${seconds}** seconds`
            ].join('\n'),
            color: 0x2ecc71,
            footer: {
                text: `Started <t:${Math.floor((Date.now() - uptime * 1000) / 1000)}:R>`
            },
            timestamp: new Date()
        };

        message.reply({ embeds: [embed] });
    }

    handleInvite(message) {
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${this.config.clientId}&permissions=8&scope=bot%20applications.commands`;
        
        const embed = {
            title: '➕ Invite Ego to Your Server',
            description: 'Click the link below to add Ego to your server!',
            color: 0x5865F2,
            fields: [
                {
                    name: '🔗 Invite Link',
                    value: `[**Click here to invite**](${inviteUrl})`,
                    inline: false
                },
                {
                    name: '📋 Required Permissions',
                    value: 'Administrator (recommended for full functionality)',
                    inline: false
                }
            ],
            footer: {
                text: 'Thanks for choosing Ego!'
            }
        };

        message.reply({ embeds: [embed] });
    }

    // ==================== UTILITY METHODS ====================

    getPingColor(latency) {
        if (latency < 100) return 0x2ecc71; // Green
        if (latency < 200) return 0xf1c40f; // Yellow
        return 0xe74c3c; // Red
    }

    getPingStatus(latency) {
        if (latency < 100) return '🟢 Excellent';
        if (latency < 200) return '🟡 Good';
        if (latency < 500) return '🟠 Fair';
        return '🔴 Poor';
    }

    getDatabaseStats() {
        try {
            const fs = require('fs');
            let totalSize = 0;
            let entries = 0;

            const dbPath = './database/';
            if (fs.existsSync(dbPath)) {
                const files = fs.readdirSync(dbPath).filter(f => f.endsWith('.json'));
                entries = files.length;
                
                for (const file of files) {
                    const stats = fs.statSync(dbPath + file);
                    totalSize += stats.size;
                }
            }

            const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
            return { entries, size: `${sizeMB} MB` };
        } catch (e) {
            return { entries: 0, size: 'Unknown' };
        }
    }

    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    destroy() {
        console.log(`[${this.name}] Module unloaded`);
    }
}

module.exports = CoreModule;
