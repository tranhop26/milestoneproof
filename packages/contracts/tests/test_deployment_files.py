from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import jsonschema
import pytest


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
    child_env.pop("CONFIRM_DEPLOY", None)
    child_env.pop("CONFIRM_LIVE_E2E", None)
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
export const studionet = {
  id: 61999,
  name: "GenLayer Studionet",
  blockExplorers: { default: { url: "https://sdk-studionet-explorer.example" } },
};
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
        from_address: process.env.FAKE_RECEIPT_DEPLOYER_ADDRESS || process.env.FAKE_DEPLOYER_ADDRESS,
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
      const source = readFileSync(process.env.CONTRACT_SOURCE_PATH, "utf8");
      if (process.env.FAKE_CODE_CRLF === "YES") return source.replace(/\\r?\\n/g, "\\r\\n");
      return source;
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
const funded = new Set();
const log = (name) => appendFileSync(process.env.FAKE_CALL_LOG, `${name}\\n`);
export const studionet = {
  id: 61999,
  name: "GenLayer Studionet",
  blockExplorers: { default: { url: "https://sdk-studionet-explorer.example" } },
};
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
    getBalance: async ({ address }) => {
      log(`getBalance:${address}`);
      if (process.env.FAKE_FUNDING_NO_BALANCE === "YES") return 0n;
      if (process.env.FAKE_FUNDING_UNCHANGED_POSITIVE === "YES") return 100n;
      return funded.has(address) ? 100n : 0n;
    },
    request: async ({ method, params }) => {
      log(`${method}:${params[0]}`);
      if (method !== "sim_fundAccount") throw new Error("unexpected request");
      if (process.env.FAKE_FUNDING_FAILURE === "YES") throw new Error("faucet unavailable");
      funded.add(params[0]);
      if (process.env.FAKE_FUNDING_RESPONSE === "TRUE") return true;
      if (process.env.FAKE_FUNDING_RESPONSE === "OPAQUE") return { accepted: true };
      if (process.env.FAKE_FUNDING_RESPONSE === "NULL") return null;
      return `0x${"f".repeat(64)}`;
    },
    writeContract: async ({ functionName }) => {
      log(`write:${account.address}:${functionName}`);
      if (functionName === "create_project") { stage = 1; return hashes[0]; }
      if (functionName === "submit_evidence" && account.address === addresses[2]) {
        if (process.env.FAKE_UNAUTHORIZED_MUTATION === "YES") stage = 2;
        return hashes[1];
      }
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
      if (functionName === "get_project_count") return 999n;
      if (functionName === "get_sponsor_project_count") return 1n;
      if (functionName === "get_sponsor_project_ids") return [7n];
      if (functionName === "get_project") return [1n, 7n, addresses[0], process.env.FAKE_PROJECT_BUILDER || addresses[1], process.env.FAKE_PROJECT_TITLE || "SDK GitHub release proof", "Verify a GenLayer SDK version at an immutable official repository tag.", stage === 3 ? 1n : 0n, 0n, 1800000000n, 1n];
      if (functionName === "get_milestone") return [1n, 7n, 0n, process.env.FAKE_MILESTONE_TITLE || "Verify v1.1.8", ["The official genlayerlabs/genlayer-js repository tag v1.1.8 declares package version 1.1.8."], ["RELEASE"], 1900000000n, stage === 3 ? 3n : (stage === 2 ? 2n : 1n), 1800000000n, stage >= 2 ? 1n : 0n, stage >= 2 ? 9n : 0n];
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


def _manifest_data() -> dict:
    return {
        "schemaVersion": 1,
        "network": "studionet",
        "contractAddress": CONTRACT_ADDRESS,
        "deploymentTransactionHash": DEPLOY_TX,
        "deployerAddress": DEPLOYER_ADDRESS,
        "sourceSha256": "a" * 64,
        "deployedAt": "2026-08-23T00:00:00.000Z",
        "classification": "INTENTIONALLY_FROZEN",
        "explorerUrl": f"https://sdk-studionet-explorer.example/tx/{DEPLOY_TX}",
        "verification": {
            "transactionHash": DEPLOY_TX,
            "transactionStatus": "FINALIZED",
            "executionResult": "FINISHED_WITH_RETURN",
            "verifiedAt": "2026-08-23T00:00:00.000Z",
            "sourceMatches": True,
            "configReadback": [0, 3, 3, 4, 3, 259200],
        },
    }


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
        "GENLAYER_NETWORK": "studionet",
        "DEPLOYER_PRIVATE_KEY": "",
        "DEPLOYMENT_MANIFEST_PATH": "",
        "E2E_CONTRACT_ADDRESS": "",
        "CONFIRM_LIVE_E2E": "",
        "CONFIRM_DEPLOY": "",
        "VERCEL_TOKEN": "",
    }


