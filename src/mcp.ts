import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AgentComparisons,planSchema,finishSchema} from './agent-comparison.js';

export function createSwitchboardMcp(comparisons=new AgentComparisons()) {
  const skillText=readFileSync(new URL('../plugin/skills/compare-rides/SKILL.md',import.meta.url),'utf8');
  const skillUri='skill://switchboard/compare-rides/SKILL.md';
  const skill={uri:skillUri,frontmatter:{name:'compare-rides',description:'Compare Uber and Lyft prices and pickup or arrival times for a user\'s route through Switchboard, collecting live quotes with the host browser.'},resources:[{uri:skillUri,digest:`sha256:${createHash('sha256').update(skillText).digest('hex')}`}]};
  const server=new McpServer({name:'switchboard',version:'0.1.0'},{capabilities:{extensions:{'io.modelcontextprotocol/skills':{}}},instructions:'For ride comparisons, call prepare_ride_comparison, collect live quotes for every planned provider using your available browser, then call finish_ride_comparison. If browsing is unavailable or blocked, say so. These tools do not browse, authenticate providers, or book rides.'});
  server.registerResource('compare-rides',skillUri,{mimeType:'text/markdown'},async()=>({contents:[{uri:skillUri,mimeType:'text/markdown',text:skillText}]}));
  server.server.setRequestHandler(z.object({method:z.literal('skills/list'),params:z.object({cursor:z.string().optional()}).optional()}),async request=>{
    if(request.params?.cursor) throw new Error('No further skill pages.');
    return {skills:[skill]};
  });
  server.server.setRequestHandler(z.object({method:z.literal('skills/get'),params:z.object({uri:z.string()})}),async request=>{
    if(request.params.uri!==skillUri) throw new Error('Unknown skill.');
    return {skill};
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
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  await createSwitchboardMcp().connect(new StdioServerTransport());
}
