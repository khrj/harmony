import express from "express"
import { Server } from "socket.io"
import { createServer } from "http"

export class AudioPlayer {
	constructor() {
		this.current = ""

		const app = express()

		app.get("/", (_req, res) => res.sendFile("./src/player.html", { root: process.cwd() }))
		app.get("/audio", (_req, res) => {
			if (this.current) res.sendFile(this.current)
			else res.sendStatus(201)
		})

		const server = createServer(app)

		this.io = new Server(server, {
			serveClient: false,
		})

		this.io.on("connection", socket => {
			socket.on("ended", () => {
				this.next()
			})
		})

		server.listen(3000, () => {})
	}

	async play(filePath) {
		this.current = filePath
		this.io.emit("play")
	}

	onNext(fn) {
		this.next = fn
	}
}
