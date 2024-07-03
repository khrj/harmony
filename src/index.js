#!/usr/bin/env node
import { program } from "commander"
program.version("1.0.0")

import chalk from "chalk"
import clear from "clear"
import figlet from "figlet"
import { promises as fs } from "fs"
import ora from "ora"
import { join } from "path"
import puppeteer from "puppeteer-extra"

import stealth from "puppeteer-extra-plugin-stealth"
import dedent from "dedent"
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
})

browser.defaultBrowserContext().overridePermissions("https://meet.google.com", ["microphone"])

const page = (await browser.pages())[0]
await page.setExtraHTTPHeaders({ "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8" })
await page.setUserAgent(
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

const clickSelector = async selector => {
	await page.waitForSelector(selector)
	await sleep(2000)
	await page.click(selector)
}

spinner.succeed("Opened browser")

spinner.start("Changing microphone settings...")
await page.goto("chrome://settings/content/microphone", { waitUntil: "load" })
await (await page.locator("pierce/#mediaPicker").waitHandle()).select("meetusic-sink")
spinner.succeed("Selected meetusic-sink as microphone")

let nav
spinner.start("Loading page")
await page.goto("https://meet.google.com/", { waitUntil: "load" })

const domain = new URL(page.url()).host

if (domain === "workspace.google.com" || domain === "accounts.google.com") {
	spinner.succeed("Loaded page")
	spinner.info("Not signed in")
	spinner.start("Signing in")

	await page.goto("https://accounts.google.com/", { waitUntil: "networkidle0" })
	await page.focus("#identifierId")
	await page.keyboard.type(options.email)
	nav = page.waitForNavigation({ waitUntil: "networkidle0" })
	await page.keyboard.press("Enter")
	await nav
	await sleep(2000)
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
await nav

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
	await page.click('[aria-label="Close dialog"]')
} catch {
	console.log("No dialog to close")
}

await page.waitForSelector('[aria-label="Chat with everyone"]', { timeout: 0 })

spinner.succeed("Joined meeting")
spinner.start("Sending intro message")

await clickSelector('[aria-label="Chat with everyone"]')
await clickSelector('textarea[aria-label="Send a message"]')

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

	await page.waitForSelector('button[aria-label="Send a message"]')
	await page.click('button[aria-label="Send a message"]')
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
