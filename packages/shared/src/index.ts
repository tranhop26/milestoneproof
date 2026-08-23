import ipaddr from "ipaddr.js"

export type ProjectStatus = "ACTIVE" | "COMPLETED" | "FAILED"
export type MilestoneStatus = "LOCKED" | "OPEN" | "SUBMITTED" | "APPROVED" | "FAILED"
export type Verdict = "NONE" | "APPROVED" | "REJECTED" | "REQUEST_MORE_INFO" | "UNRESOLVED"
export type SourceKind = "REPOSITORY" | "RELEASE" | "CI" | "DEPLOYMENT"

export interface EvidenceInput {
  sourceKind: SourceKind
  url: string
  subjectRef: string
  versionRef: string
  observedAt: string
}

export interface MilestoneInput {
  title: string
  criteria: string[]
  allowedSources: SourceKind[]
  deadline: string
}

export interface ProjectView {
  schemaVersion: 1
  id: string
  sponsor: string
  builder: string
  title: string
  description: string
  status: ProjectStatus
  currentMilestone: number
  createdAt: string
  milestoneCount: number
}

export interface MilestoneView {
  schemaVersion: 1
  projectId: string
  index: number
  title: string
  criteria: string[]
  allowedSources: SourceKind[]
  deadline: string
  status: MilestoneStatus
  openedAt: string
  submissionCount: number
  currentSubmissionId: string
}

export interface SubmissionView {
  schemaVersion: 2
  id: string
  projectId: string
  milestoneIndex: number
  revision: number
  verdict: Verdict
  builder: string
  submittedAt: string
  evidence: EvidenceInput[]
  digest: string
  criteriaMet: boolean[]
  missingCriteria: number[]
  integrity: {
    subjectMatch: boolean
    versionMatch: boolean
    fresh: boolean
    provenanceOk: boolean
  }
  rationale: string
  resolvedAt: string
  resolutionCount: number
  nextRetryAt: string
  freshnessDeadline: string
}

export interface ConfigView {
  classification: "INTENTIONALLY_FROZEN"
  maxMilestones: number
  maxSubmissionAttempts: number
  maxEvidenceItems: number
  maxResolutionAttempts: number
  infoWindowSeconds: string
}

export class ContractShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ContractShapeError"
  }
}

export class SchemaVersionError extends ContractShapeError {
  constructor(shape: string, received: string) {
    super(`${shape} schema version is unsupported: ${received}`)
    this.name = "SchemaVersionError"
  }
}

export class FieldCountError extends ContractShapeError {
  constructor(shape: string, expected: number, received: number) {
    super(`${shape} must contain ${expected} fields, received ${received}`)
    this.name = "FieldCountError"
  }
}

const PROJECT_STATUSES = ["ACTIVE", "COMPLETED", "FAILED"] as const
const MILESTONE_STATUSES = ["LOCKED", "OPEN", "SUBMITTED", "APPROVED", "FAILED"] as const
const VERDICTS = ["NONE", "APPROVED", "REJECTED", "REQUEST_MORE_INFO", "UNRESOLVED"] as const
const SOURCE_KINDS = ["REPOSITORY", "RELEASE", "CI", "DEPLOYMENT"] as const
const RESERVED_HOSTS = [
  "localhost",
  "local",
  "test",
  "invalid",
  "example",
  "metadata.google.internal",
  "metadata.azure.internal",
  "nip.io",
  "sslip.io",
  "xip.io",
  "localtest.me",
  "traefik.me",
] as const

function integerString(value: unknown, field: string): string {
  let parsed: bigint
  if (typeof value === "bigint") {
    parsed = value
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new ContractShapeError(`${field} must be a safe integer number`)
    }
    parsed = BigInt(value)
  } else if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    parsed = BigInt(value)
  } else {
    throw new ContractShapeError(`${field} must be a non-negative integer`)
  }
  if (parsed < 0n) {
    throw new ContractShapeError(`${field} must be a non-negative integer`)
  }
  return parsed.toString()
}

