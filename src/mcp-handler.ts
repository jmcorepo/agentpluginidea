import type {IncomingMessage,ServerResponse} from 'node:http';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createSwitchboardMcp} from './mcp.js';
import {AgentComparisons} from './agent-comparison.js';
import {AgentFoodComparisons} from './agent-food-comparison.js';

/** Anonymous computation only: no provider browser, vault, account reads, or trip storage. */
export function createMcpHandler(origin:string) {
  const allowed=new URL(origin),comparisons=new AgentComparisons(),foods=new AgentFoodComparisons();
  // ChatGPT may send its own Origin during MCP discovery. Keep dashboard
  // access rules separate: this handler exposes anonymous calculation tools only.
  const clientOrigins=new Set([allowed.origin,'https://chatgpt.com']);
  return async(req:IncomingMessage,res:ServerResponse)=>{
    if(req.headers.host!==allowed.host || req.headers.origin && !clientOrigins.has(req.headers.origin)) {
      res.writeHead(403);res.end('Origin not allowed.');return;
    }
    if(req.method!=='POST') {res.writeHead(405,{Allow:'POST'});res.end();return;}
    const server=createSwitchboardMcp(comparisons,foods);
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{void transport.close();void server.close();});
    try {await server.connect(transport);await transport.handleRequest(req,res);}
    catch {if(!res.headersSent){res.writeHead(500);res.end('MCP request failed.');}}
  };
}
