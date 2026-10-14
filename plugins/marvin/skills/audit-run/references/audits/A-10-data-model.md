# A-10 — Модель данных и миграции

> **Audit question.** Will the data schema survive the product's growth, and are changes to it reversible?

## 1. Role and task

You audit the persistent data layer: the schema as it actually exists, the integrity guarantees behind it, the indexes measured against the queries really issued, the migration history, and what happens to a row after it is written.
The question closes on two counts — whether the schema absorbs the next year of product change without a rewrite, and whether a bad change can be undone. Besides the report, a run leaves two reusable artefacts in *Приложения*: an ER
diagram of the **actual** schema, not the one the code claims, and a `запрос — план — индекс` table. A-14, A-15, A-18 and A-22 consume both as parameter values.

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `DB_ENGINES` | stores in use, with versions | detect from manifests and lockfiles (`pg`, `psycopg`, `mysql2`, `sqlite3`, `mongoose`), `docker-compose*.yml` images, connection-string schemes in `.env*` samples, ORM config; record the command. Nothing detected → report "no persistent store found", `coverage: 0/0 tables`, no schema findings |
| `SCHEMA_ACCESS` | read-only DSN to a **non-production** copy, or a path to a schema dump | fall back to the committed artefact — `db/structure.sql`, `db/schema.rb`, `prisma/schema.prisma`, `schema.sql`, ORM models, migration bodies replayed on paper. Ask once for a copy-based DSN; without one the run is the code-only lane of §4 |
| `PROD_STATS_ACCESS` | query statistics: `pg_stat_statements`, `performance_schema` digests, an APM export | build a **proxy** ranking from code — call sites per query or ORM finder, weighted by whether the module sits on a `BUSINESS_CONTEXT` critical path and by `git log --format=%h -- <module> \| wc -l`. Every frequency claim so derived is labelled a proxy and files at `confidence: hypothesis` |
| `DATA_VOLUMES` | rows and growth per table | from live stats when `SCHEMA_ACCESS` is a DSN (`pg_stat_user_tables.n_live_tup`); else ask for orders of magnitude on the ten largest tables; else treat volume as unknown and demote every volume-conditional threshold of §6 to `hypothesis` rather than dropping it |
| `MIGRATION_DIRS` | where migrations live — a shell **array**, because Django's per-app `<app>/migrations/` and one directory per service in a monorepo both yield many roots | **every** match, never the first: `MIGRATION_DIRS=($(git ls-files \| grep -Ei '(^\|/)(migrations?\|db/migrate\|alembic/versions\|db/changelog\|db/migration)/' \| xargs -n1 dirname \| sed -E 's#(/migrations)/[^/]+$#\1#' \| sort -u))`, which covers `migrations/`, `db/migrate/`, `alembic/versions/`, `prisma/migrations/` (the `sed` collapses Prisma's one-directory-per-migration layout back to its root), `db/changelog/` and `src/main/resources/db/migration/`. Every root found is listed in *Методология*; stopping at the first silently caps the migration register, `IRR` and the destructive sweep at one of them |
| `MIGRATION_WINDOW` | which migrations are read in full | files added in the last 12 months per `git log --diff-filter=A`; if fewer than 20, the last 20 by filename order |
| `CRITICAL_ENTITIES` | the tables behind money and identity | from `BUSINESS_CONTEXT`; when empty, name-match `user`, `account`, `order`, `payment`, `invoice`, `subscription`, `transaction`, `session`, `token`, and say the list was name-derived |

## 3. Scope

**In scope.** Schema objects; primary, foreign and unique keys; `NOT NULL`, `CHECK`, column defaults; indexes against the queries actually issued; column types; the migration mechanism and its history; and the data lifecycle — soft
delete, audit columns, archival, retention. Every store in `DB_ENGINES`, relational or not: §4 states each step in its PostgreSQL form, and its closing *Other engines* paragraph gives the MySQL, SQLite and document-store equivalents
for steps 2–4 and 7.

