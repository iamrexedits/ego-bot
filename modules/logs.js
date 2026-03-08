/**
 * Logs Module
 * Comprehensive server event logging system
 * Logs: Messages, Members, Roles, Channels, Voice, Moderation, Invites
 */

class LogsModule {
    constructor(client) {
        this.client = client;
        this.name = 'logs';
        this.storage = null;
        this.config = null;
        this.logChannels = {};
    }

    init() {
        this.storage = this.client.storage;
        this.config = this.client.config;
        
        // Initialize settings
        const settings = this.storage.settings.get('logs', {});
        if (!settings.enabled) settings.enabled = true;
        if (!settings.channels) settings.channels = {};
        if (!settings.events) settings.events = this.getDefaultEvents();
        
        this.storage.settings.set('logs', settings);
        
        // Cache log channels
        this.updateLogChannels();
        
        console.log(`[${this.name}] Logging system ready`);
    }

    getDefaultEvents() {
        return {
            // Message Events
            messageDelete: true,
            messageEdit: true,
            messageBulkDelete: true,
            
            // Member Events
            memberJoin: true,
            memberLeave: true,
            memberUpdate: true, // nickname, roles changes
            memberBan: true,
            memberUnban: true,
            memberTimeout: true,
            
            // Voice Events
            voiceJoin: false,  // Can be spammy
            voiceLeave: false,
            voiceMove: false,
            voiceStream: false,
            voiceVideo: false,
            
            // Channel Events
            channelCreate: true,
            channelDelete: true,
            channelUpdate: true,
            
            // Role Events
            roleCreate: true,
            roleDelete: true,
            roleUpdate: true,
            
            // Guild Events
            guildUpdate: true,
            emojiChanges: true,
            stickerChanges: true,
            
            // Invite Events
            inviteCreate: true,
            inviteDelete: true,
            
            // Moderation Events (if using bot commands)
            moderationAction: true
        };
    }

    // ==================== CHANNEL MANAGEMENT ====================

    updateLogChannels() {
        const settings = this.storage.settings.get('logs', {});
        const guild = this.client.guilds.cache.get(this.config.guildId);
        if (!guild) return;

        // Support multiple log channels by category
        this.logChannels = {
            default: settings.channels.default ? guild.channels.cache.get(settings.channels.default) : null,
            moderation: settings.channels.moderation ? guild.channels.cache.get(settings.channels.moderation) : null,
            messages: settings.channels.messages ? guild.channels.cache.get(settings.channels.messages) : null,
            members: settings.channels.members ? guild.channels.cache.get(settings.channels.members) : null,
            voice: settings.channels.voice ? guild.channels.cache.get(settings.channels.voice) : null,
            server: settings.channels.server ? guild.channels.cache.get(settings.channels.server) : null
        };

        // Fallback to default if specific not set
        Object.keys(this.logChannels).forEach(key => {
            if (!this.logChannels[key] && this.logChannels.default) {
                this.logChannels[key] = this.logChannels.default;
            }
        });
    }

    getLogChannel(type = 'default') {
        return this.logChannels[type] || this.logChannels.default;
    }

    // ==================== CORE LOGGING METHOD ====================

    async log(options) {
        const settings = this.storage.settings.get('logs', {});
        if (!settings.enabled) return;

        const {
            type = 'default',
            event,
            embed,
            content,
            files
        } = options;

        // Check if event type is enabled
        if (settings.events[event] === false) return;

        const channel = this.getLogChannel(type);
        if (!channel) return;

        // Add timestamp and footer to embed
        if (embed) {
            embed.timestamp = new Date();
            if (!embed.footer) {
                embed.footer = { text: `Event ID: ${this.generateId()}` };
            }
        }

        try {
            await channel.send({
                content: content || undefined,
                embeds: embed ? [embed] : undefined,
                files: files || undefined
            });
        } catch (error) {
            console.error(`[Logs] Failed to send log:`, error.message);
        }
    }

    generateId() {
        return Math.random().toString(36).substring(2, 10).toUpperCase();
    }

    // ==================== MESSAGE EVENTS ====================

    async onMessageDelete(message) {
        if (message.author?.bot) return; // Optional: ignore bots
        
        const embed = {
            title: '🗑️ Message Deleted',
            color: 0xe74c3c,
            fields: [
                {
                    name: 'Author',
                    value: `${message.author?.tag || 'Unknown'} (${message.author?.id || 'N/A'})`,
                    inline: true
                },
                {
                    name: 'Channel',
                    value: `<#${message.channel.id}> (${message.channel.name})`,
                    inline: true
                }
            ]
        };

        if (message.content) {
            embed.fields.push({
                name: 'Content',
                value: message.content.substring(0, 1024) || '*No text content*',
                inline: false
            });
        }

        if (message.attachments.size > 0) {
            embed.fields.push({
                name: 'Attachments',
                value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n'),
                inline: false
            });
        }

        await this.log({
            type: 'messages',
            event: 'messageDelete',
            embed
        });
    }

