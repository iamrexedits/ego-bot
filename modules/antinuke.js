/**
 * Advanced AntiNuke Module
 * Features: Anti-mass ban/kick, anti-channel delete/create, anti-role delete/create,
 *           anti-webhook spam, anti-bot add, anti-permission change, whitelist system
 * Storage: Uses this.storage.antinuke (database/antinuke.json via config)
 */

class AntiNukeModule {
    constructor(client) {
        this.client = client;
        this.name = 'antinuke';
        this.storage = null;
        this.config = null;
        
        // Action thresholds for triggering protection
        this.thresholds = {
            ban: { limit: 3, window: 10000 },      // 3 bans in 10 seconds
            kick: { limit: 3, window: 10000 },     // 3 kicks in 10 seconds
            channelDelete: { limit: 3, window: 10000 },
            channelCreate: { limit: 5, window: 10000 },
            roleDelete: { limit: 3, window: 10000 },
            roleCreate: { limit: 5, window: 10000 },
            webhookCreate: { limit: 3, window: 10000 },
            memberUpdate: { limit: 5, window: 10000 }, // Mass role assignment
            guildUpdate: { limit: 2, window: 60000 }   // Guild setting changes
        };
        
        // In-memory action cache (not persisted)
        this.actionCache = new Map();
        this.recentJoins = new Map(); // Track recent bot joins
    }

    init() {
        this.storage = this.client.storage;
        this.config = this.client.config;
        
        // Initialize antinuke database with defaults
        const antinuke = this.storage.antinuke.getAll();
        
        if (!antinuke.config) {
            this.storage.antinuke.set('config', this.getDefaultConfig());
        }
        if (!antinuke.whitelist) {
            this.storage.antinuke.set('whitelist', {
                users: [],
                roles: [],
                bots: [] // Trusted bots
            });
        }
        if (!antinuke.violations) {
            this.storage.antinuke.set('violations', []);
        }
        if (!antinuke.quarantined) {
            this.storage.antinuke.set('quarantined', {}); // Quarantined users/roles
        }
        if (!antinuke.snapshots) {
            this.storage.antinuke.set('snapshots', []); // Server state snapshots
        }
        
        this.startCleanupInterval();
        this.createServerSnapshot();
        console.log(`[${this.name}] Advanced AntiNuke system ready`);
    }

    getDefaultConfig() {
        return {
            enabled: true,
            mode: 'passive', // passive, active, aggressive
            
            // Protection toggles
            protections: {
                antiBan: true,
                antiKick: true,
                antiChannelDelete: true,
                antiChannelCreate: true,
                antiRoleDelete: true,
                antiRoleCreate: true,
                antiWebhook: true,
                antiBotAdd: true,
                antiPermissionChange: true,
                antiGuildUpdate: true,
                antiEmojiDelete: true,
                antiPrune: true
            },
            
            // Punishment settings
            punishment: {
                action: 'strip', // strip, kick, ban, quarantine
                stripRoles: true,
                restore: true,   // Restore deleted channels/roles
                notifyOwner: true,
                lockdown: false  // Lock server on critical threat
            },
            
            // Detection sensitivity
            sensitivity: {
                newAccountAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                massMentionThreshold: 10,
                dangerousPermissionCheck: true
            },
            
            // Recovery settings
            recovery: {
                autoRestore: true,
                backupInterval: 3600000, // 1 hour
                maxSnapshots: 5
            },
            
            // Alert settings
            alerts: {
                logChannel: null,
                dmOwner: true,
                pingRole: null
            }
        };
    }

    // ==================== CORE PROTECTION CHECKS ====================

    async checkAction(type, executorId, targetId = null, guild) {
        if (!this.shouldProtect(guild, executorId)) return { triggered: false };

        const config = this.storage.antinuke.get('config', {});
        if (!config.enabled) return { triggered: false };

        const threshold = this.thresholds[type];
        if (!threshold) return { triggered: false };

        const now = Date.now();
        const key = `${executorId}:${type}`;
        
        if (!this.actionCache.has(key)) {
            this.actionCache.set(key, []);
        }

        const actions = this.actionCache.get(key);
        actions.push({ timestamp: now, targetId });
        
        // Clean old actions
        const validActions = actions.filter(a => now - a.timestamp < threshold.window);
        this.actionCache.set(key, validActions);

        if (validActions.length >= threshold.limit) {
            return {
                triggered: true,
                count: validActions.length,
                threshold: threshold.limit,
                actions: validActions
            };
        }

        return { triggered: false, count: validActions.length };
    }

