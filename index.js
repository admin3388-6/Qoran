require('dotenv').config();
const { 
    Client, GatewayIntentBits, Options, ActivityType, REST, Routes, 
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, PermissionsBitField 
} = require('discord.js');
const { 
    joinVoiceChannel, createAudioPlayer, createAudioResource, 
    AudioPlayerStatus, VoiceConnectionStatus, entersState, 
    NoSubscriberBehavior 
} = require('@discordjs/voice');
const http = require('http');

const CONFIG = {
    GUILD_ID: process.env.GUILD_ID,
    VOICE_CHANNEL_ID: process.env.VOICE_CHANNEL_ID,
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
    OWNER_ROLE_ID: process.env.OWNER_ROLE_ID,
    DEFAULT_SERVER: 'https://server6.mp3quran.net/3siri/', 
    RECITER_NAME: 'إبراهيم الأصيري'
};

const STATE = {
    isPlaying: false,
    isPaused: false,
    currentSurah: 1,
    membersCount: 0,
    controlMessage: null 
};

let connection = null;
let player = null;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bot is running!');
}).listen(process.env.PORT || 3000);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    makeCache: Options.cacheWithLimits({
        MessageManager: 0, PresenceManager: 0, ReactionManager: 0, ThreadManager: 0 
    }),
});

async function logMessage(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    if (!CONFIG.LOG_CHANNEL_ID) return;
    try {
        const channel = client.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const emoji = type === 'error' ? '❌' : 'ℹ️';
            await channel.send(`${emoji} **[سجل البوت]:** ${message}`).catch(() => {});
        }
    } catch (e) {}
}

async function connectToVoice() {
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const voiceChannel = guild?.channels.cache.get(CONFIG.VOICE_CHANNEL_ID);
        if (!voiceChannel) return logMessage('لم يتم العثور على الروم الصوتي!', 'error');

        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false
        });

        if (!player) {
            player = createAudioPlayer({
                behaviors: { noSubscriber: NoSubscriberBehavior.Play }
            });

            player.on(AudioPlayerStatus.Idle, () => {
                if (STATE.isPlaying && STATE.membersCount > 0) {
                    STATE.currentSurah = STATE.currentSurah >= 114 ? 1 : STATE.currentSurah + 1;
                    setTimeout(() => { if (STATE.isPlaying) playCurrentSurah(); }, 2000);
                }
            });

            player.on('error', error => {
                logMessage(`خطأ في الصوت: ${error.message}`, 'error');
                setTimeout(() => { if (STATE.isPlaying) playCurrentSurah(); }, 5000);
            });
        }

        connection.subscribe(player);

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5000),
                ]);
            } catch (e) {
                if (connection) connection.destroy();
                setTimeout(connectToVoice, 5000);
            }
        });

        logMessage('✅ البوت متصل بالروم الصوتي.');
        checkChannelMembers(voiceChannel);

    } catch (error) {
        logMessage(`فشل الاتصال: ${error.message}`, 'error');
        setTimeout(connectToVoice, 10000);
    }
}

function checkChannelMembers(channel) {
    if (!channel) return;
    const count = channel.members.filter(m => !m.user.bot).size;

    if (count !== STATE.membersCount) {
        STATE.membersCount = count;
        if (count > 0 && !STATE.isPlaying) {
            logMessage(`👤 تم رصد مستمعين (${count}) - جاري بدء التلاوة...`);
            STATE.isPlaying = true;
            playCurrentSurah();
        } else if (count === 0 && STATE.isPlaying) {
            logMessage(`🚫 الروم فارغ - إيقاف التلاوة.`);
            STATE.isPlaying = false; 
            if (player) player.stop(); 
            updateControlPanel();
        } else {
            updateControlPanel();
        }
    }
}

