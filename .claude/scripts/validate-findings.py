#!/usr/bin/env python3
"""Validate pre-launch report findings against the Output Contract.

Exit 0: all findings valid.
Exit 1: one or more malformed findings (names each one).
Exit 2: usage error or unreadable file.
"""

import re
import sys

FINDING_HEADING_RE = re.compile(r'^####\s+(\S+)\s+(.*)')
FINDING_ID_RE = re.compile(r'^(AR|FE|BE|PE|DO|SE|QA|UX)-(B|H|M|L|S)\d+$')
SECTION_HEADING_RE = re.compile(r'^#{1,4}\s')
FILE_LINE_RE = re.compile(r'\S+:\d+')

REQUIRED_FIELDS = [
    '**Severity:**',
    '**Time horizon:**',
    '**Evidence type:**',
    '**Files:**',
    "**What's happening:**",
    '**Why it matters:**',
    '**Recommendation:**',
    '**Regression risk:**',
    '**Expected impact:**',
    '**Effort estimate:**',
]


def parse_findings(text):
    findings = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        m = FINDING_HEADING_RE.match(lines[i])
        if m and FINDING_ID_RE.match(m.group(1)):
            finding_id = m.group(1)
            title = m.group(2).strip()
            body_lines = []
            i += 1
            while i < len(lines) and not SECTION_HEADING_RE.match(lines[i]):
                body_lines.append(lines[i])
                i += 1
            findings.append((finding_id, title, '\n'.join(body_lines)))
        else:
            i += 1
    return findings


def validate_finding(finding_id, title, body):
    errors = []

    for field in REQUIRED_FIELDS:
        if field not in body:
            errors.append(f'missing required field: {field}')

    files_m = re.search(r'\*\*Files:\*\*\s*(.*)', body)
    if files_m:
        if not FILE_LINE_RE.search(files_m.group(1)):
            errors.append('**Files:** has no file:line reference')
    elif '**Files:**' not in body:
        errors.append('no file:line reference (missing **Files:** field)')

    return errors


def main():
    if len(sys.argv) != 2:
        print(f'Usage: {sys.argv[0]} <report-path>', file=sys.stderr)
        sys.exit(2)

    try:
        with open(sys.argv[1], encoding='utf-8') as f:
            text = f.read()
    except OSError as exc:
        print(f'Error reading {sys.argv[1]}: {exc}', file=sys.stderr)
        sys.exit(2)

    findings = parse_findings(text)
    if not findings:
        print('No findings found in report.')
        sys.exit(0)

    failed = []
    for finding_id, title, body in findings:
        errs = validate_finding(finding_id, title, body)
        if errs:
            failed.append((finding_id, title, errs))

    if failed:
        print(f'FAIL: {len(failed)} malformed finding(s):\n', file=sys.stderr)
        for finding_id, title, errs in failed:
            print(f'  {finding_id} -- {title}', file=sys.stderr)
            for err in errs:
                print(f'    - {err}', file=sys.stderr)
        sys.exit(1)

    print(f'OK: {len(findings)} finding(s) validated.')
    sys.exit(0)


if __name__ == '__main__':
    main()
