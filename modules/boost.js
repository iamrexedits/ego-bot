/**
 * Boost Module
 * Comprehensive Nitro Booster management system
 * Features: Tiered roles, custom perks, boost notifications, special colors, claimable rewards
 * Storage: All data stored in guild.json
 */

class BoostModule {
    constructor(client) {
        this.client = client;
        this.name = 'boost';
        this.storage = null;
        this.config = null;
    }

    init() {
        this.storage = this.client.storage;
        this.config = this.client.config;
        
        // Initialize default settings in guild.json
        let boostData = this.storage.guild.get('boost', null);
        
        if (!boostData) {
            boostData = {
                enabled: true,
                tiers: {},
                notifications: {
                    enabled: true,
                    channel: null,
                    message: '🎉 **{user}** just boosted the server! They now have **{tier}** perks!'
                },
                colors: [],
                claimedPerks: {},
                customRoles: {},
                stats: {
                    totalBoosts: 0,
                    currentBoosters: 0,
                    history: []
                }
            };
            this.storage.guild.set('boost', boostData);
        }
        
        // Ensure all fields exist (for existing data)
        if (!boostData.claimedPerks) boostData.claimedPerks = {};
        if (!boostData.customRoles) boostData.customRoles = {};
        if (!boostData.colors) boostData.colors = [];
        if (!boostData.stats) boostData.stats = { totalBoosts: 0, currentBoosters: 0, history: [] };
        
        this.storage.guild.set('boost', boostData);
        console.log(`[${this.name}] Boost system ready (stored in guild.json)`);
    }

    // ==================== EVENT HANDLERS ====================

    async onMemberJoin(member) {
        const boostData = this.storage.guild.get('boost', {});
        const userData = boostData.claimedPerks?.[member.id];
        
        if (userData && member.premiumSince) {
            await this.restoreBoosterRoles(member, userData);
        }
    }

    // ==================== BOOST DETECTION ====================

    async checkBoostStatus(member) {
        const boostData = this.storage.guild.get('boost', {});
        if (!boostData.enabled) return;

        const boostCount = await this.getBoostCount(member.guild);
        const tier = this.getTierByBoosts(boostCount);
        
        const currentData = boostData.claimedPerks?.[member.id] || {};
        
        if (!currentData.tier || currentData.tier !== tier.name) {
            await this.updateBoosterTier(member, tier, currentData.tier);
            
            const newData = {
                ...currentData,
                tier: tier.name,
                boostCount: boostCount,
                updatedAt: new Date().toISOString()
            };
            
            this.storage.guild.set(`boost.claimedPerks.${member.id}`, newData);
        }

        return tier;
    }

    async getBoostCount(guild) {
        const boosters = await guild.members.fetch();
        return boosters.filter(m => m.premiumSince).size;
    }

    getTierByBoosts(boostCount) {
        const boostData = this.storage.guild.get('boost', {});
        const tiers = boostData.tiers || {};
        
        const sortedTiers = Object.values(tiers).sort((a, b) => b.requiredBoosts - a.requiredBoosts);
        
        for (const tier of sortedTiers) {
            if (boostCount >= tier.requiredBoosts) {
                return tier;
            }
        }
        
        return { name: 'None', role: null, perks: [] };
    }

    // ==================== ROLE MANAGEMENT ====================

    async updateBoosterTier(member, newTier, oldTierName) {
        const boostData = this.storage.guild.get('boost', {});
        
        if (oldTierName) {
            const oldTier = Object.values(boostData.tiers || {}).find(t => t.name === oldTierName);
            if (oldTier?.role && member.roles.cache.has(oldTier.role)) {
                await member.roles.remove(oldTier.role).catch(() => {});
            }
        }

        if (newTier.role && !member.roles.cache.has(newTier.role)) {
            await member.roles.add(newTier.role).catch(err => {
                console.error(`[Boost] Failed to add tier role:`, err);
            });
        }

        if (newTier.customRoleAllowed && !this.hasCustomRole(member.id)) {
            await this.notifyCustomRoleAvailable(member);
        }
    }

    async restoreBoosterRoles(member, userData) {
        const boostData = this.storage.guild.get('boost', {});
        const tier = Object.values(boostData.tiers || {}).find(t => t.name === userData.tier);
        
        if (tier?.role && !member.roles.cache.has(tier.role)) {
            await member.roles.add(tier.role).catch(() => {});
        }

        const customRole = boostData.customRoles?.[member.id];
        if (customRole?.roleId && !member.roles.cache.has(customRole.roleId)) {
            const role = member.guild.roles.cache.get(customRole.roleId);
            if (role) await member.roles.add(role).catch(() => {});
        }
    }

    // ==================== COMMANDS ====================

    onCommand(command, args, message) {
        if (this.isAdmin(message)) {
            switch(command) {
                case 'boostsetup':
                case 'bs':
                    this.handleSetupCommand(message, args);
                    break;
                case 'boosttier':
                case 'bt':
                    this.handleTierCommand(message, args);
                    break;
                case 'boostnotif':
                case 'bn':
                    this.handleNotificationCommand(message, args);
                    break;
                case 'boostcolors':
                case 'bc':
                    this.handleColorsCommand(message, args);
                    break;
                case 'boosttest':
                    this.handleBoostTest(message, args);
                    break;
            }
        }

        switch(command) {
            case 'boosthelp':
            case 'bh':
            case 'bhelp':
                this.handleHelp(message, args);
                break;
            case 'claim':
            case 'claimperks':
                this.handleClaim(message);
                break;
            case 'booststatus':
            case 'mystatus':
                this.handleStatus(message);
                break;
            case 'customrole':
            case 'cr':
                this.handleCustomRole(message, args);
                break;
            case 'boostcolor':
            case 'bcolor':
                this.handleColorSelect(message, args);
                break;
            case 'perks':
            case 'boosterperks':
                this.handlePerksList(message);
                break;
        }
    }

    // ==================== BOOST TEST COMMAND ====================

