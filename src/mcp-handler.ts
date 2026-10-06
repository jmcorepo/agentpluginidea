import type {IncomingMessage,ServerResponse} from 'node:http';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createSwitchboardMcp} from './mcp.js';
import {AgentComparisons} from './agent-comparison.js';

/** Anonymous computation only: no provider browser, vault, account reads, or trip storage. */
export function createMcpHandler(origin:string) {
  const allowed=new URL(origin),comparisons=new AgentComparisons();
  return async(req:IncomingMessage,res:ServerResponse)=>{
    if(req.headers.host!==allowed.host || req.headers.origin && req.headers.origin!==allowed.origin) {
      res.writeHead(403);res.end('Origin not allowed.');return;
    }
    if(req.method!=='POST') {res.writeHead(405,{Allow:'POST'});res.end();return;}
    const server=createSwitchboardMcp(comparisons);
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{void transport.close();void server.close();});
    try {await server.connect(transport);await transport.handleRequest(req,res);}
    catch {if(!res.headersSent){res.writeHead(500);res.end('MCP request failed.');}}
  };
}