    async onMessageEdit(oldMessage, newMessage) {
        if (oldMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return; // Ignore embed updates

        const embed = {
            title: '✏️ Message Edited',
            color: 0xf39c12,
            fields: [
                {
                    name: 'Author',
                    value: `${newMessage.author.tag} (${newMessage.author.id})`,
                    inline: true
                },
                {
                    name: 'Channel',
                    value: `<#${newMessage.channel.id}> [Jump to Message](${newMessage.url})`,
                    inline: true
                },
                {
                    name: 'Before',
                    value: oldMessage.content?.substring(0, 1024) || '*Empty*',
                    inline: false
                },
                {
                    name: 'After',
                    value: newMessage.content?.substring(0, 1024) || '*Empty*',
                    inline: false
                }
            ]
        };

        await this.log({
            type: 'messages',
            event: 'messageEdit',
            embed
        });
    }

    // ==================== MEMBER EVENTS ====================

    async onMemberJoin(member) {
        const accountAge = Date.now() - member.user.createdTimestamp;
        const isNewAccount = accountAge < 7 * 24 * 60 * 60 * 1000; // 7 days
        
        const embed = {
            title: '👋 Member Joined',
            color: 0x2ecc71,
            thumbnail: { url: member.user.displayAvatarURL({ dynamic: true }) },
            fields: [
                {
                    name: 'User',
                    value: `${member.user.tag} (${member.user.id})`,
                    inline: false
                },
                {
                    name: 'Account Created',
                    value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n${isNewAccount ? '⚠️ **New Account**' : '✅ Established'}`,
                    inline: true
                },
                {
                    name: 'Member Count',
                    value: `${member.guild.memberCount}`,
                    inline: true
                }
            ]
        };

        await this.log({
            type: 'members',
            event: 'memberJoin',
            embed
        });
    }

    async onMemberLeave(member) {
        // Calculate join duration if we have data
        const guildData = this.storage.guild.get('members', {});
        const joinData = guildData[member.id]?.joinedAt;
        let duration = 'Unknown';
        
        if (joinData) {
            const joined = new Date(joinData);
            const diff = Date.now() - joined;
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            duration = days === 0 ? 'Less than a day' : `${days} day(s)`;
        }

        const embed = {
            title: '🚪 Member Left',
            color: 0xe74c3c,
            thumbnail: { url: member.user.displayAvatarURL({ dynamic: true }) },
            fields: [
                {
                    name: 'User',
                    value: `${member.user.tag} (${member.user.id})`,
                    inline: false
                },
                {
                    name: 'Joined Server',
                    value: member.joinedAt ? `<t:${Math.floor(member.joinedAt / 1000)}:R>` : 'Unknown',
                    inline: true
                },
                {
                    name: 'Time in Server',
                    value: duration,
                    inline: true
                },
                {
                    name: 'Roles',
                    value: member.roles.cache.size > 1 
                        ? member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ').substring(0, 1024)
                        : 'None',
                    inline: false
                }
            ]
        };

        await this.log({
            type: 'members',
            event: 'memberLeave',
            embed
        });
    }

    // ==================== VOICE EVENTS ====================

    async onVoiceUpdate(oldState, newState) {
        const settings = this.storage.settings.get('logs', {});
        
        // Voice Join
        if (!oldState.channelId && newState.channelId) {
            if (!settings.events.voiceJoin) return;
            
            await this.log({
                type: 'voice',
                event: 'voiceJoin',
                embed: {
                    title: '🔊 Voice Channel Join',
                    color: 0x3498db,
                    fields: [
                        {
                            name: 'Member',
                            value: `${newState.member.user.tag} (${newState.member.id})`,
                            inline: true
                        },
                        {
                            name: 'Channel',
                            value: `<#${newState.channel.id}> (${newState.channel.name})`,
                            inline: true
                        }
                    ]
                }
            });
        }
        
        // Voice Leave
        else if (oldState.channelId && !newState.channelId) {
            if (!settings.events.voiceLeave) return;
            
            await this.log({
                type: 'voice',
                event: 'voiceLeave',
                embed: {
                    title: '🔇 Voice Channel Leave',
                    color: 0x95a5a6,
                    fields: [
                        {
                            name: 'Member',
                            value: `${oldState.member.user.tag} (${oldState.member.id})`,
                            inline: true
                        },
                        {
                            name: 'Channel',
                            value: `<#${oldState.channel.id}> (${oldState.channel.name})`,
                            inline: true
                        }
                    ]
                }
            });
        }
        
        // Voice Move
        else if (oldState.channelId !== newState.channelId) {
            if (!settings.events.voiceMove) return;
            
            await this.log({
                type: 'voice',
                event: 'voiceMove',
                embed: {
                    title: '↔️ Voice Channel Move',
                    color: 0x9b59b6,
                    fields: [
                        {
                            name: 'Member',
                            value: `${newState.member.user.tag} (${newState.member.id})`,
                            inline: false
                        },
                        {
                            name: 'From',
                            value: `<#${oldState.channel.id}> (${oldState.channel.name})`,
                            inline: true
                        },
                        {
                            name: 'To',
                            value: `<#${newState.channel.id}> (${newState.channel.name})`,
                            inline: true
                        }
                    ]
                }
            });
        }

        // Stream start/stop
        if (!oldState.streaming && newState.streaming) {
            if (!settings.events.voiceStream) return;
            await this.log({
                type: 'voice',
                event: 'voiceStream',
                embed: {
                    title: '📺 Started Streaming',
                    color: 0x1abc9c,
                    description: `${newState.member.user.tag} started streaming in <#${newState.channel.id}>`
                }
            });
        }

        // Video start/stop
        if (!oldState.selfVideo && newState.selfVideo) {
            if (!settings.events.voiceVideo) return;
            await this.log({
                type: 'voice',
                event: 'voiceVideo',
                embed: {
                    title: '📹 Camera Enabled',
                    color: 0xe67e22,
                    description: `${newState.member.user.tag} enabled camera in <#${newState.channel.id}>`
                }
            });
        }
    }

    // ==================== MODERATION EVENTS ====================

    async logModeration(action, moderator, target, reason, duration = null) {
        const colors = {
            ban: 0xe74c3c,
            unban: 0x2ecc71,
            kick: 0xf39c12,
            timeout: 0x9b59b6,
            warn: 0xf1c40f,
            mute: 0x34495e,
            purge: 0x3498db
        };

        const icons = {
            ban: '🔨',
            unban: '🔓',
            kick: '👢',
            timeout: '⏰',
            warn: '⚠️',
            mute: '🔇',
            purge: '🧹'
        };

        const embed = {
            title: `${icons[action] || '🛡️'} ${action.charAt(0).toUpperCase() + action.slice(1)}`,
            color: colors[action] || 0x95a5a6,
            fields: [
                {
                    name: 'Moderator',
                    value: `${moderator.tag} (${moderator.id})`,
                    inline: true
                },
                {
                    name: 'Target',
                    value: `${target.tag || target} (${target.id || 'N/A'})`,
                    inline: true
                },
                {
                    name: 'Reason',
                    value: reason || 'No reason provided',
                    inline: false
                }
            ]
        };

        if (duration) {
            embed.fields.splice(2, 0, {
                name: 'Duration',
                value: duration,
                inline: true
            });
        }

        await this.log({
            type: 'moderation',
            event: 'moderationAction',
            embed
        });
    }

    // ==================== COMMANDS ====================

    onCommand(command, args, message) {
        if (!this.isAdmin(message)) return;

        switch(command) {
            case 'logs':
            case 'log':
                this.handleLogsCommand(message, args);
                break;
            case 'logchannel':
                this.handleSetChannel(message, args);
                break;
            case 'logtoggle':
                this.handleToggleEvent(message, args);
                break;
        }
    }

    async handleLogsCommand(message, args) {
        const subCommand = args[0]?.toLowerCase();
        const settings = this.storage.settings.get('logs', {});

        if (!subCommand || subCommand === 'status') {
            // Show status
            const channels = settings.channels || {};
            const events = settings.events || {};
            
            const embed = {
                title: '📋 Logging Configuration',
                color: settings.enabled ? 0x2ecc71 : 0xe74c3c,
                fields: [
                    {
                        name: 'Status',
                        value: settings.enabled ? '🟢 Enabled' : '🔴 Disabled',
                        inline: true
                    },
                    {
                        name: 'Default Channel',
                        value: channels.default ? `<#${channels.default}>` : 'Not set',
                        inline: true
                    },
                    {
                        name: 'Specialized Channels',
                        value: [
                            `Moderation: ${channels.moderation ? `<#${channels.moderation}>` : 'Default'}`,
                            `Messages: ${channels.messages ? `<#${channels.messages}>` : 'Default'}`,
                            `Members: ${channels.members ? `<#${channels.members}>` : 'Default'}`,
                            `Voice: ${channels.voice ? `<#${channels.voice}>` : 'Default'}`,
                            `Server: ${channels.server ? `<#${channels.server}>` : 'Default'}`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Active Events',
                        value: Object.entries(events)
                            .filter(([_, enabled]) => enabled)
                            .map(([name, _]) => `✅ ${name}`)
                            .join('\n') || 'None',
                        inline: true
                    },
                    {
                        name: 'Disabled Events',
                        value: Object.entries(events)
                            .filter(([_, enabled]) => !enabled)
                            .map(([name, _]) => `❌ ${name}`)
                            .join('\n') || 'None',
                        inline: true
                    }
                ]
            };

            return message.reply({ embeds: [embed] });
        }

        if (subCommand === 'toggle') {
            settings.enabled = !settings.enabled;
            this.storage.settings.set('logs', settings);
            return message.reply(`Logging is now ${settings.enabled ? '✅ **ENABLED**' : '❌ **DISABLED**'}`);
        }

        if (subCommand === 'events') {
            const eventList = Object.entries(settings.events || {})
                .map(([name, enabled]) => `${enabled ? '✅' : '❌'} \`${name}\``)
                .join('\n');
            
            return message.reply({
                embeds: [{
                    title: '📊 Loggable Events',
                    description: eventList,
                    footer: { text: `Use ${this.config.prefix}logtoggle <event> to toggle` }
                }]
            });
        }

        if (subCommand === 'test') {
            const testType = args[1] || 'default';
            await this.log({
                type: testType,
                event: 'guildUpdate', // Generic event
                embed: {
                    title: '🧪 Test Log',
                    description: `This is a test log for **${testType}** channel`,
                    color: 0x9b59b6
                }
            });
            return message.reply(`✅ Test log sent to ${testType} channel`);
        }

        // Show help
        message.reply({
            embeds: [{
                title: '📖 Logging Commands',
                fields: [
                    {
                        name: 'Configuration',
                        value: [
                            `\`${this.config.prefix}logs status\` - Show current config`,
                            `\`${this.config.prefix}logs toggle\` - Enable/disable logging`,
                            `\`${this.config.prefix}logs events\` - List all events`,
                            `\`${this.config.prefix}logs test [type]\` - Send test log`
                        ].join('\n')
                    },
                    {
                        name: 'Channel Setup',
                        value: [
                            `\`${this.config.prefix}logchannel default #channel\` - Set default channel`,
                            `\`${this.config.prefix}logchannel moderation #channel\` - Mod logs`,
                            `\`${this.config.prefix}logchannel messages #channel\` - Message logs`,
                            `\`${this.config.prefix}logchannel members #channel\` - Member logs`,
                            `\`${this.config.prefix}logchannel voice #channel\` - Voice logs`,
                            `\`${this.config.prefix}logchannel server #channel\` - Server logs`
                        ].join('\n')
                    },
                    {
                        name: 'Event Toggles',
                        value: `\`${this.config.prefix}logtoggle <eventname>\` - Toggle specific event\nExample: \`${this.config.prefix}logtoggle voiceJoin\``
                    }
                ]
            }]
        });
    }

    async handleSetChannel(message, args) {
        const type = args[0]?.toLowerCase();
        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[1]);

        if (!type || !['default', 'moderation', 'messages', 'members', 'voice', 'server'].includes(type)) {
            return message.reply('Usage: `!logchannel <type> #channel`\nTypes: default, moderation, messages, members, voice, server');
        }

        if (!channel) {
            return message.reply('Please mention a valid channel or provide a channel ID.');
        }

        const settings = this.storage.settings.get('logs', {});
        if (!settings.channels) settings.channels = {};
        
        settings.channels[type] = channel.id;
        this.storage.settings.set('logs', settings);
        
        // Update cache
        this.updateLogChannels();

        message.reply(`✅ Set **${type}** log channel to ${channel}`);
    }

    async handleToggleEvent(message, args) {
        const eventName = args[0]?.toLowerCase();
        const settings = this.storage.settings.get('logs', {});
        
        if (!eventName) {
            return message.reply('Please specify an event name. Use `!logs events` to see available events.');
        }

        if (!(eventName in settings.events)) {
            return message.reply(`❌ Unknown event: \`${eventName}\`. Use \`!logs events\` to see available events.`);
        }

        settings.events[eventName] = !settings.events[eventName];
        this.storage.settings.set('logs', settings);

        const status = settings.events[eventName] ? '✅ **ENABLED**' : '❌ **DISABLED**';
        message.reply(`Event \`${eventName}\` is now ${status}`);
    }

    // ==================== UTILITY ====================

    isAdmin(message) {
        return message.member.permissions.has('Administrator') || 
               message.author.id === this.config.ownerId;
    }

    destroy() {
        console.log(`[${this.name}] Module unloaded`);
    }
}

module.exports = LogsModule;