    async handleBoostTest(message, args) {
        const subCommand = args[0]?.toLowerCase();
        const boostData = this.storage.guild.get('boost', {});

        if (!subCommand || subCommand === 'help') {
            return message.reply({
                embeds: [{
                    title: '🧪 Boost Test Commands',
                    description: 'Test boost system components',
                    color: 0x9b59b6,
                    fields: [
                        {
                            name: 'Available Tests',
                            value: [
                                '`!boosttest message` - Test boost notification embed',
                                '`!boosttest tier <tiername>` - Test tier role assignment on yourself',
                                '`!boosttest all` - Run all tests'
                            ].join('\n')
                        }
                    ]
                }]
            });
        }

        // Test boost notification message
        if (subCommand === 'message' || subCommand === 'notif') {
            const testCount = parseInt(args[1]) || 5;
            const testTier = this.getTierByBoosts(testCount);
            
            const embed = {
                title: '🎉 New Server Boost! (TEST)',
                description: (boostData.notifications?.message || '🎉 **{user}** just boosted!')
                    .replace('{user}', message.author.toString())
                    .replace('{tier}', testTier.name)
                    .replace('{count}', testCount),
                color: 0xf47fff,
                thumbnail: { url: message.author.displayAvatarURL({ dynamic: true }) },
                fields: [
                    { name: '👤 Booster', value: message.author.toString(), inline: true },
                    { name: '📊 Total Boosts', value: `${testCount} (simulated)`, inline: true },
                    { name: '🏆 Tier Unlocked', value: testTier.name, inline: true },
                    { name: '✨ Perks', value: testTier.perks?.join('\n') || 'None configured', inline: false }
                ],
                footer: { text: 'This is a test message • ' + new Date().toLocaleTimeString() },
                timestamp: new Date()
            };

            // Send to channel if configured
            if (boostData.notifications?.channel) {
                const channel = message.guild.channels.cache.get(boostData.notifications.channel);
                if (channel) {
                    await channel.send({ embeds: [embed] });
                    return message.reply({
                        embeds: [{
                            title: '✅ Test Sent',
                            description: `Test boost message sent to <#${boostData.notifications.channel}>`,
                            color: 0x2ecc71
                        }]
                    });
                }
            }

            // Fallback: send in current channel
            return message.reply({ embeds: [embed] });
        }

        // Test tier role assignment
        if (subCommand === 'tier' || subCommand === 'role') {
            const tierName = args[1];
            if (!tierName) {
                return message.reply({
                    embeds: [{
                        title: '❌ Missing Tier Name',
                        description: 'Usage: `!boosttest tier <tiername>`\nUse `!bt list` to see available tiers',
                        color: 0xe74c3c
                    }]
                });
            }

            const tier = boostData.tiers?.[tierName];
            if (!tier) {
                return message.reply({
                    embeds: [{
                        title: '❌ Tier Not Found',
                        description: `Tier "**${tierName}**" doesn't exist.\nAvailable: ${Object.keys(boostData.tiers || {}).join(', ') || 'None configured'}`,
                        color: 0xe74c3c
                    }]
                });
            }

            const member = message.member;
            const results = { added: [], removed: [], errors: [] };

            // Remove other tier roles first
            const allTierRoles = Object.values(boostData.tiers || {})
                .map(t => t.role)
                .filter(id => id && id !== tier.role);
            
            for (const roleId of allTierRoles) {
                if (member.roles.cache.has(roleId)) {
                    try {
                        await member.roles.remove(roleId);
                        const role = message.guild.roles.cache.get(roleId);
                        results.removed.push(role?.name || roleId);
                    } catch (err) {
                        results.errors.push(`Failed to remove ${roleId}: ${err.message}`);
                    }
                }
            }

            // Add test tier role
            if (tier.role) {
                const role = message.guild.roles.cache.get(tier.role);
                if (!role) {
                    results.errors.push(`Tier role not found in server`);
                } else if (member.roles.cache.has(tier.role)) {
                    results.errors.push(`You already have ${role.name}`);
                } else {
                    try {
                        // Check permissions
                        const botMember = message.guild.members.me;
                        if (botMember.roles.highest.position <= role.position) {
                            results.errors.push(`Bot cannot assign ${role.name} (hierarchy)`);
                        } else {
                            await member.roles.add(tier.role);
                            results.added.push(role.name);
                        }
                    } catch (err) {
                        results.errors.push(`Failed to add ${role.name}: ${err.message}`);
                    }
                }
            }

            // Build result embed
            const fields = [];
            if (results.added.length) {
                fields.push({ name: '✅ Added Roles', value: results.added.join('\n'), inline: false });
            }
            if (results.removed.length) {
                fields.push({ name: '🗑️ Removed Roles', value: results.removed.join('\n'), inline: false });
            }
            if (results.errors.length) {
                fields.push({ name: '❌ Errors', value: results.errors.join('\n'), inline: false });
            }

            const testEmbed = {
                title: `🧪 Tier Test: ${tierName}`,
                description: `Testing tier role assignment for **${tier.name}**`,
                color: results.errors.length ? 0xf39c12 : 0x2ecc71,
                fields: [
                    { name: '📋 Tier Info', value: [
                        `Required Boosts: ${tier.requiredBoosts}`,
                        `Role: ${tier.role ? `<@&${tier.role}>` : 'None'}`,
                        `Custom Role: ${tier.customRoleAllowed ? '✅' : '❌'}`,
                        `Logo: ${tier.logoAllowed ? '✅' : '❌'}`
                    ].join('\n'), inline: false },
                    ...fields
                ],
                footer: { text: 'Test completed • Roles will NOT be automatically reverted' }
            };

            return message.reply({ embeds: [testEmbed] });
        }

        // Run all tests
        if (subCommand === 'all') {
            const testResults = [];
            
            // Test 1: Check configuration
            const configStatus = boostData.enabled ? '✅ Enabled' : '❌ Disabled';
            const tierCount = Object.keys(boostData.tiers || {}).length;
            const notifChannel = boostData.notifications?.channel ? '✅ Set' : '❌ Not set';
            
            testResults.push({ name: '⚙️ System Config', value: `Status: ${configStatus}\nTiers: ${tierCount}\nChannel: ${notifChannel}`, inline: false });

            // Test 2: Check tiers
            const tierRoles = Object.values(boostData.tiers || {}).map(t => {
                const role = message.guild.roles.cache.get(t.role);
                return `${t.name}: ${role ? '✅' : '❌'} ${role?.name || 'Role missing'}`;
            }).join('\n') || 'No tiers configured';
            
            testResults.push({ name: '📊 Tier Roles', value: tierRoles, inline: false });

            // Test 3: Check color roles
            const colorStatus = (boostData.colors || []).map(id => {
                const role = message.guild.roles.cache.get(id);
                return role ? `✅ ${role.name}` : `❌ Invalid (${id.slice(-4)})`;
            }).join('\n') || 'No colors configured';
            
            testResults.push({ name: '🎨 Color Roles', value: colorStatus, inline: false });

            // Test 4: Bot permissions
            const botMember = message.guild.members.me;
            const perms = [
                `Manage Roles: ${botMember.permissions.has('ManageRoles') ? '✅' : '❌'}`,
                `Manage Guild: ${botMember.permissions.has('ManageGuild') ? '✅' : '❌'}`,
                `Send Messages: ${botMember.permissions.has('SendMessages') ? '✅' : '❌'}`,
                `Embed Links: ${botMember.permissions.has('EmbedLinks') ? '✅' : '❌'}`
            ];
            testResults.push({ name: '🤖 Bot Permissions', value: perms.join('\n'), inline: false });

            const allEmbed = {
                title: '🧪 Boost System Diagnostic',
                description: 'Complete system health check',
                color: 0x3498db,
                fields: testResults,
                footer: { text: 'Run !boosttest message or !boosttest tier <name> for specific tests' },
                timestamp: new Date()
            };

            return message.reply({ embeds: [allEmbed] });
        }

        return message.reply({
            embeds: [{
                title: '❌ Unknown Test',
                description: 'Use `!boosttest message`, `!boosttest tier <name>`, or `!boosttest all`',
                color: 0xe74c3c
            }]
        });
    }

    // ==================== HELP COMMAND ====================

