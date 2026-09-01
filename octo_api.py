# -*- coding: utf-8 -*-
"""八爪鱼 RPA 调度 API 客户端（api-rpa.bazhuayu.com /desktop/ 接口）

逆向自 OctopusRPA.ApiClient.dll，端点：
    POST /desktop/identity/authentication/password   账密登录 -> accessToken
    POST /desktop/identity/authentication/refresh    刷新 token
    POST /desktop/bots/scheduling/start              启动应用（手动触发运行）
    POST /desktop/bots/scheduling/stop               停止运行
    GET  /desktop/bots/runningRecords/underway       运行中记录
    GET  /desktop/enterprises/apiKeys                企业 API Key 管理

用法（库）：
    import octo_api
    octo_api.start_flow(cfg, "6a5de5cde5c53235fe851b64", bot_id="可选")

token 管理：优先缓存 output/octo_token.json -> refresh 续期 -> 账密重登。
"""
import json
import os
import time
import urllib.parse
import urllib.request

BASE = "https://api-rpa.bazhuayu.com"
TOKEN_FILE = "output/octo_token.json"   # 相对 bazhuayu_crawler 目录
# 本地 Workspaces 主目录（企业版 workspaceId），与企业列表匹配时优先选它
DEFAULT_WORKSPACE_ID = "67d8d731861c99733a01a7b5"

_REQ_TIMEOUT = 30
_ENT_CACHE = {}


def _req(method, path, cfg, body=None, token=None, enterprise_id=None):
    url = BASE + path
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    ent = enterprise_id or cfg.get("enterprise_id") or _ENT_CACHE.get("id") or ""
    if ent:
        headers["EnterpriseId"] = ent
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=_REQ_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw) if raw.strip() else {}
        except Exception:
            return e.code, {"raw": raw[:300]}
    except Exception as e:
        return 0, {"error": str(e)}


def resolve_enterprise(cfg, token, force=False):
    """确定 EnterpriseId：config -> 缓存 -> 企业列表自动选择。

    优先选与本地 Workspaces 主目录 id 相同、或第一个非个人企业。
    """
    if not force and (_ENT_CACHE.get("id") or cfg.get("enterprise_id")):
        return _ENT_CACHE.get("id") or cfg["enterprise_id"]
    code, resp = _req("GET", "/desktop/enterprises/enterprises", cfg,
                      token=token, enterprise_id="")
    ents = resp if isinstance(resp, list) else (resp.get("data") or resp.get("list") or [])
    chosen = ""
    if isinstance(ents, list) and ents:
        for e in ents:
            if e.get("id") == DEFAULT_WORKSPACE_ID:
                chosen = DEFAULT_WORKSPACE_ID
                break
        if not chosen:
            chosen = next((e.get("id") for e in ents if not e.get("isIndividualAccount")),
                          ents[0].get("id", ""))
    if chosen:
        _ENT_CACHE["id"] = chosen
    return chosen


def _token_path(cfg):
    out = cfg.get("out_dir") or "output"
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), out, "octo_token.json")


def _load_cached():
    p = _token_path({"out_dir": "output"})
    if os.path.exists(p):
        try:
            return json.load(open(p, encoding="utf-8"))
        except Exception:
            return None
    return None


def _save_cache(tok):
    p = _token_path({"out_dir": "output"})
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(tok, f, ensure_ascii=False, indent=2)


def login(cfg):
    """账密登录，返回 token dict 或抛错。"""
    acc = cfg.get("account", {})
    username = acc.get("username") or acc.get("phone") or acc.get("email") or ""
    password = acc.get("password", "")
    if not (username and password):
        raise RuntimeError("config.json 缺少 account.username / account.password")
    # 登录 body 兼容多种字段名
    bodies = [
        {"LoginName": username, "Password": password},
        {"username": username, "password": password},
        {"account": username, "password": password},
    ]
    last = None
    for b in bodies:
        code, resp = _req("POST", "/desktop/identity/authentication/password", cfg, body=b)
        if code in (200, 201):
            tok = _normalize_token(resp)
            if tok:
                _save_cache(tok)
                return tok
        last = (code, resp)
    raise RuntimeError(f"登录失败: {last}")