function smallInteger(value: unknown, field: string): number {
  const parsed = BigInt(integerString(value, field))
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ContractShapeError(`${field} exceeds the safe integer range`)
  }
  return Number(parsed)
}

function exactArray(value: unknown, shape: string, length: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new ContractShapeError(`${shape} must be an array`)
  }
  if (value.length !== length) {
    throw new FieldCountError(shape, length, value.length)
  }
  return value
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ContractShapeError(`${field} must be a string`)
  }
  return value
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ContractShapeError(`${field} must be a boolean`)
  }
  return value
}

function address(value: unknown, field: string): string {
  const parsed = string(value, field)
  if (!/^0x[0-9a-fA-F]{40}$/.test(parsed)) {
    throw new ContractShapeError(`${field} must be a 20-byte hexadecimal address`)
  }
  return parsed.toLowerCase()
}

function enumCode<T extends readonly string[]>(value: unknown, field: string, values: T): T[number] {
  const code = smallInteger(value, field)
  const result = values[code]
  if (result === undefined) {
    throw new ContractShapeError(`${field} has an unknown enum value: ${code}`)
  }
  return result
}

function schemaVersion(value: unknown, shape: string, expected: number): void {
  const received = integerString(value, `${shape}.schemaVersion`)
  if (received !== String(expected)) {
    throw new SchemaVersionError(shape, received)
  }
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ContractShapeError(`${field} must be an array`)
  }
  return value.map((item, index) => string(item, `${field}[${index}]`))
}

function smallIntegerArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) {
    throw new ContractShapeError(`${field} must be an array`)
  }
  return value.map((item, index) => smallInteger(item, `${field}[${index}]`))
}

function booleanArray(value: unknown, field: string): boolean[] {
  if (!Array.isArray(value)) {
    throw new ContractShapeError(`${field} must be an array`)
  }
  return value.map((item, index) => boolean(item, `${field}[${index}]`))
}

function sourceKind(value: unknown, field: string): SourceKind {
  const parsed = string(value, field)
  if (!(SOURCE_KINDS as readonly string[]).includes(parsed)) {
    throw new ContractShapeError(`${field} has an unknown source kind: ${parsed}`)
  }
  return parsed as SourceKind
}

function isNonGlobalIpv4(octets: number[]): boolean {
  const [first, second, third, fourth] = octets
  return (
    first === 0
    || first === 10
    || first === 100 && second >= 64 && second <= 127
    || first === 127
    || first === 169 && second === 254
    || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 0 && third === 0 && fourth !== 9 && fourth !== 10
    || first === 192 && second === 0 && third === 2
    || first === 192 && second === 168
    || first === 198 && (second === 18 || second === 19)
    || first === 198 && second === 51 && third === 100
    || first === 203 && second === 0 && third === 113
    || first >= 240
  )
}

function isGloballyRoutableIpv4(host: string, authority: string): boolean {
  const authorityMatch = /^(\d+\.\d+\.\d+\.\d+)(?::443)?$/.exec(authority)
  if (!authorityMatch || authorityMatch[1] !== host) {
    return false
  }
  const octets = host.split(".").map(Number)
  return !octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    && !isNonGlobalIpv4(octets)
}

const PYTHON_PRIVATE_IPV6_RANGES = [
  ["::1", 128], ["::", 128], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
  ["fc00::", 7], ["fe80::", 10],
] as const
const PYTHON_PRIVATE_IPV6_EXCEPTIONS = [
  ["2001:1::1", 128], ["2001:1::2", 128], ["2001:3::", 32],
  ["2001:4:112::", 48], ["2001:20::", 28], ["2001:30::", 28],
] as const

function matchesIpv6Ranges(address: ipaddr.IPv6, ranges: readonly (readonly [string, number])[]): boolean {
  return ranges.some(([network, prefix]) => address.match(ipaddr.IPv6.parse(network), prefix))
}

