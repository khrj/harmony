#!/usr/bin/env node
import { program } from "commander"
program.version("1.0.0")

import chalk from "chalk"
import clear from "clear"
import figlet from "figlet"
import { promises as fs } from "fs"
import ora from "ora"
import { join } from "path"
import { launch } from "puppeteer"

const spinner = ora()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

program
	.option("-v, --verbose", "Output debug info")
	.option("-l, --headfull", "Run chromium headfull instead of headless")
	.requiredOption("-u, --url <Your meeting URL>", "URL of meeting to join")
	.requiredOption("-e, --email <Your email address>", "Google account email")
	.requiredOption("-p, --password <Your email address password>", "Google account password")

program.parse()
clear()

const options = program.opts()

if (options.verbose) console.log(options)

console.log(
	chalk.yellow(
		figlet.textSync("Meetusic Bot", {
			font: "Standard",
			horizontalLayout: "fitted",
		})
	)
)

spinner.start("Opening browser")

const browser = await launch({
	args: ["--use-fake-ui-for-media-stream", "--mute-audio"],
	headless: !options.headfull,
	defaultViewport: null,
})

const page = (await browser.pages())[0]
await page.setExtraHTTPHeaders({ "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8" })
await page.setUserAgent(
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.181 Safari/537.36"
)

spinner.succeed("Opened browser")
spinner.start("Loading cookies (Google account)")

try {
	const cookies = JSON.parse(await fs.readFile("./cookies.json"))
	await page.setCookie(...cookies)
	spinner.succeed("Loaded cookies (Google account)")
} catch (e) {
	spinner.warn("No cookies yet")
}

let nav
spinner.start("Loading page")
// await page.goto("https://meet.google.com/", { waitUntil: "load" })


await page.goto(options.url, { waitUntil: "domcontentloaded" })
let domain = new URL(page.url()).host

await sleep(100000)

if (domain === "workspace.google.com") {
	spinner.succeed("Loaded page")
	spinner.info("Not signed in")
	spinner.start("Signing in")

	await page.goto("https://accounts.google.com/", { waitUntil: "networkidle0" })
	await page.focus("#identifierId")
	await page.keyboard.type(options.email)
	nav = page.waitForNavigation({ waitUntil: "networkidle0" })
	await page.keyboard.press("Enter")
	await nav
	await page.waitFor(2000)
	await page.focus("#identifierId")
	await page.keyboard.type(options.password)
	nav = page.waitForNavigation({ waitUntil: "networkidle0" })
	await page.keyboard.press("Enter")
	await nav

	if ((await page.$eval("title", e => e.innerHTML)) === "Google Account") {
		spinner.succeed("Signed in successfully")
		spinner.start("Writing session cookies as './cookies.json'")
		const cookies = await page.cookies()
		await fs.writeFile(join(".", "cookies.json"), JSON.stringify(cookies, null, 2))
		spinner.succeed("Wrote session cookies as './cookies.json'")
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
nav = page.waitForNavigation({ waitUntil: "networkidle0" })

await page.goto(options.url, { waitUntil: "domcontentloaded" })
await page.evaluate(() => {
	let stream = new Promise(resolve => {
		let audio = document.createElement("audio")
		audio.setAttribute("src", "https://file-examples-com.github.io/uploads/2017/11/file_example_MP3_700KB.mp3")
		audio.setAttribute("crossorigin", "anonymous")
		audio.setAttribute("controls", "")
		audio.setAttribute("loop", "")
		audio.onplay = _ => {
			let stream = audio.captureStream()
			console.log(stream.getAudioTracks())
			resolve(stream)
		}
		document.querySelector("body").appendChild(audio)
		audio.play()
	})
	navigator.mediaDevices.getUserMedia = async _ => {
		return stream
	}
})

await nav

// Join meeting
await page.evaluate(_ => {
	let spans = document.getElementsByTagName("span")
	for (const span of spans) {
		if (span.innerHTML === "Join now") {
			span.click()
		} else if (span.innerHTML === "Ask to join") {
			span.click()
		}
	}
})

await page.waitFor('[data-tooltip="Chat with everyone"]', { timeout: 0 })
spinner.succeed("Joined meeting")

spinner.start("Sending intro message")
await page.click('[data-tooltip="Chat with everyone"]')
await page.waitFor(1000) // 300 ms transition + 700 buffer
await page.click('[name="chatTextInput"]')

const shiftEnter = async _ => {
	await page.keyboard.down("Shift")
	await page.keyboard.press("Enter")
	await page.keyboard.up("Shift")
}

await page.keyboard.type(
	'Hello! I\'m Meetusic Bot, a bot that helps you play music from online sources. type "@meetusicbot /help" (without quotes) to see what I can do'
)
await shiftEnter()
await page.keyboard.type("Version: 1")
await shiftEnter()
await page.keyboard.type("Developed by @khrj")
await page.click('[data-tooltip="Send message"]')
spinner.succeed("Send intro message")

// Get messages from window
await page.exposeFunction("message", async msg => {
	if (msg.text.includes("@meetusicbot") && msg.sender !== "You") {
		msg.text = msg.text.replace("@meetusicbot", "")

		let parsed = {
			command: false,
			args: false,
			error: false,
		}

		// Find command
		for (const word of msg.text.trim().split(" ")) {
			if (word.startsWith("/")) {
				if (!parsed.command) {
					parsed.command = word.replace("/", "")
				} else {
					parsed.error = "Too many commands"
					parsed.command = false
					parsed.args = false
					break
				}
			}
		}

		if (!parsed.error) {
			if (!parsed.command) {
				parsed.error = "No commands"
			} else {
				parsed.args = msg.text.replace("/" + parsed.command, "").trim()
			}
		}

		console.log(parsed)

		// Continue logic here
		if (parsed.error) {
			await page.keyboard.type(`Error: ${parsed.error}`)
			await page.click('[data-tooltip="Send message"]')
		} else {
			//TODO
		}
	}
})

// Message listener / scraper
await page.evaluate(_ => {
	let observer = new MutationObserver(mutations => {
		mutations.forEach(mutation => {
			if (!mutation.addedNodes) return // If this is some other mutation
			for (const node of mutation.addedNodes) {
				if (node.style.order === "0") return // If this is/these are the shell(s) that meet creates
				// Get msg info
				let info = {
					sender: node.childNodes[0].childNodes[0].innerHTML,
					time: node.childNodes[0].childNodes[1].innerHTML,
					text: node.childNodes[1].childNodes[0].innerHTML,
				}
				window.message(info)

				// We need a sub listener for
				// consecutive messages within the same minute by the same person
				// as they don't count as a new message object

				let subObserver = new MutationObserver(mutations => {
					mutations.forEach(mutation => {
						if (!mutation.addedNodes) return // If this is some other mutation
						for (const node of mutation.addedNodes) {
							if (node.classList.contains("gYckH")) return // If this is/these are the shell(s) that meet creates
							// Get msg info
							let subInfo = {
								sender: info.sender,
								time: info.time,
								text: node.innerHTML,
							}
							window.message(subInfo)
						}
					})
				})

				subObserver.observe(node.childNodes[1], { childList: true })
			}
		})
	})

	let chatBox = document.querySelector('[jsname="xySENc"]')
	observer.observe(chatBox, { childList: true })
})
// await browser.close()
