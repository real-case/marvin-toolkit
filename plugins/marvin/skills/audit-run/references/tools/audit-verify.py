#!/usr/bin/env python3
"""Verify that an audit PDF carries the same findings as its Markdown source.

The PDF is a rendering of the .md, so the two must agree on the set of finding ids.
This check is what makes "single source" enforceable rather than aspirational: a
finding lost to a layout bug, a truncated build, or an accidental edit of one artefact
shows up here as a set difference.

Three id sets are compared:

    prose     ### F-AXX-NN headings in the Markdown
    register  ids inside the ```json findings``` block
    pdf       ids extracted from the rendered PDF text

Usage:
    python3 audit-verify.py <report.md> <report.pdf>

Exit codes:
    0  all three sets are equal
    1  a mismatch (the differences are printed)
    3  the PDF text could not be extracted by any available method
    4  the input could not be read
"""

import json
import os
import re
import subprocess
import sys

FINDING_ID = re.compile(r"F-A\d{2}-\d{2,}")
HEADING_ID = re.compile(r"^#{2,4}\s+(F-A\d{2}-\d{2,})\b", re.MULTILINE)
FENCE = re.compile(r"```json\s+findings\s*\n(.*?)\n```", re.DOTALL)
AUDIT_ID = re.compile(r"^audit_id:\s*(A-\d{2})\s*$", re.MULTILINE)


def prose_ids(text):
    return set(HEADING_ID.findall(text))


def register_ids(text):
    match = FENCE.search(text)
    if not match:
        return None, "no ```json findings``` block in the report"
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        return None, "the findings block is not valid JSON: %s" % exc
    if not isinstance(data, list):
        return None, "the findings block is not a JSON array"
    ids, incomplete = set(), []
    required = ("id", "audit_id", "severity", "confidence", "category", "title",
                "effort_days", "effort_type", "evidence", "blocks", "blocked_by")
    for entry in data:
        if not isinstance(entry, dict):
            return None, "the findings block contains a non-object entry"
        ids.add(entry.get("id", "<missing id>"))
        missing = [key for key in required if key not in entry]
        if missing:
            incomplete.append((entry.get("id", "?"), missing))
    return (ids, incomplete), None


def pdf_text(path):
    """Extract text with pdftotext, then pypdf, then pdfminer.six."""
    try:
        out = subprocess.run(["pdftotext", "-layout", path, "-"],
                             capture_output=True, check=True)
        return out.stdout.decode("utf-8", "replace"), "pdftotext"
    except (OSError, subprocess.CalledProcessError):
        pass
    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
        return "\n".join((page.extract_text() or "") for page in reader.pages), "pypdf"
    except Exception:
        pass
    try:
        from pdfminer.high_level import extract_text
        return extract_text(path), "pdfminer"
    except Exception:
        return None, None


def main():
    if len(sys.argv) < 3:
        sys.stderr.write(__doc__)
        return 4
    md_path, pdf_path = sys.argv[1], sys.argv[2]
    for path in (md_path, pdf_path):
        if not os.path.isfile(path):
            sys.stderr.write("no such file: %s\n" % path)
            return 4

    with open(md_path, encoding="utf-8") as handle:
        md = handle.read()

    prose = prose_ids(md)
    register, error = register_ids(md)
    if error:
        sys.stderr.write("FAIL: %s\n" % error)
        return 1
    register_set, incomplete = register

    text, method = pdf_text(pdf_path)
    if text is None:
        sys.stderr.write(
            "FAIL: no PDF text extractor available — install poppler-utils, pypdf "
            "or pdfminer.six to complete the release check\n"
        )
        return 3
    # Normalise whitespace so an id broken across a wrap is still matched.
    pdf = set(FINDING_ID.findall(re.sub(r"[\s­]+", "", text)))

    problems = []
    if prose != register_set:
        problems.append("prose vs register: only in prose %s; only in register %s"
                        % (sorted(prose - register_set), sorted(register_set - prose)))
    missing = prose - pdf
    if missing:
        problems.append("prose findings absent from the pdf: %s" % sorted(missing))
    # Cross-references to other audits are expected in `Зависимости`, so only ids
    # belonging to THIS audit are held to equality.
    audit = AUDIT_ID.search(md)
    if audit:
        own = {i for i in pdf if i.startswith("F-%s-" % audit.group(1))}
        stray = own - prose
        if stray:
            problems.append("pdf carries own-audit ids the prose does not file: %s"
                            % sorted(stray))
    else:
        problems.append("the report frontmatter declares no audit_id")
    for finding_id, missing in incomplete:
        problems.append("register entry %s is missing fields: %s"
                        % (finding_id, ", ".join(missing)))

    print("findings: prose=%d register=%d pdf=%d (extractor: %s)"
          % (len(prose), len(register_set), len(pdf), method))
    if problems:
        print("RELEASE CHECK FAILED")
        for problem in problems:
            print("  - %s" % problem)
        return 1
    print("RELEASE CHECK PASSED — ids identical across .md, register and .pdf")
    return 0


if __name__ == "__main__":
    sys.exit(main())
