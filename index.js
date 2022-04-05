(async () => {
    const yargs = require('yargs/yargs')
    const { hideBin } = require('yargs/helpers')
    const argv = yargs(hideBin(process.argv)).argv
    const path = require('node:path')
    const fs = require('node:fs')

    const { google } = require('googleapis')

    const tokensPath = path.join(__dirname, 'tokens.json')
    let keys = {}
    if(fs.existsSync(tokensPath)) {
        keys = require(tokensPath)
    }

    const oauth2Client = new google.auth.OAuth2(
        keys.client_id,
        keys.client_secret
    )
    oauth2Client.setCredentials({ refresh_token: keys.refresh_token })

    google.options({ auth: oauth2Client })

    let error = false
    let filepath, title, description, status, forKids, playlists
    if(!argv.filepath) {
        error = true
        console.log('Please specify a file path with --filepath')
    } else {
        if(!fs.existsSync(argv.filepath)) {
            error = true
            console.log('Specified file path does not exist')
        } else {
            filepath = argv.filepath
        }
    }
    if(!argv.title) {
        error = true
        console.log('Please specify a video title with --title')
    } else {
        title = argv.title
    }
    description = argv.description ?? ''
    status = !['public', 'private', 'unlisted'].find(s => s === argv.status) ? 'private' : argv.status
    forKids = !['yes', 'no'].find(s => s === argv.forKids) ? false : (argv.forKids === 'yes' ? true : false)
    playlists = argv.playlists ? argv.playlists.split(',').map(p => p.trim()) : []

    if(!error) {
        await uploadVideo()

        async function uploadVideo() {
            const youtube = google.youtube('v3')

            try {
                const videoId = await new Promise((resolve, reject) => {
                    youtube.videos.insert({
                        part: 'snippet,contentDetails,status',
                        requestBody: {
                            snippet: {
                                title: title,
                                description: description
                            },
                            status: {
                                privacyStatus: status,
                                madeForKids: forKids
                            }
                        },
                        media: {
                            body: fs.createReadStream(filepath)
                        }
                    },
                    (error, data) => {
                        if(error) {
                            reject(error)
                        } else {
                            resolve(data.data.id)
                        }
                    })
                })

                for(const playlist of playlists) {
                    await addVideoToPlaylist(videoId, playlist)
                }
    
                console.log('https://www.youtube.com/watch?v=' + videoId)
            } catch(error) {
                console.log({ code: error.code, reason: error.errors[0].reason, message: error.errors[0].message })
            }
        }

        async function getPlaylistByName(name) {
            const youtube = google.youtube('v3')

            let playlist = null
            let pageToken = null

            do {
                const playlists = await youtube.playlists.list({
                    part: 'id,snippet',
                    mine: true,
                    pageToken: pageToken
                })

                for(const item of playlists.data.items) {
                    if(item.snippet.title === name) {
                        playlist = item
                        break
                    }
                }

                pageToken = playlist ? null : playlists.data.nextPageToken
            } while(pageToken)

            return playlist
        }

        async function createPlaylist(name) {
            const youtube = google.youtube('v3')

            const playlist = await youtube.playlists.insert({
                part: 'id,snippet,status',
                requestBody: {
                    snippet: {
                        title: name
                    },
                    status: {
                        privacyStatus: status === 'unlisted' ? 'private' : status
                    }
                }
            })

            return playlist.id
        }

        async function addVideoToPlaylist(videoId, playlist) {
            const youtube = google.youtube('v3')

            const pl = await getPlaylistByName(playlist)
            const playlistId = pl ? pl.id : await createPlaylist(playlist)

            await youtube.playlistItems.insert({
                part: 'snippet',
                requestBody: {
                    snippet: {
                        playlistId: playlistId,
                        resourceId: {
                            kind: 'youtube#video',
                            videoId: videoId
                        }
                    }
                }
            })
        }
    }
})()