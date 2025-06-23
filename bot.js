const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
];

const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const play = require('play-dl');

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


const queues = new Map();

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

class MusicQueue {
    constructor() {
        this.songs = [];
        this.isPlaying = false;
        this.connection = null;
        this.player = null;
        this.currentSong = null;
        this.textChannel = null;
        this.loop = false;
        this.shuffle = false;
    }

    addSong(song) {
        this.songs.push(song);
    }

    getNextSong() {
        if (this.shuffle && this.songs.length > 1) {
            const randomIndex = Math.floor(Math.random() * this.songs.length);
            return this.songs.splice(randomIndex, 1)[0];
        }
        return this.songs.shift();
    }

    clear() {
        this.songs = [];
        this.currentSong = null;
    }
}

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

async function searchYouTube(query, retryCount = 0) {
    try {
        // Añadir delay progresivo
        if (retryCount > 0) {
            const delay = Math.min(2000 * retryCount, 8000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        const searchResults = await play.search(query, { 
            limit: 1, 
            source: { youtube: 'video' },
            // Opciones adicionales para evitar detección
            requestOptions: {
                headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Encoding': 'gzip, deflate',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                }
            }
        });

        if (searchResults.length > 0) {
            const video = searchResults[0];
            return {
                title: video.title,
                url: video.url,
                duration: video.durationRaw,
                thumbnail: video.thumbnails?.[0]?.url,
                author: video.channel?.name
            };
        }
        return null;
    } catch (error) {
        console.error(`Error buscando en YouTube (intento ${retryCount + 1}):`, error.message);
        
        // Reintentar si es error de YouTube y no hemos superado límite
        if (retryCount < 2 && (error.message.includes('Sign in') || error.message.includes('blocked'))) {
            return searchYouTube(query, retryCount + 1);
        }
        
        return null;
    }
}

async function playMusic(queue, retryCount = 0) {
    if (!queue.songs.length && !queue.loop) {
        queue.isPlaying = false;
        if (queue.textChannel) {
            const queueEmptyEmbed = createInfoEmbed('Cola vacía', 'No hay más canciones en la cola.');
            queue.textChannel.send({ embeds: [queueEmptyEmbed] });
        }
        return;
    }

    let song;
    if (queue.loop && queue.currentSong) {
        song = queue.currentSong;
    } else {
        song = queue.getNextSong();
        if (!song) return;
        queue.currentSong = song;
    }

    try {
        // Delay progresivo más inteligente
        if (retryCount > 0) {
            const delays = [3000, 8000, 15000, 30000]; // 3s, 8s, 15s, 30s
            const delay = delays[Math.min(retryCount - 1, delays.length - 1)];
            console.log(`Esperando ${delay/1000} segundos antes del reintento ${retryCount}`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Configuración mejorada para play-dl
        const streamOptions = { 
            quality: 1, // Calidad media para mejor compatibilidad
            discordPlayerCompatibility: true,
            seek: 0,
            // Opciones de request mejoradas
            requestOptions: {
                headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'DNT': '1',
                    'Pragma': 'no-cache',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'cross-site'
                }
            },
            // Añadir timeout
            timeout: 30000
        };

        const stream = await play.stream(song.url, streamOptions);
        
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
            inlineVolume: true
        });

        queue.player.play(resource);
        queue.isPlaying = true;

        if (queue.textChannel) {
            const nowPlayingEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🎵 Reproduciendo ahora')
                .setDescription(`**${song.title}**`)
                .addFields(
                    { name: '👤 Autor', value: song.author || 'Desconocido', inline: true },
                    { name: '⏱️ Duración', value: song.duration || 'Desconocida', inline: true },
                    { name: '📝 Cola', value: `${queue.songs.length} canción(es) restante(s)`, inline: true }
                );

            if (song.thumbnail) {
                nowPlayingEmbed.setThumbnail(song.thumbnail);
            }

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
                        .setLabel(queue.loop ? '🔁 Loop ON' : '🔁 Loop OFF')
                        .setStyle(queue.loop ? ButtonStyle.Success : ButtonStyle.Secondary)
                );

            // Mensaje de éxito mejorado
            if (retryCount > 0) {
                nowPlayingEmbed.setFooter({ text: `✅ Reproduciendo después de ${retryCount} reintento(s) - Anti-bloqueo activo` });
            }

            queue.textChannel.send({ embeds: [nowPlayingEmbed], components: [controlRow] });
        }

    } catch (error) {
        console.error('Error reproduciendo música:', error.message);
        
        // Detección mejorada de errores de YouTube
        const isYouTubeError = error.message.includes('Sign in to confirm') || 
                              error.message.includes('While getting info from url') ||
                              error.message.includes('Video unavailable') ||
                              error.message.includes('blocked') ||
                              error.message.includes('429') ||
                              error.message.includes('403');
        
        // Incrementar límite de reintentos para errores de YouTube
        if (isYouTubeError && retryCount < 4) { // Aumentado de 3 a 4
            const nextRetry = retryCount + 1;
            const waitTimes = [5, 10, 20, 30]; // Tiempos progresivos
            const waitTime = waitTimes[Math.min(nextRetry - 1, waitTimes.length - 1)];
            
            console.log(`Reintentando reproducción... Intento ${nextRetry}/4 en ${waitTime}s`);
            
            if (queue.textChannel) {
                const retryEmbed = createInfoEmbed('🔄 Evadiendo bloqueo de YouTube...', 
                    `Detectado bloqueo temporal. Cambiando configuración...\n` +
                    `**Intento ${nextRetry}/4** - Espera: ${waitTime}s\n` +
                    `🛡️ Sistema anti-bloqueo activo`
                );
                queue.textChannel.send({ embeds: [retryEmbed] });
            }
            
            setTimeout(() => playMusic(queue, nextRetry), waitTime * 1000);
            return;
        }
        
        // Error final después de todos los intentos
        console.log(`Saltando canción después de ${retryCount} reintentos`);
        
        if (queue.textChannel) {
            const playErrorEmbed = createErrorEmbed('❌ Error persistente', 
                retryCount >= 4 ? 
                `YouTube está bloqueando fuertemente las solicitudes.\n` +
                `**${song.title}** - Saltando después de 4 intentos.\n` +
                `💡 Intenta con otra canción o espera unos minutos.` :
                `No se pudo reproducir **${song.title}**\n` +
                `Error: ${error.message.substring(0, 100)}...`
            );
            queue.textChannel.send({ embeds: [playErrorEmbed] });
        }
        
        // Esperar más tiempo antes de la siguiente canción si fue error de YouTube
        const skipDelay = isYouTubeError ? 5000 : 2000;
        setTimeout(() => playMusic(queue, 0), skipDelay);
    }
}