    async handleHelp(message, args) {
        const section = args[0]?.toLowerCase();
        const isAdmin = this.isAdmin(message);
        const prefix = this.config.prefix;

        if (section) {
            switch(section) {
                case 'admin':
                case 'setup':
                    if (!isAdmin) return message.reply({
                        embeds: [{
                            title: '❌ Access Denied',
                            description: 'This section is for admins only.',
                            color: 0xe74c3c
                        }]
                    });
                    return message.reply(this.getAdminHelpEmbed());
                case 'booster':
                case 'user':
                    return message.reply(this.getBoosterHelpEmbed());
                case 'tiers':
                    return message.reply(this.getTiersHelpEmbed());
                case 'customrole':
                case 'cr':
                    return message.reply(this.getCustomRoleHelpEmbed());
                case 'colors':
                    return message.reply(this.getColorsHelpEmbed());
                default:
                    return message.reply({
                        embeds: [{
                            title: '❌ Unknown Section',
                            description: `**${section}** not found.\nAvailable: admin, booster, tiers, customrole, colors`,
                            color: 0xe74c3c
                        }]
                    });
            }
        }

        const boostData = this.storage.guild.get('boost', {});
        const boostCount = await this.getBoostCount(message.guild);
        const userTier = boostData.claimedPerks?.[message.author.id]?.tier || 'None';
        const isBooster = !!message.member.premiumSince;

        const embed = {
            title: '💎 Boost System Help',
            description: `Welcome to the Nitro Booster rewards system!\nServer currently has **${boostCount}** ${this.getBoostEmoji(boostCount)} boosts.`,
            color: 0xf47fff,
            thumbnail: { url: message.guild.iconURL({ dynamic: true }) || undefined },
            fields: [
                {
                    name: '📋 Quick Navigation',
                    value: [
                        `• \`${prefix}boosthelp booster\` - Commands for boosters`,
                        `• \`${prefix}boosthelp tiers\` - Understanding tiers`,
                        `• \`${prefix}boosthelp customrole\` - Custom role guide`,
                        `• \`${prefix}boosthelp colors\` - Color roles guide`,
                        isAdmin ? `• \`${prefix}boosthelp admin\` - Admin setup commands` : ''
                    ].filter(Boolean).join('\n'),
                    inline: false
                },
                {
                    name: '⚡ Quick Commands',
                    value: [
                        `\`${prefix}claim\` - Claim your tier perks`,
                        `\`${prefix}perks\` - View all available perks`,
                        `\`${prefix}mystatus\` - Check your boost status`,
                        isBooster ? `\`${prefix}customrole create <name>\` - Make your custom role` : ''
                    ].filter(Boolean).join('\n'),
                    inline: false
                },
                {
                    name: '💡 Pro Tips',
                    value: [
                        '• Boosting gives you exclusive perks based on server boost count',
                        '• Higher tiers unlock better rewards (custom roles, colors, etc.)',
                        '• Use `!claim` after boosting to get your rewards',
                        '• Your perks persist as long as you keep boosting'
                    ].join('\n'),
                    inline: false
                }
            ],
            footer: { 
                text: `Your tier: ${userTier} | ${isBooster ? 'Active Booster 💎' : 'Not boosting'}`
            },
            timestamp: new Date()
        };

        message.reply({ embeds: [embed] });
    }

    getBoostEmoji(count) {
        if (count >= 30) return '🌟';
        if (count >= 14) return '💎';
        if (count >= 7) return '🔥';
        if (count >= 2) return '⚡';
        return '💨';
    }

