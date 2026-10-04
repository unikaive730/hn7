"""Agent room: the Omnigent bundle's topology and replays of recorded runs.

Two things live here.

* ``topology()`` reads ``agents/beeguard`` (the bundle Omnigent actually loads)
  and reports who the orchestrator can dispatch, which lab tools each agent can
  reach, and which calls the approval policy gates.
* ``extract_runs()`` reads Omnigent's own session store (``~/.omnigent/chat.db``)
  and turns one recorded run, the orchestrator plus every sub-agent session it
  spawned, into a single ordered list of turns. Nothing is generated: each turn
  is a row Omnigent wrote while the run happened. Long tool payloads are
  trimmed, never rewritten.

The deployed app has no chat.db, so extraction writes
``lab/data/derived/agent_runs.json`` and the HTTP routes serve that file.

    python -m lab.beeguard.agentroom extract
"""
from __future__ import annotations

import ast
import datetime as dt
import json
import re
import shutil
import sqlite3
import sys
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "agents" / "beeguard"
DERIVED = ROOT / "lab" / "data" / "derived"
RUNS_FILE = DERIVED / "agent_runs.json"
TOPOLOGY_FILE = DERIVED / "agent_topology.json"
MCP_SERVER = Path(__file__).resolve().parent / "mcp_server.py"
DEFAULT_DB = Path.home() / ".omnigent" / "chat.db"

SPECIALISTS = ["literature", "insight", "planner", "runner", "analysis"]
ORCHESTRATOR = "orchestrator"
TRIM = 1200  # characters kept from any single tool payload
MESSAGE_TRIM = 4000  # characters kept from any single message
ERROR_TRIM = 900  # characters kept from a harness error


# ── Topology ────────────────────────────────────────────────────────────


def _mcp_tool_names() -> list[str]:
    """Tool names registered with ``@mcp.tool()`` in mcp_server.py, read by AST."""
    tree = ast.parse(MCP_SERVER.read_text(encoding="utf-8"))
    names = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            for dec in node.decorator_list:
                target = dec.func if isinstance(dec, ast.Call) else dec
                if isinstance(target, ast.Attribute) and target.attr == "tool":
                    names.append(node.name)
    return names


def _first_line(text: str | None) -> str:
    return " ".join((text or "").split())


def _build_topology() -> dict[str, Any]:
    import yaml

    from . import policies

    mcp_tools = _mcp_tool_names()
    root = yaml.safe_load((BUNDLE / "config.yaml").read_text(encoding="utf-8"))
    root_tools = root.get("tools") or {}
    dispatchable = list(root_tools.get("agents") or [])
    root_has_lab = "lab" in root_tools

    agents = []
    for name in SPECIALISTS:
        path = BUNDLE / "agents" / name / "config.yaml"
        cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
        prompt = cfg.get("prompt") or ""
        has_lab = "lab" in (cfg.get("tools") or {})
        named = [t for t in mcp_tools if re.search(rf"\b{t}\b", prompt)]
        agents.append(
            {
                "name": name,
                "description": _first_line(cfg.get("description")),
                "harness": ((cfg.get("executor") or {}).get("config") or {}).get("harness"),
                "model": (cfg.get("llm") or {}).get("model"),
                "lab_access": has_lab,
                "tools_named_in_prompt": named,
                "gated_tools": [t for t in named if t in policies.GATED_TOOLS],
                "config_path": str(path.relative_to(ROOT)).replace("\\", "/"),
            }
        )

    guard = ((root.get("guardrails") or {}).get("policies")) or {}
    policy_rows = []
    for pname, spec in guard.items():
        row = {"name": pname, "type": spec.get("type"), "handler": spec.get("handler")}
        if spec.get("factory_params"):
            row["params"] = spec["factory_params"]
        policy_rows.append(row)

    return {
        "bundle": str(BUNDLE.relative_to(ROOT)).replace("\\", "/"),
        "orchestrator": {
            "name": root.get("name"),
            "description": _first_line(root.get("description")),
            "harness": ((root.get("executor") or {}).get("config") or {}).get("harness"),
            "model": (root.get("llm") or {}).get("model"),
            "dispatches": dispatchable,
            "dispatch_tool": "sys_session_send",
            "lab_access": root_has_lab,
        },
        "specialists": agents,
        "mcp_server": {"module": "lab.beeguard.mcp_server", "tools": mcp_tools},
        "policies": policy_rows,
        "gated_tools": sorted(policies.GATED_TOOLS),
        "gate_effect": "ASK: the call pauses until a person accepts or declines it",
    }


