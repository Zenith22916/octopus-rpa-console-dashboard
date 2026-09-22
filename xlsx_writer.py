# -*- coding: utf-8 -*-
"""
极简 XLSX 生成器（纯标准库，零第三方依赖）
==================================================
把若干张表按「标题 / 说明 / 表头 / 数据」四段式拼成 .xlsx 字节流，供 local_server.py
的导出接口直接下发（内存生成，不落盘）。

为什么不用 openpyxl：部署环境不一定装了它（organize.py 里就做了 ImportError 兜底），
而 .xlsx 本质是一个装着几份 XML 的 zip。这里用 zipfile + 字符串拼装，只依赖标准库。

样式（固定几种，够用即可）：
  0 正文   1 标题   2 说明   3 表头（蓝底白字加粗居中）   4 正文居中
每张表自动带：冻结表头区、表头自动筛选、标题/说明行跨列合并。

用法：
    data = build_xlsx([{
        "name": "排期明细",
        "title": "触发器排期明细（每周视图）",
        "note": "机器人：全部　状态：已启用　导出时间：2026-09-22 10:50",
        "headers": ["序号", "机器人", "应用"],
        "widths": [6, 18, 30],
        "rows": [[1, "B💎宝实-03", "宝实3_创建发货"]],
        "center": [0],          # 需要居中的列下标（可选）
    }])
"""
import io
import zipfile
from xml.sax.saxutils import escape

# 表头底色（深蓝）与边框色，与 organize.py 产出的 Excel 观感保持一致
HEAD_BG = "FF4472C4"
LINE_RGB = "FFD9D9D9"
FONT_NAME = "等线"
NOTE_COLOR = "FF808080"

S_BODY, S_TITLE, S_NOTE, S_HEAD, S_BODY_C = 0, 1, 2, 3, 4


def col_letter(idx):
    """0 -> A、25 -> Z、26 -> AA。"""
    s = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def _cell(ref, style, value):
    """单元格 XML：数字走 <v>，其余一律 inlineStr（长数字串不会被 Excel 转成科学计数）。"""
    if value is None or value == "":
        return '<c r="%s" s="%d"/>' % (ref, style)
    if isinstance(value, bool):
        return '<c r="%s" s="%d" t="b"><v>%d</v></c>' % (ref, style, 1 if value else 0)
    if isinstance(value, (int, float)):
        return '<c r="%s" s="%d"><v>%s</v></c>' % (ref, style, value)
    return '<c r="%s" s="%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
        ref, style, escape(str(value)))


def _row(idx, cells, height=None):
    ht = ' ht="%s" customHeight="1"' % height if height else ""
    return "<row r=\"%d\"%s>%s</row>" % (idx, ht, "".join(cells))


def _sheet_xml(sheet):
    """单张表的 XML（标题/说明/表头/数据 + 冻结 + 自动筛选）。"""
    headers = sheet.get("headers") or []
    rows = sheet.get("rows") or []
    widths = sheet.get("widths") or []
    centers = set(sheet.get("center") or [])
    ncol = max([0] + [len(headers)] + [len(r) for r in rows]) or 1
    last_col = col_letter(ncol - 1)

    title = sheet.get("title") or ""
    note = sheet.get("note") or ""
    r = 1
    parts, merges = [], []
    if title:
        parts.append(_row(r, [_cell("A%d" % r, S_TITLE, title)], 24))
        merges.append("A%d:%s%d" % (r, last_col, r))
        r += 1
    if note:
        parts.append(_row(r, [_cell("A%d" % r, S_NOTE, note)]))
        merges.append("A%d:%s%d" % (r, last_col, r))
        r += 1
    head_row = r
    if headers:
        parts.append(_row(head_row, [_cell("%s%d" % (col_letter(i), head_row), S_HEAD, h)
                                     for i, h in enumerate(headers)], 22))
        r += 1
    for row in rows:
        cells = []
        for i, v in enumerate(row[:ncol]):
            style = S_BODY_C if i in centers else S_BODY
            cells.append(_cell("%s%d" % (col_letter(i), r), style, v))
        parts.append(_row(r, cells))
        r += 1
    last_row = r - 1

    cols = ""
    if widths:
        cols = "<cols>" + "".join(
            '<col min="%d" max="%d" width="%s" customWidth="1"/>' % (i + 1, i + 1, w)
            for i, w in enumerate(widths)) + "</cols>"

    view = ('<sheetViews><sheetView workbookViewId="0">'
            '<pane ySplit="%d" topLeftCell="A%d" activePane="bottomLeft" state="frozen"/>'
            "</sheetView></sheetViews>" % (head_row, head_row + 1)) if head_row > 1 else ""
    filt = ('<autoFilter ref="A%d:%s%d"/>' % (head_row, last_col, last_row)
            if headers and last_row > head_row else "")
    merge_xml = ("<mergeCells count=\"%d\">%s</mergeCells>" % (
        len(merges), "".join('<mergeCell ref="%s"/>' % m for m in merges))) if merges else ""

    return (u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            u'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            u'<dimension ref="A1:%s%d"/>%s<sheetFormatPr defaultRowHeight="16"/>%s'
            u"<sheetData>%s</sheetData>%s%s</worksheet>"
            % (last_col, last_row, view, cols, "".join(parts), filt, merge_xml))


