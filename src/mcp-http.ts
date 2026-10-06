import {createServer} from 'node:http';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createSwitchboardMcp} from './mcp.js';
import {AgentComparisons} from './agent-comparison.js';
import {AgentFoodComparisons} from './agent-food-comparison.js';

// Single-tester development endpoint. Remote/mobile use needs HTTPS and user authentication.
const comparisons=new AgentComparisons(),foods=new AgentFoodComparisons();
const port=Number(process.env.MCP_PORT ?? 3037);
createServer(async(req,res)=>{
  const host=req.headers.host;
  if(!host || ![`localhost:${port}`,`127.0.0.1:${port}`].includes(host) || req.headers.origin && ![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(req.headers.origin)) {
    res.writeHead(403);res.end('Local development client required.');return;
  }
  if(req.url!=='/mcp') {res.writeHead(404);res.end();return;}
  const server=createSwitchboardMcp(comparisons,foods);
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{void transport.close();void server.close();});
  try {await server.connect(transport);await transport.handleRequest(req,res);}
  catch {if(!res.headersSent){res.writeHead(500);res.end('MCP request failed.');}}
}).listen(port,'127.0.0.1',()=>console.error(`Switchboard development MCP: http://127.0.0.1:${port}/mcp`));
