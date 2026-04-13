#!/usr/bin/env python3
import json
import re
from pathlib import Path


RECORD_START = re.compile(r"^NC-\d{4}-\d{3}\b")
RECORD_RE = re.compile(
    r'^(?P<case_id>NC-\d{4}-\d{3})\s+'
    r'(?P<aircraft_model>Airbus A220-\d+)\s+'
    r'(?P<msn>\d+)\s+'
    r'(?P<title>.*?)\s+'
    r'"(?P<description>.*)"$',
    re.S,
)


def parse_records(raw_text: str) -> list[dict]:
    records: list[str] = []
    current: list[str] = []

    for line in raw_text.splitlines():
        if RECORD_START.match(line) and current:
            records.append("\n".join(current).strip())
            current = [line]
        else:
            current.append(line)

    if current:
        records.append("\n".join(current).strip())

    parsed: list[dict] = []
    for raw_record in records:
        match = RECORD_RE.match(raw_record)
        if not match:
            parsed.append(
                {
                    "raw_record": raw_record,
                    "parse_status": "unparsed",
                }
            )
            continue

        item = match.groupdict()
        item["description"] = item["description"].strip()
        item["parse_status"] = "ok"
        parsed.append(item)

    return parsed


def main() -> None:
    source = Path(__file__).with_name("scenarios.csv")
    target = Path(__file__).with_name("baseline_cases.json")
    raw_text = source.read_text(encoding="utf-8")
    cases = parse_records(raw_text)
    target.write_text(
        json.dumps(
            {
                "source_file": str(source.name),
                "generated_at": "2026-04-11",
                "case_count": len(cases),
                "cases": cases,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