    shouldProtect(guild, executorId) {
        const config = this.storage.antinuke.get('config', {});
        const whitelist = this.storage.antinuke.get('whitelist', {});
        
        if (!config.enabled) return false;
        if (!guild) return false;
        if (guild.id !== this.config.guildId) return false;

        // Check user whitelist
        if (whitelist.users?.includes(executorId)) return false;
        
        // Check if executor is owner
        if (executorId === this.config.ownerId) return false;

        // Check executor's roles against whitelist
        const member = guild.members.cache.get(executorId);
        if (member) {
            if (member.permissions.has('Administrator')) {
                // Even admins can be flagged in aggressive mode
                if (config.mode !== 'aggressive') return false;
            }
            
            const hasWhitelistedRole = member.roles.cache.some(role => 
                whitelist.roles?.includes(role.id)
            );
            if (hasWhitelistedRole) return false;
        }

        return true;
    }

    isDangerousPermission(permissions) {
        const dangerous = [
            'Administrator',
            'BanMembers',
            'KickMembers',
            'ManageChannels',
            'ManageGuild',
            'ManageRoles',
            'ManageWebhooks',
            'MentionEveryone',
            'ManageNicknames',
            'ManageMessages'
        ];
        
        return dangerous.some(perm => permissions.has(perm));
    }

    // ==================== EVENT HANDLERS ====================

    async onGuildBanAdd(ban) {
        const config = this.storage.antinuke.get('config', {});
        if (!config.protections.antiBan) return;

        const auditLogs = await ban.guild.fetchAuditLogs({
            limit: 1,
            type: 22 // MEMBER_BAN_ADD
        }).catch(() => null);

        const entry = auditLogs?.entries.first();
        if (!entry || entry.target.id !== ban.user.id) return;

        const check = await this.checkAction('ban', entry.executor.id, ban.user.id, ban.guild);
        
        if (check.triggered) {
            await this.handleNukeAttempt({
                type: 'mass_ban',
                severity: 'critical',
                executor: entry.executor,
                guild: ban.guild,
                details: `Banned ${check.count} members in ${this.thresholds.ban.window / 1000}s`,
                targets: check.actions.map(a => a.targetId),
                config
            });
        } else {
            await this.logAction({
                type: 'ban',
                executor: entry.executor,
                target: ban.user,
                guild: ban.guild,
                threshold: check
            });
        }
    }

    async onGuildMemberRemove(member) {
        const config = this.storage.antinuke.get('config', {});
        if (!config.protections.antiKick) return;

        const auditLogs = await member.guild.fetchAuditLogs({
            limit: 1,
            type: 20 // MEMBER_KICK
        }).catch(() => null);

        const entry = auditLogs?.entries.first();
        if (!entry || entry.target.id !== member.id) return;
        if (entry.createdTimestamp < Date.now() - 5000) return; // Old entry

        const check = await this.checkAction('kick', entry.executor.id, member.id, member.guild);
        
        if (check.triggered) {
            await this.handleNukeAttempt({
                type: 'mass_kick',
                severity: 'critical',
                executor: entry.executor,
                guild: member.guild,
                details: `Kicked ${check.count} members in ${this.thresholds.kick.window / 1000}s`,
                config
            });
        }
    }

    async onChannelDelete(channel) {
        const config = this.storage.antinuke.get('config', {});
        if (!config.protections.antiChannelDelete) return;
        if (!channel.guild) return;

        const auditLogs = await channel.guild.fetchAuditLogs({
            limit: 1,
            type: 12 // CHANNEL_DELETE
        }).catch(() => null);

        const entry = auditLogs?.entries.first();
        if (!entry || entry.target.id !== channel.id) return;

        const check = await this.checkAction('channelDelete', entry.executor.id, channel.id, channel.guild);
        
        // Store channel data for recovery
        this.storeDeletedChannel(channel, entry.executor.id);

        if (check.triggered) {
            await this.handleNukeAttempt({
                type: 'mass_channel_delete',
                severity: 'high',
                executor: entry.executor,
                guild: channel.guild,
                details: `Deleted ${check.count} channels in ${this.thresholds.channelDelete.window / 1000}s`,
                config
            });
        }
    }

