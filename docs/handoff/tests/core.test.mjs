import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deriveMemberView, connectionFreshness, acceptSnapshot, resolveSeatMember} from '../starter/office-view-model.mjs';
import {projectIso, unprojectIso, sceneToClient, clientToScene, compareWorldObjects} from '../starter/isometric.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('../examples/office.snapshot.demo.json', import.meta.url)));
const scene = JSON.parse(fs.readFileSync(new URL('../office.scene.json', import.meta.url)));
const visuals = JSON.parse(fs.readFileSync(new URL('../office.visual-states.json', import.meta.url)));
const NOW = Date.parse(fixture.captured_at);
const options = {nowMs: NOW, snapshotCapturedAt: fixture.captured_at};
const clone = (index = 1) => structuredClone(fixture.members[index]);
const view = (m, extra = {}) => deriveMemberView(m, {...options, ...extra});

test('fresh observed run animates, and input remains unchanged', () => {
 const m=clone(), before=JSON.stringify(m), v=view(m);
 assert.equal(v.state,'working'); assert.equal(v.clip,'typing'); assert.equal(v.verifiedWork,true);
 assert.equal(JSON.stringify(m),before);
});
test('external work report never generates live working animation', () => {
 const v=view(clone(2)); assert.equal(v.state,'external_work'); assert.equal(v.animate,false); assert.equal(v.connection,'not_applicable'); assert.equal(v.canRequestCancel,false);
});
test('45-second heartbeat boundary becomes delayed', () => {
 const m=clone();m.last_heartbeat_at=new Date(NOW-45000).toISOString();
 assert.equal(view(m).state,'connection_delayed');assert.equal(view(m).animate,false);
});
test('90-second heartbeat boundary becomes offline, not failure', () => {
 const m=clone();m.last_heartbeat_at=new Date(NOW-90000).toISOString();
 assert.equal(view(m).state,'connection_lost');assert.equal(m.run.status,'running');
});
test('missing heartbeat cannot be upgraded by a healthy flag', () => {
 const m=clone();m.last_heartbeat_at=null;assert.equal(view(m).connection,'unknown');assert.equal(view(m).animate,false);
});
test('old feed snapshot invalidates work motion even with a fresh heartbeat', () => {
 assert.equal(view(clone(),{snapshotCapturedAt:new Date(NOW-90000).toISOString()}).animate,false);
});
test('fresh PC heartbeat does not replace stale process confirmation', () => {
 const m=clone();m.run.last_confirmed_at=new Date(NOW-60000).toISOString();assert.equal(view(m).state,'unknown');assert.equal(view(m).animate,false);
});
test('model-reported progress is not runner-observed activity', () => {
 const m=clone();m.run.evidence_source='tool_reported';assert.equal(view(m).state,'ai_reported');assert.equal(view(m).animate,false);
});
test('successful run is finished, not proof of artifact submission or task done', () => {
 const m=clone();m.run.status='succeeded';assert.equal(view(m).state,'run_finished');assert.equal(m.task.status,'active');
});
test('owner approval state is distinct from successful execution', () => {
 const m=clone();m.run.status='succeeded';m.task.status='awaiting_owner';assert.equal(view(m).state,'awaiting_owner');
});
test('task done plus terminated run can show completed even with offline connection', () => {
 const m=clone();m.task.status='done';m.run.status='succeeded';m.connection_state='offline';
 assert.equal(view(m).state,'completed');assert.equal(view(m).connection,'offline');
});
test('closed task plus running run is flagged as inconsistent', () => {
 const m=clone();m.task.status='done';assert.equal(view(m).state,'inconsistent');assert.equal(view(m).animate,false);
});
test('offline stopping is pending, never confirmed cancelled', () => {
 const m=clone();m.run.status='stopping';m.connection_state='offline';assert.equal(view(m).state,'stopping');assert.equal(view(m).animate,false);
});
test('cancel capability may queue an explicit request offline; no automatic command', () => {
 const m=clone();m.connection_state='offline';assert.equal(view(m).canRequestCancel,true);
 m.capabilities.request_cancel=false;assert.equal(view(m).canRequestCancel,false);
});
test('reduced motion and hidden route both stop animation but preserve status', () => {
 for(const extra of [{reducedMotion:true},{hidden:true},{motionEnabled:false}]){
  const v=view(clone(),extra);assert.equal(v.state,'working');assert.equal(v.animate,false);
 }
});
test('testing and reviewing phases use explicit run data', () => {
 const m=clone();m.run.phase='testing';assert.equal(view(m).state,'testing');
 m.run.phase='reviewing';assert.equal(view(m).clip,'reading');
});
test('future timestamps outside tolerance are unknown', () => {
 const m=clone();m.last_heartbeat_at=new Date(NOW+60000).toISOString();assert.equal(connectionFreshness(m,NOW,fixture.captured_at),'unknown');
});
test('external run data is rejected as inconsistent', () => {
 const m=clone();m.execution_mode='external';assert.equal(view(m).state,'inconsistent');
});
test('demo input is rejected by live snapshot gate', () => {
 assert.throws(()=>acceptSnapshot(null,fixture,{workspaceId:fixture.workspace_id}),/Demo/);
});
test('snapshot gate rejects foreign workspace and duplicate member IDs', () => {
 assert.throws(()=>acceptSnapshot(null,fixture,{workspaceId:'different',allowDemo:true}),/Workspace/);
 const dup=structuredClone(fixture);dup.members.push(dup.members[0]);
 assert.throws(()=>acceptSnapshot(null,dup,{workspaceId:fixture.workspace_id,allowDemo:true}),/Duplicate/);
});
test('equal and older snapshots cannot roll state back', () => {
 const current={...fixture,snapshot_sequence:5};
 assert.equal(acceptSnapshot(current,fixture,{workspaceId:fixture.workspace_id,allowDemo:true}),current);
 assert.equal(acceptSnapshot(current,{...fixture,snapshot_sequence:5},{workspaceId:fixture.workspace_id,allowDemo:true}),current);
});
test('newer snapshot is accepted without synthesizing events', () => {
 const newer={...fixture,snapshot_sequence:2};assert.equal(acceptSnapshot(fixture,newer,{workspaceId:fixture.workspace_id,allowDemo:true}),newer);
});
test('seat labels never auto-bind to real member IDs', () => {
 assert.equal(resolveSeatMember(scene.seats[0],{},fixture),null);
 assert.equal(resolveSeatMember(scene.seats[0],{gpt:'gpt'},fixture).member_id,'gpt');
});
test('isometric transform round-trips positive fractional and elevated coordinates', () => {
 for(const p of [{x:0,y:0,z:0},{x:3.5,y:7.25,z:2},{x:23,y:17,z:0}]){
  const back=unprojectIso(projectIso(p,scene.world),scene.world,p.z);
  assert.ok(Math.abs(back.x-p.x)<1e-10);assert.ok(Math.abs(back.y-p.y)<1e-10);assert.equal(back.z,p.z);
 }
});
test('DOM and canvas coordinates match pan/zoom and element offset', () => {
 const p={x:222,y:140},c={scale:1.5,panX:12,panY:-45},r={left:240,top:100};
 assert.deepEqual(clientToScene(sceneToClient(p,c,r),c,r),p);
});
test('depth uses ground contact, not sprite head height', () => {
 const a={id:'a',position:{x:3,y:3,z:7}},b={id:'b',position:{x:5,y:5,z:0}};
 assert.ok(compareWorldObjects(a,b,scene.world)<0);
});
test('depth ties are deterministic', () => {
 const a={id:'a',position:{x:3,y:4,z:0}},b={id:'b',position:{x:4,y:3,z:0}};
 assert.ok(compareWorldObjects(a,b,scene.world)<0);
});
test('invalid camera and grid dimensions fail explicitly', () => {
 assert.throws(()=>clientToScene({x:0,y:0},{scale:0,panX:0,panY:0},{left:0,top:0}),RangeError);
 assert.throws(()=>projectIso({x:0,y:0,z:0},{...scene.world,tile_width:0}),RangeError);
});
test('every fixture visual state exists in the JSON style contract', () => {
 for(const m of fixture.members) assert.ok(visuals.states[view(m).state]);
});

test('server-derived run record is not mislabeled as AI self-report', () => {
 const m=clone();m.run.evidence_source='server_derived';const v=view(m);
 assert.equal(v.state,'server_reported');assert.equal(v.animate,false);
});
test('manual submitted report remains manual, not verified artifact delivery', () => {
 const v=view(clone(3));assert.equal(v.state,'submitted');assert.equal(v.evidence,'user_reported');assert.equal(v.animate,false);
});
