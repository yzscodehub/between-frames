import {defaultRayState,encodeRayState,type RayLesson,type RayState} from './state';
import {getArticle} from '../content/catalog';
export type {RayLesson} from './state';
export type RayArticleStage = 'published' | 'planned';

export interface RayArticle {
  id: string;
  lesson: RayLesson;
  title: string;
  slug: string;
  stage: RayArticleStage;
  description: string;
  prerequisites: string;
}

/** Planned entries are reading directions, never links to an absent article. */
export const rayArticles:readonly RayArticle[]=['ray-intersections','ray-bvh','ray-shadows','ray-reflections','path-tracing','ray-mis','ray-denoising'].map(id=>{
 const a=getArticle(id);return {id:a.code,lesson:a.rayLesson!,title:a.title,slug:a.id,stage:'published',description:a.description,prerequisites:a.knowledge};
});

export function rayArticleHref(article: RayArticle): string | null {
  return article.stage === 'published' ? `/articles/${article.slug}/` : null;
}

export function getRayArticle(lesson: RayLesson): RayArticle {
  const article = rayArticles.find(item => item.lesson === lesson);
  if (!article) throw new Error(`Unknown ray lesson: ${lesson}`);
  return article;
}

export function rayLabHref(lesson: RayLesson, overrides: Partial<RayState> = {}): string {
  const route = lesson === 'rays' || lesson === 'bvh'
    ? '/labs/rays/'
    : lesson === 'shadows' || lesson === 'reflections'
      ? '/labs/ray-effects/'
      : '/labs/path-tracing/';
  return route + encodeRayState({...defaultRayState(lesson),...overrides,version:1,lesson});
}
