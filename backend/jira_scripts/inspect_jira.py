"""Run this first: checks the token works and prints what Jira allows.

    python inspect_jira.py            # site setup
    python inspect_jira.py SUP-12     # also show the transitions of one ticket
"""

import sys

import backend.jira_scripts.config as config
from backend.jira_scripts.jira_client import Jira, find_work_type, option_label, rank

WATCH = ["priority", *config.FIELDS.values()]
NAMES = {v: k for k, v in config.FIELDS.items()} | {"priority": "priority"}


def main():
    j = Jira()
    me = j.call("GET", "/rest/api/3/myself")
    print(f"Logged in as {me['displayName']} ({me.get('emailAddress', '?')})\n")

    types = j.work_types()
    print("Work types in", config.PROJECT_KEY, "->", [t["name"] for t in types])
    for name in config.WORK_TYPES:
        t = find_work_type(types, name)
        if not t:
            print(f"\n!! No work type found for '{name}'")
            continue
        print(f"\n== {name} -> '{t['name']}' (id {t['id']})")
        fields = j.create_fields(t["id"])
        for fid in WATCH:
            f = fields.get(fid)
            if not f:
                print(f"  !! {NAMES[fid]:<18} {fid}: NOT on the create screen")
                continue
            allowed = f.get("allowedValues")
            if allowed:
                shown = ", ".join(f"{option_label(o)} [rank {rank(option_label(o))}]"
                                  if fid in (config.FIELDS['urgency'], config.FIELDS['impact'], 'priority')
                                  else option_label(o) for o in allowed)
                print(f"  ok {NAMES[fid]:<18} {fid}: {shown}")
            else:
                print(f"  ok {NAMES[fid]:<18} {fid}: (free text)")

    print("\nResolutions:", [r["name"] for r in j.resolutions()])
    missing = [v for v in config.RESOLUTIONS.values()
               if v.lower() not in {r["name"].lower() for r in j.resolutions()}]
    if missing:
        print("!! Missing resolutions:", missing)

    if len(sys.argv) > 1:
        key = sys.argv[1]
        print(f"\nTransitions available on {key}:")
        for t in j.transitions(key):
            print(f"  id {t['id']}: '{t['name']}' -> status '{t['to']['name']}'")


if __name__ == "__main__":
    main()
