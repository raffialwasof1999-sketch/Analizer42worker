# Active Analyzer Apps Script synchronization

Goal: keep the spreadsheet's existing Refresh flow and dashboard untouched, while managing its bound Apps Script source alongside the SEC Worker in GitHub.

## Status
The live source is now copied into `apps-script/` (2026-10-22): `Code.gs` (AA_SEC_V3), `TickerSearch.gs` and `TickerSearch2.html`, each checked against the live project editor by SHA-256 (line endings normalized to LF). It was reviewed before committing: no keys, tokens or personal data; the only hosts are this repository's public Worker and Nasdaq's public symbol directory.

**Deployment is automatic** (`.github/workflows/apps-script-deploy.yml`): GitHub is the source of truth.

- **Pull request** touching `apps-script/`: every `.gs` file is syntax-checked, and a read-only preview names the files merging will change (or warns that the live script was edited outside GitHub).
- **Merge to main**: the workflow checks the live script still matches the previously deployed GitHub version, saves a numbered backup in Google (Project history), uploads `apps-script/`, and reads it back to confirm an exact match. The live `appsscript.json` manifest is kept as is.
- **Edited in Google's editor instead?** The deploy refuses to overwrite and names the differing files. Copy the live file into `apps-script/` first, or run the workflow manually with "overwrite live".

It uses the `CLASPRC_JSON` repository secret already authorized on 2026-10-21. `appsscript.json` itself is not in GitHub.

## Target supplied by the owner
- Script ID: `1OjO2rJxCB6jXC5BMeb-JxyvUx4pcdzwcJh16eHFzJIfGQvo3GJW8doab`
- Intended parent: the existing Active Analyzer spreadsheet, `1ryLKPxrVoxSVhac7HpVR_l8ARSjn0E65DhTz082PlXY`.
- This is an identifier, not an authorization credential. Confirm that an authenticated project metadata read returns this Script ID and the intended parent before importing or uploading code.
- This document does not configure or activate a deployment workflow.

## First-time connection
1. Script ID collection is complete. Do not create a replacement Apps Script project or spreadsheet.
2. In the Google account that owns or can edit the existing Apps Script project, open **https://script.google.com/home/usersettings** and enable **Google Apps Script API** if it is off. This is an account-level Apps Script setting, not the project's gear-icon settings.
3. Enabling that setting does not itself authorize GitHub or this assistant. Separately authorize Google's `clasp` tool on a trusted computer with `clasp login`. Only approve the intended Google application and permissions. API enablement alone must not be reported as a completed connection.
4. Verify the target, then back up the complete live Apps Script project before modifying it. Use the Google `clasp` CLI's clone/pull operation in a new empty local directory, preserving every source file and `appsscript.json`. Keep the first unmodified backup outside the public repository.
5. Review the imported source for tokens, credentials, personal information, and other secrets before committing it under `apps-script/`. This repository is public. Use Script Properties or GitHub Secrets as appropriate; never commit OAuth tokens. Ignore credential files before importing or committing source.
6. Configure GitHub Actions authorization only after the source review. Google's documented clasp CI setup uses `CLASPRC_JSON` for the locally generated authorization and `CLASP_JSON` for the project mapping, stored in GitHub Actions Secrets. The owner must place credentials into the secure Secrets interface, not a chat, issue, source file, or workflow log. The Script ID supplied above does not replace this step.
7. Before enabling any upload, compare the imported project with the live Apps Script project and verify the Script ID, full source, manifest, and intended parent. Start with a guarded, manually triggered deployment and test on a nonproduction copy first. Automatic updates are a later step after successful verification.

## Important guardrails
- Google Sheets does not execute source directly from GitHub; changes must be uploaded to the bound Apps Script project through an authorized API or `clasp`.
- `clasp push` replaces the remote Apps Script project content. Do not execute it before the full source backup and verification.
- Existing Sheet dashboard and Refresh behavior must remain unchanged.
- Maintain the refresh-only SEC importer; do not add long-term financial-data storage.
- Keep the GitHub repository as source of truth after sync is validated, to prevent editor/GitHub divergence.
- Script ID is configuration; OAuth refresh tokens and other credentials are secrets.
- Neither API enablement nor recording an ID proves that a deployment is authorized or working.

References:
- https://developers.google.com/apps-script/guides/clasp
- https://developers.google.com/apps-script/api/how-tos/enable
