# Discord Bot for Ark Spots

A Discord bot that integrates with your Ark spots database to provide cave and spot information via slash commands.

## Features

- `/caves` command to fetch all modded cave spots for a specific server and map
- `/update` command with subcommands to refresh cave spots (clears channel/thread and sends updated list)
  - `here`: Update this channel/thread using saved config or last header
  - `all`: Update all saved channels for the guild
 - `/populatethread` command to clear a target thread and populate all cave messages for a given server and map
### `/populatethread` Command

```
/populatethread server:<INX|Fusion|Mesa> forum_id:<Forum Channel ID>
```

Behavior:
- Fetches all modded cave spots for the specified server across ALL maps
- Creates a separate forum post for each map that has spots
- Each forum post is named `Server - Map` and contains all cave messages for that map
- Sends all cave messages with the same formatting/attachments used by `/caves`
- Processes all valid maps for the server automatically
- Requires Administrator permissions and Create Threads permission in the forum
- **Thread Support**: Both commands work in both text channels and threads
- Server and map header display
- Farm spots automatically sorted to the end
- Video file attachments support
- External video link handling
- Beautiful Discord formatting with spot information
- Grouped by spot type (cave, regular, underworld, etc.)
- Coordinates and cave damage information
- Integration with your existing API
- Admin-only command access

## Setup Instructions

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Give it a name (e.g., "Ark Spots Bot")
4. Go to the "Bot" section
5. Click "Add Bot"
6. Copy the bot token (you'll need this later)
7. Enable the following Privileged Gateway Intents:
   - Message Content Intent
   - Server Members Intent
   - Presence Intent

### 2. Configure Bot Permissions

1. Go to the "OAuth2" > "URL Generator" section
2. Select the following scopes:
   - `bot`
   - `applications.commands`
3. Select the following bot permissions:
   - Send Messages
   - Use Slash Commands
   - Embed Links
   - Read Message History
   - Create Public Threads (for thread support)
   - Manage Messages (for `/update` command to clear channels/threads)
4. Copy the generated URL and invite the bot to your server

### 3. Environment Configuration

1. Copy `env.example` to `.env`
2. Fill in the following variables:

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_GUILD_ID=your_guild_id_here

# API Configuration
API_BASE_URL=http://localhost:3000/api
API_KEY=your_api_key_here

# Bot Configuration
BOT_PREFIX=!
LOG_LEVEL=info
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Build and Run

```bash
# Development mode
npm run dev

# Production build
npm run build
npm start
```

## Usage

### `/caves` Command

```
/caves server:INX map:The Island
```

This will:
1. Fetch all **modded** cave spots for the specified server and map
2. Display server and map header
3. Group spots by type (cave, regular, underworld, etc.)
4. Sort farm spots to the end
5. Show coordinates, cave damage, and descriptions
6. Handle video files and external video links
7. Format with beautiful Discord styling
8. **Works in both text channels and threads**
9. Automatically saves the `{server, map}` for this channel/thread so you can run `/update` later without re-specifying

### `/update` Command

Default behavior (`/update`) resolves server/map using the saved config for this channel (or falls back to scanning the last header), then:
1. Clear all messages in the channel or thread
2. Fetch updated modded cave spots
3. Send the fresh list with the same formatting as `/caves`

```
/update mode:all
```

This will iterate over all channels/threads in the current guild that were saved via `/caves` and run the same update routine in each. A short delay is used between channels to avoid rate limits.

**Note:** Requires Administrator permissions. Works in both text channels and threads.

## Thread Usage

Both `/caves` and `/update` commands work seamlessly in threads:

### Using Commands in Threads
- Run `/caves` in any thread to get cave spots for that thread
- Run `/update` in a thread to refresh the spots in that thread
- The bot will automatically detect if you're in a thread or channel
- Thread messages are cleared and updated just like channel messages

### Thread Benefits
- Keep cave spot discussions organized in separate threads
- Multiple server/map combinations can have their own threads
- Threads automatically archive after inactivity
- Easier to manage and find specific cave spot information

## API Integration

The bot connects to your existing API endpoints:

- `GET /api/spots?map={map}&server={server}&category=modded` - Fetch modded spots
- `GET /api/servers` - Fetch available servers

## Permissions

- **Administrator permission required** for both `/caves` and `/update` commands
- Bot needs the following Discord permissions:
  - Send Messages
  - Use Slash Commands
  - Embed Links
  - Read Message History
  - Create Public Threads (for thread support)
  - Manage Messages (for `/update` command to clear channels/threads)

### Thread-Specific Permissions

When using commands in threads, the bot also needs:
- **Send Messages** permission in the specific thread
- **Read Message History** permission in the thread
- **Manage Messages** permission in the thread (for `/update` command)

**Note:** Thread permissions can be different from channel permissions. If a command fails in a thread, check:
1. Thread is not archived or locked
2. Bot has the required permissions in the thread
3. Thread permissions are not overridden by role or user permissions

## Data Persistence

The bot stores saved channel configurations (server and map) in a JSON file so `/update` can run later without re-specifying options:

- File path: `discord-bot/channel-store.json`
- Format:

```json
{
  "<guildId>": {
    "<channelId>": { "server": "INX", "map": "Fjordur" }
  }
}
```

If the file is missing or invalid, it will be recreated automatically. Consider adding this file to `.gitignore` if you don't want to commit it.

## Development

### Project Structure

```
src/
├── commands/          # Slash command definitions
│   ├── caves.ts       # Caves command
│   └── update.ts      # Update command
├── handlers/          # Interaction handlers
│   └── interactionHandler.ts
├── services/          # API services
│   └── apiService.ts
├── utils/             # Utilities
│   ├── logger.ts
│   └── threadUtils.ts # Thread utility functions
├── deploy-commands.ts # Command deployment
└── index.ts           # Main bot file
```

### Adding New Commands

1. Create a new command file in `src/commands/`
2. Export the command using `SlashCommandBuilder`
3. Add the command to the `commands` array in `deploy-commands.ts`
4. Add the command handler in `interactionHandler.ts`

### Logging

The bot uses a simple logger with different levels:
- `info` - General information
- `warn` - Warnings
- `error` - Errors
- `debug` - Debug information (only shown when LOG_LEVEL=debug)

## Troubleshooting

### Bot Not Responding
- Check if the bot token is correct
- Ensure the bot has the required permissions
- Check the console for error messages

### Commands Not Working in Threads
- Ensure the bot has "Send Messages" permission in the thread
- Check if the thread is archived or locked
- Verify the bot has "Manage Messages" permission for the `/update` command
- Check thread-specific permissions in Discord server settings
- Look for specific error messages in the bot's response

### Commands Not Appearing
- Run the deploy-commands script
- Check if the bot has the `applications.commands` scope
- Wait up to an hour for global command deployment

### API Connection Issues
- Verify the API_BASE_URL is correct
- Check if your API is running
- Ensure the API_KEY is set if required

## Deployment

### Local Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

### Docker (Optional)
You can containerize the bot for easier deployment:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["npm", "start"]
```

## License

ISC 