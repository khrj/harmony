import express from "express"

export class AudioPlayer {
	constructor() {
		this.current = ""

		const app = express()

		app.get("/", (_req, res) => res.sendFile("player.html"))
		app.get("/audio", (_req, res) => res.sendFile(this.current))
		app.listen(3000, () => console.log(`Express ready on ${port}`))
	}

	async setFile(filePath) {
		this.current = filePath
	}
}
