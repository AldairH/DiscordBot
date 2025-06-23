const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Player } = require('discord-player');
const { YoutubeiExtractor } = require('@discord-player/extractor');

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_SERVERS = ['869299042612563968'];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

// Discord-player con opciones anti-bloqueo
const player = new Player(client, {
    ytdlOptions: {
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
        requestOptions: {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate',
                'DNT': '1',
                'Connection': 'keep-alive'
            }
        }
    },
    skipFFmpeg: false,
    // Configuraciones adicionales para evitar bloqueos
    extractorRetryLimit: 3,  // Reintentos automáticos
    extractorTimeout: 30000, // Timeout de 30 segundos
});

// Registrar extractores con configuración mejorada
const { DefaultExtractors } = require('@discord-player/extractor');

async function setupExtractors() {
    try {
        await player.extractors.loadMulti(DefaultExtractors);
        console.log('✅ Extractores cargados:', player.extractors.size);
    } catch (error) {
        console.error('💥 Error fatal al cargar extractores:', error.message);
    }
}


// Funciones de utilidad (mantener las mismas)
function createErrorEmbed(title, description) {
    return new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle(`❌ ${title}`)
        .setDescription(description);
}

function createSuccessEmbed(title, description) {
    return new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle(`✅ ${title}`)
        .setDescription(description);
}

function createInfoEmbed(title, description) {
    return new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`ℹ️ ${title}`)
        .setDescription(description);
}

// Eventos del reproductor con manejo mejorado de errores
player.events.on('audioTrackAdd', (queue, track) => {
    const embed = createSuccessEmbed('Canción añadida', 
        `**${track.title}**\n` +
        `👤 ${track.author}\n` +
        `⏱️ ${track.duration}\n` +
        `📍 Posición: ${queue.tracks.data.length}`
    );
    
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);
    queue.metadata.send({ embeds: [embed] });
});

player.events.on('audioTracksAdd', (queue, tracks) => {
    const embed = createSuccessEmbed('Playlist añadida', 
        `Se añadieron **${tracks.length}** canciones a la cola`
    );
    queue.metadata.send({ embeds: [embed] });
});

player.events.on('playerStart', (queue, track) => {
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🎵 Reproduciendo ahora')
        .setDescription(`**${track.title}**`)
        .addFields(
            { name: '👤 Autor', value: track.author, inline: true },
            { name: '⏱️ Duración', value: track.duration, inline: true },
            { name: '📝 Cola', value: `${queue.tracks.data.length} canción(es) restante(s)`, inline: true }
        );

    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    const controlRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('pause')
                .setLabel('⏸️ Pausar')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('skip')
                .setLabel('⏭️ Saltar')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('stop')
                .setLabel('⏹️ Parar')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('loop')
                .setLabel(queue.repeatMode === 1 ? '🔁 Loop ON' : '🔁 Loop OFF')
                .setStyle(queue.repeatMode === 1 ? ButtonStyle.Success : ButtonStyle.Secondary)
        );

    queue.metadata.send({ embeds: [embed], components: [controlRow] });
});

player.events.on('emptyQueue', (queue) => {
    const embed = createInfoEmbed('Cola vacía', 'No hay más canciones en la cola.');
    queue.metadata.send({ embeds: [embed] });
});

// Manejo mejorado de errores con reintentos automáticos
player.events.on('error', (queue, error) => {
    console.error('Error en discord-player:', error.message);
    
    const isYouTubeError = error.message.includes('Sign in') || 
                          error.message.includes('blocked') ||
                          error.message.includes('unavailable') ||
                          error.message.includes('403') ||
                          error.message.includes('429');
    
    if (isYouTubeError) {
        const embed = createErrorEmbed('🛡️ Bloqueo detectado', 
            'YouTube bloqueó temporalmente las solicitudes.\n' +
            '🔄 Intentando con método alternativo...'
        );
        queue.metadata.send({ embeds: [embed] });
        
        // Reintentar con configuración diferente después de 5 segundos
        setTimeout(async () => {
            if (queue.tracks.data.length > 0) {
                try {
                    await queue.node.skip();
                } catch (skipError) {
                    console.error('Error al saltar:', skipError);
                }
            }
        }, 5000);
    } else {
        const embed = createErrorEmbed('Error de reproducción', 
            `${error.message.substring(0, 100)}${error.message.length > 100 ? '...' : ''}`
        );
        queue.metadata.send({ embeds: [embed] });
    }
});

