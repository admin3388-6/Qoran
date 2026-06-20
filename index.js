require('dotenv').config();
const { 
    Client, GatewayIntentBits, Options, ActivityType, REST, Routes, 
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, PermissionsBitField 
} = require('discord.js');
const { 
    joinVoiceChannel, createAudioPlayer, createAudioResource, 
    AudioPlayerStatus, VoiceConnectionStatus, entersState, 
    NoSubscriberBehavior, StreamType, generateDependencyReport
} = require('@discordjs/voice');
const http = require('http');
const fetch = require('node-fetch'); // مهم جداً لسحب الصوت وتجاوز الحماية

// ==========================================
// 1. الإعدادات (Config)
// ==========================================
const CONFIG = {
    GUILD_ID: process.env.GUILD_ID,
    VOICE_CHANNEL_ID: process.env.VOICE_CHANNEL_ID,
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
    OWNER_ROLE_ID: process.env.OWNER_ROLE_ID,
    DEFAULT_SERVER: 'https://server6.mp3quran.net/3siri/', // إبراهيم الأصيري
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

// ==========================================
// 2. خادم الويب
// ==========================================
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('بوت القرآن الكريم الشامل يعمل بنجاح!');
}).listen(process.env.PORT || 3000);

// ==========================================
// 3. تهيئة العميل
// ==========================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    makeCache: Options.cacheWithLimits({
        MessageManager: 0, PresenceManager: 0, ReactionManager: 0,
        ThreadManager: 0 
    }),
});

// ==========================================
// 4. نظام السجلات الذكي (Smart Logger)
// ==========================================
async function logMessage(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    if (!CONFIG.LOG_CHANNEL_ID) return;
    try {
        const channel = client.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const emoji = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : type === 'debug' ? '🔍' : 'ℹ️';
            await channel.send(`${emoji} **[سجل البوت]:** ${message}`).catch(() => {});
        }
    } catch (e) {}
}

// ==========================================
// 5. نظام الصوت والاتصال
// ==========================================
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

            // نظام تتبع ذكي لحالة المشغل (يكشف سبب التخطي السريع)
            player.on('stateChange', (oldState, newState) => {
                if (newState.status === AudioPlayerStatus.Idle && oldState.status === AudioPlayerStatus.Playing) {
                    const playTime = oldState.playbackDuration;
                    
                    // إذا توقف الصوت في أقل من ثانية، فهناك مشكلة في الرابط أو فك التشفير
                    if (playTime < 1000) {
                        logMessage(`توقف الصوت بشكل غير طبيعي بعد ${playTime}ms فقط! السيرفر يرفض البث.`, 'warn');
                        STATE.isPlaying = false; // إيقاف البوت لمنع حلقة التخطي اللانهائية
                        updateControlPanel();
                        return;
                    }

                    // إذا انتهت السورة بشكل طبيعي
                    if (STATE.isPlaying && STATE.membersCount > 0) {
                        STATE.currentSurah = STATE.currentSurah >= 114 ? 1 : STATE.currentSurah + 1;
                        setTimeout(() => {
                            if (STATE.isPlaying) playCurrentSurah();
                        }, 2000);
                    }
                }
            });

            player.on('error', error => {
                logMessage(`خطأ داخلي في مشغل الصوت: ${error.message}`, 'error');
                STATE.isPlaying = false;
                updateControlPanel();
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

        logMessage('✅ البوت متصل بالروم الصوتي وجاهز للعمل.');
        checkChannelMembers(voiceChannel);

    } catch (error) {
        logMessage(`فشل الاتصال بالروم: ${error.message}`, 'error');
        setTimeout(connectToVoice, 10000);
    }
}

// ==========================================
// 6. النظام الاقتصادي اللحظي
// ==========================================
function checkChannelMembers(channel) {
    if (!channel) return;
    
    const members = channel.members.filter(m => !m.user.bot);
    const count = members.size;

    if (count !== STATE.membersCount) {
        STATE.membersCount = count;
        
        if (count > 0 && !STATE.isPlaying) {
            logMessage(`👤 تم رصد مستمعين (${count}) - جاري بدء التلاوة...`);
            STATE.isPlaying = true;
            playCurrentSurah();
        } else if (count === 0 && STATE.isPlaying) {
            logMessage(`🚫 الروم فارغ - إيقاف التلاوة لتوفير الموارد.`);
            STATE.isPlaying = false; 
            if (player) player.stop(); 
            updateControlPanel();
        } else {
            updateControlPanel();
        }
    }
}

client.on('voiceStateUpdate', (oldState, newState) => {
    if (oldState.channelId === CONFIG.VOICE_CHANNEL_ID || newState.channelId === CONFIG.VOICE_CHANNEL_ID) {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const voiceChannel = guild?.channels.cache.get(CONFIG.VOICE_CHANNEL_ID);
        if (voiceChannel) checkChannelMembers(voiceChannel);
    }
});

