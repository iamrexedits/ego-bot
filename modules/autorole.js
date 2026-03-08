/**
 * AutoRole Module
 * Automatically assigns roles to new members (humans and bots)
 * Features: Separate roles for humans/bots, toggle on/off, role persistence
 */

class AutoRoleModule {
    constructor(client) {
        this.client = client;
        this.name = 'autorole';
        this.storage = null;
        this.config = null;
    }

    init() {
        this.storage = this.client.storage;
        this.config = this.client.config;
        
        // Initialize default settings if not exist
        const settings = this.storage.settings.get('autorole', {});
        if (!settings.humanRoles) settings.humanRoles = [];
        if (!settings.botRoles) settings.botRoles = [];
        if (!settings.enabled) settings.enabled = true;
        
        this.storage.settings.set('autorole', settings);
        console.log(`[${this.name}] AutoRole system ready`);
    }

    // ==================== EVENT HANDLERS ====================

    async onMemberJoin(member) {
        // Skip if autorole is disabled
        const settings = this.storage.settings.get('autorole', {});
        if (!settings.enabled) return;

        // Determine if member is bot or human
        const isBot = member.user.bot;
        const roleIds = isBot ? settings.botRoles : settings.humanRoles;
        
        if (!roleIds || roleIds.length === 0) return;

        // Assign roles with error handling for each
        const results = { success: [], failed: [] };
        
        for (const roleId of roleIds) {
            try {
                const role = member.guild.roles.cache.get(roleId);
                if (!role) {
                    results.failed.push({ id: roleId, reason: 'Role not found' });
                    continue;
                }

                // Check bot permissions
                const botMember = member.guild.members.me;
                if (!botMember.permissions.has('ManageRoles')) {
                    console.error(`[AutoRole] Bot lacks ManageRoles permission`);
                    continue;
                }

                // Check role hierarchy (bot's highest role must be above target role)
                if (role.position >= botMember.roles.highest.position) {
                    results.failed.push({ id: roleId, name: role.name, reason: 'Role hierarchy too high' });
                    continue;
                }

                await member.roles.add(role);
                results.success.push({ id: roleId, name: role.name });
                
            } catch (error) {
                results.failed.push({ id: roleId, reason: error.message });
            }
        }

        // Log results
        this.logAssignment(member, isBot, results);

        // Optional: Send confirmation to log channel
        if (settings.logEnabled && settings.logChannel) {
            this.sendLog(member, isBot, results);
        }
    }

    // ==================== COMMANDS ====================

    onCommand(command, args, message) {
        // Admin-only commands
        if (!this.isAdmin(message)) return;

        switch(command) {
            case 'autorole':
            case 'ar':
                this.handleAutoRoleCommand(message, args);
                break;
                
            case 'arhuman':
                this.handleHumanRoles(message, args);
                break;
                
            case 'arbot':
                this.handleBotRoles(message, args);
                break;
                
            case 'artoggle':
                this.handleToggle(message);
                break;
                
            case 'arstatus':
                this.handleStatus(message);
                break;
        }
    }

    async handleAutoRoleCommand(message, args) {
        const subCommand = args[0]?.toLowerCase();
        
        if (!subCommand || subCommand === 'help') {
            return message.reply(this.getHelpEmbed());
        }

        switch(subCommand) {
            case 'human':
            case 'h':
                await this.handleHumanRoles(message, args.slice(1));
                break;
                
            case 'bot':
            case 'b':
                await this.handleBotRoles(message, args.slice(1));
                break;
                
            case 'toggle':
                await this.handleToggle(message);
                break;
                
            case 'status':
            case 's':
                await this.handleStatus(message);
                break;
                
            case 'test':
                await this.handleTest(message, args[1]);
                break;
                
            default:
                message.reply('Unknown subcommand. Use `!autorole help` for usage info.');
        }
    }