@lru_cache(maxsize=1)
def topology() -> dict[str, Any]:
    """Topology from the live bundle, falling back to the saved snapshot."""
    try:
        return _build_topology()
    except Exception:  # bundle absent in a slim deploy
        return json.loads(TOPOLOGY_FILE.read_text(encoding="utf-8"))


# ── Runs ────────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _runs_payload() -> list[dict[str, Any]]:
    if not RUNS_FILE.exists():
        return []
    return json.loads(RUNS_FILE.read_text(encoding="utf-8"))


def list_runs() -> list[dict[str, Any]]:
    """Run headers without turns, newest first."""
    out = []
    for run in _runs_payload():
        out.append({k: v for k, v in run.items() if k != "turns"})
    return out


def get_run(run_id: str) -> dict[str, Any] | None:
    for run in _runs_payload():
        if run["id"] == run_id or run["id"].startswith(run_id):
            return run
    return None


# ── Extraction from Omnigent's session store ───────────────────────────

KST = dt.timezone(dt.timedelta(hours=9))
DISPATCH_TOOLS = {"sys_session_send", "sys_call_async"}
PLUMBING_TOOLS = {"ToolSearch"}


def _iso(epoch: float) -> str:
    return dt.datetime.fromtimestamp(epoch, KST).isoformat(timespec="seconds")


def _open_copy(db_path: Path) -> sqlite3.Connection:
    """Open a private copy so a live Omnigent server is never locked."""
    tmp = Path(tempfile.mkdtemp(prefix="omnigent-db-"))
    for suffix in ("", "-wal", "-shm"):
        src = Path(str(db_path) + suffix)
        if src.exists():
            shutil.copy2(src, tmp / src.name)
    return sqlite3.connect(tmp / db_path.name)


def _trim(text: Any, limit: int = TRIM) -> tuple[str, bool]:
    text = text if isinstance(text, str) else json.dumps(text, ensure_ascii=False)
    return (text, False) if len(text) <= limit else (text[:limit], True)


def _maybe_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _tool_name(raw: str) -> tuple[str, str]:
    """(namespace, short name): mcp__omnigent__lab__x and lab__x both give ("lab", "x")."""
    name = raw
    for prefix in ("mcp__omnigent__", "mcp__"):
        if name.startswith(prefix):
            name = name[len(prefix):]
    if name.startswith("lab__"):
        return "lab", name[len("lab__"):]
    if name.startswith("sys_"):
        return "omnigent", name
    if name in PLUMBING_TOOLS:
        return "harness", name
    return "other", name


def _summarise_args(args: Any) -> str:
    if not isinstance(args, dict):
        return _trim(str(args), 140)[0]
    parts = []
    for key, value in args.items():
        value = _maybe_json(value)
        shown = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
        shown = " ".join(shown.split())
        if len(shown) > 70:
            shown = shown[:67] + "..."
        parts.append(f"{key}={shown}")
    return ", ".join(parts)[:220]


def _message_text(data: dict) -> str:
    chunks = []
    for part in data.get("content") or []:
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            chunks.append(part["text"])
    return "\n".join(chunks).strip()