    async onChannelCreate(channel) {
        const config = this.storage.antinuke.get('config', {});
        if (!config.protections.antiChannelCreate) return;
        if (!channel.guild) return;

        const auditLogs = await channel.guild.fetchAuditLogs({
            limit: 1,
            type: 10 // CHANNEL_CREATE
        }).catch(() => null);

        const entry = auditLogs?.entries.first();
        if (!entry || entry.target.id !== channel.id) return;

        const check = await this.checkAction('channelCreate', entry.executor.id, channel.id, channel.guild);
        
        if (check.triggered) {
            await this.handleNukeAttempt({
                type: 'mass_channel_create',
                severity: 'medium',
                executor: entry.executor,
                guild: channel.guild,
                details: `Created ${check.count} channels in ${this.thresholds.channelCreate.window / 1000}s`,
                config
            });
        }
    }

    async onRoleDelete(role) {
        const config = this.storage.antinuke.get('config', {});
        if (!config.protections.antiRoleDelete) return;

        const auditLogs = await role.guild.fetchAuditLogs({
            limit: 1,
            type: 32 // ROLE_DELETE
        }).catch(() => null);

        const entry = auditLogs?.entries.first();
        if (!entry || entry.target.id !== role.id) return;

        // Store role data for recovery
        this.storeDeletedRole(role, entry.executor.id);

        const check = await this.checkAction('roleDelete', entry.executor.id, role.id, role.guild);
        
        if (check.triggered) {
            await this.handleNukeAttempt({
                type: 'mass_role_delete',
                severity: 'high',
                executor: entry.executor,
                guild: role.guild,
                details: `Deleted ${check.count} roles in ${this.thresholds.roleDelete.window / 1000}s`,
                config
            });
        }
    }

    async onRoleCreate(role) {
        const config = this.storage.antinuke.get('config', {});
        if (!config.protections.antiRoleCreate) return;

        const auditLogs = await role.guild.fetchAuditLogs({
            limit: 1,
            type: 30 // ROLE_CREATE
        }).catch(() => null);

        const entry = auditLogs?.entries.first();
        if (!entry || entry.target.id !== role.id) return;

        const check = await this.checkAction('roleCreate', entry.executor.id, role.id, role.guild);
        
        if (check.triggered) {
            await this.handleNukeAttempt({
                type: 'mass_role_create',
                severity: 'medium',
                executor: entry.executor,
                guild: role.guild,
                details: `Created ${check.count} roles in ${this.thresholds.roleCreate.window / 1000}s`,
                config
            });
        }
    }

    async onGuildMemberUpdate(oldMember, newMember) {
        const config = this.storage.antinuke.get('config', {});
        if (!config.protections.antiPermissionChange) return;

        // Check for dangerous role assignment
        const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
        
        for (const role of addedRoles.values()) {
            if (this.isDangerousPermission(role.permissions)) {
                const auditLogs = await newMember.guild.fetchAuditLogs({
                    limit: 1,
                    type: 25 // MEMBER_ROLE_UPDATE
                }).catch(() => null);

                const entry = auditLogs?.entries.first();
                if (!entry) continue;

                // Check for mass role assignment
                const check = await this.checkAction('memberUpdate', entry.executor.id, newMember.id, newMember.guild);
                
                if (check.triggered) {
                    await this.handleNukeAttempt({
                        type: 'mass_role_assignment',
                        severity: 'critical',
                        executor: entry.executor,
                        guild: newMember.guild,
                        details: `Assigned dangerous roles to ${check.count} members`,
                        target: newMember,
                        config
                    });
                } else {
                    // Single dangerous permission grant
                    await this.handleNukeAttempt({
                        type: 'dangerous_permission_grant',
                        severity: 'high',
                        executor: entry.executor,
                        guild: newMember.guild,
                        details: `Granted ${role.name} with dangerous permissions to ${newMember.user.tag}`,
                        target: newMember,
                        role: role,
                        config
                    });
                }
            }
        }
    }

