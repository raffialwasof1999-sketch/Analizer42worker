# Active Analyzer Apps Script synchronization

Goal: keep the spreadsheet's existing Refresh flow and dashboard untouched, while managing its bound Apps Script source alongside the SEC Worker in GitHub.

## Status
This is preparation only. No Apps Script source has been imported and **nothing is deployed** to the Google Apps Script project yet. Do not run an upload against an empty source folder.

## First-time connection
1. In the Active Analyzer Sheet, choose **Extensions > Apps Script**.
2. In Apps Script, choose **Project Settings > IDs > Script ID**. Record the ID (not a password).
3. Enable **Google Apps Script API** in the signed-in account's Apps Script settings if it is off.
4. Back up the existing live Apps Script project before modifying it. The Google `clasp` CLI supports `clasp login` and `clasp clone <SCRIPT_ID>` / `clasp pull`; use this to put all live project files, including `appsscript.json`, in an `apps-script/` directory in the repository.
5. Review the imported source for tokens, credentials, personal information, and other secrets before committing. Use Script Properties or GitHub Secrets as appropriate; don't commit OAuth tokens.
6. Configure GitHub Actions authorization to the Apps Script API using a narrowly scoped authorized Google identity, with credentials stored in repository Secrets. Never paste OAuth credential JSON in a chat or source file.
7. Only after comparing the imported project with the live Apps Script project and confirming the correct Script ID, enable a guarded, manually triggered deployment. Test on a nonproduction copy first.

## Important guardrails
- Google Sheets does not execute source directly from GitHub; changes must be uploaded to the bound Apps Script project through an authorized API or `clasp`.
- `clasp push` replaces the remote Apps Script project content. Do not execute it before the full source backup and verification.
- Existing Sheet dashboard and Refresh behavior must remain unchanged.
- Maintain the refresh-only SEC importer; do not add long-term storage.
- Keep the GitHub repository as source of truth after sync is validated, to prevent editor/GitHub divergence.
- Script ID is configuration; OAuth refresh tokens and other credentials are secrets.

Reference: https://developers.google.com/apps-script/guides/clasp
