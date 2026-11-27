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
