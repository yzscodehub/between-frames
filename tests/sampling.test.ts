import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3,Vector4} from 'three';
import {depthTexelCenter,reconstructDepthTexel,screenSliceTangent,transportedHorizonAngle} from '../src/lib/sampling';
import {sliceIntegral} from '../src/lib/math';

type Pair = [number,number];
const clamp=(x:number)=>Math.max(-1,Math.min(1,x));

// Rasterize an infinite plane analytically: the stored depth is the intersection
// of the plane and the ray through a pixel CENTER, never the requested subpixel UV.
function planeDepth(camera:PerspectiveCamera,uv:Pair,point:Vector3,normal:Vector3) {
  const ray=new Vector3(uv[0]*2-1,uv[1]*2-1,0).applyMatrix4(camera.projectionMatrixInverse);
  const position=ray.multiplyScalar(normal.dot(point)/normal.dot(ray));
  assert.ok(position.z<0,'the analytic plane intersection is in front of the camera');
  const clip=new Vector4(...position.toArray(),1).applyMatrix4(camera.projectionMatrix);
  return {position,depth:(clip.z/clip.w+1)/2};
}

function unsnappedPosition(camera:PerspectiveCamera,uv:Pair,depth:number) {
  return new Vector3(uv[0]*2-1,uv[1]*2-1,depth*2-1).applyMatrix4(camera.projectionMatrixInverse);
}

test('nearest depth reconstructs the analytic tilted plane at the texel center',()=>{
  let largestOldResidual=0;
  for(const resolution of [[320,200],[701,439]] as Pair[]) {
    const camera=new PerspectiveCamera(45,resolution[0]/resolution[1],.1,50);
    const normal=new Vector3(.3,.7,.65).normalize(),point=new Vector3(.2,-.1,-3);
    for(const uv of [[.501,.501],[.2214,.7297],[.7301,.3603]] as Pair[]) {
      const center=depthTexelCenter(uv,resolution),sample=planeDepth(camera,center,point,normal);
      const reconstructed=reconstructDepthTexel(uv,sample.depth,resolution,camera.projectionMatrixInverse);
      // Independent geometric constraints, not a projection/inverse round trip.
      assert.ok(Math.abs(normal.dot(reconstructed.clone().sub(point)))<1e-12);
      assert.ok(reconstructed.distanceTo(sample.position)<1e-12);
      const old=unsnappedPosition(camera,uv,sample.depth);
      largestOldResidual=Math.max(largestOldResidual,Math.abs(normal.dot(old.sub(point))));
    }
  }
  assert.ok(largestOldResidual>.001,'the fixture must expose the former non-planar reconstruction');
});

test('snapping preserves out-of-bounds requests instead of clamping them onto the image',()=>{
  assert.deepEqual(depthTexelCenter([.1,.1],[10,10]),[.15,.15]);
  assert.deepEqual(depthTexelCenter([-.001,1],[10,10]),[-.05,1.05]);
});