function isGloballyRoutableIpv6(host: string, authority: string): boolean {
  const authorityMatch = /^\[([0-9a-f:.]+)\](?::443)?$/i.exec(authority)
  if (!authorityMatch || !/^\[[0-9a-f:]+\]$/i.test(host)) {
    return false
  }
  const address = ipaddr.IPv6.parse(host.slice(1, -1))
  if (address.isIPv4MappedAddress()) {
    const mapped = address.toIPv4Address().octets
    return !isNonGlobalIpv4(mapped)
  }
  if (!matchesIpv6Ranges(address, PYTHON_PRIVATE_IPV6_RANGES)) {
    return true
  }
  return matchesIpv6Ranges(address, PYTHON_PRIVATE_IPV6_EXCEPTIONS)
}

function publicEvidenceUrl(value: unknown, field: string): string {
  const raw = string(value, field)
  if (!raw || raw.length > 2_000 || /[\\\x00-\x20\x7f-\uffff]/.test(raw)) {
    throw new ContractShapeError(`${field} must be a public HTTPS URL`)
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new ContractShapeError(`${field} must be a public HTTPS URL`)
  }

  const authority = raw.slice("https://".length).split(/[/?#]/, 1)[0]
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "")
  const isReservedHost = RESERVED_HOSTS.some((reserved) => host === reserved || host.endsWith(`.${reserved}`))
  const isNumericHost = /^[0-9.]+$/.test(host)
  const isIpv6Host = /^\[[0-9a-f:]+\]$/i.test(host)
  const validDnsName = host.split(".").length >= 2
    && host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || authority.includes("@")
    || parsed.hash
    || parsed.port
    || !host
    || isReservedHost
    || isNumericHost && !isGloballyRoutableIpv4(host, authority)
    || isIpv6Host && !isGloballyRoutableIpv6(host, authority)
    || !isIpv6Host && !validDnsName
  ) {
    throw new ContractShapeError(`${field} must be a public HTTPS URL`)
  }
  return raw
}

function requiredText(value: unknown, field: string): string {
  const parsed = string(value, field)
  if (!parsed) {
    throw new ContractShapeError(`${field} is required`)
  }
  return parsed
}

function evidenceFromObject(value: unknown): EvidenceInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractShapeError("evidence input must be an object")
  }
  const record = value as Record<string, unknown>
  return {
    sourceKind: sourceKind(record.sourceKind, "evidence.sourceKind"),
    url: publicEvidenceUrl(record.url, "evidence.url"),
    subjectRef: requiredText(record.subjectRef, "evidence.subjectRef"),
    versionRef: requiredText(record.versionRef, "evidence.versionRef"),
    observedAt: integerString(record.observedAt, "evidence.observedAt"),
  }
}

function evidenceFromArray(value: unknown, field: string): EvidenceInput {
  const fields = exactArray(value, field, 5)
  return evidenceFromObject({
    sourceKind: fields[0],
    url: fields[1],
    subjectRef: fields[2],
    versionRef: fields[3],
    observedAt: fields[4],
  })
}

export function parseEvidenceInput(value: unknown): EvidenceInput {
  return evidenceFromObject(value)
}

export function parseMilestoneInput(value: unknown): MilestoneInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractShapeError("milestone input must be an object")
  }
  const record = value as Record<string, unknown>
  const allowedSources = stringArray(record.allowedSources, "milestone.allowedSources")
    .map((item, index) => sourceKind(item, `milestone.allowedSources[${index}]`))
  return {
    title: requiredText(record.title, "milestone.title"),
    criteria: stringArray(record.criteria, "milestone.criteria").map((item, index) => requiredText(item, `milestone.criteria[${index}]`)),
    allowedSources,
    deadline: integerString(record.deadline, "milestone.deadline"),
  }
}

