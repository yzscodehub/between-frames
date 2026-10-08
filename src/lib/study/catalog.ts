import {getArticle,articleLabHref} from '../content/catalog';
export type StudyId='pbr'|'ssr'|'taa';
/** Compatibility export. Editorial metadata has a single source in content/catalog. */
const adapt=(id:StudyId)=>{const a=getArticle(id);return {code:a.code,title:a.title,description:a.description,prerequisite:a.knowledge,lab:articleLabHref(a)};};
export const studyArticles={pbr:adapt('pbr'),ssr:adapt('ssr'),taa:adapt('taa')};