test('texel-center reconstruction plus slice transport keeps a tilted plane unoccluded',()=>{
  let oldFalseOcclusion=0,snappedFalseOcclusion=0,projectedFalseOcclusion=0,checked=0;
  for(const resolution of [[320,200],[701,439]] as Pair[]) {
    const camera=new PerspectiveCamera(45,resolution[0]/resolution[1],.1,50);
    const normal=new Vector3(.35,.75,.6).normalize();
    for(const uvInput of [[.21,.57],[.68,.48]] as Pair[]) {
      const uv=depthTexelCenter(uvInput,resolution);
      const p=unsnappedPosition(camera,uv,.97),view=p.clone().negate().normalize();
      assert.ok(normal.dot(view)>0);
      for(let slice=0;slice<64;slice++) {
        const phi=(slice+.37)*Math.PI/64,direction:Pair=[Math.cos(phi),Math.sin(phi)];
        const tangent=screenSliceTangent(view,direction,resolution,camera.projectionMatrix);
        const gamma=Math.atan2(normal.dot(tangent),normal.dot(view));
        const length=Math.hypot(normal.dot(tangent),normal.dot(view));
        let plus=-1,minus=-1;
        for(const side of [-1,1] as const) for(const offset of [1.5,2.3,5.7,13.2]) {
          const requested:Pair=[uv[0]+side*direction[0]*offset/resolution[0],uv[1]+side*direction[1]*offset/resolution[1]];
          const sample=planeDepth(camera,depthTexelCenter(requested,resolution),p,normal);
          const delta=reconstructDepthTexel(requested,sample.depth,resolution,camera.projectionMatrixInverse).sub(p);
          assert.ok(Math.abs(normal.dot(delta))<1e-12);
          const expected=-side*Math.sin(gamma);
          const oldDelta=unsnappedPosition(camera,requested,sample.depth).sub(p);
          oldFalseOcclusion=Math.max(oldFalseOcclusion,oldDelta.dot(view)/oldDelta.length()-expected);
          snappedFalseOcclusion=Math.max(snappedFalseOcclusion,delta.dot(view)/delta.length()-expected);
          const projected=tangent.clone().multiplyScalar(delta.dot(tangent)).addScaledVector(view,delta.dot(view));
          projectedFalseOcclusion=Math.max(projectedFalseOcclusion,projected.dot(view)/projected.length()-expected);
          const theta=transportedHorizonAngle(delta,normal,view,gamma,side),horizon=Math.cos(theta);
          assert.ok(Math.abs(horizon-expected)<1e-10,'a coplanar sample must lie exactly on the nominal slice tangent');
          if(side===1)plus=Math.max(plus,horizon);else minus=Math.max(minus,horizon);
          checked++;
        }
        const hbao=(Math.max(0,plus+Math.sin(gamma))+Math.max(0,minus-Math.sin(gamma)))/2;
        assert.ok(hbao<1e-10);
        const clipped=sliceIntegral(gamma,-Math.acos(clamp(minus)),Math.acos(clamp(plus)),length);
        const unoccluded=sliceIntegral(gamma,-Math.PI,Math.PI,length);
        assert.ok(Math.abs(clipped-unoccluded)<1e-10,'GTAO must preserve the complete visible surface hemisphere');
      }
    }
  }
  assert.equal(checked,2048);
  assert.ok(oldFalseOcclusion>.01);
  assert.ok(snappedFalseOcclusion>.01,'snapping alone still confuses actual and nominal slice azimuths');
  assert.ok(projectedFalseOcclusion>.01,'orthogonal projection alone does not preserve a tilted plane');
});

test('slice transport preserves a real blocker elevation and clamps angular endpoints',()=>{
  const view=new Vector3(0,0,1),normal=new Vector3(.2,.8,.6).normalize();
  const nominal=new Vector3(1,0,0),gamma=Math.atan2(normal.dot(nominal),normal.dot(view));
  const actual=new Vector3(Math.cos(.22),Math.sin(.22),0);
  const actualGamma=Math.atan2(normal.dot(actual),normal.dot(view));
  for(const side of [-1,1] as const) {
    const theta=Math.PI/2+side*actualGamma-.17;
    const delta=actual.clone().multiplyScalar(side*Math.sin(theta)).addScaledVector(view,Math.cos(theta));
    const adjusted=transportedHorizonAngle(delta,normal,view,gamma,side);
    assert.ok(Math.abs(adjusted-(Math.PI/2+side*gamma-.17))<1e-12);
  }
  const nearView=new Vector3(.001,0,1).normalize();
  assert.equal(transportedHorizonAngle(nearView,normal,view,-1,1),0);
  const away=new Vector3(.001,0,-1).normalize();
  assert.equal(transportedHorizonAngle(away,normal,view,1,1),Math.PI);
});
