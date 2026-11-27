// Independent NxN state + experimental grip-pose planner. No cubing.js dependency.
export const rad = d => d*Math.PI/180;
export const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
export const smooth = t => t*t*(3-2*t);
export const rotate = (v,a,t) => {
  const [x,y,z]=v,c=Math.cos(t),s=Math.sin(t);
  return a===0?[x,c*y-s*z,s*y+c*z]:a===1?[c*x+s*z,y,c*z-s*x]:[c*x-s*y,s*x+c*y,z];
};
const FACES=[[0,1,"#cf302e"],[0,-1,"#f58b27"],[1,1,"#f7f7f7"],[1,-1,"#f4d331"],[2,1,"#24aa57"],[2,-1,"#2463cf"]];
const unit=(a,s)=>[0,1,2].map(i=>i===a?s:0);
export function solved(n) {
  const c=[],edge=n-1;
  for(let x=-edge;x<=edge;x+=2)for(let y=-edge;y<=edge;y+=2)for(let z=-edge;z<=edge;z+=2){
    const p=[x,y,z];
    if(!p.some(v=>Math.abs(v)===edge))continue;
    c.push({p,b:[unit(0,1),unit(1,1),unit(2,1)],
      colors:FACES.map(([a,s,color])=>p[a]===s*edge?color:"#202124")});
  }
  return c;
}
export function parseAlg(text,n){
  return text.trim().split(/\s+/).filter(Boolean).map(token=>{
    const m=token.match(/^(\d+)?([RLUDFBrludfbxyzMES])(w)?(2'?|')?$/);
    if(!m)throw Error("Unsupported move: "+token);
    const [,prefix,letter,w,suffix]=m, f=letter.toUpperCase();
    const whole="xyz".includes(letter), slice="MES".includes(letter);
    const lower="rludfb".includes(letter);
    if((whole||slice)&&(prefix||w))throw Error("Invalid move: "+token);
    const axis=({R:0,L:0,U:1,D:1,F:2,B:2,X:0,Y:1,Z:2,M:0,E:1,S:2})[f];
    const side="LDBME".includes(f)?-1:1;
    const width=prefix?Number(prefix):w||lower?2:1;
    if(!whole&&!slice&&(width<1||width>n))throw Error("Invalid layer: "+token);
    if(slice&&n%2===0)throw Error("Use explicit inner-layer notation on even cubes: "+token);
    const selected=p=>whole|| (slice?p[axis]===0:(w||lower)?side*p[axis]>=n-1-2*(width-1):side*p[axis]===n-1-2*(width-1));
    const amount=suffix?.startsWith("2")?2:1;
    return {token,axis,side,whole,slice,width,amount,face:f,selected,
      angle:-side*amount*Math.PI/2*(suffix?.endsWith("'")?-1:1)};
  });
}
export function apply(cubies,move){
  const r=v=>rotate(v,move.axis,move.angle).map(Math.round);
  return cubies.map(c=>move.selected(c.p)?{...c,p:r(c.p),b:c.b.map(r)}:c);
}
export function buildTimeline(n,setup,alg){
  let c=solved(n);
  for(const m of parseAlg(setup,n))c=apply(c,m);
  const moves=parseAlg(alg,n), frames=[c], times=[0];
  for(const m of moves){
    c=apply(c,m);frames.push(c);
    times.push(times.at(-1)+(m.whole?1.25:m.amount===2?1.48:1));
  }
  return {n,moves,frames,times,total:times.at(-1)};
}
// Hypothesized ergonomic grip states, not measured motion capture.
// Angles are pitch/yaw/roll relative to the user's camera.
const GRIPS=[
  {name:"home",pose:[0,0,0]},
  {name:"right access",pose:[-3,-12,-6]},
  {name:"left access",pose:[-3,12,6]},
  {name:"front access",pose:[-13,0,0]},
  {name:"lower access",pose:[15,0,0]},
  {name:"back access",pose:[-7,27,5]}
];
function cost(m,g){
  if(m.whole)return g===0?0:0.3;
  const face=m.face;
  if(face==="R"||face==="L"||face==="U")return g===0?0:g===1&&face==="R"||g===2&&face==="L"?0.08:0.7;
  if(face==="F"||face==="S")return g===3?0:g===0?1.05:1.2;
  if(face==="D"||face==="E")return g===4?0:g===0?1.25:1.3;
  if(face==="B")return g===5?0:g===0?1.9:1.7;
  return g===0?0:0.6;
}
export function planGrip(moves){
  let scores=GRIPS.map((_,i)=>i===0?0:1.35), back=[];
  for(const m of moves){
    const prev=scores, row=[];
    scores=GRIPS.map((_,j)=>{
      let best=Infinity,idx=0;
      prev.forEach((v,i)=>{
        const z=v+(i===j?0:1.25)+cost(m,j);
        if(z<best){best=z;idx=i;}
      });row[j]=idx;return best;
    });back.push(row);
  }
  let best=scores.map((v,i)=>v+(i===0?0:0.4)), k=best.indexOf(Math.min(...best)), out=[];
  for(let i=moves.length-1;i>=0;i--){out.unshift(k);k=back[i][k];}
  return out;
}
// Unit quaternion [w,x,y,z]. Interpolate visual pose only.
const mul=(a,b)=>[a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3],
a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],
a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1],
a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
const qaxis=(a,t)=>[Math.cos(t/2),...unit(a,Math.sin(t/2))];
export const qpose=([x,y,z])=>mul(qaxis(2,rad(z)),mul(qaxis(1,rad(y)),qaxis(0,rad(x))));
export function qrotate(q,v){return mul(mul(q,[0,...v]),[q[0],-q[1],-q[2],-q[3]]).slice(1);}
export function slerp(a,b,t){
  let dot=a.reduce((s,v,i)=>s+v*b[i],0);
  if(dot<0){b=b.map(v=>-v);dot=-dot;}
  if(dot>0.9995){const q=a.map((v,i)=>v+(b[i]-v)*t),l=Math.hypot(...q);return q.map(v=>v/l);}
  const theta=Math.acos(clamp(dot,-1,1)),s=Math.sin(theta);
  return a.map((v,i)=>(v*Math.sin((1-t)*theta)+b[i]*Math.sin(t*theta))/s);
}
// A grip change spans a short window around the move boundary.
// Keep a stable grip through ordinary finger flicks; only explicit whole
// rotations receive an extra small multi-axis wrist arc.
// Timing and angles are hypotheses, not motion-capture measurements.
export function buildPoseTrack(timeline){
  const {moves,times,total}=timeline,grip=planGrip(moves);
  const keys=[{t:0,p:[0,0,0]}], accents=[];
  const push=(t,p)=>{
    t=clamp(t,0,total);
    const last=keys.at(-1);
    if(t<=last.t+1e-8)return;
    keys.push({t,p:p.slice()});
  };
  let current=0;
  for(let i=0;i<moves.length;i++){
    const m=moves[i],start=times[i],end=times[i+1],span=end-start;
    const next=grip[i];
    if(next!==current){
      // Anticipate a change during the tail of the previous move.
      const lead=i?Math.min(.42,(times[i]-times[i-1])*.32):0;
      push(start-lead,GRIPS[current].pose);
      push(start+span*.28,GRIPS[next].pose);
      current=next;
    }
    if(m.whole){
      const sign=Math.sign(m.angle);
      // Orthogonal wrist tilt, not an extra logical x/y/z turn.
      const p=m.axis===0?[0,sign*5,-sign*4]:
        m.axis===1?[sign*6,0,sign*3]:[sign*4,-sign*5,0];
      accents.push({start:Math.max(0,start-.16),end:Math.min(total,end+.18),p});
    }
  }
  // Preserve the ending grip; don't spring back to home after every sequence.
  push(total,GRIPS[current].pose);
  return {keys,grip,accents};
}
// Component-wise monotone cubic Hermite on small local pose offsets.
// This yields continuous velocity at keyframes without overshooting a
// chosen grip. Convert to a unit quaternion for rendering. Full x/y/z
// rotations remain on the separate logical rotation timeline.
function tangent(keys,i,axis){
  if(i===0||i===keys.length-1)return 0;
  const a=keys[i-1],b=keys[i],c=keys[i+1];
  const h0=b.t-a.t,h1=c.t-b.t;
  const d0=(b.p[axis]-a.p[axis])/h0,d1=(c.p[axis]-b.p[axis])/h1;
  if(d0*d1<=0)return 0;
  const w0=2*h1+h0,w1=h1+2*h0;
  return (w0+w1)/(w0/d0+w1/d1);
}
export function poseAnglesAt(track,t){
  const keys=track.keys;
  let j=1;while(j<keys.length&&keys[j].t<t)j++;
  let p;
  if(j>=keys.length)p=keys.at(-1).p.slice();
  else{
    const a=keys[j-1],b=keys[j],h=b.t-a.t,u=clamp((t-a.t)/h,0,1);
    const u2=u*u,u3=u2*u;
    p=a.p.map((v,k)=>(2*u3-3*u2+1)*v+(u3-2*u2+u)*h*tangent(keys,j-1,k)+(-2*u3+3*u2)*b.p[k]+(u3-u2)*h*tangent(keys,j,k));
  }
  for(const a of track.accents||[]){
    if(t<=a.start||t>=a.end)continue;
    const u=(t-a.start)/(a.end-a.start);
    const envelope=Math.sin(Math.PI*u)**2; // zero velocity at entry/exit
    p=p.map((v,k)=>v+a.p[k]*envelope);
  }
  return p;
}
export function poseAt(track,t,strength=1){
  return qpose(poseAnglesAt(track,t).map(v=>v*strength));
}
export function frameAt(timeline,t){
  const {times,frames,moves,total}=timeline;t=clamp(t,0,total);
  let lo=0,hi=times.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(times[mid]<=t)lo=mid;else hi=mid-1;}
  const i=lo,move=moves[i];
  const f=move?clamp((t-times[i])/(times[i+1]-times[i]),0,1):0;
  return {i,cubies:frames[i],move,angle:move?move.angle*smooth(f):0};
}

