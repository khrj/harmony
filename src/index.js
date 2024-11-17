#!/usr/bin/env node
import "dotenv/config"

import { program } from "commander"
program.version("1.0.0")

import chalk from "chalk"
import clear from "clear"
import figlet from "figlet"
import ora from "ora"
import puppeteer from "puppeteer-extra"

import stealth from "puppeteer-extra-plugin-stealth"
import dedent from "dedent"
import { pause, play, skip, queueList, current, resume, clearQueue, loop, setVolume } from "./music/index.js"
puppeteer.use(stealth())

const spinner = ora()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

program
	.option("-v, --verbose", "Output debug info")
	.requiredOption("-u, --url <Your meeting URL>", "URL of meeting to join")
	.requiredOption("-e, --email <Your email address>", "Google account email")
	.requiredOption("-p, --password <Your email address password>", "Google account password")

program.parse()
clear()

const options = program.opts()

if (options.verbose) console.log(options)

console.log(
	chalk.yellow(
		figlet.textSync("Harmony", {
			font: "Standard",
			horizontalLayout: "fitted",
		})
	)
)

spinner.start("Opening browser")

const browser = await puppeteer.launch({
	headless: false,
	defaultViewport: null,
	userDataDir: "./user_data",
	args: ["--auto-select-tab-capture-source-by-title=about:blank", "--autoplay-policy=no-user-gesture-required"],
})

browser.defaultBrowserContext().overridePermissions("https://meet.google.com", [])

const page = (await browser.pages())[0]

const playerPage = await browser.newPage()
await playerPage.setViewport({ width: 400, height: 225 })

await page.bringToFront()

await page.setExtraHTTPHeaders({ "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8" })
await page.setUserAgent(
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

spinner.succeed("Opened browser")

spinner.start("Loading page")
await page.goto("https://meet.google.com/", { waitUntil: "load" })

const domain = new URL(page.url()).host

if (domain === "workspace.google.com" || domain === "accounts.google.com") {
	spinner.succeed("Loaded page")
	spinner.info("Not signed in")
	spinner.start("Signing in")

	await page.goto("https://accounts.google.com/", { waitUntil: "networkidle0" })
	await page.locator("#identifierId").fill(options.email)
	await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")])

	await page.locator('#password input[type="password"]').fill(options.password)
	await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.keyboard.press("Enter")])

	await sleep(2000)

	if ((await page.$eval("title", e => e.innerHTML)) === "Google Account") {
		spinner.succeed("Signed in successfully")
	} else {
		spinner.fail("Sign in error")
		process.exit(1)
	}
} else if (domain === "meet.google.com") {
	spinner.succeed("Loaded page")
	spinner.info("Already signed in")
} else {
	spinner.fail(`Unknown domain: ${domain}`)
}

spinner.start("Joining meeting")

await Promise.all([
	page.waitForNavigation({ waitUntil: "networkidle0" }),
	page.goto(options.url, { waitUntil: "domcontentloaded" }),
])

// Join meeting
await page.evaluate(async () => {
	for (const span of document.getElementsByTagName("span")) {
		if (span.innerHTML === "Allow microphone and camera") span.click()
	}

	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
	await sleep(2000)

	for (const span of document.getElementsByTagName("span")) {
		if (span.innerHTML === "Join now" || span.innerHTML === "Ask to join" || span.innerHTML === "Switch here")
			span.click()
	}
})

try {
	await page.locator('[aria-label="Close dialog"]').click()
} catch {
	console.log("No dialog to close")
}

await page.waitForSelector('[aria-label="Chat with everyone"]', { timeout: 0 })
spinner.succeed("Joined meeting")

spinner.start("Sharing player tab")
await sleep(2000)
await page.locator("button[aria-label='Present now']").click()
await sleep(1000)
await playerPage.goto("http://localhost:3000")
spinner.succeed("Shared player tab")

spinner.start("Sending intro message")

