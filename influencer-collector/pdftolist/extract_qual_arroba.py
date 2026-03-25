"""
Extrai o texto da coluna "Qual o @ (identifica a rede)" do PDF exportado do Google Forms.

Uma linha por resposta (linhas 3–665 da planilha), na ordem do PDF.
Linha vazia = não foi possível obter o @ só pelo texto extraído.
"""
from __future__ import annotations

import re
from pathlib import Path

from pypdf import PdfReader

PDF_PATH = Path(__file__).with_name("influencers.pdf")
# Lista alinhada às linhas 3–665 da planilha (uma entrada por resposta).
OUT_PATH = Path(__file__).with_name("handles.txt")
OUT_TSV_PATH = Path(__file__).with_name("handles-coluna-qual-o-arroba.tsv")

ROW_START = re.compile(
    r"(\d+)\s+(\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2})(.*?)(?=\d+\s+\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}|\Z)",
    re.DOTALL,
)

CAP = "A-Z\u00c0-\u024f"
LOW = "a-z\u00e0-\u024f"
MONTH_PT = (
    r"dezembro|dez\.?|janeiro|jan\.?|fevereiro|fev\.?|mar[cç]o|mar\.?|abril|abr\.?|"
    r"maio|mai\.?|junho|jun\.?|julho|jul\.?|agosto|ago\.?|setembro|set\.?|outubro|out\.?|novembro|nov\.?"
)

HANDLE_AT = re.compile(r"@([a-zA-Z0-9._]+)")


def strip_trailing_nota_suffix(username: str) -> str:
    """
    Remove 1–2 dígitos finais se formarem nota 1–10 (coluna ao lado colada no PDF).
    Ex.: gildovigor10 → gildovigor. Não altera user12 (12 > 10).

    Ordem: 2 dígitos antes de 1 — senão regex gananciosa quebra "…10" em "…1" + "0".
    """
    for width in (2, 1):
        if len(username) <= width:
            continue
        suf = username[-width:]
        if not suf.isdigit():
            continue
        n = int(suf)
        if not (1 <= n <= 10):
            continue
        base = username[:-width]
        if base and not base[-1].isdigit():
            return base
    return username


def trim_glued_review(s: str) -> str:
    s = s.strip()
    m = re.search(rf"(\s+20\d{{2}})\s+([{CAP}])", s)
    if m:
        return s[: m.end(1)].strip()
    m = re.search(rf"(\s+20\d{{2}})\s+([{LOW}]{{3,30}})\b", s)
    if m:
        return s[: m.end(1)].strip()
    m = re.search(rf"(20\d{{2}})([{CAP}])", s)
    if m:
        return s[: m.start(2)].strip()
    m = re.search(rf"(20\d{{2}})([{LOW}]{{3,}})", s)
    if m:
        return s[: m.start(2)].strip()
    return s


def split_meta_blob(blob: str) -> str:
    blob = blob.replace("\r", "").strip()
    if not blob:
        return ""
    lines = [ln.strip() for ln in blob.split("\n") if ln.strip()]
    if not lines:
        return ""
    first = lines[0]
    first = trim_glued_review(first)
    if len(lines) > 1 and lines[1].lstrip().startswith("@"):
        return (first + " " + lines[1].split("\n", 1)[0]).strip()
    return first.strip()


