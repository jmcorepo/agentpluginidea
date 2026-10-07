import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AgentComparisons,planSchema,finishSchema} from './agent-comparison.js';
import {AgentFoodComparisons,foodPlanSchema,foodFinishSchema,foodCompareSchema} from './agent-food-comparison.js';
import {foodWidgetHtml,FOOD_WIDGET_URI} from './food-widget.js';

export function createSwitchboardMcp(comparisons=new AgentComparisons(),foods=new AgentFoodComparisons()) {
  const skills=['compare-rides','compare-food'].map(name=>{
    const text=readFileSync(new URL(`../plugin/skills/${name}/SKILL.md`,import.meta.url),'utf8');
    const uri=`skill://switchboard/${name}/SKILL.md`;
    const description=text.match(/^description: (.+)$/m)?.[1];
    if(!description) throw new Error(`Missing skill description: ${name}`);
    const resources=[{uri,text}];
    if(name==='compare-food') resources.push({uri:'skill://switchboard/compare-food/references/without-mcp.md',text:readFileSync(new URL('../plugin/skills/compare-food/references/without-mcp.md',import.meta.url),'utf8')});
    return {text,resources,manifest:{uri,frontmatter:{name,description},resources:resources.map(resource=>({uri:resource.uri,digest:`sha256:${createHash('sha256').update(resource.text).digest('hex')}`}))}};
  });
  const server=new McpServer({name:'switchboard',version:'0.3.0'},{capabilities:{extensions:{'io.modelcontextprotocol/skills':{}}},instructions:'For food comparisons, use compare-food: collect both Uber Eats and DoorDash checkouts with authorized provider tools or your host browser, then call compare_food_quotes ONCE with the exact request and both observations. It validates and returns the comparison card. The older prepare/finish flow remains supported. For rides use compare-rides and the ride tools. If provider access is unavailable, report the blocker. This MCP validates agent-reported quotes; it does not browse, connect provider accounts, order food or book rides.'});
  server.registerResource('food-comparison-card',FOOD_WIDGET_URI,{mimeType:'text/html;profile=mcp-app'},async()=>({contents:[{uri:FOOD_WIDGET_URI,mimeType:'text/html;profile=mcp-app',text:foodWidgetHtml,_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},'openai/widgetDescription':'Side-by-side food checkout totals, delivery windows, applied savings and expandable fees. No purchasing controls.','openai/widgetPrefersBorder':true,'openai/widgetCSP':{connect_domains:[],resource_domains:[]}}}]}));
  const foodUi={securitySchemes:[{type:'noauth'}],ui:{resourceUri:FOOD_WIDGET_URI},'openai/outputTemplate':FOOD_WIDGET_URI,'openai/toolInvocation/invoking':'Comparing checkout totals…','openai/toolInvocation/invoked':'Food comparison ready'};
  for(const skill of skills) for(const resource of skill.resources) server.registerResource(resource.uri,resource.uri,{mimeType:'text/markdown'},async()=>({contents:[{uri:resource.uri,mimeType:'text/markdown',text:resource.text}]}));
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
    inputSchema:foodFinishSchema.shape,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},_meta:foodUi,
  },async input=>result(foods.finish(input)));
  server.registerTool('compare_food_quotes',{
    title:'Compare food totals and show the comparison card',description:'Preferred one-call food comparison: AFTER collecting both exact Uber Eats and DoorDash checkouts, supply the request and both observations. Validates the same branch, basket, address, tip, USD currency, final totals and freshness; returns cheapest, supported fastest, applied savings and the UI card. No preparation call needed. Does not fetch provider data, sign in, discover meals or order.',
    inputSchema:foodCompareSchema.shape,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},_meta:foodUi,
  },async input=>result(foods.compare(input)));
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  await createSwitchboardMcp().connect(new StdioServerTransport());
}
