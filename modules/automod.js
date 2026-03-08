/**
 * Advanced AutoMod Module
 * Features: Anti-spam, anti-link, anti-invite, banned words, caps filter, 
 *           mention spam, emoji spam, zalgo text, repeated text
 * Storage: Uses this.storage.automod (database/automod.json via config)
 */

class AutoModModule {
    constructor(client) {
        this.client = client;
        this.name = 'automod';
        this.storage = null;
        this.config = null;
        
        // In-memory cache for spam detection (not persisted)
        this.messageCache = new Map();
        
        // Violation thresholds
        this.thresholds = {
            warn: 3,
            mute: 5,
            kick: 7,
            ban: 10
        };
    }

    init() {
        this.storage = this.client.storage;
        this.config = this.client.config;
        
        // Initialize automod database with defaults
        const automod = this.storage.automod.getAll();
        
        if (!automod.config) {
            this.storage.automod.set('config', this.getDefaultConfig());
        }
        if (!automod.violations) {
            this.storage.automod.set('violations', []);
        }
        if (!automod.tempMutes) {
            this.storage.automod.set('tempMutes', {});
        }
        if (!automod.userHistory) {
            this.storage.automod.set('userHistory', {});
        }
        
        this.startCleanupInterval();
        console.log(`[${this.name}] Advanced AutoMod system ready`);
    }

    getDefaultConfig() {
        return {
            enabled: true,
            exemptRoles: [],
            exemptChannels: [],
            
            antiSpam: {
                enabled: true,
                maxMessages: 5,
                timeWindow: 5000,
                maxDuplicates: 3,
                deleteMessages: true
            },
            
            antiLink: {
                enabled: true,
                blockAll: false,
                allowedDomains: ['discord.com', 'discord.gg', 'youtube.com', 'youtu.be', 'github.com'],
                blockedDomains: [],
                allowPerms: ['ManageMessages']
            },
            
            antiInvite: {
                enabled: true,
                blockDiscordInvites: true,
                allowVanity: false,
                whitelistServers: []
            },
            
            bannedWords: {
                enabled: true,
                words: [],
                wildcards: true,
                caseSensitive: false,
                actions: { delete: true, warn: true, mute: false }
            },
            
            capsFilter: {
                enabled: true,
                minLength: 10,
                capsRatio: 0.7,
                maxCaps: 15
            },
            
            mentionSpam: {
                enabled: true,
                maxMentions: 5,
                maxRoleMentions: 3,
                maxEveryone: 0
            },
            
            emojiSpam: {
                enabled: true,
                maxEmojis: 8,
                maxCustomEmojis: 5
            },
            
            zalgoFilter: {
                enabled: true,
                threshold: 0.3
            },
            
            repeatedText: {
                enabled: true,
                minLength: 20,
                repetitionThreshold: 0.6
            },
            
            punishments: {
                warnDuration: 86400000,
                muteDuration: 600000,
                escalate: true,
                notifyUser: true,
                logChannel: null
            }
        };
    }

    // ==================== CORE CHECKS ====================

    async onMessage(message) {
        if (!this.shouldCheck(message)) return;

        const checks = [
            this.checkSpam(message),
            this.checkLinks(message),
            this.checkInvites(message),
            this.checkBannedWords(message),
            this.checkCaps(message),
            this.checkMentions(message),
            this.checkEmojis(message),
            this.checkZalgo(message),
            this.checkRepeatedText(message)
        ];

        const results = await Promise.all(checks);
        const violations = results.filter(r => r !== null);

        if (violations.length > 0) {
            await this.handleViolations(message, violations);
        }

        this.updateMessageCache(message);
    }

    shouldCheck(message) {
        const config = this.storage.automod.get('config', {});
        
        if (!config.enabled) return false;
        if (message.author.bot) return false;
        if (!message.guild) return false;
        if (message.guild.id !== this.config.guildId) return false;

        if (config.exemptRoles?.some(roleId => message.member.roles.cache.has(roleId))) {
            return false;
        }

        if (config.exemptChannels?.includes(message.channel.id)) {
            return false;
        }

        if (message.member.permissions.has('Administrator')) return false;

        return true;
    }

    // ==================== DETECTION METHODS ====================

