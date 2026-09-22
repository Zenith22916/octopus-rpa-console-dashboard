# -*- coding: utf-8 -*-
"""
极简 XLSX 生成器（纯标准库，零第三方依赖）
==================================================
把若干张表按「标题 / 说明 / 表头 / 数据」四段式拼成 .xlsx 字节流，供 local_server.py
的导出接口直接下发（内存生成，不落盘）。

为什么不用 openpyxl：部署环境不一定装了它（organize.py 里就做了 ImportError 兜底），
而 .xlsx 本质是一个装着几份 XML 的 zip。这里用 zipfile + 字符串拼装，只依赖标准库。

能力：
  - 表格式：headers + rows，自动冻结表头、表头自动筛选（排期明细、触发器汇总用）
  - 日历式：任意合并单元格 + 单元格级填充色 + 行高控制（排期日历用）
  - 单元格样式：fill / color / bold / size / align / wrap / border，按需去重生成 cellXfs

用法：
    data = build_xlsx([{
        "name": "排期日历",
        "title": "触发器排期日历（每周视图）",
        "note": "机器人：全部　状态：已启用",
        "headers": ["时刻", "周一", "周二"],
        "widths": [10, 16, 16],
        "data_height": 24,
        "styles": {"app0": {"fill": "77C5AC", "color": "0B0E13",
                            "align": "center", "border": True, "wrap": True}},
        "rows": [[{"v": "08:00", "s": "bodyC"}, {"v": "常规补货", "s": "app0"}, None]],
        "merges": ["A4:A6"],
    }])
"""
import io
import zipfile
from collections import OrderedDict
from xml.sax.saxutils import escape

# 表头底色（深蓝）与边框色，与 organize.py 产出的 Excel 观感保持一致
HEAD_BG = "4472C4"
LINE_RGB = "D9D9D9"
FONT_NAME = "等线"
NOTE_COLOR = "808080"
TEXT_COLOR = "262626"

# 内置样式：单元格的 "s" 直接写这些名字即可；sheet 里的 styles 可覆盖或新增
BUILTIN_STYLES = {
    "title": {"size": 14, "bold": True, "color": "1F3864", "align": "left", "wrap": True},
    "note": {"size": 10, "color": NOTE_COLOR, "align": "left"},
    "head": {"bold": True, "color": "FFFFFF", "fill": HEAD_BG,
             "align": "center", "border": True, "wrap": True},
    "body": {"border": True, "wrap": True},
    "bodyC": {"border": True, "wrap": True, "align": "center"},
    "plain": {},
}

DEFAULT_SIZE = 11
_BASE_STYLE = {"size": DEFAULT_SIZE, "bold": False, "color": TEXT_COLOR, "fill": "",
               "align": "left", "wrap": False, "border": False}


def col_letter(idx):
    """0 -> A、25 -> Z、26 -> AA。"""
    s = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


# ---------------------------------------------------------------- 样式注册

def _norm_style(spec):
    """补全样式默认值，返回归一化后的 dict（用于去重与生成 XML）。"""
    d = dict(_BASE_STYLE)
    for k, v in (spec or {}).items():
        if k in d:
            d[k] = v
    for k in ("color", "fill"):
        if isinstance(d[k], str):
            d[k] = d[k].lstrip("#").upper()
    return d


def _style_key(d):
    return tuple(d[k] for k in sorted(d))


class StyleRegistry:
    """收集用到的样式，去重后生成 fonts / fills / borders / cellXfs，并提供 key → 下标映射。"""

    def __init__(self):
        self.specs = OrderedDict()      # key -> 归一化规格（保持首次出现顺序）
        self.index = {}                 # key -> cellXfs 下标

    def use(self, spec):
        """登记一个样式，返回它的 key。"""
        d = _norm_style(spec)
        k = _style_key(d)
        if k not in self.specs:
            self.specs[k] = d
        return k

    def xf(self, key):
        return self.index[key]

    def xml(self):
        fonts = ['<font><sz val="%d"/><color rgb="FF%s"/><name val="%s"/></font>'
                 % (DEFAULT_SIZE, TEXT_COLOR, FONT_NAME)]
        font_ids = {("base",): 0}
        fills = ['<fill><patternFill patternType="none"/></fill>',
                 '<fill><patternFill patternType="gray125"/></fill>']
        fill_ids = {"": 0}
        thin = '<%s style="thin"><color rgb="FF' + LINE_RGB + '"/></%s>'
        borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>',
                   "<border>" + (thin % ("left", "left")) + (thin % ("right", "right"))
                   + (thin % ("top", "top")) + (thin % ("bottom", "bottom")) + "<diagonal/></border>"]
        xfs = []

        for i, (k, d) in enumerate(self.specs.items()):
            self.index[k] = i
            fk = (d["size"], d["bold"], d["color"])
            if fk not in font_ids:
                font_ids[fk] = len(fonts)
                fonts.append('<font>%s<sz val="%d"/><color rgb="FF%s"/><name val="%s"/></font>'
                             % ("<b/>" if d["bold"] else "", d["size"], d["color"], FONT_NAME))
            if d["fill"] and d["fill"] not in fill_ids:
                fill_ids[d["fill"]] = len(fills)
                fills.append('<fill><patternFill patternType="solid"><fgColor rgb="FF%s"/>'
                             '<bgColor indexed="64"/></patternFill></fill>' % d["fill"])
            al = ['horizontal="%s"' % d["align"], 'vertical="center"']
            if d["wrap"]:
                al.append('wrapText="1"')
            xfs.append('<xf numFmtId="0" fontId="%d" fillId="%d" borderId="%d" xfId="0"'
                       ' applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
                       '<alignment %s/></xf>'
                       % (font_ids[fk], fill_ids.get(d["fill"], 0),
                          1 if d["border"] else 0, " ".join(al)))

        return (u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                u'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                u'<fonts count="%d">%s</fonts><fills count="%d">%s</fills>'
                u'<borders count="%d">%s</borders>'
                u'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                u'<cellXfs count="%d">%s</cellXfs>'
                u'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
                u'</styleSheet>'
                % (len(fonts), "".join(fonts), len(fills), "".join(fills),
                   len(borders), "".join(borders), len(xfs), "".join(xfs)))


