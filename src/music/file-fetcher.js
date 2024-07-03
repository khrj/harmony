import * as youtube from "./youtube.js"
import { rm } from "fs/promises"

export class FileFetcher {
	constructor(youtubeApiKey) {
		this.referenceCounter = new FileReferenceCounter()
		this.youtubeApiKey = youtubeApiKey
	}

	async getSongDataByYoutubeId(videoId, format) {
		const metadata = await youtube.getMetadata(this.youtubeApiKey, videoId)

		return {
			id: metadata.id,
			name: `${metadata.title} by ${metadata.channel}`,
			format,
		}
	}

	getYoutubeIdFromQuery(query) {
		return youtube.searchYoutube(this.youtubeApiKey, query)
	}

	async performNextAction(nextAction) {
		if (nextAction.cleanup) {
			await this.referenceCounter.removeFileReference(
				youtube.getTempfilePath(nextAction.cleanup.id, nextAction.cleanup.format)
			)
		}

		if (nextAction.play) {
			const path = await youtube.getFileFromVideo(nextAction.play.id, nextAction.play.format)
			this.referenceCounter.addFileReference(path)
			return path
		}
	}
}

class FileReferenceCounter {
	constructor() {
		this.referenceCounter = new Map()
	}

	addFileReference(filePath) {
		this.referenceCounter.set(filePath, 1)
	}

	async removeFileReference(filePath) {
		const count = this.referenceCounter.get(filePath)
		if (!count) throw "Trying to remove missing file reference"

		if (count <= 1) {
			await rm(filePath)
			this.referenceCounter.delete(filePath)
		} else {
			this.referenceCounter.set(filePath, count - 1)
		}
	}
}