def test_receipt_guard_accepts_real_sdk_118_simplified_status_shape():
    expression = """
import { simplifyTransactionReceipt } from 'genlayer-js';
import { assertSuccessfulFinalized } from './scripts/lib.mjs';
const receipt = simplifyTransactionReceipt({
  statusName: 'FINALIZED',
  txExecutionResultName: 'FINISHED_WITH_RETURN',
});
if (receipt.status_name !== 'FINALIZED') throw new Error('SDK characterization failed');
assertSuccessfulFinalized(receipt, 'FINISHED_WITH_RETURN');
"""
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", expression],
        cwd=ROOT / "packages" / "contracts",
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize(
    ("leader_execution", "leader_status", "expected"),
    [
        ("SUCCESS", "return", "FINISHED_WITH_RETURN"),
        ("ERROR", "contract_error", "FINISHED_WITH_ERROR"),
    ],
)
def test_receipt_guard_maps_studionet_consensus_execution_shape(
    leader_execution, leader_status, expected
):
    expression = f"""
import {{ assertSuccessfulFinalized }} from './scripts/lib.mjs';
assertSuccessfulFinalized({{
  statusName: 'FINALIZED',
  result_name: 'MAJORITY_AGREE',
  consensus_data: {{
    leader_receipt: [
      {{ mode: 'leader', execution_result: '{leader_execution}', result: {{ status: '{leader_status}' }} }},
      {{ mode: 'validator', vote: 'idle', execution_result: 'ERROR', result: {{ status: 'contract_error' }} }},
    ],
  }},
}}, '{expected}');
"""
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", expression],
        cwd=ROOT / "packages" / "contracts",
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_explorer_link_uses_locked_real_sdk_118_studionet_authority():
    expression = f"""
import {{ studionet }} from 'genlayer-js/chains';
import {{ explorerTransactionUrl }} from './scripts/lib.mjs';
const actual = explorerTransactionUrl(studionet, '{DEPLOY_TX}');
const expected = 'https://genlayer-explorer.vercel.app/tx/{DEPLOY_TX}';
if (actual !== expected) throw new Error(`expected ${{expected}}, received ${{actual}}`);
"""
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", expression],
        cwd=ROOT / "packages" / "contracts",
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr


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


