/* Bulk sampled mesh contact search. Float64 throughout; same ray and
   tolerances as M2.0. Geometry and sample points are supplied by JS.
   Build: clang --target=wasm32 -Oz -ffp-contract=off -nostdlib -fno-builtin
   -Wl,--no-entry -Wl,--export-memory -Wl,--strip-all
   -Wl,--initial-memory=9437184 -o contact_kernel.wasm contact-kernel.c */
#define CAP 1048576
#define PS 22
#define NS 10
#define TS 13
static double buf[CAP];
static double world[160][72][3];
static double hits[2048];
static int ready[160];
static double absd(double x){return x<0?-x:x;}
static double min(double a,double b){return a<b?a:b;}
static double max(double a,double b){return a>b?a:b;}
static double dot(const double*a,const double*b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
static int raybox(const double*p,const double*n){
 const double ray[3]={1,.371,.127};double lo=0,hi=1e300;
 for(int k=0;k<3;k++){lo=max(lo,(n[k]-p[k])/ray[k]);hi=min(hi,(n[k+3]-p[k])/ray[k]);if(lo>hi)return 0;}return hi>=0;
}
static int inside(const double*p,const double*g){
 const double *nodes=buf+(int)g[2],*tris=buf+(int)g[3];
 for(int k=0;k<3;k++)if(p[k]<=nodes[k]+.0002||p[k]>=nodes[k+3]-.0002)return 0;
 int stack[64],sp=1,nh=0;stack[0]=0;
 while(sp){const double*n=nodes+NS*stack[--sp];if(!raybox(p,n))continue;
  if(n[6]>=0){if(sp>61)return -1;stack[sp++]=(int)n[6];stack[sp++]=(int)n[7];continue;}
  for(int j=(int)n[8],end=j+(int)n[9];j<end;j++){
   const double*t=tris+TS*j,*a=t,*e=t+3,*g=t+6,*h=t+9,det=t[12];if(absd(det)<1e-10)continue;
   double sx=p[0]-a[0],sy=p[1]-a[1],sz=p[2]-a[2];double u=(sx*h[0]+sy*h[1]+sz*h[2])/det;if(u<0||u>1)continue;
   double qx=sy*e[2]-sz*e[1],qy=sz*e[0]-sx*e[2],qz=sx*e[1]-sy*e[0],v=(qx+.371*qy+.127*qz)/det;if(v<0||u+v>1)continue;
   double d=(g[0]*qx+g[1]*qy+g[2]*qz)/det;if(absd(d)<.0005)return 0;if(d>0){if(nh>=2048)return -1;hits[nh++]=d;}
  }
 }
 for(int i=1;i<nh;i++){double x=hits[i];int j=i;while(j&&hits[j-1]>x){hits[j]=hits[j-1];j--;}hits[j]=x;}
 int count=0;for(int i=0;i<nh;i++)if(!i||hits[i]-hits[i-1]>.00001)count++;return count&1;
}
static int separate(const double*a,const double*b){
 const double *A=buf+(int)a[3],*B=buf+(int)b[3],*an=buf+(int)A[2],*bn=buf+(int)B[2];double h[3],j[3],ac[3],bc[3],d[3],t[3],R[3][3],Q[3][3];
 for(int k=0;k<3;k++){h[k]=(an[k+3]-an[k])*.5;j[k]=(bn[k+3]-bn[k])*.5;ac[k]=(an[k+3]+an[k])*.5;bc[k]=(bn[k+3]+bn[k])*.5;}
 for(int k=0;k<3;k++)d[k]=b[4+k]+b[7+k]*bc[0]+b[10+k]*bc[1]+b[13+k]*bc[2]-(a[4+k]+a[7+k]*ac[0]+a[10+k]*ac[1]+a[13+k]*ac[2]);
 for(int i=0;i<3;i++){t[i]=dot(d,a+7+3*i);for(int k=0;k<3;k++){R[i][k]=dot(a+7+3*i,b+7+3*k);Q[i][k]=absd(R[i][k])+1e-10;}}
 for(int i=0;i<3;i++)if(absd(t[i])>h[i]+j[0]*Q[i][0]+j[1]*Q[i][1]+j[2]*Q[i][2])return 1;
 for(int i=0;i<3;i++)if(absd(t[0]*R[0][i]+t[1]*R[1][i]+t[2]*R[2][i])>j[i]+h[0]*Q[0][i]+h[1]*Q[1][i]+h[2]*Q[2][i])return 1;
 for(int i=0;i<3;i++)for(int k=0;k<3;k++){int u=(i+1)%3,v=(i+2)%3,m=(k+1)%3,n=(k+2)%3;if(absd(t[v]*R[u][k]-t[u]*R[v][k])>h[u]*Q[v][k]+h[v]*Q[u][k]+j[m]*Q[i][n]+j[n]*Q[i][m])return 1;}
 return 0;
}
static void samples(int i,const double*p){if(ready[i])return;ready[i]=1;const double*g=buf+(int)p[3],*s=buf+(int)g[0];for(int j=0;j<(int)g[1];j++)for(int k=0;k<3;k++)world[i][j][k]=p[7+k]*s[3*j]+p[10+k]*s[3*j+1]+p[13+k]*s[3*j+2]+p[4+k];}
__attribute__((export_name("buffer"))) int buffer(void){return (int)(unsigned long)buf;}
__attribute__((export_name("scan"))) int scan(int n,int base,int out,int cap){
 if(n>160)return -1;for(int i=0;i<n;i++)ready[i]=0;int count=0,tests=0;
 for(int i=0;i<n;i++)for(int j=i+1;j<n;j++){
  const double*a=buf+base+PS*i,*b=buf+base+PS*j;
  if(a[0]==b[0]||(a[1]==b[1]&&!a[2]&&!b[2]))continue;
  if(a[16]>b[19]||a[19]<b[16]||a[17]>b[20]||a[20]<b[17]||a[18]>b[21]||a[21]<b[18]||separate(a,b))continue;
  samples(i,a);samples(j,b);
  for(int dir=0;dir<2;dir++){
   const int src=dir?j:i,dst=dir?i:j;const double*S=dir?b:a,*D=dir?a:b,*sg=buf+(int)S[3],*dg=buf+(int)D[3];
   for(int k=0;k<(int)sg[1];k++){
    const double*p=world[src][k];if(p[0]<=D[16]+.00015||p[0]>=D[19]-.00015||p[1]<=D[17]+.00015||p[1]>=D[20]-.00015||p[2]<=D[18]+.00015||p[2]>=D[21]-.00015)continue;
    double v[3]={p[0]-D[4],p[1]-D[5],p[2]-D[6]},local[3]={dot(v,D+7),dot(v,D+10),dot(v,D+13)};tests++;int in=inside(local,dg);if(in<0)return -1;if(!in)continue;
    if(count>=cap)return -1;double*o=buf+out+1+8*count++;o[0]=src;o[1]=dst;for(int z=0;z<3;z++){o[2+z]=p[z];o[5+z]=local[z];}
   }
  }
 }
 buf[out]=tests;return count;
}
