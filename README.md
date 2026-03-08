
# EGO
EGO is a high-performance, community-driven All-In-One Discord bot framework built by Vermeil and Luna. Designed with a "plug-and-play" philosophy, EGO allows you to extend its functionality infinitely just by dropping a single file into a folder

## 🧩 The Core Philosophy
Unlike monolithic bots where you have to navigate thousands of lines of code to add a feature, EGO uses a Class-Based Module System.
How it Works:
 * Navigate to the /modules directory.
 * Create a new .js file (e.g., moderation.js).
 * Paste the EGO module class structure.
 * EGO automatically detects, instantiates, and wires up the events for you.
💻 Module Boilerplate
Every feature in EGO follows this standard structure. You have access to the full Discord client and a suite of lifecycle hooks.



//modules/myfeatures.js
```
class MyFeature {
    constructor(client) {
        this.client = client;
    }
    
    init() {
        // Runs once when the bot boots up or the module is loaded
        console.log("MyFeature is online!");
    }
    
    onCommand(command, args, message) {
        // Handle prefix-based commands here
        if (command === 'hello') {
            message.reply('World!');
        }
    }

    destroy() {
        // Cleanup code (e.g., clearing intervals) for hot-reloading
    }
}

module.exports = MyFeature;
```

## 🛠️ Available Event Hooks

EGO maps Discord events directly to your module methods. Here is the full list of supported hooks you can use in your class:
| Category | Hook Method | Description |
|---|---|---|
| Messaging | onMessage | Fires on every message sent. |
|  | onCommand | Fires when a prefix command is detected. |
|  | onMessageDelete | Fires when a message is removed. |
| Interactions | onSlashCommand | Handles registered / commands. |
|  | onButton / onModal | Handles UI component interactions. |
| Guild Events | onMemberJoin | Welcome new users. |
|  | onVoiceUpdate | Monitor VC movement/streaming. |

