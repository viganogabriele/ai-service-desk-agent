"""Expose measured, checked-in development results; never manufacture benchmark scores."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
fixtures = root / 'dashboard/fixtures'
predictions = json.loads((fixtures / 'dev_predictions.json').read_text())['records']
labels = json.loads((fixtures / 'dev_reference.json').read_text())['records']
inputs = json.loads((fixtures / 'dev_input.json').read_text())['records']
assert len(predictions) == len(labels) == len(inputs)
assert all(p['Summary'] == ticket['Summary'] for p, ticket in zip(predictions, inputs))
assert len({p['_triage']['model'] for p in predictions}) == 1
fields = {'service': 'Affected Business or IT Services', 'work_type': 'Work type'}

def value(record, key):
    found = record[key]
    return found[0] if isinstance(found, list) else found

per_field = {}
for field, key in fields.items():
    correct = sum(value(p, key) == value(label, key) for p, label in zip(predictions, labels))
    per_field[field] = {'n': len(labels), 'n_labelled': len(labels), 'agree_label': correct,
                        'agreement_label': correct / len(labels), 'agreement_live': None}

cases = [{'ticket_id': f'dev-{i + 1}', 'title': ticket['Summary'],
          'seconds': p['_triage']['classification_seconds'] + p['_triage']['comment_seconds'],
          'status': 'completed',
          'checks': [{'field': field, 'prediction': value(p, key), 'label': value(label, key)}
                     for field, key in fields.items()]}
         for i, (ticket, p, label) in enumerate(zip(inputs, predictions, labels))]
bundle = {'evaluation_id': 'saved-dev-baseline', 'status': 'completed',
          'request': {'ticket_set': 'development fixtures'}, 'ticket_ids': [c['ticket_id'] for c in cases],
          'created_at': None, 'completed_at': None,
          'results': {'versions': {'model': predictions[0]['_triage']['model']},
                      'summary': {'tickets': len(cases), 'failed': 0, 'changed_decisions': None},
                      'per_field': per_field, 'disagreements': [], 'shadow_run_ids': []},
          'cases': cases}
output = root / 'dashboard/public/playground-baseline.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(bundle, indent=2) + '\n')
print(f'Prepared saved playground baseline: {len(cases)} cases, {len(fields)} labelled fields')
