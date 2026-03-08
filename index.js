/**
 * EGO BOT - Main Entry Point
 * A modular Discord bot for single-server management
 * Version: 1.0.0
 */

const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ==================== STORAGE SYSTEM ====================

class JSONStorage {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = {};
        this.ensureFile();
        this.load();
    }

    ensureFile() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify({}, null, 2));
        }
    }

    load() {
        try {
            const content = fs.readFileSync(this.filePath, 'utf8');
            this.data = JSON.parse(content);
        } catch (error) {
            console.error(`[Storage] Error loading ${this.filePath}:`, error);
            this.data = {};
        }
    }

    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
            return true;
        } catch (error) {
            console.error(`[Storage] Error saving ${this.filePath}:`, error);
            return false;
        }
    }

    get(key, defaultValue = null) {
        return key.split('.').reduce((obj, k) => obj?.[k], this.data) ?? defaultValue;
    }

    set(key, value) {
        const keys = key.split('.');
        let current = this.data;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in current)) current[keys[i]] = {};
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
        return this.save();
    }

    delete(key) {
        const keys = key.split('.');
        let current = this.data;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in current)) return false;
            current = current[keys[i]];
        }
        delete current[keys[keys.length - 1]];
        return this.save();
    }

    push(key, value) {
        const arr = this.get(key, []);
        if (!Array.isArray(arr)) throw new Error('Target is not an array');
        arr.push(value);
        return this.set(key, arr);
    }

    getAll() {
        return { ...this.data };
    }

    setAll(data) {
        this.data = data;
        return this.save();
    }
}

// ==================== MODULE SYSTEM ====================

class ModuleManager {
    constructor(client) {
        this.client = client;
        this.modules = new Collection();
        this.modulePath = path.resolve(config.modules.path);
    }

    async loadAll() {
        console.log('[Modules] Loading modules...');
        
        if (!fs.existsSync(this.modulePath)) {
            fs.mkdirSync(this.modulePath, { recursive: true });
            console.log('[Modules] Created modules directory');
            return;
        }

        const files = fs.readdirSync(this.modulePath).filter(file => file.endsWith('.js'));
        
        for (const file of files) {
            await this.load(file);
        }

        console.log(`[Modules] Loaded ${this.modules.size} module(s)`);
    }

    async load(filename) {
        try {
            const filePath = path.join(this.modulePath, filename);
            delete require.cache[require.resolve(filePath)];
            
            const ModuleClass = require(filePath);
            const instance = new ModuleClass(this.client);
            
            const moduleName = filename.replace('.js', '');
            this.modules.set(moduleName, instance);
            
            // Initialize if init method exists
            if (typeof instance.init === 'function') {
                await instance.init();
            }
            
            console.log(`[Modules] ✓ Loaded: ${moduleName}`);
            return instance;
        } catch (error) {
            console.error(`[Modules] ✗ Failed to load ${filename}:`, error.message);
            return null;
        }
    }

    unload(filename) {
        const moduleName = filename.replace('.js', '');
        const module = this.modules.get(moduleName);
        
        if (module && typeof module.destroy === 'function') {
            module.destroy();
        }
        
        this.modules.delete(moduleName);
        console.log(`[Modules] Unloaded: ${moduleName}`);
    }

    reload(filename) {
        this.unload(filename);
        return this.load(filename);
    }

    get(name) {
        return this.modules.get(name);
    }

    broadcast(event, ...args) {
        for (const [name, module] of this.modules) {
            if (typeof module[event] === 'function') {
                try {
                    module[event](...args);
                } catch (error) {
                    console.error(`[Modules] Error in ${name}.${event}:`, error);
                }
            }
        }
    }
}

// ==================== BOT INITIALIZATION ====================

class EgoBot {
    constructor() {
        this.config = config;
        this.storage = {};
        this.modules = null;
        
        // Initialize Discord Client with all intents
        this.client = new Client({
            intents: Object.values(GatewayIntentBits).filter(x => typeof x === 'number'),
            partials: ['CHANNEL', 'MESSAGE', 'REACTION', 'USER', 'GUILD_MEMBER']
        });

        // Initialize storage
        this.initStorage();
        
        // Bind events
        this.bindEvents();
    }

    initStorage() {
        console.log('[Storage] Initializing databases...');
        for (const [name, filePath] of Object.entries(config.database)) {
            this.storage[name] = new JSONStorage(filePath);
            console.log(`[Storage] ✓ ${name}: ${filePath}`);
        }
    }

