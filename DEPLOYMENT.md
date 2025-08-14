# Discord Bot Deployment Guide

This guide will help you deploy the Discord bot to a cloud server and connect it to your admin dashboard.

## Prerequisites

- A cloud server (VPS) with Ubuntu/Debian
- Domain name (optional but recommended)
- Discord bot token and application ID
- Access to your main website's API

## Server Setup Options

### Option 1: Oracle Cloud Free Tier (Recommended)

Oracle Cloud offers a generous free tier with 2 AMD-based Compute VMs and 24GB memory.

#### 1. Create Oracle Cloud Account
1. Go to [Oracle Cloud](https://www.oracle.com/cloud/free/)
2. Sign up for a free account (requires credit card for verification)
3. Create a new compartment for your project

#### 2. Create VM Instance
1. Navigate to Compute > Instances
2. Click "Create Instance"
3. Configure:
   - **Name**: `discord-bot-server`
   - **Image**: Canonical Ubuntu 22.04
   - **Shape**: VM.Standard.A1.Flex (2 OCPU, 12GB RAM)
   - **Network**: Create new VCN with public subnet
   - **Public IP**: Yes
4. Click "Create"

#### 3. Connect to Server
```bash
ssh ubuntu@YOUR_SERVER_IP
```

### Option 2: Google Cloud Platform

1. Create GCP account
2. Create a new project
3. Enable Compute Engine API
4. Create VM instance (e2-micro for free tier)

### Option 3: DigitalOcean

1. Create DigitalOcean account
2. Create a new droplet
3. Choose Ubuntu 22.04
4. Select plan (Basic $6/month minimum)

## Server Configuration

### 1. Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js
```bash
# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 3. Install PM2 (Process Manager)
```bash
sudo npm install -g pm2
```

### 4. Install Git
```bash
sudo apt install git -y
```

### 5. Install Nginx (for reverse proxy)
```bash
sudo apt install nginx -y
sudo systemctl enable nginx
sudo systemctl start nginx
```

## Bot Deployment

### 1. Clone Your Repository
```bash
# Create directory for your bot
mkdir -p /home/ubuntu/bots
cd /home/ubuntu/bots

# Clone your bot repository (replace with your actual repo URL)
git clone https://github.com/yourusername/discord-bot.git
cd discord-bot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
```bash
# Copy environment file
cp .env.example .env

# Edit the environment file
nano .env
```

Fill in your environment variables:
```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_GUILD_ID=your_guild_id_here

# API Configuration (point to your live website)
API_BASE_URL=https://yourdomain.com/api
API_KEY=your_api_key_here

# Bot Configuration
BOT_PREFIX=!
LOG_LEVEL=info

# PM2 Configuration
PM2_PROCESS_NAME=discord-bot
BOT_CONFIG_PATH=/var/app-data/bot-config.json
```
```

### 4. Build the Bot
```bash
npm run build
```

### 5. Start with PM2
```bash
# Start the bot
pm2 start npm --name "discord-bot" -- start

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### 6. Verify Bot is Running
```bash
# Check status
pm2 status

# View logs
pm2 logs discord-bot

# Monitor in real-time
pm2 monit
```

## Admin Dashboard Integration

### 1. Configure Bot Config Path
The admin dashboard needs to know where the bot configuration is stored:

```bash
# Create bot config directory
sudo mkdir -p /var/app-data
sudo chown ubuntu:ubuntu /var/app-data

# Create initial config file
cat > /var/app-data/bot-config.json << EOF
{
  "discordToken": "your_discord_token",
  "clientId": "your_client_id",
  "guildId": "your_guild_id",
  "apiBaseUrl": "https://yourdomain.com/api",
  "apiKey": "your_api_key"
}
EOF
```

### 2. Update Your Main Website Environment
Add these variables to your main website's environment:

```env
# Discord Bot Management
PM2_PROCESS_NAME=discord-bot
BOT_CONFIG_PATH=/var/app-data/bot-config.json
BOT_SCRIPT_PATH=/home/ubuntu/bots/discord-bot
```

### 3. Configure Nginx (Optional)
If you want to access bot status via HTTP:

```bash
# Create nginx config
sudo nano /etc/nginx/sites-available/discord-bot
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-bot-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/discord-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## SSL Certificate (Recommended)

### Install Certbot
```bash
sudo apt install certbot python3-certbot-nginx -y
```

### Get SSL Certificate
```bash
sudo certbot --nginx -d your-bot-domain.com
```

## Monitoring and Maintenance

### 1. View Bot Logs
```bash
# Real-time logs
pm2 logs discord-bot --lines 100

# Historical logs
pm2 logs discord-bot --lines 1000
```

### 2. Restart Bot
```bash
pm2 restart discord-bot
```

### 3. Update Bot
```bash
cd /home/ubuntu/bots/discord-bot
git pull
npm install
npm run build
pm2 restart discord-bot
```

### 4. Monitor Resources
```bash
# System resources
htop

# PM2 monitoring
pm2 monit

# Disk usage
df -h
```

## Troubleshooting

### Bot Not Starting
```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs discord-bot

# Check environment variables
pm2 env discord-bot
```

### Permission Issues
```bash
# Fix file permissions
sudo chown -R ubuntu:ubuntu /home/ubuntu/bots
sudo chmod -R 755 /home/ubuntu/bots
sudo chown -R ubuntu:ubuntu /var/app-data
sudo chmod -R 755 /var/app-data
```

### API Connection Issues
```bash
# Test API connection
curl https://yourdomain.com/api/servers

# Check bot logs for API errors
pm2 logs discord-bot --lines 50
```

### Discord Token Issues
1. Verify token in Discord Developer Portal
2. Check bot permissions in your server
3. Ensure bot is invited with correct scopes

## Security Considerations

### 1. Firewall Configuration
```bash
# Install UFW
sudo apt install ufw

# Configure firewall
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 2. Regular Updates
```bash
# Create update script
cat > /home/ubuntu/update-bot.sh << 'EOF'
#!/bin/bash
cd /home/ubuntu/bots/discord-bot
git pull
npm install
npm run build
pm2 restart discord-bot
echo "Bot updated at $(date)"
EOF

chmod +x /home/ubuntu/update-bot.sh
```

### 3. Backup Configuration
```bash
# Create backup script
cat > /home/ubuntu/backup-bot.sh << 'EOF'
#!/bin/bash
cp /var/app-data/bot-config.json /home/ubuntu/backup-bot-config-$(date +%Y%m%d).json
echo "Backup created at $(date)"
EOF

chmod +x /home/ubuntu/backup-bot.sh
```

## Admin Dashboard Features

Once deployed, your admin dashboard at `/admin/discordbot` will provide:

- **Bot Status**: Online/offline status, uptime, guild count
- **Configuration Management**: View and edit bot settings
- **Control Panel**: Start/stop/restart bot
- **Test Commands**: Verify API connectivity
- **Live Monitoring**: Real-time bot performance

## Cost Estimation

### Oracle Cloud Free Tier
- **Cost**: $0/month
- **Resources**: 2 VMs, 24GB RAM, 200GB storage
- **Limitations**: 30-day trial, then always free tier

### Google Cloud Platform
- **Cost**: ~$5-10/month
- **Resources**: e2-micro instance
- **Benefits**: Reliable, good documentation

### DigitalOcean
- **Cost**: $6/month minimum
- **Resources**: Basic droplet
- **Benefits**: Simple pricing, good performance

## Next Steps

1. **Test the deployment** by running `/caves` and `/update` commands
2. **Monitor the bot** using PM2 and your admin dashboard
3. **Set up automated backups** of your configuration
4. **Configure monitoring alerts** for downtime
5. **Document your setup** for future maintenance

## Support

If you encounter issues:
1. Check the bot logs: `pm2 logs discord-bot`
2. Verify environment variables are correct
3. Test API connectivity manually
4. Check Discord bot permissions
5. Review this deployment guide for common issues