def _conversation_turns(rows: list[tuple], agent: str, is_root: bool) -> list[dict]:
    """One conversation's items as turns, keeping one record per tool call.

    Omnigent often writes a tool call twice: once as the harness saw it (agent
    field ``resp_...`` with its own call id) and once as its relay saw it
    (agent field = bundle name, call id reused from a neighbour). A relay copy
    is dropped, with the output right after it, only when a harness copy with
    the same tool and the same arguments sits two rows before or after it.
    Some calls exist only as a relay copy; those are kept.
    """

    def is_harness(data: dict) -> bool:
        return str(data.get("agent", "")).startswith("resp_")

    def duplicate_of_harness(k: int) -> bool:
        _p, _ty, _t, data, _r = rows[k]
        for j in (k - 2, k + 2):
            if 0 <= j < len(rows) and rows[j][1] == 2 and is_harness(rows[j][3]):
                other = rows[j][3]
                if (other.get("name") == data.get("name")
                        and _maybe_json(other.get("arguments")) == _maybe_json(data.get("arguments"))):
                    return True
        return False

    turns: list[dict] = []
    pending_calls: dict[str, dict] = {}
    skip_next_output = False
    last_call: dict | None = None
    for k, (pos, itype, created, data, response_id) in enumerate(rows):
        if itype == 1:
            text = _message_text(data)
            if not text:
                continue
            extra: dict[str, Any] = {}
            if data.get("role") == "user" and text.startswith("[System:"):
                # Omnigent telling the orchestrator a sub-agent finished.
                kind = "notice"
                found = re.search(r"sub-agent ([\w-]+)/", text)
                if found:
                    extra["from_agent"] = found.group(1)
                if "(failed)" in text:
                    extra["failed"] = True
            elif data.get("role") == "user":
                kind = "prompt" if is_root else "brief"
            elif str(response_id).startswith("deny_") or text.startswith("[Denied by policy"):
                kind = "denied"
            else:
                kind = "message"
            body, cut = _trim(text, MESSAGE_TRIM)
            turns.append({"t": created, "agent": agent, "kind": kind, "text": body,
                          "text_truncated": cut, "pos": pos, **extra})
            last_call = None
        elif itype == 2:
            harness_copy = is_harness(data)
            if not harness_copy and duplicate_of_harness(k):
                skip_next_output = True
                last_call = None
                continue
            skip_next_output = False
            ns, short = _tool_name(str(data.get("name", "")))
            args = _maybe_json(data.get("arguments"))
            if isinstance(args, dict) and "args" in args:
                args = {**args, "args": _maybe_json(args["args"])}
            turn = {"t": created, "agent": agent, "kind": "tool_call", "tool": short,
                    "ns": ns, "args": args, "args_summary": _summarise_args(args),
                    "plumbing": short in PLUMBING_TOOLS, "pos": pos,
                    "call_id": data.get("call_id")}
            if short in DISPATCH_TOOLS and isinstance(args, dict):
                target = args.get("agent") or args.get("tool")
                unparsed = args.get("__unparsedToolInput")
                if not target and isinstance(unparsed, dict):
                    # The harness refused this call as invalid JSON; read the name anyway.
                    found = re.search(r'"agent"\s*:\s*"([\w-]+)"', str(unparsed.get("raw", "")))
                    target = found.group(1) if found else None
                    turn["unparsed_input"] = True
                if target:
                    turn["target"] = str(target)
            turns.append(turn)
            if harness_copy:
                pending_calls[str(data.get("call_id"))] = turn
            last_call = turn
        elif itype == 3:
            if skip_next_output:
                skip_next_output = False
                continue
            # The output right after a call belongs to it; otherwise match by id.
            turn = last_call if last_call is not None and "result" not in last_call else None
            turn = turn or pending_calls.pop(str(data.get("call_id")), None)
            if turn is None or "result" in turn:
                continue
            output = data.get("output")
            text = output if isinstance(output, str) else json.dumps(output, ensure_ascii=False)
            body, cut = _trim(text)
            turn.update(result=body, result_truncated=cut, result_chars=len(text),
                        result_at=created)
            parsed = _maybe_json(text)
            if isinstance(parsed, dict) and isinstance(parsed.get("result"), str):
                parsed = _maybe_json(parsed["result"])
            if isinstance(parsed, str) and parsed.startswith("Error"):
                turn["error"] = True
            last_call = None
        elif itype == 5 and isinstance(data.get("message"), str):
            body, cut = _trim(data["message"], ERROR_TRIM)
            turns.append({"t": created, "agent": agent, "kind": "harness_error",
                          "code": data.get("code"), "source": data.get("source"),
                          "text": body, "text_truncated": cut, "pos": pos})
            last_call = None
        else:
            body, cut = _trim(json.dumps(data, ensure_ascii=False), 600)
            turns.append({"t": created, "agent": agent, "kind": f"item_type_{itype}",
                          "text": body, "text_truncated": cut, "pos": pos})
    return turns