// ==========================================
// 7. تشغيل السورة (مع نظام تجاوز الحماية والفحص)
// ==========================================
async function playCurrentSurah() {
    if (!player || !STATE.isPlaying) return;
    try {
        const paddedSurah = String(STATE.currentSurah).padStart(3, '0');
        const audioURL = `${CONFIG.DEFAULT_SERVER}${paddedSurah}.mp3`;
        
        logMessage(`جاري فحص الرابط: ${audioURL}`, 'debug');

        // التنكر كمتصفح حقيقي لسحب الصوت وتجاوز حماية السيرفر
        const response = await fetch(audioURL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'audio/mpeg, audio/*;q=0.9, */*;q=0.8'
            }
        });

        if (!response.ok) {
            throw new Error(`السيرفر رفض الاتصال (HTTP ${response.status} ${response.statusText})`);
        }

        // تحويل البث المسحوب إلى مورد صوتي
        const resource = createAudioResource(response.body, { 
            inputType: StreamType.Arbitrary, 
            inlineVolume: true 
        });
        
        resource.volume.setVolume(0.6);
        
        // تتبع أخطاء البث المباشر (FFMPEG)
        resource.playStream.on('error', error => {
            logMessage(`خطأ في فك تشفير الصوت (FFMPEG): ${error.message}`, 'error');
        });

        player.play(resource);
        STATE.isPaused = false;
        
        logMessage(`▶️ جاري تلاوة سورة رقم ${STATE.currentSurah} بنجاح.`);
        updateControlPanel();
    } catch (error) {
        logMessage(`فشل تشغيل السورة: ${error.message}`, 'error');
        STATE.isPlaying = false; // إيقاف البوت لمنع التكرار
        updateControlPanel();
    }
}

// ==========================================
// 8. لوحة التحكم (Setup Panel)
// ==========================================
function buildPanel() {
    const embed = new EmbedBuilder()
        .setTitle('📖 بوت إذاعة القرآن الكريم')
        .setColor(STATE.isPlaying ? 0x00FF00 : 0xFFA500)
        .addFields(
            { name: '🎙️ القارئ', value: CONFIG.RECITER_NAME, inline: true },
            { name: '🔢 السورة الحالية', value: `${STATE.currentSurah} / 114`, inline: true },
            { name: '▶️ الحالة', value: STATE.isPaused ? '⏸️ متوقف مؤقتاً' : STATE.isPlaying ? '🔴 يبث الآن' : '🟡 وضع الاستعداد', inline: true },
            { name: '👥 المستمعون', value: `${STATE.membersCount}`, inline: true },
            { name: '⚡ الوضع الاقتصادي', value: 'مفعل (يعمل تلقائياً عند دخولك للروم)', inline: false }
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
    try {
        await STATE.controlMessage.edit(buildPanel());
    } catch (e) {}
}

// ==========================================
// 9. تسجيل الأوامر والتفاعلات
// ==========================================
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder().setName('setup').setDescription('إنشاء لوحة التحكم (للمالك فقط)'),
        new SlashCommandBuilder().setName('status').setDescription('حالة البوت')
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, CONFIG.GUILD_ID), { body: commands });
}

client.on('interactionCreate', async interaction => {
    const isOwner = interaction.member.roles.cache.has(CONFIG.OWNER_ROLE_ID) || interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup') {
            if (!isOwner) return interaction.reply({ content: '⛔ هذه اللوحة للمالك أو الإدارة فقط!', ephemeral: true });
            
            const message = await interaction.reply({ ...buildPanel(), fetchReply: true });
            STATE.controlMessage = message;
            logMessage(`تم إنشاء لوحة التحكم بنجاح.`);
        } 
        else if (interaction.commandName === 'status') {
            await interaction.reply({ content: `الاتصال: ${connection ? '🟢' : '🔴'} | المستمعون: ${STATE.membersCount}`, ephemeral: true });
        }
    } 
    else if (interaction.isButton()) {
        if (!isOwner) return interaction.reply({ content: '⛔ لا تملك صلاحية استخدام الأزرار!', ephemeral: true });
        await interaction.deferUpdate();

        if (interaction.customId === 'btn_next') {
            STATE.currentSurah = STATE.currentSurah >= 114 ? 1 : STATE.currentSurah + 1;
            playCurrentSurah();
        } 
        else if (interaction.customId === 'btn_prev') {
            STATE.currentSurah = STATE.currentSurah <= 1 ? 114 : STATE.currentSurah - 1;
            playCurrentSurah();
        } 
        else if (interaction.customId === 'btn_pause') {
            if (STATE.isPaused) {
                player.unpause();
                STATE.isPaused = false;
            } else {
                player.pause();
                STATE.isPaused = true;
            }
            updateControlPanel();
        }
    }
});

// ==========================================
// 10. تشغيل البوت
// ==========================================
client.once('ready', async () => {
    console.log(`[Client] تم الدخول باسم: ${client.user.tag}`);
    client.user.setActivity('القرآن الكريم 🎧', { type: ActivityType.Listening });
    
    console.log(generateDependencyReport()); // طباعة تقرير المكتبات للتأكد من سلامة FFMPEG

    await registerCommands();
    await connectToVoice(); 
});

process.on('unhandledRejection', e => console.error(e));
process.on('uncaughtException', e => console.error(e));

client.login(process.env.DISCORD_TOKEN);
