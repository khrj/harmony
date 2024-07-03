import express from "express"

export class AudioPlayer {
	constructor() {
		this.current = ""

		const app = express()

		app.get("/", (_req, res) => res.sendFile("./src/player.html", { root: process.cwd() }))
		app.get("/audio", (_req, res) => res.sendFile(this.current))
		app.listen(3000, () => {})
	}

	async setFile(filePath) {
		this.current = filePath
	}
}
