import {mkdir,readFile,writeFile,rm,cp} from 'node:fs/promises';
const assets={};
for(const file of ['index.html','app.js','style.css','favicon.svg'])assets[file]=await readFile('public/'+file,'utf8');
const source=await readFile('worker/index.js','utf8');
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/index.js','const assets='+JSON.stringify(assets)+';\n'+source);await cp('.openai/hosting.json','dist/.openai/hosting.json');
await cp('drizzle','dist/drizzle',{recursive:true});console.log('Built dist/server/index.js');
