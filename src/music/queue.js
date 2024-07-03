class Queue {
	constructor() {
		this.current = null
		this.queued = []
		this.looping = false
	}

	getCurrent() {
		return this.current
	}

	addSong(song, next) {
		next ? this.queued.unshift(song) : this.queued.push(song)
	}

	setLooping(looping) {
		this.looping = looping
	}

	clear() {
		// Setting length to 0 clears array
		// https://stackoverflow.com/questions/1232040/how-do-i-empty-an-array-in-javascript
		this.queued.length = 0
	}

	finishCurrentAndGetNext() {
		if (this.looping && this.current) {
			return {
				cleanup: null,
				play: this.current,
			}
		} else {
			const cleanup = this.current
			this.current = this.queued.shift() ?? null

			return {
				cleanup,
				play: this.current,
			}
		}
	}

	getTopFive() {
		return this.queued.slice(0, 5)
	}
}