def _approval_turns(log: dict, sessions: dict[str, str]) -> list[dict]:
    """Approval prompts and verdicts recorded by the watcher during the run."""
    turns = []
    for rec in log.get("approvals", []):
        params = rec.get("params") or {}
        target = str(rec.get("target_session_id", "")).replace("-", "").lower()
        base = {"agent": sessions.get(target, ORCHESTRATOR),
                "elicitation_id": rec.get("elicitation_id"),
                "policy": params.get("policy_name"), "phase": params.get("phase"),
                "session": target}
        turns.append({**base, "t": rec["seen_at"], "kind": "approval_request",
                      "text": params.get("message") or "Approval required",
                      "preview": _trim(str(params.get("content_preview", "")), 600)[0]})
        if rec.get("resolved_at"):
            turns.append({**base, "t": rec["resolved_at"], "kind": "approval_granted",
                          "verdict": "accept", "http_status": rec.get("http_status"),
                          "mechanism": rec.get("mechanism"),
                          "text": "Accepted through the Omnigent approval API"})
    return turns


def _causal_order(turns: list[dict]) -> list[dict]:
    """Fix two ordering artefacts of whole-second timestamps, without touching times.

    A dispatch row is written when the call returns, so the child's brief can
    carry an earlier second than the call that sent it; and the "sub-agent
    finished" notice can share a second with the child's last message. Each
    brief moves to just after its dispatch; each notice to just after the last
    turn of the child it reports on.
    """
    out = list(turns)
    used: set[int] = set()
    for brief in [t for t in out if t["kind"] == "brief"]:
        b = out.index(brief)
        for d, call in enumerate(out):
            if (call["kind"] == "tool_call" and call.get("target") == brief["agent"]
                    and id(call) not in used and not call.get("unparsed_input")):
                used.add(id(call))
                if d > b:
                    out.pop(b)
                    out.insert(d, brief)
                break
    for notice in [t for t in out if t["kind"] == "notice" and t.get("from_agent")]:
        n = out.index(notice)
        child = [k for k, t in enumerate(out)
                 if t["agent"] == notice["from_agent"] and t["t"] <= notice["t"] + 1]
        if child and child[-1] > n:
            out.pop(n)
            out.insert(child[-1], notice)
    return out


