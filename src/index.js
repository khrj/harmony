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
import { play } from "./music/index.js"
puppeteer.use(stealth())

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

const browser = await puppeteer.launch({
	headless: !options.headfull,
	defaultViewport: null,
	userDataDir: "./user_data",
	protocol: "cdp",
})

browser.defaultBrowserContext().overridePermissions("https://meet.google.com", [])
// browser.defaultBrowserContext().overridePermissions("http://localhost:3000", ["microphone"])

const page = (await browser.pages())[0]

const playerPage = await browser.newPage()
await playerPage.setViewport({ width: 900, height: 1600 })

const session = await page.createCDPSession()
session.on("javascriptDialogOpening", async params => {
	console.log(params)
})

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

await sleep(2000)
spinner.start("Sharing player tab")

await page.locator("button[aria-label='Present now']").click()

await page.keyboard.press("Tab")
await page.keyboard.press("Tab")
await page.keyboard.press("ArrowDown")
await page.keyboard.press("Enter")

await sleep(100000)

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
		Hello! I'm Meetusic Bot, a bot that helps you play music from online sources. type "@meetusicbot help" (without quotes) to see what I can do
		Version: 1
		Developed by @khrj
	`
)

spinner.succeed("Sent intro message")

// Get messages from window
await page.exposeFunction("message", async msg => {
	if (msg.text.trim().startsWith("@meetusicbot") && msg.sender !== "You") {
		const [_, command, ...args] = msg.text.trim().split(" ")

		if (command === "help") {
			await send(
				dedent`
					Here's what I can do:
					@meetusicbot play <url>: play a url
					@meetusicbot pause: pause
				`
			)
		} else if (command === "play") {
			await play(args, send)
			await playerPage.goto("http://localhost:3000")
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
