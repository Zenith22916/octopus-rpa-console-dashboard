# -*- coding: utf-8 -*-
"""飞书多维表格配置中心读写（仪表盘后端专用）
================================================
读写 rpa_config 表：key / value / type(string,number,bool,json) / group / desc

- 读取：get_group_items(cfg, group) -> [{record_id, key, value, type, desc}]
- 更新：upsert_item(cfg, group, key, value, type, desc)  按 group+key 定位，存在则更新、不存在则新增
- 映射：项目 flowId -> 配置组 的映射也存这张表（group="project"，key="p.<flowId>"）

cfg 为 config.json 的 feishu 段：{app_id, app_secret, app_token, table_id}
依赖：仅标准库 urllib。
"""
import json
import time
import urllib.request

BASE = "https://open.feishu.cn/open-apis"
_token = {"value": None, "expire_at": 0.0}   # tenant_access_token 内存缓存


def _http(method, path, body=None, token=None, timeout=15):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_token(cfg, force=False):
    if not force and _token["value"] and time.time() < _token["expire_at"]:
        return _token["value"]
    r = _http("POST", "/auth/v3/tenant_access_token/internal",
              {"app_id": cfg["app_id"], "app_secret": cfg["app_secret"]})
    if r.get("code") != 0:
        raise RuntimeError("获取飞书 token 失败: %s" % r.get("msg"))
    _token["value"] = r["tenant_access_token"]
    _token["expire_at"] = time.time() + max(60, r.get("expire", 7200) - 300)
    return _token["value"]


def _records_url(cfg):
    return "/bitable/v1/apps/%s/tables/%s/records" % (cfg["app_token"], cfg["table_id"])


def _field_text(v):
    if isinstance(v, dict):
        return str(v.get("text", ""))
    if isinstance(v, list):
        return ",".join(_field_text(x) for x in v)
    return "" if v is None else str(v)


def cast_value(raw, typ):
    """按 type 把字符串还原为真实类型（前端展示 / 转换用）。"""
    if typ == "json":
        return json.loads(raw)
    if typ == "number":
        return float(raw) if "." in raw else int(raw)
    if typ == "bool":
        return str(raw).strip().lower() in ("true", "1", "yes")
    return raw


def _fetch_all(cfg):
    """拉取全表记录（自动分页），返回原始 items 列表。"""
    token = _get_token(cfg)
    items, page_token = [], ""
    while True:
        url = _records_url(cfg) + "?page_size=500" + (("&page_token=" + page_token) if page_token else "")
        r = _http("GET", url, token=token)
        if r.get("code") != 0:
            raise RuntimeError("读取多维表格失败: %s" % r.get("msg"))
        d = r.get("data", {})
        items.extend(d.get("items", []))
        if not d.get("has_more"):
            break
        page_token = d.get("page_token", "")
    return items


def get_group_items(cfg, group):
    """按 group 列读取全部配置项，返回 [{record_id, key, value, type, desc}]。"""
    out = []
    for it in _fetch_all(cfg):
        f = it.get("fields") or {}
        if _field_text(f.get("group")).strip() != group:
            continue
        out.append({
            "record_id": it.get("record_id", ""),
            "key": _field_text(f.get("key")).strip(),
            "value": _field_text(f.get("value")),
            "type": _field_text(f.get("type")).strip() or "string",
            "desc": _field_text(f.get("desc")),
        })
    return [o for o in out if o["key"]]


def get_group_config(cfg, group):
    """按 group 读取并转换类型，返回 {key: value} 字典。"""
    return {o["key"]: cast_value(o["value"], o["type"]) for o in get_group_items(cfg, group)}


def upsert_item(cfg, group, key, value, type_="string", desc=None):
    """按 group+key 更新或新增配置项。返回 {ok, msg, record_id}。"""
    token = _get_token(cfg)
    for it in _fetch_all(cfg):
        f = it.get("fields") or {}
        if (_field_text(f.get("group")).strip() == group
                and _field_text(f.get("key")).strip() == key):
            body = {"fields": {"value": value}}
            if desc is not None:
                body["fields"]["desc"] = desc
            r = _http("PUT", _records_url(cfg) + "/%s" % it["record_id"], body, token=token)
            if r.get("code") != 0:
                return {"ok": False, "msg": r.get("msg")}
            return {"ok": True, "msg": "已更新", "record_id": it["record_id"]}
    # 不存在则新增
    fields = {"group": group, "key": key, "value": value, "type": type_}
    if desc:
        fields["desc"] = desc
    r = _http("POST", _records_url(cfg), {"fields": fields}, token=token)
    if r.get("code") != 0:
        return {"ok": False, "msg": r.get("msg")}
    return {"ok": True, "msg": "已新增", "record_id": r.get("data", {}).get("record", {}).get("record_id", "")}


def delete_item(cfg, group, key):
    """按 group+key 删除配置项。返回 {ok, msg}。"""
    token = _get_token(cfg)
    for it in _fetch_all(cfg):
        f = it.get("fields") or {}
        if (_field_text(f.get("group")).strip() == group
                and _field_text(f.get("key")).strip() == key):
            r = _http("DELETE", _records_url(cfg) + "/%s" % it["record_id"], token=token)
            if r.get("code") != 0:
                return {"ok": False, "msg": r.get("msg")}
            return {"ok": True, "msg": "已删除"}
    return {"ok": False, "msg": "配置项不存在"}