    async handleHumanRoles(message, args) {
        const action = args[0]?.toLowerCase();
        const settings = this.storage.settings.get('autorole', {});
        let humanRoles = settings.humanRoles || [];

        if (!action || action === 'list') {
            // List current human roles
            if (humanRoles.length === 0) {
                return message.reply('📋 No human auto-roles configured.\nUse `!arhuman add @role` to add one.');
            }

            const roleList = humanRoles.map(id => {
                const role = message.guild.roles.cache.get(id);
                return role ? `• ${role.name} (${id})` : `• Unknown Role (${id})`;
            }).join('\n');

            return message.reply({
                embeds: [{
                    title: '👤 Human Auto-Roles',
                    description: roleList,
                    color: 0x3498db,
                    footer: { text: `${humanRoles.length} role(s) configured` }
                }]
            });
        }

        if (action === 'add') {
            const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
            if (!role) return message.reply('❌ Please mention a valid role or provide a role ID.');

            if (humanRoles.includes(role.id)) {
                return message.reply(`⚠️ ${role.name} is already in the human auto-role list.`);
            }

            humanRoles.push(role.id);
            settings.humanRoles = humanRoles;
            this.storage.settings.set('autorole', settings);

            return message.reply(`✅ Added ${role.name} to human auto-roles.`);
        }

        if (action === 'remove' || action === 'rem') {
            const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
            const roleId = role ? role.id : args[1];

            if (!humanRoles.includes(roleId)) {
                return message.reply('⚠️ That role is not in the human auto-role list.');
            }

            settings.humanRoles = humanRoles.filter(id => id !== roleId);
            this.storage.settings.set('autorole', settings);

            const roleName = role ? role.name : roleId;
            return message.reply(`✅ Removed ${roleName} from human auto-roles.`);
        }

        if (action === 'clear') {
            settings.humanRoles = [];
            this.storage.settings.set('autorole', settings);
            return message.reply('🗑️ Cleared all human auto-roles.');
        }
    }

    async handleBotRoles(message, args) {
        const action = args[0]?.toLowerCase();
        const settings = this.storage.settings.get('autorole', {});
        let botRoles = settings.botRoles || [];

        if (!action || action === 'list') {
            // List current bot roles
            if (botRoles.length === 0) {
                return message.reply('🤖 No bot auto-roles configured.\nUse `!arbot add @role` to add one.');
            }

            const roleList = botRoles.map(id => {
                const role = message.guild.roles.cache.get(id);
                return role ? `• ${role.name} (${id})` : `• Unknown Role (${id})`;
            }).join('\n');

            return message.reply({
                embeds: [{
                    title: '🤖 Bot Auto-Roles',
                    description: roleList,
                    color: 0xe74c3c,
                    footer: { text: `${botRoles.length} role(s) configured` }
                }]
            });
        }

        if (action === 'add') {
            const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
            if (!role) return message.reply('❌ Please mention a valid role or provide a role ID.');

            if (botRoles.includes(role.id)) {
                return message.reply(`⚠️ ${role.name} is already in the bot auto-role list.`);
            }

            botRoles.push(role.id);
            settings.botRoles = botRoles;
            this.storage.settings.set('autorole', settings);

            return message.reply(`✅ Added ${role.name} to bot auto-roles.`);
        }

        if (action === 'remove' || action === 'rem') {
            const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
            const roleId = role ? role.id : args[1];

            if (!botRoles.includes(roleId)) {
                return message.reply('⚠️ That role is not in the bot auto-role list.');
            }

            settings.botRoles = botRoles.filter(id => id !== roleId);
            this.storage.settings.set('autorole', settings);

            const roleName = role ? role.name : roleId;
            return message.reply(`✅ Removed ${roleName} from bot auto-roles.`);
        }

        if (action === 'clear') {
            settings.botRoles = [];
            this.storage.settings.set('autorole', settings);
            return message.reply('🗑️ Cleared all bot auto-roles.');
        }
    }

    async handleToggle(message) {
        const settings = this.storage.settings.get('autorole', {});
        settings.enabled = !settings.enabled;
        this.storage.settings.set('autorole', settings);

        const status = settings.enabled ? '✅ **ENABLED**' : '❌ **DISABLED**';
        message.reply(`AutoRole system is now ${status}`);
    }

    async handleStatus(message) {
        const settings = this.storage.settings.get('autorole', {});
        const guild = message.guild;

        const humanRoles = (settings.humanRoles || []).map(id => {
            const role = guild.roles.cache.get(id);
            return role ? `${role.name}` : `Unknown (${id.slice(-4)})`;
        });

        const botRoles = (settings.botRoles || []).map(id => {
            const role = guild.roles.cache.get(id);
            return role ? `${role.name}` : `Unknown (${id.slice(-4)})`;
        });

        const embed = {
            title: '🤖 AutoRole Status',
            color: settings.enabled ? 0x2ecc71 : 0xe74c3c,
            fields: [
                {
                    name: 'System Status',
                    value: settings.enabled ? '🟢 Active' : '🔴 Disabled',
                    inline: true
                },
                {
                    name: '👤 Human Roles',
                    value: humanRoles.length > 0 ? humanRoles.join(', ') : 'None configured',
                    inline: false
                },
                {
                    name: '🤖 Bot Roles',
                    value: botRoles.length > 0 ? botRoles.join(', ') : 'None configured',
                    inline: false
                }
            ],
            footer: {
                text: `Use ${this.config.prefix}autorole help for commands`
            },
            timestamp: new Date()
        };

        message.reply({ embeds: [embed] });
    }

