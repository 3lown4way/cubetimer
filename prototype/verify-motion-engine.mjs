import assert from "node:assert/strict";
import {solved,parseAlg,apply,buildTimeline,buildPoseTrack,poseAt,poseAnglesAt,frameAt,planGrip} from "./motion-engine.js";
const sig=c=>JSON.stringify(c.map(x=>[x.p,x.b,x.colors]));
for(const n of [2,3,4,5,6,7]){
  const tokens=["R","L","U","D","F","B","x","y","z",...(n>=3?["Rw","2R","Uw"]:[]),...(n>=4?["3Rw"]:[]),...(n%2?["M","E","S"]:[])];
  for(const a of tokens){
    const initial=solved(n);
    const run=alg=>parseAlg(alg,n).reduce(apply,initial);
    assert.equal(sig(run([a,a,a,a].join(" "))),sig(initial),n+" "+a+" order four");
    assert.equal(sig(run(a+" "+a+"'")),sig(initial),n+" "+a+" inverse");
  }
}
const tl=buildTimeline(4,"Rw U2 Fw","R U R' U' F F' Rw x y' 2R");
const track=buildPoseTrack(tl);
for(let i=0;i<=100;i++)assert.ok(Math.abs(Math.hypot(...poseAt(track,tl.total*i/100))-1)<1e-9);
assert.equal(frameAt(tl,tl.total).i,tl.moves.length);
assert.ok(planGrip(parseAlg("R U R' U' R U R' U'",3)).every(x=>x===0));
assert.equal(sig(buildTimeline(3,"","").frames[0]),sig(solved(3)));
assert.throws(()=>parseAlg("M",4));
// A stable R/U grip must not wobble at every finger flick.
const stable = buildTimeline(3,"","R U R' U' R U R' U'");
const stableTrack = buildPoseTrack(stable);
for(let i=0;i<=100;i++)assert.ok(poseAnglesAt(stableTrack,stable.total*i/100).every(v=>Math.abs(v)<1e-12));
const mixed=buildTimeline(3,"","R U y R U F F D D B B x' U");
const mixedTrack=buildPoseTrack(mixed);
assert.equal(mixedTrack.accents.length,2);
const eps=1e-5;
for(const k of mixedTrack.keys.slice(1,-1)){
  const left=poseAnglesAt(mixedTrack,k.t-eps),mid=poseAnglesAt(mixedTrack,k.t),right=poseAnglesAt(mixedTrack,k.t+eps);
  for(let i=0;i<3;i++)assert.ok(Math.abs((right[i]-mid[i])/eps-(mid[i]-left[i])/eps)<0.02);
}
for(const accent of mixedTrack.accents){
  assert.ok(accent.end>accent.start);
  assert.ok(poseAnglesAt(mixedTrack,(accent.start+accent.end)/2).some(v=>Math.abs(v)>1));
}
const empty=buildPoseTrack(buildTimeline(3,"",""));
assert.ok(poseAnglesAt(empty,0).every(v=>v===0));
console.log("Motion engine and pose continuity checks passed.");