// Visual-search experiment. The solver's full sticker state is never used to
// choose a pose: only geometry, move cues and already observed sticker colors.
// Piece/sticker identity tracking is idealized and memory has a finite lifetime.
const SEARCH_COLORS={white:"#f7f7f7",yellow:"#f4d331",green:"#24aa57",blue:"#2463cf",red:"#cf302e",orange:"#f58b27"};
const SEARCH_VIEW=qpose([25,-34,0]);
const VISIBILITY=.28;
const MEMORY_MOVES=7;
const searchAngles=[
  [-22,0,0],[22,0,0],[0,-22,0],[0,22,0],
  [-40,0,0],[40,0,0],[0,-40,0],[0,40,0],
  [-32,-32,0],[-32,32,0],[32,-32,0],[32,32,0],
  [-60,0,0],[60,0,0],[0,-65,0],[0,65,0],
  [-48,-48,0],[-48,48,0],[48,-48,0],[48,48,0]
];
function stickerVisible(c,j,pose,view=SEARCH_VIEW){
  const [axis,side]=FACES[j];
  const n=c.b[axis].map(v=>v*side);
  return qrotate(view,qrotate(pose,n))[2]>=VISIBILITY;
}
function memoryColor(memory,id,j,i){
  const seen=memory.get(id*6+j);
  return seen&&i-seen.i<=MEMORY_MOVES?seen.color:null;
}
function observe(cubies,pose,memory,i,view){
  for(let id=0;id<cubies.length;id++){
    const c=cubies[id];
    // Color is read only after the geometry passes the visibility test.
    for(let j=0;j<6;j++)if(stickerVisible(c,j,pose,view)&&c.colors[j]!=="#202124"){
      memory.set(id*6+j,{color:c.colors[j],i});
    }
  }
}
function isOuterSticker(c,j,n){
  const [a,s]=FACES[j],normal=c.b[a].map(v=>v*s);
  return normal.some((v,k)=>v!==0&&c.p[k]*v===n-1);
}
function searchCandidates(timeline,i,memory,colors,kind){
  const c=timeline.frames[i],n=timeline.n,moves=timeline.moves.slice(i,i+3);
  const candidates=[];
  for(let id=0;id<c.length;id++){
    const piece=c[id];
    const stickers=[0,1,2,3,4,5].filter(j=>isOuterSticker(piece,j,n));
    if(stickers.length!==(kind==="center"?1:2))continue;
    // Future move participation is a rough proxy for solver target metadata.
    // No inference about the actual solver's goal is claimed here.
    if(!moves.some(m=>!m.whole&&m.selected(piece.p)))continue;
    const known=stickers.map(j=>memoryColor(memory,id,j,i)).filter(Boolean);
    if(known.some(color=>!colors.includes(color)))continue;
    if(known.length===stickers.length&&colors.every(color=>known.includes(color))){
      return {candidates:[],knownTarget:true};
    }
    const unknown=stickers.filter(j=>!memoryColor(memory,id,j,i));
    if(unknown.length)candidates.push({id,unknown,weight:known.length?2:0.65});
  }
  return {candidates,knownTarget:false};
}
export function planVisualSearch(timeline,{target=["white","green"],kind="edge",checkpoints=null,interval=4,view=SEARCH_VIEW}={}){
  if(kind!=="edge"&&kind!=="center")throw Error("Unknown search target type");
  const colors=target.map(c=>SEARCH_COLORS[c]);
  if(colors.length!==(kind==="center"?1:2)||colors.some(c=>!c)||new Set(colors).size!==colors.length)throw Error("Invalid target colors");
  const memory=new Map(),events=[],decisions=[];
  const checks=checkpoints===null?null:new Set(checkpoints);
  const home=[1,0,0,0];
  for(let i=0;i<timeline.moves.length;i++){
    const cubies=timeline.frames[i];
    observe(cubies,home,memory,i,view);
    if(!(checks?checks.has(i):i%Math.max(1,interval)===0))continue;
    const {candidates,knownTarget}=searchCandidates(timeline,i,memory,colors,kind);
    if(knownTarget||!candidates.length){
      decisions.push({i,reason:knownTarget?"target already identified":"no eligible uncertain piece"});continue;
    }
    let best=null;
    for(const p of searchAngles){
      const q=qpose(p);
      // Gain is computed on unknown slots, never on their hidden colors.
      const newlyVisible=candidates.flatMap(c=>c.unknown.filter(j=>stickerVisible(cubies[c.id],j,q,view)).map(j=>({id:c.id,j,weight:c.weight})));
      const gain=newlyVisible.reduce((s,v)=>s+v.weight,0);
      const angle=2*Math.acos(clamp(Math.abs(q[0]),0,1))*180/Math.PI;
      const score=gain-.023*angle-.45;
      if(gain>0&&score>0&&(!best||score>best.score))best={p,angle,gain,score,newlyVisible};
    }
    if(!best){decisions.push({i,reason:"no useful low-cost view"});continue;}
    // Observe only what was exposed by the selected physical pose.
    observe(cubies,qpose(best.p),memory,i,view);
    const duration=.48+best.angle/95; // units of nominal quarter-turn duration
    events.push({i,p:best.p,duration,angle:best.angle,gain:best.gain,observed:best.newlyVisible.length});
    decisions.push({i,reason:"inspect",angle:best.angle,gain:best.gain});
  }
  return {events,decisions};
}
// Extra search time is explicit and does not change the puzzle or add a move.
// Both comparison views use the same schedule, allowing a fair pose comparison.
export function inspectionTimeline(timeline,plan){
  const segments=[],stepTimes=[],byIndex=new Map(plan.events.map(e=>[e.i,e]));
  let t=0;
  for(let i=0;i<timeline.moves.length;i++){
    stepTimes.push(t);
    const event=byIndex.get(i);
    if(event){segments.push({start:t,end:t+event.duration,i,event});t+=event.duration;}
    const dt=timeline.times[i+1]-timeline.times[i];
    segments.push({start:t,end:t+dt,i,move:true});t+=dt;
  }
  stepTimes.push(t);
  return {segments,stepTimes,total:t};
}
export function inspectionFrameAt(timeline,schedule,time,strength=1){
  const t=clamp(time,0,schedule.total);
  const seg=schedule.segments.find(s=>t<s.end);
  if(!seg)return {frame:frameAt(timeline,timeline.total),pose:[1,0,0,0],event:null};
  const u=clamp((t-seg.start)/(seg.end-seg.start),0,1);
  if(seg.event){
    // Fast tilt, brief observation, smooth return. No logical cube rotation.
    const f=u<.4?smooth(u/.4):u<.6?1:smooth((1-u)/.4);
    return {frame:{i:seg.i,cubies:timeline.frames[seg.i],move:null,angle:0},
      pose:qpose(seg.event.p.map(v=>v*f*strength)),event:seg.event};
  }
  return {frame:frameAt(timeline,timeline.times[seg.i]+u*(timeline.times[seg.i+1]-timeline.times[seg.i])),
    pose:[1,0,0,0],event:null};
}