    checkSpam(message) {
        const config = this.storage.automod.get('config.antiSpam', {});
        if (!config.enabled) return null;

        const userId = message.author.id;
        const now = Date.now();
        
        if (!this.messageCache.has(userId)) {
            this.messageCache.set(userId, []);
        }

        const userMessages = this.messageCache.get(userId);
        const validMessages = userMessages.filter(m => now - m.timestamp < config.timeWindow);
        
        if (validMessages.length >= config.maxMessages) {
            return {
                type: 'spam',
                severity: 'medium',
                reason: `Sent ${validMessages.length + 1} messages in ${config.timeWindow / 1000}s`,
                action: config.deleteMessages ? 'delete' : 'warn'
            };
        }

        const duplicates = validMessages.filter(m => m.content === message.content);
        if (duplicates.length >= config.maxDuplicates) {
            return {
                type: 'duplicate',
                severity: 'medium',
                reason: `Repeated the same message ${duplicates.length + 1} times`,
                action: 'delete'
            };
        }

        return null;
    }

    checkLinks(message) {
        const config = this.storage.automod.get('config.antiLink', {});
        if (!config.enabled) return null;

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const matches = message.content.match(urlRegex);
        
        if (!matches) return null;

        for (const url of matches) {
            try {
                const domain = new URL(url).hostname.replace('www.', '');
                
                if (config.blockedDomains?.some(d => domain.includes(d))) {
                    return {
                        type: 'blocked_link',
                        severity: 'high',
                        reason: `Blocked domain: ${domain}`,
                        action: 'delete'
                    };
                }

                if (config.blockAll && !config.allowedDomains?.some(d => domain.includes(d))) {
                    return {
                        type: 'unauthorized_link',
                        severity: 'medium',
                        reason: `Link not in whitelist: ${domain}`,
                        action: 'delete'
                    };
                }
            } catch (e) {}
        }

        return null;
    }

    checkInvites(message) {
        const config = this.storage.automod.get('config.antiInvite', {});
        if (!config.enabled) return null;

        const inviteRegex = /(discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/)([a-zA-Z0-9-]+)/gi;
        const matches = [...message.content.matchAll(inviteRegex)];

        if (matches.length === 0) return null;

        for (const match of matches) {
            const code = match[2];
            
            if (code.includes('discord.gg') && config.allowVanity) continue;

            return {
                type: 'discord_invite',
                severity: 'high',
                reason: `Posted Discord invite: ${match[0]}`,
                action: 'delete'
            };
        }

        return null;
    }

    checkBannedWords(message) {
        const config = this.storage.automod.get('config.bannedWords', {});
        if (!config.enabled || !config.words?.length) return null;

        const content = config.caseSensitive ? message.content : message.content.toLowerCase();
        
        // Escape special regex characters
        const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        for (let word of config.words) {
            let checkWord = config.caseSensitive ? word : word.toLowerCase();
            
            let pattern;
            try {
                if (config.wildcards) {
                    const regexWord = checkWord.split('*').map(escapeRegex).join('.*');
                    pattern = new RegExp(`\\b${regexWord}\\b`, config.caseSensitive ? 'g' : 'gi');
                } else {
                    const escapedWord = escapeRegex(checkWord);
                    pattern = new RegExp(`\\b${escapedWord}\\b`, config.caseSensitive ? 'g' : 'gi');
                }

                if (pattern.test(content)) {
                    return {
                        type: 'banned_word',
                        severity: 'high',
                        reason: `Used banned word: ${word}`,
                        action: config.actions?.delete ? 'delete' : 'warn'
                    };
                }
            } catch (e) {
                console.error(`[AutoMod] Regex error for word "${word}":`, e.message);
                continue;
            }
        }

        return null;
    }

    checkCaps(message) {
        const config = this.storage.automod.get('config.capsFilter', {});
        if (!config.enabled) return null;
        if (message.content.length < config.minLength) return null;

        const letters = message.content.replace(/[^a-zA-Z]/g, '');
        if (letters.length === 0) return null;

        const caps = letters.replace(/[^A-Z]/g, '');
        const capsRatio = caps.length / letters.length;

        if (capsRatio > config.capsRatio) {
            return {
                type: 'excessive_caps',
                severity: 'low',
                reason: `${Math.round(capsRatio * 100)}% caps (limit: ${Math.round(config.capsRatio * 100)}%)`,
                action: 'warn'
            };
        }

        const consecutiveCaps = message.content.match(/[A-Z]{10,}/g);
        if (consecutiveCaps && consecutiveCaps.some(m => m.length > config.maxCaps)) {
            return {
                type: 'consecutive_caps',
                severity: 'low',
                reason: `${consecutiveCaps[0].length} consecutive caps`,
                action: 'warn'
            };
        }

        return null;
    }

