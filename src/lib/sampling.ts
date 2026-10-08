import {Matrix4,Vector3,Vector4} from 'three';

type Pair = readonly [number,number];

/** CPU reference for the shader's nearest-depth sampling convention. */
export function depthTexelCenter(uv:Pair,resolution:Pair):[number,number] {
  return [(Math.floor(uv[0]*resolution[0])+.5)/resolution[0],(Math.floor(uv[1]*resolution[1])+.5)/resolution[1]];
}

/** The supplied depth is from the nearest texel, so XY must use its center too. */
export function reconstructDepthTexel(uv:Pair,depth:number,resolution:Pair,inverseProjection:Matrix4):Vector3 {
  const center=depthTexelCenter(uv,resolution);
  const p=new Vector4(center[0]*2-1,center[1]*2-1,depth*2-1,1).applyMatrix4(inverseProjection);
  return new Vector3(p.x/p.w,p.y/p.w,p.z/p.w);
}

export function screenSliceTangent(view:Vector3,direction:Pair,resolution:Pair,projection:Matrix4):Vector3 {
  const axis=new Vector3(direction[0]/(resolution[0]*projection.elements[0]),direction[1]/(resolution[1]*projection.elements[5]),0);
  return axis.addScaledVector(view,-axis.dot(view)).normalize();
}

/** Transfer the elevation above the actual slice's tangent into the nominal slice.
 * The distance and surface position remain those of the sampled texel. Only the
 * horizon angle changes; this preserves a flat plane under azimuth quantization.
 */
export function transportedHorizonAngle(delta:Vector3,normal:Vector3,view:Vector3,gamma:number,side:-1|1):number {
  const lateral=delta.clone().addScaledVector(view,-delta.dot(view));
  const actualGamma=Math.atan2(normal.dot(lateral.normalize())*side,normal.dot(view));
  const theta=Math.acos(Math.max(-1,Math.min(1,delta.dot(view)/delta.length())));
  return Math.max(0,Math.min(Math.PI,theta+side*(gamma-actualGamma)));
}
