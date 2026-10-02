import {mkdir,readFile,writeFile,rm,cp} from 'node:fs/promises';
const assets={};
for(const file of ['index.html','app.js','address-autocomplete.js','style.css','favicon.svg'])assets[file]=await readFile('public/'+file,'utf8');
const source=await readFile('worker/index.js','utf8');
const shared=(await readFile('shared/addresses.mjs','utf8')).replace(/^export /gm,'');
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/index.js','const assets='+JSON.stringify(assets)+';\n'+shared+'\n'+source);await cp('.openai/hosting.json','dist/.openai/hosting.json');
await cp('drizzle','dist/drizzle',{recursive:true});console.log('Built dist/server/index.js');