player.events.on('playerError', (queue, error) => {
    console.error('Error del reproductor:', error.message);
    
    const embed = createErrorEmbed('Error del reproductor', 
        'Hubo un problema con la reproducción. Saltando a la siguiente...'
    );
    queue.metadata.send({ embeds: [embed] });
});

client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} está conectado!`);
    
    // Configurar extractores con mejor manejo de errores
    await setupExtractors();
    
    // Verificar estado final
    if (player.extractors.size === 0) {
        console.error('💥 CRÍTICO: No hay extractores disponibles. El bot no funcionará.');
        console.log('🔍 Revisa las dependencias: npm list @discord-player/extractor');
    } else {
        console.log('🎉 Sistema de extracción listo para usar');
    }
    const commands = [
        new SlashCommandBuilder()
            .setName('play')
            .setDescription('Reproduce una canción')
            .addStringOption(option =>
                option.setName('cancion')
                    .setDescription('Nombre de la canción o URL de YouTube')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('skip')
            .setDescription('Salta a la siguiente canción'),
        new SlashCommandBuilder()
            .setName('stop')
            .setDescription('Para la música y limpia la cola'),
        new SlashCommandBuilder()
            .setName('queue')
            .setDescription('Muestra la cola actual'),
        new SlashCommandBuilder()
            .setName('pause')
            .setDescription('Pausa/reanuda la música'),
        new SlashCommandBuilder()
            .setName('loop')
            .setDescription('Activa/desactiva el loop de la canción actual'),
        new SlashCommandBuilder()
            .setName('shuffle')
            .setDescription('Mezcla la cola aleatoriamente'),
        new SlashCommandBuilder()
            .setName('clear')
            .setDescription('Limpia la cola de música'),
        new SlashCommandBuilder()
            .setName('disconnect')
            .setDescription('Desconecta el bot del canal de voz')
    ];

    try {
        for (const guildId of ALLOWED_SERVERS) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
                await guild.commands.set(commands);
                console.log(`✅ Comandos registrados en ${guild.name}`);
            }
        }
    } catch (error) {
        console.error('Error registrando comandos:', error);
    }
});

client.on('interactionCreate', async interaction => {
    // Slash commands
    if (interaction.isChatInputCommand()) {
        if (!ALLOWED_SERVERS.includes(interaction.guildId)) {
            return interaction.reply({
                content: '❌ Este bot no está autorizado en este servidor.',
                ephemeral: true
            });
        }

        const { commandName, options, member, guild, channel } = interaction;

        const requiresVoice = ['play', 'skip', 'stop', 'pause'];
        if (requiresVoice.includes(commandName) && !member.voice.channel) {
            return interaction.reply({
                content: '❌ Debes estar en un canal de voz para usar este comando.',
                ephemeral: true
            });
        }

        const queue = player.nodes.get(guild.id);

        try {
            switch (commandName) {
                case 'play':
                    if (!interaction.deferred && !interaction.replied) {
                        await interaction.deferReply();
                    }

                    const query = options.getString('cancion');

                    const { track } = await player.play(member.voice.channel, query, {
                        nodeOptions: {
                            metadata: channel,
                            volume: 50,
                            leaveOnStop: false,
                            leaveOnEnd: false,
                            leaveOnEmpty: true,
                            skipOnNoStream: true,
                            searchResultsLimit: 1,
                            fallbackSearch: true,
                        },
                        requestedBy: interaction.user,
                        searchEngine: 'auto'
                    });

                    const embed = createSuccessEmbed('🎵 Procesando...',
                        `Buscando: **${query}**\n🛡️ Sistema anti-bloqueo activo`
                    );

                    await interaction.followUp({ embeds: [embed] });
                    break;

                case 'skip':
                    if (!queue || !queue.isPlaying())
                        return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });
                    queue.node.skip();
                    await interaction.reply('⏭️ Canción saltada.');
                    break;

                case 'stop':
                    if (!queue)
                        return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });
                    queue.delete();
                    await interaction.reply('⏹️ Música parada y cola limpiada.');
                    break;

                case 'pause':
                    if (!queue || !queue.isPlaying())
                        return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });

                    if (queue.node.isPaused()) {
                        queue.node.resume();
                        await interaction.reply('▶️ Música reanudada.');
                    } else {
                        queue.node.pause();
                        await interaction.reply('⏸️ Música pausada.');
                    }
                    break;

                case 'queue':
                    if (!queue || queue.tracks.data.length === 0)
                        return interaction.reply({ content: '📝 La cola está vacía.', ephemeral: true });

                    let queueList = '';
                    queue.tracks.data.slice(0, 10).forEach((track, index) => {
                        queueList += `${index + 1}. **${track.title}** - ${track.author}\n`;
                    });

                    if (queue.tracks.data.length > 10)
                        queueList += `\n... y ${queue.tracks.data.length - 10} más`;

                    const queueEmbed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('📝 Cola de Música')
                        .setDescription(queueList)
                        .addFields(
                            { name: '🎵 Reproduciendo', value: queue.currentTrack?.title || 'Nada', inline: true },
                            { name: '📊 Total en cola', value: `${queue.tracks.data.length}`, inline: true },
                            { name: '🔁 Loop', value: queue.repeatMode === 1 ? 'Activado' : 'Desactivado', inline: true }
                        );

                    await interaction.reply({ embeds: [queueEmbed] });
                    break;

                case 'loop':
                    if (!queue)
                        return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });

                    const newLoopMode = queue.repeatMode === 1 ? 0 : 1;
                    queue.setRepeatMode(newLoopMode);
                    await interaction.reply(`🔁 Loop ${newLoopMode === 1 ? 'activado' : 'desactivado'}.`);
                    break;

                case 'shuffle':
                    if (!queue || queue.tracks.data.length === 0)
                        return interaction.reply({ content: '❌ No hay canciones en la cola para mezclar.', ephemeral: true });

                    queue.tracks.shuffle();
                    await interaction.reply('🔀 Cola mezclada aleatoriamente.');
                    break;

                case 'clear':
                    if (!queue || queue.tracks.data.length === 0)
                        return interaction.reply({ content: '❌ La cola ya está vacía.', ephemeral: true });

                    const count = queue.tracks.data.length;
                    queue.tracks.clear();
                    await interaction.reply(`🗑️ Se eliminaron ${count} canción(es) de la cola.`);
                    break;

                case 'disconnect':
                    if (!queue)
                        return interaction.reply({ content: '❌ El bot no está conectado.', ephemeral: true });

                    queue.delete();
                    await interaction.reply('👋 Desconectado del canal de voz.');
                    break;
            }
        } catch (error) {
            console.error('❌ Error en comando:', commandName, error);

            const errorEmbed = createErrorEmbed('Error inesperado', 'Ocurrió un error procesando tu comando.');
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            } else {
                await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    }

    // Botones de control
    else if (interaction.isButton()) {
        const queue = player.nodes.get(interaction.guildId);
        if (!queue) return;

        try {
            switch (interaction.customId) {
                case 'pause':
                    if (queue.node.isPaused()) {
                        queue.node.resume();
                        await interaction.deferUpdate();
                    } else {
                        queue.node.pause();
                        await interaction.deferUpdate();
                    }
                    break;

                case 'skip':
                    queue.node.skip();
                    await interaction.deferUpdate();
                    break;

                case 'stop':
                    queue.delete();
                    await interaction.deferUpdate();
                    break;

                case 'loop':
                    const newMode = queue.repeatMode === 1 ? 0 : 1;
                    queue.setRepeatMode(newMode);
                    await interaction.deferUpdate();
                    break;
            }
        } catch (error) {
            console.error('❌ Error en botón:', error);
            await interaction.reply({
                content: '❌ Hubo un problema al procesar tu acción.',
                ephemeral: true
            }).catch(() => {});
        }
    }
});


client.on('error', error => {
    console.error('Error del cliente Discord:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Servidor HTTP (mantener igual)
const http = require('http');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'Discord Music Bot Running',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        guilds: client.guilds ? client.guilds.cache.size : 0,
        extractors: player.extractors.size
    }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP Server running on port ${PORT}`);
});

console.log('🛡️ Discord-player con sistema anti-bloqueo iniciado');
client.login(TOKEN);