def strip_trailing_period(meta: str) -> str:
    meta = meta.strip()
    meta = re.sub(rf"\s+(?:{MONTH_PT})\s+20\d{{2}}.*$", "", meta, flags=re.I)
    meta = re.sub(rf"\s+(?:{MONTH_PT})\s+de\s+20\d{{2}}.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+nov\.?/\d{4}.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+\d{1,2}/\d{4}.*$", "", meta)
    meta = re.sub(r"\s+\d{1,2}\s+\d{2}/\d{4}.*$", "", meta)
    meta = re.sub(r"\s+20\d{2}\s*/\s*20\d{2}.*$", "", meta)
    meta = re.sub(r"\s+20\d{2}\s+/\s+20\d{2}.*$", "", meta)
    meta = re.sub(r"\s+20\d{2}\s*-\s*20\d{2}.*$", "", meta)
    meta = re.sub(r"\s+20\d{2}\s*-\s*\d{1,2}.*$", "", meta)
    meta = re.sub(r"\s+20\d{2}\s+e\s+20\d{2}.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+20\d{2}\s*,\s*20\d{2}.*$", "", meta)
    meta = re.sub(r"\s+20\d{2}\s+a\s+20\d{2}.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+20\d{2}\s+final\s+de.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+primeiro\s+trimestre\s+20\d{2}.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+Desde\s+20\d{2}.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+\d{1,2}\s+Semestre.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+22/23/24.*$", "", meta)
    meta = re.sub(r"\s+10/2024.*$", "", meta)
    meta = re.sub(r"\s+11/2024.*$", "", meta)
    meta = re.sub(r"\s+janeiro\s+20\d{2}.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+Dezembro\s+de\s+20\d{2}.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s*\(desde\s+[^)]+\)\s*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+-\s*instagram\s+\d+.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+-\s*ig\s*\d+.*$", "", meta, flags=re.I)
    meta = re.sub(r"\s+-\s*tiktok/ig\d+.*$", "", meta, flags=re.I)
    return meta.strip()


def is_year(tok: str) -> bool:
    return bool(re.fullmatch(r"20\d{2}", tok))


def is_nota(tok: str) -> bool:
    return bool(re.fullmatch(r"\d{1,2}", tok)) and 1 <= int(tok) <= 10


def extract_handle_from_meta(meta: str) -> str:
    meta = meta.strip()
    if not meta or re.match(r"^Aviso!?$", meta, re.I):
        return ""

    m = HANDLE_AT.search(meta)
    if m:
        u = strip_trailing_nota_suffix(m.group(1))
        return "@" + u

    meta = strip_trailing_period(meta)
    meta = re.sub(r"\s+-\s*instagram\s*$", "", meta, flags=re.I).strip()

    parts = meta.split()
    while parts:
        t = parts[-1]
        if is_year(t) or is_nota(t) or re.fullmatch(r"\d{4}", t):
            parts.pop()
            continue
        break
    core = " ".join(parts).strip()
    if not core:
        return ""

    m = re.search(r"([a-z0-9._]+)\s*-\s*ig\s*\d+\s*$", core, re.I)
    if m:
        u = strip_trailing_nota_suffix(m.group(1).lower())
        return "@" + u

    parts = core.split()
    if len(parts) >= 2:
        cand = parts[-1]
        if re.fullmatch(r"[_a-z0-9.]+", cand, re.I) and len(cand) >= 2 and not is_year(cand):
            u = strip_trailing_nota_suffix(cand.lower())
            return "@" + u

    mm = re.search(r"([_a-z0-9][a-z0-9._]*)$", core, re.I)
    if mm:
        h = strip_trailing_nota_suffix(mm.group(1).lower())
        if len(h) >= 2 and not is_year(h):
            return "@" + h
    return ""


def main() -> None:
    text = "\n".join((p.extract_text() or "") for p in PdfReader(str(PDF_PATH)).pages)
    rows = ROW_START.findall(text)
    lines_out: list[str] = []
    tsv_lines = ["handle"]
    for _row_num, _ts, body in rows:
        meta = split_meta_blob(body)
        h = extract_handle_from_meta(meta)
        lines_out.append(h)
        tsv_lines.append(h)

    OUT_PATH.write_text("\n".join(lines_out) + "\n", encoding="utf-8")
    OUT_TSV_PATH.write_text("\n".join(tsv_lines) + "\n", encoding="utf-8")
    filled = sum(1 for x in lines_out if x)
    print(f"Linhas (respostas): {len(lines_out)}")
    print(f"Com @ extraído: {filled}")
    print(f"Escrito: {OUT_PATH}")
    print(f"Escrito: {OUT_TSV_PATH}")


if __name__ == "__main__":
    main()