def _extract_one(conn: sqlite3.Connection, root_hex: str, approval_log: dict | None) -> dict:
    convs = conn.execute(
        "select hex(c.id), c.title, c.created_at, c.session_overrides, m.sub_agent_name"
        " from conversations c left join omnigent_conversation_metadata m on m.id = c.id"
        " where hex(c.root_conversation_id) = ? order by c.created_at",
        (root_hex,),
    ).fetchall()
    sessions: dict[str, str] = {}
    session_models: dict[str, str | None] = {}
    turns: list[dict] = []
    root_row = None
    for cid, title, created, overrides, sub_name in convs:
        is_root = cid == root_hex
        agent = ORCHESTRATOR if is_root else (sub_name or title or "sub-agent")
        sessions[cid.lower()] = agent
        session_models[cid.lower()] = (
            (_maybe_json(overrides) or {}).get("reported_model") if overrides else None)
        if is_root:
            root_row = (title, created, overrides)
        rows = [
            (pos, itype, t, json.loads(data), rid)
            for pos, itype, t, data, rid in conn.execute(
                "select position, type, created_at, data, response_id from conversation_items"
                " where hex(conversation_id) = ? order by position", (cid,))
        ]
        for turn in _conversation_turns(rows, agent, is_root):
            turn["session"] = cid.lower()
            turns.append(turn)
    if approval_log:
        turns.extend(_approval_turns(approval_log, sessions))
    order = {s: i for i, s in enumerate(sessions)}
    turns.sort(key=lambda x: (x["t"], order.get(x.get("session"), 99), x.get("pos", 1e9)))
    turns = _causal_order(turns)

    title, created, overrides = root_row
    t0 = turns[0]["t"] if turns else created
    for i, turn in enumerate(turns):
        turn["i"] = i
        turn["at"] = _iso(turn["t"])
        turn["t_rel"] = round(turn["t"] - t0, 1)
        turn.pop("pos", None)

    model = (_maybe_json(overrides) or {}).get("reported_model") if overrides else None
    calls = [t for t in turns if t["kind"] == "tool_call"]
    work = [t for t in calls if not t["plumbing"]]
    agents_seen = sorted({t["agent"] for t in turns})
    tool_counts: dict[str, dict[str, int]] = {}
    for c in work:
        per = tool_counts.setdefault(c["agent"], {})
        per[c["tool"]] = per.get(c["tool"], 0) + 1
    prompt = next((t["text"] for t in turns if t["kind"] == "prompt"), title)
    final = next((t["text"] for t in reversed(turns)
                  if t["agent"] == ORCHESTRATOR and t["kind"] == "message"), None)
    end = max((max(t["t"], t.get("result_at", 0)) for t in turns), default=t0)
    return {
        "id": root_hex.lower(),
        "title": title,
        "started_at": _iso(t0),
        "ended_at": _iso(end),
        "duration_s": round(end - t0, 1),
        "prompt": prompt,
        "harness": "claude-sdk",
        "model": model,
        "sessions": [{"id": s, "agent": a, "model": session_models.get(s)}
                     for s, a in sessions.items()],
        "counts": {
            "turns": len(turns),
            "tool_calls": len(work),
            "tool_loads": len(calls) - len(work),
            "dispatches": sum(1 for c in work if c["tool"] in DISPATCH_TOOLS),
            "lab_calls": sum(1 for c in work if c["ns"] == "lab"),
            "approvals_requested": sum(1 for t in turns if t["kind"] == "approval_request"),
            "approvals_granted": sum(1 for t in turns if t["kind"] == "approval_granted"),
            "denied": sum(1 for t in turns if t["kind"] == "denied"),
            "errors": sum(1 for c in work if c.get("error")),
            "harness_errors": sum(1 for t in turns if t["kind"] == "harness_error"),
            "agents": len(agents_seen),
            "sub_agent_sessions": len(sessions) - 1,
        },
        "agents_involved": agents_seen,
        "tool_counts": tool_counts,
        "final_report": final,
        "source": "Omnigent session store ~/.omnigent/chat.db (conversations, conversation_items)",
        "trim_chars": {"tool_payload": TRIM, "message": MESSAGE_TRIM,
                       "harness_error": ERROR_TRIM},
        "approval_source": ("watcher log of POST /v1/sessions/{id}/elicitations/{eid}/resolve"
                            if approval_log else None),
        "turns": turns,
    }


def extract_runs(db_path: Path = DEFAULT_DB, approval_logs: dict[str, Path] | None = None,
                 min_items: int = 2) -> list[dict]:
    """Every recorded run of the beeguard-lab bundle, newest first."""
    approval_logs = approval_logs or {}
    conn = _open_copy(db_path)
    roots = conn.execute(
        "select hex(c.id) from conversations c join agents a on a.id = c.agent_id"
        " where a.name = 'beeguard-lab' and c.parent_conversation_id is null"
        " order by c.created_at desc"
    ).fetchall()
    runs = []
    for (root_hex,) in roots:
        n = conn.execute(
            "select count(*) from conversation_items ci join conversations c"
            " on c.id = ci.conversation_id where hex(c.root_conversation_id) = ?", (root_hex,)
        ).fetchone()[0]
        if n < min_items:
            continue
        log_path = approval_logs.get(root_hex.lower())
        log = json.loads(Path(log_path).read_text(encoding="utf-8")) if log_path else None
        runs.append(_extract_one(conn, root_hex, log))
    return runs


def main(argv: list[str]) -> None:
    """``extract [approval_log.json ...]`` rebuilds lab/data/derived/agent_*.json."""
    if not argv or argv[0] != "extract":
        print(__doc__)
        return
    logs: dict[str, Path] = {}
    for arg in argv[1:]:
        path = Path(arg)
        log = json.loads(path.read_text(encoding="utf-8"))
        if log.get("root_session_id"):
            logs[log["root_session_id"].lower()] = path
    runs = extract_runs(approval_logs=logs)
    DERIVED.mkdir(parents=True, exist_ok=True)
    RUNS_FILE.write_text(json.dumps(runs, ensure_ascii=False, indent=1), encoding="utf-8")
    TOPOLOGY_FILE.write_text(json.dumps(_build_topology(), ensure_ascii=False, indent=1),
                             encoding="utf-8")
    for run in runs:
        print(run["id"][:8], run["started_at"], run["counts"], run["agents_involved"])


if __name__ == "__main__":
    main(sys.argv[1:])