    bindEvents() {
        // Ready event
        this.client.once(Events.ClientReady, async () => {
            console.log(`\n🤖 ${config.name} v${config.version} is online!`);
            console.log(`   Logged in as ${this.client.user.tag}`);
            console.log(`   Serving guild: ${config.guildId}`);
            console.log(`   Prefix: ${config.prefix}\n`);
            
            // Initialize module system
            this.modules = new ModuleManager(this.client);
            this.modules.client.storage = this.storage; // Inject storage
            this.modules.client.config = this.config;     // Inject config
            this.modules.client.modules = this.modules;   // ⬅️ ADD THIS LINE - Expose module manager to client

            await this.modules.loadAll();
            
            // Set bot activity
            this.client.user.setActivity(`${config.prefix}help | v${config.version}`, { type: 3 });
        });

        // Message handling for prefix commands
        this.client.on(Events.MessageCreate, async (message) => {
            if (message.author.bot) return;
            if (message.guild?.id !== config.guildId) return;
            
            // Broadcast to modules
            if (this.modules) {
                this.modules.broadcast('onMessage', message);
            }
            
            // Check for prefix
            if (!message.content.startsWith(config.prefix)) return;
            
            const args = message.content.slice(config.prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            
            if (this.modules) {
                this.modules.broadcast('onCommand', command, args, message);
            }
            // In onMessage, after command execution:
this.storage.settings.set('stats.totalCommands',  (this.storage.settings.get('stats.totalCommands', 0) + 1));
            
this.storage.settings.set('stats.messagesSeen',   (this.storage.settings.get('stats.messagesSeen', 0) + 1));

        });

        // Interaction handling (slash commands, buttons, etc.)
        this.client.on(Events.InteractionCreate, async (interaction) => {
            if (interaction.guild?.id !== config.guildId) return;
            
            if (this.modules) {
                if (interaction.isChatInputCommand()) {
                    this.modules.broadcast('onSlashCommand', interaction);
                } else if (interaction.isButton()) {
                    this.modules.broadcast('onButton', interaction);
                } else if (interaction.isSelectMenu?.()) {
                    this.modules.broadcast('onSelectMenu', interaction);
                } else if (interaction.isModalSubmit?.()) {
                    this.modules.broadcast('onModal', interaction);
                }
            }
        });

        // Member events
        this.client.on(Events.GuildMemberAdd, (member) => {
            if (member.guild.id !== config.guildId) return;
            if (this.modules) this.modules.broadcast('onMemberJoin', member);
        });

        this.client.on(Events.GuildMemberRemove, (member) => {
            if (member.guild.id !== config.guildId) return;
            if (this.modules) this.modules.broadcast('onMemberLeave', member);
        });

        // Message delete/edit logging
        this.client.on(Events.MessageDelete, (message) => {
            if (message.guild?.id !== config.guildId) return;
            if (this.modules) this.modules.broadcast('onMessageDelete', message);
        });

        this.client.on(Events.MessageUpdate, (oldMsg, newMsg) => {
            if (newMsg.guild?.id !== config.guildId) return;
            if (this.modules) this.modules.broadcast('onMessageEdit', oldMsg, newMsg);
        });

        // Reaction events
        this.client.on(Events.MessageReactionAdd, (reaction, user) => {
            if (reaction.message.guild?.id !== config.guildId) return;
            if (this.modules) this.modules.broadcast('onReactionAdd', reaction, user);
        });

        // Voice state updates
        this.client.on(Events.VoiceStateUpdate, (oldState, newState) => {
            if (oldState.guild.id !== config.guildId && newState.guild.id !== config.guildId) return;
            if (this.modules) this.modules.broadcast('onVoiceUpdate', oldState, newState);
        });

        // Error handling
        this.client.on(Events.Error, (error) => {
            console.error('[Discord] Client error:', error);
        });

        process.on('unhandledRejection', (error) => {
            console.error('[Process] Unhandled rejection:', error);
        });

        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }

    async start() {
        console.log(`\n🚀 Starting ${config.name}...`);
        await this.client.login(config.token);
    }

    shutdown() {
        console.log('\n🛑 Shutting down gracefully...');
        if (this.modules) {
            for (const [name, module] of this.modules.modules) {
                if (typeof module.destroy === 'function') {
                    module.destroy();
                }
            }
        }
        this.client.destroy();
        process.exit(0);
    }
}

// Start the bot
const bot = new EgoBot();
bot.start();