def test_main_redacts_private_key_loaded_from_env_file(tmp_path):
    env_file = tmp_path / ".env"
    missing_sdk = tmp_path / f"missing-{SENTINEL_KEY}.mjs"
    env_file.write_text("\n".join([
        f"DEPLOYER_PRIVATE_KEY={SENTINEL_KEY}",
        "NODE_ENV=test",
        f"MILESTONEPROOF_SDK_MODULE={missing_sdk.as_uri()}",
        "GENLAYER_NETWORK=studionet",
    ]) + "\n", encoding="utf-8")
    child_env = os.environ.copy()
    child_env.pop("DEPLOYER_PRIVATE_KEY", None)
    child_env.pop("MILESTONEPROOF_SDK_MODULE", None)
    child_env["MILESTONEPROOF_ENV_FILE"] = str(env_file)

    result = subprocess.run(
        ["node", str(DEPLOY), "--dry-run"],
        cwd=ROOT,
        env=child_env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode != 0
    assert SENTINEL_KEY not in result.stdout + result.stderr
    assert "[REDACTED]" in result.stderr


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
    assert manifest["explorerUrl"] == f"https://sdk-studionet-explorer.example/tx/{DEPLOY_TX}"
    jsonschema.validate(manifest, json.loads(SCHEMA.read_text(encoding="utf-8")))


def test_root_deploy_wrapper_executes_the_contract_package_script(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "root-wrapper-manifest.json"
    child_env = {
        key: os.environ[key]
        for key in ("PATH", "SystemRoot", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA")
        if key in os.environ
    }
    child_env.update(_fake_env(tmp_path, fake, manifest_path))
    child_env["CONFIRM_DEPLOY"] = "YES"
    pnpm = shutil.which("pnpm.cmd" if os.name == "nt" else "pnpm")
    assert pnpm is not None

    result = subprocess.run(
        [pnpm, "run", "deploy:contract"],
        cwd=ROOT,
        env=child_env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert manifest_path.exists()


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


def test_verify_accepts_source_with_only_crlf_transport_normalization(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    env = _fake_env(tmp_path, fake, manifest_path)
    env["CONFIRM_DEPLOY"] = "YES"
    deployed = _run(DEPLOY, env=env)
    assert deployed.returncode == 0, deployed.stderr
    env["FAKE_CODE_CRLF"] = "YES"

    verified = _run(VERIFY, "--manifest", str(manifest_path), env=env)

    assert verified.returncode == 0, verified.stdout + verified.stderr
    assert "Source hash verified" in verified.stdout


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


def test_verify_binds_manifest_deployer_to_transaction_sender(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    env = _fake_env(tmp_path, fake, manifest_path)
    env["CONFIRM_DEPLOY"] = "YES"
    deployed = _run(DEPLOY, env=env)
    assert deployed.returncode == 0, deployed.stderr
    env["FAKE_RECEIPT_DEPLOYER_ADDRESS"] = "0x" + ("e" * 40)

    verified = _run(VERIFY, "--manifest", str(manifest_path), env=env)

    assert verified.returncode != 0
    assert "deployer" in verified.stderr.lower()


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


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("classification",), "UPGRADABLE"),
        (("deployerAddress",), "not-an-address"),
        (("explorerUrl",), "http://unsafe.example/tx"),
        (("verification", "transactionStatus"), "PENDING"),
        (("verification", "sourceMatches"), False),
    ],
)
def test_verify_rejects_schema_invalid_manifest_before_network(tmp_path, path, value):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    env = _fake_env(tmp_path, fake, manifest_path)
    env["CONFIRM_DEPLOY"] = "YES"
    deployed = _run(DEPLOY, env=env)
    assert deployed.returncode == 0, deployed.stderr
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    target = manifest
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    (tmp_path / "calls.log").unlink()

    verified = _run(VERIFY, "--manifest", str(manifest_path), env=env)

    assert verified.returncode != 0
    assert "schema" in verified.stderr.lower()
    assert not (tmp_path / "calls.log").exists()


def test_verify_rejects_explorer_not_bound_to_sdk_chain_before_network(tmp_path):
    fake = _fake_sdk(tmp_path)
    manifest_path = tmp_path / "manifest.json"
    env = _fake_env(tmp_path, fake, manifest_path)
    env["CONFIRM_DEPLOY"] = "YES"
    deployed = _run(DEPLOY, env=env)
    assert deployed.returncode == 0, deployed.stderr
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["explorerUrl"] = f"https://wrong-explorer.example/tx/{DEPLOY_TX}"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    (tmp_path / "calls.log").unlink()

    verified = _run(VERIFY, "--manifest", str(manifest_path), env=env)

    assert verified.returncode != 0
    assert "locked sdk chain" in verified.stderr.lower()
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


def test_live_e2e_refuses_existing_evidence_before_loading_sdk_or_funding(tmp_path):
    evidence_path = tmp_path / "live-contract.json"
    evidence_path.write_text('{"existing":true}\n', encoding="utf-8")
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text("{}\n", encoding="utf-8")
    result = _run(E2E, "--manifest", str(manifest_path), env={
        "CONFIRM_LIVE_E2E": "YES",
        "MILESTONEPROOF_SDK_MODULE": (tmp_path / "missing-sdk.mjs").as_uri(),
        "FAKE_CALL_LOG": str(tmp_path / "calls.log"),
        "LIVE_EVIDENCE_PATH": str(evidence_path),
        "NODE_ENV": "test",
    })

    assert result.returncode != 0
    assert "already exists" in result.stderr.lower()
    assert not (tmp_path / "calls.log").exists()


def test_live_e2e_rejects_invalid_manifest_before_loading_sdk_or_funding(tmp_path):
    evidence_path = tmp_path / "live-contract.json"
    manifest_path = tmp_path / "manifest.json"
    manifest = _manifest_data()
    manifest["classification"] = "UPGRADABLE"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    result = _run(E2E, "--manifest", str(manifest_path), env={
        "CONFIRM_LIVE_E2E": "YES",
        "MILESTONEPROOF_SDK_MODULE": (tmp_path / "missing-sdk.mjs").as_uri(),
        "FAKE_CALL_LOG": str(tmp_path / "calls.log"),
        "LIVE_EVIDENCE_PATH": str(evidence_path),
        "NODE_ENV": "test",
    })

    assert result.returncode != 0
    assert "schema" in result.stderr.lower()
    assert not (tmp_path / "calls.log").exists()
    assert not evidence_path.exists()


def test_live_e2e_generates_actors_proves_success_and_unauthorized_error(tmp_path):
    fake = _e2e_sdk(tmp_path)
    evidence_path = tmp_path / "live-contract.json"
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(_manifest_data()), encoding="utf-8")
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
    assert evidence["fixture"] == {
        "sourceKind": "RELEASE",
        "url": "https://raw.githubusercontent.com/genlayerlabs/genlayer-js/v1.1.8/package.json",
        "subjectRef": "github.com/genlayerlabs/genlayer-js",
        "versionRef": "1.1.8",
        "criterion": (
            "The official genlayerlabs/genlayer-js repository tag v1.1.8 "
            "declares package version 1.1.8."
        ),
    }
    assert len(set(evidence["actors"].values())) == 3
    assert evidence["transactions"]["createProject"]["executionResult"] == "FINISHED_WITH_RETURN"
    assert evidence["transactions"]["unauthorizedSubmission"]["executionResult"] == "FINISHED_WITH_ERROR"
    assert evidence["readback"]["unauthorizedSubmission"]["project"][6] == "0"
    assert evidence["readback"]["unauthorizedSubmission"]["milestone"][7] == "1"
    assert evidence["readback"]["unauthorizedSubmission"]["milestone"][9] == "0"
    assert evidence["readback"]["unauthorizedSubmission"]["currentSubmissionId"] == "0"
    assert evidence["transactions"]["submitEvidence"]["executionResult"] == "FINISHED_WITH_RETURN"
    assert evidence["transactions"]["resolveSubmission"]["executionResult"] == "FINISHED_WITH_RETURN"
    assert evidence["readback"]["project"][6] == "1"
    assert evidence["readback"]["milestone"][7] == "3"
    assert evidence["readback"]["submission"][5] == "1"
    assert evidence["readback"]["fundingBalances"] == {
        "before": ["0", "0", "0"],
        "after": ["100", "100", "100"],
    }
    assert "private" not in evidence_text.lower()
    assert "secret" not in evidence_text.lower()
    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert calls.count("createAccount") == 3
    assert calls.count("sim_fundAccount") == 3
    assert calls.count("getBalance") == 6
    assert "get_project_count" not in calls
    assert "read:get_sponsor_project_count" in calls
    assert "read:get_sponsor_project_ids" in calls
    assert evidence["transactions"]["funding"] == ["0x" + ("f" * 64)] * 3


def test_live_e2e_rejects_unauthorized_state_mutation_before_builder_submission(tmp_path):
    fake = _e2e_sdk(tmp_path)
    evidence_path = tmp_path / "live-contract.json"
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(_manifest_data()), encoding="utf-8")
    result = _run(E2E, "--manifest", str(manifest_path), env={
        "NODE_ENV": "test",
        "MILESTONEPROOF_SDK_MODULE": fake.as_uri(),
        "FAKE_CALL_LOG": str(tmp_path / "calls.log"),
        "LIVE_EVIDENCE_PATH": str(evidence_path),
        "CONFIRM_LIVE_E2E": "YES",
        "FAKE_UNAUTHORIZED_MUTATION": "YES",
    })

    assert result.returncode != 0
    assert "unauthorized submission changed contract state" in result.stderr.lower()
    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert calls.count("write:") == 2
    assert calls.count("submit_evidence") == 1
    assert not evidence_path.exists()


@pytest.mark.parametrize("response", ["TRUE", "OPAQUE", "NULL"])
def test_live_e2e_accepts_opaque_funding_response_when_balance_increases(tmp_path, response):
    fake = _e2e_sdk(tmp_path)
    evidence_path = tmp_path / "live-contract.json"
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(_manifest_data()), encoding="utf-8")
    result = _run(E2E, "--manifest", str(manifest_path), env={
        "NODE_ENV": "test",
        "MILESTONEPROOF_SDK_MODULE": fake.as_uri(),
        "FAKE_CALL_LOG": str(tmp_path / "calls.log"),
        "LIVE_EVIDENCE_PATH": str(evidence_path),
        "CONFIRM_LIVE_E2E": "YES",
        "FAKE_FUNDING_RESPONSE": response,
    })

    assert result.returncode == 0, result.stdout + result.stderr
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    assert evidence["transactions"]["funding"] == []
    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert calls.count("getBalance") == 6
    assert "write:" in calls


