from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import jsonschema


ROOT = Path(__file__).resolve().parents[3]
CONTRACT = ROOT / "packages" / "contracts" / "milestoneproof.py"
DEPLOY = ROOT / "packages" / "contracts" / "scripts" / "deploy.mjs"
VERIFY = ROOT / "packages" / "contracts" / "scripts" / "verify.mjs"
E2E = ROOT / "packages" / "contracts" / "scripts" / "e2e.mjs"
SCHEMA = ROOT / "deployments" / "schema.json"
SENTINEL_KEY = "0x" + ("1" * 64)
DEPLOY_TX = "0x" + ("a" * 64)
CONTRACT_ADDRESS = "0x" + ("c" * 40)
DEPLOYER_ADDRESS = "0x" + ("d" * 40)


def _run(script: Path, *args: str, env: dict[str, str] | None = None):
    child_env = os.environ.copy()
    child_env.update(env or {})
    return subprocess.run(
        ["node", str(script), *args],
        cwd=ROOT,
        env=child_env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def _fake_sdk(tmp_path: Path) -> Path:
    fake = tmp_path / "fake-genlayer-sdk.mjs"
    fake.write_text(
        """
import { appendFileSync, readFileSync } from "node:fs";

const log = (name) => appendFileSync(process.env.FAKE_CALL_LOG, `${name}\\n`);
export const studionet = { id: 61999, name: "GenLayer Studionet" };
export const TransactionStatus = { FINALIZED: "FINALIZED" };
export const ExecutionResult = {
  FINISHED_WITH_RETURN: "FINISHED_WITH_RETURN",
  FINISHED_WITH_ERROR: "FINISHED_WITH_ERROR",
};
export const createAccount = () => ({ address: process.env.FAKE_DEPLOYER_ADDRESS });
export const createClient = () => {
  log("createClient");
  return {
    deployContract: async () => { log("deployContract"); return process.env.FAKE_DEPLOY_TX; },
    waitForTransactionReceipt: async ({ status }) => {
      log(`wait:${status}`);
      return {
        statusName: "FINALIZED",
        txExecutionResultName: process.env.FAKE_EXECUTION_RESULT || "FINISHED_WITH_RETURN",
        txDataDecoded: { type: "deploy", contractAddress: process.env.FAKE_RECEIPT_CONTRACT_ADDRESS || process.env.FAKE_CONTRACT_ADDRESS },
      };
    },
    readContract: async ({ functionName }) => {
      log(`read:${functionName}`);
      if (functionName !== "get_config") throw new Error("unexpected read");
      return [0, 3, 3, 4, 3, 259200];
    },
    getContractCode: async () => {
      log("getContractCode");
      if (process.env.FAKE_CODE_MISMATCH === "YES") return "# different source\\n";
      return readFileSync(process.env.CONTRACT_SOURCE_PATH, "utf8");
    },
  };
};
""".strip()
        + "\n",
        encoding="utf-8",
    )
    return fake


def _fake_env(tmp_path: Path, fake: Path, manifest: Path) -> dict[str, str]:
    return {
        "NODE_ENV": "test",
        "MILESTONEPROOF_SDK_MODULE": fake.as_uri(),
        "DEPLOYER_PRIVATE_KEY": SENTINEL_KEY,
        "DEPLOYMENT_MANIFEST_PATH": str(manifest),
        "FAKE_CALL_LOG": str(tmp_path / "calls.log"),
        "FAKE_DEPLOY_TX": DEPLOY_TX,
        "FAKE_CONTRACT_ADDRESS": CONTRACT_ADDRESS,
        "FAKE_DEPLOYER_ADDRESS": DEPLOYER_ADDRESS,
        "CONTRACT_SOURCE_PATH": str(CONTRACT),
        "GENLAYER_NETWORK": "studionet",
    }


def _e2e_sdk(tmp_path: Path) -> Path:
    fake = tmp_path / "fake-e2e-sdk.mjs"
    fake.write_text(
        """
import { appendFileSync } from "node:fs";
const addresses = ["1", "2", "3"].map((digit) => `0x${digit.repeat(40)}`);
const hashes = ["a", "b", "c", "d"].map((digit) => `0x${digit.repeat(64)}`);
let actor = 0;
let stage = 0;
const log = (name) => appendFileSync(process.env.FAKE_CALL_LOG, `${name}\\n`);
export const studionet = { id: 61999, name: "GenLayer Studionet" };
export const TransactionStatus = { FINALIZED: "FINALIZED" };
export const ExecutionResult = {
  FINISHED_WITH_RETURN: "FINISHED_WITH_RETURN",
  FINISHED_WITH_ERROR: "FINISHED_WITH_ERROR",
};
export const createAccount = () => {
  log("createAccount");
  return { address: addresses[actor++] };
};
export const createClient = ({ account } = {}) => {
  log(`createClient:${account?.address || "read"}`);
  return {
    request: async ({ method, params }) => { log(`${method}:${params[0]}`); return true; },
    writeContract: async ({ functionName }) => {
      log(`write:${account.address}:${functionName}`);
      if (functionName === "create_project") { stage = 1; return hashes[0]; }
      if (functionName === "submit_evidence" && account.address === addresses[2]) return hashes[1];
      if (functionName === "submit_evidence") { stage = 2; return hashes[2]; }
      if (functionName === "resolve_submission") { stage = 3; return hashes[3]; }
      throw new Error("unexpected write");
    },
    waitForTransactionReceipt: async ({ hash, status }) => {
      log(`wait:${hash}:${status}`);
      return {
        statusName: "FINALIZED",
        txExecutionResultName: hash === hashes[1] ? "FINISHED_WITH_ERROR" : "FINISHED_WITH_RETURN",
        consensus_data: hash === hashes[1] ? { leader_receipt: [{ error: "only the builder may submit evidence" }] } : {},
      };
    },
    readContract: async ({ functionName }) => {
      log(`read:${functionName}:${stage}`);
      if (functionName === "get_project_count") return 7n;
      if (functionName === "get_project") return [1n, 7n, addresses[0], addresses[1], "SDK release proof", "Public release evidence", stage === 3 ? 1n : 0n, 0n, 1800000000n, 1n];
      if (functionName === "get_milestone") return [1n, 7n, 0n, "Verify v1.1.8", ["The public commit exists"], ["REPOSITORY"], 1900000000n, stage === 3 ? 3n : (stage === 2 ? 2n : 1n), 1800000000n, stage >= 2 ? 1n : 0n, stage >= 2 ? 9n : 0n];
      if (functionName === "get_submission") return [2n, 9n, 7n, 0n, 1n, stage === 3 ? 1n : 0n, addresses[1], 1800000010n, [], 9n, [true], [], true, true, true, true, "Approved", 1800000020n, 1n, 0n, 1900000000n];
      throw new Error("unexpected read");
    },
  };
};
""".strip()
        + "\n",
        encoding="utf-8",
    )
    return fake


def test_env_example_is_safe_when_parsed_by_deployment_loader():
    expression = """
import { loadEnvFile } from './packages/contracts/scripts/deploy.mjs';
const values = await loadEnvFile('.env.example');
process.stdout.write(JSON.stringify(values));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", expression],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    values = json.loads(result.stdout)
    assert values == {
        "VITE_GENLAYER_NETWORK": "studionet",
        "VITE_MILESTONEPROOF_ADDRESS": "",
        "DEPLOYER_PRIVATE_KEY": "",
        "VERCEL_TOKEN": "",
    }


def test_dry_run_reports_derived_identity_without_network_or_secret(tmp_path):
    preview = tmp_path / "preview.json"
    result = _run(
        DEPLOY,
        "--dry-run",
        env={
            "DEPLOYER_PRIVATE_KEY": SENTINEL_KEY,
            "DEPLOYMENT_PREVIEW_PATH": str(preview),
            "GENLAYER_NETWORK": "studionet",
        },
    )

    combined = result.stdout + result.stderr
    assert result.returncode == 0, combined
    assert SENTINEL_KEY not in combined
    assert "studionet" in result.stdout
    assert "0x" in result.stdout
    preview_text = preview.read_text(encoding="utf-8")
    assert SENTINEL_KEY not in preview_text
    preview_data = json.loads(preview_text)
    assert preview_data["network"] == "studionet"
    assert preview_data["deployerAddress"].startswith("0x")
    assert preview_data["classification"] == "INTENTIONALLY_FROZEN"
    assert "privateKey" not in preview_text


def test_deploy_refuses_without_action_time_confirmation_before_network_use(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest = tmp_path / "manifest.json"
    result = _run(DEPLOY, env=_fake_env(tmp_path, fake, manifest))

    assert result.returncode != 0
    assert "CONFIRM_DEPLOY=YES" in result.stderr
    assert not (tmp_path / "calls.log").exists()
    assert not manifest.exists()
    assert SENTINEL_KEY not in result.stdout + result.stderr


def test_confirmed_deploy_waits_verifies_readback_and_writes_secret_free_manifest(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    env = _fake_env(tmp_path, fake, manifest_path)
    env["CONFIRM_DEPLOY"] = "YES"
    result = _run(DEPLOY, env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert (tmp_path / "calls.log").read_text(encoding="utf-8").splitlines() == [
        "createClient",
        "deployContract",
        "wait:FINALIZED",
        "read:get_config",
        "getContractCode",
    ]
    manifest_text = manifest_path.read_text(encoding="utf-8")
    assert SENTINEL_KEY not in manifest_text + result.stdout + result.stderr
    manifest = json.loads(manifest_text)
    assert manifest["network"] == "studionet"
    assert manifest["contractAddress"] == CONTRACT_ADDRESS
    assert manifest["deploymentTransactionHash"] == DEPLOY_TX
    assert manifest["deployerAddress"] == DEPLOYER_ADDRESS
    assert manifest["classification"] == "INTENTIONALLY_FROZEN"
    assert manifest["verification"]["transactionStatus"] == "FINALIZED"
    assert manifest["verification"]["executionResult"] == "FINISHED_WITH_RETURN"
    assert manifest["verification"]["configReadback"] == [0, 3, 3, 4, 3, 259200]
    assert manifest["verification"]["sourceMatches"] is True
    jsonschema.validate(manifest, json.loads(SCHEMA.read_text(encoding="utf-8")))


def test_deploy_rejects_failed_execution_and_never_writes_manifest(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    env = _fake_env(tmp_path, fake, manifest_path)
    env.update({"CONFIRM_DEPLOY": "YES", "FAKE_EXECUTION_RESULT": "FINISHED_WITH_ERROR"})
    result = _run(DEPLOY, env=env)

    assert result.returncode != 0
    assert "FINISHED_WITH_RETURN" in result.stderr
    assert not manifest_path.exists()


def test_deploy_refuses_to_overwrite_an_existing_manifest(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text('{"existing":true}\n', encoding="utf-8")
    env = _fake_env(tmp_path, fake, manifest_path)
    env["CONFIRM_DEPLOY"] = "YES"
    result = _run(DEPLOY, env=env)

    assert result.returncode != 0
    assert "already exists" in result.stderr
    assert manifest_path.read_text(encoding="utf-8") == '{"existing":true}\n'
    assert not (tmp_path / "calls.log").exists()


def test_verify_rechecks_finalized_transaction_source_and_config(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    env = _fake_env(tmp_path, fake, manifest_path)
    env["CONFIRM_DEPLOY"] = "YES"
    deployed = _run(DEPLOY, env=env)
    assert deployed.returncode == 0, deployed.stderr
    (tmp_path / "calls.log").unlink()

    verified = _run(VERIFY, "--manifest", str(manifest_path), env=env)

    assert verified.returncode == 0, verified.stdout + verified.stderr
    assert "Source hash verified" in verified.stdout
    assert "Readback verified" in verified.stdout
    assert (tmp_path / "calls.log").read_text(encoding="utf-8").splitlines() == [
        "createClient",
        "wait:FINALIZED",
        "read:get_config",
        "getContractCode",
    ]


def test_verify_fails_closed_when_deployed_source_differs(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    env = _fake_env(tmp_path, fake, manifest_path)
    env["CONFIRM_DEPLOY"] = "YES"
    deployed = _run(DEPLOY, env=env)
    assert deployed.returncode == 0, deployed.stderr
    env["FAKE_CODE_MISMATCH"] = "YES"

    verified = _run(VERIFY, "--manifest", str(manifest_path), env=env)

    assert verified.returncode != 0
    assert "source hash mismatch" in verified.stderr.lower()


def test_verify_binds_manifest_address_to_deployment_transaction(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    env = _fake_env(tmp_path, fake, manifest_path)
    env["CONFIRM_DEPLOY"] = "YES"
    deployed = _run(DEPLOY, env=env)
    assert deployed.returncode == 0, deployed.stderr
    env["FAKE_RECEIPT_CONTRACT_ADDRESS"] = "0x" + ("e" * 40)

    verified = _run(VERIFY, "--manifest", str(manifest_path), env=env)

    assert verified.returncode != 0
    assert "deployment transaction produced a different contract address" in verified.stderr.lower()


def test_verify_rejects_internally_inconsistent_transaction_evidence(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    env = _fake_env(tmp_path, fake, manifest_path)
    env["CONFIRM_DEPLOY"] = "YES"
    deployed = _run(DEPLOY, env=env)
    assert deployed.returncode == 0, deployed.stderr
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["verification"]["transactionHash"] = "0x" + ("b" * 64)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    (tmp_path / "calls.log").unlink()

    verified = _run(VERIFY, "--manifest", str(manifest_path), env=env)

    assert verified.returncode != 0
    assert "verification transaction does not match" in verified.stderr.lower()
    assert not (tmp_path / "calls.log").exists()


def test_live_e2e_refuses_before_creating_accounts_or_network_clients(tmp_path):
    fake = _e2e_sdk(tmp_path)
    evidence_path = tmp_path / "live-contract.json"
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps({
        "network": "studionet",
        "contractAddress": CONTRACT_ADDRESS,
        "classification": "INTENTIONALLY_FROZEN",
        "verification": {"sourceMatches": True},
    }), encoding="utf-8")
    result = _run(E2E, "--manifest", str(manifest_path), env={
        "NODE_ENV": "test",
        "MILESTONEPROOF_SDK_MODULE": fake.as_uri(),
        "FAKE_CALL_LOG": str(tmp_path / "calls.log"),
        "LIVE_EVIDENCE_PATH": str(evidence_path),
    })

    assert result.returncode != 0
    assert "CONFIRM_LIVE_E2E=YES" in result.stderr
    assert not (tmp_path / "calls.log").exists()
    assert not evidence_path.exists()


def test_live_e2e_generates_actors_proves_success_and_unauthorized_error(tmp_path):
    fake = _e2e_sdk(tmp_path)
    evidence_path = tmp_path / "live-contract.json"
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps({
        "network": "studionet",
        "contractAddress": CONTRACT_ADDRESS,
        "classification": "INTENTIONALLY_FROZEN",
        "verification": {"sourceMatches": True},
    }), encoding="utf-8")
    result = _run(E2E, "--manifest", str(manifest_path), env={
        "NODE_ENV": "test",
        "MILESTONEPROOF_SDK_MODULE": fake.as_uri(),
        "FAKE_CALL_LOG": str(tmp_path / "calls.log"),
        "LIVE_EVIDENCE_PATH": str(evidence_path),
        "CONFIRM_LIVE_E2E": "YES",
    })

    assert result.returncode == 0, result.stdout + result.stderr
    evidence_text = evidence_path.read_text(encoding="utf-8")
    evidence = json.loads(evidence_text)
    assert evidence["network"] == "studionet"
    assert evidence["contractAddress"] == CONTRACT_ADDRESS
    assert len(set(evidence["actors"].values())) == 3
    assert evidence["transactions"]["createProject"]["executionResult"] == "FINISHED_WITH_RETURN"
    assert evidence["transactions"]["unauthorizedSubmission"]["executionResult"] == "FINISHED_WITH_ERROR"
    assert evidence["transactions"]["submitEvidence"]["executionResult"] == "FINISHED_WITH_RETURN"
    assert evidence["transactions"]["resolveSubmission"]["executionResult"] == "FINISHED_WITH_RETURN"
    assert evidence["readback"]["project"][6] == "1"
    assert evidence["readback"]["milestone"][7] == "3"
    assert evidence["readback"]["submission"][5] == "1"
    assert "private" not in evidence_text.lower()
    assert "secret" not in evidence_text.lower()
    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert calls.count("createAccount") == 3
    assert calls.count("sim_fundAccount") == 3
