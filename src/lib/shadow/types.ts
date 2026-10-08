import type {Vec3} from '../ray/types';
export type ShadowLesson='mapping'|'filtering';
export type ShadowPreset='contact'|'steps'|'layers';
export type ShadowAlgorithm='hard'|'pcf'|'pcss';
export interface ShadowState {version:1;lesson:ShadowLesson;preset:ShadowPreset;algorithm:ShadowAlgorithm;resolution:128|256|512|1024;fov:number;bias:number;planeCorrection:boolean;filterRadius:number;lightSize:number;height:number;seed:number;view:'lit'|'visibility'|'map';compare:boolean;camera:{position:Vec3;target:Vec3};learning?:{article:'shadow-mapping'|'pcf-pcss';chapter:string}}
export interface ShadowSample {stage:'search'|'filter';uv:[number,number];depth:number;receiver:number;visible:number;valid:boolean;blocker:boolean}
export interface ShadowInspection {uv:[number,number];position:Vec3;normal:Vec3;objectId:number;lightUv:[number,number];receiverDepth:number;storedDepth:number;receiverDistance:number;storedDistance:number;visibility:number;blockerCount:number;blockerDistance:number;radiusTexels:number;searchRadiusTexels?:number;covered:boolean;samples:ShadowSample[];cpuMapDepth:number|null;mapDepthError:number|null;cpuVisibility:number|null;mathError:number|null}
export interface ShadowReference {value:number;checkpoint:number;convergence:number;samples:number}
export interface ShadowReport {state?:ShadowState;ready?:boolean;pending?:boolean;paused?:boolean;error?:string;inspection?:ShadowInspection|null;reference?:ShadowReference|null;referenceProgress?:number;cpuMs?:number;gpuMs?:number|null;device?:string;triangles?:number}