    async onWebhookUpdate(channel) {
        const config = this.storage.antinuke.get('config', {});
        if (!config.protections.antiWebhook) return;

        const auditLogs = await channel.guild.fetchAuditLogs({
            limit: 1,
            type: 50 // WEBHOOK_CREATE
        }).catch(() => null);

        const entry = auditLogs?.entries.first();
        if (!entry) return;

        const check = await this.checkAction('webhookCreate', entry.executor.id, entry.target.id, channel.guild);
        
        if (check.triggered) {
            await this.handleNukeAttempt({
                type: 'webhook_spam',
                severity: 'high',
                executor: entry.executor,
                guild: channel.guild,
                details: `Created ${check.count} webhooks in ${this.thresholds.webhookCreate.window / 1000}s`,
                config
            });
        }

        // Always check for webhook spam potential
        if (entry.executor.id !== this.client.user.id) {
            const webhooks = await channel.fetchWebhooks().catch(() => null);
            if (webhooks && webhooks.size > 3) {
                await this.handleNukeAttempt({
                    type: 'suspicious_webhook',
                    severity: 'medium',
                    executor: entry.executor,
                    guild: channel.guild,
                    details: `Multiple webhooks detected in ${channel.name}`,
                    config
                });
            }
        }
    }

    async onGuildMemberAdd(member) {
        const config = this.storage.antinuke.get('config', {});
        if (!config.protections.antiBotAdd) return;
        if (!member.user.bot) return;

        // Check if bot is whitelisted
        const whitelist = this.storage.antinuke.get('whitelist', {});
        if (whitelist.bots?.includes(member.user.id)) return;

        // Track recent bot joins
        const now = Date.now();
        if (!this.recentJoins.has(member.guild.id)) {
            this.recentJoins.set(member.guild.id, []);
        }

        const joins = this.recentJoins.get(member.guild.id);
        joins.push({ timestamp: now, botId: member.user.id, addedBy: null });

        // Get who added the bot
        const auditLogs = await member.guild.fetchAuditLogs({
            limit: 1,
            type: 28 // BOT_ADD
        }).catch(() => null);

        const entry = auditLogs?.entries.first();
        if (entry) {
            joins[joins.length - 1].addedBy = entry.executor.id;
            
            // Check for suspicious patterns
            const recentBotAdds = joins.filter(j => now - j.timestamp < 60000);
            
            if (recentBotAdds.length >= 3) {
                await this.handleNukeAttempt({
                    type: 'mass_bot_add',
                    severity: 'critical',
                    executor: entry.executor,
                    guild: member.guild,
                    details: `Added ${recentBotAdds.length} bots in 1 minute`,
                    config
                });
            } else {
                // Single bot add - check account age and permissions
                const accountAge = now - member.user.createdTimestamp;
                if (accountAge < config.sensitivity.newAccountAge) {
                    await this.handleNukeAttempt({
                        type: 'suspicious_bot',
                        severity: 'high',
                        executor: entry.executor,
                        guild: member.guild,
                        details: `Added new bot ${member.user.tag} (created ${Math.floor(accountAge / 86400000)} days ago)`,
                        target: member,
                        config
                    });
                }
            }
        }

        // Clean old entries
        this.recentJoins.set(member.guild.id, joins.filter(j => now - j.timestamp < 60000));
    }

    async onGuildUpdate(oldGuild, newGuild) {
        const config = this.storage.antinuke.get('config', {});
        if (!config.protections.antiGuildUpdate) return;

        const auditLogs = await newGuild.fetchAuditLogs({
            limit: 1,
            type: 1 // GUILD_UPDATE
        }).catch(() => null);

        const entry = auditLogs?.entries.first();
        if (!entry) return;

        const criticalChanges = [];
        
        if (oldGuild.name !== newGuild.name) criticalChanges.push('Server name changed');
        if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) criticalChanges.push('Vanity URL changed');
        if (oldGuild.publicUpdatesChannelId !== newGuild.publicUpdatesChannelId) criticalChanges.push('Updates channel changed');
        if (oldGuild.rulesChannelId !== newGuild.rulesChannelId) criticalChanges.push('Rules channel changed');

        if (criticalChanges.length > 0) {
            const check = await this.checkAction('guildUpdate', entry