def _normalize_token(resp):
    """兼容多种 token 字段名。"""
    if not isinstance(resp, dict):
        return None
    for k in ("accessToken", "access_token", "token", "data"):
        v = resp.get(k)
        if isinstance(v, str) and len(v) > 20:
            rt = resp.get("refreshToken") or resp.get("refresh_token") or ""
            if isinstance(rt, dict):
                rt = ""
            exp = resp.get("expiresIn") or resp.get("expires_in") or 7200
            try:
                exp = int(exp)
            except (TypeError, ValueError):
                exp = 7200
            return {"accessToken": v, "refreshToken": rt, "expiresIn": exp,
                    "gotAt": time.time()}
        if isinstance(v, dict):  # {"accessToken": ...} 嵌套
            return _normalize_token(v)
    return None


def ensure_token(cfg, force=False):
    """返回有效 accessToken；缓存 -> refresh -> 登录。"""
    cached = None if force else _load_cached()
    if cached and cached.get("accessToken"):
        got = cached.get("gotAt", 0)
        exp = cached.get("expiresIn", 7200)
        if time.time() - got < exp - 120:   # 剩余 2 分钟以上直接用
            return cached["accessToken"]
        rt = cached.get("refreshToken")
        if rt:
            code, resp = _req("POST", "/desktop/identity/authentication/refresh",
                              cfg, body={"refreshToken": rt, "refresh_token": rt})
            tok = _normalize_token(resp)
            if tok:
                tok["refreshToken"] = rt or tok.get("refreshToken", "")
                _save_cache(tok)
                return tok["accessToken"]
    # 重新账密登录
    return login(cfg)["accessToken"]


def _authed_post(cfg, path, body):
    token = ensure_token(cfg)
    ent = resolve_enterprise(cfg, token)
    code, resp = _req("POST", path, cfg, body=body, token=token, enterprise_id=ent)
    if code == 401:   # token 失效，强制重登再试一次
        token = ensure_token(cfg, force=True)
        code, resp = _req("POST", path, cfg, body=body, token=token, enterprise_id=ent)
    return code, resp


def start_flow(cfg, flow_id, bot_id=None, params=None, mode="ByNewestContent"):
    """手动触发应用运行。返回批次号 flowProcessNo。

    flow_id: 应用/流程 ID（仪表盘详情页 rec.fid）。
    bot_id:  可选，指定机器人；不填则由平台分配空闲机器人。
    """
    body = {"flowId": flow_id, "flowContentRetrievalMode": mode}
    if bot_id:
        body["specifiedBot"] = bot_id
    if params:
        body["params"] = params
    code, resp = _authed_post(cfg, "/desktop/bots/scheduling/start", body)
    if code in (200, 201):
        return resp.get("flowProcessNo") or resp.get("processNo") or resp
    raise RuntimeError(f"启动失败({code}): {resp}")


def list_underway(cfg):
    """运行中的记录（调试用）。"""
    token = ensure_token(cfg)
    url = BASE + "/desktop/bots/runningRecords/underway"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "User-Agent": "Mozilla/5.0",
        **({"EnterpriseId": cfg["enterprise_id"]} if cfg.get("enterprise_id") else {}),
    })
    with urllib.request.urlopen(req, timeout=_REQ_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


if __name__ == "__main__":
    import sys
    cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                      "config.json"), encoding="utf-8"))
    if len(sys.argv) >= 3 and sys.argv[1] == "start":
        fid = sys.argv[2]
        bot = sys.argv[3] if len(sys.argv) > 3 else None
        print("token:", ensure_token(cfg)[:20], "...")
        print("启动结果:", start_flow(cfg, fid, bot_id=bot))
    else:
        print("登录测试 ...")
        tok = login(cfg)
        print("accessToken:", tok["accessToken"][:24], "... 有效期", tok["expiresIn"], "秒")
        print("refreshToken:", (tok.get("refreshToken") or "")[:24], "...")