def _styles_xml():
    fonts = [
        '<font><sz val="11"/><color rgb="FF262626"/><name val="%s"/></font>' % FONT_NAME,
        '<font><b/><sz val="11"/><color rgb="FF262626"/><name val="%s"/></font>' % FONT_NAME,
        '<font><b/><sz val="14"/><color rgb="FF1F3864"/><name val="%s"/></font>' % FONT_NAME,
        '<font><sz val="10"/><color rgb="%s"/><name val="%s"/></font>' % (NOTE_COLOR, FONT_NAME),
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="%s"/></font>' % FONT_NAME,
    ]
    fills = [
        '<fill><patternFill patternType="none"/></fill>',
        '<fill><patternFill patternType="gray125"/></fill>',
        '<fill><patternFill patternType="solid"><fgColor rgb="%s"/><bgColor indexed="64"/></patternFill></fill>' % HEAD_BG,
    ]
    thin = '<%s style="thin"><color rgb="%s"/></%s>'
    border = ("<border>" + thin % ("left", LINE_RGB, "left") + thin % ("right", LINE_RGB, "right")
              + thin % ("top", LINE_RGB, "top") + thin % ("bottom", LINE_RGB, "bottom")
              + "<diagonal/></border>")
    borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>", border]

    def xf(font=0, fill=0, border_id=0, align=""):
        a = ' applyAlignment="1"' if align else ""
        return ('<xf numFmtId="0" fontId="%d" fillId="%d" borderId="%d" xfId="0"'
                ' applyFont="1" applyBorder="1"%s>%s</xf>' % (font, fill, border_id, a, align))
    left = '<alignment horizontal="left" vertical="center" wrapText="1"/>'
    center = '<alignment horizontal="center" vertical="center" wrapText="1"/>'
    xfs = [
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',      # 0 正文
        xf(font=2, align=left),                                               # 1 标题
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"'
        ' applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>',  # 2 说明
        xf(font=4, fill=2, border_id=1, align=center),                        # 3 表头
        xf(border_id=1, align=left),                                          # 4 正文
        xf(border_id=1, align=center),                                        # 4 正文居中
    ]
    return (u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            u'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            u'<fonts count="%d">%s</fonts><fills count="%d">%s</fills><borders count="%d">%s</borders>'
            u'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            u'<cellXfs count="%d">%s</cellXfs>'
            u'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            u"</styleSheet>"
            % (len(fonts), "".join(fonts), len(fills), "".join(fills),
               len(borders), "".join(borders), len(xfs), "".join(xfs)))


def build_xlsx(sheets):
    """把 [{name,title,note,headers,widths,rows,center}] 拼成 xlsx 字节流。"""
    sheets = [s for s in sheets if s]
    if not sheets:
        raise ValueError("至少需要一张工作表")
    ns_r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    ns_main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

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
    for i, s in enumerate(sheets):
        name = (s.get("name") or "Sheet%d" % (i + 1))[:31]
        name = name.replace(":", "_").replace("/", "_").replace("\\", "_")
        name = name.replace("?", "_").replace("*", "_").replace("[", "_").replace("]", "_")
        wb_sheets.append(u'<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(name), i + 1, i + 1))
        wb_rels.append(u'<Relationship Id="rId%d" Type="%s/worksheet" Target="worksheets/sheet%d.xml"/>'
                       % (i + 1, ns_r, i + 1))
    wb_rels.append(u'<Relationship Id="rId%d" Type="%s/styles" Target="styles.xml"/>'
                   % (len(sheets) + 1, ns_r))

    parts = {
        "[Content_Types].xml": "".join(ct),
        "_rels/.rels": (u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                        u'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                        u'<Relationship Id="rId1" Type="%s/officeDocument" Target="xl/workbook.xml"/>'
                        u"</Relationships>" % ns_r),
        "xl/workbook.xml": (u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                            u'<workbook xmlns="%s" xmlns:r="%s"><sheets>%s</sheets></workbook>'
                            % (ns_main, ns_r, "".join(wb_sheets))),
        "xl/_rels/workbook.xml.rels": (u'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                                       u'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>'
                                       % "".join(wb_rels)),
        "xl/styles.xml": _styles_xml(),
    }
    for i, s in enumerate(sheets):
        parts["xl/worksheets/sheet%d.xml" % (i + 1)] = _sheet_xml(s)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        # [Content_Types].xml 必须排在首位，部分解析器（含 WPS 老版本）按顺序读
        z.writestr("[Content_Types].xml", parts.pop("[Content_Types].xml").encode("utf-8"))
        for path, xml in parts.items():
            z.writestr(path, xml.encode("utf-8"))
    return buf.getvalue()
