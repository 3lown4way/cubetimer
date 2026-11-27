import assert from "node:assert/strict";
import {solved,parseAlg,apply,buildTimeline,buildPoseTrack,poseAt,frameAt,planGrip} from "./motion-engine.js";
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
console.log("Motion engine checks passed.");
