import assert from "node:assert/strict";
import {solved,parseAlg,apply,buildTimeline,buildPoseTrack,poseAt,poseAnglesAt,frameAt,planGrip,planVisualSearch,inspectionTimeline,inspectionFrameAt} from "./motion-engine.js";
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

const sameAlg="R U R' U' F R U R' U' F' R U2 R'";
const aligned=buildTimeline(3,"",sameAlg);
const scrambled=buildTimeline(3,"R U F2 L D B R2",sameAlg);
const pa=planVisualSearch(aligned),pb=planVisualSearch(scrambled);
assert.equal(pa.events.length,0);
assert.equal(pb.events.length,1);
assert.equal(pb.events[0].i,4);
assert.equal(pb.events[0].angle,65);
assert.equal(planVisualSearch(scrambled,{checkpoints:[]}).events.length,0);
const timing=inspectionTimeline(scrambled,pb);
for(const seg of timing.segments.filter(x=>x.event)){
  const a=inspectionFrameAt(scrambled,timing,seg.start);
  const b=inspectionFrameAt(scrambled,timing,(seg.start+seg.end)/2);
  assert.equal(a.frame.cubies,scrambled.frames[seg.i]);
  assert.equal(b.frame.cubies,scrambled.frames[seg.i]);
  assert.equal(b.frame.move,null);
  assert.ok(Math.abs(Math.hypot(...b.pose)-1)<1e-9);
  assert.ok(Math.abs(b.pose[0])<0.999);
}
assert.equal(inspectionFrameAt(scrambled,timing,timing.total).frame.cubies,scrambled.frames.at(-1));
assert.ok(timing.total>scrambled.total);
assert.equal(inspectionTimeline(aligned,pa).total,aligned.total);
assert.throws(()=>planVisualSearch(scrambled,{target:["white","white"]}));
const wing=buildTimeline(4,"Rw U2 Fw D Lw B","Rw U Rw' U' Fw D Rw2 x U2 y' 2R 2R'");
for(const opts of [{target:["white","green"]},{target:["white"],kind:"center"}]){
 const p=planVisualSearch(wing,opts),s=inspectionTimeline(wing,p);
 assert.equal(inspectionFrameAt(wing,s,s.total).frame.cubies,wing.frames.at(-1));
}
console.log("Visual search state, schedule and NxN checks passed.");
