import { expect, test, type Page } from "@playwright/test"
import { createAccount, createClient, generatePrivateKey } from "genlayer-js"
import { studionet } from "genlayer-js/chains"
import { env } from "node:process"

const FIXTURE = {
  sourceKind: "RELEASE",
  url: "https://raw.githubusercontent.com/genlayerlabs/genlayer-js/v1.1.8/package.json",
  subjectRef: "github.com/genlayerlabs/genlayer-js",
  versionRef: "1.1.8",
  criterion: "The official genlayerlabs/genlayer-js repository tag v1.1.8 declares package version 1.1.8.",
} as const

const LIVE_PHASES = ["AWAITING_SIGNATURE", "PENDING", "FINALIZED", "SUCCESS", "READBACK"] as const
const LIVE_EXPECT_TIMEOUT = 14 * 60 * 1_000

function generatedActor() {
  const privateKey = generatePrivateKey()
  return { account: createAccount(privateKey), privateKey }
}

async function selectActor(page: Page, privateKey: `0x${string}`, address: string) {
  await page.evaluate((selectedKey) => {
    const runtime = window as Window & { __MILESTONEPROOF_E2E_PRIVATE_KEY__?: string }
    runtime.__MILESTONEPROOF_E2E_PRIVATE_KEY__ = selectedKey
    window.dispatchEvent(new Event("milestoneproof:e2e-wallet"))
  }, privateKey)
  await expect(page.getByRole("button", {
    name: new RegExp(`${address.slice(0, 6)}.*${address.slice(-4)}`, "i"),
  })).toBeVisible()
}

async function startPhaseCapture(page: Page, captureCurrent = true) {
  await page.evaluate((shouldCaptureCurrent) => {
    const runtime = window as Window & { __MILESTONEPROOF_E2E_PHASES__?: string[] }
    runtime.__MILESTONEPROOF_E2E_PHASES__ = []
    const lifecyclePhases = new Set(["AWAITING_SIGNATURE", "PENDING", "FINALIZED", "SUCCESS", "READBACK"])
    const capture = () => {
      document.querySelectorAll<HTMLElement>("[data-transaction-phase]").forEach((panel) => {
        const phase = panel.dataset.transactionPhase
        if (phase && lifecyclePhases.has(phase)
          && runtime.__MILESTONEPROOF_E2E_PHASES__?.at(-1) !== phase) {
          runtime.__MILESTONEPROOF_E2E_PHASES__?.push(phase)
        }
      })
    }
    new MutationObserver(capture).observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-transaction-phase"],
    })
    if (shouldCaptureCurrent) capture()
  }, captureCurrent)
}

async function expectHappyPhases(page: Page, timeout = 30_000) {
  await expect.poll(async () => page.evaluate(() => (
    (window as Window & { __MILESTONEPROOF_E2E_PHASES__?: string[] })
      .__MILESTONEPROOF_E2E_PHASES__ ?? []
  )), { timeout }).toEqual([...LIVE_PHASES])
}

test("a FINISHED_WITH_ERROR receipt never reaches success or readback", async ({ page }) => {
  await page.route("**/__e2e/receipt", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      statusName: "FINALIZED",
      txExecutionResultName: "FINISHED_WITH_ERROR",
      consensus_data: { leader_receipt: [{ error: "Only the frozen builder can submit evidence." }] },
    }),
  }))
  await page.goto("/e2e/fixtures/transaction.html")
  await page.getByRole("button", { name: "Submit fixture transaction" }).click()

  await expect(page.getByTestId("fixture-phase")).toHaveText("ERROR")
  await expect(page.getByText("Only the frozen builder can submit evidence.")).toBeVisible()
  await expect(page.getByTestId("readback-calls")).toHaveText("0")
  const progress = page.getByRole("list", { name: "Transaction progress" })
  await expect(progress.getByText("SUCCESS").locator("..")).not.toHaveClass(/step-complete/)
  await expect(progress.getByText("READBACK").locator("..")).not.toHaveClass(/step-complete/)
})

test("a successful receipt renders every truthful lifecycle phase in order", async ({ page }) => {
  await page.route("**/__e2e/receipt", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      statusName: "FINALIZED",
      txExecutionResultName: "FINISHED_WITH_RETURN",
      consensus_data: { leader_receipt: [{ result: "1" }] },
    }),
  }))
  await page.goto("/e2e/fixtures/transaction.html")
  await startPhaseCapture(page, false)
  await page.getByRole("button", { name: "Submit fixture transaction" }).click()

  await expectHappyPhases(page)
  await expect(page.getByTestId("fixture-phase")).toHaveText("READBACK")
  await expect(page.getByTestId("readback-calls")).toHaveText("1")
})

