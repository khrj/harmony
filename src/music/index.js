import { FileFetcher } from "./file-fetcher.js"
import { AudioPlayer } from "./audio-player.js"
import { Queue } from "./queue.js"

const youtubeAPIKey = process.env.youtubeapikey
if (!youtubeAPIKey) throw "Missing youtube API key"

const audioPlayer = new AudioPlayer()
const queue = new Queue()
const fileFetcher = new FileFetcher(youtubeAPIKey)

export const play = async (args, send) => {
	if (!args || !args[0]) throw "🛑 Error: No query or URL"
	let videoId = getVideoIDFromURL(args[0])

	if (!videoId) {
		const query = args.join(" ")
		await send(`⏳ Searching youtube for ${query}...`)

		try {
			videoId = await fileFetcher.getYoutubeIdFromQuery(query)
		} catch (e) {
			if (typeof e === "string") {
				throw `🛑 Error: ${e}`
			} else {
				throw e
			}
		}
	}

	await send("⏳ Fetching song data...")

	let song
	try {
		song = await fileFetcher.getSongDataByYoutubeId(videoId, "opus")
	} catch (e) {
		if (typeof e === "string") {
			throw `🛑 Error: ${e}`
		} else {
			throw e
		}
	}

	queue.addSong(song, false)

	if (queue.getCurrent()) {
		return send(`✅ Added ${queuedSong.name} to the queue`)
	}

	// TODO: A way for the player to notify when it is done playing so that the
	// next song can be played

	try {
		await nextActionInQueue(send)
	} catch (e) {
		if (typeof e === "string") {
			throw `🛑 Error: ${e}`
		} else {
			throw e
		}
	}
}

const nextActionInQueue = async send => {
	const nextAction = queue.finishCurrentAndGetNext()

	if (nextAction.play) await send(`⏳ Fetching ${nextAction.play.name}`)

	const filePath = await fileFetcher.performNextAction(nextAction)

	if (nextAction.play && filePath) {
		await audioPlayer.setFile(filePath)
		await send(`🎶 Playing ${nextAction.play.name}`)
	} else {
		await send("⏹️ Queue over")
	}
}

const getVideoIDFromURL = url => {
	// eslint-disable-next-line no-useless-escape
	const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/
	const match = url.match(regExp)

	// Santize input: check if only letters and numbers are present
	if (match && match[2].length === 11 && /^[a-zA-Z0-9]+$/.test(match[2])) {
		return match[2]
	} else {
		return null
	}
}
