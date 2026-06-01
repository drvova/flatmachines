---
id: ftj-jki0
status: closed
deps: []
links: []
created: 2026-06-01T04:05:33Z
type: chore
priority: 2
assignee: memgrafter
---
# SQLite test databases leak into working directory

When running unit tests, `test_persistence_config_sqlite_default_db_path` in `tests/unit/test_sqlite_persistence_config.py` intentionally omits `db_path`, so `FlatMachine` falls through to the default `"flatmachines.sqlite"` and creates the file + WAL files in CWD with no cleanup.

**Root cause**: The test at line 55-62 intentionally tests the default `db_path` resolution without using `tmp_path`. The SQLiteCheckpointBackend creates `flatmachines.sqlite`, `flatmachines.sqlite-shm`, and `flatmachines.sqlite-wal` in CWD.

**Fix**: Use `monkeypatch.chdir(tmp_path)` so the default path resolves inside pytest's temp directory, which is auto-cleaned after the test session.