test("responsive shell preserves navigation, workspace, hashes, and touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/e2e/fixtures/transaction.html")

  await expect(page.locator(".desktop-sidebar")).toBeVisible()
  await expect(page.getByTestId("workspace-columns")).toBeVisible()
  await expect(page.getByRole("list", { name: "Project milestones" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Execution status" })).toBeVisible()
  const desktopCards = await page.getByTestId("workspace-columns").locator(":scope > *").evaluateAll((nodes) => (
    nodes.map((node) => node.getBoundingClientRect().x)
  ))
  expect(desktopCards[1]).toBeGreaterThan(desktopCards[0])

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator(".desktop-sidebar")).toBeHidden()
  await page.getByRole("button", { name: "Open navigation" }).click()
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible()
  await page.getByRole("button", { name: "Close navigation" }).click()

  const mobileCards = await page.getByTestId("workspace-columns").locator(":scope > *").evaluateAll((nodes) => (
    nodes.map((node) => node.getBoundingClientRect()).map(({ x, y }) => ({ x, y }))
  ))
  expect(Math.abs(mobileCards[0].x - mobileCards[1].x)).toBeLessThan(2)
  expect(mobileCards[1].y).toBeGreaterThan(mobileCards[0].y)
  const hashLink = page.getByRole("link", { name: /^0x[0-9a-f]{64}$/ })
  const hashBox = await hashLink.boundingBox()
  expect(hashBox).not.toBeNull()
  expect((hashBox?.x ?? 0) + (hashBox?.width ?? 0)).toBeLessThanOrEqual(390)
  expect(await hashLink.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  expect(await page.locator(".transaction-panel").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const undersizedControls = await page.locator("button, .brand, .nav-item, .transaction-link").evaluateAll((nodes) => (
    nodes.filter((node) => {
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)
    }).map((node) => ({ label: node.textContent?.trim(), box: node.getBoundingClientRect().toJSON() }))
  ))
  expect(undersizedControls).toEqual([])
})

test.describe("@live contract lifecycle", () => {
  test.skip(!env.E2E_CONTRACT_ADDRESS, "E2E_CONTRACT_ADDRESS is required")
  test.skip(env.CONFIRM_LIVE_E2E !== "YES", "CONFIRM_LIVE_E2E=YES is required after action-time confirmation")

  test("creates, submits, resolves, and reads back a milestone", async ({ page }) => {
    test.setTimeout(40 * 60 * 1_000)
    const sponsor = generatedActor()
    const builder = generatedActor()
    const stranger = generatedActor()
    const actors = [sponsor, builder, stranger]
    const actorAddresses = actors.map(({ account }) => account.address)
    expect(new Set(actorAddresses.map((address) => address.toLowerCase())).size).toBe(3)

    const fundingClient = createClient({ chain: studionet })
    for (const address of actorAddresses) {
      await fundingClient.request({ method: "sim_fundAccount", params: [address, 100] })
      await expect.poll(async () => BigInt(await fundingClient.getBalance({ address }))).toBeGreaterThan(0n)
    }

    await page.addInitScript((privateKey) => {
      ;(window as Window & { __MILESTONEPROOF_E2E_PRIVATE_KEY__?: string })
        .__MILESTONEPROOF_E2E_PRIVATE_KEY__ = privateKey
    }, sponsor.privateKey)
    await page.goto("/")
    await page.getByRole("link", { name: "Create project" }).click()
    await expect(page.getByLabel("Sponsor address")).toHaveValue(sponsor.account.address.toLowerCase())

    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 16)
    await page.getByLabel("Builder address").fill(builder.account.address)
    await page.getByLabel("Project title").fill("Browser-to-contract release proof")
    await page.getByLabel("Project description").fill("A live browser lifecycle that proves contract-authoritative milestone acceptance.")
    await page.getByLabel("Milestone 1 title").fill("Verify GenLayer SDK v1.1.8")
    await page.getByLabel("Milestone 1 acceptance criteria").fill(FIXTURE.criterion)
    await page.getByLabel("Milestone 1 allowed evidence").selectOption(FIXTURE.sourceKind)
    await page.getByLabel("Milestone 1 deadline").fill(deadline)
    await page.getByRole("button", { name: "Add milestone" }).click()
    await page.getByLabel("Milestone 2 title").fill("Publish follow-up verification")
    await page.getByLabel("Milestone 2 acceptance criteria").fill("A second evidence revision documents the verified release.")
    await page.getByLabel("Milestone 2 deadline").fill(deadline)

    await startPhaseCapture(page, false)
    await page.getByRole("button", { name: "Create project on-chain" }).click()
    await expect(page).toHaveURL(/\/projects\/\d+$/, { timeout: LIVE_EXPECT_TIMEOUT })
    await expectHappyPhases(page, LIVE_EXPECT_TIMEOUT)
    const projectUrl = page.url()

    await selectActor(page, stranger.privateKey, stranger.account.address)
    await page.getByRole("tab", { name: "Evidence" }).click()
    await expect(page.getByRole("heading", { name: "Builder action required" })).toBeVisible()
    await expect(page.getByText("Only the frozen builder can submit evidence for this open milestone.")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Browser-to-contract release proof" })).toBeVisible()

    await selectActor(page, builder.privateKey, builder.account.address)
    await expect(page.getByRole("heading", { name: "Evidence revision" })).toBeVisible()
    await page.getByLabel("Evidence 1 URL").fill(FIXTURE.url)
    await page.getByLabel("Evidence 1 subject").fill(FIXTURE.subjectRef)
    await page.getByLabel("Evidence 1 version").fill(FIXTURE.versionRef)
    await page.getByLabel("Evidence 1 observed at").fill(new Date().toISOString().slice(0, 16))
    await startPhaseCapture(page, false)
    await page.getByRole("button", { name: "Submit evidence" }).click()
    await expectHappyPhases(page, LIVE_EXPECT_TIMEOUT)

    await page.getByRole("tab", { name: "Submissions" }).click()
    await page.getByRole("link", { name: /Submission #/ }).click()
    await selectActor(page, sponsor.privateKey, sponsor.account.address)
    await startPhaseCapture(page, false)
    await page.getByRole("button", { name: "Resolve submission" }).click()
    await expectHappyPhases(page, LIVE_EXPECT_TIMEOUT)
    await expect(page.getByText("This submission is terminal; repeat actions are suppressed.")).toBeVisible()

    await page.goto(projectUrl)
    await page.reload()
    const milestones = page.getByRole("list", { name: "Project milestones" })
    await expect(milestones.getByText("Publish follow-up verification")).toBeVisible()
    await expect(milestones.getByText("Open")).toBeVisible()
    await expect(page.getByText("Authoritative readback")).toBeVisible()
  })
})
