import contractShape from "../contract-shape.json"
import evidenceVectors from "../evidence-vectors.json"
import { describe, expect, it } from "vitest"
import {
  ContractShapeError,
  FieldCountError,
  SchemaVersionError,
  parseConfig,
  parseEvidenceInput,
  parseMilestone,
  parseProject,
  parseSubmission,
} from "./index"

describe("contract read parsers", () => {
  it("parses the versioned project read shape", () => {
    const project = parseProject(contractShape.project)

    expect(project.schemaVersion).toBe(1)
    expect(project.currentMilestone).toBe(0)
    expect(project.id).toBe("1")
    expect(project.sponsor).toMatch(/^0x[0-9a-f]{40}$/i)
  })

  it("parses generated milestone, submission, and config shapes", () => {
    expect(parseMilestone(contractShape.milestone)).toMatchObject({
      schemaVersion: 1,
      projectId: "1",
      index: 0,
      status: "SUBMITTED",
    })
    expect(parseSubmission(contractShape.submission)).toMatchObject({
      schemaVersion: 2,
      id: expect.any(String),
      verdict: "NONE",
      resolutionCount: 0,
      resolvedAt: "0",
      nextRetryAt: "0",
    })
    expect(parseConfig(contractShape.config)).toEqual({
      classification: "INTENTIONALLY_FROZEN",
      maxMilestones: 3,
      maxSubmissionAttempts: 3,
      maxEvidenceItems: 4,
      maxResolutionAttempts: 3,
      infoWindowSeconds: "259200",
    })
  })

  it("normalizes number, bigint, and decimal-string chain integers", () => {
    const shape: unknown[] = [...contractShape.project]
    shape[1] = 1
    shape[7] = 0n
    shape[8] = "0"

    expect(parseProject(shape)).toMatchObject({
      id: "1",
      currentMilestone: 0,
      createdAt: "0",
    })
  })

  it("rejects unsupported schema versions and field counts", () => {
    expect(() => parseProject([2, ...contractShape.project.slice(1)])).toThrow(SchemaVersionError)
    expect(() => parseMilestone(contractShape.milestone.slice(0, -1))).toThrow(FieldCountError)
    expect(() => parseSubmission(contractShape.submission.slice(0, -1))).toThrow(FieldCountError)
  })

  it("rejects unknown enum values and unsafe evidence URLs", () => {
    const project = [...contractShape.project]
    project[6] = "99"
    expect(() => parseProject(project)).toThrow(ContractShapeError)

    for (const url of evidenceVectors.invalid) {
      expect(() => parseEvidenceInput({
        sourceKind: "REPOSITORY",
        url,
        subjectRef: "github.com/acme/milestoneproof",
        versionRef: "0123456789abcdef0123456789abcdef01234567",
        observedAt: "0",
      })).toThrow(ContractShapeError)
    }

    for (const url of evidenceVectors.valid) {
      expect(() => parseEvidenceInput({
        sourceKind: "REPOSITORY",
        url,
        subjectRef: "github.com/acme/milestoneproof",
        versionRef: "0123456789abcdef0123456789abcdef01234567",
        observedAt: "0",
      })).not.toThrow()
    }
  })

  it("rejects malformed addresses and wrong primitive types", () => {
    const malformedAddress: unknown[] = [...contractShape.project]
    malformedAddress[2] = "0xnot-an-address"
    expect(() => parseProject(malformedAddress)).toThrow(ContractShapeError)

    const unsafeNumber: unknown[] = [...contractShape.project]
    unsafeNumber[8] = Number.MAX_SAFE_INTEGER + 1
    expect(() => parseProject(unsafeNumber)).toThrow(ContractShapeError)

    const malformedSubmission: unknown[] = [...contractShape.submission]
    malformedSubmission[12] = "false"
    expect(() => parseSubmission(malformedSubmission)).toThrow(ContractShapeError)
  })
})
