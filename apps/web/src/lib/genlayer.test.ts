import { beforeEach, describe, expect, it, vi } from "vitest"

const sdk = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  createClient: vi.fn(),
}))

vi.mock("genlayer-js", () => ({ createClient: sdk.createClient }))

import { clearWriteClientCache, writeClient, type Eip1193Provider } from "./genlayer"

describe("writeClient", () => {
  beforeEach(() => {
    sdk.connect.mockClear()
    sdk.createClient.mockReset()
    sdk.createClient.mockReturnValue({ connect: sdk.connect })
    clearWriteClientCache()
  })

  it("reuses the signer client but reconnects Studionet before every write session", async () => {
    const provider: Eip1193Provider = {
      request: async () => undefined,
    }
    const account = "0x1111111111111111111111111111111111111111" as const

    const first = await writeClient(provider, account)
    const second = await writeClient(provider, account)

    expect(first).toBe(second)
    expect(sdk.createClient).toHaveBeenCalledTimes(1)
    expect(sdk.connect).toHaveBeenNthCalledWith(1, "studionet")
    expect(sdk.connect).toHaveBeenNthCalledWith(2, "studionet")
  })
})