@pytest.mark.parametrize(
    ("env_name", "value", "message"),
    [
        ("FAKE_PROJECT_BUILDER", "0x" + ("4" * 40), "project readback"),
        ("FAKE_PROJECT_TITLE", "Concurrent project", "project readback"),
        ("FAKE_MILESTONE_TITLE", "Wrong milestone", "milestone readback"),
    ],
)
def test_live_e2e_rejects_action_readback_mismatch_before_evidence_write(tmp_path, env_name, value, message):
    fake = _e2e_sdk(tmp_path)
    evidence_path = tmp_path / "live-contract.json"
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(_manifest_data()), encoding="utf-8")
    result = _run(E2E, "--manifest", str(manifest_path), env={
        "NODE_ENV": "test",
        "MILESTONEPROOF_SDK_MODULE": fake.as_uri(),
        "FAKE_CALL_LOG": str(tmp_path / "calls.log"),
        "LIVE_EVIDENCE_PATH": str(evidence_path),
        "CONFIRM_LIVE_E2E": "YES",
        env_name: value,
    })

    assert result.returncode != 0
    assert message in result.stderr.lower()
    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert calls.count("write:") == 1
    assert "submit_evidence" not in calls
    assert not evidence_path.exists()


def test_live_e2e_funding_failure_prevents_all_contract_writes(tmp_path):
    fake = _e2e_sdk(tmp_path)
    evidence_path = tmp_path / "live-contract.json"
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(_manifest_data()), encoding="utf-8")
    result = _run(E2E, "--manifest", str(manifest_path), env={
        "NODE_ENV": "test",
        "MILESTONEPROOF_SDK_MODULE": fake.as_uri(),
        "FAKE_CALL_LOG": str(tmp_path / "calls.log"),
        "LIVE_EVIDENCE_PATH": str(evidence_path),
        "CONFIRM_LIVE_E2E": "YES",
        "FAKE_FUNDING_FAILURE": "YES",
    })

    assert result.returncode != 0
    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert "sim_fundAccount" in calls
    assert "write:" not in calls
    assert not evidence_path.exists()


@pytest.mark.parametrize("failure_flag", ["FAKE_FUNDING_NO_BALANCE", "FAKE_FUNDING_UNCHANGED_POSITIVE"])
def test_live_e2e_opaque_funding_without_balance_increase_prevents_all_contract_writes(tmp_path, failure_flag):
    fake = _e2e_sdk(tmp_path)
    evidence_path = tmp_path / "live-contract.json"
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(_manifest_data()), encoding="utf-8")
    result = _run(E2E, "--manifest", str(manifest_path), env={
        "NODE_ENV": "test",
        "MILESTONEPROOF_SDK_MODULE": fake.as_uri(),
        "FAKE_CALL_LOG": str(tmp_path / "calls.log"),
        "LIVE_EVIDENCE_PATH": str(evidence_path),
        "CONFIRM_LIVE_E2E": "YES",
        "FAKE_FUNDING_RESPONSE": "OPAQUE",
        failure_flag: "YES",
    })

    assert result.returncode != 0
    assert "balance" in result.stderr.lower()
    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert calls.count("sim_fundAccount") == 3
    assert calls.count("getBalance") == 6
    assert "write:" not in calls
    assert not evidence_path.exists()