    async handleTest(message, targetType) {
        // Simulate role assignment on yourself (for testing)
        const settings = this.storage.settings.get('autorole', {});
        const isBot = targetType === 'bot';
        const roleIds = isBot ? settings.botRoles : settings.humanRoles;

        if (!roleIds || roleIds.length === 0) {
            return message.reply(`No ${isBot ? 'bot' : 'human'} auto-roles configured to test.`);
        }

        const member = message.member;
        const results = { added: [], failed: [] };

        for (const roleId of roleIds) {
            const role = message.guild.roles.cache.get(roleId);
            if (!role) {
                results.failed.push(`Unknown role ${roleId}`);
                continue;
            }

            if (member.roles.cache.has(roleId)) {
                results.failed.push(`Already has ${role.name}`);
                continue;
            }

            try {
                await member.roles.add(role);
                results.added.push(role.name);
            } catch (error) {
                results.failed.push(`${role.name}: ${error.message}`);
            }
        }

        let response = '**Test Results:**\n';
        if (results.added.length) response += `✅ Added: ${results.added.join(', ')}\n`;
        if (results.failed.length) response += `❌ Failed: ${results.failed.join(', ')}`;

        message.reply(response);
    }

    // ==================== UTILITY METHODS ====================

    isAdmin(message) {
        if (message.author.id === this.config.ownerId) return true;
        if (message.member.permissions.has('Administrator')) return true;
        
        // Check for specific admin role if configured
        const settings = this.storage.settings.get('autorole', {});
        if (settings.adminRole && message.member.roles.cache.has(settings.adminRole)) {
            return true;
        }
        
        return false;
    }

    logAssignment(member, isBot, results) {
        const type = isBot ? 'BOT' : 'HUMAN';
        const successCount = results.success.length;
        const failCount = results.failed.length;
        
        console.log(`[AutoRole] ${type} ${member.user.tag} (${member.id}): ${successCount} success, ${failCount} failed`);
        
        if (results.failed.length > 0) {
            console.log(`[AutoRole] Failures:`, results.failed);
        }

        // Store in database for analytics
        const logEntry = {
            timestamp: new Date().toISOString(),
            userId: member.id,
            username: member.user.tag,
            isBot: isBot,
            success: results.success.map(r => r.id),
            failed: results.failed.map(r => r.id)
        };

        this.storage.guild.push('autoroleLogs', logEntry);
    }

    async sendLog(member, isBot, results) {
        const settings = this.storage.settings.get('autorole', {});
        const channel = member.guild.channels.cache.get(settings.logChannel);
        if (!channel) return;

        const emoji = isBot ? '🤖' : '👤';
        const successRoles = results.success.map(r => r.name).join(', ') || 'None';
        
        const embed = {
            title: `${emoji} AutoRole Assignment`,
            description: `**Member:** ${member.user.tag} (${member.id})\n**Type:** ${isBot ? 'Bot' : 'Human'}`,
            color: results.failed.length > 0 ? 0xf39c12 : 0x2ecc71,
            fields: [
                {
                    name: '✅ Success',
                    value: successRoles || 'None',
                    inline: false
                }
            ],
            timestamp: new Date()
        };

        if (results.failed.length > 0) {
            embed.fields.push({
                name: '❌ Failed',
                value: results.failed.map(f => f.name || f.id).join(', '),
                inline: false
            });
        }

        channel.send({ embeds: [embed] }).catch(() => {});
    }

    getHelpEmbed() {
        const prefix = this.config.prefix;
        return {
            embeds: [{
                title: '🤖 AutoRole Help',
                description: 'Automatically assign roles to new members',
                color: 0x3498db,
                fields: [
                    {
                        name: '👤 Human Roles',
                        value: [
                            `\`${prefix}arhuman list\` - Show human auto-roles`,
                            `\`${prefix}arhuman add @role\` - Add role for humans`,
                            `\`${prefix}arhuman remove @role\` - Remove role`,
                            `\`${prefix}arhuman clear\` - Remove all human roles`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🤖 Bot Roles',
                        value: [
                            `\`${prefix}arbot list\` - Show bot auto-roles`,
                            `\`${prefix}arbot add @role\` - Add role for bots`,
                            `\`${prefix}arbot remove @role\` - Remove role`,
                            `\`${prefix}arbot clear\` - Remove all bot roles`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '⚙️ General',
                        value: [
                            `\`${prefix}arstatus\` - Show current configuration`,
                            `\`${prefix}artoggle\` - Enable/disable autorole`,
                            `\`${prefix}autorole test [human/bot]\` - Test on yourself`
                        ].join('\n'),
                        inline: false
                    }
                ],
                footer: {
                    text: 'Admin only commands'
                }
            }]
        };
    }

    destroy() {
        console.log(`[${this.name}] Module unloaded`);
    }
}

module.exports = AutoRoleModule;
