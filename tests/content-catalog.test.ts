import {test} from 'node:test';
import assert from 'node:assert/strict';
import {articles,topics,labs,foundations,learningPaths,getArticle,topicArticles,articleLabHref,resource} from '../src/lib/content/catalog';
import {decodeRayState} from '../src/lib/ray/state';
import {decodeShadowState} from '../src/lib/shadow/state';
import {rayArticles,getRayArticle} from '../src/lib/ray/catalog';
import {studyArticles} from '../src/lib/study/catalog';
test('every available article has exactly one primary topic and one existing lab',()=>{
 assert.equal(articles.length,17);assert.equal(new Set(articles.map(a=>a.id)).size,17);assert.equal(labs.length,12);
 for(const article of articles){assert.ok(topics.some(t=>t.id===article.topic));assert.ok(labs.find(l=>l.id===article.labId)?.articles.includes(article.id));for(const id of article.prerequisiteReading)assert.ok(resource(id));}
 assert.deepEqual(topics.map(t=>topicArticles(t.id).length),[5,2,3,3,2,2]);
 for(const lab of labs)for(const id of lab.articles)assert.equal(getArticle(id).labId,lab.id);
});
test('learning routes reuse canonical resources and prerequisite references have no cycles',()=>{
 const allIds=[...articles,...foundations].map(x=>x.id);assert.equal(new Set(allIds).size,allIds.length);
 for(const path of learningPaths){assert.equal(new Set(path.steps).size,path.steps.length);for(const id of path.steps)assert.ok(allIds.includes(id));}
 const visit=(id:string,stack:string[])=>{assert.ok(!stack.includes(id),'prerequisite cycle: '+[...stack,id].join(' -> '));const a=articles.find(a=>a.id===id);for(const child of a?.prerequisiteReading??[])visit(child,[...stack,id]);};
 for(const a of articles)visit(a.id,[]);
 assert.deepEqual(learningPaths.find(p=>p.id==='ray-tracing')?.steps,rayArticles.map(a=>a.slug));
});
test('topic and learning links open the correct lesson in shared renderers',()=>{
 for(const article of articles){const href=articleLabHref(article);assert.ok(href.startsWith(labs.find(l=>l.id===article.labId)!.href));
  if(article.rayLesson){const parsed=decodeRayState(new URL(href,'https://local.test').hash);assert.equal(parsed.notice,undefined);assert.equal(parsed.state.lesson,article.rayLesson);assert.equal(parsed.state.learning?.article,article.id);}
 }
 for(const [id,lesson] of [['shadow-mapping','mapping'],['pcf-pcss','filtering']]){const parsed=decodeShadowState(new URL(articleLabHref(id),'https://local.test').hash);assert.equal(parsed.notice,undefined);assert.equal(parsed.state.lesson,lesson);}
});
test('legacy metadata exports derive from the canonical catalog',()=>{
 for(const a of rayArticles){const current=getArticle(a.slug);assert.equal(a.title,current.title);assert.equal(getRayArticle(a.lesson).description,current.description);}
 for(const [id,a] of Object.entries(studyArticles))assert.equal(a.title,getArticle(id).title);
});