export function parseProject(value: unknown): ProjectView {
  const fields = exactArray(value, "project", 10)
  schemaVersion(fields[0], "project", 1)
  return {
    schemaVersion: 1,
    id: integerString(fields[1], "project.id"),
    sponsor: address(fields[2], "project.sponsor"),
    builder: address(fields[3], "project.builder"),
    title: string(fields[4], "project.title"),
    description: string(fields[5], "project.description"),
    status: enumCode(fields[6], "project.status", PROJECT_STATUSES),
    currentMilestone: smallInteger(fields[7], "project.currentMilestone"),
    createdAt: integerString(fields[8], "project.createdAt"),
    milestoneCount: smallInteger(fields[9], "project.milestoneCount"),
  }
}

export function parseMilestone(value: unknown): MilestoneView {
  const fields = exactArray(value, "milestone", 11)
  schemaVersion(fields[0], "milestone", 1)
  return {
    schemaVersion: 1,
    projectId: integerString(fields[1], "milestone.projectId"),
    index: smallInteger(fields[2], "milestone.index"),
    title: string(fields[3], "milestone.title"),
    criteria: stringArray(fields[4], "milestone.criteria"),
    allowedSources: stringArray(fields[5], "milestone.allowedSources")
      .map((item, index) => sourceKind(item, `milestone.allowedSources[${index}]`)),
    deadline: integerString(fields[6], "milestone.deadline"),
    status: enumCode(fields[7], "milestone.status", MILESTONE_STATUSES),
    openedAt: integerString(fields[8], "milestone.openedAt"),
    submissionCount: smallInteger(fields[9], "milestone.submissionCount"),
    currentSubmissionId: integerString(fields[10], "milestone.currentSubmissionId"),
  }
}

export function parseSubmission(value: unknown): SubmissionView {
  const fields = exactArray(value, "submission", 21)
  schemaVersion(fields[0], "submission", 2)
  if (!Array.isArray(fields[8])) {
    throw new ContractShapeError("submission.evidence must be an array")
  }
  return {
    schemaVersion: 2,
    id: integerString(fields[1], "submission.id"),
    projectId: integerString(fields[2], "submission.projectId"),
    milestoneIndex: smallInteger(fields[3], "submission.milestoneIndex"),
    revision: smallInteger(fields[4], "submission.revision"),
    verdict: enumCode(fields[5], "submission.verdict", VERDICTS),
    builder: address(fields[6], "submission.builder"),
    submittedAt: integerString(fields[7], "submission.submittedAt"),
    evidence: fields[8].map((item, index) => evidenceFromArray(item, `submission.evidence[${index}]`)),
    digest: integerString(fields[9], "submission.digest"),
    criteriaMet: booleanArray(fields[10], "submission.criteriaMet"),
    missingCriteria: smallIntegerArray(fields[11], "submission.missingCriteria"),
    integrity: {
      subjectMatch: boolean(fields[12], "submission.subjectMatch"),
      versionMatch: boolean(fields[13], "submission.versionMatch"),
      fresh: boolean(fields[14], "submission.fresh"),
      provenanceOk: boolean(fields[15], "submission.provenanceOk"),
    },
    rationale: string(fields[16], "submission.rationale"),
    resolvedAt: integerString(fields[17], "submission.resolvedAt"),
    resolutionCount: smallInteger(fields[18], "submission.resolutionCount"),
    nextRetryAt: integerString(fields[19], "submission.nextRetryAt"),
    freshnessDeadline: integerString(fields[20], "submission.freshnessDeadline"),
  }
}

export function parseConfig(value: unknown): ConfigView {
  const fields = exactArray(value, "config", 6)
  const classification = smallInteger(fields[0], "config.classification")
  if (classification !== 0) {
    throw new ContractShapeError(`config.classification has an unknown enum value: ${classification}`)
  }
  return {
    classification: "INTENTIONALLY_FROZEN",
    maxMilestones: smallInteger(fields[1], "config.maxMilestones"),
    maxSubmissionAttempts: smallInteger(fields[2], "config.maxSubmissionAttempts"),
    maxEvidenceItems: smallInteger(fields[3], "config.maxEvidenceItems"),
    maxResolutionAttempts: smallInteger(fields[4], "config.maxResolutionAttempts"),
    infoWindowSeconds: integerString(fields[5], "config.infoWindowSeconds"),
  }
}
