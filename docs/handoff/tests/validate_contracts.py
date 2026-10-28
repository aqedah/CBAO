"""Validate delivered data files, schemas, references and intentional rejections.
Requires jsonschema; no AI or network calls. Run from any current directory.
"""
from pathlib import Path
from copy import deepcopy
import json
from importlib.metadata import version
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
checks = []
def load(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8'))
def check(name, fn):
    fn()
    checks.append({'name': name, 'passed': True})
def require(value, message='Assertion failed'):
    if not value:
        raise AssertionError(message)

def schema_valid(name, data):
    schema = load(name)
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(data)

def schema_rejects(name, data):
    errors = list(Draft202012Validator(load(name), format_checker=FormatChecker()).iter_errors(data))
    require(bool(errors), 'Invalid input was accepted')

scene = load('office.scene.json')
assets = load('office.assets.json')
fixture = load('examples/office.snapshot.demo.json')
check('Every JSON file is parseable', lambda: [json.loads(f.read_text(encoding='utf-8')) for f in ROOT.rglob('*.json')])
check('Scene schema and scene data', lambda: schema_valid('contracts/office-scene.schema.json', scene))
check('Snapshot schema and demo fixture', lambda: schema_valid('contracts/office-snapshot.schema.json', fixture))
check('Scene IDs are unique', lambda: require(len({x['id'] for x in scene['seats']+scene['objects']}) == len(scene['seats'])+len(scene['objects'])))
check('Asset IDs are unique', lambda: require(len({a['id'] for a in assets['assets']}) == len(assets['assets'])))
asset_ids = {a['id'] for a in assets['assets']}
check('All seat/object asset references resolve', lambda: require(all(x['asset_id'] in asset_ids for x in scene['seats']+scene['objects']) and all(s['avatar_asset_id'] in asset_ids for s in scene['seats'])))
zones = {z['id']:z for z in scene['zones']}
check('All zones resolve', lambda: require(all(x['zone_id'] in zones for x in scene['seats']+scene['objects'])))
check('All object layers resolve', lambda: require(all(x['layer'] in {l['id'] for l in scene['layers']} for x in scene['objects'])))
def validate_bounds():
    for o in scene['seats']+scene['objects']:
        x,y=o['position']['x'],o['position']['y'];w,h=o['footprint']
        require(w>0 and h>0 and 0<=x and x+w<=scene['world']['columns'] and 0<=y and y+h<=scene['world']['rows'],o['id'])
        zx,zy,zw,zh=zones[o['zone_id']]['bounds']
        require(zx<=x and x+w<=zx+zw and zy<=y and y+h<=zy+zh,'Outside zone: '+o['id'])
check('Every footprint is inside world and assigned zone',validate_bounds)
check('Production sprite assets are honestly marked absent', lambda: require(all(a['status']=='to_produce' and a['runtime_path'] is None for a in assets['assets'])))
check('Reference and baseline spec exist', lambda: require((ROOT/'reference/cozy-office-concept.png').is_file() and (ROOT/'reference/AI_OFFICE_V1_SPEC.original.md').is_file()))
check('Demo fixture cannot be mistaken for a live sample', lambda: require(fixture['is_demo'] is True and fixture['workspace_id'].startswith('demo-') and all(m['task']['task_id'].startswith('DEMO-') for m in fixture['members'])))
check('Default managed concurrency shown by fixture is one', lambda: require(sum(m['execution_mode']=='managed' and m['run'] is not None and m['run']['status']=='running' for m in fixture['members'])==1))
plan=load('implementation.plan.json')
check('Implementation tasks are not presented as done', lambda: require(all(t['status']=='planned' for t in plan['tasks'])))
check('Implementation dependency IDs resolve', lambda: require(all(dep in {t['id'] for t in plan['tasks']} for t in plan['tasks'] for dep in t['depends_on'])))
invalid=deepcopy(scene);invalid['objects'][0]['action']='execute_shell'
check('Scene schema rejects arbitrary commands',lambda:schema_rejects('contracts/office-scene.schema.json',invalid))
invalid2=deepcopy(fixture);invalid2['members'][0]['task']['status']='approved_by_avatar'
check('Snapshot schema rejects fake workflow state',lambda:schema_rejects('contracts/office-snapshot.schema.json',invalid2))
invalid3=deepcopy(fixture);invalid3['members'][0]['api_key']='should-never-be-here'
check('Snapshot schema rejects unexpected credential field',lambda:schema_rejects('contracts/office-snapshot.schema.json',invalid3))
invalid4=deepcopy(fixture);invalid4['captured_at']='not-a-date'
check('Snapshot schema rejects invalid timestamp',lambda:schema_rejects('contracts/office-snapshot.schema.json',invalid4))
report={'scope':'delivered files only; no renderer, browser or live connection test','validator':{'name':'jsonschema','version':version('jsonschema')},'passed':len(checks),'failed':0,'checks':checks}
(ROOT/'tests/contract-validation-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':len(checks),'failed':0},ensure_ascii=False))
