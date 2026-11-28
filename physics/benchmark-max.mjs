import fs from "node:fs";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
const html=fs.readFileSync(new URL("../mechanical-lab.html",import.meta.url),"utf8");
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const engine=script.split("const $=id")[0],geometry=script.slice(script.indexOf("const gpuViews"),script.indexOf("function drawGPU"));
const make=enabled=>new Function("WebAssembly","atob",engine+"\nconst axes=FACES.map(([a,s])=>[a,s]);\n"+geometry+"\nreturn {buildTimeline,simulateMechanical,flowFrameAt};")(enabled?WebAssembly:undefined,enabled?atob:undefined);
const settings={meshContact:true,liveContact:true,constrained:true,maxMode:true,magneticCapture:true,fastMax:false,seed:42};
const calc=(enabled,alg)=>{
 const m=make(enabled),t=m.buildTimeline(3,"",alg),start=performance.now(),p=m.simulateMechanical(t,settings),ms=performance.now()-start;
 assert.deepEqual(m.flowFrameAt(p.timeline,p.track,p.timeline.total).cubies,t.frames.at(-1));
 if(enabled){assert.ok(p.track.kernel.calls>0,"WASM did not execute");assert.ok(!p.track.kernel.fault,p.track.kernel.fault);assert.ok(p.track.kernel.verified>=4);}
 return {ms,track:p.track};
};
function compare(a,b){
 if(Array.isArray(a)){assert.equal(a.length,b.length);a.forEach((v,i)=>compare(v,b[i]));}
 else if(typeof a==="number"){assert.ok(Math.abs(a-b)<1e-9,"numeric discrepancy "+a+" / "+b);}
 else assert.equal(a,b);
}
const results=[];
for(const alg of ["R U","R U R' U'"]){
 const js=calc(false,alg),wasm=calc(true,alg);
 for(const key of ["total","projectionQueries","sweepTests","releaseCount","assistCount","maxAcceptedDepth","traceT","traceD","traceF","traceCenter","traceFlex","traceMagnetic"])compare(js.track[key],wasm.track[key]);
 compare(js.track.turns.map(a=>a.angles),wasm.track.turns.map(a=>a.angles));
 results.push({alg,jsMs:js.ms,wasmMs:wasm.ms,checks:wasm.track.projectionQueries,kernel:wasm.track.kernel});
}
console.log(JSON.stringify(results,null,2));
const a=results[0],b=results[1],desc="RU "+a.wasmMs.toFixed(0)+"ms vs "+a.jsMs.toFixed(0)+"ms; sexy "+b.wasmMs.toFixed(0)+"ms; precise paths match";
fs.writeFileSync("mechanical-bench-status.txt",desc);