    checkMentions(message) {
        const config = this.storage.automod.get('config.mentionSpam', {});
        if (!config.enabled) return null;

        const userMentions = message.mentions.users.size;
        const roleMentions = message.mentions.roles.size;
        const everyoneMentions = message.mentions.everyone || message.content.includes('@here') ? 1 : 0;

        if (config.maxEveryone > 0 && everyoneMentions > config.maxEveryone) {
            return {
                type: 'everyone_mention',
                severity: 'critical',
                reason: 'Mentioned @everyone/@here',
                action: 'ban'
            };
        }

        if (userMentions > config.maxMentions) {
            return {
                type: 'mention_spam',
                severity: 'medium',
                reason: `Mentioned ${userMentions} users (limit: ${config.maxMentions})`,
                action: 'delete'
            };
        }

        if (roleMentions > config.maxRoleMentions) {
            return {
                type: 'role_mention_spam',
                severity: 'medium',
                reason: `Mentioned ${roleMentions} roles (limit: ${config.maxRoleMentions})`,
                action: 'delete'
            };
        }

        return null;
    }

    checkEmojis(message) {
        const config = this.storage.automod.get('config.emojiSpam', {});
        if (!config.enabled) return null;

        const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
        const customEmojiRegex = /<a?:\w+:\d+>/g;

        const emojis = message.content.match(emojiRegex) || [];
        const customEmojis = message.content.match(customEmojiRegex) || [];

        if (emojis.length + customEmojis.length > config.maxEmojis) {
            return {
                type: 'emoji_spam',
                severity: 'low',
                reason: `${emojis.length + customEmojis.length} emojis (limit: ${config.maxEmojis})`,
                action: 'warn'
            };
        }

        if (customEmojis.length > config.maxCustomEmojis) {
            return {
                type: 'custom_emoji_spam',
                severity: 'low',
                reason: `${customEmojis.length} custom emojis (limit: ${config.maxCustomEmojis})`,
                action: 'warn'
            };
        }

        return null;
    }

    checkZalgo(message) {
        const config = this.storage.automod.get('config.zalgoFilter', {});
        if (!config.enabled) return null;

        const zalgoRegex = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08e4-\u08fe\u0900-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u0a01-\u0a03\u0a3c]/g;
        
        const zalgoChars = message.content.match(zalgoRegex) || [];
        const normalChars = message.content.replace(/[\s\p{P}]/gu, '').length;

        if (normalChars === 0) return null;

        const ratio = zalgoChars.length / normalChars;
        if (ratio > config.threshold) {
            return {
                type: 'zalgo_text',
                severity: 'low',
                reason: `Zalgo text detected (${Math.round(ratio * 100)}% combining chars)`,
                action: 'delete'
            };
        }

