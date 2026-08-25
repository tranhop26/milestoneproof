import { parseConfig } from "@milestoneproof/shared"

const config = parseConfig([0, 3, 3, 4, 3, 259200])
if (config.classification !== "INTENTIONALLY_FROZEN" || config.infoWindowSeconds !== "259200") {
  throw new Error("shared package consumer import returned an invalid config")
}