// ==========================================
// الحل الجذري: تمرير الرابط المباشر بدون أي معالجة للصوت (تخفيف الحمل على السيرفر)
// ==========================================
async function playCurrentSurah() {
    if (!player || !STATE.isPlaying) return;
    try {
        const paddedSurah = String(STATE.currentSurah).padStart(3, '0');
        const audioURL = `${CONFIG.DEFAULT_SERVER}${paddedSurah}.mp3`;
        
        // استخدام الرابط المباشر وإلغاء خاصية inlineVolume لمنع اختناق المعالج
        const resource = createAudioResource(audioURL);
        
        player.play(resource);
        STATE.isPaused = false;
        
        logMessage(`▶️ جاري تلاوة سورة رقم ${STATE.currentSurah}`);
        updateControlPanel();
    } catch (error) {
        logMessage(`فشل تشغيل السورة: ${error.message}`, 'error');
        STATE.currentSurah = STATE.currentSurah >= 114 ? 1 : STATE.currentSurah + 1;
        setTimeout(() => { if (STATE.isPlaying) playCurrentSurah(); }, 5000);
    }
}

function buildPanel() {
    const embed = new EmbedBuilder()
        .setTitle('📖 بوت إذاعة القرآن الكريم')
        .setColor(STATE.isPlaying ? 0x00FF00 : 0xFFA500)
        .addFields(
            { name: '🎙️ القارئ', value: CONFIG.RECITER_NAME, inline: true },
            { name: '🔢 السورة الحالية', value: `${STATE.currentSurah} / 114`, inline: true },
            { name: '▶️ الحالة', value: STATE.isPaused ? '⏸️ متوقف مؤقتاً' : STATE.isPlaying ? '🔴 يبث الآن' : '🟡 وضع الاستعداد', inline: true },
            { name: '👥 المستمعون', value: `${STATE.membersCount}`, inline: true }
        )
        .setFooter({ text: 'لوحة التحكم الذكية' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_prev').setLabel('⏮️ السابق').setStyle(ButtonStyle.Primary).setDisabled(!STATE.isPlaying),
        new ButtonBuilder().setCustomId('btn_pause').setLabel(STATE.isPaused ? '▶️ استئناف' : '⏸️ إيقاف').setStyle(STATE.isPaused ? ButtonStyle.Success : ButtonStyle.Danger).setDisabled(!STATE.isPlaying),
        new ButtonBuilder().setCustomId('btn_next').setLabel('⏭️ التالي').setStyle(ButtonStyle.Primary).setDisabled(!STATE.isPlaying)
    );

    return { embeds: [embed], components: [row] };
}

async function updateControlPanel() {
    if (!STATE.controlMessage) return;
    try { await STATE.controlMessage.edit(buildPanel()); } catch (e) {}
}

async function registerCommands() {
    const commands = [
        new SlashCommandBuilder().setName('setup').setDescription('إنشاء لوحة التحكم (للمالك فقط)')
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, CONFIG.GUILD_ID), { body: commands });
}

client.on('interactionCreate', async interaction => {
    const isOwner = interaction.member.roles.cache.has(CONFIG.OWNER_ROLE_ID) || interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
        if (!isOwner) return interaction.reply({ content: '⛔ للمالك فقط!', ephemeral: true });
        const message = await interaction.reply({ ...buildPanel(), fetchReply: true });
        STATE.controlMessage = message;
    } 
    else if (interaction.isButton()) {
        if (!isOwner) return interaction.reply({ content: '⛔ للمالك فقط!', ephemeral: true });
        await interaction.deferUpdate();

        if (interaction.customId === 'btn_next') {
            STATE.currentSurah = STATE.currentSurah >= 114 ? 1 : STATE.currentSurah + 1;
            playCurrentSurah();
        } else if (interaction.customId === 'btn_prev') {
            STATE.currentSurah = STATE.currentSurah <= 1 ? 114 : STATE.currentSurah - 1;
            playCurrentSurah();
        } else if (interaction.customId === 'btn_pause') {
            STATE.isPaused ? player.unpause() : player.pause();
            STATE.isPaused = !STATE.isPaused;
            updateControlPanel();
        }
    }
});

client.once('ready', async () => {
    console.log(`[Client] Logged in as ${client.user.tag}`);
    client.user.setActivity('القرآن الكريم 🎧', { type: ActivityType.Listening });
    await registerCommands();
    await connectToVoice(); 
});

process.on('unhandledRejection', e => console.error(e));
process.on('uncaughtException', e => console.error(e));

client.login(process.env.DISCORD_TOKEN);
