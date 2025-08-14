# Discord Bot for Ark Spots

A Discord bot that integrates with your Ark spots database to provide cave and spot information via slash commands.

## Features

- `/caves` command to fetch all modded cave spots for a specific server and map
- `/update` command to refresh cave spots in a channel (clears channel and sends updated list)
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

### `/update` Command

```
/update
```

This will:
1. Scan the current channel for the last server/map header
2. Clear all messages in the channel
3. Fetch updated modded cave spots
4. Send the fresh list with the same formatting as `/caves`

**Note:** Requires Administrator permissions and a previous `/caves` command in the channel.

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
  - Manage Messages (for `/update` command to clear channels)

## Development

### Project Structure

```
src/
├── commands/          # Slash command definitions
│   └── caves.ts      # Caves command
├── handlers/          # Interaction handlers
│   └── interactionHandler.ts
├── services/          # API services
│   └── apiService.ts
├── utils/             # Utilities
│   └── logger.ts
├── deploy-commands.ts # Command deployment
└── index.ts          # Main bot file
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