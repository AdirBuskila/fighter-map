#!/usr/bin/env python3
"""
Check the migration against the real Postgres grammar, and check that the four
places that describe a place all still agree with each other.

There is no database in CI and none on a fresh clone, so a broken migration
would otherwise only surface when somebody pastes it into the SQL editor and
watches it fail. This parses it with libpg_query, the actual Postgres parser,
and then cross-checks the contracts that a parser cannot see:

  * a function's RETURNS TABLE list and its SELECT list are matched by
    POSITION, so a mismatch parses cleanly and returns the wrong data
  * the Place type in TypeScript has to match what the RPCs return
  * every column 05_seed_supabase.py writes has to exist on the table

Usage: python scripts/check_migration.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from pglast import parse_sql
from pglast.parser import ParseError

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
TYPES_TS = ROOT / "src" / "lib" / "types.ts"
SEED_PY = ROOT / "scripts" / "05_seed_supabase.py"

RPCS = ("places_near", "places_all", "place_by_id")


def fail(problems: list, message: str) -> None:
    problems.append(message)
    print("  FAIL  %s" % message)


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    # Later migrations redefine functions and rename columns, so the contracts
    # have to be checked against the concatenation, with the last word winning.
    sql = chr(10).join(path.read_text(encoding="utf-8") for path in MIGRATIONS)
    problems: list = []

    print("1. does the migration parse?  (%d files)" % len(MIGRATIONS))
    try:
        statements = parse_sql(sql)
        print("  ok    %d statements" % len(statements))
    except ParseError as exc:
        fail(problems, "migration does not parse: %s" % exc)
        return 1

    print("\n2. do the function bodies parse?")
    bodies = re.findall(
        r"create or replace function\s+(\w+)\(.*?language\s+(\w+).*?as \$\$(.*?)\$\$;",
        sql,
        re.S | re.I,
    )
    for name, language, body in bodies:
        if language.lower() != "sql":
            continue  # plpgsql is checked by its embedded statements below
        try:
            parse_sql(body)
            print("  ok    %s" % name)
        except ParseError as exc:
            fail(problems, "%s body: %s" % (name, exc))

    print("\n3. do RETURNS TABLE and SELECT agree on column count?")
    declared_columns: dict = {}
    for name in RPCS:
        # 0002 redefines all three, so take the LAST definition, not the first.
        blocks = list(re.finditer(
            r"function\s+%s\(.*?returns table \((.*?)\n\)\s*\nlanguage.*?as \$\$(.*?)\$\$;" % name,
            sql,
            re.S | re.I,
        ))
        block = blocks[-1] if blocks else None
        if not block:
            fail(problems, "cannot find function %s" % name)
            continue

        columns = [
            line.strip().split()[0]
            for line in block.group(1).split("\n")
            if line.strip()
        ]
        declared_columns[name] = columns

        body = block.group(2)
        low = body.lower()
        head = body[low.index("select") + 6 : low.index("from places")]
        depth, selected = 0, 1
        for char in head:
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            elif char == "," and depth == 0:
                selected += 1

        if len(columns) == selected:
            print("  ok    %-12s %d columns" % (name, selected))
        else:
            fail(problems, "%s declares %d columns but selects %d"
                 % (name, len(columns), selected))

    print("\n4. do the RPCs all return the same shape?")
    shapes = {name: tuple(cols) for name, cols in declared_columns.items()}
    if len(set(shapes.values())) == 1:
        print("  ok    all three match")
    else:
        reference = shapes.get("places_near", ())
        for name, shape in shapes.items():
            if shape != reference:
                fail(problems, "%s differs from places_near: %s"
                     % (name, set(shape) ^ set(reference)))

    print("\n5. does the Place type in TypeScript match?")
    types_src = TYPES_TS.read_text(encoding="utf-8")
    block = re.search(r"export type Place = \{(.*?)\n\};", types_src, re.S)
    if not block:
        fail(problems, "cannot find the Place type")
    else:
        ts_fields = set(re.findall(r"^\s*(\w+):", block.group(1), re.M))
        sql_fields = set(declared_columns.get("places_near", ()))
        missing = sql_fields - ts_fields
        extra = ts_fields - sql_fields
        if not missing and not extra:
            print("  ok    %d fields" % len(ts_fields))
        if missing:
            fail(problems, "Place is missing: %s" % ", ".join(sorted(missing)))
        if extra:
            fail(problems, "Place has fields the RPC never returns: %s"
                 % ", ".join(sorted(extra)))

    print("\n6. does the seed script only write columns that exist?")
    table = re.search(r"create table if not exists places \((.*?)\n\);", sql, re.S)
    table_columns = set(
        re.findall(r"^\s{2}(\w+)\s+\S", table.group(1), re.M)
    ) if table else set()
    # Apply any rename a later migration performs.
    for old_name, new_name in re.findall(
        r"alter table places rename column (\w+) to (\w+);", sql
    ):
        table_columns.discard(old_name)
        table_columns.add(new_name)
    seed_src = SEED_PY.read_text(encoding="utf-8")
    seed_block = re.search(r"COLUMNS = \[(.*?)\]", seed_src, re.S)
    seed_columns = set(re.findall(r'"(\w+)"', seed_block.group(1))) if seed_block else set()
    unknown = seed_columns - table_columns
    if not unknown:
        print("  ok    %d columns, all present on the table" % len(seed_columns))
    else:
        fail(problems, "seed writes unknown columns: %s" % ", ".join(sorted(unknown)))

    print()
    if problems:
        print("%d PROBLEM%s" % (len(problems), "" if len(problems) == 1 else "S"))
        return 1
    print("migration and contracts are consistent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