    getBoosterHelpEmbed() {
        const prefix = this.config.prefix;
        return {
            embeds: [{
                title: '👤 Booster Commands',
                description: 'Available commands for Nitro Boosters',
                color: 0x3498db,
                thumbnail: { url: 'https://cdn.discordapp.com/emojis/638138543965315092.png' }, // Nitro boost icon
                fields: [
                    {
                        name: '💎 Core Commands',
                        value: [
                            `\`${prefix}claim\` / \`${prefix}claimperks\` - Claim your tier rewards`,
                            `\`${prefix}perks\` / \`${prefix}boosterperks\` - View all tiers and perks`,
                            `\`${prefix}mystatus\` / \`${prefix}booststatus\` - Check your boost status`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🎨 Customization',
                        value: [
                            `\`${prefix}customrole create <name>\` - Create your personal role (if unlocked)`,
                            `\`${prefix}customrole edit name <newname>\` - Rename your custom role`,
                            `\`${prefix}customrole edit color <#hex>\` - Change role color (e.g., #FF5733)`,
                            `\`${prefix}customrole delete\` - Remove your custom role`,
                            `\`${prefix}boostcolor\` / \`${prefix}bcolor\` - View/select color roles`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '❓ How It Works',
                        value: [
                            '1. Boost the server with Discord Nitro',
                            '2. Wait for the boost to register',
                            '3. Use `!claim` to get your rewards',
                            '4. Higher server boost counts = better tiers for everyone!',
                            '5. Keep boosting to maintain your perks'
                        ].join('\n'),
                        inline: false
                    }
                ],
                footer: { text: 'Use !boosthelp customrole for detailed role guide' },
                timestamp: new Date()
            }]
        };
    }

    getAdminHelpEmbed() {
        const prefix = this.config.prefix;
        return {
            embeds: [{
                title: '⚙️ Admin Setup Commands',
                description: 'Configure the boost reward system (Admin only)',
                color: 0xe74c3c,
                thumbnail: { url: 'https://cdn.discordapp.com/emojis/1041898699204435988.png' }, // Settings icon
                fields: [
                    {
                        name: '🔧 System Setup',
                        value: [
                            `\`${prefix}boostsetup toggle\` - Enable/disable boost system`,
                            `\`${prefix}boostsetup channel #channel\` - Set notification channel`,
                            `\`${prefix}boostsetup message <text>\` - Set boost message`,
                            `\`${prefix}boostsetup status\` - View current configuration`,
                            `\`${prefix}boostsetup reset\` - Reset all boost data (dangerous!)`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '📊 Tier Management',
                        value: [
                            `\`${prefix}boosttier list\` - Show all configured tiers`,
                            `\`${prefix}boosttier add <name> <boosts> @role [+perks] [--custom-role] [--logo]\``,
                            '**Example:** `!bt add Gold 5 @GoldRole +VIP +Lounge --custom-role`',
                            `\`${prefix}boosttier remove <name>\` - Delete a tier`,
                            `\`${prefix}boosttier view <name>\` - View tier details`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🧪 Testing',
                        value: [
                            `\`${prefix}boosttest message\` - Test boost notification embed`,
                            `\`${prefix}boosttest tier <name>\` - Test tier role assignment`,
                            `\`${prefix}boosttest all\` - Run full system diagnostic`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🎨 Color Management',
                        value: [
                            `\`${prefix}boostcolors list\` - Show available colors`,
                            `\`${prefix}boostcolors add @role\` - Add color option`,
                            `\`${prefix}boostcolors remove @role/id\` - Remove color`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🔔 Notifications',
                        value: [
                            `\`${prefix}boostnotif toggle\` - Enable/disable notifications`,
                            `\`${prefix}boostnotif test\` - Send test notification`
                        ].join('\n'),
                        inline: false
                    }
                ],
                footer: { text: 'Variables: {user} = booster, {tier} = tier name, {count} = total boosts' },
                timestamp: new Date()
            }]
        };
    }

    getTiersHelpEmbed() {
        const prefix = this.config.prefix;
        return {
            embeds: [{
                title: '📊 Understanding Tiers',
                description: 'How the boost tier system works',
                color: 0x9b59b6,
                fields: [
                    {
                        name: '🎯 What Are Tiers?',
                        value: 'Tiers are reward levels based on the **total number of boosts** the server has. Everyone benefits from higher tiers!',
                        inline: false
                    },
                    {
                        name: '📈 Example Setup',
                        value: [
                            '**Tier 1 (Bronze)**: 1 boost required',
                            '→ Basic role + channel access',
                            '',
                            '**Tier 2 (Silver)**: 3 boosts required',
                            '→ Better role + custom role creation',
                            '',
                            '**Tier 3 (Gold)**: 7 boosts required',
                            '→ Best role + logo + exclusive perks'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '✨ Tier Features',
                        value: [
                            '• **Role** - Automatic role assignment',
                            '• **Perks** - Listed benefits (text only)',
                            '• **Custom Role** - Allow personal role creation',
                            '• **Logo** - Allow role icon upload (Level 2+ server)',
                            '',
                            `Use \`${prefix}perks\` to see current tiers!`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '💡 Tips',
                        value: [
                            '• Tiers stack - higher tiers include lower perks',
                            '• Server boost count = sum of ALL active boosts',
                            '• Users must `!claim` to get their rewards',
                            '• Roles are assigned automatically on claim'
                        ].join('\n'),
                        inline: false
                    }
                ],
                timestamp: new Date()
            }]
        };
    }

    getCustomRoleHelpEmbed() {
        const prefix = this.config.prefix;
        return {
            embeds: [{
                title: '🎨 Custom Role Guide',
                description: 'Everything about booster custom roles',
                color: 0x2ecc71,
                fields: [
                    {
                        name: '🔓 Requirements',
                        value: [
                            '• Must be an active Nitro Booster',
                            '• Server must have required boost count for your tier',
                            '• Your tier must allow custom roles (`--custom-role` flag)',
                            '',
                            `Check with \`${prefix}mystatus\` to see if you qualify!`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '⚡ Commands',
                        value: [
                            `\`${prefix}customrole create <name>\` - Create your role`,
                            `\`${prefix}customrole edit name <newname>\` - Change name`,
                            `\`${prefix}customrole edit color <#hex>\` - Change color`,
                            `\`${prefix}customrole edit icon\` - Add icon (if allowed)`,
                            `\`${prefix}customrole delete\` - Delete your role`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '🎨 Color Format',
                        value: [
                            'Use hex color codes:',
                            '• `#FF5733` - Orange Red',
                            '• `#3498DB` - Blue',
                            '• `#2ECC71` - Green',
                            '• `#F47FFF` - Pink',
                            '',
                            'Find more at color-hex.com'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '⚠️ Rules',
                        value: [
                            '• One custom role per booster',
                            '• Role appears below bot roles',
                            '• Keep names appropriate (filtered by Discord)',
                            '• Role is deleted if you stop boosting',
                            '• You can edit name/color anytime'
                        ].join('\n'),
                        inline: false
                    }
                ],
                timestamp: new Date()
            }]
        };
    }

    getColorsHelpEmbed() {
        const prefix = this.config.prefix;
        return {
            embeds: [{
                title: '🎨 Color Roles Guide',
                description: 'How to use special booster colors',
                color: 0xe67e22,
                fields: [
                    {
                        name: '🔓 Requirements',
                        value: 'Active Nitro Boosters can select special color roles set up by admins.',
                        inline: false
                    },
                    {
                        name: '⚡ Commands',
                        value: [
                            `\`${prefix}boostcolor\` / \`${prefix}bcolor\` - List available colors`,
                            `\`${prefix}boostcolor <number>\` - Select a color (e.g., \`!bcolor 2\`)`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '💡 How It Works',
                        value: [
                            '• Colors are preset roles created by admins',
                            '• You can only have ONE color at a time',
                            '• Selecting a new color removes the old one',
                            '• Colors stack with your tier roles',
                            '• Colors persist as long as you boost'
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '📋 Admin Info',
                        value: `Admins use \`${prefix}boostcolors\` to add color options for boosters.`,
                        inline: false
                    }
                ],
                timestamp: new Date()
            }]
        };
    }

    // ==================== ADMIN COMMANDS WITH EMBEDS ====================

    async handleSetupCommand(message, args) {
        const subCommand = args[0]?.toLowerCase();
        
        if (!subCommand || subCommand === 'help') {
            return message.reply(this.getSetupHelpEmbed());
        }

        const boostData = this.storage.guild.get('boost', {});

        switch(subCommand) {
            case 'toggle':
                const newState = !boostData.enabled;
                this.storage.guild.set('boost.enabled', newState);
                return message.reply({
                    embeds: [{
                        title: newState ? '✅ System Enabled' : '❌ System Disabled',
                        description: `Boost system is now **${newState ? 'ENABLED' : 'DISABLED'}**`,
                        color: newState ? 0x2ecc71 : 0xe74c3c,
                        timestamp: new Date()
                    }]
                });

            case 'channel':
                const channel = message.mentions.channels.first();
                if (!channel) {
                    return message.reply({
                        embeds: [{
                            title: '❌ Invalid Channel',
                            description: 'Please mention a valid channel.\nExample: `!boostsetup channel #boosts`',
                            color: 0xe74c3c
                        }]
                    });
                }
                this.storage.guild.set('boost.notifications.channel', channel.id);
                return message.reply({
                    embeds: [{
                        title: '✅ Channel Set',
                        description: `Boost notifications will be sent to ${channel}`,
                        color: 0x2ecc71,
                        fields: [{ name: 'Channel ID', value: channel.id, inline: true }]
                    }]
                });

            case 'message':
                const msg = args.slice(1).join(' ');
                if (!msg) {
                    return message.reply({
                        embeds: [{
                            title: '❌ Missing Message',
                            description: 'Please provide a message.\nVariables: `{user}`, `{tier}`, `{count}`\nExample: `!boostsetup message 🎉 {user} boosted! We now have {count} boosts!`',
                            color: 0xe74c3c
                        }]
                    });
                }
                this.storage.guild.set('boost.notifications.message', msg);
                return message.reply({
                    embeds: [{
                        title: '✅ Message Updated',
                        description: 'Boost notification message has been updated!',
                        color: 0x2ecc71,
                        fields: [
                            { name: 'Preview', value: msg.replace('{user}', message.author.toString()).replace('{tier}', 'Test').replace('{count}', '5'), inline: false }
                        ]
                    }]
                });

            case 'status':
                return this.sendSetupStatus(message);
                
            case 'reset':
                if (args[1] === 'confirm') {
                    this.storage.guild.set('boost', {
                        enabled: true,
                        tiers: {},
                        notifications: {
                            enabled: true,
                            channel: null,
                            message: '🎉 **{user}** just boosted the server! They now have **{tier}** perks!'
                        },
                        colors: [],
                        claimedPerks: {},
                        customRoles: {},
                        stats: { totalBoosts: 0, currentBoosters: 0, history: [] }
                    });
                    return message.reply({
                        embeds: [{
                            title: '🗑️ System Reset',
                            description: 'All boost data has been completely reset.',
                            color: 0xe74c3c,
                            footer: { text: 'Action performed by ' + message.author.tag }
                        }]
                    });
                }
                return message.reply({
                    embeds: [{
                        title: '⚠️ Dangerous Action',
                        description: 'This will delete **ALL** boost data including tiers, claimed perks, and custom roles.\n\nType `!boostsetup reset confirm` to proceed.',
                        color: 0xf39c12,
                        fields: [{ name: 'This cannot be undone!', value: '⚠️⚠️⚠️', inline: false }]
                    }]
                });
        }
    }

    async handleTierCommand(message, args) {
        const action = args[0]?.toLowerCase();
        
        if (!action || action === 'list') {
            return this.listTiers(message);
        }

        const boostData = this.storage.guild.get('boost', {});

        if (action === 'add' || action === 'edit') {
            const tierName = args[1];
            const requiredBoosts = parseInt(args[2]);
            const role = message.mentions.roles.first();
            
            if (!tierName || isNaN(requiredBoosts)) {
                return message.reply({
                    embeds: [{
                        title: '❌ Invalid Syntax',
                        description: 'Usage: `!boosttier add <name> <boosts> @role [+perk1 +perk2] [--custom-role] [--logo]`',
                        fields: [{ name: 'Example', value: '`!bt add Gold 5 @GoldRole +VIP +Lounge --custom-role`', inline: false }],
                        color: 0xe74c3c
                    }]
                });
            }

            const hasCustomRole = args.includes('--custom-role');
            const hasLogo = args.includes('--logo');
            const perks = args.filter(arg => arg.startsWith('+')).map(p => p.substring(1));

            const tierData = {
                name: tierName,
                requiredBoosts: requiredBoosts,
                role: role?.id || null,
                perks: perks,
                customRoleAllowed: hasCustomRole,
                logoAllowed: hasLogo,
                createdAt: new Date().toISOString(),
                createdBy: message.author.id
            };

            this.storage.guild.set(`boost.tiers.${tierName}`, tierData);
            
            return message.reply({
                embeds: [{
                    title: '✅ Tier Configured',
                    description: `Tier **${tierName}** has been successfully set up!`,
                    color: 0x2ecc71,
                    fields: [
                        { name: '📊 Required Boosts', value: requiredBoosts.toString(), inline: true },
                        { name: '🏷️ Role', value: role?.toString() || 'None', inline: true },
                        { name: '🎨 Custom Role', value: hasCustomRole ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: '🖼️ Logo', value: hasLogo ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: '✨ Perks', value: perks.length > 0 ? perks.map(p => `• ${p}`).join('\n') : 'None configured', inline: false }
                    ],
                    timestamp: new Date()
                }]
            });
        }

        if (action === 'remove') {
            const tierName = args[1];
            const tier = boostData.tiers?.[tierName];
            if (!tier) {
                return message.reply({
                    embeds: [{
                        title: '❌ Tier Not Found',
                        description: `Tier **${tierName}** doesn't exist.`,
                        color: 0xe74c3c
                    }]
                });
            }
            
            const tiers = { ...boostData.tiers };
            delete tiers[tierName];
            this.storage.guild.set('boost.tiers', tiers);
            
            return message.reply({
                embeds: [{
                    title: '✅ Tier Removed',
                    description: `Tier **${tierName}** has been deleted.`,
                    color: 0x2ecc71,
                    timestamp: new Date()
                }]
            });
        }

        if (action === 'view') {
            const tierName = args[1];
            const tier = boostData.tiers?.[tierName];
            if (!tier) {
                return message.reply({
                    embeds: [{
                        title: '❌ Tier Not Found',
                        description: `Tier **${tierName}** doesn't exist.`,
                        color: 0xe74c3c
                    }]
                });
            }
            
            const role = message.guild.roles.cache.get(tier.role);
            
            return message.reply({
                embeds: [{
                    title: `📊 Tier: ${tierName}`,
                    color: role?.color || 0x3498db,
                    fields: [
                        { name: '📊 Required Boosts', value: tier.requiredBoosts.toString(), inline: true },
                        { name: '🏷️ Role', value: role?.toString() || 'None (role deleted)', inline: true },
                        { name: '🎨 Custom Role', value: tier.customRoleAllowed ? '✅ Yes' : '❌ No', inline: true },
                        { name: '🖼️ Logo Allowed', value: tier.logoAllowed ? '✅ Yes' : '❌ No', inline: true },
                        { name: '✨ Perks', value: tier.perks?.map(p => `• ${p}`).join('\n') || 'None', inline: false },
                        { name: '📅 Created', value: `<t:${Math.floor(new Date(tier.createdAt).getTime() / 1000)}:R>`, inline: true }
                    ],
                    timestamp: new Date()
                }]
            });
        }
    }

    async handleNotificationCommand(message, args) {
        const boostData = this.storage.guild.get('boost', {});
        
        if (args[0] === 'toggle') {
            const current = boostData.notifications?.enabled ?? true;
            this.storage.guild.set('boost.notifications.enabled', !current);
            return message.reply({
                embeds: [{
                    title: !current ? '🔔 Notifications Enabled' : '🔕 Notifications Disabled',
                    description: `Boost notifications are now **${!current ? 'ON' : 'OFF'}**`,
                    color: !current ? 0x2ecc71 : 0xe74c3c,
                    timestamp: new Date()
                }]
            });
        }

        if (args[0] === 'test') {
            const testEmbed = {
                title: '🎉 Server Boosted! (Test)',
                description: (boostData.notifications?.message || '🎉 **{user}** boosted!')
                    .replace('{user}', message.author.toString())
                    .replace('{tier}', 'Test Tier')
                    .replace('{count}', '5'),
                color: 0xf47fff,
                thumbnail: { url: message.author.displayAvatarURL({ dynamic: true }) },
                fields: [
                    { name: '👤 Booster', value: message.author.toString(), inline: true },
                    { name: '📊 Total Boosts', value: '5 (test)', inline: true },
                    { name: '🏆 Tier', value: 'Test Tier', inline: true }
                ],
                footer: { text: 'Test notification • ' + new Date().toLocaleTimeString() },
                timestamp: new Date()
            };
            return message.reply({ embeds: [testEmbed] });
        }

        return message.reply({
            embeds: [{
                title: '🔔 Notification Settings',
                description: 'Manage boost notifications',
                color: 0x3498db,
                fields: [
                    { name: 'Commands', value: '`!boostnotif toggle` - Enable/disable\n`!boostnotif test` - Send test', inline: false },
                    { name: 'Current Status', value: boostData.notifications?.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                    { name: 'Channel', value: boostData.notifications?.channel ? `<#${boostData.notifications.channel}>` : 'Not set', inline: true }
                ]
            }]
        });
    }

    async handleColorsCommand(message, args) {
        const action = args[0]?.toLowerCase();
        const boostData = this.storage.guild.get('boost', {});
        const colors = boostData.colors || [];
        
        if (action === 'list') {
            if (colors.length === 0) {
                return message.reply({
                    embeds: [{
                        title: '🎨 Booster Colors',
                        description: 'No special colors configured yet.\nUse `!boostcolors add @role` to add some!',
                        color: 0x95a5a6
                    }]
                });
            }
            
            const list = colors.map((id, index) => {
                const role = message.guild.roles.cache.get(id);
                return `${index + 1}. ${role?.toString() || '⚠️ Deleted'} ${role?.hexColor || ''}`;
            }).join('\n');
            
            return message.reply({
                embeds: [{ 
                    title: '🎨 Booster Colors', 
                    description: list + `\n\nBoosters can use \`!boostcolor <number>\` to select`, 
                    color: 0x3498db,
                    footer: { text: `${colors.length} color(s) available` }
                }]
            });
        }

        if (action === 'add') {
            const role = message.mentions.roles.first();
            if (!role) {
                return message.reply({
                    embeds: [{
                        title: '❌ No Role Mentioned',
                        description: 'Please mention a color role.\nExample: `!boostcolors add @Red`',
                        color: 0xe74c3c
                    }]
                });
            }
            
            if (!colors.includes(role.id)) {
                colors.push(role.id);
                this.storage.guild.set('boost.colors', colors);
            }
            
            return message.reply({
                embeds: [{
                    title: '✅ Color Added',
                    description: `${role.toString()} has been added as a booster color option.`,
                    color: role.color || 0x2ecc71,
                    fields: [
                        { name: 'Color', value: role.hexColor || 'Default', inline: true },
                        { name: 'Position', value: (colors.length).toString(), inline: true }
                    ]
                }]
            });
        }

        if (action === 'remove') {
            const role = message.mentions.roles.first();
            const id = role?.id || args[1];
            const newColors = colors.filter(c => c !== id);
            this.storage.guild.set('boost.colors', newColors);
            
            return message.reply({
                embeds: [{
                    title: '✅ Color Removed',
                    description: role ? `${role.toString()} removed.` : 'Color option removed.',
                    color: 0xe74c3c
                }]
            });
        }
    }

    // ==================== PUBLIC COMMANDS WITH EMBEDS ====================

    async handleClaim(message) {
        if (!message.member.premiumSince) {
            return message.reply({
                embeds: [{
                    title: '❌ Booster Only',
                    description: 'This command is only for **Nitro Boosters**!\nBoost the server to unlock exclusive perks.',
                    color: 0xe74c3c,
                    thumbnail: { url: 'https://cdn.discordapp.com/emojis/638138543965315092.png' }
                }]
            });
        }

        const boostData = this.storage.guild.get('boost', {});
        const boostCount = await this.getBoostCount(message.guild);
        const tier = this.getTierByBoosts(boostCount);
        
        if (!tier.name || tier.name === 'None') {
            return message.reply({
                embeds: [{
                    title: '⚠️ No Tiers Configured',
                    description: 'Ask an admin to set up boost tiers first!\nThey can use `!boosttier add` to create tiers.',
                    color: 0xf39c12
                }]
            });
        }

        const userData = boostData.claimedPerks?.[message.author.id];

        if (userData?.tier === tier.name && userData?.claimedAt) {
            return message.reply({
                embeds: [{
                    title: '✅ Already Claimed',
                    description: `You've already claimed your **${tier.name}** perks!`,
                    color: 0x3498db,
                    fields: [
                        { name: 'Claimed At', value: `<t:${Math.floor(new Date(userData.claimedAt).getTime() / 1000)}:R>`, inline: true },
                        { name: 'Current Tier', value: tier.name, inline: true }
                    ],
                    footer: { text: 'Use !perks to see what you have' }
                }]
            });
        }

        const newData = {
            userId: message.author.id,
            tier: tier.name,
            boostCount: boostCount,
            claimedAt: new Date().toISOString(),
            perks: tier.perks || [],
            guildId: message.guild.id
        };

        this.storage.guild.set(`boost.claimedPerks.${message.author.id}`, newData);

        if (tier.role) {
            await message.member.roles.add(tier.role).catch(() => {});
        }

        const stats = boostData.stats || { totalBoosts: 0, currentBoosters: 0, history: [] };
        stats.history.push({
            userId: message.author.id,
            action: 'claim',
            tier: tier.name,
            timestamp: new Date().toISOString()
        });
        this.storage.guild.set('boost.stats', stats);

        const embed = {
            title: '🎉 Perks Claimed!',
            description: `**${message.author.username}** has claimed **${tier.name}** perks!`,
            color: 0xf47fff,
            thumbnail: { url: message.author.displayAvatarURL({ dynamic: true }) },
            fields: [
                { name: '🏆 Tier', value: tier.name, inline: true },
                { name: '📊 Server Boosts', value: `${boostCount} ${this.getBoostEmoji(boostCount)}`, inline: true },
                { name: '✨ Perks Unlocked', value: tier.perks?.map(p => `• ${p}`).join('\n') || 'None configured', inline: false }
            ],
            footer: { text: 'Thank you for boosting! 💎' },
            timestamp: new Date()
        };

        message.reply({ embeds: [embed] });

        if (boostData.notifications?.channel) {
            const channel = message.guild.channels.cache.get(boostData.notifications.channel);
            if (channel) channel.send({ embeds: [embed] }).catch(() => {});
        }
    }

    async handleStatus(message) {
        const member = message.member;
        const isBooster = !!member.premiumSince;
        
        if (!isBooster) {
            return message.reply({
                embeds: [{
                    title: '💎 Boost Status',
                    description: 'You are not currently boosting this server.\n\n**Boost to unlock:**\n• Exclusive roles\n• Custom colors\n• Special perks\n• Custom role creation',
                    color: 0x95a5a6,
                    thumbnail: { url: 'https://cdn.discordapp.com/emojis/638138543965315092.png' }
                }]
            });
        }

        const boostData = this.storage.guild.get('boost', {});
        const userData = boostData.claimedPerks?.[member.id];
        const boostCount = await this.getBoostCount(message.guild);
        const currentTier = userData?.tier || 'None';
        const nextTier = this.getNextTier(currentTier);

        const fields = [
            { name: '💎 Status', value: '🟢 Active Booster', inline: true },
            { name: '📅 Boosting Since', value: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`, inline: true },
            { name: '🏆 Current Tier', value: currentTier, inline: true },
            { name: '📊 Server Boosts', value: `${boostCount} ${this.getBoostEmoji(boostCount)}`, inline: true }
        ];

        if (userData?.perks?.length > 0) {
            fields.push({ name: '✨ Your Perks', value: userData.perks.map(p => `• ${p}`).join('\n'), inline: false });
        }

        if (nextTier) {
            const remaining = nextTier.requiredBoosts - boostCount;
            fields.push({ 
                name: '⬆️ Next Tier', 
                value: `**${nextTier.name}** (${remaining > 0 ? remaining + ' more boosts needed' : 'Available now!'})`, 
                inline: false 
            });
        }

        const customRole = boostData.customRoles?.[member.id];
        if (customRole) {
            const role = message.guild.roles.cache.get(customRole.roleId);
            fields.push({ name: '🎨 Custom Role', value: role?.toString() || '⚠️ Deleted', inline: true });
        }

        const colorRoles = boostData.colors || [];
        const currentColor = member.roles.cache.find(r => colorRoles.includes(r.id));
        if (currentColor) {
            fields.push({ name: '🌈 Color', value: currentColor.toString(), inline: true });
        }

        const embed = {
            title: '💎 Your Boost Status',
            color: 0xf47fff,
            fields: fields,
            thumbnail: { url: member.user.displayAvatarURL({ dynamic: true }) },
            footer: { text: 'Use !perks to see all available tiers' },
            timestamp: new Date()
        };

        message.reply({ embeds: [embed] });
    }

    async handleCustomRole(message, args) {
        const member = message.member;
        if (!member.premiumSince) {
            return message.reply({
                embeds: [{
                    title: '❌ Booster Only',
                    description: 'This command is for **Nitro Boosters** only!',
                    color: 0xe74c3c
                }]
            });
        }

        const boostData = this.storage.guild.get('boost', {});
        const boostCount = await this.getBoostCount(message.guild);
        const tier = this.getTierByBoosts(boostCount);
        
        if (!tier.customRoleAllowed) {
            return message.reply({
                embeds: [{
                    title: '🔒 Tier Too Low',
                    description: `Your current tier (**${tier.name}**) doesn't include custom role perks.`,
                    color: 0xf39c12,
                    fields: [{ name: 'Required', value: 'Higher tier with `--custom-role` flag', inline: false }]
                }]
            });
        }

        const action = args[0]?.toLowerCase();
        const existing = boostData.customRoles?.[member.id];

        if (action === 'create' || action === 'set') {
            if (existing) {
                return message.reply({
                    embeds: [{
                        title: '⚠️ Already Exists',
                        description: 'You already have a custom role!\nUse `!customrole edit` to modify it.',
                        color: 0xf39c12
                    }]
                });
            }

            const name = args.slice(1).join(' ');
            if (!name || name.length > 100) {
                return message.reply({
                    embeds: [{
                        title: '❌ Invalid Name',
                        description: 'Please provide a valid role name (max 100 characters).',
                        color: 0xe74c3c
                    }]
                });
            }

            try {
                const botMember = message.guild.members.me;
                const position = botMember.roles.highest.position > 0 ? botMember.roles.highest.position - 1 : 1;
                
                const role = await message.guild.roles.create({
                    name: name,
                    color: 0x99aab5,
                    reason: `Custom role for booster ${member.user.tag}`,
                    position: position
                });

                await member.roles.add(role);

                this.storage.guild.set(`boost.customRoles.${member.id}`, {
                    roleId: role.id,
                    createdAt: new Date().toISOString(),
                    name: name,
                    createdBy: member.id
                });

                return message.reply({
                    embeds: [{
                        title: '✅ Custom Role Created',
                        description: `Your custom role ${role.toString()} has been created!`,
                        color: 0x2ecc71,
                        fields: [
                            { name: 'Default Color', value: '#99AAB5 (change with `!cr edit color`)', inline: true },
                            { name: 'Position', value: `Below ${botMember.roles.highest.name}`, inline: true }
                        ],
                        footer: { text: 'Use !customrole edit to customize further' }
                    }]
                });
            } catch (error) {
                return message.reply({
                    embeds: [{
                        title: '❌ Creation Failed',
                        description: `Failed to create role: ${error.message}`,
                        color: 0xe74c3c
                    }]
                });
            }
        }

        if (action === 'edit') {
            if (!existing) {
                return message.reply({
                    embeds: [{
                        title: '❌ No Custom Role',
                        description: 'You don\'t have a custom role yet.\nUse `!customrole create <name>` to make one!',
                        color: 0xe74c3c
                    }]
                });
            }
            
            const subAction = args[1]?.toLowerCase();
            const role = message.guild.roles.cache.get(existing.roleId);
            
            if (!role) {
                const customRoles = { ...boostData.customRoles };
                delete customRoles[member.id];
                this.storage.guild.set('boost.customRoles', customRoles);
                return message.reply({
                    embeds: [{
                        title: '⚠️ Role Deleted',
                        description: 'Your custom role was deleted externally.\nCreate a new one with `!customrole create`',
                        color: 0xf39c12
                    }]
                });
            }

            if (subAction === 'name') {
                const newName = args.slice(2).join(' ');
                if (!newName) {
                    return message.reply({
                        embeds: [{
                            title: '❌ Missing Name',
                            description: 'Provide a new name: `!customrole edit name Cool Booster`',
                            color: 0xe74c3c
                        }]
                    });
                }
                await role.setName(newName);
                this.storage.guild.set(`boost.customRoles.${member.id}.name`, newName);
                return message.reply({
                    embeds: [{
                        title: '✅ Name Updated',
                        description: `Role renamed to **${newName}**`,
                        color: 0x2ecc71
                    }]
                });
            }

            if (subAction === 'color') {
                const color = args[2];
                if (!color || !/^#[0-9A-F]{6}$/i.test(color)) {
                    return message.reply({
                        embeds: [{
                            title: '❌ Invalid Color',
                            description: 'Provide a valid hex color code.\nExamples: `#FF5733`, `#3498DB`, `#2ECC71`',
                            color: 0xe74c3c
                        }]
                    });
                }
                await role.setColor(color);
                return message.reply({
                    embeds: [{
                        title: '✅ Color Updated',
                        description: `Role color changed to ${color}`,
                        color: parseInt(color.replace('#', ''), 16)
                    }]
                });
            }

            if (subAction === 'icon' || subAction === 'logo') {
                if (!tier.logoAllowed) {
                    return message.reply({
                        embeds: [{
                            title: '🔒 Feature Locked',
                            description: 'Your tier doesn\'t allow role icons.\nServer needs higher boost level!',
                            color: 0xf39c12
                        }]
                    });
                }
                return message.reply({
                    embeds: [{
                        title: '🖼️ Role Icon',
                        description: 'Role icons require Server Boost Level 2+.\nContact an admin to upload an icon for you.',
                        color: 0x3498db
                    }]
                });
            }

            return message.reply({
                embeds: [{
                    title: '❓ Edit Options',
                    description: 'What would you like to edit?',
                    color: 0x3498db,
                    fields: [
                        { name: 'Name', value: '`!customrole edit name <newname>`', inline: true },
                        { name: 'Color', value: '`!customrole edit color <#hex>`', inline: true }
                    ]
                }]
            });
        }

        if (action === 'delete') {
            if (!existing) {
                return message.reply({
                    embeds: [{
                        title: '❌ No Role',
                        description: 'You don\'t have a custom role to delete.',
                        color: 0xe74c3c
                    }]
                });
            }
            
            const role = message.guild.roles.cache.get(existing.roleId);
            if (role) await role.delete('Booster requested deletion').catch(() => {});
            
            const customRoles = { ...boostData.customRoles };
            delete customRoles[member.id];
            this.storage.guild.set('boost.customRoles', customRoles);
            
            return message.reply({
                embeds: [{
                    title: '🗑️ Role Deleted',
                    description: 'Your custom role has been deleted.',
                    color: 0xe74c3c
                }]
            });
        }

        return message.reply({
            embeds: [{
                title: '🎨 Custom Role Commands',
                description: 'Manage your personal booster role',
                color: 0x2ecc71,
                fields: [
                    { name: 'Create', value: '`!customrole create <name>`', inline: true },
                    { name: 'Edit', value: '`!customrole edit name/color <value>`', inline: true },
                    { name: 'Delete', value: '`!customrole delete`', inline: true }
                ]
            }]
        });
    }

    async handleColorSelect(message, args) {
        const member = message.member;
        if (!member.premiumSince) {
            return message.reply({
                embeds: [{
                    title: '❌ Booster Only',
                    description: 'This command is for **Nitro Boosters** only!',
                    color: 0xe74c3c
                }]
            });
        }

        const boostData = this.storage.guild.get('boost', {});
        const availableColors = boostData.colors || [];
        
        if (availableColors.length === 0) {
            return message.reply({
                embeds: [{
                    title: '⚠️ No Colors',
                    description: 'No special colors are configured yet.\nAsk an admin to add some with `!boostcolors add @role`',
                    color: 0xf39c12
                }]
            });
        }

        const colorArg = args[0];
        if (!colorArg) {
            const list = availableColors.map((id, index) => {
                const role = message.guild.roles.cache.get(id);
                const hasRole = member.roles.cache.has(id) ? ' ✅' : '';
                return `${index + 1}. ${role?.toString() || 'Unknown'} ${role?.hexColor || ''}${hasRole}`;
            }).join('\n');

            return message.reply({
                embeds: [{
                    title: '🎨 Available Booster Colors',
                    description: list + '\n\nUse `!boostcolor <number>` to select',
                    color: 0x3498db,
                    footer: { text: 'You can only have one color at a time' }
                }]
            });
        }

        const index = parseInt(colorArg) - 1;
        if (isNaN(index) || index < 0 || index >= availableColors.length) {
            return message.reply({
                embeds: [{
                    title: '❌ Invalid Selection',
                    description: `Please choose a number between 1 and ${availableColors.length}`,
                    color: 0xe74c3c
                }]
            });
        }

        const selectedRoleId = availableColors[index];
        const selectedRole = message.guild.roles.cache.get(selectedRoleId);
        
        if (!selectedRole) {
            const newColors = availableColors.filter((_, i) => i !== index);
            this.storage.guild.set('boost.colors', newColors);
            return message.reply({
                embeds: [{
                    title: '⚠️ Role Deleted',
                    description: 'That color role no longer exists. It has been removed from the list.',
                    color: 0xf39c12
                }]
            });
        }

        const currentColors = member.roles.cache.filter(r => availableColors.includes(r.id));
        for (const [, role] of currentColors) {
            await member.roles.remove(role).catch(() => {});
        }

        await member.roles.add(selectedRole);
        
        return message.reply({
            embeds: [{
                title: '✅ Color Updated',
                description: `Your color has been changed to ${selectedRole.toString()}`,
                color: selectedRole.color || 0x2ecc71
            }]
        });
    }

    async handlePerksList(message) {
        const boostData = this.storage.guild.get('boost', {});
        const tiers = Object.values(boostData.tiers || {});
        
        if (tiers.length === 0) {
            return message.reply({
                embeds: [{
                    title: '⚠️ No Tiers',
                    description: 'No boost tiers configured yet.\nAsk an admin to set them up with `!boosttier add`',
                    color: 0xf39c12
                }]
            });
        }

        const boostCount = await this.getBoostCount(message.guild);
        
        const fields = tiers.sort((a, b) => a.requiredBoosts - b.requiredBoosts).map(tier => {
            const isActive = boostCount >= tier.requiredBoosts;
            const isClaimed = boostData.claimedPerks?.[message.author.id]?.tier === tier.name;
            const status = isClaimed ? '✅ Claimed' : (isActive ? '🟢 Available' : '🔒 Locked');
            const perks = tier.perks?.map(p => `• ${p}`).join('\n') || 'No perks listed';
            const role = message.guild.roles.cache.get(tier.role);
            
            return {
                name: `${status} ${tier.name} (${tier.requiredBoosts} boosts)`,
                value: [
                    role ? `🏷️ ${role.toString()}` : '🏷️ No role',
                    `🎨 Custom: ${tier.customRoleAllowed ? '✅' : '❌'} | 🖼️ Logo: ${tier.logoAllowed ? '✅' : '❌'}`,
                    `✨ Perks:\n${perks}`
                ].join('\n'),
                inline: false
            };
        });

        const embed = {
            title: `💎 Server Boost Perks ${this.getBoostEmoji(boostCount)}`,
            description: `Current server boosts: **${boostCount}**\nUse \`!claim\` to claim your available perks!`,
            color: 0xf47fff,
            fields: fields,
            thumbnail: { url: message.guild.iconURL({ dynamic: true }) || undefined },
            footer: { text: 'Boost the server to unlock exclusive rewards!' },
            timestamp: new Date()
        };

        message.reply({ embeds: [embed] });
    }

    // ==================== UTILITY METHODS ====================

    async notifyCustomRoleAvailable(member) {
        try {
            const dm = await member.createDM();
            await dm.send({
                embeds: [{
                    title: '🎨 Custom Role Available!',
                    description: `You've unlocked a custom role perk in **${member.guild.name}**! Use \`!customrole create <name>\` in the server to create your personal role.`,
                    color: 0xf47fff,
                    footer: { text: member.guild.name }
                }]
            });
        } catch (error) {
            // DM failed, ignore
        }
    }

    hasCustomRole(userId) {
        const boostData = this.storage.guild.get('boost', {});
        return !!boostData.customRoles?.[userId];
    }

    getNextTier(currentTierName) {
        const boostData = this.storage.guild.get('boost', {});
        const tiers = Object.values(boostData.tiers || {});
        const sorted = tiers.sort((a, b) => a.requiredBoosts - b.requiredBoosts);
        
        const currentIndex = sorted.findIndex(t => t.name === currentTierName);
        return sorted[currentIndex + 1] || null;
    }

    isAdmin(message) {
        if (message.author.id === this.config.ownerId) return true;
        if (message.member.permissions.has('Administrator')) return true;
        return false;
    }

    listTiers(message) {
        const boostData = this.storage.guild.get('boost', {});
        const tiers = Object.values(boostData.tiers || {});
        
        if (tiers.length === 0) {
            return message.reply({
                embeds: [{
                    title: '📊 Boost Tiers',
                    description: 'No tiers configured yet.\nUse `!boosttier add <name> <boosts> @role` to create one.',
                    color: 0x95a5a6
                }]
            });
        }

        const list = tiers.map(t => {
            const role = message.guild.roles.cache.get(t.role);
            return `**${t.name}** (${t.requiredBoosts} boosts)\n${role ? role.toString() : '⚠️ No role'} | 🎨 ${t.customRoleAllowed ? '✅' : '❌'} | 🖼️ ${t.logoAllowed ? '✅' : '❌'}`;
        }).join('\n\n');

        message.reply({
            embeds: [{
                title: '📊 Boost Tiers',
                description: list,
                color: 0x3498db,
                footer: { text: `${tiers.length} tier(s) configured` },
                timestamp: new Date()
            }]
        });
    }

    sendSetupStatus(message) {
        const boostData = this.storage.guild.get('boost', {});
        const tierCount = Object.keys(boostData.tiers || {}).length;
        const colorCount = (boostData.colors || []).length;
        const claimedCount = Object.keys(boostData.claimedPerks || {}).length;
        
        const embed = {
            title: '⚙️ Boost System Status',
            color: boostData.enabled ? 0x2ecc71 : 0xe74c3c,
            fields: [
                { name: '🔌 System', value: boostData.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: '🔔 Notifications', value: boostData.notifications?.enabled ? '✅ On' : '❌ Off', inline: true },
                { name: '📢 Channel', value: boostData.notifications?.channel ? `<#${boostData.notifications.channel}>` : '❌ Not set', inline: true },
                { name: '📊 Tiers', value: tierCount.toString(), inline: true },
                { name: '🎨 Colors', value: colorCount.toString(), inline: true },
                { name: '👥 Claimed', value: claimedCount.toString(), inline: true }
            ],
            timestamp: new Date()
        };
        message.reply({ embeds: [embed] });
    }

    getSetupHelpEmbed() {
        const prefix = this.config.prefix;
        return {
            embeds: [{
                title: '💎 Boost Setup Help',
                description: 'Configure the boost reward system',
                color: 0xf47fff,
                fields: [
                    {
                        name: 'System Settings',
                        value: [
                            `\`${prefix}bs toggle\` - Enable/disable system`,
                            `\`${prefix}bs channel #channel\` - Set notification channel`,
                            `\`${prefix}bs message <text>\` - Set boost message ({user}, {tier}, {count})`,
                            `\`${prefix}bs status\` - View configuration`,
                            `\`${prefix}bs reset\` - Reset all data (dangerous!)`
                        ].join('\n')
                    },
                    {
                        name: 'Tier Management',
                        value: [
                            `\`${prefix}bt list\` - Show all tiers`,
                            `\`${prefix}bt add <name> <boosts> @role +perk1 +perk2 --custom-role --logo\``,
                            `\`${prefix}bt remove <name>\` - Delete a tier`,
                            `\`${prefix}bt view <name>\` - View tier details`
                        ].join('\n')
                    },
                    {
                        name: 'Color Roles',
                        value: [
                            `\`${prefix}bc list\` - Show available colors`,
                            `\`${prefix}bc add @role\` - Add color option`,
                            `\`${prefix}bc remove @role/id\` - Remove color`
                        ].join('\n')
                    }
                ],
                footer: { text: 'Admin only commands' }
            }]
        };
    }

    async onGuildBoostAdd(guild, user) {
        const boostData = this.storage.guild.get('boost', {});
        if (!boostData.enabled || !boostData.notifications?.enabled) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        const boostCount = await this.getBoostCount(guild);
        const tier = this.getTierByBoosts(boostCount);

        const stats = boostData.stats || { totalBoosts: 0, currentBoosters: 0, history: [] };
        stats.totalBoosts = (stats.totalBoosts || 0) + 1;
        stats.history.push({
            userId: user.id,
            action: 'boost',
            timestamp: new Date().toISOString(),
            tier: tier.name
        });
        this.storage.guild.set('boost.stats', stats);

        const channel = guild.channels.cache.get(boostData.notifications.channel);
        if (channel) {
            const embed = {
                title: '🎉 New Server Boost!',
                description: boostData.notifications.message
                    .replace('{user}', user.toString())
                    .replace('{tier}', tier.name)
                    .replace('{count}', boostCount),
                color: 0xf47fff,
                thumbnail: { url: user.displayAvatarURL({ dynamic: true }) },
                fields: [
                    { name: '👤 Booster', value: user.toString(), inline: true },
                    { name: '📊 Total Boosts', value: `${boostCount} ${this.getBoostEmoji(boostCount)}`, inline: true },
                    { name: '🏆 Tier Unlocked', value: tier.name, inline: true },
                    { name: '✨ Perks', value: tier.perks?.map(p => `• ${p}`).join('\n') || 'None configured', inline: false }
                ],
                footer: { text: 'Thank you for boosting! 💎' },
                timestamp: new Date()
            };
            channel.send({ embeds: [embed] }).catch(() => {});
        }

        await this.checkBoostStatus(member);
    }

    async onGuildBoostRemove(guild, user) {
        const boostData = this.storage.guild.get('boost', {});
        if (!boostData.enabled) return;

        const stats = boostData.stats || { totalBoosts: 0, currentBoosters: 0, history: [] };
        stats.history.push({
            userId: user.id,
            action: 'unboost',
            timestamp: new Date().toISOString()
        });
        this.storage.guild.set('boost.stats', stats);

        const boostCount = await this.getBoostCount(guild);

        if (boostData.notifications?.channel) {
            const channel = guild.channels.cache.get(boostData.notifications.channel);
            if (channel) {
                channel.send({
                    embeds: [{
                        title: '💨 Boost Removed',
                        description: `${user.toString()} removed their boost.`,
                        color: 0xe74c3c,
                        fields: [
                            { name: '📊 New Total', value: `${boostCount} boosts`, inline: true },
                            { name: '⬇️ Tier Change', value: 'May affect current tier perks', inline: true }
                        ],
                        timestamp: new Date()
                    }]
                }).catch(() => {});
            }
        }
    }

        destroy() {
        console.log(`[${this.name}] Module unloaded`);
    }
}

module.exports = BoostModule;

