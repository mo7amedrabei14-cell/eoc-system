const fs=require('fs');
const path=require('path');
const {validateGraph}=require(process.argv[2]);
const root=process.cwd();
const base=path.join(root,'.ua','intermediate');
const graphPath=path.join(base,'assembled-graph.json');
const scan=JSON.parse(fs.readFileSync(path.join(base,'scan-result.json'),'utf8'));
const assembled=JSON.parse(fs.readFileSync(graphPath,'utf8'));
const layers=JSON.parse(fs.readFileSync(path.join(base,'layers.json'),'utf8'));
const tour=JSON.parse(fs.readFileSync(path.join(base,'tour.json'),'utf8'));
const commit=require('child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const graph={version:'1.0.0',kind:'codebase',project:{name:'EOC System',languages:scan.languages,frameworks:scan.frameworks,description:'A digital operations platform for coordination, monitoring, reporting, and decision-making for the Egyptian Red Crescent Emergency Operations Center.',analyzedAt:new Date().toISOString(),gitCommitHash:commit},nodes:assembled.nodes,edges:assembled.edges,layers,tour};
const ids=new Set(graph.nodes.map(n=>n.id));
const fileTypes=new Set(['file','config','document','service','pipeline','table','schema','resource','endpoint']);
const fileNodes=graph.nodes.filter(n=>fileTypes.has(n.type)&&n.filePath&&n.id===n.type+':'+n.filePath);
const scanPaths=new Set(scan.files.map(f=>f.path));
const graphPaths=new Set(fileNodes.map(n=>n.filePath));
const missingPaths=[...scanPaths].filter(p=>!graphPaths.has(p));
const extraPaths=[...graphPaths].filter(p=>!scanPaths.has(p));
const assigned=new Map();const layerIssues=[];
for(const layer of graph.layers){if(!layer.id||!layer.name||!layer.description||!Array.isArray(layer.nodeIds)||!layer.nodeIds.length)layerIssues.push('invalid or empty layer '+String(layer.id));for(const id of layer.nodeIds||[]){if(!ids.has(id))layerIssues.push('layer '+layer.id+' references absent '+id);if(assigned.has(id))layerIssues.push('duplicate layer assignment '+id);assigned.set(id,layer.id)}}
for(const n of fileNodes)if(!assigned.has(n.id))layerIssues.push('unassigned file node '+n.id);
const tourIssues=[];
if(graph.tour.length<5||graph.tour.length>15)tourIssues.push('tour must contain 5-15 steps');
for(let i=0;i<graph.tour.length;i++){const step=graph.tour[i];if(step.order!==i+1)tourIssues.push('nonsequential tour order '+step.order);if(!step.title||!step.description||!Array.isArray(step.nodeIds)||!step.nodeIds.length||step.nodeIds.length>5)tourIssues.push('invalid tour step '+step.order);for(const id of step.nodeIds||[])if(!ids.has(id))tourIssues.push('tour references absent '+id)}
const result=validateGraph(graph);
console.log(JSON.stringify({success:result.success,fatal:result.fatal,issues:result.issues,warnings:result.errors,stats:{nodes:graph.nodes.length,edges:graph.edges.length,fileNodes:fileNodes.length,scanFiles:scan.totalFiles,layers:graph.layers.length,tourSteps:graph.tour.length},missingPaths,extraPaths,layerIssues,tourIssues},null,2));
if(missingPaths.length||extraPaths.length||layerIssues.length||tourIssues.length||!result.success)process.exitCode=2;
fs.writeFileSync(path.join(base,'final-candidate.json'),JSON.stringify(result.data||graph,null,2));
