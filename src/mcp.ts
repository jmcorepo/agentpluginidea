import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AgentComparisons,planSchema,finishSchema} from './agent-comparison.js';
import {AgentFoodComparisons,foodPlanSchema,foodFinishSchema} from './agent-food-comparison.js';

export function createSwitchboardMcp(comparisons=new AgentComparisons(),foods=new AgentFoodComparisons()) {
  const skills=['compare-rides','compare-food'].map(name=>{
    const text=readFileSync(new URL(`../plugin/skills/${name}/SKILL.md`,import.meta.url),'utf8');
    const uri=`skill://switchboard/${name}/SKILL.md`;
    const description=text.match(/^description: (.+)$/m)?.[1];
    if(!description) throw new Error(`Missing skill description: ${name}`);
    return {text,manifest:{uri,frontmatter:{name,description},resources:[{uri,digest:`sha256:${createHash('sha256').update(text).digest('hex')}`}]}};
  });
  const server=new McpServer({name:'switchboard',version:'0.2.1'},{capabilities:{extensions:{'io.modelcontextprotocol/skills':{}}},instructions:'For food comparisons, use compare-food: prepare_food_comparison, collect both Uber Eats and DoorDash checkouts with authorized provider tools or your host browser, then finish_food_comparison. For rides use compare-rides and the ride tools. If provider access is unavailable, report the blocker. This MCP validates agent-reported quotes; it does not browse, connect provider accounts, order food or book rides.'});
  for(const skill of skills) server.registerResource(skill.manifest.frontmatter.name,skill.manifest.uri,{mimeType:'text/markdown'},async()=>({contents:[{uri:skill.manifest.uri,mimeType:'text/markdown',text:skill.text}]}));
  server.server.setRequestHandler(z.object({method:z.literal('skills/list'),params:z.object({cursor:z.string().optional()}).optional()}),async request=>{
    if(request.params?.cursor) throw new Error('No further skill pages.');
    return {skills:skills.map(s=>s.manifest)};
  });
  server.server.setRequestHandler(z.object({method:z.literal('skills/get'),params:z.object({uri:z.string()})}),async request=>{
    const skill=skills.find(s=>s.manifest.uri===request.params.uri);
    if(!skill) throw new Error('Unknown skill.');
    return {skill:skill.manifest};
  });
  const result=(data:object)=>({content:[{type:'text' as const,text:JSON.stringify(data)}],structuredContent:{...data}});
  server.registerTool('prepare_ride_comparison',{
    title:'Prepare a ride comparison',description:'Start a comparison of Uber and Lyft for one explicit route. Returns the collection plan for the host browser. Does not fetch prices or connect accounts.',
    inputSchema:planSchema.shape,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:false},_meta:{securitySchemes:[{type:'noauth'}]},
  },async input=>result(comparisons.prepare(input)));
  server.registerTool('finish_ride_comparison',{
    title:'Validate and rank observed ride quotes',description:'Submit host-browser observations for a prepared comparison. Checks matching route, standard category, currency and freshness, then ranks prices and times. Does not independently verify page authenticity.',
    inputSchema:finishSchema.shape,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},_meta:{securitySchemes:[{type:'noauth'}]},
  },async input=>result(comparisons.finish(input)));
  server.registerTool('prepare_food_comparison',{
    title:'Prepare an Uber Eats and DoorDash comparison',description:'Plan one exact restaurant branch, basket, delivery address and tip across BOTH providers. Returns instructions for authorized provider tools or the host browser; does not fetch prices or sign in.',
    inputSchema:foodPlanSchema.shape,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:false},_meta:{securitySchemes:[{type:'noauth'}]},
  },async input=>result(foods.prepare(input)));
  server.registerTool('finish_food_comparison',{
    title:'Validate and compare food checkout quotes',description:'Check agent-reported Uber Eats and DoorDash checkout observations for identical branch, basket, address, standard delivery, tip, currency and freshness. Compare final totals, discounts and delivery windows; report missing providers without declaring a winner.',
    inputSchema:foodFinishSchema.shape,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},_meta:{securitySchemes:[{type:'noauth'}]},
  },async input=>result(foods.finish(input)));
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  await createSwitchboardMcp().connect(new StdioServerTransport());
}
