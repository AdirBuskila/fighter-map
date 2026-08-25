#!/usr/bin/env python3
"""
Run the schema and trust-rule tests against a real Postgres.

Starts a throwaway PostGIS container, applies the migration, runs
supabase/tests/trust_rules.sql, and reports. Nothing here touches your Supabase
project; the container is disposable and the script offers to remove it.

    python scripts/test_db.py
    python scripts/test_db.py --keep     # leave the container running
    python scripts/test_db.py --rebuild  # start from an empty database

Needs Docker running. Everything it asserts is also true of Supabase, which is
plain Postgres 15/16 with PostGIS; the only difference is the anon and
authenticated and service_role roles, which this script creates so the GRANT
and POLICY statements at the end of the migration can run.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
TESTS = ROOT / "supabase" / "tests" / "trust_rules.sql"

CONTAINER = "fighter-pg"
IMAGE = "postgis/postgis:16-3.4"
DB = "fighter"


def run(args: list, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", **kwargs)


def docker_ok() -> bool:
    return run(["docker", "info", "--format", "{{.ServerVersion}}"]).returncode == 0


def container_running() -> bool:
    result = run(["docker", "ps", "--filter", f"name=^{CONTAINER}$", "--format", "{{.Names}}"])
    return CONTAINER in result.stdout


def psql(sql_file: str, stop_on_error: bool = True) -> subprocess.CompletedProcess:
    args = ["docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", DB, "-q", "-t", "-A"]
    if stop_on_error:
        args += ["-v", "ON_ERROR_STOP=1"]
    return run(args + ["-f", sql_file])


def psql_c(command: str) -> subprocess.CompletedProcess:
    return run(["docker", "exec", CONTAINER, "psql", "-U", "postgres", "-d", DB,
                "-q", "-t", "-A", "-c", command])


def start_container(rebuild: bool) -> None:
    if rebuild or not container_running():
        run(["docker", "rm", "-f", CONTAINER])
        print("starting %s" % IMAGE)
        created = run([
            "docker", "run", "-d", "--name", CONTAINER,
            "-e", "POSTGRES_PASSWORD=test", "-e", f"POSTGRES_DB={DB}",
            "-p", "55432:5432", IMAGE,
        ])
        if created.returncode != 0:
            sys.exit("could not start the container:\n" + created.stderr)

    # The official image starts Postgres once to run its init scripts, then
    # restarts it. pg_isready says yes during that first pass, so wait for
    # several consecutive good queries rather than the first one.
    streak = 0
    for _ in range(90):
        if psql_c("select 1").returncode == 0:
            streak += 1
            if streak >= 4:
                return
        else:
            streak = 0
        time.sleep(1)
    sys.exit("the database never became ready")


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Test the schema against real Postgres")
    ap.add_argument("--keep", action="store_true", help="leave the container running")
    ap.add_argument("--rebuild", action="store_true", help="start from an empty database")
    args = ap.parse_args()

    if not docker_ok():
        sys.exit("Docker is not running. Start Docker Desktop and try again.")

    start_container(args.rebuild)

    # These three exist on Supabase but not in a bare Postgres image, and the
    # migration's GRANT and POLICY statements name all of them.
    for role in ("anon", "authenticated", "service_role"):
        psql_c(
            "do $$ begin if not exists "
            "(select from pg_roles where rolname='%s') "
            "then create role %s nologin; end if; end $$;" % (role, role)
        )

    print("\napplying %d migrations" % len(MIGRATIONS))
    for path in MIGRATIONS:
        run(["docker", "cp", str(path), f"{CONTAINER}:/tmp/{path.name}"])
        applied = psql("/tmp/%s" % path.name)
        if applied.returncode != 0:
            print("  FAILED  %s" % path.name)
            print(applied.stderr or applied.stdout)
            return 1
        print("  ok      %s" % path.name)

    run(["docker", "cp", str(TESTS), f"{CONTAINER}:/tmp/tests.sql"])

    print("\nrunning the trust rule tests")
    tested = psql("/tmp/tests.sql")
    output = (tested.stderr + tested.stdout).replace("psql:/tmp/tests.sql:", "")
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        if "NOTICE:" in line:
            print(line.split("NOTICE:", 1)[1].rstrip())
        elif "ERROR:" in line or "FATAL" in line:
            print("  " + line)

    if tested.returncode != 0:
        print("\nTESTS FAILED")
        return 1

    if not args.keep:
        run(["docker", "rm", "-f", CONTAINER])
        print("\ncontainer removed. pass --keep to hold on to it.")
    else:
        print("\ncontainer %s left running on localhost:55432 (password: test)" % CONTAINER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