# ---------------------------------------------------------------- 单表预处理

def _prep_sheet(sheet, reg):
    """把一张表的声明整理成渲染所需结构（样式引用统一解析成注册表 key）。"""
    name = str(sheet.get("name") or "Sheet")[:31]
    for ch in ':\\/?*[]':
        name = name.replace(ch, "_")
    headers = list(sheet.get("headers") or [])
    body = list(sheet.get("rows") or [])
    centers = set(sheet.get("center") or [])
    local_styles = dict(sheet.get("styles") or {})

    def key_of(ref, dflt):
        """把样式名 / 样式 dict 解析成注册表 key；取不到就用 dflt 样式。"""
        if isinstance(ref, dict):
            return reg.use(ref)
        spec = local_styles.get(ref)
        if spec is None:
            spec = BUILTIN_STYLES.get(ref)
        if spec is None:
            spec = BUILTIN_STYLES.get(dflt) or BUILTIN_STYLES["body"]
        return reg.use(spec)

    def cell_of(c, idx, dflt="body"):
        if isinstance(c, dict):
            return {"v": c.get("v"), "k": key_of(c.get("s"), dflt)}
        # 表格式简写：center 里的列自动居中（只对正文生效，表头/标题不受影响）
        style_name = "bodyC" if (dflt == "body" and idx in centers) else dflt
        return {"v": c, "k": key_of(style_name, dflt)}

    title, note = sheet.get("title") or "", sheet.get("note") or ""
    return {
        "name": name,
        "title": title,
        "note": note,
        # 标题/说明的样式也要在这一步登记，否则生成 styles.xml 时还没算上它们
        "title_k": reg.use(BUILTIN_STYLES["title"]) if title else None,
        "note_k": reg.use(BUILTIN_STYLES["note"]) if note else None,
        "head": [cell_of(h, i, "head") for i, h in enumerate(headers)],
        "data": [[cell_of(c, i) for i, c in enumerate(row)] for row in body],
        "ncol": max([0] + [len(headers)] + [len(r) for r in body]) or 1,
        "widths": list(sheet.get("widths") or []),
        "merges": [m for m in (sheet.get("merges") or [])],
        "head_row": (1 if sheet.get("title") else 0) + (1 if sheet.get("note") else 0)
                    + (1 if headers else 0),
        # 日历类表带合并单元格，自动筛选会和合并区打架，故可按表关掉
        "filter": bool(headers) and bool(body) and sheet.get("filter", True),
        "head_height": sheet.get("head_height", 22),
        "data_height": sheet.get("data_height"),
    }


