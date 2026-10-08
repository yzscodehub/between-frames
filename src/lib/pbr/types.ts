export type Vec3=[number,number,number];
export type PbrView='beauty'|'diffuse'|'specular'|'d'|'f'|'g';
export interface PbrState {version:1;roughness:number;metallic:number;baseColor:string;intensity:number;lightAzimuth:number;lightElevation:number;exposure:number;view:PbrView;compare:boolean;shadows:boolean;task:0|1|2;camera:{position:Vec3;target:Vec3};learning?:{article:'pbr';chapter:string}}
export interface PbrMaterial {baseColor:Vec3;roughness:number;metallic:number}
export interface BrdfTerms {noL:number;noV:number;noH:number;voH:number;alpha:number;d:number;g1L:number;g1V:number;g:number;f0:Vec3;f:Vec3;diffuse:Vec3;specular:Vec3;brdf:Vec3}
export interface PbrIntegral {diffuse:Vec3;specular:Vec3;total:Vec3;samples:number;convergence:Vec3}
export interface PbrInspection {uv:[number,number];position:Vec3;normal:Vec3;objectId:number;material:PbrMaterial;viewDirection:Vec3;lightDirection:Vec3;visibility:number;intensity:number;terms:BrdfTerms;radiance:Vec3;cpu:BrdfTerms;cpuRadiance:Vec3;maxRelativeError:number;valid:boolean}
export interface PbrReport {state?:PbrState;ready?:boolean;pending?:boolean;paused?:boolean;inspection?:PbrInspection|null;integral?:PbrIntegral|null;integralProgress?:number;cpuMs?:number;gpuMs?:number|null;device?:string;error?:string}
