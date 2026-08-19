#!/usr/bin/env python3
"""
Generate the operation manual PDF from the markdown source.
Uses fpdf2 + SimHei font for Chinese support.
Output: Desktop/交付讲解与操作手册.pdf
"""
import os
import re
import sys
from fpdf import FPDF

FONT_PATH = r"C:\Windows\Fonts\simhei.ttf"
SRC_MD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "交付讲解与操作手册.md")
OUT_PDF = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Desktop", "交付讲解与操作手册.pdf")


class ManualPDF(FPDF):
    def __init__(self):
        super().__init__()
        self.add_font("SimHei", "", FONT_PATH)
        self.set_auto_page_break(auto=True, margin=18)
        self.set_margins(left=16, top=16, right=16)
        self.width = 210 - 32  # A4 width 210 - margins 16*2

    def header(self):
        pass

    def footer(self):
        self.set_y(-15)
        self.set_font("SimHei", size=8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 8, f"- {self.page_no()} -", align="C")
        self.set_text_color(0, 0, 0)


def render_markdown_to_pdf(md_text, pdf):
    lines = md_text.split("\n")
    i = 0
    in_code = False
    code_lines = []

    while i < len(lines):
        line = lines[i]

        # Code block
        if line.strip().startswith("```"):
            if in_code:
                # End code block -> render
                pdf.set_font("SimHei", size=8)
                pdf.set_fill_color(245, 242, 235)
                pdf.set_text_color(60, 50, 40)
                code_text = "\n".join(code_lines)
                # Split into lines that fit
                for cl in code_text.split("\n"):
                    cl = cl.rstrip()
                    if not cl:
                        pdf.cell(0, 5, "", ln=True)
                    else:
                        # Wrap long lines
                        remaining = cl
                        while remaining:
                            # Approximate char width for size 8 SimHei
                            max_chars = max(1, int(pdf.width / 4.3))
                            chunk = remaining[:max_chars]
                            pdf.cell(0, 5, chunk, ln=True, fill=True)
                            remaining = remaining[max_chars:]
                pdf.ln(2)
                pdf.set_text_color(0, 0, 0)
                code_lines = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue

        if in_code:
            code_lines.append(line)
            i += 1
            continue

        # H1
        if line.startswith("# ") and not line.startswith("## "):
            pdf.add_page()
            pdf.set_font("SimHei", size=18)
            pdf.set_text_color(232, 89, 12)
            pdf.multi_cell(0, 10, line[2:].strip())
            pdf.ln(3)
            pdf.set_text_color(0, 0, 0)
            i += 1
            continue

        # H2
        if line.startswith("## "):
            pdf.ln(4)
            pdf.set_font("SimHei", size=14)
            pdf.set_text_color(232, 89, 12)
            pdf.set_fill_color(255, 240, 230)
            title = line[3:].strip()
            pdf.cell(0, 8, "  " + title, ln=True, fill=True)
            pdf.ln(2)
            pdf.set_text_color(0, 0, 0)
            i += 1
            continue

        # H3
        if line.startswith("### "):
            pdf.ln(2)
            pdf.set_font("SimHei", size=12)
            pdf.set_text_color(60, 50, 40)
            pdf.cell(0, 7, line[4:].strip(), ln=True)
            pdf.set_text_color(0, 0, 0)
            i += 1
            continue

        # Table (basic markdown table support)
        if "|" in line and i + 1 < len(lines) and re.match(r"^\s*\|[-:\s|]+\s*$", lines[i + 1]):
            # Collect table lines
            table_lines = [line]
            i += 1
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                table_lines.append(lines[i])
                i += 1
            # Parse and render
            rows = []
            for tl in table_lines:
                cells = [c.strip() for c in tl.strip().strip("|").split("|")]
                # Skip separator row
                if all(re.match(r"^[-:\s]+$", c) for c in cells):
                    continue
                rows.append(cells)
            if rows:
                max_cols = max(len(r) for r in rows)
                col_w = pdf.width / max_cols
                pdf.set_font("SimHei", size=8)
                for ri, row in enumerate(rows):
                    for ci in range(max_cols):
                        cell_text = row[ci] if ci < len(row) else ""
                        if ri == 0:
                            pdf.set_fill_color(255, 240, 230)
                            pdf.set_text_color(232, 89, 12)
                        else:
                            pdf.set_fill_color(250, 247, 242)
                            pdf.set_text_color(45, 42, 38)
                        # Truncate if too long
                        max_chars = max(1, int(col_w / 3.5))
                        if len(cell_text) > max_chars:
                            cell_text = cell_text[:max_chars - 1] + "..."
                        pdf.cell(col_w, 6, cell_text, border=1, fill=True)
                    pdf.ln()
                pdf.ln(2)
                pdf.set_text_color(0, 0, 0)
            continue

        # Blockquote
        if line.strip().startswith(">"):
            text = line.strip().lstrip(">").strip()
            pdf.set_font("SimHei", size=9)
            pdf.set_text_color(120, 110, 100)
            pdf.set_fill_color(248, 245, 240)
            # Wrap text
            remaining = text
            max_chars = max(1, int(pdf.width / 4.0))
            first = True
            while remaining:
                chunk = remaining[:max_chars]
                pdf.cell(0, 5, "  " + chunk if first else "  " + chunk, ln=True, fill=True)
                remaining = remaining[max_chars:]
                first = False
            pdf.ln(1)
            pdf.set_text_color(0, 0, 0)
            i += 1
            continue

        # Horizontal rule
        if re.match(r"^---+\s*$", line.strip()):
            pdf.ln(2)
            pdf.set_draw_color(220, 210, 195)
            pdf.line(16, pdf.get_y(), 210 - 16, pdf.get_y())
            pdf.ln(3)
            i += 1
            continue

        # List items
        m = re.match(r"^(\s*)[-*]\s+(.+)", line)
        if m:
            indent = len(m.group(1))
            text = m.group(2)
            pdf.set_font("SimHei", size=9.5)
            pdf.set_text_color(45, 42, 38)
            prefix = "  " * (indent // 2) + "- "
            remaining = prefix + text
            max_chars = max(1, int(pdf.width / 4.2))
            first = True
            while remaining:
                chunk = remaining[:max_chars]
                pdf.cell(0, 5.5, chunk, ln=True)
                remaining = remaining[max_chars:]
                first = False
            i += 1
            continue

        # Numbered list
        m = re.match(r"^(\s*)(\d+)\.\s+(.+)", line)
        if m:
            indent = len(m.group(1))
            num = m.group(2)
            text = m.group(3)
            pdf.set_font("SimHei", size=9.5)
            pdf.set_text_color(45, 42, 38)
            prefix = "  " * (indent // 2) + f"{num}. "
            remaining = prefix + text
            max_chars = max(1, int(pdf.width / 4.2))
            while remaining:
                chunk = remaining[:max_chars]
                pdf.cell(0, 5.5, chunk, ln=True)
                remaining = remaining[max_chars:]
            i += 1
            continue

        # Checkboxes
        m = re.match(r"^[-*]\s+\[.\]\s+(.+)", line.strip())
        if m:
            text = m.group(1)
            pdf.set_font("SimHei", size=9)
            pdf.set_text_color(80, 80, 80)
            remaining = "[ ] " + text
            max_chars = max(1, int(pdf.width / 4.2))
            while remaining:
                chunk = remaining[:max_chars]
                pdf.cell(0, 5.5, chunk, ln=True)
                remaining = remaining[max_chars:]
            pdf.set_text_color(0, 0, 0)
            i += 1
            continue

        # Empty line
        if not line.strip():
            pdf.ln(2)
            i += 1
            continue

        # Regular paragraph
        # Clean inline markdown
        text = line.rstrip()
        # Bold -> just keep text (fpdf2 doesn't easily do inline bold with custom font)
        text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
        text = re.sub(r"\*(.+?)\*", r"\1", text)
        text = re.sub(r"`(.+?)`", r"\1", text)

        pdf.set_font("SimHei", size=9.5)
        pdf.set_text_color(45, 42, 38)
        remaining = text
        max_chars = max(1, int(pdf.width / 4.2))
        while remaining:
            chunk = remaining[:max_chars]
            pdf.cell(0, 5.5, chunk, ln=True)
            remaining = remaining[max_chars:]
        i += 1


def main():
    with open(SRC_MD, "r", encoding="utf-8") as f:
        md_text = f.read()

    pdf = ManualPDF()
    pdf.add_page()
    render_markdown_to_pdf(md_text, pdf)

    os.makedirs(os.path.dirname(OUT_PDF), exist_ok=True)
    pdf.output(OUT_PDF)
    print(f"PDF generated: {OUT_PDF}")
    print(f"Size: {os.path.getsize(OUT_PDF)} bytes")


if __name__ == "__main__":
    main()
