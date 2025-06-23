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

async function searchYouTube(query) {
    try {
        const searchResults = await play.search(query, { limit: 1, source: { youtube: 'video' } });
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
        console.error('Error buscando en YouTube:', error);
        return null;
    }
}

async function playMusic(queue) {
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
        const stream = await play.stream(song.url, { quality: 2 });
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type
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

            queue.textChannel.send({ embeds: [nowPlayingEmbed], components: [controlRow] });
        }

    } catch (error) {
        console.error('Error reproduciendo música:', error);
        if (queue.textChannel) {
            const playErrorEmbed = createErrorEmbed('Error', 'No se pudo reproducir esta canción. Saltando a la siguiente...');
            queue.textChannel.send({ embeds: [playErrorEmbed] });
        }
        
        setTimeout(() => playMusic(queue), 1000);
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

client.login(TOKEN);