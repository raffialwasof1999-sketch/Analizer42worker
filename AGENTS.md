# Active Analyzer continuation rules

Read `CLAUDE.md` and `database/README.md` before continuing this project.

The database handoff is living project documentation. Every change to the
database structure, sources, import logic, metric definitions, integration,
deployment, or an owner decision must update `database/README.md` in the same
change. Record what is actually implemented, tested and deployed, what is
pending, and the precise next step. Never describe a draft as deployed.

Keep the database's `project_documentation` row with document_key `handoff`
in sync with that Markdown file. Increment its document version, update the
timestamp and SHA-256, and read the row back to verify it. If remote access
is unavailable, explicitly record that the database copy is pending sync.
Do not claim both copies are current until verified.

Preserve one unified D1 database with shared company/period tables and
separate bank/insurance extensions. Companies and tradable instruments are
different entities: multiple tickers/share classes may belong to one issuer.
Preserve SEC provenance, units, dates, share basis and missing-versus-zero
distinctions. Keep the existing dashboard, assumptions and results layout.

Start each continuation by verifying the current GitHub branch, D1 schema
and handoff version. End it by recording completed work, checks, outstanding
limitations and next steps. Do not store credentials in documentation.

Merge only when the owner explicitly requests it, after relevant checks pass.