**Migration bodies are the one class this audit deliberately keeps in.** Path exclusions are the contract's canonical set (`report-contract.md` §2); this audit adds none and drops exactly one element, `-g '!**/migrations/**'`, in step 5
alone, whose primary source those bodies are. Every other command takes the set unchanged, which is what makes step 7's "references outside migrations" test mean what it says.

**Out of scope**, each item routed to the audit that covers it:

- **Injection, query construction, roles, grants, row-level security, encryption at rest** — A-14. A raw-string query is evidence here that a constraint is code-enforced, never an injection finding.
- **Query tuning against latency targets, pooling, caching, and N+1 query patterns** — A-15, which holds the family's only N+1 threshold. This audit files a *missing* or an *unused* index as a schema fact; A-15 cross-references that row and files only the latency consequence, when it crosses a budget.
- **Backup and restore procedure, RPO/RTO, replicas** — A-18. Only a backup *before a destructive or irreversible migration* is judged here, because that is a property of the migration.
- **Legal basis for a field, deletion requests, PII classification** — A-22. This audit records the retention mechanism; whether the period is lawful is A-22's call.
- **ORM code quality and repository structure** — A-05 and A-09.
- **Queues, event logs and object storage as durability mechanisms** — A-12 and A-18; they enter here only when they hold the authoritative copy of a business entity.

## 4. Collection protocol

Step 0 fixes the lane; steps 1–7 are the source protocol in order; step 8 assembles. §5 holds each tool's invocation and its fallback. Every `rg` below runs with the contract's `RG_EXCLUDE` expanded (`rg "${RG_EXCLUDE[@]}" --hidden
--no-ignore …`), minus the one element §3 names for step 5. Two closing paragraphs say what every step does without a live schema, and what it does on a store that is not PostgreSQL.

**0. Fix the ground.** Record `COMMIT_SHA`, resolve `DB_ENGINES` **with versions** (`SHOW server_version`, `SELECT VERSION()`), enumerate **every** schema and database rather than the default one, and fix the access lane: `live` (a DSN
to a non-production copy), `dump` (a schema file), or `code-only` (models, DDL and migration bodies — `SCHEMA_ACCESS` unset and no dump). The lane caps `confidence` at `medium` for `dump`, `low` for `code-only`. *Produces:* the lane,
the engines with versions and the schema list, stated in *Методология*.

**1. Extract the actual schema and compare it with the code's description.** Dump the live schema (§5), obtain the declared one, diff them with comments and blanks stripped: `diff <(grep -vE '^\s*(--|$)' schema-declared.sql) <(grep -vE
'^\s*(--|$)' schema-live.sql)`. The tool-native drift checks are cheaper and write nothing: `python manage.py makemigrations --check --dry-run` (non-zero exit means drift), `alembic check` (Alembic ≥ 1.9 only — below it use the text
diff, never `alembic revision --autogenerate`, which writes a file), `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`. *Produces:* the two schema files and a drift
list saying per object whether it differs in existence, type, nullability, default or constraint.

**2. Integrity and defaults.** Census what the database enforces: `SELECT constraint_type, count(*) FROM information_schema.table_constraints WHERE constraint_schema NOT IN ('pg_catalog','information_schema') AND constraint_name !~
'_not_null$' GROUP BY 1;`. Without that name filter PostgreSQL ≤ 17 returns one implicit `CHECK` per `NOT NULL` column (`<oid>_<oid>_<attnum>_not_null`) and `D` double-counts nullability; count `NOT NULL` once and version-aware — from
`information_schema.columns.is_nullable` on ≤ 17, from `pg_constraint` `contype='n'` on 18+, which moved not-null into real constraint rows. The same `information_schema.columns` pass reads `data_type` and `column_default`: a default
is **not** a constraint, counts toward neither `D` nor `A`, and is judged by its own §6 row. Add `information_schema.triggers`, and enumerate triggers and **all** index kinds before calling an invariant code-only — a partial unique
index or a `BEFORE INSERT` trigger is database enforcement a grep will miss. The code side must be case-, separator- and framework-insensitive: `rg -n -i
'unique|validates|CheckConstraint|ValidationError|@IsNotEmpty|@IsEmail|@NotNull|@Column\(.*nullable:\s*false|z\.[a-z]+\(\)\.(min|email|uuid)|yup\.|joi\.|assert\('` over models and services, keeping only invariants with no schema
counterpart. A match in a **declaration** context — `@Index`, `@Unique`, `unique: true` inside a column definition, `UniqueConstraint` — is database enforcement: it counts toward `D`, never `A`. *Produces:* the census `D`, the default
list, the code-only list `A`, and so the **integrity index** of §9.

**3. Indexes, relations and real queries.** Take the top 20 by `total_exec_time` from `pg_stat_statements` (`total_time` on PostgreSQL ≤ 12); usage and size from `pg_stat_user_indexes` (the view carries no size column —
`pg_relation_size(indexrelid)` supplies it, §5); every definition from `pg_indexes.indexdef`; every foreign key from `SELECT conrelid::regclass, conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE contype='f';`. **Duplicates:**
strip the name from each `indexdef`, `sort | uniq -d`, then flag any index whose column list is a prefix of another's. **Missing index:** every foreign-key column with no index whose **leading** column matches. **Missing FK:**
enumerate relation candidates — `information_schema.columns` where `column_name ~ '_id$'` or matching a table name, plus ORM declarations (`rg -n -i
'belongs_to|has_many|ForeignKey|references|@ManyToOne|@OneToMany|belongsTo|relation\('`) — then subtract every column covered by a `contype='f'` constraint; the residue, classified by whether the relation is mandatory (`NOT NULL`), is
§6's missing-FK finding set and the dashed `код` edges of §8's ER diagram. **Plans:** `pg_stat_statements.query` is stored normalised, so `EXPLAIN` on it fails with `there is no parameter $1`; in a transaction opened `SET
default_transaction_read_only = on`, either `PREPARE p AS <query>` with `SET plan_cache_mode = force_generic_plan` and `EXPLAIN EXECUTE p(…)`, or bind representative literals — recording only the normalised text (§11), and never
`ANALYZE` on anything that writes. When neither binds, fall back to §5's inference from the index list and the query's `WHERE`/`ORDER BY` columns at `confidence: hypothesis`. *Produces:* the `запрос — план — индекс` table and four
lists — unused, missing index, missing FK, duplicate.

**4. Types.** From `information_schema.columns`, select rows whose `data_type` is a binary float or PostgreSQL's `money` — PostgreSQL reports `double precision`, `real` and `money` and never `float`, which is an alias; MySQL reports
`double` and `float`; `numeric`/`decimal` is the correct money type and is not a defect — or `data_type = 'timestamp without time zone'` (MySQL: `datetime` rather than `timestamp`), or `data_type IN ('text','character varying') AND
character_maximum_length IS NULL`. Cross the float rows against money-ish names (`price|amount|total|cost|balance|fee|tax|discount|revenue|rate`), the unbounded strings against user-supplied inputs, and read declared enumerations with
`SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid;`. A free-text status column with neither an enum type nor a `CHECK` is an untyped enumeration. *Produces:* a typed-defect list.

**5. Migrations.** Four reads over **every** file in **every** root of `MIGRATION_DIRS` — the array is expanded as the path arguments, `-- "${MIGRATION_DIRS[@]}"`, never quoted as one word — plus a fifth over CI and docs for backup
evidence. The roots read are named in *Методология*. Destructive steps need one alternation per migration format, and DML as well as DDL, because a `\s`-based SQL
pattern cannot cross the `_` in `drop_column`: `rg -n -i -e '\b(drop\s+(table|column|constraint|index)|truncate|alter\s+column|rename\s+(to|column)|delete\s+from|update\s+\w+\s+set)\b' -e
'op\.(drop_table|drop_column|drop_constraint|drop_index|execute)' -e '(RemoveField|DeleteModel|RenameField|RunSQL|RunPython)' -e '(remove_column|drop_table|rename_column|change_column)' -e '(dropTable|dropColumn|renameColumn|query\()'
-- "${MIGRATION_DIRS[@]}"` — raw SQL, Alembic, Django, Rails, knex/TypeORM in that order. A body carrying arbitrary SQL, Python or Ruby (`execute`, `RunSQL`, `RunPython`, a heredoc) is read **in full whatever the grep returned**, and so is
every file inside `MIGRATION_WINDOW`. Lock risk on PostgreSQL, where the flag matters more than the keyword: `rg -n -i 'create\s+(unique\s+)?index|op\.create_index|add_index|AddIndex|createIndex' -- "${MIGRATION_DIRS[@]}" | rg -v -i
'concurrently|postgresql_concurrently\s*=\s*True|AddIndexConcurrently'`. Reversibility: `rg -c -i 'def downgrade|def down\b|exports\.down|async down\(|reverse_code|irreversible|<rollback|^-- *undo' -- "${MIGRATION_DIRS[@]}"`, plus Flyway's
undo scripts (`U<version>__*.sql` beside the `V<version>__` they undo). For Prisma — and any tool with no down-migration concept — reversibility is not expressible in the artefact: every migration in the window counts toward `IRR` by
construction, and the report says so in *Границы достоверности* instead of reporting `IRR = 0`. The window: `git log --diff-filter=A --since='12 months ago' --name-only -- "${MIGRATION_DIRS[@]}"`. Backup evidence: `rg -n -i
'backup|snapshot|pg_dump|restore' .github/workflows .gitlab-ci.yml docs/`. Read every flagged file in full. A downgrade whose body is `pass`, empty, or `raise` counts as irreversible, and so does a valid one that cannot restore what
the upgrade destroyed. Check whether CI ever applies the migrations — and a rollback — against a fixture database; status comes from the project's own tool in a read-only mode. This step reads files only, so it is identical in all
three lanes. *Produces:* the risky-migration register and the **irreversible-operation count** of §9.

**6. Lifecycle.** Case- and separator-insensitive, because `deletedAt` is the same marker as `deleted_at`: `rg -n -i 'deleted_?at|is_?deleted|archived_?at|soft.?delete|acts_as_paranoid|SoftDeletes|paranoid'`, then `rg -n -i
'created_?at|updated_?at|created_?by|row_?version|@CreationTimestamp|@UpdateTimestamp|\btimestamps\b'`, then `rg -n -i 'retention|purge|archive|\bttl\b|expire_?after|expires_?at'`. For each soft-deleted table check that uniqueness
accounts for the flag: a plain `UNIQUE(email)` blocks re-registration, a `UNIQUE` that ignores the flag admits duplicate live rows; record which. *Produces:* per table, the delete semantics, audit columns, archival path and retention
rule, or the recorded absence of each.

**7. Naming, dead tables and dead columns.** List every table and column from `information_schema.columns`, count code references per table name with `rg -c -w --no-filename -i "$t" .`, and read `SELECT relname, seq_scan, idx_scan,
n_live_tup, last_analyze FROM pg_stat_user_tables ORDER BY seq_scan + idx_scan;`. A table is a **dead candidate** only when both hold: zero scans over a statistics window of known age, and zero code references outside migrations.
**Dead columns need their own pass**, because scan counters are table-granular: for each table in the top `N`, cross its column list against code references in both spellings (`rg -c -w -i -e 'full_name' -e 'fullName'`) and against the
ORM model's field list; a column with zero references outside migrations, no constraint and no index is a dead-column candidate. No engine keeps per-column read statistics, so that claim is structural: it files at `confidence:
probable` at best, and the recommendation names the check that settles it — a logged statement sample, or a `pg_stat_statements` text search for the name. Mixed `snake_case`/`camelCase`, mixed plural/singular table names and
inconsistent `*_id`/`*Id` suffixes are the naming defects. *Produces:* the naming-inconsistency, dead-table and dead-column lists.

**8. Score and assembly.** Compute the two numbers of §9, rank the findings, draw the ER diagram, fill the appendix tables of §8.

**Code-only lane.** With neither a live schema nor a dump: step 1 loses its live side, files no drift finding and degrades to checking models against migration bodies; step 2 counts declarations rather than enforced rows, so `II` is
not computed (§9); step 3's index and relation inventory comes from ORM and DDL declarations with the `PROD_STATS_ACCESS` proxy for ranking, every usage claim is a hypothesis and **no** unused-index finding is filed; step 4 reads
declared types with no evidence of what is stored; step 7 rests on code references and `git log` recency and files no dead candidate without scan statistics. Steps 5 and 6 are unaffected. An empty result in this lane is a limit for
*Границы достоверности*, never a clean bill.

**Other engines.** **MySQL:** steps 1–2 read the same `information_schema` views (`CHECK` needs 8.0.16+; below it every check is code-only by construction); step 3 uses `information_schema.statistics` for definitions, `key_column_usage
WHERE referenced_table_name IS NOT NULL` for foreign keys, `sys.schema_unused_indexes` for usage and `EXPLAIN FORMAT=JSON` for plans; step 4 reads native enums from `columns.column_type`; step 7 uses `sys.schema_table_statistics`.
**SQLite:** no `information_schema` and no usage statistics — `PRAGMA table_info` (nullability, defaults, declared types), `PRAGMA index_list`/`index_info`, `PRAGMA foreign_key_list`, `sqlite_master.sql` for `CHECK`, triggers and
`CHECK … IN (…)` enumerations, and `EXPLAIN QUERY PLAN` for step 3; file no unused-index finding and no scan-based dead candidate, and note that dynamic typing makes step 4's declared type advisory. **Document and key-value stores:**
steps 2–4 and 7 read `db.getCollectionInfos()` for validators, `db.<coll>.getIndexes()`, `$indexStats` for index usage and `db.runCommand({collStats: "<coll>"})` for volume; the primary-key, foreign-key and dead-column thresholds do
not apply, and *Границы достоверности* says so rather than scoring the store against rows it cannot satisfy.

## 5. Tools

| Tool | What it measures | Invocation | Fallback when absent |
|---|---|---|---|
| `pg_dump` | the actual PostgreSQL schema | `pg_dump --schema-only --no-owner --no-privileges "$DSN"` | `psql -X -Atc` over `information_schema.columns`; failing that, the committed `structure.sql` / `schema.rb` |
| `psql` + `information_schema` | constraints, types, nullability, defaults, index definitions | `psql -X -At "$DSN" <<'SQL' … SQL` | `grep`/`awk` over the dump file; the same views exist in MySQL; SQLite via `PRAGMA` (§4 *Other engines*) |
| `pg_stat_statements` | real query frequency and total time | `SELECT query, calls, total_exec_time FROM pg_stat_statements ORDER BY 3 DESC LIMIT 20;` | MySQL `performance_schema.events_statements_summary_by_digest`; else the code proxy of `PROD_STATS_ACCESS` |
| `pg_stat_user_indexes` | index usage; size through `pg_relation_size` | `SELECT indexrelname, idx_scan, pg_relation_size(indexrelid) AS bytes FROM pg_stat_user_indexes ORDER BY idx_scan;` | MySQL `sys.schema_unused_indexes` joined to `information_schema.tables.index_length` — table-level only, so drop §6's size gate and say so; else report usage unknown and file no unused-index finding |
| `EXPLAIN` | the plan chosen for a hot query | `PREPARE p AS <normalised query>; SET plan_cache_mode = force_generic_plan; EXPLAIN EXECUTE p(…);` in a read-only transaction; `EXPLAIN ANALYZE` only on a pure `SELECT` against a copy | infer from the index list and the query's `WHERE`/`ORDER BY` columns, filed as a hypothesis |
| `schemaspy` | schema visualisation, relationship inventory | `java -jar schemaspy.jar -t pgsql -host H -db D -u U -o out -dp <jdbc.jar>` | hand-draw the ER diagram as Mermaid `erDiagram` from the `pg_constraint` foreign-key list |
| project migration tool | inventory, status, reversibility | `alembic history` / `manage.py showmigrations` / `rails db:migrate:status` / `flyway info` / `liquibase status` / `prisma migrate status` / `atlas schema inspect -u "$DSN"` | `git ls-files -- "${MIGRATION_DIRS[@]}"` plus `rg` over the bodies — the files alone answer reversibility |
| `mysqldump` | the actual MySQL schema | `mysqldump --no-data --skip-comments "$DB"` | `mysql -e 'SHOW CREATE TABLE t'` per table |
| `sqlite3` | the actual SQLite schema | `sqlite3 app.db '.schema'`; `PRAGMA foreign_key_list(t);`; `PRAGMA foreign_keys;` | read the migration bodies |
| `mongosh` | collections, validators, indexes | `mongosh --quiet --eval 'db.getCollectionInfos()'` | the ODM schema files (`mongoose.Schema`) |
| `git` | migration history, churn, backup evidence | `git log --diff-filter=A --since='12 months ago' --name-only -- "${MIGRATION_DIRS[@]}"` | none needed; git is the floor |
| `rg` / `grep` | code-enforced invariants, lifecycle markers, naming | `rg -n -i "${RG_EXCLUDE[@]}" --hidden --no-ignore 'deleted_?at\|soft.?delete' .` — the contract's set (`report-contract.md` §2), unmodified outside step 5 | `grep -rEin` with the same pattern, its output filtered through the contract's `EXCLUDE_RE` |

## 6. Analysis rules and thresholds

| Condition | Threshold | Severity | Origin |
|---|---|---|---|
| Base table with no primary key or unique non-null equivalent | ≥ 1 table | **S1** | requirements |
| Monetary column typed `float` / `real` / `double` / `double precision` / `money` | ≥ 1 column | **S1** | requirements |
| Destructive migration step (`DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/lossy `ALTER … TYPE`, or data-destroying `DELETE`/`UPDATE`) with no backup or snapshot evidenced in CI, deploy config or runbook | ≥ 1 step | **S1** | requirements |
| Migration the project's own tooling cannot undo — downgrade absent, empty, `pass`, or unable to restore what the upgrade removed — with no backup or snapshot evidenced | ≥ 1 migration | **S1** | requirements |
| A `*_id` column matching an existing table's key, carrying a logically mandatory relation, with no `FOREIGN KEY` | ≥ 1 column | **S2** | requirements |
| Live schema differs from the code's description in existence, type, nullability or a constraint | ≥ 1 object | **S2** | requirements |
| No CI job applies the migrations against a fixture database | 0 jobs | **S2** | requirements |
| Business invariant enforced only in application code, on a `CRITICAL_ENTITIES` table | ≥ 1 invariant | **S2** | requirements |
| Statement in the top 20 by total time (or by proxy rank) whose plan scans a table of ≥ 10 000 rows sequentially with no index covering its filter | ≥ 1 statement | **S2** | derived |
| The same irreversible migration, **with** backup or snapshot evidence | ≥ 1 migration | **S2** | derived |
| Migration taking an exclusive lock (non-`CONCURRENTLY` index, table rewrite, volatile-default column add on PostgreSQL < 11) on a table of ≥ 1 000 000 rows | ≥ 1 migration | **S2** | derived |
| Soft delete whose uniqueness is wrong in either direction — duplicate live rows admitted, or re-creation blocked | ≥ 1 table | **S2** | derived |
| Instant-valued column typed `timestamp without time zone` while the product serves more than one timezone — from `BUSINESS_CONTEXT`; unset, derive it from `rg -n -i 'pytz\|zoneinfo\|ZoneId\|moment-timezone\|Intl\.DateTimeFormat\|tzinfo'` plus country and locale columns, and file at `hypothesis` when undecidable | ≥ 1 column | **S2** | derived |
| Integrity index below the floor, measured on a live or dumped schema | `II < 60 %` | **S2** | derived |
| Unused index (`idx_scan = 0` over a window of ≥ 30 days, `pg_relation_size` ≥ 10 MB), or a duplicate / prefix-redundant index pair | ≥ 1 index or pair | **S3** | derived |
| Foreign-key column with no index whose leading column is that column, on a `CRITICAL_ENTITIES` table or one of ≥ 100 000 rows per `DATA_VOLUMES` | ≥ 1 column | **S3** | derived |
| Column on a `CRITICAL_ENTITIES` table whose value every application writer supplies but which carries no schema `DEFAULT` and no `NOT NULL`, so a direct insert or a new writer leaves it null | ≥ 1 column | **S3** | derived |
| Status column stored as free text with no enum type and no `CHECK`; or unbounded `text`/`varchar` on a user-supplied indexed column | ≥ 1 column | **S3** | derived |
| Event table with no `created_at`, or mutable rows with no `updated_at`; or a table growing ≥ 1 000 000 rows/year per `DATA_VOLUMES` with no archival or retention rule | ≥ 1 table | **S3** | derived |
| Dead table: zero scans over a known window **and** zero code references outside migrations. Dead column: zero code references outside migrations, no constraint, no index | ≥ 1 object | **S3** | derived |
| Naming conventions in simultaneous use across the schema (case style, pluralisation, key suffix) | ≥ 2 conventions | **S4** | requirements |

Overrides, applied after the row is chosen and named in the evidence: a defect on a `CRITICAL_ENTITIES` table takes the contract's position promotion; one confined to a table with no writes in the window and no code references takes
the reachability discount; a volume-conditional row whose volume is unknown keeps its severity but files at `confidence: hypothesis`, naming in the recommendation the count that would confirm it; a relational row is not applied at all
to a document or key-value store. Two rows are exempted rather than demoted: `II < 60 %` does not apply on a code-only run, which has no measured `D` (§9), and nothing at all is filed on the strength of an empty grep on a stack §4's
patterns do not name — that goes to *Границы достоверности* (§10 mode 8).

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

The sampling unit is the **table** (or collection). Top-`N` ranking, in this order: membership in `CRITICAL_ENTITIES`; total relation size or row count from `DATA_VOLUMES`; migrations touching the table within `MIGRATION_WINDOW`; code
references from step 7. Ties break toward the larger table. Migrations are budgeted separately and never sampled at the grep stage: step 5's patterns run over **every** file in every root of `MIGRATION_DIRS`, and only flagged files are
read in full, capped at `N` and ranked by destructiveness then recency. Steps 1–4 are aggregate queries over the whole schema and are not sampled; step 6's per-table reading, step 2's code cross-reference and step 7's per-column pass
are, all three bounded by the same top `N`. **Early stop:** the contract's control-sample stop, additionally requiring that the integrity index has moved under one percentage point across the last five tables read.

## 8. Report additions

| Addition | Where it goes | Shape |
|---|---|---|
| ER diagram of the actual schema | §7 *Приложения* | Mermaid `erDiagram` from step 3's foreign-key list; tables outside the top `N` collapsed into a named group; relations that exist only in code — step 3's missing-FK residue — drawn dashed and labelled `код` |
| `запрос — план — индекс` table | §7 *Приложения*, cited by id from each index finding in §5 | statement (normalised, truncated, never with literal values), calls, total time, chosen plan node, index used or `—`, verdict `ok` / `отсутствует` / `не используется` |
| Risky-migration list | §5 *Детальные находки*, a lead-in table before the migration findings | file, date added, operation, destructive (да/нет), reversible (да/нет), backup evidence, lock risk at that table's volume, severity. Every row at S2 or worse is **also** a full finding; the table never replaces findings |
| Constraint census | §7 *Приложения* | the raw counts behind `D` and `A`, one row per constraint kind, each with the query that produced it; defaults listed separately, since they count toward neither |

## 9. Score

Two numbers, reported on one line of §2 *Итоговая оценка*.

**Integrity index.** `II = D / (D + A) × 100 %`. `D` is the count of database-enforced constraints from step 2 — primary keys + foreign keys + unique constraints + `CHECK` constraints excluding the implicit not-null rows + `NOT NULL`
columns + enforcing triggers; column defaults are excluded. `A` is the count of distinct business invariants found in application code with no database counterpart. Unit: percent, one decimal. **A code-only run has no `D`**: nothing
was read from a live or dumped schema, so `II` is reported as `n/a — объявлено, не проверено`, §6's `II < 60 %` row does not apply, and the recommendation names the access that would settle it. Where the declarations are worth
counting, report them separately as `II_декл` over ORM and DDL declarations, labelled as such and never compared with a measured `II`.

**Irreversible operations.** `IRR` = the number of migration operations inside `MIGRATION_WINDOW` that the project's own tooling cannot undo — absent, empty or non-restoring downgrades, plus destructive steps of any kind, DDL and DML
alike. Unit: a count of operations, with the window stated beside it.

Written as `II = 72.4 % (D = 118, A = 45); IRR = 6 за 12 месяцев`. The justification names the largest contributor to `A`, the single most damaging entry in `IRR`, and whether the numbers rest on a live schema or on the code's
description; a number without its window and access mode is not an assessment.

## 10. Failure modes of this audit

1. **Reading the ORM and calling it the schema** — declarations that never reached the database inflate `D` and hide the very drift step 1 exists to find. *Counter:* `D` counts only rows returned by the live catalogue; a code-only run
   reports `II` as `n/a` (§9).
2. **Auditing a development database as production** — empty tables trip no volume threshold and their indexes are never scanned, so every index reads as unused and every lock risk vanishes. *Counter:* record `n_live_tup` totals and
   the environment in *Методология*; below the smallest volume threshold, file no unused-index and no lock finding at all, and say why.
3. **Trusting a statistics window of unknown age** — these counters reset on restart, so an index used by a monthly job looks dead an hour after a deploy. *Counter:* read the window first, `SELECT stats_reset FROM pg_stat_database
   WHERE datname = current_database();`, and apply §6's 30-day rule; below it every usage claim is a hypothesis carrying the window in its evidence.
4. **Missing enforcement that is not a constraint** — a partial unique index, a trigger, a generated column or a check inside a stored procedure yields a false "code-only invariant" and a deflated `II`. *Counter:* step 2 enumerates
   triggers and all index kinds first, and counts a declaration-context match (`@Index`, `unique: true`) toward `D`, not `A`.
5. **Counting a downgrade that does not work** — a present `downgrade()` that drops the column it re-added, or re-creates a table without its data, is recorded as reversible and `IRR` under-reports. *Counter:* judge reversibility on
   the body, object by object against the upgrade; what cannot restore destroyed data is irreversible whatever its syntax.
6. **Auditing one schema out of many** — multi-tenant, sharded and multi-database deployments hide most tables behind a search path. *Counter:* step 0 enumerates schemas and databases, and `coverage` names how many of each were read.
7. **Ranking frequency by call sites** — one call site inside a loop outweighs twenty on cold paths, so the proxy ranking can push the real hot query out of the top 20 and yield a false "no missing indexes". *Counter:* without
   `PROD_STATS_ACCESS` the missing-index conclusion is a hypothesis, and the recommendation names enabling statement statistics as the check that settles it.
8. **Greps shaped like one stack** — a pattern written for snake_case SQL, Python and Ruby matches nothing on a JS/TS, Java or .NET project and exits clean, so "no destructive migrations, no soft delete, no code-only invariants" is
   indistinguishable from a genuine clean bill. *Counter:* steps 2, 5, 6 and 7 carry per-ecosystem alternatives and separator-insensitive forms; an empty result on a stack none of them names is `confidence: low` and a line in *Границы
   достоверности*, never a finding of absence.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **No DDL against the audited database in any form** — no "temporary" index built to measure a plan, no `CREATE EXTENSION pg_stat_statements`, no `ALTER SYSTEM`, no `SET GLOBAL`, no schema created to hold audit output. An uninstalled
  statistics extension goes into `tools_unavailable`; it is never installed. Restoring a **schema-only** dump into a scratch database the project does not use is the sanctioned alternative, named in *Методология*.
- **No statement that writes rows, and no `EXPLAIN ANALYZE` on anything but a pure `SELECT`** — it executes the statement, so on `INSERT`/`UPDATE`/`DELETE`/`MERGE` it mutates the audited data. Plain `EXPLAIN`, or `EXPLAIN EXECUTE` on a
  prepared statement, is the alternative, under `SET default_transaction_read_only = on` (MySQL: `SET SESSION TRANSACTION READ ONLY;`).
- **No maintenance commands** — `ANALYZE`, `VACUUM`, `REINDEX`, `OPTIMIZE TABLE`, `ANALYZE TABLE`. When planner statistics are stale, read `last_analyze` from `pg_stat_user_tables` and report it as a limit.
- **Never run the migration tool in a mode that applies or writes** — not `alembic upgrade`, `manage.py migrate`, `rails db:migrate`, `flyway migrate`, `liquibase update`, `prisma migrate dev|deploy`, `knex migrate:latest`, and not
  `atlas migrate diff`, which writes a new migration file into `MIGRATION_DIRS` and so mutates the working tree. The sanctioned modes are read-only or stdout-only: `status`/`info`/`history`/`showmigrations`, `alembic upgrade head
  --sql`, `liquibase updateSQL`, `sqlmigrate`, `prisma migrate diff --script`, `atlas schema diff`.
- **No load generation, and no full row counts on a large table over a production connection** — `SELECT count(*)` on a hundred-million-row table can saturate the instance; use `pg_stat_user_tables.n_live_tup` (MySQL:
  `information_schema.tables.table_rows`, a column PostgreSQL's copy of that view does not carry), labelled approximate.
- **Never export data** — `pg_dump` runs with `--schema-only`, `mysqldump` with `--no-data`. No sample rows, no `SELECT *` output and no query literals reach the report or the appendices — a normalised statement text only, including
  for the statements bound for planning in step 3. Volume is reported as counts, never content.
- **Do not connect to production when a copy exists**, and never write a DSN, host or credential into the report: it says "a read-only copy of the production schema, taken YYYY-MM-DD" and no more.

## 12. Dependencies

**Input.** A-01 — the component register and the store inventory, arriving as `DB_ENGINES` and `SCOPE_*` values or as a path to the A-01 report. Absent, derive `DB_ENGINES` per §2, record the absence in *Границы достоверности*, lower
`confidence`, and run anyway.

**Output.** The schema, the ER diagram, the `запрос — план — индекс` table and the finding register go to four audits: **A-14** (security: the schema inventory, for its role × resource matrix), **A-15** (bottlenecks: the missing-index
and volume rows, cross-referenced there rather than restated), **A-18** (reliability: `IRR`, destructive steps, backup evidence) and **A-22** (privacy: the retention and soft-delete inventory).

## 13. Nearest marvin command

`/marvin:migration-plan`. It is forward-looking — it plans a change not yet made, with steps, risks and a rollback strategy. A-10 is backward-looking: it measures the schema and the migration history that already exist, so the natural
order is A-10 first, then `migration-plan` for each S1 it produced. `/marvin:refactor-audit` sees code structure and has no schema awareness; `/marvin:sec-scan` covers the injection and permission questions routed to A-14. Either may
accelerate a step, and its output is evidence to verify against the commands above — never a section to paste.