client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} está conectado!`);
    
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
            .setDescription('Activa/desactiva el modo aleatorio'),
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
    if (!interaction.isChatInputCommand()) return;

    if (!ALLOWED_SERVERS.includes(interaction.guildId)) {
        return interaction.reply({ 
            content: '❌ Este bot no está autorizado en este servidor.',
            ephemeral: true 
        });
    }

    const { commandName, options, member, guild, channel } = interaction;

    if (!member.voice.channel && ['play', 'skip', 'stop', 'pause'].includes(commandName)) {
        return interaction.reply({ 
            content: '❌ Debes estar en un canal de voz para usar este comando.',
            ephemeral: true 
        });
    }

    let queue = queues.get(guild.id);

    switch (commandName) {
        case 'play':
            await interaction.deferReply();
            
            const query = options.getString('cancion');
            
            if (!queue) {
                queue = new MusicQueue();
                queues.set(guild.id, queue);
            }
            
            queue.textChannel = channel;

            if (!queue.connection) {
                queue.connection = joinVoiceChannel({
                    channelId: member.voice.channel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                });

                queue.player = createAudioPlayer();
                queue.connection.subscribe(queue.player);

                queue.player.on(AudioPlayerStatus.Idle, () => {
                    if (queue.songs.length > 0 || queue.loop) {
                        setTimeout(() => playMusic(queue), 1000);
                    } else {
                        queue.isPlaying = false;
                    }
                });

                queue.player.on('error', error => {
                    console.error('Error en el reproductor:', error);
                    setTimeout(() => playMusic(queue), 1000);
                });
            }

            let song;
            if (query.includes('youtube.com') || query.includes('youtu.be')) {
                try {
                    const info = await play.video_info(query);
                    song = {
                        title: info.video_details.title,
                        url: query,
                        duration: info.video_details.durationRaw,
                        thumbnail: info.video_details.thumbnails[0]?.url,
                        author: info.video_details.channel?.name
                    };
                } catch (error) {
                    return interaction.followUp('❌ No se pudo obtener información de esta URL.');
                }
            } else {
                song = await searchYouTube(query);
                if (!song) {
                    return interaction.followUp('❌ No se encontró ninguna canción con ese nombre.');
                }
            }

            queue.addSong(song);

            const songAddedEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Canción añadida a la cola')
                .setDescription(`**${song.title}**`)
                .addFields(
                    { name: '👤 Autor', value: song.author || 'Desconocido', inline: true },
                    { name: '⏱️ Duración', value: song.duration || 'Desconocida', inline: true },
                    { name: '📍 Posición en cola', value: `${queue.songs.length}`, inline: true }
                );

            if (song.thumbnail) {
                songAddedEmbed.setThumbnail(song.thumbnail);
            }

            await interaction.followUp({ embeds: [songAddedEmbed] });

            if (!queue.isPlaying) {
                playMusic(queue);
            }
            break;

        case 'skip':
            if (!queue || !queue.isPlaying) {
                return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });
            }

            queue.player.stop();
            await interaction.reply('⏭️ Canción saltada.');
            break;

        case 'stop':
            if (!queue) {
                return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });
            }

            queue.clear();
            queue.player?.stop();
            queue.isPlaying = false;
            await interaction.reply('⏹️ Música parada y cola limpiada.');
            break;

        case 'pause':
            if (!queue || !queue.isPlaying) {
                return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });
            }

            if (queue.player.state.status === AudioPlayerStatus.Playing) {
                queue.player.pause();
                await interaction.reply('⏸️ Música pausada.');
            } else {
                queue.player.unpause();
                await interaction.reply('▶️ Música reanudada.');
            }
            break;

        case 'queue':
            if (!queue || queue.songs.length === 0) {
                return interaction.reply({ content: '📝 La cola está vacía.', ephemeral: true });
            }

            let queueList = '';
            queue.songs.slice(0, 10).forEach((song, index) => {
                queueList += `${index + 1}. **${song.title}** - ${song.author}\n`;
            });

            if (queue.songs.length > 10) {
                queueList += `\n... y ${queue.songs.length - 10} más`;
            }

            const queueDisplayEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('📝 Cola de Música')
                .setDescription(queueList || 'La cola está vacía')
                .addFields(
                    { name: '🎵 Reproduciendo', value: queue.currentSong?.title || 'Nada', inline: true },
                    { name: '📊 Total en cola', value: `${queue.songs.length}`, inline: true },
                    { name: '🔁 Loop', value: queue.loop ? 'Activado' : 'Desactivado', inline: true }
                );

            await interaction.reply({ embeds: [queueDisplayEmbed] });
            break;

        case 'loop':
            if (!queue) {
                return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });
            }

            queue.loop = !queue.loop;
            await interaction.reply(`🔁 Loop ${queue.loop ? 'activado' : 'desactivado'}.`);
            break;

        case 'shuffle':
            if (!queue) {
                return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });
            }

            queue.shuffle = !queue.shuffle;
            await interaction.reply(`🔀 Modo aleatorio ${queue.shuffle ? 'activado' : 'desactivado'}.`);
            break;

        case 'clear':
            if (!queue || queue.songs.length === 0) {
                return interaction.reply({ content: '❌ La cola ya está vacía.', ephemeral: true });
            }

            const clearedCount = queue.songs.length;
            queue.songs = [];
            await interaction.reply(`🗑️ Se eliminaron ${clearedCount} canción(es) de la cola.`);
            break;

        case 'disconnect':
            if (!queue || !queue.connection) {
                return interaction.reply({ content: '❌ El bot no está conectado a ningún canal de voz.', ephemeral: true });
            }

            queue.connection.destroy();
            queues.delete(guild.id);
            await interaction.reply('👋 Desconectado del canal de voz.');
            break;
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const queue = queues.get(interaction.guildId);
    if (!queue) return;

    switch (interaction.customId) {
        case 'pause':
            if (queue.player.state.status === AudioPlayerStatus.Playing) {
                queue.player.pause();
                await interaction.reply({ content: '⏸️ Música pausada.', ephemeral: true });
            } else {
                queue.player.unpause();
                await interaction.reply({ content: '▶️ Música reanudada.', ephemeral: true });
            }
            break;

        case 'skip':
            queue.player.stop();
            await interaction.reply({ content: '⏭️ Canción saltada.', ephemeral: true });
            break;

        case 'stop':
            queue.clear();
            queue.player?.stop();
            queue.isPlaying = false;
            await interaction.reply({ content: '⏹️ Música parada y cola limpiada.', ephemeral: true });
            break;

        case 'loop':
            queue.loop = !queue.loop;
            await interaction.reply({ content: `🔁 Loop ${queue.loop ? 'activado' : 'desactivado'}.`, ephemeral: true });
            break;
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    if (oldState.member.id === client.user.id && oldState.channel && !newState.channel) {
        const queue = queues.get(oldState.guild.id);
        if (queue) {
            queue.clear();
            queue.isPlaying = false;
            if (queue.connection) {
                queue.connection.destroy();
            }
            queues.delete(oldState.guild.id);
        }
    }
});

client.on('error', error => {
    console.error('Error del cliente Discord:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

const http = require('http');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'Discord Music Bot Running',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        guilds: client.guilds ? client.guilds.cache.size : 0
    }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP Server running on port ${PORT}`);
});

setInterval(() => {
    // Limpiar conexiones muertas
    for (const [guildId, queue] of queues) {
        if (queue.connection && queue.connection.state.status === 'destroyed') {
            console.log(`Limpiando conexión muerta para guild ${guildId}`);
            queues.delete(guildId);
        }
    }
}, 300000); // Cada 5 minutos

console.log('🛡️ Sistema anti-bloqueo YouTube activado');

client.login(TOKEN);