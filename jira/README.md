# Jira triage loop

1. `pip install -r requirements.txt`
2. Copy `.env.example` to `.env` and fill in email and token.
3. `python inspect_jira.py` checks the token, work types, field options and resolutions.
4. `python upload.py challenge.json --dry-run`, then `--limit 2`, then without flags.
5. `python loop.py --once --dry-run`, then `python loop.py --once`, then `python loop.py` for the live demo.

Plug the model into `triage()` in `triage.py`. Site-specific ids are in `config.py`.
6. `python export.py challenge.json` writes submission.json in the challenge format, read back from Jira.
