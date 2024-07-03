import { Temporal } from "@js-temporal/polyfill"
import { execa } from "execa"
import { array, object, string } from "yup"

const videosApiResponseSchema = object({
	items: array(
		object({
			snippet: object({
				title: string().required(),
				channelTitle: string().required(),
				liveBroadcastContent: string().required(),
			}).required(),
			contentDetails: object({
				duration: string().required(),
			}).required(),
		})
	).required(),
})

const searchApiResponseSchema = object({
	items: array(
		object({
			id: object({
				videoId: string().required(),
			}).required(),
		})
	).required(),
})

export const getMetadata = async (apiKey, id) => {
	const url = new URL("https://www.googleapis.com/youtube/v3/videos")
	url.search = new URLSearchParams({
		key: apiKey,
		part: "contentDetails,snippet",
		id,
	}).toString()

	const data = await fetch(url.toString()).then(r => r.json())

	let response
	try {
		response = await videosApiResponseSchema.validate(data)
	} catch {
		throw "[Probably a bug] Bad response from metadata API"
	}

	if (response.items.length === 0) throw "Invalid video ID"

	const allInfo = response.items[0]
	if (allInfo.snippet.liveBroadcastContent !== "none") throw `Cannot play livestreams (for <https://youtu.be/${id}>)`

	if (Temporal.Duration.from(allInfo.contentDetails.duration).total("second") >= 600)
		throw `Over 10 minutes in duration (for <https://youtu.be/${id}>)`

	return {
		id: id,
		title: allInfo.snippet.title,
		channel: allInfo.snippet.channelTitle,
	}
}

export const searchYoutube = async (apiKey, query) => {
	const url = new URL("https://www.googleapis.com/youtube/v3/search")
	url.search = new URLSearchParams({
		key: apiKey,
		type: "video",
		maxResults: "1",
		q: query,
	}).toString()

	const data = await fetch(url.toString()).then(r => r.json())

	let response
	try {
		response = await searchApiResponseSchema.validate(data)
	} catch {
		throw "[Probably a bug] Bad response from metadata API"
	}

	if (response.items.length === 0) throw "No results for search query"

	return response.items[0].id.videoId
}

export const getFileFromVideo = async (id, format) => {
	const path = getTempfilePath(id, format)

	try {
		await execa("yt-dlp", [id, "-f", "bestaudio", "-x", "--audio-format", format, "-o", path, "--force-ipv4"])
	} catch (e) {
		console.error(e)
		throw "[Probably a bug] Unknown error while fetching video"
	}

	return path
}

const getTempfilePath = (provider, id, format) => `/tmp/doba-${provider}-${id}.${format}`
const getLink = id => `https://youtu.be/${id}`
