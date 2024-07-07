import { FileFetcher } from "./file-fetcher.js"
import { AudioPlayer } from "./audio-player.js"
import { Queue } from "./queue.js"
import { getLink } from "./youtube.js"

const youtubeAPIKey = process.env.youtubeapikey
if (!youtubeAPIKey) throw "Missing youtube API key"

const audioPlayer = new AudioPlayer()
const queue = new Queue()
const fileFetcher = new FileFetcher(youtubeAPIKey)

export const play = async (args, send, next = false) => {
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

	queue.addSong(song, next)

	if (queue.getCurrent()) {
		await send(`✅ Added ${song.name} to the queue`)
		return
	}

	audioPlayer.onNext(async () => {
		try {
			await nextActionInQueue(send)
		} catch (e) {
			if (typeof e === "string") {
				throw `🛑 Error: ${e}`
			} else {
				throw e
			}
		}
	})

	await audioPlayer.next()
}

export const pause = () => audioPlayer.pause()
export const resume = () => audioPlayer.resume()
export const skip = send => {
	audioPlayer.pause()
	nextActionInQueue(send)
}

export const current = send => {
	const current = queue.getCurrent()
	if (!current) return send("🤔 No song playing")
	else return send(`🎵 Current: ${current.name} from ${getLink(current.id)}`)
}

export const queueList = send => {
	const topFive = queue.getTopFive()

	let replyMessage = topFive.length !== 0 ? `Next ${topFive.length} song(s) in queue:` : "Queue is empty"

	for (const song of topFive) {
		replyMessage += `\n• ${song.name}`
	}

	return send(replyMessage)
}

export const clearQueue = () => queue.clear()
export const loop = () => queue.toggleLooping()
export const setVolume = volume => audioPlayer.setVolume(volume)

const nextActionInQueue = async send => {
	const nextAction = queue.finishCurrentAndGetNext()

	if (nextAction.play) await send(`⏳ Fetching ${nextAction.play.name}`)

	const filePath = await fileFetcher.performNextAction(nextAction)

	if (nextAction.play && filePath) {
		audioPlayer.play(filePath)
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