await sleep(2000)
await page.locator('[aria-label="Chat with everyone"]').click()
await sleep(2000)
await page.locator('textarea[aria-label="Send a message"]').click()

const shiftEnter = async () => {
	await page.keyboard.down("Shift")
	await page.keyboard.press("Enter")
	await page.keyboard.up("Shift")
}

const send = async msg => {
	const lines = msg.split("\n")

	for (const line of lines) {
		await page.keyboard.type(line)
		await shiftEnter()
	}

	await page.locator('button[aria-label="Send a message"]').click()
}

await send(
	dedent`
		🤖 Harmony
		📦 v0.1.0 — 🛠️ by @khrj
		❓ /help
	`
)

spinner.succeed("Sent intro message")

// Get messages from window
await page.exposeFunction("message", async msg => {
	if (msg.text.trim().startsWith("/") && msg.sender !== "You") {
		const [command, ...args] = msg.text.trim().slice(1).split(" ")

		try {
			if (command === "help")
				await send(
					dedent`
					Commands:
					/play <song name>
					/next <song name>
					/pause
					/resume
					/skip
					/current
					/queue
					/clear
					/loop
					/volume <0-100>
				`
				)
			else if (command === "play") await play(args, send)
			else if (command === "next") {
				await play(args, send, true)
			} else if (command === "pause") {
				pause()
				await send("⏸️ Paused")
			} else if (command === "resume") {
				resume()
				await send("▶️ Resumed")
			} else if (command === "skip") await skip(send)
			else if (command === "current") await current(send)
			else if (command === "queue") await queueList(send)
			else if (command === "clear") {
				clearQueue()
				await send("🗑️ Cleared")
			} else if (command === "loop") {
				const looping = loop()
				if (looping) await send("🔁 Looping")
				else await send("➡ No longer looping")
			} else if (command === "volume") {
				try {
					const vol = parseInt(args[0])
					if (isNaN(vol)) throw "🛑 Volume must be a number between 0 and 100"

					if (vol < 0 || vol > 100) throw "🛑 Volume must be a number between 0 and 100"
					setVolume(args[0])
					await send(`🔊 Volume set to ${args[0]}`)
				} catch {
					throw "🛑 Volume must be a number between 0 and 100"
				}
			}
		} catch (e) {
			if (typeof e === "string") {
				await send(e)
			} else {
				console.error(e)
			}
		}

		if (options.verbose) console.log(command, args)
	}
})

// Message listener / scraper
await page.evaluate(() => {
	const observer = new MutationObserver(mutations => {
		mutations.forEach(mutation => {
			if (!mutation.addedNodes) return // If this is some other mutation
			for (const node of mutation.addedNodes) {
				if (node.style.order === "0") return // I

				// Get msg info
				const info = {
					sender: node.childNodes[0].childNodes[0].innerHTML,
					time: node.childNodes[0].childNodes[1].innerHTML,
					text: node.childNodes[1].childNodes[0].childNodes[0].childNodes[0].childNodes[0].innerHTML,
				}

				window.message(info)

				// We need a sub listener for
				// consecutive messages within the same minute by the same person
				// as they don't count as a new message object

				const subObserver = new MutationObserver(mutations => {
					mutations.forEach(mutation => {
						if (!mutation.addedNodes) return // If this is some other mutation
						for (const node of mutation.addedNodes) {
							if (node.classList.contains("gYckH")) return // If this is/these are the shell(s) that meet creates
							// Get msg info
							const subInfo = {
								sender: info.sender,
								time: info.time,
								text: node.childNodes[0].childNodes[0].childNodes[0].innerHTML,
							}

							window.message(subInfo)
						}
					})
				})

				subObserver.observe(node.childNodes[1], { childList: true })
			}
		})
	})

	const chatBox = document.querySelector('[jsname="xySENc"]')
	observer.observe(chatBox, { childList: true })
})
