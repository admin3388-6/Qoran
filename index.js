require('dotenv').config();
const { 
    Client, GatewayIntentBits, Options, ActivityType, REST, Routes, 
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, PermissionsBitField 
} = require('discord.js');
const { 
    joinVoiceChannel, createAudioPlayer, createAudioResource, 
    AudioPlayerStatus, VoiceConnectionStatus, entersState, 
    NoSubscriberBehavior, StreamType 
} = require('@discordjs/voice');
const http = require('http');

// ==========================================
// 1. الإعدادات (Config)
// ==========================================
const CONFIG = {
    GUILD_ID: process.env.GUILD_ID,
    VOICE_CHANNEL_ID: process.env.VOICE_CHANNEL_ID,
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
    OWNER_ROLE_ID: process.env.OWNER_ROLE_ID,
    DEFAULT_SERVER: 'https://server6.mp3quran.net/3siri/', // إبراهيم الأصيري
    RECITER_NAME: 'إبراهيم الأصيري',
    CHECK_INTERVAL: 10000 // فحص الروم كل 10 ثواني
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
let checkInterval = null;

// ==========================================
// 2. خادم الويب (Render Port Bypass)
// ==========================================
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('بوت القرآن الكريم الشامل يعمل بنجاح!');
}).listen(process.env.PORT || 3000);

// ==========================================
// 3. تهيئة العميل (Client)
// ==========================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    makeCache: Options.cacheWithLimits({
        MessageManager: 0, PresenceManager: 0, ReactionManager: 0,
        ThreadManager: 0, UserManager: 0, GuildMemberManager: 0,    
    }),
});

// ==========================================
// 4. نظام السجلات (Logger)
// ==========================================
async function logMessage(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    if (!CONFIG.LOG_CHANNEL_ID) return;
    try {
        const channel = client.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const emoji = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : 'ℹ️';
            await channel.send(`${emoji} **[سجل البوت]:** ${message}`).catch(() => {});
        }
    } catch (e) {}
}

// ==========================================
// 5. نظام جلب السور
// ==========================================
function getAudioURL(surahNumber) {
    const paddedSurah = String(surahNumber).padStart(3, '0');
    return `${CONFIG.DEFAULT_SERVER}${paddedSurah}.mp3`;
}

// ==========================================
// 6. نظام الصوت والاقتصاد (Voice & Economic Mode)
// ==========================================
async function connectAndMonitor() {
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        const voiceChannel = guild?.channels.cache.get(CONFIG.VOICE_CHANNEL_ID);
        if (!voiceChannel) return logMessage('لم يتم العثور على الروم الصوتي!', 'error');

        // إنشاء الاتصال
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false
        });

        // إعداد المشغل الصوتي فوراً لتجنب أي تأخير
        if (!player) {
            player = createAudioPlayer({
                behaviors: { noSubscriber: NoSubscriberBehavior.Play }
            });

            player.on(AudioPlayerStatus.Idle, () => {
                if (STATE.isPlaying && STATE.membersCount > 0) {
                    STATE.currentSurah = STATE.currentSurah >= 114 ? 1 : STATE.currentSurah + 1;
                    playCurrentSurah();
                }
            });

            player.on('error', error => {
                logMessage(`خطأ في الصوت: ${error.message}`, 'error');
                setTimeout(playCurrentSurah, 5000);
            });
        }

        connection.subscribe(player);

        // محاولة الاتصال مع تجاهل خطأ التأخير (Abort Error Bypass)
        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30000);
            logMessage('✅ تم الاتصال بخوادم الصوت بنجاح.');
        } catch (error) {
            logMessage(`⏳ تأخر الاتصال بخوادم ديسكورد، سيتم المحاولة في الخلفية...`, 'warn');
            // لن نقوم بإيقاف الكود هنا، ديسكورد سيستمر بالمحاولة تلقائياً
        }

        // معالجة الانقطاع المفاجئ
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            logMessage('⚠️ انقطع الاتصال، جاري إعادة المحاولة...', 'warn');
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5000),
                ]);
            } catch (e) {
                if (connection) connection.destroy();
                setTimeout(connectAndMonitor, 5000); // إعادة تشغيل كاملة
            }
        });

        logMessage('✅ البوت متصل بالروم وفي وضع الاستعداد (0% استهلاك).');
        
        // بدء المراقبة الاقتصادية
        if (checkInterval) clearInterval(checkInterval);
        checkInterval = setInterval(() => checkVoiceChannel(voiceChannel), CONFIG.CHECK_INTERVAL);
        checkVoiceChannel(voiceChannel); 

    } catch (error) {
        logMessage(`فشل الاتصال: ${error.message}`, 'error');
        setTimeout(connectAndMonitor, 10000); // إعادة المحاولة بعد 10 ثواني
    }
}

async function checkVoiceChannel(channel) {
    try {
        const members = channel.members.filter(m => !m.user.bot);
        const count = members.size;

        if (count !== STATE.membersCount) {
            STATE.membersCount = count;
            
            if (count > 0 && !STATE.isPlaying) {
                logMessage(`👤 دخل عضو للروم - جاري بدء التلاوة...`);
                STATE.isPlaying = true;
                playCurrentSurah();
            } else if (count === 0 && STATE.isPlaying) {
                logMessage(`🚫 خرج الجميع - إيقاف التلاوة لتوفير الموارد.`);
                player.stop();
                STATE.isPlaying = false;
                updateControlPanel();
            }
        }
    } catch (e) {}
}

async function playCurrentSurah() {
    if (!player || !STATE.isPlaying) return;
    try {
        const audioURL = getAudioURL(STATE.currentSurah);
        const resource = createAudioResource(audioURL, { inputType: StreamType.Arbitrary, inlineVolume: true });
        resource.volume.setVolume(0.6);
        
        player.play(resource);
        STATE.isPaused = false;
        
        logMessage(`▶️ جاري تلاوة سورة رقم ${STATE.currentSurah}`);
        updateControlPanel();
    } catch (error) {
        logMessage(`خطأ في التشغيل: ${error.message}`, 'error');
    }
}

// ==========================================
// 7. لوحة التحكم (Setup Panel)
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
            { name: '⚡ الوضع الاقتصادي', value: 'مفعل (يعمل عند دخول الأعضاء فقط)', inline: false }
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
    } catch (e) {
        STATE.controlMessage = null; 
    }
}

// ==========================================
// 8. تسجيل الأوامر والتفاعلات
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
            logMessage(`تم إنشاء لوحة التحكم بواسطة ${interaction.user.tag}`);
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
// 9. تشغيل البوت
// ==========================================
client.once('ready', async () => {
    console.log(`[Client] تم الدخول باسم: ${client.user.tag}`);
    client.user.setActivity('القرآن الكريم 🎧', { type: ActivityType.Listening });

    await registerCommands();
    await connectAndMonitor(); 
});

process.on('unhandledRejection', e => console.error(e));
process.on('uncaughtException', e => console.error(e));

client.login(process.env.DISCORD_TOKEN);