// v0.4: inspection during a real layer turn. The old pause-based planner
// remains available as a baseline. All time values are nominal turn units.
const HOME_Q=[1,0,0,0];
const angularDistance=(a,b)=>2*Math.acos(clamp(Math.abs(a.reduce((v,x,i)=>v+x*b[i],0)),0,1))*180/Math.PI;
const transitionAt=(from,to,u)=>slerp(from,to,smooth(clamp(u/.72,0,1)));
function movingVisibility(c,j,move,u,pose,view){
  const [axis,side]=FACES[j];
  let n=c.b[axis].map(v=>v*side);
  if(move.selected(c.p))n=rotate(n,move.axis,move.angle*smooth(u));
  return qrotate(view,qrotate(pose,n))[2]>=VISIBILITY;
}
const sampleProgress=[0,.25,.5,.72,.86,1];
function observedSlots(cubies,move,from,to,view){
  const slots=new Set();
  for(const u of sampleProgress){
    const q=transitionAt(from,to,u);
    for(let id=0;id<cubies.length;id++){
      const c=cubies[id];
      for(let j=0;j<6;j++)if(movingVisibility(c,j,move,u,q,view))slots.add(id*6+j);
    }
  }
  return slots;
}
function observeMoving(cubies,slots,memory,i,n){
  for(const key of slots){
    const id=Math.floor(key/6),j=key%6,c=cubies[id];
    if(isOuterSticker(c,j,n)&&c.colors[j]!=="#202124")memory.set(key,{color:c.colors[j],i});
  }
}
function continuousCandidates(timeline,i,memory,colors,kind){
  const {frames,moves,n}=timeline,cubies=frames[i],candidates=[];
  for(let id=0;id<cubies.length;id++){
    const c=cubies[id],stickers=[0,1,2,3,4,5].filter(j=>isOuterSticker(c,j,n));
    if(stickers.length!==(kind==="center"?1:2))continue;
    let relevant=false;
    for(let k=i;k<Math.min(i+3,moves.length);k++){
      if(!moves[k].whole&&moves[k].selected(frames[k][id].p)){relevant=true;break;}
    }
    if(!relevant)continue;
    const known=stickers.map(j=>memoryColor(memory,id,j,i)).filter(Boolean);
    if(known.some(color=>!colors.includes(color)))continue;
    if(known.length===stickers.length&&colors.every(color=>known.includes(color)))return {candidates:[],knownTarget:true};
    const unknown=stickers.filter(j=>!memoryColor(memory,id,j,i));
    if(unknown.length)candidates.push({id,unknown,weight:known.length?2:0.65});
  }
  return {candidates,knownTarget:false};
}
// Gain from a candidate pose in addition to what the layer itself reveals.
// Search candidate geometry only; hidden sticker colors are never consulted.
function extraGain(cubies,move,from,to,view,candidates,baseline){
  let gain=0,count=0;
  for(const c of candidates)for(const j of c.unknown){
    if(baseline.has(c.id*6+j))continue;
    if(sampleProgress.some(u=>movingVisibility(cubies[c.id],j,move,u,transitionAt(from,to,u),view))){
      gain+=c.weight;count++;
    }
  }
  return {gain,count};
}
export function planContinuousSearch(timeline,{target=["white","green"],kind="edge",checkpoints=null,view=SEARCH_VIEW}={}){
  if(kind!=="edge"&&kind!=="center")throw Error("Unknown search target type");
  const colors=target.map(c=>SEARCH_COLORS[c]);
  if(colors.length!==(kind==="center"?1:2)||colors.some(c=>!c)||new Set(colors).size!==colors.length)throw Error("Invalid target colors");
  const memory=new Map(),events=[],decisions=[],segments=[],checks=checkpoints===null?null:new Set(checkpoints);
  let pose=HOME_Q,lastSearch=-Infinity;
  for(let i=0;i<timeline.moves.length;i++){
    const cubies=timeline.frames[i],move=timeline.moves[i];
    observe(cubies,pose,memory,i,view);
    // Stay at the acquired pose for one more turn; return only when no
    // immediate information-seeking move is needed. No per-turn bounce.
    let to=i-lastSearch<=1?pose:HOME_Q,event=null;
    const baseline=observedSlots(cubies,move,pose,to,view);
    if((checks?checks.has(i):i-lastSearch>=2)&&!move.whole){
      const {candidates,knownTarget}=continuousCandidates(timeline,i,memory,colors,kind);
      if(knownTarget||!candidates.length)decisions.push({i,reason:knownTarget?"target already identified":"no eligible uncertain piece"});
      else{
        let best=null;
        const evaluate=p=>{
          const q=qpose(p),angle=angularDistance(pose,q);
          if(angle>75||angularDistance(HOME_Q,q)>75)return;
          const {gain,count}=extraGain(cubies,move,pose,q,view,candidates,baseline);
          const score=gain-.026*angle-.35;
          if(gain>0&&score>0&&(!best||score>best.score+1e-8))best={p,q,angle,gain,count,score};
        };
        for(const p of searchAngles)evaluate(p);
        // Refine around the best coarse direction, including non-grid angles.
        if(best)for(const delta of [10,4,1]){
          const center=best.p.slice();
          for(const x of [-delta,0,delta])for(const y of [-delta,0,delta])if(x||y)evaluate([center[0]+x,center[1]+y,0]);
        }
        if(best){
          to=best.q;lastSearch=i;
          event={i,p:best.p,angle:best.angle,gain:best.gain,observed:best.count,overlap:true};
          events.push(event);decisions.push({i,reason:"inspect",angle:best.angle,gain:best.gain});
        }else decisions.push({i,reason:"no useful low-cost view"});
      }
    }
    const slots=observedSlots(cubies,move,pose,to,view);
    observeMoving(cubies,slots,memory,i,timeline.n);
    segments.push({start:timeline.times[i],end:timeline.times[i+1],i,from:pose,to,event});
    pose=to;
  }
  return {events,decisions,segments,stepTimes:timeline.times,total:timeline.total,endPose:pose};
}
export function continuousSearchFrameAt(timeline,plan,time,strength=1){
  const t=clamp(time,0,plan.total),frame=frameAt(timeline,t);
  const seg=plan.segments[frame.i];
  const pose=seg?transitionAt(seg.from,seg.to,(t-seg.start)/(seg.end-seg.start)):plan.endPose;
  // Strength is a display-only comparison adjustment; perception always
  // uses the nominal planned pose.
  const q=strength<=1?slerp(HOME_Q,pose,clamp(strength,0,1)):slerp(HOME_Q,pose,strength);
  return {frame,pose:q,event:seg?.event||null};
}