def _sheet_xml(p, reg):
    last_col = col_letter(p["ncol"] - 1)
    parts, merges = [], []
    r = 1
    if p["title"]:
        parts.append(_row_xml(r, [_cell_xml("A%d" % r, reg.xf(p["title_k"]), p["title"])], 24))
        merges.append("A%d:%s%d" % (r, last_col, r))
        r += 1
    if p["note"]:
        parts.append(_row_xml(r, [_cell_xml("A%d" % r, reg.xf(p["note_k"]), p["note"])]))
        merges.append("A%d:%s%d" % (r, last_col, r))
        r += 1

    head_row = r if p["head"] else 0
    if head_row:
        parts.append(_row_xml(head_row, [
            _cell_xml("%s%d" % (col_letter(i), head_row), reg.xf(c["k"]), c["v"])
            for i, c in enumerate(p["head"])], p["head_height"]))
        r += 1

    for row in p["data"]:
        parts.append(_row_xml(r, [
            _cell_xml("%s%d" % (col_letter(i), r), reg.xf(c["k"]), c["v"])
            for i, c in enumerate(row)], p["data_height"]))
        r += 1
    last_row = r - 1

    cols = ""
    if p["widths"]:
        cols = "<cols>" + "".join(
            '<col min="%d" max="%d" width="%s" customWidth="1"/>' % (i + 1, i + 1, w)
            for i, w in enumerate(p["widths"])) + "</cols>"
    view = ('<sheetViews><sheetView workbookViewId="0">'
            '<pane ySplit="%d" topLeftCell="A%d" activePane="bottomLeft" state="frozen"/>'
            "</sheetView></sheetViews>" % (head_row, head_row + 1)) if head_row else ""
    filt = ('<autoFilter ref="A%d:%s%d"/>' % (head_row, last_col, last_row)
            if p["filter"] and last_row > head_row else "")
    # 单格合并无意义（Excel 会当成脏数据），过滤掉后再去重
    all_merges = []
    for m in merges + p["merges"]:
        a, _, b = m.partition(":")
        if b and a != b and m not in all_merges:
            all_merges.append(m)
    merge_xml = ('<mergeCells count="%d">%s</mergeCells>'
                 % (len(all_merges), "".join('<mergeCell ref="%s"/>' % m for m in all_merges))
                 ) if all_merges else ""

    return (u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            u'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            u'<dimension ref="A1:%s%d"/>%s<sheetFormatPr defaultRowHeight="16"/>%s'
            u"<sheetData>%s</sheetData>%s%s</worksheet>"
            % (last_col, last_row, view, cols, "".join(parts), filt, merge_xml))


# ---------------------------------------------------------------- 单元格

def _cell_xml(ref, style_idx, value):
    """单元格 XML：数字走 <v>，其余一律 inlineStr（长数字串不会被 Excel 转成科学计数）。"""
    if value is None or value == "":
        return '<c r="%s" s="%d"/>' % (ref, style_idx)
    if isinstance(value, bool):
        return '<c r="%s" s="%d" t="b"><v>%d</v></c>' % (ref, style_idx, 1 if value else 0)
    if isinstance(value, (int, float)):
        return '<c r="%s" s="%d"><v>%s</v></c>' % (ref, style_idx, value)
    return '<c r="%s" s="%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
        ref, style_idx, escape(str(value)))


def _row_xml(idx, cells, height=None):
    ht = ' ht="%s" customHeight="1"' % height if height else ""
    return '<row r="%d"%s>%s</row>' % (idx, ht, "".join(cells))


# ---------------------------------------------------------------- 入口

def build_xlsx(sheets):
    """把若干张表的声明拼成 xlsx 字节流。

    sheet 支持的字段：
      name          工作表名
      title / note  顶部标题行与说明行（自动跨列合并）
      headers       表头（自动冻结 + 自动筛选）
      widths        列宽（字符数）
      rows          数据行；单元格可为标量，或 {"v": 值, "s": 样式名}
      center        需要居中的列下标（表格式简写）
      merges        额外合并区域（绝对坐标，如 "B4:D4"）
      styles        {样式名: {fill/color/bold/size/align/wrap/border}}
      head_height / data_height   行高
    """
    sheets = [s for s in sheets if s]
    if not sheets:
        raise ValueError("至少需要一张工作表")
    reg = StyleRegistry()
    ns_r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    ns_main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

    prepared = [_prep_sheet(s, reg) for s in sheets]
    styles_xml = reg.xml()

    ct = [u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          u'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
          u'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
          u'<Default Extension="xml" ContentType="application/xml"/>',
          u'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
          u'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>']
    for i in range(len(sheets)):
        ct.append(u'<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1))
    ct.append(u"</Types>")

    wb_sheets, wb_rels = [], []
    for i, p in enumerate(prepared):
        wb_sheets.append(u'<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(p["name"]), i + 1, i + 1))
        wb_rels.append(u'<Relationship Id="rId%d" Type="%s/worksheet" Target="worksheets/sheet%d.xml"/>'
                       % (i + 1, ns_r, i + 1))
    wb_rels.append(u'<Relationship Id="rId%d" Type="%s/styles" Target="styles.xml"/>'
                   % (len(sheets) + 1, ns_r))

    parts = OrderedDict()
    parts["_rels/.rels"] = (u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                            u'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                            u'<Relationship Id="rId1" Type="%s/officeDocument" Target="xl/workbook.xml"/>'
                            u"</Relationships>" % ns_r)
    parts["xl/workbook.xml"] = (u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                                u'<workbook xmlns="%s" xmlns:r="%s"><sheets>%s</sheets></workbook>'
                                % (ns_main, ns_r, "".join(wb_sheets)))
    parts["xl/_rels/workbook.xml.rels"] = (
        u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        u'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>'
        % "".join(wb_rels))
    parts["xl/styles.xml"] = styles_xml
    for i, p in enumerate(prepared):
        parts["xl/worksheets/sheet%d.xml" % (i + 1)] = _sheet_xml(p, reg)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        # [Content_Types].xml 必须排在首位，部分解析器（含 WPS 老版本）按顺序读
        z.writestr("[Content_Types].xml", "".join(ct).encode("utf-8"))
        for path, xml in parts.items():
            z.writestr(path, xml.encode("utf-8"))
    return buf.getvalue()
