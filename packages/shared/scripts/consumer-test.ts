import { parseConfig, type ConfigView } from "@milestoneproof/shared"

const config: ConfigView = parseConfig([0, 3, 3, 4, 3, 259200])
if (config.classification !== "INTENTIONALLY_FROZEN") {
  throw new Error("shared package type consumer received an invalid config")
}