        return null;
    }

    checkRepeatedText(message) {
        const config = this.storage.automod.get('config.repeatedText', {});
        if (!config.enabled) return null;
        if (message.content.length < config.minLength) return null;

        const words = message.content.toLowerCase().split(/\s+/);
        const uniqueWords = [...new Set(words)];
        
        if (words.length === 0) return null;

        const repetitionRatio = 1 - (uniqueWords.length / words.length);
        
        if (repetitionRatio > config.repetitionThreshold) {
            return {
                type: 'repeated_text',
                severity: 'low',
                reason: `${Math.round(repetitionRatio * 100)}% repetition`,
                action: 'warn'
            };
        }

        const charRepetition = message.content.match(/(.)\1{10,}/g);
        if (charRepetition) {
            return {
                type: 'character_spam',
                severity: 'low',
                reason: `Repeated characters: "${charRepetition[0].substring(0, 10)}..."`,
                action: 'warn'
            };
        }

        return null;
    }

    // ==================== VIOLATION HANDLING ====================

    async handleViolations(message, violations) {
        const config = this.storage.automod.get('config', {});
        const highestSeverity = this.getHighestSeverity(violations);
        
        const shouldDelete = violations.some(v => v.action === 'delete');
        if (shouldDelete) {
            try {
                await message.delete();
            } catch (e) {}
        }

        const violationRecord = {
            id: this.generateId(),
            userId: message.author.id,
            username: message.author.tag,
            channelId: message.channel.id,
            messageId: message.id,
            content: message.content.substring(0, 500),
            violations: violations.map(v => v.type),
            severity: highestSeverity,
            timestamp: new Date().toISOString(),
            deleted: shouldDelete
        };

        // Add to violations array
        const currentViolations = this.storage.automod.get('violations', []);
        currentViolations.push(violationRecord);
        this.storage.automod.set('violations', currentViolations);

        // Update user history
        const userHistory = this.storage.automod.get('userHistory', {});
        if (!userHistory[message.author.id]) {
            userHistory[message.author.id] = [];
        }
        userHistory[message.author.id].push(violationRecord.id);
        this.storage.automod.set('userHistory', userHistory);

        await this.applyPunishment(message, highestSeverity);

        if (config.punishments?.notifyUser) {
            await this.notifyUser(message.author, violations, shouldDelete);
        }

        await this.logViolation(message, violations, violationRecord);
    }

    async applyPunishment(message, severity) {
        const userId = message.author.id;
        const recentViolations = this.getRecentViolations(userId, 24 * 60 * 60 * 1000);
        const count = recentViolations.length;
        const member = message.member;

        let action = null;
        
        if (count >= this.thresholds.ban || severity === 'critical') {
            action = 'ban';
        } else if (count >= this.thresholds.kick) {
            action = 'kick';
        } else if (count >= this.thresholds.mute) {
            action = 'mute';
        } else if (count >= this.thresholds.warn) {
            action = 'warn';
        }

        if (!action) return;

        switch(action) {
            case 'mute':
                await this.tempMute(member);
                break;
            case 'kick':
                try {
                    await member.kick(`AutoMod: ${count} violations`);
                    this.logAction(member, 'kick', `Reached ${count} violations`);
                } catch (e) {}
                break;
            case 'ban':
                try {
                    await member.ban({ 
                        deleteMessageSeconds: 86400,
                        reason: `AutoMod: ${count} violations or critical offense`
                    });
                    this.logAction(member, 'ban', `Reached ${count} violations or critical offense`);
                } catch (e) {}
                break;
        }
    }

    async tempMute(member) {
        const config = this.storage.automod.get('config.punishments', {});
        const muteRole = this.getMuteRole(member.guild);
        
        if (!muteRole) {
            console.error(`[AutoMod] No mute role found`);
            return;
        }

        try {
            await member.roles.add(muteRole);
            
            const tempMutes = this.storage.automod.get('tempMutes', {});
            tempMutes[member.id] = {
                unmuteAt: Date.now() + (config.muteDuration || 600000),
                roleId: muteRole.id
            };
            this.storage.automod.set('tempMutes', tempMutes);

            setTimeout(async () => {
                await this.unmute(member);
            }, config.muteDuration || 600000);

            this.logAction(member, 'mute', `Duration: ${(config.muteDuration || 600000) / 60000} minutes`);
        } catch (e) {}
    }

    async unmute(member) {
        const tempMutes = this.storage.automod.get('tempMutes', {});
        if (!tempMutes[member.id]) return;
        
        const muteData = tempMutes[member.id];
        const muteRole = member.guild.roles.cache.get(muteData.roleId);
        
        if (muteRole && member.roles.cache.has(muteRole.id)) {
            try {
                await member.roles.remove(muteRole);
                delete tempMutes[member.id];
                this.storage.automod.set('tempMutes', tempMutes);
            } catch (e) {}
        }
    }

    // ==================== LOGGING & NOTIFICATIONS ====================

    async logViolation(message, violations, record) {
        const config = this.storage.automod.get('config', {});
        const logsModule = this.client.modules?.get('logs');
        
        if (logsModule) {
            const severityColors = {
                low: 0xf1c40f,
                medium: 0xe67e22,
                high: 0xe74c3c,
                critical: 0x8e44ad
            };

            const embed = {
                title: '🛡️ AutoMod Violation',
                color: severityColors[record.severity] || 0x95a5a6,
                thumbnail: { url: message.author.displayAvatarURL({ dynamic: true }) },
                fields: [
                    {
                        name: 'User',
                        value: `${message.author.tag} (${message.author.id})`,
                        inline: true
                    },
                    {
                        name: 'Channel',
                        value: `<#${message.channel.id}>`,
                        inline: true
                    },
                    {
                        name: 'Severity',
                        value: record.severity.toUpperCase(),
                        inline: true
                    },
                    {
                        name: 'Violations',
                        value: violations.map(v => `\`${v.type}\`: ${v.reason}`).join('\n'),
                        inline: false
                    },
                    {
                        name: 'Action Taken',
                        value: record.deleted ? '🗑️ Message Deleted' : '⚠️ Warning Only',
                        inline: true
                    },
                    {
                        name: 'Total Violations (24h)',
                        value: `${this.getRecentViolations(message.author.id, 86400000).length}`,
                        inline: true
                    }
                ],
                footer: { text: `Violation ID: ${record.id}` },
                timestamp: new Date()
            };

            if (message.content) {
                embed.fields.push({
                    name: 'Message Content',
                    value: message.content.substring(0, 1000) || '*No content*',
                    inline: false
                });
            }

            await logsModule.log({
                type: 'moderation',
                event: 'moderationAction',
                embed
            });
        }

        if (config.punishments?.logChannel) {
            const channel = message.guild.channels.cache.get(config.punishments.logChannel);
            if (channel) {
                await channel.send({
                    embeds: [{
                        title: '🛡️ AutoMod Alert',
                        description: `**${message.author.tag}** triggered ${violations.length} violation(s)`,
                        color: 0xe74c3c,
                        fields: violations.map(v => ({
                            name: v.type,
                            value: v.reason,
                            inline: true
                        }))
                    }]
                }).catch(() => {});
            }
        }
    }

    async notifyUser(user, violations, deleted) {
        try {
            const dm = await user.createDM();
            const violationList = violations.map(v => `• **${v.type}**: ${v.reason}`).join('\n');
            
            await dm.send({
                embeds: [{
                    title: '⚠️ AutoMod Warning',
                    description: `Your message in the server violated our rules:\n\n${violationList}`,
                    color: 0xf39c12,
                    fields: [
                        { 
                            name: 'Action Taken', 
                            value: deleted ? 'Your message was deleted' : 'Warning issued',
                            inline: false 
                        },
                        { 
                            name: 'Repeated violations may result in:', 
                            value: '• Temporary mute\n• Kick from server\n• Permanent ban',
                            inline: false 
                        }
                    ],
                    footer: { text: 'Please follow the server rules to avoid further action' }
                }]
            });
        } catch (e) {}
    }

    logAction(member, action, reason) {
        const logsModule = this.client.modules?.get('logs');
        if (logsModule?.logModeration) {
            logsModule.logModeration(
                action,
                { tag: 'AutoMod', id: this.client.user.id },
                member.user,
                reason
            );
        }
    }

    // ==================== COMMANDS ====================

    onCommand(command, args, message) {
        if (!this.isAdmin(message)) return;

        switch(command) {
            case 'automod':
            case 'am':
                this.handleAutoModCommand(message, args);
                break;
            case 'amtoggle':
                this.handleToggle(message, args);
                break;
            case 'amstatus':
                this.handleStatus(message);
                break;
            case 'amexempt':
                this.handleExempt(message, args);
                break;
            case 'amwords':
                this.handleWords(message, args);
                break;
            case 'amreset':
                this.handleReset(message, args);
                break;
        }
    }

    async handleAutoModCommand(message, args) {
        const subCommand = args[0]?.toLowerCase();

        if (!subCommand || subCommand === 'help') {
            return message.reply(this.getHelpEmbed());
        }

        const features = ['antispam', 'antilink', 'antiinvite', 'bannedwords', 'capsfilter', 'mentionspam', 'emojispam', 'zalgofilter', 'repeatedtext'];
        
        if (features.includes(subCommand)) {
            const featureKey = this.getFeatureKey(subCommand);
            const config = this.storage.automod.get('config', {});
            config[featureKey].enabled = !config[featureKey].enabled;
            this.storage.automod.set('config', config);
            
            const status = config[featureKey].enabled ? '✅ ENABLED' : '❌ DISABLED';
            return message.reply(`**${subCommand}** is now ${status}`);
        }

        if (subCommand === 'threshold') {
            const type = args[1];
            const value = parseInt(args[2]);
            
            if (!['warn', 'mute', 'kick', 'ban'].includes(type) || isNaN(value)) {
                return message.reply('Usage: `!automod threshold <warn/mute/kick/ban> <number>`');
            }
            
            this.thresholds[type] = value;
            return message.reply(`✅ ${type} threshold set to ${value} violations`);
        }

        if (subCommand === 'stats') {
            const userId = args[1]?.replace(/[<@!>]/g, '');
            const stats = this.getStats(userId);
            return message.reply({ embeds: [stats] });
        }

        message.reply('Unknown subcommand. Use `!automod help` for usage info.');
    }

    async handleToggle(message, args) {
        const config = this.storage.automod.get('config', {});
        const feature = args[0]?.toLowerCase();

        if (!feature) {
            config.enabled = !config.enabled;
            this.storage.automod.set('config', config);
            const status = config.enabled ? '✅ **ENABLED**' : '❌ **DISABLED**';
            return message.reply(`AutoMod system is now ${status}`);
        }

        const featureKey = this.getFeatureKey(feature);
        if (!config[featureKey]) {
            return message.reply(`Unknown feature: ${feature}`);
        }

        config[featureKey].enabled = !config[featureKey].enabled;
        this.storage.automod.set('config', config);
        
        const status = config[featureKey].enabled ? '✅ ENABLED' : '❌ DISABLED';
        message.reply(`**${feature}** is now ${status}`);
    }

    async handleStatus(message) {
        const config = this.storage.automod.get('config', {});
        const features = [
            ['Anti-Spam', config.antiSpam?.enabled],
            ['Anti-Link', config.antiLink?.enabled],
            ['Anti-Invite', config.antiInvite?.enabled],
            ['Banned Words', config.bannedWords?.enabled],
            ['Caps Filter', config.capsFilter?.enabled],
            ['Mention Spam', config.mentionSpam?.enabled],
            ['Emoji Spam', config.emojiSpam?.enabled],
            ['Zalgo Filter', config.zalgoFilter?.enabled],
            ['Repeated Text', config.repeatedText?.enabled]
        ];

        const violations = this.storage.automod.get('violations', []);

        const embed = {
            title: '🛡️ AutoMod Status',
            color: config.enabled ? 0x2ecc71 : 0xe74c3c,
            fields: [
                {
                    name: 'System Status',
                    value: config.enabled ? '🟢 Active' : '🔴 Disabled',
                    inline: true
                },
                {
                    name: 'Total Violations',
                    value: `${violations.length}`,
                    inline: true
                },
                {
                    name: 'Active Temp Mutes',
                    value: `${Object.keys(this.storage.automod.get('tempMutes', {})).length}`,
                    inline: true
                },
                {
                    name: 'Features',
                    value: features.map(([name, enabled]) => `${enabled ? '🟢' : '🔴'} ${name}`).join('\n'),
                    inline: false
                },
                {
                    name: 'Thresholds',
                    value: `Warn: ${this.thresholds.warn} | Mute: ${this.thresholds.mute} | Kick: ${this.thresholds.kick} | Ban: ${this.thresholds.ban}`,
                    inline: false
                }
            ]
        };

        message.reply({ embeds: [embed] });
    }

    async handleExempt(message, args) {
        const action = args[0]?.toLowerCase();
        const config = this.storage.automod.get('config', {});

        if (action === 'list') {
            const roles = config.exemptRoles?.map(id => `<@&${id}>`).join(', ') || 'None';
            const channels = config.exemptChannels?.map(id => `<#${id}>`).join(', ') || 'None';
            
            return message.reply({
                embeds: [{
                    title: '📋 Exemptions',
                    fields: [
                        { name: 'Exempt Roles', value: roles, inline: false },
                        { name: 'Exempt Channels', value: channels, inline: false }
                    ]
                }]
            });
        }

        if (action === 'role') {
            const role = message.mentions.roles.first();
            if (!role) return message.reply('Please mention a role.');

            if (!config.exemptRoles) config.exemptRoles = [];
            const index = config.exemptRoles.indexOf(role.id);
            
            if (index > -1) {
                config.exemptRoles.splice(index, 1);
                this.storage.automod.set('config', config);
                return message.reply(`✅ Removed ${role.name} from exempt roles`);
            } else {
                config.exemptRoles.push(role.id);
                this.storage.automod.set('config', config);
                return message.reply(`✅ Added ${role.name} to exempt roles`);
            }
        }

        if (action === 'channel') {
            const channel = message.mentions.channels.first();
            if (!channel) return message.reply('Please mention a channel.');

            if (!config.exemptChannels) config.exemptChannels = [];
            const index = config.exemptChannels.indexOf(channel.id);
            
            if (index > -1) {
                config.exemptChannels.splice(index, 1);
                this.storage.automod.set('config', config);
                return message.reply(`✅ Removed ${channel.name} from exempt channels`);
            } else {
                config.exemptChannels.push(channel.id);
                this.storage.automod.set('config', config);
                return message.reply(`✅ Added ${channel.name} to exempt channels`);
            }
        }

        message.reply('Usage: `!amexempt <list/role/channel>`');
    }

    async handleWords(message, args) {
        const action = args[0]?.toLowerCase();
        const config = this.storage.automod.get('config', {});
        
        if (!config.bannedWords) config.bannedWords = { words: [] };

        if (action === 'list') {
            const words = config.bannedWords.words?.join(', ') || 'None configured';
            return message.reply(`**Banned Words:**\n\`\`\`${words}\`\`\``);
        }

        if (action === 'add') {
            const word = args[1]?.toLowerCase();
            if (!word) return message.reply('Please provide a word to ban.');

            if (config.bannedWords.words?.includes(word)) {
                return message.reply('That word is already banned.');
            }

            if (!config.bannedWords.words) config.bannedWords.words = [];
            config.bannedWords.words.push(word);
            this.storage.automod.set('config', config);
            
            return message.reply(`✅ Added \`${word}\` to banned words list`);
        }

        if (action === 'remove') {
            const word = args[1]?.toLowerCase();
            if (!word) return message.reply('Please provide a word to remove.');

            const index = config.bannedWords.words?.indexOf(word);
            if (index === -1 || index === undefined) {
                return message.reply('That word is not in the list.');
            }

            config.bannedWords.words.splice(index, 1);
            this.storage.automod.set('config', config);
            
            return message.reply(`✅ Removed \`${word}\` from banned words list`);
        }

        message.reply('Usage: `!amwords <list/add/remove> [word]`');
    }

    async handleReset(message, args) {
        const target = args[0];
        
        if (target === 'all') {
            this.storage.automod.set('violations', []);
            this.storage.automod.set('userHistory', {});
            return message.reply('🗑️ Cleared all violation history');
        }

        const userId = target?.replace(/[<@!>]/g, '');
        if (!userId) return message.reply('Usage: `!amreset <@user/userID/all>`');

        const violations = this.storage.automod.get('violations', []);
        const newViolations = violations.filter(v => v.userId !== userId);
        this.storage.automod.set('violations', newViolations);

        const userHistory = this.storage.automod.get('userHistory', {});
        delete userHistory[userId];
        this.storage.automod.set('userHistory', userHistory);

        message.reply(`🗑️ Cleared violation history for user ${userId}`);
    }

    // ==================== UTILITY METHODS ====================

    updateMessageCache(message) {
        const config = this.storage.automod.get('config.antiSpam', {});
        const userId = message.author.id;
        const now = Date.now();
        
        if (!this.messageCache.has(userId)) {
            this.messageCache.set(userId, []);
        }

        const userMessages = this.messageCache.get(userId);
        userMessages.push({
            content: message.content,
            timestamp: now,
            messageId: message.id
        });

        const validMessages = userMessages.filter(m => now - m.timestamp < (config.timeWindow || 5000) * 2);
        this.messageCache.set(userId, validMessages);
    }

    getRecentViolations(userId, timeWindow) {
        const violations = this.storage.automod.get('violations', []);
        const cutoff = Date.now() - timeWindow;
        
        return violations.filter(v => 
            v.userId === userId && 
            new Date(v.timestamp).getTime() > cutoff
        );
    }

    getHighestSeverity(violations) {
        const levels = { low: 1, medium: 2, high: 3, critical: 4 };
        return violations.reduce((highest, v) => {
            return levels[v.severity] > levels[highest] ? v.severity : highest;
        }, 'low');
    }

    getMuteRole(guild) {
        let muteRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
        
        const settings = this.client.storage?.settings?.get('automod', {});
        if (settings?.muteRole) {
            muteRole = guild.roles.cache.get(settings.muteRole);
        }
        
        return muteRole;
    }

    getFeatureKey(name) {
        const map = {
            'antispam': 'antiSpam',
            'antilink': 'antiLink',
            'antiinvite': 'antiInvite',
            'bannedwords': 'bannedWords',
            'capsfilter': 'capsFilter',
            'mentionspam': 'mentionSpam',
            'emojispam': 'emojiSpam',
            'zalgofilter': 'zalgoFilter',
            'repeatedtext': 'repeatedText'
        };
        return map[name] || name;
    }

    getStats(userId) {
        let violations = this.storage.automod.get('violations', []);
        
        if (userId) {
            violations = violations.filter(v => v.userId === userId);
        }

        const total = violations.length;
        const byType = {};
        const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };

        violations.forEach(v => {
            v.violations.forEach(type => {
                byType[type] = (byType[type] || 0) + 1;
            });
            bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
        });

        const embed = {
            title: userId ? `📊 User Stats: ${userId}` : '📊 Server AutoMod Stats',
            color: 0x3498db,
            fields: [
                {
                    name: 'Total Violations',
                    value: `${total}`,
                    inline: true
                },
                {
                    name: 'Last 24h',
                    value: `${this.getRecentViolations(userId || 'all', 86400000).length}`,
                    inline: true
                },
                {
                    name: 'By Severity',
                    value: `🟡 Low: ${bySeverity.low}\n🟠 Medium: ${bySeverity.medium}\n🔴 High: ${bySeverity.high}\n🟣 Critical: ${bySeverity.critical}`,
                    inline: true
                }
            ]
        };

        if (Object.keys(byType).length > 0) {
            const typeList = Object.entries(byType)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([type, count]) => `${type}: ${count}`)
                .join('\n');
            
            embed.fields.push({ name: 'Top Violations', value: typeList, inline: false });
        }

        return embed;
    }

    getHelpEmbed() {
        return {
            embeds: [{
                title: '🛡️ AutoMod Commands',
                color: 0x3498db,
                fields: [
                    {
                        name: 'System Control',
                        value: [
                            `\`${this.config.prefix}automod\` - Toggle entire system`,
                            `\`${this.config.prefix}amstatus\` - Show detailed status`,
                            `\`${this.config.prefix}amtoggle <feature>\` - Toggle specific feature`
                        ].join('\n')
                    },
                    {
                        name: 'Features Available',
                        value: [
                            '`antispam` - Message rate limiting',
                            '`antilink` - URL filtering',
                            '`antiinvite` - Discord invite blocking',
                            '`bannedwords` - Word blacklist',
                            '`capsfilter` - Excessive caps detection',
                            '`mentionspam` - Mention limiting',
                            '`emojispam` - Emoji limiting',
                            '`zalgofilter` - Zalgo text detection',
                            '`repeatedtext` - Spam text detection'
                        ].join('\n')
                    },
                    {
                        name: 'Configuration',
                        value: [
                            `\`${this.config.prefix}amexempt list\` - Show exemptions`,
                            `\`${this.config.prefix}amexempt role @role\` - Toggle role exemption`,
                            `\`${this.config.prefix}amexempt channel #channel\` - Toggle channel exemption`,
                            `\`${this.config.prefix}amwords <list/add/remove> [word]\` - Manage banned words`,
                            `\`${this.config.prefix}automod threshold <type> <number>\` - Set punishment thresholds`
                        ].join('\n')
                    },
                    {
                        name: 'Management',
                        value: [
                            `\`${this.config.prefix}automod stats [@user]\` - View statistics`,
                            `\`${this.config.prefix}amreset @user\` - Clear user history`,
                            `\`${this.config.prefix}amreset all\` - Clear all history`
                        ].join('\n')
                    }
                ],
                footer: { text: 'Admin only commands' }
            }]
        };
    }

    startCleanupInterval() {
        setInterval(async () => {
            const maxAge = 30 * 24 * 60 * 60 * 1000;
            const cutoff = Date.now() - maxAge;
            
            const violations = this.storage.automod.get('violations', []);
            const originalLength = violations.length;
            
            const newViolations = violations.filter(v => 
                new Date(v.timestamp).getTime() > cutoff
            );
            
            if (newViolations.length !== originalLength) {
                this.storage.automod.set('violations', newViolations);
                console.log(`[${this.name}] Cleaned up ${originalLength - newViolations.length} old violations`);
            }
        }, 60 * 60 * 1000);
    }

    generateId() {
        return Math.random().toString(36).substring(2, 10).toUpperCase();
    }

    isAdmin(message) {
        return message.member.permissions.has('Administrator') || 
               message.author.id === this.config.ownerId;
    }

    destroy() {
        console.log(`[${this.name}] Module unloaded`);
    }
}

module.exports = AutoModModule;
